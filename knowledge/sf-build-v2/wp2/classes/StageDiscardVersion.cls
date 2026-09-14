/**
 * StageDiscardVersion - MCP tool: stage_discard_version.
 *
 * A33.0.1: ZERO domain DML. This class discovers, by query, every record a discard would delete,
 * returns that inventory as the plan, and writes nothing but the staging row and its token.
 *
 * WHAT A DISCARD IS. A banker forked a booked package yesterday. nCino minted a new package
 * version, cloned each rolled facility onto it at Qualification with Is_Modification true and a
 * `_M<n>` lookup key, and wrote the chain rows that make the booked parents read
 * `LLC_BI__hasRenewal__c = true`. Discarding that version puts the relationship back to the booked
 * package only. It is the one action in this package that DELETES, so the fence around it is the
 * inventory: nothing is removed that this inventory did not name at the confirm gate.
 *
 * AND WHAT A DISCARD ALSO IS (backlog 58, 2026-09-14). A banker can create a credit package from
 * nothing through `execute_new_facility`, and the 0.9.23 promise is that such a package rolls back
 * to nothing too. That package has no fork, no chain rows and no booked parent, so it is recognised
 * by two other marks: the opening stage `create_package` files it at, and the `new-facility-request`
 * trail row that names it in `cm_Product_Package__c`. The ledger is the stronger of the two, because
 * a stage is a field anyone can move. Everything after the gate is identical to a version's discard:
 * the same ordered chain, the same verifications, the same trail marked Withdrawn.
 *
 * WHAT IS NEVER DELETED, AND THIS LIST IS THE CONTRACT. The booked source package. Every booked
 * parent facility. `LLC_BI__Collateral__c` assets and their `LLC_BI__Account_Collateral__c`
 * ownership junctions (the version's copied PLEDGES go, the assets they point at stay).
 * `LLC_BI__Covenant2__c` covenant records and their `LLC_BI__Account_Covenant__c` relationship
 * junctions (the version's loan JUNCTIONS go, the covenants stay). The `cm_Action_Staging__c`
 * trail, which is marked Withdrawn rather than removed, because the trail is the audit. Anything
 * a banker created on the version in Salesforce rather than through this cockpit: an approval
 * submission, a filed document, a review. Those are refused at stage with HAS_FOREIGN_CHILDREN and
 * named, so the banker withdraws them in Salesforce first.
 *
 * PROBE FINDINGS THAT SHAPED THIS CLASS (bankinggpt-at, 2026-09-13, read-only; recorded in
 * LESSONS-NCINO-APEX section 8):
 *
 *   1. THERE IS NO MANAGED UNDO WE CAN CALL. `LLC_BI.ActionedLoansRollbackProcessor` and its Aura
 *      and Remote variants exist in the org, and none of them is reachable from Apex: the Tooling
 *      API returns a null SymbolTable for all three, where the known-global `nFORCE.BeanFactory`,
 *      `nFORCE.ACrossPackageService` and `nFORCE.CallableApi_v1` all return one, and none appears
 *      among the org's 174 invocable Apex actions. nCino's rollback is also a different thing from
 *      this one: PDI-00018042 describes the automatic rollback of a FAILED credit action, not a
 *      banker-initiated undo of one that succeeded. So the delete chain below is the route, not the
 *      fallback.
 *
 *   2. DELETING THE CLONE DOES NOT CLEAR THE CHAIN. `LLC_BI__LoanRenewal__c.LLC_BI__RenewalLoanId__c`
 *      is a plain lookup (cascadeDelete false) while `LLC_BI__ParentLoanId__c` is the master-detail
 *      leg. The row therefore survives its clone and keeps the booked parent flagged, which is
 *      exactly what was observed by hand on 2026-09-11 and what made every later roll fail with
 *      "The request contains invalid facilities". The chain rows go FIRST.
 *
 *   3. `hasRenewal` IS A FORMULA OVER A ROLLUP, AND THE SELF-ANCHOR DOES NOT FEED IT.
 *      `LLC_BI__hasRenewal__c = LLC_BI__Number_Of_Renewals__c > 0`, and live rows settle what that
 *      rollup counts: Hartwell's two Real Estate facilities each carry a revision-0 self-anchor row
 *      and read `Number_Of_Renewals = 0`, while Piedmont and EverPetal each carry a self-anchor PLUS
 *      a revision-1 row with `HasActiveRenewalLoan = true` and read 1. Only the revision rows that
 *      point at a clone count. The frozen contract's parenthetical "both revisions; this is what
 *      flips the parents' hasRenewal formula back" is therefore half right: the revision row is what
 *      flips it, and the self-anchor is bookkeeping. This class deletes the self-anchor only when
 *      the same credit action minted it (its CreatedDate is not earlier than the version package's),
 *      because on a parent that already carried one the self-anchor is pre-existing data and
 *      deleting it would break rule one of this tool.
 *
 *   4. THE PLEDGE MUST GO BEFORE THE LOAN, AND THE PLATFORM WILL SAY SO.
 *      `LLC_BI__Loan_Collateral2__c.LLC_BI__Loan__c` carries restrictedDelete, so a version loan
 *      cannot be deleted while a pledge hangs off it. Covenant junctions, fees and the Loan Detail
 *      are the opposite case: all three are master-detail on the Loan and cascade with it. The
 *      junctions and fees are still deleted explicitly, in their own verified step, because a
 *      cascade is invisible to a banker reading the tracker; the Loan Detail is not, and is
 *      reported as cascading rather than claimed as a delete.
 *
 *   5. `LLC_BI__Opportunity_History__c` ALSO CARRIES restrictedDelete against both the Loan and the
 *      Product Package, and nCino mints one the second a loan is created (observed to the second on
 *      three facilities). Refusing on it would refuse every discard, and the 2026-09-11 manual
 *      chain deleted its clone loans successfully with those rows present, so nCino's own
 *      before-delete handling clears them. They are reported as an expected org-side clearance and
 *      never refused. The restricted children that are NOT auto-minted (`LLC_BI__Loan_Compliance__c`,
 *      `LLC_BI__Repayment_Vehicle__c`, `LLC_BI__Spread__c`, `LLC_BI__Statistic__c`, and
 *      `LLC_BI__Opportunity_History__c` is deliberately absent from that list) are banker artefacts
 *      when they exist, and those ARE refused.
 *
 *   6. THE ORG HAS NO DOCUMENT PLACEHOLDER ON A LOAN. `LLC_BI__Document_Placeholder__c` exists but
 *      carries no Loan and no Product Package lookup in this org. The loan-side document object is
 *      `LLC_BI__LLC_LoanDocument__c`, it is master-detail on the Loan, and it carries
 *      `LLC_BI__Has_File__c`. That is the object this tool checks for "a document with content",
 *      and because it cascades, a filed document would be destroyed silently by the loan delete.
 *      It is a refusal.
 *
 *   7. THE INTEGRATION USER CAN DELETE ALL OF IT. `Credit Actions Delete`
 *      (`LLC_BI__Product_Package_Credit_Actions_Delete`) exists in the org and is assigned to the
 *      running user, and the profile carries delete on every object in the inventory.
 *
 *   8. THE COLLATERAL AGGREGATE SHELL BELONGS TO THE FACILITY, AND THE FACILITY HOLDS THE LOOKUP.
 *      nCino mints one `LLC_BI__Loan_Collateral_Aggregate__c` per loan and the LOAN points at it;
 *      the shell carries no lookup back, and `LLC_BI__Loan__c.LLC_BI__Loan_Collateral_Aggregate__c`
 *      is a plain lookup, so deleting the facility strands the shell empty rather than taking it
 *      along. Every discard before 2026-09-14 left one orphan per clone behind (backlog row 46;
 *      eighteen of them were swept by hand). The shells are frozen HERE, read off the version's own
 *      facilities at stage time, so the execute may only remove a shell that was on a version
 *      facility when the banker confirmed. Two kinds are refused rather than frozen: one carrying
 *      `LLC_BI__lookupKey__c` was keyed by something other than this cockpit (bankinggpt holds
 *      three seeded that way), and one a facility or a pledge OUTSIDE the version also points at is
 *      not the version's to remove. Refused shells are reported as `observe_aggregates`, exactly as
 *      every shell was before. That second refusal carries more weight than it looks:
 *      `LLC_BI__Loan_Collateral2__c.LLC_BI__Loan_Collateral_Aggregate__c` is a CASCADE lookup, so a
 *      shell delete takes any pledge still hanging off it with it, silently.
 *
 *   8b. AND A SECOND KIND OF SHELL THE FACILITIES CANNOT NAME (org proof 2026-09-14). nCino answers
 *      every pledge insert with a collateral aggregate of its own, and the clone already carries the
 *      one the carry made, so nCino's is an orphan FROM BIRTH: five were minted at 02:31:23Z inside
 *      the version CREATION of Hartwell's a5Fbb000000JHI5EAO, referenced by no loan and no pledge, a
 *      minute before any discard existed. Reading shells off the facilities can never see them. They
 *      are frozen here as a second bucket, found by the version's own BUILD WINDOW: same creator as
 *      the version package, created between the package and the last row its build wrote plus two
 *      minutes, no lookup key, no pledged count and no value, and referenced by nothing at all. New
 *      versions no longer produce them (`C360AggregateSweep` removes them in the transaction that
 *      mints them), so this bucket is the clean-up for versions created before that and the backstop
 *      for anything it misses.
 *
 *   9. `cm_Action_Staging__c.cm_Status__c` HAS NO `Withdrawn` VALUE AND IS A RESTRICTED PICKLIST
 *      (Staged, Executing, Completed, Partial, Failed). The contract's step 7 cannot be honoured
 *      until the value is added, and this package does not add picklist values to its own object
 *      without a founder saying so. The value is read from the org at stage time; when it is
 *      absent the plan says so in a warning and the execute leaves the trail rows untouched rather
 *      than stamping a status that means something else. That makes the run PARTIAL, which is the
 *      honest state.
 *
 * Org contract: SPEC-0.9.23-TOOL-CONTRACT.md pair 2. Ladder: `app/src/data/facilityStage.ts`,
 * read off the live `LLC_BI__Stage__c` picklist.
 */
global with sharing class StageDiscardVersion {

    /** Raised for a domain-level validation failure. Surfaces as ok:false, never as a fault. */
    public class ToolException extends Exception {}

    /**
     * Raised for each of the contract's named gate refusals, carrying the code the cockpit
     * switches on. A refusal is an answer, so it travels with its own name rather than as prose
     * the caller has to parse.
     */
    public class GateException extends Exception {
        public String code;
    }

    private static final String ACTION_ID = 'discard-version';

    /**
     * The approval states that mean the org currently HOLDS this version. A historical approval is
     * a different thing: `ProcessInstance` keeps a row forever, and 42 of this org's 62 read
     * `Removed`, so refusing on the mere existence of one would refuse a version a banker recalled
     * and is entitled to discard. Live means live.
     */
    private static final Set<String> LIVE_PROCESS_STATUS = new Set<String>{ 'Pending', 'Started' };
    private static final Set<String> LIVE_SUBMISSION_STATUS = new Set<String>{ 'InProgress', 'Suspended' };

    /** The withdrawal status the trail rows want. Absent from this org's picklist as of 2026-09-13. */
    public static final String WITHDRAWN = 'Withdrawn';

    /**
     * The aggregate group's step id. It is named once and shared because `ExecuteDiscardVersion`
     * points this ONE group back at the frozen list: the facility holds the lookup to its shell, so
     * once the facilities are gone the shells cannot be rediscovered.
     */
    public static final String AGGREGATE_STEP_ID = 'delete_aggregates';

    /**
     * The org's own Loan stage ladder, in order, read off the live `LLC_BI__Stage__c` picklist
     * (eleven values, all active). The ORDER is the fact: "past approval" is a position on this
     * list, not a word anyone can guess at.
     */
    public static final List<String> STAGE_LADDER = new List<String>{
        'Qualification', 'Proposal', 'Credit Underwriting', 'Final Review', 'Approval / Loan Committee',
        'Processing', 'Doc Prep', 'Closing', 'Boarding', 'Booked', 'Complete'
    };

    private static final Integer APPROVAL_RUNG = 4;
    private static final Integer BOOKED_RUNG = 9;

    /** PDI-00015762: more than 200 collateral rows is where nCino's own rollback is documented to break. */
    private static final Integer PLEDGE_WARNING_THRESHOLD = 200;

    /** The platform's own DML ceiling. A version this large is a data problem, not a discard. */
    private static final Integer MAX_ITEMS = 5000;

    /**
     * How far past the last row a version's build wrote the orphan window still reaches. The
     * Hartwell proof of 2026-09-14 has the package at 02:30 and every clone, pledge and orphan
     * shell at 02:31:23, so two minutes covers a build comfortably without opening the window on
     * an unrelated later run.
     */
    private static final Integer BUILD_WINDOW_TAIL_SECONDS = 120;

    /** More empty shells in one build window than any version creation produces. */
    private static final Integer ORPHAN_SHELL_CAP = 25;

    /**
     * The action whose ledger rows prove this cockpit created a package outright (backlog 58).
     *
     * `execute_new_facility` is the only tool in this package that creates a credit package, and it
     * stamps the package it made onto its own staging row. That row is the evidence: a banker or an
     * org automation can move a package's stage, and nobody can move what the frozen ledger says.
     */
    private static final String CREATOR_ACTION_ID = 'new-facility-request';

    /**
     * The ledger statuses that count as evidence a creation actually ran.
     *
     * `Staged` is absent because a plan that has not executed has created nothing, and the stamp
     * only lands at execute time anyway. `Partial` is present because it is the ORDINARY resting
     * state of a new facility between its two invocations: the package exists from the first one.
     * `Withdrawn` is present for the reason lesson 73 gives: this action marks the creation row
     * Withdrawn when it finishes, so a discard that stopped part way would otherwise destroy the
     * evidence its own gate reads and refuse every retry.
     */
    private static final Set<String> CREATOR_STATUSES = new Set<String>{ 'Completed', 'Partial', WITHDRAWN };

    // ---------------------------------------------------------------------------------------
    // Wire types. Lesson 16: every wire-visible type is a global inner class of the invocable
    // class itself, and wire types are never shared across classes.
    // ---------------------------------------------------------------------------------------

    global class Request {
        @InvocableVariable(label='Idempotency Key' required=true)
        global String idempotencyKey;
        @InvocableVariable(label='Rationale' description='Why this version is being discarded. Feeds the audit ledger.' required=true)
        global String rationale;
        @InvocableVariable(label='Version Package Id' description='The unbooked package version to discard. Must be a modification or renewal version, or a package this cockpit created, and every member must be before Approval / Loan Committee.' required=true)
        global String versionPackageId;
    }

    global class InventoryItem {
        @InvocableVariable(label='Object')
        global String objectName;
        @InvocableVariable(label='Record Id')
        global String recordId;
        @InvocableVariable(label='Name')
        global String name;
        @InvocableVariable(label='Reason')
        global String reason;
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
        @InvocableVariable(label='Items' description='Every record the discard will delete: object, id, name, and why it goes.')
        global List<InventoryItem> items;
        @InvocableVariable(label='Steps')
        global List<PlanStep> steps;
        @InvocableVariable(label='Warnings')
        global List<String> warnings;
        @InvocableVariable(label='Provenance JSON')
        global String provenanceJson;
        @InvocableVariable(label='Version Package Id')
        global String versionPackageId;
        @InvocableVariable(label='Source Package Id' description='The booked package this version forked from, which the discard returns the relationship to. Null when the version has no booked source.')
        global String sourcePackageId;
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

    // ---------------------------------------------------------------------------------------
    // The inventory. Plain structures, shared with ExecuteDiscardVersion so that the set the
    // banker confirms and the set the execute deletes are discovered by ONE piece of code. Two
    // copies of this logic would drift, and the thing they would drift about is what gets deleted.
    // ---------------------------------------------------------------------------------------

    /** One record the discard will remove, in the banker's terms. */
    public class Item {
        public String objectName;
        public Id recordId;
        public String name;
        public String reason;

        public Item(String objectName, Id recordId, String name, String reason) {
            this.objectName = objectName;
            this.recordId = recordId;
            this.name = name == null ? String.valueOf(recordId) : name;
            this.reason = reason;
        }
    }

    /** One ordered delete group: what it is, and the ids in it. */
    public class DeleteGroup {
        public String stepId;
        public String objectName;
        public String label;
        public List<Id> ids;

        public DeleteGroup(String stepId, String objectName, String label) {
            this.stepId = stepId;
            this.objectName = objectName;
            this.label = label;
            this.ids = new List<Id>();
        }
    }

    /** Everything the gate and the plan need, discovered in one pass. */
    public class Inventory {
        public Id versionPackageId;
        public String versionPackageName;
        public Id sourcePackageId;
        public String sourcePackageName;
        public Id accountId;
        public String accountName;
        public List<Id> memberIds = new List<Id>();
        public List<Id> parentIds = new List<Id>();
        public List<String> parentNames = new List<String>();
        public List<DeleteGroup> groups = new List<DeleteGroup>();
        public List<Item> items = new List<Item>();
        public List<Id> stagingRowIds = new List<Id>();
        public List<Id> aggregateIds = new List<Id>();
        public List<String> refusedAggregates = new List<String>();
        /** Of aggregateIds, the ones frozen as orphans the version's own creation minted. */
        public Integer orphanShellCount = 0;
        /** The last row the version's build is known to have written, used to bound that window. */
        public Datetime latestBuildRow;
        public List<String> warnings = new List<String>();
        public Boolean withdrawnAvailable = false;
        public Integer openHistoryRows = 0;
        /** The trail row that proves this cockpit created the package, where the ledger is what classified it. */
        public String creationEvidence;

        /** Total records the chain will delete, trail rows excluded. */
        public Integer itemCount() {
            return items.size();
        }
    }

    // ---------------------------------------------------------------------------------------
    // The invocable.
    // ---------------------------------------------------------------------------------------

    /**
     * Stages a version discard. Writes no domain record.
     *
     * @param requests One request per staged action. Element i of the response belongs to input i.
     * @return One response per request.
     */
    @InvocableMethod(
        label='stage_discard_version'
        description='Discover, by query, every record that discarding an in-flight package version would delete, and return that inventory as an immutable plan with a plan hash and a single-use decision token. Writes NOTHING: the deletes happen only in execute_discard_version behind the token. Refuses a booked package, a version at or past Approval / Loan Committee, and a version carrying children this cockpit did not create.'
    )
    global static List<Response> stage(List<Request> requests) {
        List<Response> out = new List<Response>();
        for (Request req : requests) {
            Response res = new Response();
            try {
                res.result = build(req);
                res.ok = true;
            } catch (GateException e) {
                res.ok = false;
                res.error = err(e.code, e.getMessage(), null, req.idempotencyKey);
            } catch (ToolException e) {
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
        if (String.isBlank(req.versionPackageId)) {
            throw new ToolException('versionPackageId is required. A discard names the version it undoes.');
        }
        if (String.isBlank(req.rationale)) {
            throw new ToolException('rationale is required. It feeds the audit ledger, and this action deletes.');
        }

        Inventory inv = discover(req.versionPackageId);
        describeForBanker(inv);

        List<C360Plan.Step> steps = planSteps(inv);
        Map<String, Object> resolved = resolvedValues(inv);
        List<String> warnings = inv.warnings;
        Map<String, Object> provenance = provenanceOf(inv);
        String summary = summaryOf(inv);

        String planJson = C360Plan.serializePlan(summary, steps, warnings, provenance, resolved);
        String planHash = C360Plan.hash(ACTION_ID, steps, resolved);

        // The trail row for a discard is anchored on the SOURCE package where one exists, because
        // the source is the package the banker will still be looking at tomorrow. The version is
        // about to stop resolving.
        C360ActionStaging.Staged staged = C360ActionStaging.stagePlan(
            ACTION_ID,
            req.idempotencyKey,
            inv.accountId,
            inv.sourcePackageId == null ? inv.versionPackageId : inv.sourcePackageId,
            planJson,
            planHash
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
        r.versionPackageId = String.valueOf(inv.versionPackageId);
        r.sourcePackageId = inv.sourcePackageId == null ? null : String.valueOf(inv.sourcePackageId);
        r.accountId = String.valueOf(inv.accountId);
        r.items = toWireItems(inv.items);
        r.steps = toWireSteps(steps);
        return r;
    }

    // ---------------------------------------------------------------------------------------
    // Discovery and the gate. Public because ExecuteDiscardVersion re-runs exactly this.
    // ---------------------------------------------------------------------------------------

    /**
     * Runs the gate and discovers the whole delete set from the version package id.
     *
     * Every refusal the frozen contract names is raised here, with its code, so stage and execute
     * refuse identically: VERSION_IN_APPROVAL, NOT_A_VERSION, PACKAGE_BOOKED, HAS_FOREIGN_CHILDREN.
     *
     * @param rawVersionPackageId The caller's version package id.
     * @return The gate result and the ordered delete groups.
     * @throws GateException when the version may not be discarded.
     * @throws ToolException when the package cannot be read.
     */
    public static Inventory discover(String rawVersionPackageId) {
        return discover(rawVersionPackageId, true);
    }

    /**
     * Re-discovers what is LEFT of a version whose discard already started, WITHOUT asking the org
     * again whether it is a version.
     *
     * A DELETE CHAIN DESTROYS THE EVIDENCE ITS OWN GATE READS, and that is not an edge case, it is
     * the ordinary shape of a stop. `assertIsDiscardableVersion` ranks a package as a version from
     * its `LLC_BI__LoanRenewal__c` chain rows or its members' `Is_Modification`, and the chain rows
     * are group 1 while the members are group 5. Every run that stops after `delete_chain` therefore
     * meets a package that no longer looks like a version, and a package whose stage is neither
     * Pending nor In Review is refused NOT_A_VERSION from then on. Proved on the org on 2026-09-14:
     * the Hartwell discard on staging row STG-0000000157 stopped `partial` at `delete_aggregates`
     * with 63 of its 69 records gone, and every resume under the same key was then refused by its
     * own progress.
     *
     * THE FROZEN PLAN IS THE AUTHORITY ON A RESUME. The package was a version when the banker
     * confirmed the plan, the staging row records that it was, and the plan hash and decision token
     * the caller presented prove they hold that plan. Re-deriving the classification from a
     * half-deleted org asks a question the org can no longer answer.
     *
     * WHAT IS STILL RE-READ, because none of it depends on evidence this chain deletes:
     * `assertNoForeignChildren`, so a live approval or a filed document that arrived during the
     * stop still stops the resume; and in `ExecuteDiscardVersion`, the measurement of the fresh
     * inventory against the confirmed list, so the ceiling is unchanged and nothing outside the
     * set the banker confirmed is ever deleted.
     *
     * @param versionPackageId The version id off the FROZEN PLAN, never off the request.
     * @return What is left of the delete set, in the same group order.
     * @throws GateException when the version carries records this cockpit did not create.
     * @throws ToolException when the package cannot be read.
     */
    public static Inventory discoverForResume(Id versionPackageId) {
        return discover(String.valueOf(versionPackageId), false);
    }

    /**
     * @param rawVersionPackageId The version package id.
     * @param classify True on a first execute, where the org decides whether this is a version.
     *        False on a resume, where the frozen plan decided it before the deletes began.
     */
    private static Inventory discover(String rawVersionPackageId, Boolean classify) {
        Id pkgId = C360Facilities.packageId(rawVersionPackageId);

        List<LLC_BI__Product_Package__c> pkgs = [
            SELECT Id, Name, LLC_BI__Account__c, LLC_BI__Account__r.Name, LLC_BI__Stage__c, LLC_BI__Status__c,
                   CreatedDate, CreatedById
            FROM LLC_BI__Product_Package__c
            WHERE Id = :pkgId
            WITH USER_MODE
            LIMIT 1
        ];
        if (pkgs.isEmpty()) {
            throw new ToolException('Product package ' + pkgId + ' was not found, or is not visible to you.');
        }
        LLC_BI__Product_Package__c pkg = pkgs[0];

        Inventory inv = new Inventory();
        inv.versionPackageId = pkg.Id;
        inv.versionPackageName = pkg.Name;
        inv.accountId = pkg.LLC_BI__Account__c;
        inv.accountName = pkg.LLC_BI__Account__r == null ? null : pkg.LLC_BI__Account__r.Name;

        List<LLC_BI__Loan__c> members = [
            SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Status__c, LLC_BI__Is_Modification__c,
                   LLC_BI__isRenewal__c, LLC_BI__lookupKey__c, LLC_BI__Loan_Collateral_Aggregate__c, CreatedDate
            FROM LLC_BI__Loan__c
            WHERE LLC_BI__Product_Package__c = :pkgId
            WITH USER_MODE
            ORDER BY Name
        ];
        inv.latestBuildRow = pkg.CreatedDate;
        for (LLC_BI__Loan__c m : members) {
            inv.memberIds.add(m.Id);
            inv.latestBuildRow = later(inv.latestBuildRow, m.CreatedDate);
        }

        List<LLC_BI__LoanRenewal__c> chain = inv.memberIds.isEmpty()
            ? new List<LLC_BI__LoanRenewal__c>()
            : [
                SELECT Id, Name, LLC_BI__ParentLoanId__c, LLC_BI__ParentLoanId__r.Name,
                       LLC_BI__ParentLoanId__r.LLC_BI__Product_Package__c,
                       LLC_BI__ParentLoanId__r.LLC_BI__Product_Package__r.Name,
                       LLC_BI__RenewalLoanId__c, LLC_BI__RevisionNumber__c, LLC_BI__RevisionStatus__c,
                       LLC_BI__HasActiveRenewalLoan__c, LLC_BI__Original_Product_Package__c
                FROM LLC_BI__LoanRenewal__c
                WHERE LLC_BI__RenewalLoanId__c IN :inv.memberIds
                WITH USER_MODE
            ];

        if (classify) {
            assertIsDiscardableVersion(inv, pkg, members, chain);
        }
        assertNoForeignChildren(inv);

        buildChainGroup(inv, pkg, chain);
        buildGraphGroups(inv);
        buildMemberGroup(inv, members);
        buildAggregateGroup(inv, pkg, members);
        buildPackageGroup(inv, pkg);
        buildTrail(inv);

        if (inv.itemCount() > MAX_ITEMS) {
            throw new ToolException(
                'This version resolves to ' + inv.itemCount() + ' records, past the ' + MAX_ITEMS +
                ' this action will delete in one transaction. That is a data problem rather than a discard; ' +
                'raise it before undoing anything.'
            );
        }

        return inv;
    }

    /**
     * The banker-facing half of the discovery: the warnings, the trail-status probe and the
     * Opportunity History count.
     *
     * It is separate from `discover()` because only the STAGE needs it. `ExecuteDiscardVersion`
     * re-runs `discover()` to re-read the gate, and every query it issues there is spent inside the
     * same governor budget as the deletes; the warning text it would produce is thrown away. So the
     * reads that exist purely to write banker prose live here and run once, at stage time.
     *
     * @param inv The inventory just returned by discover().
     */
    public static void describeForBanker(Inventory inv) {
        if (!inv.memberIds.isEmpty()) {
            inv.openHistoryRows = [
                SELECT COUNT() FROM LLC_BI__Opportunity_History__c WHERE LLC_BI__Loan__c IN :inv.memberIds WITH USER_MODE
            ];
        }
        inv.withdrawnAvailable = C360Picklist.activeValues('cm_Action_Staging__c', 'cm_Status__c').contains(WITHDRAWN);
        buildWarnings(inv);
    }

    /**
     * The three state refusals, in severity order: booked beats in-approval, and a package that is
     * neither a version nor a cockpit-created package is refused before either is considered.
     *
     * This runs on a STAGE and on a FIRST execute. It does NOT run on a resume, because the chain
     * rows and the members it reads are the first and fifth things the chain deletes: see
     * `discoverForResume`.
     *
     * TWO WAYS A PACKAGE IS THIS COCKPIT'S TO REMOVE, and until 2026-09-14 this read only the first
     * (backlog 58, live proof on Piedmont package a5Fbb000000JIXVEA4). The first is the package's
     * own STAGE: a version nCino's credit action forked reads Pending or In Review, and so does a
     * package the new-facility room creates now that `create_package` files one at Pending. The
     * second is the LEDGER, and it is the stronger of the two: a stage is a field anyone can move,
     * while `cm_Action_Staging__c` is the frozen audit of what this cockpit did. A completed,
     * partial or already-withdrawn `new-facility-request` row that names this package in
     * `cm_Product_Package__c` AND was written before the package itself says the cockpit made it,
     * whatever its stage reads today; `creationRow` owns that second half, because a row younger
     * than the package only says a facility was filed on one that already existed. Every package
     * created before the stamp existed is reachable through neither mark, which is why the first
     * one had to be removed by hand.
     *
     * @param inv The inventory being built, which carries the evidence into the banker's warnings.
     * @param pkg The package under the gate.
     * @param members Its facilities.
     * @param chain The renewal rows pointing at those facilities.
     */
    private static void assertIsDiscardableVersion(
        Inventory inv,
        LLC_BI__Product_Package__c pkg,
        List<LLC_BI__Loan__c> members,
        List<LLC_BI__LoanRenewal__c> chain
    ) {
        Boolean forked = !chain.isEmpty();
        for (LLC_BI__Loan__c m : members) {
            if (m.LLC_BI__Is_Modification__c == true || m.LLC_BI__isRenewal__c == true) {
                forked = true;
            }
        }
        Boolean cockpitStage = pkg.LLC_BI__Stage__c == 'Pending' || pkg.LLC_BI__Stage__c == 'In Review';
        inv.creationEvidence = creationRow(pkg);

        if (!forked && !cockpitStage && inv.creationEvidence == null) {
            throw gate(
                'NOT_A_VERSION',
                'Package ' + pkg.Name + ' is not an in-flight version and is not a package this cockpit created. ' +
                'It carries no modification or renewal chain, its stage is ' + String.valueOf(pkg.LLC_BI__Stage__c) +
                ' rather than Pending or In Review, and no action trail row records this cockpit creating it. ' +
                'Discard undoes a version; it is not a way to delete a package.'
            );
        }

        // Booked first: a member the bank has booked is not an in-flight anything, whatever else is
        // true about the package.
        for (LLC_BI__Loan__c m : members) {
            if (rung(m.LLC_BI__Stage__c) >= BOOKED_RUNG) {
                throw gate(
                    'PACKAGE_BOOKED',
                    'Facility ' + m.Name + ' on this package is at ' + String.valueOf(m.LLC_BI__Stage__c) +
                    '. A booked facility is the bank\'s record of a loan it made, and nothing here deletes one. ' +
                    'Discard applies to an unbooked version only.'
                );
            }
        }
        if (!forked && (pkg.LLC_BI__Status__c == 'Approved' || pkg.LLC_BI__Stage__c == 'Complete')) {
            throw gate(
                'PACKAGE_BOOKED',
                'Package ' + pkg.Name + ' reads stage ' + String.valueOf(pkg.LLC_BI__Stage__c) + ' and status ' +
                String.valueOf(pkg.LLC_BI__Status__c) + '. That is a settled package, not a version in flight.'
            );
        }

        for (LLC_BI__Loan__c m : members) {
            Integer r = rung(m.LLC_BI__Stage__c);
            if (r < 0) {
                throw gate(
                    'VERSION_IN_APPROVAL',
                    'Facility ' + m.Name + ' carries stage ' + String.valueOf(m.LLC_BI__Stage__c) +
                    ', which is not on this org\'s Loan stage ladder. This action refuses what it cannot rank ' +
                    'rather than guessing that an unknown stage is an early one.'
                );
            }
            if (r >= APPROVAL_RUNG) {
                throw gate(
                    'VERSION_IN_APPROVAL',
                    'Facility ' + m.Name + ' is at ' + String.valueOf(m.LLC_BI__Stage__c) +
                    '. From Approval / Loan Committee the org has taken this version and it is no longer the ' +
                    'banker\'s to discard. Withdraw it in Salesforce first.'
                );
            }
        }
    }

    /**
     * The trail row that records this cockpit CREATING this package, or null.
     *
     * NAMING A PACKAGE IS NOT THE SAME AS MAKING ONE, and the difference decides whether a delete
     * is permitted. `execute_new_facility` stamps `cm_Product_Package__c` on two different paths:
     * the banker supplied an existing package, in which case stage time stamps the anchor they
     * named; or the plan carried none and the execute created one, in which case the stamp lands
     * afterwards. A row of the first kind says a facility was FILED ON this package, which is no
     * licence to delete it.
     *
     * The two are told apart by WHEN the row was written against when the package was. A staging
     * row is inserted at stage time, and on the package-first path the package does not exist yet,
     * so the row is OLDER than the package it names. On the supplied path the package existed
     * before the banker could name it, so the row is younger. The comparison is exact for this
     * action and needs no new field.
     *
     * The rows are ordered oldest first so the earliest claim is the one read, and one is enough:
     * the question is whether the creation happened, not how often it was replayed.
     *
     * @param pkg The package under the gate, which dates the comparison.
     * @return The trail row's name, for the banker's warning, or null when there is none.
     */
    private static String creationRow(LLC_BI__Product_Package__c pkg) {
        for (cm_Action_Staging__c row : [
            SELECT Id, Name, CreatedDate
            FROM cm_Action_Staging__c
            WHERE cm_Product_Package__c = :pkg.Id
              AND cm_Action_Id__c = :CREATOR_ACTION_ID
              AND cm_Status__c IN :CREATOR_STATUSES
            WITH USER_MODE
            ORDER BY CreatedDate ASC
            LIMIT 5
        ]) {
            if (row.CreatedDate < pkg.CreatedDate) {
                return row.Name;
            }
        }
        return null;
    }

    /**
     * Refuses a version carrying anything this cockpit did not create.
     *
     * Five checks, each sourced from the live org rather than from the spec's wording: a LIVE
     * approval submission or process instance on the version package or its members; a
     * `LLC_BI__LLC_LoanDocument__c` with `Has_File__c` true (this org has no loan-side
     * `LLC_BI__Document_Placeholder__c`, and the loan document CASCADES, so an unchecked delete
     * would destroy a filed document silently); a review on the package or on a member; and the
     * restricted-delete children that would block the chain and are banker artefacts when present.
     *
     * A SETTLED approval is a warning rather than a refusal, and the distinction is load-bearing:
     * `ProcessInstance` keeps its row for good, 42 of this org's 62 read `Removed`, and a banker who
     * recalled a submission has taken the version back and is entitled to discard it. Refusing on
     * the mere existence of an approval row would make a recall a one-way door.
     */
    private static void assertNoForeignChildren(Inventory inv) {
        List<Id> members = inv.memberIds;
        List<Id> anchors = new List<Id>(members);
        anchors.add(inv.versionPackageId);

        List<String> found = new List<String>();

        for (ApprovalSubmission a : [
            SELECT Id, Name, Status FROM ApprovalSubmission WHERE RelatedRecordId IN :anchors WITH USER_MODE LIMIT 50
        ]) {
            if (LIVE_SUBMISSION_STATUS.contains(a.Status)) {
                found.add('approval submission ' + a.Name + ' (' + String.valueOf(a.Status) + ')');
            } else {
                inv.warnings.add(
                    'Approval submission ' + a.Name + ' on this version reads ' + String.valueOf(a.Status) +
                    '. It is not holding the version, and it goes with the record it hangs off.'
                );
            }
        }
        for (ProcessInstance p : [
            SELECT Id, Status, TargetObject.Name FROM ProcessInstance WHERE TargetObjectId IN :anchors WITH USER_MODE LIMIT 50
        ]) {
            if (LIVE_PROCESS_STATUS.contains(p.Status)) {
                found.add('a live approval process on ' + String.valueOf(p.TargetObject.Name) + ' (' + String.valueOf(p.Status) + ')');
            } else {
                inv.warnings.add(
                    'An approval process on ' + String.valueOf(p.TargetObject.Name) + ' reads ' + String.valueOf(p.Status) +
                    '. That approval history is a cascade child of the record it targets and will go with it.'
                );
            }
        }
        if (!members.isEmpty()) {
            for (LLC_BI__LLC_LoanDocument__c d : [
                SELECT Id, Name FROM LLC_BI__LLC_LoanDocument__c
                WHERE LLC_BI__Loan__c IN :members AND LLC_BI__Has_File__c = true
                WITH USER_MODE LIMIT 50
            ]) {
                found.add('document ' + d.Name + ' with a file attached');
            }
            for (LLC_BI__Review_Loan__c rl : [
                SELECT Id, LLC_BI__Review__r.Name FROM LLC_BI__Review_Loan__c
                WHERE LLC_BI__Loan__c IN :members WITH USER_MODE LIMIT 50
            ]) {
                found.add('review ' + String.valueOf(rl.LLC_BI__Review__r.Name) + ' covering a facility on this version');
            }
            found.addAll(restrictedChildren(members));
        }
        for (LLC_BI__Review__c rv : [
            SELECT Id, Name FROM LLC_BI__Review__c WHERE LLC_BI__Product_Package__c = :inv.versionPackageId WITH USER_MODE LIMIT 50
        ]) {
            found.add('review ' + rv.Name + ' on this version');
        }

        if (!found.isEmpty()) {
            throw gate(
                'HAS_FOREIGN_CHILDREN',
                'This version carries ' + found.size() + ' record' + (found.size() == 1 ? '' : 's') +
                ' this cockpit did not create: ' + String.join(found, '; ') +
                '. Discard never deletes what it did not make. Withdraw or remove these in Salesforce, then discard.'
            );
        }
    }

    /**
     * The restricted-delete children of a Loan that would stop the chain mid-way.
     *
     * `LLC_BI__Opportunity_History__c` is deliberately NOT here even though it carries
     * restrictedDelete: nCino mints one at loan creation, so refusing on it would refuse every
     * discard, and the 2026-09-11 manual run deleted its clones with those rows present. The four
     * below hold zero rows org-wide, which is what makes their presence a banker artefact rather
     * than org bookkeeping.
     */
    private static List<String> restrictedChildren(List<Id> members) {
        List<String> found = new List<String>();
        Integer compliance = [SELECT COUNT() FROM LLC_BI__Loan_Compliance__c WHERE LLC_BI__Loan__c IN :members WITH USER_MODE];
        if (compliance > 0) {
            found.add(compliance + ' loan compliance record' + (compliance == 1 ? '' : 's'));
        }
        Integer vehicles = [SELECT COUNT() FROM LLC_BI__Repayment_Vehicle__c WHERE LLC_BI__Loan__c IN :members WITH USER_MODE];
        if (vehicles > 0) {
            found.add(vehicles + ' repayment vehicle' + (vehicles == 1 ? '' : 's'));
        }
        Integer spreads = [SELECT COUNT() FROM LLC_BI__Spread__c WHERE LLC_BI__Loan__c IN :members WITH USER_MODE];
        if (spreads > 0) {
            found.add(spreads + ' spread' + (spreads == 1 ? '' : 's'));
        }
        Integer stats = [SELECT COUNT() FROM LLC_BI__Statistic__c WHERE LLC_BI__Loan__c IN :members WITH USER_MODE];
        if (stats > 0) {
            found.add(stats + ' statistic record' + (stats == 1 ? '' : 's'));
        }
        return found;
    }

    /**
     * Group 1: the chain rows, and the source package they point back at.
     *
     * The revision rows pointing at a version member always go. A revision-0 self-anchor goes only
     * when the same credit action minted it: the rollup that drives `hasRenewal` does not count it
     * (probe finding 3 in the class header), so deleting a pre-existing one would remove a row this
     * cockpit never created for no gain at all.
     */
    private static void buildChainGroup(Inventory inv, LLC_BI__Product_Package__c pkg, List<LLC_BI__LoanRenewal__c> chain) {
        DeleteGroup g = new DeleteGroup('delete_chain', 'LLC_BI__LoanRenewal__c', 'Remove the renewal chain rows that keep the booked parents flagged');

        Set<Id> parents = new Set<Id>();
        Map<Id, Id> sourceByParent = new Map<Id, Id>();
        Map<Id, String> sourceNames = new Map<Id, String>();

        for (LLC_BI__LoanRenewal__c j : chain) {
            add(inv, g, 'LLC_BI__LoanRenewal__c', j.Id, j.Name,
                'chain row revision ' + String.valueOf(j.LLC_BI__RevisionNumber__c) + ' linking booked facility ' +
                String.valueOf(j.LLC_BI__ParentLoanId__r == null ? null : j.LLC_BI__ParentLoanId__r.Name) +
                ' to this version. While it stands the parent reads hasRenewal true and every later roll is refused.');
            if (j.LLC_BI__ParentLoanId__c != null) {
                parents.add(j.LLC_BI__ParentLoanId__c);
                if (!inv.parentIds.contains(j.LLC_BI__ParentLoanId__c)) {
                    inv.parentIds.add(j.LLC_BI__ParentLoanId__c);
                    inv.parentNames.add(j.LLC_BI__ParentLoanId__r == null ? String.valueOf(j.LLC_BI__ParentLoanId__c) : j.LLC_BI__ParentLoanId__r.Name);
                }
                Id src = j.LLC_BI__Original_Product_Package__c != null
                    ? j.LLC_BI__Original_Product_Package__c
                    : (j.LLC_BI__ParentLoanId__r == null ? null : j.LLC_BI__ParentLoanId__r.LLC_BI__Product_Package__c);
                if (src != null) {
                    sourceByParent.put(j.LLC_BI__ParentLoanId__c, src);
                    if (j.LLC_BI__ParentLoanId__r != null && j.LLC_BI__ParentLoanId__r.LLC_BI__Product_Package__r != null) {
                        sourceNames.put(src, j.LLC_BI__ParentLoanId__r.LLC_BI__Product_Package__r.Name);
                    }
                }
            }
        }

        if (!parents.isEmpty()) {
            Datetime forkedAt = pkg.CreatedDate;
            for (LLC_BI__LoanRenewal__c j : [
                SELECT Id, Name, LLC_BI__ParentLoanId__c, LLC_BI__ParentLoanId__r.Name, LLC_BI__RenewalLoanId__c,
                       LLC_BI__RevisionNumber__c, CreatedDate
                FROM LLC_BI__LoanRenewal__c
                WHERE LLC_BI__ParentLoanId__c IN :parents
                  AND LLC_BI__RenewalLoanId__c = null
                WITH USER_MODE
            ]) {
                selfAnchor(inv, g, j, forkedAt);
            }
            for (LLC_BI__LoanRenewal__c j : [
                SELECT Id, Name, LLC_BI__ParentLoanId__c, LLC_BI__ParentLoanId__r.Name, LLC_BI__RenewalLoanId__c,
                       LLC_BI__RevisionNumber__c, CreatedDate
                FROM LLC_BI__LoanRenewal__c
                WHERE LLC_BI__ParentLoanId__c IN :parents
                  AND LLC_BI__RenewalLoanId__c IN :parents
                WITH USER_MODE
            ]) {
                selfAnchor(inv, g, j, forkedAt);
            }
        }

        Set<Id> distinctSources = new Set<Id>(sourceByParent.values());
        if (distinctSources.size() == 1) {
            inv.sourcePackageId = new List<Id>(distinctSources)[0];
            inv.sourcePackageName = sourceNames.get(inv.sourcePackageId);
        } else if (distinctSources.size() > 1) {
            inv.warnings.add(
                'This version\'s parents sit on ' + distinctSources.size() + ' different booked packages, which nCino\'s ' +
                'own model does not produce. The audit row is anchored on the version itself rather than on a source ' +
                'picked at random. Worth checking the chain before confirming.'
            );
        }
        inv.groups.add(g);
    }

    /** Adds a self-anchor row to the chain group, but only when this fork minted it. */
    private static void selfAnchor(Inventory inv, DeleteGroup g, LLC_BI__LoanRenewal__c j, Datetime forkedAt) {
        if (g.ids.contains(j.Id)) {
            return;
        }
        if (j.LLC_BI__RenewalLoanId__c != null && j.LLC_BI__RenewalLoanId__c != j.LLC_BI__ParentLoanId__c) {
            return;
        }
        if (forkedAt != null && j.CreatedDate < forkedAt) {
            inv.warnings.add(
                'Self-anchor chain row ' + j.Name + ' on ' + String.valueOf(j.LLC_BI__ParentLoanId__r == null ? null : j.LLC_BI__ParentLoanId__r.Name) +
                ' predates this version and is left in place. It does not feed the hasRenewal rollup, and it is not ours to delete.'
            );
            return;
        }
        add(inv, g, 'LLC_BI__LoanRenewal__c', j.Id, j.Name,
            'the revision-0 self anchor this fork minted on booked facility ' +
            String.valueOf(j.LLC_BI__ParentLoanId__r == null ? null : j.LLC_BI__ParentLoanId__r.Name) + '.');
    }

    /** Groups 2 to 4: the junction graph carried onto the version's own facilities. */
    private static void buildGraphGroups(Inventory inv) {
        List<Id> members = inv.memberIds;

        DeleteGroup pledges = new DeleteGroup('delete_pledges', 'LLC_BI__Loan_Collateral2__c', 'Remove the collateral pledges copied onto the version facilities');
        if (!members.isEmpty()) {
            for (LLC_BI__Loan_Collateral2__c p : [
                SELECT Id, Name, CreatedDate, LLC_BI__Collateral__r.Name FROM LLC_BI__Loan_Collateral2__c
                WHERE LLC_BI__Loan__c IN :members WITH USER_MODE
            ]) {
                inv.latestBuildRow = later(inv.latestBuildRow, p.CreatedDate);
                add(inv, pledges, 'LLC_BI__Loan_Collateral2__c', p.Id, p.Name,
                    'a pledge of ' + String.valueOf(p.LLC_BI__Collateral__r == null ? null : p.LLC_BI__Collateral__r.Name) +
                    ' copied onto this version. The asset itself and its ownership junction stay. This row must go before ' +
                    'its facility: the lookup carries restrictedDelete.');
            }
        }
        inv.groups.add(pledges);

        DeleteGroup junctions = new DeleteGroup('delete_covenant_junctions', 'LLC_BI__Loan_Covenant__c', 'Detach the covenants from the version facilities');
        if (!members.isEmpty()) {
            for (LLC_BI__Loan_Covenant__c c : [
                SELECT Id, Name FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c IN :members WITH USER_MODE
            ]) {
                add(inv, junctions, 'LLC_BI__Loan_Covenant__c', c.Id, c.Name,
                    'the junction holding a covenant on a version facility. The covenant record itself stays on the borrower.');
            }
        }
        inv.groups.add(junctions);

        DeleteGroup rates = new DeleteGroup('delete_rate_components', 'LLC_BI__Pricing_Rate_Component__c', 'Remove the pricing rate components on the version facilities');
        DeleteGroup payments = new DeleteGroup('delete_payment_components', 'LLC_BI__Pricing_Payment_Component__c', 'Remove the pricing payment components on the version facilities');
        DeleteGroup streams = new DeleteGroup('delete_pricing_streams', 'LLC_BI__Pricing_Stream__c', 'Remove the pricing streams nCino cloned onto the version facilities');
        DeleteGroup fees = new DeleteGroup('delete_fees', 'LLC_BI__Fee__c', 'Remove the fees on the version facilities');
        DeleteGroup involvements = new DeleteGroup('delete_involvements', 'LLC_BI__Legal_Entities__c', 'Remove the borrowing structure rows on the version');

        if (!members.isEmpty()) {
            for (LLC_BI__Pricing_Rate_Component__c rc : [
                SELECT Id, Name FROM LLC_BI__Pricing_Rate_Component__c WHERE cm_Loan__c IN :members WITH USER_MODE
            ]) {
                add(inv, rates, 'LLC_BI__Pricing_Rate_Component__c', rc.Id, rc.Name, 'a rate component on a version facility.');
            }
            for (LLC_BI__Pricing_Payment_Component__c pc : [
                SELECT Id, Name FROM LLC_BI__Pricing_Payment_Component__c WHERE cm_Loan__c IN :members WITH USER_MODE
            ]) {
                add(inv, payments, 'LLC_BI__Pricing_Payment_Component__c', pc.Id, pc.Name, 'a payment component on a version facility.');
            }
            for (LLC_BI__Pricing_Stream__c s : [
                SELECT Id, Name FROM LLC_BI__Pricing_Stream__c WHERE LLC_BI__Loan__c IN :members WITH USER_MODE
            ]) {
                add(inv, streams, 'LLC_BI__Pricing_Stream__c', s.Id, s.Name,
                    'a pricing stream nCino cloned onto this version. The parent facility keeps its own.');
            }
            for (LLC_BI__Fee__c f : [
                SELECT Id, Name FROM LLC_BI__Fee__c WHERE LLC_BI__Loan__c IN :members WITH USER_MODE
            ]) {
                add(inv, fees, 'LLC_BI__Fee__c', f.Id, f.Name, 'a fee on a version facility.');
            }
        }
        for (LLC_BI__Legal_Entities__c e : involvementRows(inv)) {
            add(inv, involvements, 'LLC_BI__Legal_Entities__c', e.Id, e.Name,
                'a borrowing structure row on this version. The account it names is untouched.');
        }

        inv.groups.add(rates);
        inv.groups.add(payments);
        inv.groups.add(streams);
        inv.groups.add(fees);
        inv.groups.add(involvements);
    }

    /** Entity involvements hang off the facility AND off the package, and both legs are the version's. */
    private static List<LLC_BI__Legal_Entities__c> involvementRows(Inventory inv) {
        if (inv.memberIds.isEmpty()) {
            return [
                SELECT Id, Name FROM LLC_BI__Legal_Entities__c
                WHERE LLC_BI__Product_Package__c = :inv.versionPackageId WITH USER_MODE
            ];
        }
        return [
            SELECT Id, Name FROM LLC_BI__Legal_Entities__c
            WHERE LLC_BI__Loan__c IN :inv.memberIds OR LLC_BI__Product_Package__c = :inv.versionPackageId
            WITH USER_MODE
        ];
    }

    /** Group 5: the version's own facilities. */
    private static void buildMemberGroup(Inventory inv, List<LLC_BI__Loan__c> members) {
        DeleteGroup loans = new DeleteGroup('delete_members', 'LLC_BI__Loan__c', 'Remove the version facilities');
        for (LLC_BI__Loan__c m : members) {
            add(inv, loans, 'LLC_BI__Loan__c', m.Id, m.Name,
                'a facility on this version at ' + String.valueOf(m.LLC_BI__Stage__c) +
                '. Its Loan Detail and loan documents are master-detail children and go with it.');
        }
        inv.groups.add(loans);
    }

    /**
     * Group 6: the collateral aggregate shells this version owns, which are TWO different sets.
     *
     * This group runs AFTER the facilities because the facility is the parent that holds the
     * lookup, and before the package because the package knows nothing about either.
     *
     * SET ONE, the shells the version's own facilities point at. Read off the CLONE FACILITIES and
     * nowhere else. A shell has no lookup back, so there is no other honest way to say which one
     * belonged to this version, and deriving them from the pledges would name whatever the pledges
     * happened to point at rather than what the version owned.
     *
     * SET TWO, the shells the version's CREATION minted and nothing ever used (org proof
     * 2026-09-14, backlog row 46). nCino answers every pledge insert with a collateral aggregate of
     * its own, and the clone already carries the one the carry made, so nCino's is an orphan from
     * birth: no facility points at it, no pledge points at it, and set one can therefore never see
     * it. Five were left by a single Hartwell version creation (`CreatedDate` 02:31:23Z, inside
     * ExecuteLoanModification, a minute before the discard was even staged). They are found by the
     * only handle that exists after the fact: the version's own BUILD WINDOW. Same creator as the
     * version package, `CreatedDate` between the package's own and the last row the build wrote
     * plus two minutes, no lookup key, no pledges and no value on the rollups, and referenced by
     * nothing at all. Deterministic, bounded, and never a seed row or a row anything points at.
     *
     * The sweep in `C360AggregateSweep` now stops NEW versions producing these, so set two is the
     * clean-up for versions created before it existed and the backstop for anything it misses.
     *
     * TWO REFUSALS ON SET ONE, both about ownership rather than about tidiness. A shell carrying
     * `LLC_BI__lookupKey__c` was keyed outside this cockpit (bankinggpt holds three seed rows keyed
     * that way). A shell that a facility or a pledge outside the version also points at is shared,
     * and deleting it would cascade through
     * `LLC_BI__Loan_Collateral2__c.LLC_BI__Loan_Collateral_Aggregate__c` into a stranger's pledge.
     * Both are reported as `observe_aggregates` and left standing.
     *
     * @param inv The inventory being built.
     * @param pkg The version package, which dates and signs the build window.
     * @param members The version's facilities, carrying their aggregate lookup.
     */
    private static void buildAggregateGroup(Inventory inv, LLC_BI__Product_Package__c pkg, List<LLC_BI__Loan__c> members) {
        DeleteGroup shells = new DeleteGroup(
            AGGREGATE_STEP_ID,
            'LLC_BI__Loan_Collateral_Aggregate__c',
            'Remove the collateral aggregate shells this version owns'
        );

        List<Id> candidates = new List<Id>();
        Set<Id> seen = new Set<Id>();
        for (LLC_BI__Loan__c m : members) {
            if (m.LLC_BI__Loan_Collateral_Aggregate__c != null && seen.add(m.LLC_BI__Loan_Collateral_Aggregate__c)) {
                candidates.add(m.LLC_BI__Loan_Collateral_Aggregate__c);
            }
        }
        Map<Id, LLC_BI__Loan_Collateral_Aggregate__c> owned = candidates.isEmpty()
            ? new Map<Id, LLC_BI__Loan_Collateral_Aggregate__c>()
            : new Map<Id, LLC_BI__Loan_Collateral_Aggregate__c>([
                SELECT Id, Name, LLC_BI__lookupKey__c
                FROM LLC_BI__Loan_Collateral_Aggregate__c
                WHERE Id IN :candidates
                WITH USER_MODE
            ]);
        List<LLC_BI__Loan_Collateral_Aggregate__c> orphans = orphanShells(pkg, inv, seen);

        // ONE reference pass over both sets. Set one asks "does anything OUTSIDE the version point
        // at this", because the version's own members are about to go in this same run. Set two
        // asks "does anything at all", because an orphan that is referenced is not an orphan.
        Set<Id> everything = new Set<Id>(seen);
        for (LLC_BI__Loan_Collateral_Aggregate__c o : orphans) {
            everything.add(o.Id);
        }
        Set<Id> referencedAtAll = new Set<Id>();
        Set<Id> shared = new Set<Id>();
        if (!everything.isEmpty()) {
            readReferences(everything, new Set<Id>(inv.memberIds), referencedAtAll, shared);
        }

        for (Id c : candidates) {
            LLC_BI__Loan_Collateral_Aggregate__c row = owned.get(c);
            if (row == null) {
                continue;
            }
            if (String.isNotBlank(row.LLC_BI__lookupKey__c)) {
                inv.refusedAggregates.add(
                    row.Name + ' carries lookup key ' + row.LLC_BI__lookupKey__c + ', so it was keyed outside this cockpit'
                );
                continue;
            }
            if (shared.contains(c)) {
                inv.refusedAggregates.add(
                    row.Name + ' is also pointed at from outside this version, so removing it is not this action\'s to do'
                );
                continue;
            }
            inv.aggregateIds.add(c);
            add(inv, shells, 'LLC_BI__Loan_Collateral_Aggregate__c', c, row.Name,
                'the collateral aggregate shell nCino minted for a version facility. It carries no lookup back to the ' +
                'facility, so deleting the facility alone would strand it empty.');
        }

        for (LLC_BI__Loan_Collateral_Aggregate__c o : orphans) {
            // The re-read is the proof, not the query that found it: a shell anything points at is
            // never an orphan, whatever the window says.
            if (referencedAtAll.contains(o.Id)) {
                continue;
            }
            inv.aggregateIds.add(o.Id);
            inv.orphanShellCount++;
            add(inv, shells, 'LLC_BI__Loan_Collateral_Aggregate__c', o.Id, o.Name,
                'an empty collateral aggregate shell minted while this version was being built, by the same user and ' +
                'inside the same few minutes. No facility and no pledge anywhere points at it, it carries no lookup ' +
                'key and no pledged value, so nothing but this version can account for it.');
        }

        inv.groups.add(shells);
    }

    /**
     * The empty shells born inside the version's build window, under the same identity that
     * created the version package.
     *
     * The window is the package's own `CreatedDate` to the last row the build is known to have
     * written plus two minutes, which on a resumed run collapses to the package alone because the
     * facilities and their pledges are already gone. The rollup test is the second half of the
     * definition and not decoration: a shell holding pledges or value is doing a job.
     *
     * Past `ORPHAN_SHELL_CAP` matches nothing is returned at all. A window that wide is a data
     * problem, and a delete is the wrong answer to one.
     *
     * @param pkg The version package, which dates and signs the window.
     * @param inv The inventory, carrying the window's far end and collecting the warning.
     * @param alreadyNamed Shells set one already claims, so neither set names one twice.
     * @return The candidate orphans, still to be filtered by the reference re-read.
     */
    private static List<LLC_BI__Loan_Collateral_Aggregate__c> orphanShells(
        LLC_BI__Product_Package__c pkg,
        Inventory inv,
        Set<Id> alreadyNamed
    ) {
        Datetime windowStart = pkg.CreatedDate;
        Datetime windowEnd = later(inv.latestBuildRow, pkg.CreatedDate).addSeconds(BUILD_WINDOW_TAIL_SECONDS);
        Id builtBy = pkg.CreatedById;

        List<LLC_BI__Loan_Collateral_Aggregate__c> found = new List<LLC_BI__Loan_Collateral_Aggregate__c>();
        for (LLC_BI__Loan_Collateral_Aggregate__c a : [
            SELECT Id, Name, LLC_BI__Collateral_Pledged_Count__c, LLC_BI__Total_Collateral_Value__c,
                   LLC_BI__Total_Collateral_Pledged__c
            FROM LLC_BI__Loan_Collateral_Aggregate__c
            WHERE CreatedDate >= :windowStart AND CreatedDate <= :windowEnd
              AND CreatedById = :builtBy AND LLC_BI__lookupKey__c = NULL
            WITH USER_MODE
        ]) {
            if (alreadyNamed.contains(a.Id) || !C360AggregateSweep.isEmptyShell(a)) {
                continue;
            }
            found.add(a);
        }
        if (found.size() > ORPHAN_SHELL_CAP) {
            inv.refusedAggregates.add(
                found.size() + ' empty shells sit inside this version\'s build window, past the ' + ORPHAN_SHELL_CAP +
                ' this action will clear. None of them was frozen: a window that crowded is a data question rather ' +
                'than a discard'
            );
            return new List<LLC_BI__Loan_Collateral_Aggregate__c>();
        }
        return found;
    }

    /**
     * One pass over both things that can point at a shell.
     *
     * @param ids The shells being judged.
     * @param members The version's own facilities, which are about to be deleted in this same run.
     * @param referencedAtAll Filled with every shell anything points at.
     * @param shared Filled with every shell something OUTSIDE the version points at.
     */
    private static void readReferences(Set<Id> ids, Set<Id> members, Set<Id> referencedAtAll, Set<Id> shared) {
        for (LLC_BI__Loan__c l : [
            SELECT Id, LLC_BI__Loan_Collateral_Aggregate__c
            FROM LLC_BI__Loan__c
            WHERE LLC_BI__Loan_Collateral_Aggregate__c IN :ids
            WITH USER_MODE
        ]) {
            referencedAtAll.add(l.LLC_BI__Loan_Collateral_Aggregate__c);
            if (!members.contains(l.Id)) {
                shared.add(l.LLC_BI__Loan_Collateral_Aggregate__c);
            }
        }
        for (LLC_BI__Loan_Collateral2__c p : [
            SELECT LLC_BI__Loan__c, LLC_BI__Loan_Collateral_Aggregate__c
            FROM LLC_BI__Loan_Collateral2__c
            WHERE LLC_BI__Loan_Collateral_Aggregate__c IN :ids
            WITH USER_MODE
        ]) {
            referencedAtAll.add(p.LLC_BI__Loan_Collateral_Aggregate__c);
            if (!members.contains(p.LLC_BI__Loan__c)) {
                shared.add(p.LLC_BI__Loan_Collateral_Aggregate__c);
            }
        }
    }

    /** The later of two moments, with null reading as "no answer yet". */
    private static Datetime later(Datetime a, Datetime b) {
        if (a == null) {
            return b;
        }
        if (b == null) {
            return a;
        }
        return a > b ? a : b;
    }

    /** Group 7: the version package itself. */
    private static void buildPackageGroup(Inventory inv, LLC_BI__Product_Package__c pkg) {
        DeleteGroup packages = new DeleteGroup('delete_package', 'LLC_BI__Product_Package__c', 'Remove the version package');
        add(inv, packages, 'LLC_BI__Product_Package__c', pkg.Id, pkg.Name, 'the version package itself.');
        inv.groups.add(packages);
    }

    /**
     * Group 8: the trail. These rows are NOT deleted. They are the audit of what the banker asked
     * for, and an audit that disappears with the thing it audited is not an audit.
     *
     * TWO WAYS A TRAIL ROW BELONGS TO A VERSION, and until 2026-09-13 this read only the first
     * (backlog row 45, org proof C). A row ANCHORED on the version carries it in
     * `cm_Product_Package__c`, which is every action a banker ran inside the version. But the action
     * that CREATED the version - the loan modification that filed it - is anchored on the SOURCE
     * package, because that is the package the banker was looking at when they asked; what ties it
     * to the version is its RESULT, `cm_Result_Record_Id__c`, which holds one of the loans the
     * discard is about to delete. Leaving it at Completed meant the row that filed a version nobody
     * can open any more still read as a finished piece of work.
     *
     * The union is computed HERE rather than at execute time so the plan's count, its warning and
     * its `withdraw_trail` step all promise what the run will actually do, and so the set survives a
     * resume: by the time a stopped run is continued the version loans may already be gone, and a
     * fresh query on their ids would find nothing.
     *
     * This action's own staging row is excluded by construction when a source package exists
     * (it anchors there), and by id when it does not.
     */
    private static void buildTrail(Inventory inv) {
        Set<Id> found = new Set<Id>();
        for (cm_Action_Staging__c s : [
            SELECT Id, Name, cm_Action_Id__c, cm_Status__c
            FROM cm_Action_Staging__c
            WHERE cm_Product_Package__c = :inv.versionPackageId
              AND cm_Action_Id__c != :ACTION_ID
            WITH USER_MODE
        ]) {
            found.add(s.Id);
        }

        // `cm_Result_Record_Id__c` is text, so the ids are compared as the strings the field holds.
        List<String> memberKeys = new List<String>();
        for (Id m : inv.memberIds) {
            memberKeys.add(String.valueOf(m));
        }
        if (!memberKeys.isEmpty()) {
            for (cm_Action_Staging__c s : [
                SELECT Id, Name, cm_Action_Id__c, cm_Status__c, cm_Result_Record_Id__c
                FROM cm_Action_Staging__c
                WHERE cm_Result_Record_Id__c IN :memberKeys
                  AND cm_Action_Id__c != :ACTION_ID
                WITH USER_MODE
            ]) {
                found.add(s.Id);
            }
        }
        inv.stagingRowIds.addAll(found);
    }

    /** Warnings the banker must read before confirming a delete. */
    private static void buildWarnings(Inventory inv) {
        inv.warnings.add(
            'This action DELETES ' + inv.itemCount() + ' record' + (inv.itemCount() == 1 ? '' : 's') +
            '. Nothing outside the list above is touched: the booked package, the booked facilities, the collateral ' +
            'assets and their ownership junctions, and the covenant records all stay exactly as they are.'
        );
        if (!inv.parentNames.isEmpty()) {
            inv.warnings.add(
                'After the discard, ' + String.join(inv.parentNames, ', ') + ' will read hasRenewal false and be ' +
                'available to fork again. That is verified by re-query, not assumed.'
            );
        }
        if (inv.openHistoryRows > 0) {
            inv.warnings.add(
                inv.openHistoryRows + ' Opportunity History row' + (inv.openHistoryRows == 1 ? '' : 's') +
                ' hang off the version facilities. nCino mints those at facility creation and clears them on its own ' +
                'delete path; they are not deleted by this action. If the org keeps one, the facility delete stops there ' +
                'and this action reports exactly what is gone and what remains.'
            );
        }
        Integer pledgeCount = countIn(inv, 'LLC_BI__Loan_Collateral2__c');
        if (pledgeCount > PLEDGE_WARNING_THRESHOLD) {
            inv.warnings.add(
                'This version carries ' + pledgeCount + ' pledges. PDI-00015762 records nCino\'s own rollback breaking past ' +
                PLEDGE_WARNING_THRESHOLD + ' collateral rows. This chain is ours rather than nCino\'s, and it deletes the ' +
                'pledges before the facilities for that reason, but the run is worth watching.'
            );
        }
        if (!inv.aggregateIds.isEmpty()) {
            Integer owned = inv.aggregateIds.size() - inv.orphanShellCount;
            inv.warnings.add(
                inv.aggregateIds.size() + ' collateral aggregate shell' + (inv.aggregateIds.size() == 1 ? '' : 's') +
                ' go with this version: ' + owned + ' that its facilities point at, and ' + inv.orphanShellCount +
                ' that its creation minted and nothing ever used. A shell is a per-facility rollup anchor with no ' +
                'lookup back, so leaving one behind leaves an empty row for good.'
            );
        }
        if (!inv.refusedAggregates.isEmpty()) {
            inv.warnings.add(
                inv.refusedAggregates.size() + ' collateral aggregate shell' + (inv.refusedAggregates.size() == 1 ? '' : 's') +
                ' on these facilities ' + (inv.refusedAggregates.size() == 1 ? 'is' : 'are') + ' LEFT STANDING: ' +
                String.join(inv.refusedAggregates, '; ') + '.'
            );
        }
        if (!inv.stagingRowIds.isEmpty()) {
            inv.warnings.add(
                inv.stagingRowIds.size() + ' action trail row' + (inv.stagingRowIds.size() == 1 ? '' : 's') +
                ' belonging to this version ' + (inv.stagingRowIds.size() == 1 ? 'is' : 'are') + ' KEPT and marked ' + WITHDRAWN +
                '. That is every row anchored on the version AND the row that FILED it, which is anchored on the source ' +
                'package and named one of these facilities as its result. The trail is the audit and is never deleted.'
            );
        }
        if (!inv.withdrawnAvailable) {
            inv.warnings.add(
                'cm_Action_Staging__c.cm_Status__c does not offer ' + WITHDRAWN + ' in this org and is a restricted picklist ' +
                '(Staged, Executing, Completed, Partial, Failed). The trail rows will be LEFT AS THEY STAND rather than ' +
                'stamped with a status that means something else, and this run will report partial for that reason. Add ' +
                WITHDRAWN + ' to the picklist to close it.'
            );
        }
        if (inv.sourcePackageId == null) {
            inv.warnings.add(
                'This version has no booked source package, so the audit row is anchored on the version itself. That is ' +
                'the expected shape for a package this cockpit created outright rather than forked.'
            );
        }
        // The other half of that shape, said plainly (backlog 58). A package the cockpit created
        // has no parent to return to: there is no chain to unpick and no hasRenewal flag to clear,
        // so the discard removes the package and everything filed on it and the relationship is
        // simply left without it. The banker reads the evidence that makes it discardable at all.
        if (inv.creationEvidence != null) {
            inv.warnings.add(
                'This credit package was created by this cockpit, on action trail row ' + inv.creationEvidence +
                '. It was never forked from a booked package, so there are no booked parents to restore and no ' +
                'renewal chain to unpick: the discard removes the package, its ' + inv.memberIds.size() + ' facilit' +
                (inv.memberIds.size() == 1 ? 'y' : 'ies') + ' and everything filed on them, and the relationship is ' +
                'left without it. The collateral assets, the covenant records and the accounts they name all stay.'
            );
        }
    }

    // ---------------------------------------------------------------------------------------
    // Plan assembly.
    // ---------------------------------------------------------------------------------------

    /**
     * Turns the inventory into the ordered plan: one write step per delete group, one verification
     * step after each, and the trail step last.
     *
     * @param inv The discovered inventory.
     * @return The ordered steps.
     */
    private static List<C360Plan.Step> planSteps(Inventory inv) {
        List<C360Plan.Step> steps = new List<C360Plan.Step>();
        for (DeleteGroup g : inv.groups) {
            steps.add(
                new C360Plan.Step(g.stepId, C360Plan.TYPE_WRITE, g.label + ' (' + g.ids.size() + ')')
                    .onObject(g.objectName, new List<String>{ 'Id' })
                    .wakes(new List<String>{ 'nCino managed delete handling on ' + g.objectName })
                    .provenBy('SELECT COUNT() FROM ' + g.objectName + ' WHERE Id IN :planned')
            );
            steps.add(
                new C360Plan.Step(g.stepId + '_verify', C360Plan.TYPE_VERIFICATION, 'Confirm every ' + g.objectName + ' in this group is gone')
                    .onObject(g.objectName, new List<String>{ 'Id' })
                    .provenBy('SELECT COUNT() FROM ' + g.objectName + ' WHERE Id IN :planned')
            );
        }
        steps.add(
            new C360Plan.Step('verify_parents', C360Plan.TYPE_VERIFICATION, 'Confirm every booked parent reads hasRenewal false')
                .onObject('LLC_BI__Loan__c', new List<String>{ 'LLC_BI__hasRenewal__c', 'LLC_BI__Number_Of_Renewals__c' })
                .provenBy('SELECT Id, Name, LLC_BI__hasRenewal__c, LLC_BI__Number_Of_Renewals__c FROM LLC_BI__Loan__c WHERE Id IN :parents')
        );
        steps.add(
            new C360Plan.Step('verify_version_gone', C360Plan.TYPE_VERIFICATION, 'Confirm the version package id no longer resolves')
                .onObject('LLC_BI__Product_Package__c', new List<String>{ 'Id' })
                .provenBy('SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionPackageId')
        );
        steps.add(
            new C360Plan.Step('withdraw_trail', C360Plan.TYPE_WRITE, 'Mark the version\'s action trail rows ' + WITHDRAWN + ' (' + inv.stagingRowIds.size() + ')')
                .onObject('cm_Action_Staging__c', new List<String>{ 'cm_Status__c' })
                .provenBy('SELECT Id, cm_Status__c FROM cm_Action_Staging__c WHERE Id IN :trail')
        );
        steps.add(
            new C360Plan.Step(
                'observe_aggregates',
                C360Plan.TYPE_OBSERVED,
                'Collateral aggregate shells left standing (' + inv.refusedAggregates.size() + ')'
            ).wakes(new List<String>{ 'LLC_BI__ColPledgesAutoUpdater' })
        );
        return steps;
    }

    /**
     * The values the plan hash binds to. The whole inventory rides along, so a plan that executed
     * against a different set of records than the banker confirmed produces a different hash.
     *
     * @param inv The discovered inventory.
     * @return Resolved values, keyed for the hash.
     */
    private static Map<String, Object> resolvedValues(Inventory inv) {
        List<String> ids = new List<String>();
        for (Item i : inv.items) {
            ids.add(i.objectName + ':' + i.recordId);
        }
        ids.sort();
        List<String> trail = new List<String>();
        for (Id t : inv.stagingRowIds) {
            trail.add(String.valueOf(t));
        }
        trail.sort();
        List<String> parents = new List<String>();
        for (Id p : inv.parentIds) {
            parents.add(String.valueOf(p));
        }
        parents.sort();
        // The shells are hashed as their own bucket AND ride in `inventory` as items, because the
        // execute needs them by themselves: once the facilities are gone nothing points at a shell.
        List<String> aggregates = new List<String>();
        for (Id a : inv.aggregateIds) {
            aggregates.add(String.valueOf(a));
        }
        aggregates.sort();
        return new Map<String, Object>{
            'versionPackageId' => String.valueOf(inv.versionPackageId),
            'sourcePackageId' => inv.sourcePackageId == null ? '' : String.valueOf(inv.sourcePackageId),
            'accountId' => String.valueOf(inv.accountId),
            'itemCount' => String.valueOf(inv.items.size()),
            'inventory' => String.join(ids, ','),
            'trail' => String.join(trail, ','),
            'parents' => String.join(parents, ','),
            'aggregates' => String.join(aggregates, ',')
        };
    }

    private static Map<String, Object> provenanceOf(Inventory inv) {
        return new Map<String, Object>{
            'inventory' => new Map<String, String>{
                'prefill' => 'COMPUTED',
                'provenance' => 'NCINO',
                'citation' => 'Discovered by query from version package ' + inv.versionPackageId + ' at stage time.'
            },
            'sourcePackageId' => new Map<String, String>{
                'prefill' => 'COMPUTED',
                'provenance' => 'DERIVED',
                'citation' => 'Read off LLC_BI__LoanRenewal__c.LLC_BI__Original_Product_Package__c, falling back to the booked parent\'s own package.'
            }
        };
    }

    private static String summaryOf(Inventory inv) {
        String source = inv.sourcePackageId == null
            ? 'This version has no booked source, so the relationship is left without it.'
            : 'The relationship returns to booked package ' +
              (inv.sourcePackageName == null ? String.valueOf(inv.sourcePackageId) : inv.sourcePackageName) + ' only.';
        return 'Discards version ' + inv.versionPackageName + ' on ' + String.valueOf(inv.accountName) + ': deletes ' +
            inv.itemCount() + ' record' + (inv.itemCount() == 1 ? '' : 's') + ' across ' + inv.groups.size() +
            ' groups, including ' + inv.memberIds.size() + ' version facilit' + (inv.memberIds.size() == 1 ? 'y' : 'ies') +
            ' and the version package, and keeps ' + inv.stagingRowIds.size() + ' action trail row' +
            (inv.stagingRowIds.size() == 1 ? '' : 's') + ' marked ' + WITHDRAWN + '. ' + source +
            ' Nothing booked is touched.';
    }

    // ---------------------------------------------------------------------------------------
    // Shared helpers, reused by ExecuteDiscardVersion.
    // ---------------------------------------------------------------------------------------

    /**
     * The rung a Loan stage sits on, or -1 for a stage this org does not name.
     *
     * An unknown stage is never ranked against a known one. Callers treat -1 as "cannot tell" and
     * refuse, rather than as "early" and proceed.
     *
     * @param stage The Loan stage value.
     * @return The zero-based rung, or -1.
     */
    public static Integer rung(String stage) {
        if (String.isBlank(stage)) {
            return -1;
        }
        String needle = stage.trim().toLowerCase();
        for (Integer i = 0; i < STAGE_LADDER.size(); i++) {
            if (STAGE_LADDER[i].toLowerCase() == needle) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Maps the inventory items onto the invocable wire shape.
     *
     * @param items The discovered items.
     * @return The wire items, in inventory order.
     */
    private static List<InventoryItem> toWireItems(List<Item> items) {
        List<InventoryItem> out = new List<InventoryItem>();
        for (Item i : items) {
            InventoryItem w = new InventoryItem();
            w.objectName = i.objectName;
            w.recordId = String.valueOf(i.recordId);
            w.name = i.name;
            w.reason = i.reason;
            out.add(w);
        }
        return out;
    }

    private static Integer countIn(Inventory inv, String objectName) {
        Integer n = 0;
        for (Item i : inv.items) {
            if (i.objectName == objectName) {
                n++;
            }
        }
        return n;
    }

    private static void add(Inventory inv, DeleteGroup g, String objectName, Id recordId, String name, String reason) {
        g.ids.add(recordId);
        inv.items.add(new Item(objectName, recordId, name, reason));
    }

    private static GateException gate(String code, String message) {
        GateException e = new GateException(message);
        e.code = code;
        return e;
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
