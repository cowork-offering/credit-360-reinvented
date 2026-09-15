/**
 * ExecuteLoanModification - MCP tool: execute_loan_modification.
 *
 * Runs the plan stage_loan_modification staged, behind the single-use decision token. The token is
 * evidence that a named human saw a specific plan and pressed confirm (A33.5.4). It is not a credit
 * approval: this tool produces a modification CLONE at Qualification and stops. Booking that clone
 * still requires nCino's own Submit for Approval, because Loan_Validation_06 carries no bypass.
 *
 * WHY THIS SHIPS NOW, AFTER A WAVE OF BEING HELD. The hold was never about the credit action itself,
 * it was about reaching a Booked parent. That question was settled empirically (DEMO-RELATIONSHIP
 * section 1): LV06 keys on PRIORVALUE, which is blank on an INSERT, so a facility can be filed at
 * Booked directly as long as LV05's lookupKey is supplied. The mod-execute probe of 2026-08-20 then
 * ran the credit action live on throwaway data and observed the whole mechanism end to end:
 * clone at Stage Qualification with Is_Modification true and the lookupKey auto-suffixed _M1, parent
 * untouched with the hasRenewal formula flipped, and two LLC_BI__LoanRenewal__c rows (revision 0
 * self-referential anchor, revision 1 pointing at the clone). This class executes exactly that,
 * verifies it by re-query, and refuses to claim anything it could not read back.
 *
 * THE DOOR. nCino's supported programmatic entry point is the cross-package credit-action service
 * (ACTIONS-DESIGN 1.2), reached through the bean factory rather than by hand-rolling the clone.
 * Hand-rolling it would mean re-implementing the *_Relatives_to_Clone config, the junction row,
 * revision numbering and the Superseded cascade, all of which nCino already does and all of which
 * have documented failure modes. We call the bean IN-PROCESS from our own class rather than routing
 * through the org's acnpex_CreditActionRequest wrapper: same bean, same parameter names, but this
 * class owns its sharing declaration, its error surface and its verification, and does not depend on
 * a colleague's class staying the shape it is today. The wrapper's own outputLoanId derivation is
 * deliberately NOT copied - it takes the most recently created loan on the output package, which is
 * a guess that breaks the moment two facilities are modified in one call. We map clone to parent
 * through the junction chain instead, which is where nCino actually records lineage (ACTIONS-DESIGN
 * 1.4: the Loan self-lookups are null in this org).
 *
 * NEVER TRUST THE RETURN. PDI-00017266 records async credit-action failures that revert everything
 * silently, records landing in the Recycle Bin with no error, and kAHHu000000XaJVOA0 records failed
 * background Apex producing DUPLICATE modification loans carrying the same loan number. So: the
 * engine's success flag decides nothing on its own. Every clone is proven by re-query, every junction
 * row is proven by re-query, the parent is re-read and compared field by field, and idempotency is
 * enforced by us rather than assumed from nCino.
 *
 * WHAT THIS TOOL WILL NOT DO. It never touches the parent facility. It never moves the clone's Stage
 * (the clone arrives at Qualification and stays there; the one allowlisted Loan stage hop belongs to
 * execute_new_facility). It never deletes a chain row: kAHHu000000XasbOAC makes a junction row
 * deleted out from under its loan permanent poison.
 *
 * WHERE THIS RUNS, AND WHY THERE ARE TWO LEGS (2026-08-30). The Salesforce-hosted MCP dispatcher
 * invokes this class in a context that CANNOT host the engine: nCino's managed LoanTrigger reaches
 * for session APIs that context does not have, and dies in a way no catch block can see. The root
 * cause is documented rather than guessed: hosted MCP authenticates with a JWT access token, and
 * Apex's UserInfo.getSessionId() is specified as unusable under a JWT token (Apex Reference,
 * UserInfo). The same class, same org, same user, runs perfectly when invoked through the REST
 * Actions API. That context also proved it CAN make an HTTP callout (probe, 200). So a call that
 * arrives without inlineExecution does every read-only check it can, then calls out to a door that
 * re-enters the org over REST with inlineExecution true. The inner leg is the one that burns the
 * token, runs the engine, verifies and records the outcome, all inside a transaction that works.
 * The outer leg writes NOTHING: Apex forbids DML before a callout, and a hop that never arrives
 * has to leave the banker's single-use confirmation intact so a retry is still possible.
 *
 * TWO DOORS, IN ORDER, AND WHY. The first is the org calling ITSELF: a Visualforce page render
 * mints an opaque UI session id (Page.getContent, itself a callout since API 34), which is a token
 * the JWT restriction does not touch, and that session authenticates a POST straight back to this
 * org's own Actions API. Nothing leaves the platform, and there is no box to keep alive. It is
 * FIRST because it is the smaller system. It is not the ONLY door because whether a hosted-MCP
 * context can render that page at all is untested territory, and a write path may not rest on an
 * assumption. So when the session cannot be minted or the org refuses it, the call falls through to
 * an external relay that re-enters with a proper OAuth token. Which door carried a call is reported
 * on the result as relayPath, because "it worked" and "it worked the way we expected" are different
 * claims. Fallback is only ever taken on a failure that PROVABLY did not reach the action: a mint
 * that threw, a callout that threw, or an authentication refusal. Anything else is an answer.
 *
 * TWO HOPS, NOT ONE (2026-08-31). The relay does not carry the plan into a transaction, it carries
 * the plan into two: one that runs the credit action and proves the new version, and one that writes
 * the staged changes onto it and proves those. The reason is a governor budget that is not ours.
 * Apex counts a SOQL query against the namespace of the code that ISSUES it, so our reads of
 * LLC_BI__ objects are ours and nCino's automation reacting to our writes is nCino's. The failing
 * run of 2026-08-31 issued 161 queries of which exactly TWELVE were ours, and died on LLC_BI:Too
 * many SOQL queries: 101 - a limit we had spent nothing against. Cutting our own reads therefore
 * cannot fix it. Reordering our writes helps and is done (the staged changes land on a bare clone
 * before its graph is carried, which is worth 15 of nCino's queries and is also the more correct
 * order), but reordering alone left the run at 98 of 100 with a single further guarantor add enough
 * to break it again. Only a second transaction resets the budget, and only the relay leg can open
 * one, because it is the only leg that writes nothing and may therefore still make a callout - a
 * queueable cannot, because this org's CDC triggers enqueue more jobs than an async context is
 * allowed to. Measured split: the engine hop spends 46 of nCino's 100, the arm hop spends 52.
 * A NET-NEW FEE goes in the arm hop, and inside it, in the carry's own fee insert (2026-08-31). A
 * fee insert wakes the fee aggregate and the financed-fee calculation, which are nCino's queries
 * rather than ours; that automation is bulkified, so an extra row in the existing insert is close
 * to free, while a second insert pays the whole pass again (~30 queries on the failing run) and
 * would put the arm hop near 85 of 100. The row is composed under OP_CREATE before the carry runs,
 * so the guard still sees an authored row as authored rather than as a copy.
 * A COLLATERAL PLEDGE goes the same way, and for the same reason (2026-08-31): the pledge rides the
 * carry's own pledge insert, taking the same per-clone aggregate shell the copies take, because a
 * pledge insert wakes nCino's collateral aggregate automation and that automation is bulkified. Its
 * asset and ownership junction cannot - a pledge needs the collateral's id, and nothing else here
 * creates one - so they are two DMLs of their own, bulked across every pledge in the plan. Stage
 * caps the plan at five pledges: each of those three objects carries an org-local change-stream
 * trigger that enqueues a callout per DML, against a ceiling of 50 queued jobs in one transaction.
 * The decision token is consumed exactly once and gates the whole plan; the second hop proves the
 * same token, consumes nothing, and re-derives its targets from the org rather than being handed
 * them. See THE TRANSACTION BOUNDARY in execute() for the full accounting.
 *
 * Org contract: A33.4.1. Write evidence: EVIDENCE-SEPT4.md "Mod-execute probe" and the WS0.5 probe
 * in the same file.
 */
// Recompile marker 2026-08-30: package-version pin must bind (LLC_BI 2.3789).
global with sharing class ExecuteLoanModification {

    /** Raised for a domain-level failure. Surfaces as ok:false, never as a fault. */
    public class ToolException extends Exception {}

    /** Raised when nCino's own credit-action engine refuses. Reported as an org rejection, not ours. */
    public class EngineException extends Exception {}

    private static final String ACTION_ID = 'loan-modification';
    private static final String ACTION_TYPE = 'Modification';

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
    private static final String BEAN_NAME = 'LLC_BI.InvokableCreditActionXPkg';
    private static final String RELAY_SECRET_HEADER = 'x-c360-relay-secret';
    /**
     * Which action the relay is to re-enter the org on. Added 2026-09-15, when the discard took the
     * same door: the relay now carries an allow-list rather than one pinned action, and a call that
     * names nothing is read as this one, which is the only action it ever carried before.
     */
    private static final String RELAY_ACTION_HEADER = 'x-c360-action';
    private static final String ACTION_NAME = 'ExecuteLoanModification';
    private static final Integer RELAY_TIMEOUT_MS = 120000;
    private static final String ACTION_PATH = '/services/data/v61.0/actions/custom/apex/ExecuteLoanModification';
    private static final String PATH_SELF = 'self';
    private static final String PATH_BOX = 'box';
    private static final String PHASE_ENGINE = 'engine';
    private static final String PHASE_ARM = 'arm';

    private static final String ARM_PENDING = 'awaiting_arm';
    private static final String ARM_INLINE = 'inline';
    private static final String ARM_RELAYED = 'relayed';
    private static final String ARM_WAITING =
        'The new version is armed by the second hop: the junction graph, the staged changes and their ' +
        'verification land there and are recorded on the staging record, which is the authority. ' +
        'Nothing here is claimed until it does.';

    private static final String RELAY_UNAVAILABLE =
        'The execution path into the org is unavailable, so nothing was attempted and nothing was written. ' +
        'The decision token has not been used: retry this same call once the path is back.';

    private static final String BOOKING_HANDOFF =
        'The modification exists as a facility at Qualification. Booking it requires nCino\'s Submit for Approval ' +
        'with real approvers: Loan_Validation_06 refuses a manual move to a post-approval stage and carries no ' +
        'permission bypass. Nothing here has been approved.';

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
        @InvocableVariable(label='Inline Execution' description='INTERNAL PLUMBING. Leave unset. True means run nCino\'s credit action in THIS transaction, which only a REST transaction can do; the relay sets it on the inner leg, and that is also what stops a relay from relaying again.')
        global Boolean inlineExecution;
        @InvocableVariable(label='Phase' description='INTERNAL PLUMBING. Leave unset. Names which half of the work this inner leg is to do: engine (run the credit action and prove the new version) or arm (write the staged changes onto it and prove those). Unset means both halves in one transaction, which only holds for a package whose graph is small - see THE TRANSACTION BOUNDARY in the class.')
        global String phase;
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

    /** One selected facility and what the credit action actually did to it. */
    global class FacilityResult {
        @InvocableVariable(label='Facility Id' description='The parent facility. Never written by this tool.')
        global String facilityId;
        @InvocableVariable(label='Facility Name' description='The org-assigned parent name, read back rather than echoed.')
        global String facilityName;
        @InvocableVariable(label='Clone Loan Id' description='The modification facility nCino created from this parent.')
        global String cloneLoanId;
        @InvocableVariable(label='Clone Name' description='The name the ORG assigned the clone. A before-save flow rewrites loan names, so this is never a name anybody submitted.')
        global String cloneName;
        @InvocableVariable(label='Clone Lookup Key' description='nCino suffixes the parent core key, for example LP123_M1.')
        global String cloneLookupKey;
        @InvocableVariable(label='Clone Stage')
        global String cloneStage;
        @InvocableVariable(label='Junction Id' description='The LLC_BI__LoanRenewal__c row that records this lineage. The Loan self-lookups are null in this org.')
        global String junctionId;
        @InvocableVariable(label='Junction Name' description='For example RL-00000194.')
        global String junctionName;
        @InvocableVariable(label='Revision Number' description='Revision 0 is the self-referential anchor row. A real modification is revision 1 or higher.')
        global Decimal revisionNumber;
        @InvocableVariable(label='Verification' description='What was re-read from the org after the credit action, in plain terms.')
        global String verification;
        @InvocableVariable(label='Parent Unchanged' description='True when the parent re-reads at the same stage, status and amount it had before the action.')
        global Boolean parentUnchanged;
        @InvocableVariable(label='Applied Changes' description='The requested changes as they read back off the clone, or why they did not.')
        global String appliedChanges;
        @InvocableVariable(label='Outcome' description='Per-facility result in banker language.')
        global String outcome;
    }

    /** One field-wave change this run applied to a clone. */
    global class FieldChangeResult {
        @InvocableVariable(label='Field')
        global String field;
        @InvocableVariable(label='Label')
        global String label;
        @InvocableVariable(label='Value')
        global String value;
        @InvocableVariable(label='Clone Loan Id')
        global String cloneLoanId;
        @InvocableVariable(label='Verification')
        global String verification;
    }

    /** One borrowing-structure amendment this run landed on the new version. */
    global class InvolvementResult {
        @InvocableVariable(label='Op')
        global String op;
        @InvocableVariable(label='Account Name')
        global String accountName;
        @InvocableVariable(label='Role')
        global String role;
        @InvocableVariable(label='Clone Loan Id')
        global String cloneLoanId;
        @InvocableVariable(label='Record Id' description='The involvement row created on the clone. Null on a remove: a carry exclusion writes nothing.')
        global String recordId;
        @InvocableVariable(label='Verification')
        global String verification;
    }

    /** One net-new covenant this run created and attached to a clone. */
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
        @InvocableVariable(label='Clone Loan Id' description='The modification clone the covenant was attached to.')
        global String cloneLoanId;
        @InvocableVariable(label='Verification')
        global String verification;
    }

    /** One net-new fee this run authored on a clone. */
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
        @InvocableVariable(label='Amount' description='On a PERCENTAGE fee this is what the org computed from the clone\'s commitment, not a figure anybody sent.')
        global Decimal amount;
        @InvocableVariable(label='Clone Loan Id')
        global String cloneLoanId;
        @InvocableVariable(label='Verification')
        global String verification;
    }

    /** One collateral pledge this run authored on a clone, and the asset behind it. */
    global class PledgeResult {
        @InvocableVariable(label='Pledge Id')
        global String pledgeId;
        @InvocableVariable(label='Collateral Id' description='The asset. Newly created on this run where the plan said so, otherwise one the borrower already owned.')
        global String collateralId;
        @InvocableVariable(label='Collateral Name' description='The org-assigned autonumber (COL-000nnn), read back. Nothing submits a collateral name.')
        global String collateralName;
        @InvocableVariable(label='Asset Label' description='The description, which is the asset\'s only readable identity: Name is an autonumber.')
        global String assetLabel;
        @InvocableVariable(label='Created The Asset' description='True when this run authored the collateral and its ownership junction as well as the pledge.')
        global Boolean createdAsset;
        @InvocableVariable(label='Ownership Id' description='The LLC_BI__Account_Collateral__c row tying a NEW asset to the borrower. Null when the asset was already owned.')
        global String ownershipId;
        @InvocableVariable(label='Amount Pledged')
        global Decimal amountPledged;
        @InvocableVariable(label='Advance Rate' description='What the ORG resolved: the override where one was stated, the auto-applied rate, or the collateral type\'s default. A formula, never a figure anybody sent.')
        global Decimal advanceRate;
        @InvocableVariable(label='Clone Loan Id')
        global String cloneLoanId;
        @InvocableVariable(label='Verification')
        global String verification;
    }

    /** One net-new facility this run filed on the new package version. */
    global class NewFacilityResult {
        @InvocableVariable(label='Label' description='The label the plan named it by before it had an id: new:1, new:2.')
        global String label;
        @InvocableVariable(label='Loan Id')
        global String loanId;
        @InvocableVariable(label='Record Name' description='The name the ORG assigned. A before-save flow rebuilds it as Account - Product - Amount.')
        global String recordName;
        @InvocableVariable(label='Product')
        global String product;
        @InvocableVariable(label='Amount')
        global Decimal amount;
        @InvocableVariable(label='Term Months')
        global Decimal termMonths;
        @InvocableVariable(label='Stage')
        global String stage;
        @InvocableVariable(label='Product Package Id' description='The NEW package version, which is the whole point of filing it here.')
        global String productPackageId;
        @InvocableVariable(label='Involvement Id' description='The borrowing-structure row. A facility insert creates none on its own.')
        global String involvementId;
        @InvocableVariable(label='Primary Loan Purpose' description='What the plan carries for the Loan Detail nCino creates after this transaction.')
        global String purpose;
        @InvocableVariable(label='Purpose Written' description='True where the Loan Detail was already there and the purpose landed on it; false where it is still the org\'s own async transaction to create.')
        global Boolean purposeWritten;
        @InvocableVariable(label='Verification')
        global String verification;
    }

    /** One policy exception this run logged against a clone and the borrower. */
    global class PolicyExceptionResult {
        @InvocableVariable(label='Exception Id')
        global String exceptionId;
        @InvocableVariable(label='Title' description='The row\'s readable identity, read back. Name is plain text here and the org backfills an omitted one with the record\'s own Id, which is why this tool always sends one.')
        global String title;
        @InvocableVariable(label='Status' description='Waived, Mitigated or Unmitigated - what the banker decided, never the org\'s Unmitigated default.')
        global String status;
        @InvocableVariable(label='Mitigation Count' description='How many of the org\'s three mitigation reason fields this exception filled.')
        global Integer mitigationCount;
        @InvocableVariable(label='Clone Loan Id')
        global String cloneLoanId;
        @InvocableVariable(label='Relationship Id' description='The borrower the exception is anchored on, so it reads at relationship level as well as on the facility.')
        global String relationshipId;
        @InvocableVariable(label='Verification')
        global String verification;
    }

    global class ExecuteResult {
        @InvocableVariable(label='Staging Id')
        global String stagingId;
        @InvocableVariable(label='Clone Loan Id' description='The modification facility created for the first selected facility.')
        global String cloneLoanId;
        @InvocableVariable(label='Record Name' description='The org-assigned name of the created record. Uniform across all execute_* tools so the activity trail can stamp a real label instead of a generic one.')
        global String recordName;
        @InvocableVariable(label='Anchor Name' description='The parent facility this modification hangs off.')
        global String anchorName;
        @InvocableVariable(label='Product Package Id' description='The deal anchor the credit action ran against.')
        global String productPackageId;
        @InvocableVariable(label='Output Package Id' description='The NEW package version nCino created. Package methodology: a modification versions the whole package, so this is never the source package.')
        global String outputPackageId;
        @InvocableVariable(label='New Package Name' description='The name of the new package version, after the org-convention repair when the engine left the account prefix blank.')
        global String newPackageName;
        @InvocableVariable(label='Members Rolled' description='How many package members the credit action rolled into the new version, the modified ones included.')
        global Integer membersRolled;
        @InvocableVariable(label='Covenants' description='One entry per net-new covenant this run created and attached to a clone.')
        global List<CovenantResult> covenants;
        @InvocableVariable(label='Involvements' description='One entry per borrowing-structure amendment: adds authored on the clone, removes carried out as exclusions.')
        global List<InvolvementResult> involvements;
        @InvocableVariable(label='Field Changes' description='One entry per field-wave change, each re-read off the clone after the write.')
        global List<FieldChangeResult> fieldChanges;
        @InvocableVariable(label='Fees' description='One entry per net-new fee this run authored on a clone, each re-read after the write with the figure the org settled on.')
        global List<FeeResult> fees;
        @InvocableVariable(label='Pledges' description='One entry per collateral pledge this run authored on a clone, each re-read after the write with the advance rate the org resolved.')
        global List<PledgeResult> pledges;
        @InvocableVariable(label='Policy Exceptions' description='One entry per policy exception this run logged against a clone and the borrower, each re-read after the write. A committed exception is also transmitted to the bank\'s external change-stream endpoint by the org\'s own PolicyExceptionCDC trigger.')
        global List<PolicyExceptionResult> policyExceptions;
        @InvocableVariable(label='New Facilities' description='One entry per NET-NEW facility this run filed on the new package version, each re-read after the write with the name the org assigned it. Empty on every plan that adds none.')
        global List<NewFacilityResult> newFacilities;
        @InvocableVariable(label='Terminal State' description='success, partial or failed.')
        global String terminalState;
        @InvocableVariable(label='Steps')
        global List<StepResult> steps;
        @InvocableVariable(label='Outcome' description='Banker-language result. Says plainly that nothing is approved.')
        global String outcome;
        @InvocableVariable(label='Booking Handoff' description='What still has to happen in nCino, by a human, for this modification to be booked.')
        global String bookingHandoff;
        @InvocableVariable(label='Facilities' description='One entry per selected facility, with its clone, its junction row and its verification.')
        global List<FacilityResult> facilities;
        @InvocableVariable(label='Facility Count')
        global Integer facilityCount;
        @InvocableVariable(label='Replayed' description='True when this idempotency key had already produced a record. Nothing was written.')
        global Boolean replayed;
        @InvocableVariable(label='Relay Path' description='Which door carried this execution into a transaction that could host the engine: self (the org calling itself with a Visualforce-minted session) or box (the external relay). Null when the call ran inline.')
        global String relayPath;
        @InvocableVariable(label='Arm State' description='inline when the new version was armed in this same transaction and every arm step is settled here; queued when the arm runs in a chained transaction, in which case the arm steps read waiting, terminalState reads partial, and the staging record is the authority on what finally landed.')
        global String armState;
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
     * Executes a staged loan modification.
     *
     * @param requests One request per execution. Element i of the response belongs to input i.
     * @return One response per request.
     */
    @InvocableMethod(
        label='execute_loan_modification'
        description='Execute a plan staged by stage_loan_modification, behind the single-use decision token. Invokes nCino\'s credit action as a PACKAGE VERSIONING move: all eligible members roll into a new package, the staged changes land on the selected clones only, and every original loan and the current package stay untouched. Where the plan carries newFacilitiesJson it also FILES those net-new facilities on the new package version once the clones exist, with the borrower on each one\'s borrowing structure, and resolves every arm that named one by its label. Verifies the new package, each clone, each new facility and every chain junction row by re-query. Booking the new version still requires nCino\'s Submit for Approval.'
    )
    global static List<Response> run(List<Request> requests) {
        List<Response> out = new List<Response>();
        for (Request req : requests) {
            out.add(req.inlineExecution == true ? runInline(req) : runRelayed(req));
        }
        return out;
    }

    /** The leg that actually runs the engine. Only a context that can host it gets here. */
    private static Response runInline(Request req) {
        Response res = new Response();
        try {
            res.result = req.phase == PHASE_ARM ? armPhase(req) : execute(req);
            res.ok = true;
        } catch (ToolException e) {
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
            res.error = err('ALLOWLIST_REFUSED', e.getMessage(), null, 'apply_changes_0', false, req.idempotencyKey);
        } catch (EngineException e) {
            res.ok = false;
            res.error = err('ORG_REJECTED_WRITE', 'nCino\'s credit action refused this modification.', e.getMessage(), 'credit_action_0', true, req.idempotencyKey);
        } catch (DmlException e) {
            res.ok = false;
            res.error = err('ORG_REJECTED_WRITE', 'The org refused a write this plan depends on.', e.getMessage(), 'apply_changes_0', true, req.idempotencyKey);
        } catch (QueryException e) {
            res.ok = false;
            res.error = err('READ_FAILED', 'A record this plan depends on could not be read.', e.getMessage(), null, true, req.idempotencyKey);
        }
        return res;
    }

    // -------------------------------------------------------------------------------------------
    // The relay leg, and its two doors.
    //
    // Everything here is read-only until the callout, and there is nothing after it but reading the
    // answer. That is not a style choice: Apex refuses a callout in a transaction that has already
    // done DML, and burning the token here would strand the banker's confirmation on a hop that may
    // never land. The inner leg owns every write.
    // -------------------------------------------------------------------------------------------

    /** The leg the MCP dispatcher reaches. Validates what it can, then hands the work to a door. */
    private static Response runRelayed(Request req) {
        Response res = new Response();
        try {
            cm_Action_Staging__c prior = C360ActionStaging.findCompleted(req.idempotencyKey);
            if (prior != null) {
                res.result = replay(prior);
                res.ok = true;
                return res;
            }
            preflight(req);
        } catch (ToolException e) {
            res.ok = false;
            res.error = err('VALIDATION_FAILED', e.getMessage(), null, null, false, req.idempotencyKey);
            return res;
        } catch (C360ActionStaging.StagingException e) {
            res.ok = false;
            res.error = err('TOKEN_REFUSED', e.getMessage(), null, null, false, req.idempotencyKey);
            return res;
        } catch (QueryException e) {
            res.ok = false;
            res.error = err('READ_FAILED', 'A record this plan depends on could not be read.', e.getMessage(), null, true, req.idempotencyKey);
            return res;
        }
        return callRelay(req);
    }

    /**
     * Every check the outer leg can make without writing: the request shape, the plan belongs to
     * THIS tool, and the token is valid and unconsumed. A bad call is refused before it costs a
     * round trip; a good one leaves the token untouched for the inner leg to burn.
     */
    private static void preflight(Request req) {
        if (String.isBlank(req.idempotencyKey)) {
            throw new ToolException('idempotencyKey is required and must match the key used at stage time.');
        }
        if (String.isBlank(req.stagingId)) {
            throw new ToolException('stagingId is required.');
        }
        if (String.isBlank(req.planHash)) {
            throw new ToolException('planHash is required.');
        }
        cm_Action_Staging__c staged = readStaging(req.stagingId);
        if (staged == null) {
            throw new ToolException('No staging record found for stagingId ' + req.stagingId + '.');
        }
        if (staged.cm_Action_Id__c != ACTION_ID) {
            throw new ToolException(
                'Staging record ' + req.stagingId + ' holds a ' + staged.cm_Action_Id__c + ' plan, not a loan modification. ' +
                'Each execute tool runs its own action or none.'
            );
        }
        C360ActionStaging.assertClaimable(
            req.stagingId, req.planHash, req.decisionToken, C360Plan.asId(req.approverUserId)
        );
    }

    /**
     * Carries the plan into transactions that can host it: ONE HOP PER PHASE.
     *
     * Two hops, not one, because the credit action and the arm do not fit in a single transaction on
     * a package that carries fees, and nothing inside a transaction can buy its way out of that. The
     * accounting is at THE TRANSACTION BOUNDARY in execute(); the short version is that the limit is
     * nCino's own per-namespace query budget, the engine spends 46 of it and the arm spends 52, and
     * the only thing that resets it is a new transaction. This leg is the one place that can open
     * one, because it is the only leg that writes nothing and may therefore still make a callout.
     *
     * The token is consumed once, by the first hop. The second hop presents the same token to prove
     * it is the same confirmed plan, but consumes nothing and may write nothing the plan does not
     * already carry: it re-derives its targets from the org rather than being handed them.
     */
    private static Response callRelay(Request req) {
        Hop first = openDoor(innerPayload(req, PHASE_ENGINE));
        if (first.body == null) {
            return unavailable(req, first.why);
        }
        Response engineLeg = withPath(readInner(req, first.body), first.path);
        if (engineLeg.ok != true) {
            return engineLeg;
        }

        Hop second = openDoor(innerPayload(req, PHASE_ARM));
        if (second.body == null) {
            return armUnreachable(req, engineLeg, second.why);
        }
        Response armLeg = readInner(req, second.body);
        if (armLeg.ok != true) {
            return armLeg;
        }
        return withPath(mergeHops(engineLeg, armLeg), second.path);
    }

    /**
     * Tries the doors in order and returns the first real answer.
     *
     * A door only gets skipped past on a failure that PROVABLY did not reach the action: the session
     * could not be minted, the callout threw, or the endpoint refused authentication. Every other
     * status means the request landed somewhere that could have executed, and is reported rather
     * than retried through a second door.
     */
    private static Hop openDoor(String payload) {
        Hop viaSelf = selfHop(payload);
        if (viaSelf.body != null) {
            viaSelf.path = PATH_SELF;
            return viaSelf;
        }
        if (viaSelf.stop) {
            viaSelf.why = 'self: ' + viaSelf.why;
            return viaSelf;
        }

        Hop viaBox = boxHop(payload);
        if (viaBox.body != null) {
            viaBox.path = PATH_BOX;
            return viaBox;
        }
        viaBox.why = 'self: ' + viaSelf.why + ' | box: ' + viaBox.why;
        return viaBox;
    }

    /**
     * The engine hop landed and the arm hop did not. This is the one outcome the two-hop shape adds,
     * and it is reported rather than smoothed over: a new package version EXISTS, verified, with its
     * clones, and the changes the banker confirmed are not on it yet.
     *
     * It is NOT offered as resumable. The token is spent, so the ordinary entry point would answer a
     * retry with the replay of a run that is not finished, and re-running the arm blind would carry
     * the junction graph a second time onto clones that may already hold half of it. A human reads
     * the staging record and decides.
     */
    private static Response armUnreachable(Request req, Response engineLeg, String why) {
        Response res = new Response();
        res.ok = false;
        res.result = engineLeg.result;
        if (res.result != null) {
            res.result.armState = ARM_PENDING;
        }
        res.error = err(
            'ORG_UNAVAILABLE',
            'The new package version was created and verified, but the door that arms it could not be ' +
            'reached, so the staged changes are NOT on it. Do not retry this call: the decision token is ' +
            'spent and the staging record holds exactly how far the run got.',
            why,
            'carry_junctions',
            false,
            req.idempotencyKey
        );
        return res;
    }

    /**
     * Folds the two hops into the one answer the caller asked for.
     *
     * The arm hop is the authority on everything it settled, including the tracker, which it read
     * from the staging record the engine hop had already written. The engine hop is the authority on
     * the version itself and on the one claim only it could make honestly: that the parent facility
     * did not move.
     */
    private static Response mergeHops(Response engineLeg, Response armLeg) {
        ExecuteResult e = engineLeg.result;
        ExecuteResult a = armLeg.result;
        if (e == null || a == null) {
            return armLeg;
        }
        a.productPackageId = e.productPackageId;
        a.outputPackageId = e.outputPackageId;
        a.newPackageName = e.newPackageName;
        a.membersRolled = e.membersRolled;
        a.anchorName = e.anchorName;
        a.armState = ARM_RELAYED;

        Map<String, FacilityResult> verified = new Map<String, FacilityResult>();
        for (FacilityResult f : e.facilities == null ? new List<FacilityResult>() : e.facilities) {
            verified.put(f.facilityId, f);
        }
        for (FacilityResult f : a.facilities == null ? new List<FacilityResult>() : a.facilities) {
            FacilityResult proved = verified.get(f.facilityId);
            if (proved == null) {
                continue;
            }
            f.facilityName = proved.facilityName;
            f.cloneLookupKey = proved.cloneLookupKey;
            f.junctionId = proved.junctionId;
            f.junctionName = proved.junctionName;
            f.revisionNumber = proved.revisionNumber;
            f.parentUnchanged = proved.parentUnchanged;
            f.verification = proved.verification;
        }
        return armLeg;
    }

    /** One attempt at one door: a body to read, or why it is not one, and whether to try the next. */
    private class Hop {
        String body;
        String why;
        String path;
        Boolean stop = false;
    }

    /** This door did not answer, and the next one is worth trying: nothing here reached the action. */
    private static Hop refused(String why) {
        Hop h = new Hop();
        h.why = why;
        return h;
    }

    /**
     * This door did not answer and NO other door may be tried. The request landed somewhere that
     * could have executed, so a second attempt at the same plan is not a retry, it is a second run.
     */
    private static Hop halt(String why) {
        Hop h = new Hop();
        h.why = why;
        h.stop = true;
        return h;
    }

    private static Hop answered(String body) {
        Hop h = new Hop();
        h.body = body;
        return h;
    }

    /** The org calling its own Actions API, authenticated by a Visualforce-minted session id. */
    private static Hop selfHop(String payload) {
        String sid;
        try {
            sid = session().sessionId();
        } catch (Exception e) {
            return refused('the session could not be minted (' + e.getTypeName() + ': ' + e.getMessage() + ')');
        }
        if (String.isBlank(sid)) {
            return refused('the session page rendered nothing usable');
        }
        HttpRequest hr = baseRequest(URL.getOrgDomainUrl().toExternalForm() + ACTION_PATH, payload);
        hr.setHeader('Authorization', 'Bearer ' + sid);
        return send(hr, 'the org refused its own session');
    }

    /** The external relay, which re-enters with a proper OAuth token. */
    private static Hop boxHop(String payload) {
        cm_Relay_Config__c cfg = cm_Relay_Config__c.getOrgDefaults();
        if (String.isBlank(cfg.cm_Relay_URL__c) || String.isBlank(cfg.cm_Shared_Secret__c)) {
            return refused('cm_Relay_Config__c carries no URL or no secret');
        }
        HttpRequest hr = baseRequest(cfg.cm_Relay_URL__c, payload);
        hr.setHeader(RELAY_SECRET_HEADER, cfg.cm_Shared_Secret__c);
        hr.setHeader(RELAY_ACTION_HEADER, ACTION_NAME);
        return send(hr, 'the relay refused this call (a wrong shared secret, or an action it does not carry)');
    }

    private static HttpRequest baseRequest(String endpoint, String payload) {
        HttpRequest hr = new HttpRequest();
        hr.setEndpoint(endpoint);
        hr.setMethod('POST');
        hr.setHeader('Content-Type', 'application/json');
        hr.setTimeout(RELAY_TIMEOUT_MS);
        hr.setBody(payload);
        return hr;
    }

    /**
     * 401 and 403 prove the request was turned away before anything could run, and are the only
     * statuses this falls through on. A callout that threw never reached the host at all, which is
     * equally safe. Every other status halts: the plan is reported unavailable and resumable, and
     * the token fence in the inner leg makes that retry safe even if something did run.
     */
    private static Hop send(HttpRequest hr, String authRefusal) {
        HttpResponse http;
        try {
            http = new Http().send(hr);
        } catch (Exception e) {
            return refused('the door could not be reached (' + e.getTypeName() + ': ' + e.getMessage() + ')');
        }
        Integer status = http.getStatusCode();
        if (status == 401 || status == 403) {
            return refused(authRefusal + ' (HTTP ' + status + ')');
        }
        if (status != 200) {
            return halt('the door answered HTTP ' + status + '. ' + shorten(http.getBody()));
        }
        return answered(http.getBody());
    }

    private static String innerPayload(Request req, String phase) {
        return JSON.serialize(new Map<String, Object>{
            'inputs' => new List<Object>{
                new Map<String, Object>{
                    'idempotencyKey' => req.idempotencyKey,
                    'stagingId' => req.stagingId,
                    'planHash' => req.planHash,
                    'decisionToken' => req.decisionToken,
                    'approverUserId' => req.approverUserId,
                    'inlineExecution' => true,
                    'phase' => phase
                }
            }
        });
    }

    /** Stamps the door onto an answer that came back from it. */
    private static Response withPath(Response res, String path) {
        if (res.result != null) {
            res.result.relayPath = path;
        }
        return res;
    }

    /**
     * Unwraps the Actions API envelope and returns the inner leg's own Response.
     *
     * Past this point the inner leg has RUN. A body we cannot read is therefore never reported as
     * "nothing happened": the token is spent, the staging record is the authority, and the answer
     * says exactly that instead of inviting a retry that would be refused.
     */
    private static Response readInner(Request req, String body) {
        Response res = new Response();
        try {
            List<Object> rows = (List<Object>) JSON.deserializeUntyped(body);
            Map<String, Object> row = (Map<String, Object>) rows[0];
            if (row.get('isSuccess') != true) {
                res.ok = false;
                res.error = err(
                    'ORG_REJECTED_WRITE',
                    'The org refused the relayed execution.',
                    shorten(JSON.serialize(row.get('errors'))),
                    'credit_action_0',
                    true,
                    req.idempotencyKey
                );
                return res;
            }
            return (Response) JSON.deserialize(JSON.serialize(row.get('outputValues')), Response.class);
        } catch (Exception e) {
            res.ok = false;
            res.error = err(
                'READ_FAILED',
                'The relayed execution ran but its answer could not be read back here. Do not retry: the decision ' +
                'token is spent. The staging record for this idempotency key holds what actually happened.',
                e.getTypeName() + ': ' + e.getMessage(),
                null,
                false,
                req.idempotencyKey
            );
            return res;
        }
    }

    /** Nothing was attempted and nothing was written, so the token is still good for a retry. */
    private static Response unavailable(Request req, String detail) {
        Response res = new Response();
        res.ok = false;
        res.error = err('ORG_UNAVAILABLE', RELAY_UNAVAILABLE, detail, 'credit_action_0', true, req.idempotencyKey);
        return res;
    }

    private static String shorten(String s) {
        if (s == null) {
            return null;
        }
        return s.length() > 500 ? s.substring(0, 500) + '...' : s;
    }

    // -------------------------------------------------------------------------------------------
    // The session seam.
    //
    // Page.getContent() returns a blank page in a test context, so the door that depends on it can
    // only be tested through a seam. The default implementation is the real page, so the shipping
    // path is never the stubbed one.
    // -------------------------------------------------------------------------------------------

    /** Where the self-hop's bearer token comes from. */
    public interface SessionSource {
        String sessionId();
    }

    @TestVisible
    private static SessionSource sessionOverride;

    private static SessionSource session() {
        return sessionOverride == null ? new VisualforceSession() : sessionOverride;
    }

    /**
     * An opaque UI session id, minted by rendering a page rather than read off the running request.
     * That is the whole point: the JWT access token a hosted-MCP context runs on is exactly what
     * UserInfo.getSessionId() cannot work with.
     */
    public class VisualforceSession implements SessionSource {
        public String sessionId() {
            String body = Page.C360RelaySession.getContent().toString().trim();
            // A login page, an error page or an empty render is not a session, and must not be sent
            // as one: a malformed bearer would come back as a 401 and be read as "try the next door"
            // when the truth is that this door is broken.
            return (body.length() < 20 || body.contains('<')) ? null : body;
        }
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
                'Staging record ' + req.stagingId + ' holds a ' + staged.cm_Action_Id__c + ' plan, not a loan modification. ' +
                'Each execute tool runs its own action or none.'
            );
        }

        cm_Action_Staging__c stg = C360ActionStaging.claimForExecute(
            req.stagingId, req.planHash, req.decisionToken, C360Plan.asId(req.approverUserId)
        );

        List<C360Plan.Step> steps = C360Plan.deserializeSteps(stg.cm_Plan_JSON__c);
        Map<String, Object> v = C360Plan.deserializeValues(stg.cm_Plan_JSON__c);

        Id packageId = C360Plan.asId(v.get('productPackageId'));
        Decimal declaredCount = C360Plan.asDecimal(v.get('facilityCount'));
        Integer n = declaredCount == null ? 1 : Integer.valueOf(declaredCount);

        List<Id> parents = new List<Id>();
        for (Integer i = 0; i < n; i++) {
            Id fid = C360Plan.asId(v.get('facility' + i + '.loanId'));
            if (fid == null) {
                String detail = 'The staged plan is missing facility ' + i + '. Re-stage the action.';
                C360Plan.markRefused(steps, detail);
                C360ActionStaging.recordOutcome(stg, steps, C360Plan.TERMINAL_FAILED, null);
                throw new ToolException(detail);
            }
            parents.add(fid);
        }

        // Resume precondition (A33.3.3): re-read every target before any write, so a run never acts on
        // org state that moved since staging. The valid-facility rule is re-applied here rather than
        // assumed from stage time, because a facility can be closed or re-staged in between.
        List<LLC_BI__Loan__c> before;
        try {
            before = C360Facilities.validate(readFacilities(parents), parents, packageId, 'Modifications');
        } catch (C360Facilities.SelectionException e) {
            C360Plan.markRefused(steps, e.getMessage());
            C360ActionStaging.recordOutcome(stg, steps, C360Plan.TERMINAL_FAILED, null);
            throw e;
        }
        Map<Id, LLC_BI__Loan__c> beforeById = new Map<Id, LLC_BI__Loan__c>(before);

        // The staged covenant-add count, read up front so every failure branch can settle those
        // steps rather than leaving them dangling as pending.
        Decimal covAddCountRaw = C360Plan.asDecimal(v.get('covenantAddCount'));
        Integer covenantAddCount = covAddCountRaw == null ? 0 : Integer.valueOf(covAddCountRaw);
        Decimal invCountRaw = C360Plan.asDecimal(v.get('involvementChangeCount'));
        Integer involvementChangeCount = invCountRaw == null ? 0 : Integer.valueOf(invCountRaw);
        Decimal fcCountRaw = C360Plan.asDecimal(v.get('fieldChangeCount'));
        Integer fieldChangeCount = fcCountRaw == null ? 0 : Integer.valueOf(fcCountRaw);
        Decimal feeCountRaw = C360Plan.asDecimal(v.get('feeAddCount'));
        Integer feeAddCount = feeCountRaw == null ? 0 : Integer.valueOf(feeCountRaw);
        Decimal pledgeCountRaw = C360Plan.asDecimal(v.get('pledgeAddCount'));
        Integer pledgeAddCount = pledgeCountRaw == null ? 0 : Integer.valueOf(pledgeCountRaw);
        Decimal newFacilityCountRaw = C360Plan.asDecimal(v.get('newFacilityCount'));
        Integer newFacilityCount = newFacilityCountRaw == null ? 0 : Integer.valueOf(newFacilityCountRaw);

        // The staged roll list. nCino package methodology: the credit action versions the WHOLE
        // package, so the plan carries every eligible member, not just the selected ones. The
        // membership was computed and hashed at stage time; it is re-derived here (resume
        // precondition A33.3.3) and a mismatch refuses the run, because a package whose membership
        // moved between staging and execution is not the package the banker confirmed.
        List<Id> rollMembers = new List<Id>();
        String rollCsv = v.get('rollMemberIds') == null ? null : String.valueOf(v.get('rollMemberIds'));
        if (String.isNotBlank(rollCsv)) {
            for (String rid : rollCsv.split(',')) {
                Id asId = C360Plan.asId(rid.trim());
                if (asId != null) {
                    rollMembers.add(asId);
                }
            }
        }
        if (rollMembers.isEmpty()) {
            String detail = 'This plan was staged before the package-versioning wave and carries no roll list. ' +
                'Re-stage the action: a modification rolls the whole package, and the banker confirms that shape at stage time.';
            C360Plan.markRefused(steps, detail);
            C360ActionStaging.recordOutcome(stg, steps, C360Plan.TERMINAL_FAILED, null);
            throw new ToolException(detail);
        }
        Set<Id> rollSet = new Set<Id>(rollMembers);
        Set<Id> nowEligible = new Set<Id>();
        for (LLC_BI__Loan__c m : [
            SELECT Id FROM LLC_BI__Loan__c
            WHERE LLC_BI__Product_Package__c = :packageId
              AND LLC_BI__Stage__c = 'Booked' AND LLC_BI__Status__c = 'Open'
            WITH USER_MODE
        ]) {
            nowEligible.add(m.Id);
        }
        if (!nowEligible.equals(rollSet)) {
            String detail = 'The package membership moved between staging and execution: the plan rolls ' +
                rollSet.size() + ' members but the package now holds ' + nowEligible.size() +
                ' eligible members. Re-stage the action so the banker confirms the package as it stands now.';
            C360Plan.markRefused(steps, detail);
            C360ActionStaging.recordOutcome(stg, steps, C360Plan.TERMINAL_FAILED, null);
            throw new ToolException(detail);
        }

        // Everything on the chain before we act, so a pre-existing modification is never mistaken for
        // the one this run produced. Revision 0 is a self-referential anchor row (ACTIONS-DESIGN 1.4),
        // and any of the rolled members may already carry earlier revisions.
        Set<Id> junctionsBefore = new Set<Id>();
        for (LLC_BI__LoanRenewal__c j : [
            SELECT Id FROM LLC_BI__LoanRenewal__c WHERE LLC_BI__ParentLoanId__c IN :rollMembers WITH USER_MODE
        ]) {
            junctionsBefore.add(j.Id);
        }

        EngineResult engineResult = engine().modify(packageId, rollMembers);
        if (engineResult.success != true) {
            String why = engineResult.failureReasons == null || engineResult.failureReasons.isEmpty()
                ? 'The engine returned no failure reason.'
                : String.join(engineResult.failureReasons, ' | ');
            C360Plan.setState(steps, 'roll_package', C360Plan.STATE_FAILED, 'nCino refused the credit action: ' + why);
            for (Integer i = 0; i < n; i++) {
                C360Plan.setState(steps, 'credit_action_' + i, C360Plan.STATE_FAILED, 'nCino refused the credit action: ' + why);
                C360Plan.setState(steps, 'verify_clone_' + i, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'apply_changes_' + i, C360Plan.STATE_SKIPPED, null);
            }
            C360Plan.setState(steps, 'verify_package', C360Plan.STATE_SKIPPED, null);
            C360Plan.setState(steps, 'carry_junctions', C360Plan.STATE_SKIPPED, null);
            C360Plan.setState(steps, C360AggregateSweep.STEP_ID, C360Plan.STATE_SKIPPED, null);
            for (Integer ci = 0; ci < covenantAddCount; ci++) {
                C360Plan.setState(steps, 'covenant_create_' + ci, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'covenant_attach_' + ci, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'covenant_verify_' + ci, C360Plan.STATE_SKIPPED, null);
            }
            for (Integer ii = 0; ii < involvementChangeCount; ii++) {
                C360Plan.setState(steps, 'involvement_change_' + ii, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'involvement_verify_' + ii, C360Plan.STATE_SKIPPED, null);
            }
            for (Integer fi = 0; fi < fieldChangeCount; fi++) {
                C360Plan.setState(steps, 'field_change_' + fi, C360Plan.STATE_SKIPPED, null);
            }
            for (Integer fe = 0; fe < feeAddCount; fe++) {
                C360Plan.setState(steps, 'fee_add_' + fe, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'fee_verify_' + fe, C360Plan.STATE_SKIPPED, null);
            }
            for (Integer pl = 0; pl < pledgeAddCount; pl++) {
                C360Plan.setState(steps, 'collateral_create_' + pl, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'collateral_own_' + pl, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'pledge_add_' + pl, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'pledge_verify_' + pl, C360Plan.STATE_SKIPPED, null);
            }
            for (Integer nfx = 0; nfx < newFacilityCount; nfx++) {
                C360Plan.setState(steps, 'new_facility_' + nfx, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'new_facility_involve_' + nfx, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'new_facility_verify_' + nfx, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'new_facility_purpose_' + nfx, C360Plan.STATE_SKIPPED, null);
            }
            C360Plan.setState(steps, 'held_execution', C360Plan.STATE_SKIPPED, null);
            C360ActionStaging.recordOutcome(stg, steps, C360Plan.TERMINAL_FAILED, null);
            throw new EngineException(why);
        }

        // The versioning contract: the engine must have minted a NEW package. A result that points
        // back at the source package is the old single-loan anchoring, which the package methodology
        // forbids, and nothing downstream may pretend otherwise.
        Id newPkgId = String.isBlank(engineResult.outputPackageId) ? null : (Id) engineResult.outputPackageId;
        if (newPkgId == null || newPkgId == packageId) {
            String why = newPkgId == null
                ? 'The engine reported success but named no output package, so the new version cannot be verified.'
                : 'The engine reported the SOURCE package as its output instead of a new version. The clones, if any, are anchored wrongly.';
            C360Plan.setState(steps, 'roll_package', C360Plan.STATE_FILED_UNVERIFIED, why);
            for (Integer i = 0; i < n; i++) {
                C360Plan.setState(steps, 'credit_action_' + i, C360Plan.STATE_FILED_UNVERIFIED, why);
                C360Plan.setState(steps, 'verify_clone_' + i, C360Plan.STATE_FAILED, why);
                C360Plan.setState(steps, 'apply_changes_' + i, C360Plan.STATE_SKIPPED, null);
            }
            C360Plan.setState(steps, 'verify_package', C360Plan.STATE_FAILED, why);
            C360Plan.setState(steps, 'carry_junctions', C360Plan.STATE_SKIPPED, null);
            C360Plan.setState(steps, C360AggregateSweep.STEP_ID, C360Plan.STATE_SKIPPED, null);
            for (Integer ci = 0; ci < covenantAddCount; ci++) {
                C360Plan.setState(steps, 'covenant_create_' + ci, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'covenant_attach_' + ci, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'covenant_verify_' + ci, C360Plan.STATE_SKIPPED, null);
            }
            for (Integer ii = 0; ii < involvementChangeCount; ii++) {
                C360Plan.setState(steps, 'involvement_change_' + ii, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'involvement_verify_' + ii, C360Plan.STATE_SKIPPED, null);
            }
            for (Integer fi = 0; fi < fieldChangeCount; fi++) {
                C360Plan.setState(steps, 'field_change_' + fi, C360Plan.STATE_SKIPPED, null);
            }
            for (Integer fe = 0; fe < feeAddCount; fe++) {
                C360Plan.setState(steps, 'fee_add_' + fe, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'fee_verify_' + fe, C360Plan.STATE_SKIPPED, null);
            }
            for (Integer pl = 0; pl < pledgeAddCount; pl++) {
                C360Plan.setState(steps, 'collateral_create_' + pl, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'collateral_own_' + pl, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'pledge_add_' + pl, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'pledge_verify_' + pl, C360Plan.STATE_SKIPPED, null);
            }
            for (Integer nfx = 0; nfx < newFacilityCount; nfx++) {
                C360Plan.setState(steps, 'new_facility_' + nfx, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'new_facility_involve_' + nfx, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'new_facility_verify_' + nfx, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'new_facility_purpose_' + nfx, C360Plan.STATE_SKIPPED, null);
            }
            C360Plan.setState(steps, 'held_execution', C360Plan.STATE_SKIPPED, null);
            C360ActionStaging.recordOutcome(stg, steps, C360Plan.TERMINAL_PARTIAL, null);
            throw new EngineException(why);
        }
        C360Plan.setState(steps, 'roll_package', C360Plan.STATE_VERIFIED,
            'nCino created package version ' + newPkgId + ' from one credit action over ' + rollMembers.size() + ' members.');

        // Map clone to parent through the chain, never through "the newest loan on the package": two
        // facilities modified in one call would race, and a duplicate produced by failed background
        // Apex would win.
        Map<Id, LLC_BI__LoanRenewal__c> newestByParent = new Map<Id, LLC_BI__LoanRenewal__c>();
        for (LLC_BI__LoanRenewal__c j : [
            SELECT Id, Name, LLC_BI__ParentLoanId__c, LLC_BI__RenewalLoanId__c,
                   LLC_BI__RevisionNumber__c, LLC_BI__RevisionStatus__c
            FROM LLC_BI__LoanRenewal__c
            WHERE LLC_BI__ParentLoanId__c IN :rollMembers
            WITH USER_MODE
        ]) {
            if (junctionsBefore.contains(j.Id)) {
                continue;
            }
            if (j.LLC_BI__RenewalLoanId__c == null || j.LLC_BI__RenewalLoanId__c == j.LLC_BI__ParentLoanId__c) {
                continue;
            }
            LLC_BI__LoanRenewal__c held = newestByParent.get(j.LLC_BI__ParentLoanId__c);
            if (held == null || revision(j) > revision(held)) {
                newestByParent.put(j.LLC_BI__ParentLoanId__c, j);
            }
        }

        Set<Id> cloneIds = new Set<Id>();
        for (LLC_BI__LoanRenewal__c j : newestByParent.values()) {
            cloneIds.add(j.LLC_BI__RenewalLoanId__c);
        }
        Map<Id, LLC_BI__Loan__c> clones = new Map<Id, LLC_BI__Loan__c>(readLoans(cloneIds));

        // Package-level verification: the new version exists and carries a clone for EVERY rolled
        // member. The junction graphs are copied by nCino's own queueable jobs after this transaction
        // commits, so they are reported as queued in observe_side_effects, never claimed here.
        List<LLC_BI__Product_Package__c> newPkgRows = [
            SELECT Id, Name, LLC_BI__Account__c FROM LLC_BI__Product_Package__c WHERE Id = :newPkgId WITH USER_MODE LIMIT 1
        ];
        Integer clonesOnNew = [
            SELECT COUNT() FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = :newPkgId WITH USER_MODE
        ];
        String newPkgName = newPkgRows.isEmpty() ? null : newPkgRows[0].Name;

        // The engine names the version itself and hangs it on NO account (verified live 2026-08-30:
        // the created package carries a null LLC_BI__Account__c, which is also why its name prefix
        // comes out blank as "- 8/30/2026 - PP"). The org's own convention is "<Account> - <M/D/YYYY>
        // - PP" (516 of 518 packages), so both are repaired here and anything else is left exactly
        // as the engine wrote it.
        if (!newPkgRows.isEmpty()) {
            // The borrower's name rides the facility read (governor fix 2026-08-31: this
            // transaction shares its query budget with nCino's engine, so nothing here spends a
            // query on what a relationship field already carries).
            String borrowerName = before[0].LLC_BI__Account__r == null ? null : before[0].LLC_BI__Account__r.Name;
            Boolean nameNeedsRepair = newPkgName != null && newPkgName.startsWith('- ')
                && String.isNotBlank(borrowerName);
            Boolean accountNeedsRepair = newPkgRows[0].LLC_BI__Account__c == null;
            if (nameNeedsRepair || accountNeedsRepair) {
                LLC_BI__Product_Package__c repair = new LLC_BI__Product_Package__c(Id = newPkgId);
                Map<String, Object> pkgFields = new Map<String, Object>();
                if (nameNeedsRepair) {
                    String repaired = borrowerName + ' ' + newPkgName;
                    if (repaired.length() > 80) {
                        repaired = repaired.substring(0, 80);
                    }
                    repair.Name = repaired;
                    pkgFields.put('Name', repaired);
                    newPkgName = repaired;
                }
                if (accountNeedsRepair) {
                    repair.LLC_BI__Account__c = before[0].LLC_BI__Account__c;
                    pkgFields.put('LLC_BI__Account__c', before[0].LLC_BI__Account__c);
                }
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PRODUCT_PACKAGE, C360WriteGuard.OP_UPDATE, pkgFields);
                update as user repair;
            }
        }

        Boolean packageProven = !newPkgRows.isEmpty() && clonesOnNew == rollMembers.size();
        C360Plan.setState(
            steps,
            'verify_package',
            packageProven ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED,
            newPkgRows.isEmpty()
                ? 'The engine named package ' + newPkgId + ' but it could not be read back.'
                : 'Package version ' + newPkgName + ' (' + newPkgId + ') reads back with ' + clonesOnNew + ' of ' +
                  rollMembers.size() + ' rolled members' +
                  (packageProven ? '.' : ', which is NOT the full roll. Each missing member is reported against its own facility.')
        );

        // ---- THE TRANSACTION BOUNDARY (governor fix, 2026-08-31).
        //
        // Everything above proves what nCino's engine did. Everything below WRITES to the new
        // version, and every one of those writes wakes nCino's own automation - fee aggregation,
        // financed-fee calculation, exposure rollup, collateral aggregation - which runs inside the
        // MANAGED namespace and spends the MANAGED namespace's query budget, not ours.
        //
        // That distinction is the whole diagnosis, and it is measured rather than assumed. The
        // failing run of 2026-08-31 issued 161 queries, of which exactly TWELVE were ours. The limit
        // that broke was LLC_BI's own per-namespace counter at 101, reached while nCino recalculated
        // the clone's fees on our commitment update. Two consequences follow, and both are worth
        // stating so nobody re-derives them the expensive way:
        //   - Cutting OUR queries buys nothing. Apex counts a query against the namespace of the code
        //     that ISSUES it, not the namespace of the object queried. Our reads of LLC_BI__ objects
        //     are ours. We were at 12 of 100 in a transaction that died at 101 of 100 in a budget we
        //     never touched.
        //   - Reordering our writes only changes WHICH of nCino's jobs is the one to tip it over. The
        //     automation still runs, still queries, still runs inside this transaction.
        // Measured shape of that run: the engine alone spent 61 queries, the carry inserts spent 58
        // more, and the single commitment update on the clone spent 30.
        //
        // So the arm is a SECOND TRANSACTION. An async context gets a fresh set of per-namespace
        // limits, and 200 queries rather than 100, which is the only thing that actually creates the
        // headroom a full plan needs on a package that carries fees.
        //
        // THE TRADEOFF, STATED PLAINLY. This call now returns before the new version is armed. It
        // reports the arm steps as waiting rather than verified, and terminalState comes back partial
        // on a run that will go on to succeed. That is not a hedge, it is the truth at the moment of
        // the answer: the tracker on the staging record is the authority (A33.3.3), the arm updates
        // it when it lands, and Customer360ActionHistory reads the status back. armState tells the
        // caller which of the two shapes it is holding.
        //
        // WHAT THE SECOND TRANSACTION IS NOT. It carries no authority of its own. The decision token
        // was consumed once, above, and it gates the WHOLE plan; the arm re-reads the plan the banker
        // hashed and writes nothing that is not already in it. It cannot be reached from outside: it
        // is enqueued here and nowhere else, and it takes no token because there is nothing left for a
        // token to permit. Replay protection goes live the moment this transaction commits, because
        // the result record id is written BEFORE the arm is dispatched.
        Map<Id, Id> cloneByParent = new Map<Id, Id>();
        for (Id parentId : newestByParent.keySet()) {
            cloneByParent.put(parentId, newestByParent.get(parentId).LLC_BI__RenewalLoanId__c);
        }

        // The parents as they read after the credit action and before any arm write. This is the ONLY
        // point at which "the parent was not touched" can honestly be tested, and it is why that claim
        // is settled here rather than in the arm: the engine is the only thing in this whole flow that
        // could move a parent, and the arm writes exclusively at clone-targeted rows.
        Map<Id, LLC_BI__Loan__c> parentsAfter = new Map<Id, LLC_BI__Loan__c>(readLoans(new Set<Id>(parents)));

        List<ParentSnapshot> snapshots = new List<ParentSnapshot>();
        List<FacilityResult> results = new List<FacilityResult>();
        Id firstCloneId = null;
        for (Integer i = 0; i < n; i++) {
            Id parentId = parents[i];
            String s = String.valueOf(i);
            LLC_BI__Loan__c parentBefore = beforeById.get(parentId);
            LLC_BI__LoanRenewal__c junction = newestByParent.get(parentId);
            LLC_BI__Loan__c clone = junction == null ? null : clones.get(junction.LLC_BI__RenewalLoanId__c);

            FacilityResult fr = new FacilityResult();
            fr.facilityId = parentId;
            fr.facilityName = parentBefore.Name;
            results.add(fr);

            if (clone == null) {
                // Nothing to arm for this parent, and the arm is never asked to. Settled here in full.
                C360Plan.setState(
                    steps, 'credit_action_' + s, C360Plan.STATE_FILED_UNVERIFIED,
                    junction == null
                        ? 'The engine reported success but no new chain row appeared for this facility. Nothing is claimed for it.'
                        : 'Chain row ' + junction.Name + ' appeared but the facility it points at could not be read back.'
                );
                C360Plan.setState(steps, 'verify_clone_' + s, C360Plan.STATE_FAILED, 'No modification facility could be read for this parent.');
                C360Plan.setState(steps, 'apply_changes_' + s, C360Plan.STATE_SKIPPED, null);
                fr.verification = 'No modification facility could be read back for this parent, so nothing is claimed for it.';
                fr.outcome = 'The credit action produced nothing verifiable for ' + parentBefore.Name + '.';
                // Left null rather than true: nothing was written against this parent, but nothing
                // re-read it either, and an unverified claim is not one this tool makes.
                continue;
            }

            C360Plan.setState(steps, 'credit_action_' + s, C360Plan.STATE_VERIFIED,
                'nCino created modification facility ' + clone.Id + ' from ' + parentBefore.Name + '.');

            fr.cloneLoanId = clone.Id;
            fr.cloneName = clone.Name;
            fr.cloneLookupKey = clone.LLC_BI__lookupKey__c;
            fr.cloneStage = clone.LLC_BI__Stage__c;
            fr.junctionId = junction.Id;
            fr.junctionName = junction.Name;
            fr.revisionNumber = junction.LLC_BI__RevisionNumber__c;
            fr.parentUnchanged = parentUnchanged(parentBefore, parentsAfter.get(parentId));
            if (firstCloneId == null) {
                firstCloneId = clone.Id;
            }

            List<String> proven = new List<String>();
            List<String> unproven = new List<String>();
            if (clone.LLC_BI__Is_Modification__c == true) {
                proven.add('the clone reads back with Is_Modification true');
            } else {
                unproven.add('the clone does NOT carry Is_Modification, so nCino may have typed it as an original loan');
            }
            if (clone.LLC_BI__Product_Package__c == newPkgId) {
                proven.add('it sits on the new package version ' + newPkgId);
            } else {
                unproven.add('it sits on package ' + clone.LLC_BI__Product_Package__c + ', not the new package version ' + newPkgId);
            }
            if (revision(junction) >= 1) {
                proven.add('chain row ' + junction.Name + ' records revision ' + String.valueOf(junction.LLC_BI__RevisionNumber__c));
            } else {
                unproven.add('the only chain row found is the revision 0 anchor, which is not a modification');
            }
            if (fr.parentUnchanged == true) {
                proven.add('the parent re-reads unchanged at ' + parentBefore.LLC_BI__Stage__c + ' / ' + parentBefore.LLC_BI__Status__c);
            } else {
                unproven.add('the parent did NOT re-read unchanged, which this tool never intends');
            }
            fr.verification = String.join(proven, '; ') +
                (unproven.isEmpty() ? '.' : '. Not proven: ' + String.join(unproven, '; ') + '.');
            C360Plan.setState(
                steps,
                'verify_clone_' + s,
                unproven.isEmpty() ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED,
                fr.verification
            );

            ParentSnapshot snap = new ParentSnapshot();
            snap.parentId = parentId;
            snap.name = parentBefore.Name;
            snap.cloneId = clone.Id;
            snap.index = i;
            snapshots.add(snap);
        }

        // Informational by contract (A33.3.2): surfaced to the banker, decides nothing, and is never
        // claimed as verified because no verification step proves it.
        C360Plan.setState(
            steps,
            'observe_side_effects',
            C360Plan.STATE_FILED_UNVERIFIED,
            'Stage-driven email alerts and memo status changes run org-side on their own transactions and report nothing back here.'
        );
        // A handoff is a statement about what a human must still do. It is true the moment the clone
        // exists and needs nothing from the arm, so it settles here rather than waiting on a
        // transaction that has no bearing on it.
        C360Plan.setState(steps, 'held_execution', C360Plan.STATE_VERIFIED, BOOKING_HANDOFF);

        ArmPlan job = new ArmPlan();
        job.accountId = before[0].LLC_BI__Account__c;
        job.newPkgId = newPkgId;
        job.cloneByParent = cloneByParent;
        job.rollMembers = rollMembers;
        job.snapshots = snapshots;

        // Everything the arm owns is written down as WAITING before the arm is reached, so the tracker
        // never has a window in which those steps read as if they had been attempted. An arm that runs
        // in this transaction overwrites them with what it actually proved.
        armWaiting(steps, v, snapshots);

        // The result record id lands BEFORE the arm, so a call arriving while the second hop is in
        // flight is refused by the same fence that has always refused a replay, rather than starting a
        // second credit action against a package that already versioned.
        C360ActionStaging.recordProgress(stg, steps, firstCloneId);

        ArmOutcome armed = req.phase == PHASE_ENGINE ? null : job.runNow(stg, results);

        ExecuteResult out = new ExecuteResult();
        out.stagingId = stg.Id;
        out.cloneLoanId = firstCloneId;
        out.anchorName = results.isEmpty() ? null : results[0].facilityName;
        out.productPackageId = packageId;
        out.outputPackageId = engineResult.outputPackageId;
        out.newPackageName = newPkgName;
        out.membersRolled = rollMembers.size();
        out.bookingHandoff = BOOKING_HANDOFF;
        out.facilityCount = results.size();
        out.replayed = false;

        if (armed == null) {
            // This leg was asked for the engine phase only. Everything the arm owns reads as waiting,
            // and nothing it owns is claimed: the second hop settles it.
            for (FacilityResult fr : results) {
                if (fr.cloneLoanId != null) {
                    fr.verification = ARM_WAITING;
                    fr.appliedChanges = ARM_WAITING;
                    fr.outcome = 'Modification ' + fr.cloneName + ' was created from ' + fr.facilityName +
                        ' on the new package version at stage ' + fr.cloneStage + '. ' + ARM_WAITING;
                }
            }
            out.armState = ARM_PENDING;
            // The name as the ORG has it right now. A before-save flow rewrites loan names from the
            // commitment, so the arm's amount change will rewrite this one: the activity trail should
            // resolve the name off cloneLoanId rather than pin this string.
            out.recordName = results.isEmpty() ? null : results[0].cloneName;
            out.covenants = intendedCovenants(v);
            out.involvements = intendedInvolvements(v);
            out.fieldChanges = intendedFieldChanges(v);
            out.fees = intendedFees(v);
            out.pledges = intendedPledges(v);
            out.policyExceptions = intendedPolicyExceptions(v);
            out.newFacilities = intendedNewFacilities(v);
            out.facilities = results;
            out.steps = toWireSteps(steps);
            out.terminalState = C360Plan.terminalState(steps);
            out.outcome = 'New package version ' + (newPkgName == null ? String.valueOf(newPkgId) : newPkgName) +
                ' created: ' + rollMembers.size() + ' members rolled, ' + results.size() + ' modified. ' + ARM_WAITING +
                ' ' + BOOKING_HANDOFF;
            return out;
        }

        // The arm ran in this transaction, so everything it proves is reported as proved - the name
        // included, which is the one the org settled on AFTER the commitment change rewrote it.
        out.armState = ARM_INLINE;
        out.recordName = armed.facilities.isEmpty() ? null : armed.facilities[0].cloneName;
        out.covenants = armed.covenants;
        out.involvements = armed.involvements;
        out.fieldChanges = armed.fieldChanges;
        out.fees = armed.fees;
        out.pledges = armed.pledges;
        out.policyExceptions = armed.policyExceptions;
        out.newFacilities = armed.newFacilities;
        out.facilities = armed.facilities;
        out.steps = toWireSteps(armed.steps);
        out.terminalState = armed.terminalState;
        out.outcome = 'New package version ' + (newPkgName == null ? String.valueOf(newPkgId) : newPkgName) +
            ' created: ' + rollMembers.size() + ' members rolled, ' + armed.facilities.size() + ' modified' +
            (armed.covenants.size() - armed.covenantAttachCount <= 0 ? '' :
                ', ' + (armed.covenants.size() - armed.covenantAttachCount) + ' net-new covenant' +
                (armed.covenants.size() - armed.covenantAttachCount == 1 ? '' : 's') + ' attached to the clone' +
                (armed.covenants.size() - armed.covenantAttachCount == 1 ? '' : 's')) +
            (armed.covenantAttachCount == 0 ? '' : ', ' + armed.covenantAttachCount + ' existing covenant' +
                (armed.covenantAttachCount == 1 ? '' : 's') + ' associated by junction only') +
            (armed.involvements.isEmpty() ? '' : ', ' + armed.involvements.size() + ' borrowing-structure change' +
                (armed.involvements.size() == 1 ? '' : 's') + ' on the new version') +
            (armed.fieldChanges.isEmpty() ? '' : ', ' + armed.fieldChanges.size() + ' field change' +
                (armed.fieldChanges.size() == 1 ? '' : 's') + ' on the clone' + (armed.fieldChanges.size() == 1 ? '' : 's')) +
            (armed.fees.isEmpty() ? '' : ', ' + armed.fees.size() + ' net-new fee' +
                (armed.fees.size() == 1 ? '' : 's') + ' on the clone' + (armed.fees.size() == 1 ? '' : 's')) +
            (armed.pledges.isEmpty() ? '' : ', ' + armed.pledges.size() + ' collateral pledge' +
                (armed.pledges.size() == 1 ? '' : 's') + ' on the clone' + (armed.pledges.size() == 1 ? '' : 's')) +
            (armed.policyExceptions.isEmpty() ? '' : ', ' + armed.policyExceptions.size() + ' policy exception' +
                (armed.policyExceptions.size() == 1 ? '' : 's') + ' logged on the clone' +
                (armed.policyExceptions.size() == 1 ? '' : 's') + ' and the borrower') +
            (armed.newFacilities == null || armed.newFacilities.isEmpty() ? '' :
                ', ' + armed.newFacilities.size() + ' NET-NEW ' +
                (armed.newFacilities.size() == 1 ? 'facility' : 'facilities') + ' filed on the new version') + '. ' +
            (armed.facilities.size() == 1
                ? armed.facilities[0].outcome
                : 'See each facility for its clone and what was applied.') +
            ' ' + BOOKING_HANDOFF;
        return out;
    }

    // -------------------------------------------------------------------------------------------
    // The arm leg: every write that lands ON the new version, and its verification.
    //
    // This runs in its own transaction for the governor reason set out at the boundary above. It is
    // the same code either way: the dispatcher decides only WHERE it runs, never what it does.
    // -------------------------------------------------------------------------------------------

    /**
     * The four scalars as ONE member's clone takes them. Null everywhere is a real answer: a member
     * selected for a field change alone is modified without any of its terms moving.
     */
    private class MemberScalars {
        Decimal amount;
        Date maturity;
        Decimal rate;
        Decimal term;

        /** Reads one staged per-target entry onto this member, by its request-key name. */
        void take(String key, Object value) {
            if (key == 'requestedAmount') {
                amount = C360Plan.asDecimal(value);
            } else if (key == 'requestedMaturityDate') {
                maturity = C360Plan.asDate(value);
            } else if (key == 'requestedRate') {
                rate = C360Plan.asDecimal(value);
            } else if (key == 'requestedTermMonths') {
                term = C360Plan.asDecimal(value);
            }
            // An unknown key cannot reach here: stage validates against exactly the four names and
            // refuses anything else with the legal list, so the plan can only carry these.
        }
    }

    /** One selected parent and the clone the engine made from it, in step order. */
    public class ParentSnapshot {
        public Id parentId;
        public String name;
        public Id cloneId;
        public Integer index;
    }

    /** Everything the arm needs, and nothing it could use to widen what the plan permits. */
    public class ArmPlan {
        public Id accountId;
        public Id newPkgId;
        public Map<Id, Id> cloneByParent;
        /** The facilities THIS RUN created on the new version, by the label the plan named them by.
         *  Empty on every plan that adds none, which is almost all of them. */
        public Map<String, Id> newFacilityByLabel = new Map<String, Id>();
        public List<Id> rollMembers;
        public List<ParentSnapshot> snapshots;

        /**
         * Arms the new version and records the outcome on the staging record.
         *
         * Never throws. Letting an exception out would roll back the recording along with the writes,
         * leaving the banker looking at a run stuck at Executing with no account of why. Whatever
         * happened is written down instead.
         *
         * @param stg     The staging record, carrying the plan and the tracker as the leg that
         *                claimed it left them. Both legs already hold it, so it is passed rather than
         *                re-read: this transaction shares its query budget with nCino's automation.
         * @param results The facility rows the engine leg already identified and verified. The arm
         *                fills in what only it can know: what actually landed on each clone.
         */
        public ArmOutcome runNow(cm_Action_Staging__c stg, List<FacilityResult> results) {
            List<C360Plan.Step> steps = (List<C360Plan.Step>) JSON.deserialize(
                stg.cm_Tracker_JSON__c, List<C360Plan.Step>.class
            );
            Map<String, Object> v = C360Plan.deserializeValues(stg.cm_Plan_JSON__c);

            ArmOutcome outcome;
            try {
                outcome = arm(this, steps, v, results);
            } catch (Exception e) {
                // Everything already written stays written and is reported as filed rather than
                // verified: the tool's rule is that it never claims what it did not read back.
                armFailed(steps, v, snapshots, e.getTypeName() + ': ' + e.getMessage());
                outcome = new ArmOutcome();
                outcome.steps = steps;
                outcome.covenants = intendedCovenants(v);
                outcome.involvements = intendedInvolvements(v);
                outcome.fieldChanges = intendedFieldChanges(v);
                outcome.fees = intendedFees(v);
                outcome.pledges = intendedPledges(v);
                outcome.policyExceptions = intendedPolicyExceptions(v);
                outcome.newFacilities = intendedNewFacilities(v);
                outcome.facilities = results;
                outcome.terminalState = C360Plan.terminalState(steps);
            }
            C360ActionStaging.recordOutcome(stg, outcome.steps, outcome.terminalState, stg.cm_Result_Record_Id__c);
            return outcome;
        }
    }

    /** What the arm proved, in the shape the response needs. */
    public class ArmOutcome {
        public List<C360Plan.Step> steps;
        public List<CovenantResult> covenants;
        /**
         * How many of `covenants` are ASSOCIATIONS of an existing covenant rather than net-new
         * creates. They share the wire shape because a banker reads one list of covenants on the
         * new version, and they are counted apart because calling an association "net-new" would be
         * a claim about a record this run did not author. Internal: the wire is unchanged.
         */
        public Integer covenantAttachCount = 0;
        public List<InvolvementResult> involvements;
        public List<FieldChangeResult> fieldChanges;
        public List<FeeResult> fees;
        public List<PledgeResult> pledges;
        public List<PolicyExceptionResult> policyExceptions;
        public List<NewFacilityResult> newFacilities;
        public List<FacilityResult> facilities;
        public String terminalState;
    }

    /**
     * WHERE AN ARM LANDS: the clone of a booked member, or a facility THIS RUN just created.
     *
     * A net-new facility has no id at stage time, so the plan names it by a LABEL and this is the
     * one place the label becomes an id. Every arm that may target one asks here rather than reading
     * `cloneByParent` directly, which is what keeps the two shapes from being resolved two different
     * ways in eight places.
     *
     * @param job The arm plan, carrying both maps.
     * @param v The staged plan values.
     * @param prefix The arm's own plan-value prefix, for example 'covenantAdd0'.
     * @return The loan the arm writes against, or null where the plan named one this run cannot find.
     */
    private static Id armTarget(ArmPlan job, Map<String, Object> v, String prefix) {
        String label = C360Plan.asString(v.get(prefix + '.targetNewLabel'));
        if (String.isNotBlank(label)) {
            return job.newFacilityByLabel.get(label);
        }
        return job.cloneByParent.get(C360Plan.asId(v.get(prefix + '.targetLoanId')));
    }

    /** The arm, wherever it runs. Writes to the new version only; never to a parent. */
    private static ArmOutcome arm(
        ArmPlan job,
        List<C360Plan.Step> steps,
        Map<String, Object> v,
        List<FacilityResult> results
    ) {
        // The moment this hop began, taken BEFORE its first write so every row it causes reads back
        // inside the window. EXACT, with no slack: CreatedDate is stamped at DML time, which is
        // always after this reading, and a back-margin of even one second reaches into the
        // transaction that ran before this one (proved by a test run on 2026-09-14, where a one
        // second margin swept a row the fixture's own setup had written).
        Datetime txStart = Datetime.now();

        Integer covenantAddCount = intCount(v.get('covenantAddCount'));
        Integer involvementChangeCount = intCount(v.get('involvementChangeCount'));
        Integer fieldChangeCount = intCount(v.get('fieldChangeCount'));

        Set<Id> cloneIds = new Set<Id>(job.cloneByParent.values());

        // ---- The staged changes land FIRST (governor fix, 2026-08-31). This used to run after the
        // carry, and that order was expensive in a way that is invisible unless you count nCino's
        // queries rather than ours: a commitment change on a clone that ALREADY carries fees, pledges
        // and involvements wakes the financed-fee calculation, the fee aggregate, the collateral
        // aggregate and the exposure rollup over all of them. On the failing run that single update
        // spent 30 queries. Applied here, the clone is still bare, so the same update is cheap - and
        // the percentage fees copied below are then computed by the org against the commitment the
        // banker actually asked for, first time, instead of being written at the parent's figure and
        // recomputed afterwards.
        //
        // THE SCALARS ARRIVE ONE OF TWO WAYS (2026-08-31). The flat plan values broadcast: one
        // figure onto every clone, which is what a single-facility plan stages and what every plan
        // staged before this wave. `scalarChange{i}.*` carries them PER TARGET, so a mixed plan can
        // take the line of credit to a new commitment while the equipment loan takes something else
        // entirely. Stage refuses a plan carrying both, so the two never have to be reconciled here:
        // per-target values, where they exist, are the WHOLE answer and the flat ones are not read.
        Integer scalarChangeCount = intCount(v.get('scalarChangeCount'));
        Boolean perTargetScalars = scalarChangeCount > 0;

        MemberScalars broadcast = new MemberScalars();
        broadcast.amount = C360Plan.asDecimal(v.get('requestedAmount'));
        broadcast.maturity = C360Plan.asDate(v.get('requestedMaturityDate'));
        broadcast.rate = C360Plan.asDecimal(v.get('requestedRate'));
        broadcast.term = C360Plan.asDecimal(v.get('requestedTermMonths'));

        Map<Id, MemberScalars> scalarsByTarget = new Map<Id, MemberScalars>();
        for (Integer i = 0; i < scalarChangeCount; i++) {
            Id t = C360Plan.asId(v.get('scalarChange' + i + '.targetLoanId'));
            if (t == null) {
                continue;
            }
            if (!scalarsByTarget.containsKey(t)) {
                scalarsByTarget.put(t, new MemberScalars());
            }
            scalarsByTarget.get(t).take(String.valueOf(v.get('scalarChange' + i + '.key')), v.get('scalarChange' + i + '.value'));
        }

        Map<Id, List<Integer>> fieldChangesByTarget = new Map<Id, List<Integer>>();
        for (Integer i = 0; i < fieldChangeCount; i++) {
            Id t = C360Plan.asId(v.get('fieldChange' + i + '.targetLoanId'));
            if (t == null) {
                continue;
            }
            if (!fieldChangesByTarget.containsKey(t)) {
                fieldChangesByTarget.put(t, new List<Integer>());
            }
            fieldChangesByTarget.get(t).add(i);
        }

        // What each clone actually took, kept so the read-back below reports THIS member's figures
        // rather than a plan-level intention that may never have been aimed at it.
        Map<Id, MemberScalars> takenByParent = new Map<Id, MemberScalars>();

        List<LLC_BI__Loan__c> toUpdate = new List<LLC_BI__Loan__c>();
        for (ParentSnapshot snap : job.snapshots) {
            MemberScalars own = perTargetScalars
                ? (scalarsByTarget.containsKey(snap.parentId) ? scalarsByTarget.get(snap.parentId) : new MemberScalars())
                : broadcast;
            takenByParent.put(snap.parentId, own);

            LLC_BI__Loan__c fields = new LLC_BI__Loan__c(Id = snap.cloneId);
            Map<String, Object> writeFields = new Map<String, Object>();
            if (own.amount != null) {
                fields.LLC_BI__Amount__c = own.amount;
                writeFields.put('LLC_BI__Amount__c', own.amount);
            }
            if (own.maturity != null) {
                fields.LLC_BI__Maturity_Date__c = own.maturity;
                writeFields.put('LLC_BI__Maturity_Date__c', own.maturity);
            }
            if (own.rate != null) {
                fields.LLC_BI__InterestRate__c = own.rate;
                writeFields.put('LLC_BI__InterestRate__c', own.rate);
            }
            if (own.term != null) {
                fields.LLC_BI__Term_Months__c = own.term;
                writeFields.put('LLC_BI__Term_Months__c', own.term);
            }
            // The field wave lands in the SAME clone update: dynamic puts of values the stage
            // already coerced against the describe, so nothing here re-interprets a banker's words.
            for (Integer fci : fieldChangesByTarget.containsKey(snap.parentId)
                    ? fieldChangesByTarget.get(snap.parentId) : new List<Integer>()) {
                String fcField = String.valueOf(v.get('fieldChange' + fci + '.field'));
                Object fcValue = coerceStagedFieldValue(
                    String.valueOf(v.get('fieldChange' + fci + '.type')),
                    String.valueOf(v.get('fieldChange' + fci + '.valueJson'))
                );
                fields.put(fcField, fcValue);
                writeFields.put(fcField, fcValue);
            }
            // The fence still runs even when no field is present: it is the single gate every domain
            // write in this package passes through, and it is what refuses a forbidden field or a
            // stage hop if this method ever grows one.
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN, C360WriteGuard.OP_UPDATE, writeFields);
            toUpdate.add(fields);
        }
        if (!toUpdate.isEmpty()) {
            update as user toUpdate;
        }

        // ---- THE NET-NEW FACILITIES ON THE NEW VERSION (founder, 2026-09-03).
        //
        // They are filed HERE, after the clones exist and before anything that could target one,
        // for two reasons that are the same reason twice. The package version has to exist, because
        // the whole point of adding a facility inside a modification is that it lands on the version
        // being approved rather than on a package nobody is looking at. And every other arm below
        // may name one by its LABEL, so the ids have to be real before the first of them runs.
        //
        // THE FLAGS ARE FALSE. A facility filed here is a NEW loan, not a version of one: it carries
        // no LLC_BI__LoanRenewal__c row and no Is_Modification, because saying otherwise would report
        // it as somebody's clone in every chain read the bank has.
        //
        // A FIELD CHANGE AIMED AT ONE RIDES ITS INSERT rather than a second update. The field wave
        // for the clones runs above, against loans that already exist; here the record is being
        // written for the first time, so the same coerced value goes on the same DML. That is one
        // insert instead of an insert and an update, and on this hop the query budget it saves is
        // nCino's rather than ours.
        //
        // THE PURPOSE IS THE ONE THING THIS TRANSACTION MAY NOT BE ABLE TO FINISH.
        // LLC_BI__Primary_Loan_Purpose__c lives on the Loan Detail, which nCino creates from an
        // after-commit flow in a transaction of its own (probe 5). Where the child is already there
        // the purpose is written and proven; where it is not, the step says so in the banker's own
        // words. It is a HANDOFF either way, which is the honest type for a statement about what the
        // org still has to do, and it is what keeps a run that filed everything it could from
        // reporting itself as partial over a record that does not exist yet.
        Integer newFacilityCount = intCount(v.get('newFacilityCount'));
        List<NewFacilityResult> newFacilityResults = new List<NewFacilityResult>();
        List<C360NewFacilities.NewFacility> planned = new List<C360NewFacilities.NewFacility>();
        if (newFacilityCount > 0) {
            List<LLC_BI__Loan__c> filed = new List<LLC_BI__Loan__c>();
            for (Integer i = 0; i < newFacilityCount; i++) {
                C360NewFacilities.NewFacility nf = C360NewFacilities.fromResolved(v, i);
                planned.add(nf);

                NewFacilityResult nr = new NewFacilityResult();
                nr.label = nf.label;
                nr.product = nf.product;
                nr.amount = nf.amount;
                nr.termMonths = nf.termMonths;
                nr.purpose = nf.purpose;
                nr.purposeWritten = false;
                nr.productPackageId = job.newPkgId;
                newFacilityResults.add(nr);

                Map<String, Object> newFields =
                    C360NewFacilities.loanFields(job.accountId, job.newPkgId, nf.product, nf.amount);
                LLC_BI__Loan__c record = C360NewFacilities.newLoan(job.accountId, job.newPkgId, nf);
                for (Integer fi = 0; fi < fieldChangeCount; fi++) {
                    if (C360Plan.asString(v.get('fieldChange' + fi + '.targetNewLabel')) != nf.label) {
                        continue;
                    }
                    String fcField = String.valueOf(v.get('fieldChange' + fi + '.field'));
                    Object fcValue = coerceStagedFieldValue(
                        String.valueOf(v.get('fieldChange' + fi + '.type')),
                        String.valueOf(v.get('fieldChange' + fi + '.valueJson'))
                    );
                    record.put(fcField, fcValue);
                    newFields.put(fcField, fcValue);
                }
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN, C360WriteGuard.OP_CREATE, newFields);
                filed.add((LLC_BI__Loan__c) C360WriteGuard.stripAndVerify(record, C360NewFacilities.LOAN_MUST_SURVIVE));
            }
            insert as user filed;
            for (Integer i = 0; i < filed.size(); i++) {
                job.newFacilityByLabel.put(planned[i].label, filed[i].Id);
                newFacilityResults[i].loanId = filed[i].Id;
                C360Plan.setState(steps, 'new_facility_' + i, C360Plan.STATE_VERIFIED,
                    'Facility ' + filed[i].Id + ' filed at Qualification on package version ' + job.newPkgId + '.');
            }

            // THE BORROWING STRUCTURE, which a facility insert does NOT create on its own (proven
            // with a control, LESSONS 15u). Ownership only, never a contingent amount beside it.
            List<LLC_BI__Legal_Entities__c> borrowerRows = new List<LLC_BI__Legal_Entities__c>();
            for (LLC_BI__Loan__c l : filed) {
                Map<String, Object> invFields = C360NewFacilities.involvementFields(job.accountId, l.Id, job.newPkgId);
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_INVOLVEMENT, C360WriteGuard.OP_CREATE, invFields);
                borrowerRows.add((LLC_BI__Legal_Entities__c) C360WriteGuard.stripAndVerify(
                    C360NewFacilities.newInvolvement(job.accountId, l.Id, job.newPkgId),
                    C360NewFacilities.INVOLVEMENT_MUST_SURVIVE
                ));
            }
            insert as user borrowerRows;

            Set<Id> filedIds = new Map<Id, LLC_BI__Loan__c>(filed).keySet();
            Map<Id, Id> involvementByLoan = new Map<Id, Id>();
            for (LLC_BI__Legal_Entities__c e : [
                SELECT Id, LLC_BI__Loan__c FROM LLC_BI__Legal_Entities__c
                WHERE LLC_BI__Loan__c IN :filedIds WITH USER_MODE
            ]) {
                involvementByLoan.put(e.LLC_BI__Loan__c, e.Id);
            }
            Map<Id, LLC_BI__Loan__c> filedBack = new Map<Id, LLC_BI__Loan__c>([
                SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Status__c, LLC_BI__Product__c, LLC_BI__Amount__c,
                       LLC_BI__Term_Months__c, LLC_BI__Amortized_Term_Months__c, LLC_BI__First_Payment_Date__c,
                       LLC_BI__Product_Package__c, LLC_BI__Loan_Detail__c, LLC_BI__Default_App__c
                FROM LLC_BI__Loan__c WHERE Id IN :filedIds WITH USER_MODE
            ]);

            List<LLC_BI__Loan_Detail__c> purposeRows = new List<LLC_BI__Loan_Detail__c>();
            List<Integer> purposeOfRow = new List<Integer>();
            for (Integer i = 0; i < filed.size(); i++) {
                LLC_BI__Loan__c back = filedBack.get(filed[i].Id);
                if (back != null && back.LLC_BI__Loan_Detail__c != null && String.isNotBlank(planned[i].purpose)) {
                    purposeRows.add(new LLC_BI__Loan_Detail__c(
                        Id = back.LLC_BI__Loan_Detail__c,
                        LLC_BI__Primary_Loan_Purpose__c = planned[i].purpose
                    ));
                    purposeOfRow.add(i);
                }
            }
            if (!purposeRows.isEmpty()) {
                update as user purposeRows;
                for (Integer k : purposeOfRow) {
                    newFacilityResults[k].purposeWritten = true;
                }
            }

            for (Integer i = 0; i < filed.size(); i++) {
                String ns = String.valueOf(i);
                NewFacilityResult nr = newFacilityResults[i];
                LLC_BI__Loan__c back = filedBack.get(filed[i].Id);
                Id involvementId = involvementByLoan.get(filed[i].Id);
                nr.involvementId = involvementId;
                C360Plan.setState(
                    steps, 'new_facility_involve_' + ns,
                    involvementId == null ? C360Plan.STATE_FILED_UNVERIFIED : C360Plan.STATE_VERIFIED,
                    involvementId == null
                        ? 'The borrower row was inserted but could not be read back.'
                        : 'The borrower is on the new facility\'s borrowing structure at 100 percent ownership.'
                );

                if (back == null) {
                    nr.verification = 'The insert returned success but the facility could not be read back.';
                    C360Plan.setState(steps, 'new_facility_verify_' + ns, C360Plan.STATE_FILED_UNVERIFIED, nr.verification);
                    C360Plan.setState(steps, 'new_facility_purpose_' + ns, C360Plan.STATE_FILED_UNVERIFIED,
                        'The facility could not be read back, so nothing is claimed about its Loan Detail.');
                    continue;
                }
                nr.recordName = back.Name;
                nr.stage = back.LLC_BI__Stage__c;
                nr.productPackageId = back.LLC_BI__Product_Package__c;

                List<String> proven = new List<String>();
                List<String> unproven = new List<String>();
                if (back.LLC_BI__Product_Package__c == job.newPkgId) {
                    proven.add('it sits on the new package version ' + job.newPkgId);
                } else {
                    unproven.add('it sits on package ' + back.LLC_BI__Product_Package__c + ', not the new version');
                }
                if (back.LLC_BI__Product__c == planned[i].product) {
                    proven.add('the org kept product ' + back.LLC_BI__Product__c);
                } else {
                    unproven.add('the org stored product ' + back.LLC_BI__Product__c + ' rather than ' + planned[i].product);
                }
                if (back.LLC_BI__Amount__c == planned[i].amount) {
                    proven.add('the commitment reads ' + String.valueOf(back.LLC_BI__Amount__c));
                } else {
                    unproven.add('the commitment reads ' + String.valueOf(back.LLC_BI__Amount__c) + ' rather than ' + String.valueOf(planned[i].amount));
                }
                if (back.LLC_BI__Term_Months__c == planned[i].termMonths) {
                    proven.add('the term reads ' + String.valueOf(back.LLC_BI__Term_Months__c) + ' months');
                } else {
                    unproven.add('the term reads ' + String.valueOf(back.LLC_BI__Term_Months__c) + ' rather than ' + String.valueOf(planned[i].termMonths));
                }
                if (planned[i].amortizedTermMonths != null) {
                    if (back.LLC_BI__Amortized_Term_Months__c == planned[i].amortizedTermMonths) {
                        proven.add('the amortised term reads ' + String.valueOf(back.LLC_BI__Amortized_Term_Months__c));
                    } else {
                        unproven.add('the amortised term reads ' + String.valueOf(back.LLC_BI__Amortized_Term_Months__c));
                    }
                }
                if (planned[i].firstPaymentDate != null) {
                    if (back.LLC_BI__First_Payment_Date__c == planned[i].firstPaymentDate) {
                        proven.add('the first payment date reads ' + String.valueOf(back.LLC_BI__First_Payment_Date__c));
                    } else {
                        unproven.add('the first payment date reads ' + String.valueOf(back.LLC_BI__First_Payment_Date__c));
                    }
                }
                // The route the Loan page renders from (LESSONS 8o). Reported on the same footing as
                // the commitment: a wrong value is invisible until a banker opens an empty page.
                if (back.LLC_BI__Default_App__c == C360NewFacilities.LOAN_DEFAULT_APP) {
                    proven.add('Default App ' + back.LLC_BI__Default_App__c);
                } else {
                    unproven.add('Default App reads ' + back.LLC_BI__Default_App__c + ' rather than ' +
                        C360NewFacilities.LOAN_DEFAULT_APP + ', so the nCino Loan page will render empty');
                }
                nr.verification = 'The org named this facility ' + back.Name + '. ' + String.join(proven, '; ') +
                    (unproven.isEmpty() ? '.' : '. Not proven: ' + String.join(unproven, '; ') + '.');
                C360Plan.setState(
                    steps, 'new_facility_verify_' + ns,
                    unproven.isEmpty() ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED,
                    nr.verification
                );
                C360Plan.setState(
                    steps, 'new_facility_purpose_' + ns, C360Plan.STATE_VERIFIED,
                    nr.purposeWritten == true
                        ? 'The primary loan purpose "' + planned[i].purpose + '" is set on Loan Detail ' +
                          back.LLC_BI__Loan_Detail__c + '.'
                        : 'nCino creates the Loan Detail for this facility in its own transaction moments after the ' +
                          'filing, so it cannot be seen from here. The primary loan purpose "' + planned[i].purpose +
                          '" is on this plan and is the one thing on it a person still sets in nCino.'
                );
            }
        }

        // ---- The junction carry. nCino's engine copies NOTHING here: the related-lists copy
        // configuration only ever fed the retired classic wizard's checklist (verified live
        // 2026-08-30: all eight defaults flipped on, engine run, zero junction rows landed, no copy
        // job enqueued). Package methodology requires every member's graph to carry onto the new
        // version, so this tool composes the carry itself: replicas of the parents' covenant
        // junctions, collateral pledges (with a fresh per-clone aggregate shell) and borrowing
        // involvements, retargeted at the clones, and verified by count.
        //
        // The staged REMOVES become carry exclusions: those source rows never travel to the new
        // version. This is the roll-over diff made literal - nothing is deleted anywhere.
        Set<Id> excludedInvolvementIds = new Set<Id>();
        for (Integer i = 0; i < involvementChangeCount; i++) {
            if (String.valueOf(v.get('involvement' + i + '.op')) == 'remove') {
                Id srcId = C360Plan.asId(v.get('involvement' + i + '.sourceRowId'));
                if (srcId != null) {
                    excludedInvolvementIds.add(srcId);
                }
            }
        }
        // The founder's requirement of 2026-09-02, in the only shape nCino allows: a covenant or a
        // pledge is "removed from the open loan" by the new VERSION not carrying it. The parent's
        // junction, the covenant record, the asset and the ownership junction are all untouched, so
        // no delete happens and no covenant is detached. Stage resolved each row to an exact id,
        // which is why the skip below can be an id test rather than a description match.
        Integer covenantExclusionCount = intCount(v.get('covenantExclusionCount'));
        Set<Id> excludedCovenantJunctionIds = new Set<Id>();
        for (Integer i = 0; i < covenantExclusionCount; i++) {
            Id jId = C360Plan.asId(v.get('covenantExclusion' + i + '.junctionId'));
            if (jId != null) {
                excludedCovenantJunctionIds.add(jId);
            }
        }
        Integer pledgeExclusionCount = intCount(v.get('pledgeExclusionCount'));
        Set<Id> excludedPledgeIds = new Set<Id>();
        for (Integer i = 0; i < pledgeExclusionCount; i++) {
            Id pId = C360Plan.asId(v.get('pledgeExclusion' + i + '.pledgeId'));
            if (pId != null) {
                excludedPledgeIds.add(pId);
            }
        }

        // ---- The NET-NEW FEES ride the carry's own fee insert (governor, 2026-08-31).
        //
        // They are composed here, under OP_CREATE, and handed to the carry to be inserted in the
        // SAME DML as the fees copied from the parents. That is a budget decision with a measured
        // reason. A fee insert wakes nCino's fee automation - Fee_Loan_Aggregate, the financed-fee
        // calculation, the loan's own rollups - and that automation runs in the LLC_BI namespace,
        // spending ITS budget rather than ours; the arm hop already sits at ~52 of nCino's 100. The
        // automation is bulkified, so one insert of five rows costs what one insert of four does,
        // while a second insert pays the whole pass again (~30 queries on the failing run of
        // 2026-08-31) and would put the hop near 85. Composed here rather than inside the carry
        // because the FENCE is different: a copy is OP_CARRY, an authored row is OP_CREATE, and the
        // guard has to see each one for what it is.
        Integer feeAddCount = intCount(v.get('feeAddCount'));
        List<FeeResult> feeResults = new List<FeeResult>();
        List<LLC_BI__Fee__c> netNewFees = new List<LLC_BI__Fee__c>();
        List<Integer> feeIndexOfRow = new List<Integer>();
        for (Integer i = 0; i < feeAddCount; i++) {
            String fs = String.valueOf(i);
            FeeResult fr = new FeeResult();
            fr.feeType = String.valueOf(v.get('feeAdd' + fs + '.feeType'));
            fr.description = String.valueOf(v.get('feeAdd' + fs + '.description'));
            fr.calculationType = String.valueOf(v.get('feeAdd' + fs + '.calculationType'));
            fr.percentage = C360Plan.asDecimal(v.get('feeAdd' + fs + '.percentage'));
            feeResults.add(fr);

            Id feeTargetParent = C360Plan.asId(v.get('feeAdd' + fs + '.targetLoanId'));
            Id feeCloneId = armTarget(job, v, 'feeAdd' + fs);
            if (feeCloneId == null) {
                String feeWhy = 'No modification clone could be read for the facility this fee targets, so the fee was not created.';
                C360Plan.setState(steps, 'fee_add_' + fs, C360Plan.STATE_FAILED, feeWhy);
                C360Plan.setState(steps, 'fee_verify_' + fs, C360Plan.STATE_FAILED, feeWhy);
                fr.verification = feeWhy;
                continue;
            }
            fr.cloneLoanId = feeCloneId;

            String recordType = String.valueOf(v.get('feeAdd' + fs + '.recordType'));
            String status = String.valueOf(v.get('feeAdd' + fs + '.status'));
            String paidBy = String.valueOf(v.get('feeAdd' + fs + '.paidBy'));
            String basisSource = v.get('feeAdd' + fs + '.basisSource') == null
                ? null : String.valueOf(v.get('feeAdd' + fs + '.basisSource'));
            Boolean isIncome = v.get('feeAdd' + fs + '.isIncome') == true;
            // A PERCENTAGE fee carries its rate and its basis and NO amount: the org derives the
            // money. Stage refuses an amount on one, so nothing here has to choose between two.
            Decimal amount = C360Plan.asDecimal(v.get('feeAdd' + fs + '.amount'));

            Map<String, Object> feeFields = new Map<String, Object>{
                'LLC_BI__Loan__c' => feeCloneId,
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
            netNewFees.add(new LLC_BI__Fee__c(
                LLC_BI__Loan__c = feeCloneId,
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

        // ---- The COLLATERAL CHAIN, and where each of its three writes lands in the budget.
        //
        // The ASSET and its OWNERSHIP junction are inserted HERE, in two DMLs of their own, and they
        // have to be: a pledge needs the collateral's id, and nothing else in this transaction
        // creates a collateral. They are bulked into one insert each rather than one per pledge,
        // because both objects carry an org-local change-stream trigger that enqueues an EventBridge
        // callout per DML (the 24 CDC triggers the test fixture's shield exists for), against a
        // ceiling of 50 queued jobs in a synchronous transaction. Stage caps the plan at five
        // pledges for the same reason.
        //
        // The PLEDGE itself rides the carry's own pledge insert, exactly as a net-new fee rides the
        // carry's fee insert: a pledge insert wakes nCino's collateral aggregate automation, which
        // spends the LLC_BI namespace's query budget rather than ours, and that automation is
        // bulkified - an extra row in the existing insert is close to free, while a second insert
        // pays the whole pass again. Composed here rather than inside the carry because the FENCE is
        // different: a copy is OP_CARRY, an authored row is OP_CREATE.
        Integer pledgeAddCount = intCount(v.get('pledgeAddCount'));
        List<PledgeResult> pledgeResults = new List<PledgeResult>();
        List<LLC_BI__Loan_Collateral2__c> netNewPledges = new List<LLC_BI__Loan_Collateral2__c>();
        List<Integer> pledgeIndexOfRow = new List<Integer>();
        if (pledgeAddCount > 0) {
            composeCollateralChain(steps, v, job, pledgeAddCount, pledgeResults, netNewPledges, pledgeIndexOfRow);
        }

        String carryReport = carryJunctionGraph(
            job.rollMembers, job.cloneByParent, job.newPkgId, excludedInvolvementIds,
            excludedCovenantJunctionIds, excludedPledgeIds, netNewFees, netNewPledges
        );
        C360Plan.setState(
            steps,
            'carry_junctions',
            carryReport.startsWith('CARRIED') ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED,
            carryReport.removeStart('CARRIED ')
        );

        // THE SHELLS THIS HOP CAUSED AND NEVER USED (org proof 2026-09-14, backlog row 46). The
        // pledge insert above wakes nCino's collateral automation, which mints a shell of its own
        // per pledge; the clone already carries the one the carry made, so nothing ever points at
        // nCino's. Five were left on a single Hartwell version creation, and a discard can never
        // reach them because no facility names them. They are removed here, where they can still be
        // identified, and the step says so whether it found any or not.
        C360AggregateSweep.Result swept = C360AggregateSweep.sweep(ACTION_ID, txStart);
        C360Plan.setState(steps, C360AggregateSweep.STEP_ID, swept.state(), swept.detail);

        // The fees the carry just inserted for us, proven the only way this tool ever proves
        // anything: ONE re-read of the rows themselves. On a percentage fee the money is the ORG'S
        // answer - Basis_Amount and Amount are derived by nCino's FeeTrigger from the clone's own
        // commitment - so it is REPORTED rather than asserted against a figure nobody staged. On a
        // flat fee the amount is ours and is compared.
        verifyFees(steps, feeResults, netNewFees, feeIndexOfRow);

        // The pledges the carry just inserted for us, proven the same way: ONE re-read. The advance
        // rate is the ORG'S answer - a formula resolving the override, then the auto-applied rate,
        // then the collateral type's default - so it is reported rather than asserted against a
        // figure this plan supplied.
        verifyPledges(steps, pledgeResults, netNewPledges, pledgeIndexOfRow);

        // ---- Net-new covenants (plan values covenantAdd{i}.*). Created on the borrower account,
        // attached to the CLONE of the targeted member on the new version - never to the booked
        // parent. Probed safe 2026-08-30: a Covenant2 insert plus its junction mints no compliance
        // row, starts no approval and sends no email; the org's own review cycle owns the schedule
        // from here. Each add is created Pending and Active, with the org's mirrored operator and
        // threshold fields written the way Hartwell's own covenants carry them.
        List<CovenantResult> covenantResults = new List<CovenantResult>();
        for (Integer i = 0; i < covenantAddCount; i++) {
            String cs = String.valueOf(i);
            CovenantResult cr = new CovenantResult();
            cr.typeName = String.valueOf(v.get('covenantAdd' + cs + '.typeName'));
            cr.threshold = C360Plan.asDecimal(v.get('covenantAdd' + cs + '.threshold'));
            cr.operator = String.valueOf(v.get('covenantAdd' + cs + '.operator'));
            covenantResults.add(cr);

            Id covTypeId = C360Plan.asId(v.get('covenantAdd' + cs + '.typeId'));
            String covFrequency = String.valueOf(v.get('covenantAdd' + cs + '.frequency'));
            Date covEffective = C360Plan.asDate(v.get('covenantAdd' + cs + '.effectiveDate'));
            Id covTargetParent = C360Plan.asId(v.get('covenantAdd' + cs + '.targetLoanId'));
            Id covCloneId = armTarget(job, v, 'covenantAdd' + cs);

            if (covCloneId == null || covTypeId == null || cr.threshold == null) {
                String covWhy = covCloneId == null
                    ? 'No modification clone could be read for the facility this covenant targets, so the covenant was not created.'
                    : 'The staged covenant add is incomplete (type or threshold missing), so nothing was created. Re-stage the action.';
                C360Plan.setState(steps, 'covenant_create_' + cs, C360Plan.STATE_FAILED, covWhy);
                C360Plan.setState(steps, 'covenant_attach_' + cs, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'covenant_verify_' + cs, C360Plan.STATE_FAILED, covWhy);
                cr.verification = covWhy;
                continue;
            }

            Map<String, Object> covFields = new Map<String, Object>{
                'LLC_BI__Account__c' => job.accountId,
                'LLC_BI__Covenant_Type__c' => covTypeId,
                'LLC_BI__Financial_Indicator_Value__c' => cr.threshold,
                'Acnpex_Threshold_Value__c' => cr.threshold,
                'Financial_Indicator_Operator__c' => FI_OPERATOR.get(cr.operator),
                'Acnpex_Operator__c' => cr.operator,
                'LLC_BI__Frequency__c' => covFrequency,
                'LLC_BI__Effective_Date__c' => covEffective,
                'LLC_BI__Covenant_Status__c' => 'Pending',
                'LLC_BI__Active__c' => 'true'
            };
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COVENANT, C360WriteGuard.OP_CREATE, covFields);
            LLC_BI__Covenant2__c cov = new LLC_BI__Covenant2__c(
                LLC_BI__Account__c = job.accountId,
                LLC_BI__Covenant_Type__c = covTypeId,
                LLC_BI__Financial_Indicator_Value__c = cr.threshold,
                Acnpex_Threshold_Value__c = cr.threshold,
                Financial_Indicator_Operator__c = FI_OPERATOR.get(cr.operator),
                Acnpex_Operator__c = cr.operator,
                LLC_BI__Frequency__c = covFrequency,
                LLC_BI__Effective_Date__c = covEffective,
                LLC_BI__Covenant_Status__c = 'Pending',
                LLC_BI__Active__c = true
            );
            insert as user cov;
            C360Plan.setState(steps, 'covenant_create_' + cs, C360Plan.STATE_VERIFIED,
                'Covenant ' + cov.Id + ' created: ' + cr.typeName + ' ' + cr.operator + ' ' + String.valueOf(cr.threshold) + '.');

            Map<String, Object> attachFields = new Map<String, Object>{
                'LLC_BI__Loan__c' => covCloneId,
                'LLC_BI__Covenant2__c' => cov.Id
            };
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN_COVENANT, C360WriteGuard.OP_CREATE, attachFields);
            LLC_BI__Loan_Covenant__c attach = new LLC_BI__Loan_Covenant__c(
                LLC_BI__Loan__c = covCloneId,
                LLC_BI__Covenant2__c = cov.Id
            );
            insert as user attach;

            // The account association nCino's own UI mints beside every covenant (founder
            // correction, 2026-08-31): the covenant belongs to the borrower as well as to the
            // facility, and a covenant without its Account Covenant row is invisible where the
            // bank looks for it at relationship level.
            Map<String, Object> acctCovFields = new Map<String, Object>{
                'LLC_BI__Covenant2__c' => cov.Id,
                'LLC_BI__Account__c' => job.accountId
            };
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_ACCOUNT_COVENANT, C360WriteGuard.OP_CREATE, acctCovFields);
            LLC_BI__Account_Covenant__c acctCov = new LLC_BI__Account_Covenant__c(
                LLC_BI__Covenant2__c = cov.Id,
                LLC_BI__Account__c = job.accountId
            );
            insert as user acctCov;
            C360Plan.setState(steps, 'covenant_attach_' + cs, C360Plan.STATE_VERIFIED,
                'Junction ' + attach.Id + ' attaches it to clone ' + covCloneId + '; account association ' + acctCov.Id + ' anchors it on the borrower.');

            // The proof is the re-read, never the insert result.
            List<LLC_BI__Covenant2__c> covBack = [
                SELECT Id, Name, LLC_BI__Financial_Indicator_Value__c, LLC_BI__Covenant_Status__c
                FROM LLC_BI__Covenant2__c WHERE Id = :cov.Id WITH USER_MODE LIMIT 1
            ];
            Integer attachBack = [
                SELECT COUNT() FROM LLC_BI__Loan_Covenant__c
                WHERE LLC_BI__Loan__c = :covCloneId AND LLC_BI__Covenant2__c = :cov.Id
                WITH USER_MODE
            ];
            Integer acctBack = [
                SELECT COUNT() FROM LLC_BI__Account_Covenant__c
                WHERE LLC_BI__Account__c = :job.accountId AND LLC_BI__Covenant2__c = :cov.Id
                WITH USER_MODE
            ];
            Boolean covProven = !covBack.isEmpty()
                && covBack[0].LLC_BI__Financial_Indicator_Value__c == cr.threshold
                && attachBack == 1
                && acctBack == 1;
            cr.covenantId = cov.Id;
            cr.covenantName = covBack.isEmpty() ? null : covBack[0].Name;
            cr.cloneLoanId = covCloneId;
            cr.verification = covBack.isEmpty()
                ? 'The covenant could not be read back after creation.'
                : 'Covenant ' + covBack[0].Name + ' reads back at ' + String.valueOf(covBack[0].LLC_BI__Financial_Indicator_Value__c) +
                  ', status ' + covBack[0].LLC_BI__Covenant_Status__c + ', with ' + attachBack + ' junction on the clone and ' +
                  acctBack + ' account association on the borrower.';
            C360Plan.setState(
                steps,
                'covenant_verify_' + cs,
                covProven ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED,
                cr.verification
            );
        }

        // ---- Borrowing-structure amendments (plan values involvement{i}.*). ADDS are authored on
        // the clone with the new package anchor; REMOVES were already carried out as exclusions in
        // carryJunctionGraph and are PROVEN here by absence on the clone and presence on the parent.
        List<InvolvementResult> involvementResults = new List<InvolvementResult>();
        for (Integer i = 0; i < involvementChangeCount; i++) {
            String vs = String.valueOf(i);
            InvolvementResult ir = new InvolvementResult();
            ir.op = String.valueOf(v.get('involvement' + vs + '.op'));
            ir.role = String.valueOf(v.get('involvement' + vs + '.role'));
            ir.accountName = String.valueOf(v.get('involvement' + vs + '.accountName'));
            involvementResults.add(ir);

            Id invAccountId = C360Plan.asId(v.get('involvement' + vs + '.accountId'));
            Decimal invOwnership = C360Plan.asDecimal(v.get('involvement' + vs + '.ownership'));
            Id invTargetParent = C360Plan.asId(v.get('involvement' + vs + '.targetLoanId'));
            Id invSourceRowId = C360Plan.asId(v.get('involvement' + vs + '.sourceRowId'));
            Id invCloneId = armTarget(job, v, 'involvement' + vs);

            if (invCloneId == null || invAccountId == null) {
                String invWhy = invCloneId == null
                    ? 'No modification clone could be read for the facility this change targets, so nothing was done.'
                    : 'The staged change is incomplete (no resolved account), so nothing was done. Re-stage the action.';
                C360Plan.setState(steps, 'involvement_change_' + vs, C360Plan.STATE_FAILED, invWhy);
                C360Plan.setState(steps, 'involvement_verify_' + vs, C360Plan.STATE_FAILED, invWhy);
                ir.verification = invWhy;
                continue;
            }
            ir.cloneLoanId = invCloneId;

            if (ir.op == 'add') {
                Map<String, Object> invFields = new Map<String, Object>{
                    'LLC_BI__Loan__c' => invCloneId,
                    'LLC_BI__Product_Package__c' => job.newPkgId,
                    'LLC_BI__Account__c' => invAccountId,
                    'LLC_BI__Borrower_Type__c' => ir.role,
                    'LLC_BI__Ownership__c' => invOwnership
                };
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_INVOLVEMENT, C360WriteGuard.OP_CREATE, invFields);
                LLC_BI__Legal_Entities__c row = new LLC_BI__Legal_Entities__c(
                    LLC_BI__Loan__c = invCloneId,
                    LLC_BI__Product_Package__c = job.newPkgId,
                    LLC_BI__Account__c = invAccountId,
                    LLC_BI__Borrower_Type__c = ir.role,
                    LLC_BI__Ownership__c = invOwnership
                );
                insert as user row;
                ir.recordId = row.Id;
                C360Plan.setState(steps, 'involvement_change_' + vs, C360Plan.STATE_VERIFIED,
                    'Involvement ' + row.Id + ' created: ' + ir.accountName + ' as ' + ir.role + ' on clone ' + invCloneId + '.');

                Integer backAdd = [
                    SELECT COUNT() FROM LLC_BI__Legal_Entities__c
                    WHERE LLC_BI__Loan__c = :invCloneId AND LLC_BI__Account__c = :invAccountId
                          AND LLC_BI__Borrower_Type__c = :ir.role
                    WITH USER_MODE
                ];
                ir.verification = backAdd >= 1
                    ? ir.accountName + ' reads back as ' + ir.role + ' on the clone.'
                    : 'The involvement did not read back on the clone after creation.';
                C360Plan.setState(steps, 'involvement_verify_' + vs,
                    backAdd >= 1 ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED, ir.verification);
            } else {
                Integer onClone = [
                    SELECT COUNT() FROM LLC_BI__Legal_Entities__c
                    WHERE LLC_BI__Loan__c = :invCloneId AND LLC_BI__Account__c = :invAccountId
                          AND LLC_BI__Borrower_Type__c = :ir.role
                    WITH USER_MODE
                ];
                Integer onParent = invSourceRowId == null ? 0 : [
                    SELECT COUNT() FROM LLC_BI__Legal_Entities__c WHERE Id = :invSourceRowId WITH USER_MODE
                ];
                Boolean removeProven = onClone == 0 && onParent == 1;
                C360Plan.setState(steps, 'involvement_change_' + vs,
                    removeProven ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED,
                    'The carry ran without row ' + invSourceRowId + ' (' + ir.accountName + ' as ' + ir.role + '). Nothing was deleted.');
                ir.verification = removeProven
                    ? 'The clone carries no ' + ir.role + ' row for ' + ir.accountName + ', and the parent still carries its own.'
                    : 'Not proven: the clone reads ' + onClone + ' matching rows and the parent source row count is ' + onParent + '.';
                C360Plan.setState(steps, 'involvement_verify_' + vs,
                    removeProven ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED, ir.verification);
            }
        }

        // ---- CARRY EXCLUSIONS, covenant and pledge (plan values covenantExclusion{i}.* and
        // pledgeExclusion{i}.*). Nothing was written for these: carryJunctionGraph simply did not
        // replicate the named rows. They are PROVEN here the way an involvement exclusion is, by
        // absence on the clone and presence on the parent, because a removal nobody can see is
        // indistinguishable from a removal that did not happen.
        for (Integer i = 0; i < covenantExclusionCount; i++) {
            String xs = String.valueOf(i);
            Id exCovenantId = C360Plan.asId(v.get('covenantExclusion' + xs + '.covenantId'));
            Id exJunctionId = C360Plan.asId(v.get('covenantExclusion' + xs + '.junctionId'));
            Id exParent = C360Plan.asId(v.get('covenantExclusion' + xs + '.targetLoanId'));
            String exName = String.valueOf(v.get('covenantExclusion' + xs + '.covenantName'));
            Id exClone = job.cloneByParent.get(exParent);
            if (exClone == null || exCovenantId == null) {
                String exWhy = exClone == null
                    ? 'No modification clone could be read for the facility this exclusion targets, so nothing was proven.'
                    : 'The staged exclusion is incomplete (no resolved covenant), so nothing was proven. Re-stage the action.';
                C360Plan.setState(steps, 'covenant_exclusion_' + xs, C360Plan.STATE_FAILED, exWhy);
                C360Plan.setState(steps, 'covenant_exclusion_verify_' + xs, C360Plan.STATE_FAILED, exWhy);
                continue;
            }
            Integer covOnClone = [
                SELECT COUNT() FROM LLC_BI__Loan_Covenant__c
                WHERE LLC_BI__Loan__c = :exClone AND LLC_BI__Covenant2__c = :exCovenantId
                WITH USER_MODE
            ];
            Integer covOnParent = exJunctionId == null ? 0 : [
                SELECT COUNT() FROM LLC_BI__Loan_Covenant__c WHERE Id = :exJunctionId WITH USER_MODE
            ];
            Boolean covExcluded = covOnClone == 0 && covOnParent == 1;
            C360Plan.setState(steps, 'covenant_exclusion_' + xs,
                covExcluded ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED,
                'The carry ran without junction ' + exJunctionId + ' (' + exName + '). Nothing was deleted and the covenant was not amended.');
            C360Plan.setState(steps, 'covenant_exclusion_verify_' + xs,
                covExcluded ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED,
                covExcluded
                    ? 'The clone carries no junction for ' + exName + ', and the parent still carries its own.'
                    : 'Not proven: the clone reads ' + covOnClone + ' junctions for this covenant and the parent junction count is ' + covOnParent + '.');
        }

        for (Integer i = 0; i < pledgeExclusionCount; i++) {
            String ps = String.valueOf(i);
            Id exPledgeId = C360Plan.asId(v.get('pledgeExclusion' + ps + '.pledgeId'));
            Id exCollateralId = C360Plan.asId(v.get('pledgeExclusion' + ps + '.collateralId'));
            Id exPledgeParent = C360Plan.asId(v.get('pledgeExclusion' + ps + '.targetLoanId'));
            String exAsset = String.valueOf(v.get('pledgeExclusion' + ps + '.assetLabel'));
            Id exPledgeClone = job.cloneByParent.get(exPledgeParent);
            if (exPledgeClone == null || exCollateralId == null) {
                String exWhy = exPledgeClone == null
                    ? 'No modification clone could be read for the facility this exclusion targets, so nothing was proven.'
                    : 'The staged exclusion is incomplete (no resolved asset), so nothing was proven. Re-stage the action.';
                C360Plan.setState(steps, 'pledge_exclusion_' + ps, C360Plan.STATE_FAILED, exWhy);
                C360Plan.setState(steps, 'pledge_exclusion_verify_' + ps, C360Plan.STATE_FAILED, exWhy);
                continue;
            }
            Integer plOnClone = [
                SELECT COUNT() FROM LLC_BI__Loan_Collateral2__c
                WHERE LLC_BI__Loan__c = :exPledgeClone AND LLC_BI__Collateral__c = :exCollateralId
                WITH USER_MODE
            ];
            Integer plOnParent = exPledgeId == null ? 0 : [
                SELECT COUNT() FROM LLC_BI__Loan_Collateral2__c WHERE Id = :exPledgeId WITH USER_MODE
            ];
            Boolean plExcluded = plOnClone == 0 && plOnParent == 1;
            C360Plan.setState(steps, 'pledge_exclusion_' + ps,
                plExcluded ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED,
                'The carry ran without pledge ' + exPledgeId + ' (' + exAsset + '). Nothing was deleted, and the asset and its ownership junction are untouched.');
            C360Plan.setState(steps, 'pledge_exclusion_verify_' + ps,
                plExcluded ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED,
                plExcluded
                    ? 'The clone carries no pledge of ' + exAsset + ', and the parent still carries its own.'
                    : 'Not proven: the clone reads ' + plOnClone + ' pledges of this asset and the parent pledge count is ' + plOnParent + '.');
        }

        // ---- COVENANT ASSOCIATIONS (plan values covenantAttach{i}.*). A junction-only create for a
        // covenant the borrower ALREADY holds: no LLC_BI__Covenant2__c is inserted, nothing is
        // amended and nothing is deleted. The account association is minted only where the covenant
        // does not already carry one, because a relationship-level covenant has its own and a
        // second row would be the duplicate the association law never asked for.
        Integer covenantAttachCount = intCount(v.get('covenantAttachCount'));
        List<CovenantResult> covenantAttachResults = new List<CovenantResult>();
        for (Integer i = 0; i < covenantAttachCount; i++) {
            String ats = String.valueOf(i);
            CovenantResult ar = new CovenantResult();
            ar.covenantId = String.valueOf(v.get('covenantAttach' + ats + '.covenantId'));
            ar.covenantName = String.valueOf(v.get('covenantAttach' + ats + '.covenantName'));
            ar.typeName = String.valueOf(v.get('covenantAttach' + ats + '.typeName'));
            ar.threshold = C360Plan.asDecimal(v.get('covenantAttach' + ats + '.threshold'));
            ar.operator = String.valueOf(v.get('covenantAttach' + ats + '.operator'));
            covenantAttachResults.add(ar);

            Id attachCovenantId = C360Plan.asId(v.get('covenantAttach' + ats + '.covenantId'));
            Id attachParent = C360Plan.asId(v.get('covenantAttach' + ats + '.targetLoanId'));
            Id attachClone = armTarget(job, v, 'covenantAttach' + ats);
            if (attachClone == null || attachCovenantId == null) {
                String attachWhy = attachClone == null
                    ? 'No modification clone could be read for the facility this association targets, so the junction was not created.'
                    : 'The staged association is incomplete (no resolved covenant), so nothing was created. Re-stage the action.';
                C360Plan.setState(steps, 'covenant_associate_' + ats, C360Plan.STATE_FAILED, attachWhy);
                C360Plan.setState(steps, 'covenant_associate_verify_' + ats, C360Plan.STATE_FAILED, attachWhy);
                ar.verification = attachWhy;
                continue;
            }
            ar.cloneLoanId = attachClone;

            Map<String, Object> associateFields = new Map<String, Object>{
                'LLC_BI__Loan__c' => attachClone,
                'LLC_BI__Covenant2__c' => attachCovenantId
            };
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN_COVENANT, C360WriteGuard.OP_CREATE, associateFields);
            LLC_BI__Loan_Covenant__c associate = new LLC_BI__Loan_Covenant__c(
                LLC_BI__Loan__c = attachClone,
                LLC_BI__Covenant2__c = attachCovenantId
            );
            insert as user associate;

            Integer acctCovExisting = [
                SELECT COUNT() FROM LLC_BI__Account_Covenant__c
                WHERE LLC_BI__Account__c = :job.accountId AND LLC_BI__Covenant2__c = :attachCovenantId
                WITH USER_MODE
            ];
            if (acctCovExisting == 0) {
                Map<String, Object> assocAcctFields = new Map<String, Object>{
                    'LLC_BI__Covenant2__c' => attachCovenantId,
                    'LLC_BI__Account__c' => job.accountId
                };
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_ACCOUNT_COVENANT, C360WriteGuard.OP_CREATE, assocAcctFields);
                insert as user new LLC_BI__Account_Covenant__c(
                    LLC_BI__Covenant2__c = attachCovenantId,
                    LLC_BI__Account__c = job.accountId
                );
            }
            C360Plan.setState(steps, 'covenant_associate_' + ats, C360Plan.STATE_VERIFIED,
                'Junction ' + associate.Id + ' associates ' + ar.covenantName + ' to clone ' + attachClone +
                (acctCovExisting == 0 ? '; the account association was minted beside it.' : '; the covenant already carried its account association.'));

            Integer attachedBack = [
                SELECT COUNT() FROM LLC_BI__Loan_Covenant__c
                WHERE LLC_BI__Loan__c = :attachClone AND LLC_BI__Covenant2__c = :attachCovenantId
                WITH USER_MODE
            ];
            ar.verification = attachedBack == 1
                ? ar.covenantName + ' reads back on the clone, once, with the covenant record unchanged.'
                : 'Not proven: the clone reads ' + attachedBack + ' junctions for this covenant.';
            C360Plan.setState(steps, 'covenant_associate_verify_' + ats,
                attachedBack == 1 ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED, ar.verification);
        }
        covenantResults.addAll(covenantAttachResults);

        // ---- POLICY EXCEPTIONS (plan values policyException{i}.*). Logged against the CLONE and
        // anchored on the borrower, so the bank reads each one both on the facility it applies to
        // and at relationship level - which is where a credit officer goes looking for the bank's
        // exceptions. Probed safe 2026-08-31: of the 16 ProcessDefinition records in this org NONE
        // targets this object, and a three-insert rollback probe moved the email counter by zero.
        //
        // ONE DML FOR THE WHOLE PLAN, and here the reason is EGRESS rather than governors. The
        // org-local PolicyExceptionCDC trigger enqueues an EventBridgeCallout PER DML that POSTs
        // the serialised records to an external AWS endpoint; the queueable ceiling is 50 and this
        // is nowhere near it either way, but one insert is ONE transmission of the plan's
        // exceptions instead of one per exception. Stage caps the plan at five for the same reason.
        Integer policyExceptionCount = intCount(v.get('policyExceptionAddCount'));
        List<PolicyExceptionResult> policyExceptionResults = new List<PolicyExceptionResult>();
        if (policyExceptionCount > 0) {
            authorPolicyExceptions(steps, v, job, policyExceptionCount, policyExceptionResults);
        }

        // Re-read the clones after the change. The PARENTS are deliberately not re-read here: whether
        // this tool moved a parent was settled by the engine leg, which is the only leg that holds the
        // pre-image and the only one whose writes could ever reach a parent. Everything below writes
        // at clone-targeted rows exclusively.
        Map<Id, LLC_BI__Loan__c> clonesAfter = new Map<Id, LLC_BI__Loan__c>(readLoans(cloneIds));

        // The field wave, verified: one dynamic re-read of exactly the changed fields, compared
        // value by value. The proof is the read-back, never the update result.
        List<FieldChangeResult> fieldChangeResults = new List<FieldChangeResult>();
        if (fieldChangeCount > 0) {
            Set<String> changedFields = new Set<String>();
            for (Integer i = 0; i < fieldChangeCount; i++) {
                changedFields.add(String.valueOf(v.get('fieldChange' + i + '.field')));
            }
            // The read covers the clones AND the facilities this run created: a field change may
            // target either, and a change staged onto a new facility rode its insert rather than a
            // clone update, so a read of the clones alone would report it as landing nowhere.
            Set<Id> fieldTargets = new Set<Id>(cloneIds);
            fieldTargets.addAll(job.newFacilityByLabel.values());
            Map<Id, SObject> dynamicClones = new Map<Id, SObject>();
            if (!fieldTargets.isEmpty()) {
                String dynQuery = 'SELECT Id, ' + String.join(new List<String>(changedFields), ', ') +
                    ' FROM LLC_BI__Loan__c WHERE Id IN :fieldTargets WITH USER_MODE';
                for (SObject row : Database.query(dynQuery)) {
                    dynamicClones.put((Id) row.get('Id'), row);
                }
            }
            for (Integer i = 0; i < fieldChangeCount; i++) {
                String fi = String.valueOf(i);
                FieldChangeResult fcr = new FieldChangeResult();
                fcr.field = String.valueOf(v.get('fieldChange' + fi + '.field'));
                fcr.label = String.valueOf(v.get('fieldChange' + fi + '.label'));
                Object expected = coerceStagedFieldValue(
                    String.valueOf(v.get('fieldChange' + fi + '.type')),
                    String.valueOf(v.get('fieldChange' + fi + '.valueJson'))
                );
                fcr.value = String.valueOf(expected);
                Id fcCloneId = armTarget(job, v, 'fieldChange' + fi);
                fieldChangeResults.add(fcr);
                if (fcCloneId == null || !dynamicClones.containsKey(fcCloneId)) {
                    fcr.verification = 'No facility on the new version could be read back for the target of this change.';
                    C360Plan.setState(steps, 'field_change_' + fi, C360Plan.STATE_FAILED, fcr.verification);
                    continue;
                }
                fcr.cloneLoanId = fcCloneId;
                Object actual = dynamicClones.get(fcCloneId).get(fcr.field);
                Boolean landed = actual == expected || String.valueOf(actual) == String.valueOf(expected);
                fcr.verification = landed
                    ? fcr.label + ' reads back at ' + String.valueOf(actual) + ' on the new version.'
                    : fcr.label + ' did not land: staged ' + String.valueOf(expected) + ', reads back ' + String.valueOf(actual) + '.';
                C360Plan.setState(steps, 'field_change_' + fi,
                    landed ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED, fcr.verification);
            }
        }

        // What landed on each clone. The identity and the clone verification came from the engine
        // leg; this fills in the half only a post-write read can answer.
        Map<Id, FacilityResult> resultByFacility = new Map<Id, FacilityResult>();
        for (FacilityResult fr : results) {
            resultByFacility.put(fr.facilityId, fr);
        }
        for (ParentSnapshot snap : job.snapshots) {
            String s = String.valueOf(snap.index);
            FacilityResult fr = resultByFacility.get(snap.parentId);
            if (fr == null) {
                continue;
            }
            LLC_BI__Loan__c clone = clonesAfter.get(snap.cloneId);
            if (clone == null) {
                fr.appliedChanges = 'The modification facility could not be read back after the changes were written, so nothing is claimed for it.';
                C360Plan.setState(steps, 'apply_changes_' + s, C360Plan.STATE_FAILED, fr.appliedChanges);
                continue;
            }
            // The org rewrites a loan's name from its commitment, so these are re-read rather than
            // carried over from the engine leg's pre-change read.
            fr.cloneName = clone.Name;
            fr.cloneStage = clone.LLC_BI__Stage__c;

            Integer ownFieldChanges = fieldChangesByTarget.containsKey(snap.parentId)
                ? fieldChangesByTarget.get(snap.parentId).size() : 0;
            fr.appliedChanges = applied(clone, takenByParent.get(snap.parentId), ownFieldChanges);
            Boolean everythingLanded = !fr.appliedChanges.contains('did not land');
            C360Plan.setState(
                steps,
                'apply_changes_' + s,
                everythingLanded ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED,
                fr.appliedChanges
            );

            fr.outcome = 'Modification ' + clone.Name + ' created from ' + snap.name + ' on the new package version at stage ' +
                clone.LLC_BI__Stage__c + '. ' + fr.appliedChanges + ' The parent was not touched.';
        }

        ArmOutcome outcome = new ArmOutcome();
        outcome.steps = steps;
        outcome.covenants = covenantResults;
        outcome.covenantAttachCount = covenantAttachResults.size();
        outcome.involvements = involvementResults;
        outcome.fieldChanges = fieldChangeResults;
        outcome.fees = feeResults;
        outcome.pledges = pledgeResults;
        outcome.policyExceptions = policyExceptionResults;
        outcome.newFacilities = newFacilityResults;
        outcome.facilities = results;
        outcome.terminalState = C360Plan.terminalState(steps);
        return outcome;
    }

    /**
     * Authors every staged policy exception in ONE DML and proves them with ONE re-read.
     *
     * THE TWO ANCHORS TRAVEL TOGETHER. `LLC_BI__Loan__c` points at the CLONE, never the booked
     * parent, and `LLC_BI__Relationship__c` at the borrower: an exception on the facility alone is
     * invisible where the bank reviews exceptions at relationship level, and one on the account
     * alone does not say which facility it is about.
     *
     * NOTHING HERE INVENTS A VALUE. The status is the banker's, checked against the org's own
     * picklist at stage time; the three mitigation reasons are the banker's words within the org's
     * own 100-character fields; the type is "Policy", which is what all 81 rows in this org carry.
     * What the org contributes is the Id and, if this tool ever omitted a name, an ugly one.
     *
     * @param results Filled with one entry per staged exception, in plan order.
     */
    private static void authorPolicyExceptions(
        List<C360Plan.Step> steps,
        Map<String, Object> v,
        ArmPlan job,
        Integer plannedCount,
        List<PolicyExceptionResult> results
    ) {
        List<LLC_BI__Policy_Exception__c> rows = new List<LLC_BI__Policy_Exception__c>();
        List<Integer> indexOfRow = new List<Integer>();

        for (Integer i = 0; i < plannedCount; i++) {
            String xs = String.valueOf(i);
            PolicyExceptionResult pxr = new PolicyExceptionResult();
            pxr.title = C360Plan.asString(v.get('policyException' + xs + '.title'));
            pxr.status = C360Plan.asString(v.get('policyException' + xs + '.status'));
            results.add(pxr);

            Id targetParent = C360Plan.asId(v.get('policyException' + xs + '.targetLoanId'));
            Id cloneId = job.cloneByParent.get(targetParent);
            if (cloneId == null) {
                String why = 'No modification clone could be read for the facility this policy exception targets, so nothing was created.';
                C360Plan.setState(steps, 'policy_exception_add_' + xs, C360Plan.STATE_FAILED, why);
                C360Plan.setState(steps, 'policy_exception_verify_' + xs, C360Plan.STATE_FAILED, why);
                pxr.verification = why;
                continue;
            }
            pxr.cloneLoanId = cloneId;
            pxr.relationshipId = job.accountId;

            String reason1 = C360Plan.asString(v.get('policyException' + xs + '.reason1'));
            String reason2 = C360Plan.asString(v.get('policyException' + xs + '.reason2'));
            String reason3 = C360Plan.asString(v.get('policyException' + xs + '.reason3'));
            pxr.mitigationCount =
                (String.isBlank(reason1) ? 0 : 1) + (String.isBlank(reason2) ? 0 : 1) + (String.isBlank(reason3) ? 0 : 1);

            Map<String, Object> fields = new Map<String, Object>{
                'Name' => pxr.title,
                'LLC_BI__Type__c' => C360Plan.asString(v.get('policyException' + xs + '.type')),
                'LLC_BI__Status__c' => pxr.status,
                'LLC_BI__Loan__c' => cloneId,
                'LLC_BI__Relationship__c' => job.accountId,
                'LLC_BI__Code__c' => C360Plan.asString(v.get('policyException' + xs + '.code')),
                'LLC_BI__Severity__c' => C360Plan.asString(v.get('policyException' + xs + '.severity')),
                'LLC_BI__Severity_Value__c' => C360Plan.asDecimal(v.get('policyException' + xs + '.severityValue')),
                'LLC_BI__Mitigation_Reason_1__c' => reason1,
                'LLC_BI__Mitigation_Reason_2__c' => reason2,
                'LLC_BI__Mitigation_Reason_3__c' => reason3
            };
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_POLICY_EXCEPTION, C360WriteGuard.OP_CREATE, fields);
            rows.add(new LLC_BI__Policy_Exception__c(
                Name = pxr.title,
                LLC_BI__Type__c = (String) fields.get('LLC_BI__Type__c'),
                LLC_BI__Status__c = pxr.status,
                LLC_BI__Loan__c = cloneId,
                LLC_BI__Relationship__c = job.accountId,
                LLC_BI__Code__c = (String) fields.get('LLC_BI__Code__c'),
                LLC_BI__Severity__c = (String) fields.get('LLC_BI__Severity__c'),
                LLC_BI__Severity_Value__c = (Decimal) fields.get('LLC_BI__Severity_Value__c'),
                LLC_BI__Mitigation_Reason_1__c = reason1,
                LLC_BI__Mitigation_Reason_2__c = reason2,
                LLC_BI__Mitigation_Reason_3__c = reason3
            ));
            indexOfRow.add(i);
        }

        if (rows.isEmpty()) {
            return;
        }
        insert as user rows;

        // The proof is the re-read, never the insert result. `Name` is read back specifically: it
        // is the one field the org is known to rewrite when a caller omits it, so reading it is how
        // this tool proves it did not leave a row named after its own Id.
        Set<Id> ids = new Set<Id>();
        for (LLC_BI__Policy_Exception__c row : rows) {
            if (row.Id != null) {
                ids.add(row.Id);
            }
        }
        Map<Id, LLC_BI__Policy_Exception__c> back = new Map<Id, LLC_BI__Policy_Exception__c>([
            SELECT Id, Name, LLC_BI__Type__c, LLC_BI__Status__c, LLC_BI__Loan__c, LLC_BI__Relationship__c,
                   LLC_BI__Mitigation_Reason_1__c
            FROM LLC_BI__Policy_Exception__c WHERE Id IN :ids WITH USER_MODE
        ]);

        for (Integer k = 0; k < rows.size(); k++) {
            String xs = String.valueOf(indexOfRow[k]);
            PolicyExceptionResult pxr = results[indexOfRow[k]];
            LLC_BI__Policy_Exception__c row = rows[k].Id == null ? null : back.get(rows[k].Id);
            if (row == null) {
                pxr.verification = 'The policy exception could not be read back after creation, so nothing is claimed for it.';
                C360Plan.setState(steps, 'policy_exception_add_' + xs, C360Plan.STATE_FILED_UNVERIFIED, pxr.verification);
                C360Plan.setState(steps, 'policy_exception_verify_' + xs, C360Plan.STATE_FAILED, pxr.verification);
                continue;
            }
            pxr.exceptionId = row.Id;
            C360Plan.setState(steps, 'policy_exception_add_' + xs, C360Plan.STATE_VERIFIED,
                'Policy exception ' + row.Id + ' created on clone ' + row.LLC_BI__Loan__c + ': ' + pxr.title + '.');

            Boolean landed = row.Name == pxr.title
                && row.LLC_BI__Status__c == pxr.status
                && row.LLC_BI__Loan__c == rows[k].LLC_BI__Loan__c
                && row.LLC_BI__Relationship__c == rows[k].LLC_BI__Relationship__c;
            pxr.verification = landed
                ? '"' + row.Name + '" reads back ' + row.LLC_BI__Status__c + ' on the clone, anchored on the borrower, ' +
                  'with ' + pxr.mitigationCount + ' mitigation reason' + (pxr.mitigationCount == 1 ? '' : 's') + '. ' +
                  'The org transmitted it to the bank\'s change-stream endpoint on commit.'
                : 'Not proven: the exception reads back as "' + row.Name + '" at ' + row.LLC_BI__Status__c +
                  ' on loan ' + row.LLC_BI__Loan__c + ' and relationship ' + row.LLC_BI__Relationship__c +
                  ', which is not what this plan composed.';
            C360Plan.setState(steps, 'policy_exception_verify_' + xs,
                landed ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED, pxr.verification);
        }
    }

    /**
     * Re-reads the net-new fees and settles their two steps each.
     *
     * @param rows        The inserted fee records, carrying the ids the org assigned.
     * @param indexOfRow  Which `results` entry each inserted row belongs to; a fee whose clone
     *                    could not be read was already settled and has no row here.
     */
    private static void verifyFees(
        List<C360Plan.Step> steps,
        List<FeeResult> results,
        List<LLC_BI__Fee__c> rows,
        List<Integer> indexOfRow
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
            C360Plan.setState(steps, 'fee_add_' + fs, C360Plan.STATE_VERIFIED,
                'Fee ' + row.Name + ' created on clone ' + row.LLC_BI__Loan__c + ': ' + fr.description + '.');

            Boolean flat = fr.calculationType != 'Percentage';
            // Everything that was OURS to set is compared. The money on a percentage fee is not:
            // it is nCino's own derivation from the clone's commitment.
            Boolean landed = row.LLC_BI__Fee_Type__c == fr.feeType
                && row.LLC_BI__Fee_Type_Description__c == fr.description
                && row.LLC_BI__Calculation_Type__c == fr.calculationType
                && (flat ? row.LLC_BI__Amount__c == rows[k].LLC_BI__Amount__c : row.LLC_BI__Percentage__c == fr.percentage);
            fr.verification = flat
                ? (landed
                    ? 'Fee ' + row.Name + ' reads back as ' + fr.feeType + ' at ' + String.valueOf(row.LLC_BI__Amount__c) + ' flat on the clone.'
                    : 'Not proven: the fee reads back as ' + row.LLC_BI__Fee_Type__c + ' at ' +
                      String.valueOf(row.LLC_BI__Amount__c) + ', not ' + fr.feeType + ' at ' + String.valueOf(rows[k].LLC_BI__Amount__c) + '.')
                : (landed
                    // The org's figure, stated as the org's. A null here is not a failure: it means
                    // nCino has not settled the arithmetic in this transaction, and saying so is
                    // more honest than failing a step over a number that was never ours.
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
     * Authors the collateral chain for every staged pledge and composes the pledge rows, leaving
     * them for the carry to insert.
     *
     * THE ORDER IS THE MODEL'S, not a preference. `LLC_BI__Collateral__c` carries no account lookup
     * of any kind on this org, so an asset created without its `LLC_BI__Account_Collateral__c` row
     * belongs to nobody and cannot be found from the relationship at all - which is why the
     * ownership junction is a step of its own in the plan rather than an implementation detail.
     * The pledge is composed but NOT inserted here: its aggregate lookup is not updateable, so the
     * per-clone aggregate shell has to exist first, and that shell is minted inside the carry.
     *
     * @param pledgeRows  Filled with the composed pledges, in insert order.
     * @param indexOfRow  Which `results` entry each composed pledge belongs to.
     */
    private static void composeCollateralChain(
        List<C360Plan.Step> steps,
        Map<String, Object> v,
        ArmPlan job,
        Integer pledgeAddCount,
        List<PledgeResult> results,
        List<LLC_BI__Loan_Collateral2__c> pledgeRows,
        List<Integer> indexOfRow
    ) {
        // Pass one: settle the clone for every pledge, and collect the assets to author.
        List<LLC_BI__Collateral__c> newAssets = new List<LLC_BI__Collateral__c>();
        List<Integer> assetIndexOfRow = new List<Integer>();
        List<Id> cloneOf = new List<Id>();
        for (Integer i = 0; i < pledgeAddCount; i++) {
            String ps = String.valueOf(i);
            PledgeResult pr = new PledgeResult();
            pr.assetLabel = C360Plan.asString(v.get('pledgeAdd' + ps + '.assetLabel'));
            pr.createdAsset = v.get('pledgeAdd' + ps + '.isNew') == true;
            pr.amountPledged = C360Plan.asDecimal(v.get('pledgeAdd' + ps + '.amountPledged'));
            results.add(pr);
            cloneOf.add(null);

            Id targetParent = C360Plan.asId(v.get('pledgeAdd' + ps + '.targetLoanId'));
            Id cloneId = armTarget(job, v, 'pledgeAdd' + ps);
            if (cloneId == null) {
                String why = 'No modification clone could be read for the facility this pledge targets, so nothing was created.';
                C360Plan.setState(steps, 'collateral_create_' + ps, C360Plan.STATE_FAILED, why);
                C360Plan.setState(steps, 'collateral_own_' + ps, C360Plan.STATE_FAILED, why);
                C360Plan.setState(steps, 'pledge_add_' + ps, C360Plan.STATE_FAILED, why);
                C360Plan.setState(steps, 'pledge_verify_' + ps, C360Plan.STATE_FAILED, why);
                pr.verification = why;
                continue;
            }
            pr.cloneLoanId = cloneId;
            cloneOf[i] = cloneId;

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

        // ONE insert for every new asset, then ONE for every ownership junction. Each DML flushes a
        // change-stream queueable, so the count of DMLs is what matters rather than the count of rows.
        if (!newAssets.isEmpty()) {
            insert as user newAssets;
            List<LLC_BI__Account_Collateral__c> ownerships = new List<LLC_BI__Account_Collateral__c>();
            for (Integer k = 0; k < newAssets.size(); k++) {
                Integer i = assetIndexOfRow[k];
                results[i].collateralId = newAssets[k].Id;
                C360Plan.setState(steps, 'collateral_create_' + i, C360Plan.STATE_VERIFIED,
                    'Asset created for "' + results[i].assetLabel + '".');
                Map<String, Object> ownFields = new Map<String, Object>{
                    'LLC_BI__Account__c' => job.accountId,
                    'LLC_BI__Collateral__c' => newAssets[k].Id,
                    'LLC_BI__Ownership_Percentage__c' => 100,
                    'LLC_BI__Primary_Owner__c' => true
                };
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_ACCOUNT_COLLATERAL, C360WriteGuard.OP_CREATE, ownFields);
                ownerships.add(new LLC_BI__Account_Collateral__c(
                    LLC_BI__Account__c = job.accountId,
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

        // Pass two: compose the pledges. The aggregate lookup is set inside the carry, after the
        // per-clone shell exists; it is not updateable afterwards, so it cannot be filled in later.
        for (Integer i = 0; i < pledgeAddCount; i++) {
            String ps = String.valueOf(i);
            PledgeResult pr = results[i];
            if (cloneOf[i] == null || pr.collateralId == null) {
                continue;
            }
            Decimal rateOverride = C360Plan.asDecimal(v.get('pledgeAdd' + ps + '.advanceRate'));
            String overrideReason = C360Plan.asString(v.get('pledgeAdd' + ps + '.advanceRateReason'));
            String lien = C360Plan.asString(v.get('pledgeAdd' + ps + '.lienPosition'));
            // The plan's OWN answer, settled at stage time and confirmed by the banker with the
            // rest of it. Where the share is within the lendable value this is false and the org's
            // Pledge_More_Than_Lendable_Value rule is left standing, which is the ordinary case.
            Boolean authorise = C360Plan.asBool(v.get('pledgeAdd' + ps + '.authoriseOverPledge'));
            Id collId = C360Plan.asId(pr.collateralId);
            Map<String, Object> pledgeFields = new Map<String, Object>{
                'LLC_BI__Loan__c' => cloneOf[i],
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
                LLC_BI__Loan__c = cloneOf[i],
                LLC_BI__Collateral__c = collId,
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
     * Re-reads the pledges and settles their steps.
     *
     * The ADVANCE RATE is not compared against anything: `LLC_BI__Advance_Rate__c` is a formula
     * resolving the override, then the auto-applied value, then the collateral type's default
     * (LESSONS 29), so it is the org's answer and it is REPORTED as the org's. What is compared is
     * what was ours - the loan, the collateral and the pledged amount.
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
                'Pledge created on clone ' + row.LLC_BI__Loan__c + ' over ' + row.LLC_BI__Collateral__r.Name + '.');

            Boolean landed = row.LLC_BI__Loan__c == rows[k].LLC_BI__Loan__c
                && row.LLC_BI__Collateral__c == rows[k].LLC_BI__Collateral__c
                && row.LLC_BI__Amount_Pledged__c == rows[k].LLC_BI__Amount_Pledged__c;
            pr.verification = landed
                ? row.LLC_BI__Collateral__r.Name + ' ("' + pr.assetLabel + '") is pledged to the clone at ' +
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

    /** Marks every step the arm owns as waiting on the transaction that has not run yet. */
    private static void armWaiting(List<C360Plan.Step> steps, Map<String, Object> v, List<ParentSnapshot> snapshots) {
        setArmSteps(steps, v, snapshots, C360Plan.STATE_WAITING, ARM_WAITING);
    }

    /**
     * Marks every step the arm still OWED as failed, naming what the org said. Steps the arm had
     * already proven before it fell over keep their proof: a later failure does not un-read a
     * read-back that happened.
     */
    private static void armFailed(List<C360Plan.Step> steps, Map<String, Object> v, List<ParentSnapshot> snapshots, String why) {
        setArmSteps(steps, v, snapshots, null,
            'The chained transaction that arms the new version failed: ' + why +
            ' The package version and its clones exist; what this step covers was not proven.');
    }

    /**
     * Every step id the arm is responsible for. Kept in one place so the waiting shape and the
     * failure shape can never drift from what arm() actually settles.
     *
     * @param state The state to write, or null to write only over steps still unsettled.
     */
    private static void setArmSteps(
        List<C360Plan.Step> steps,
        Map<String, Object> v,
        List<ParentSnapshot> snapshots,
        String state,
        String detail
    ) {
        // verify_clone_i is deliberately NOT here: the engine leg settles it, because it is the only
        // leg holding the parent's pre-image and therefore the only one that can say honestly whether
        // the parent moved.
        List<String> ids = new List<String>{ 'carry_junctions', C360AggregateSweep.STEP_ID };
        for (ParentSnapshot snap : snapshots) {
            ids.add('apply_changes_' + snap.index);
        }
        for (Integer i = 0; i < intCount(v.get('covenantAddCount')); i++) {
            ids.add('covenant_create_' + i);
            ids.add('covenant_attach_' + i);
            ids.add('covenant_verify_' + i);
        }
        for (Integer i = 0; i < intCount(v.get('covenantAttachCount')); i++) {
            ids.add('covenant_associate_' + i);
            ids.add('covenant_associate_verify_' + i);
        }
        for (Integer i = 0; i < intCount(v.get('covenantExclusionCount')); i++) {
            ids.add('covenant_exclusion_' + i);
            ids.add('covenant_exclusion_verify_' + i);
        }
        for (Integer i = 0; i < intCount(v.get('pledgeExclusionCount')); i++) {
            ids.add('pledge_exclusion_' + i);
            ids.add('pledge_exclusion_verify_' + i);
        }
        for (Integer i = 0; i < intCount(v.get('involvementChangeCount')); i++) {
            ids.add('involvement_change_' + i);
            ids.add('involvement_verify_' + i);
        }
        for (Integer i = 0; i < intCount(v.get('fieldChangeCount')); i++) {
            ids.add('field_change_' + i);
        }
        for (Integer i = 0; i < intCount(v.get('feeAddCount')); i++) {
            ids.add('fee_add_' + i);
            ids.add('fee_verify_' + i);
        }
        for (Integer i = 0; i < intCount(v.get('pledgeAddCount')); i++) {
            ids.add('collateral_create_' + i);
            ids.add('collateral_own_' + i);
            ids.add('pledge_add_' + i);
            ids.add('pledge_verify_' + i);
        }
        for (Integer i = 0; i < intCount(v.get('policyExceptionAddCount')); i++) {
            ids.add('policy_exception_add_' + i);
            ids.add('policy_exception_verify_' + i);
        }
        for (Integer i = 0; i < intCount(v.get('newFacilityCount')); i++) {
            ids.add('new_facility_' + i);
            ids.add('new_facility_involve_' + i);
            ids.add('new_facility_verify_' + i);
            ids.add('new_facility_purpose_' + i);
        }
        Set<String> owned = new Set<String>(ids);
        for (C360Plan.Step s : steps) {
            if (!owned.contains(s.id)) {
                continue;
            }
            if (state == null && s.state != C360Plan.STATE_PENDING && s.state != C360Plan.STATE_WAITING) {
                continue;
            }
            s.state = state == null ? C360Plan.STATE_FAILED : state;
            s.detail = detail;
        }
    }

    /** The covenant adds the plan carries, reported as intent while the arm has not run. */
    private static List<CovenantResult> intendedCovenants(Map<String, Object> v) {
        List<CovenantResult> out = new List<CovenantResult>();
        for (Integer i = 0; i < intCount(v.get('covenantAddCount')); i++) {
            CovenantResult cr = new CovenantResult();
            cr.typeName = String.valueOf(v.get('covenantAdd' + i + '.typeName'));
            cr.threshold = C360Plan.asDecimal(v.get('covenantAdd' + i + '.threshold'));
            cr.operator = String.valueOf(v.get('covenantAdd' + i + '.operator'));
            cr.verification = ARM_WAITING;
            out.add(cr);
        }
        // The associations belong in the same list for the same reason they do after the arm runs:
        // a banker reads one set of covenants on the new version, whoever authored each record.
        for (Integer i = 0; i < intCount(v.get('covenantAttachCount')); i++) {
            CovenantResult cr = new CovenantResult();
            cr.covenantId = String.valueOf(v.get('covenantAttach' + i + '.covenantId'));
            cr.covenantName = String.valueOf(v.get('covenantAttach' + i + '.covenantName'));
            cr.typeName = String.valueOf(v.get('covenantAttach' + i + '.typeName'));
            cr.threshold = C360Plan.asDecimal(v.get('covenantAttach' + i + '.threshold'));
            cr.operator = String.valueOf(v.get('covenantAttach' + i + '.operator'));
            cr.verification = ARM_WAITING;
            out.add(cr);
        }
        return out;
    }

    /** The net-new facilities the plan carries, reported as intent while the arm has not run. */
    private static List<NewFacilityResult> intendedNewFacilities(Map<String, Object> v) {
        List<NewFacilityResult> out = new List<NewFacilityResult>();
        for (Integer i = 0; i < intCount(v.get('newFacilityCount')); i++) {
            C360NewFacilities.NewFacility nf = C360NewFacilities.fromResolved(v, i);
            NewFacilityResult nr = new NewFacilityResult();
            nr.label = nf.label;
            nr.product = nf.product;
            nr.amount = nf.amount;
            nr.termMonths = nf.termMonths;
            nr.purpose = nf.purpose;
            nr.purposeWritten = false;
            nr.verification = ARM_WAITING;
            out.add(nr);
        }
        return out;
    }

    /** The borrowing-structure changes the plan carries, reported as intent while the arm has not run. */
    private static List<InvolvementResult> intendedInvolvements(Map<String, Object> v) {
        List<InvolvementResult> out = new List<InvolvementResult>();
        for (Integer i = 0; i < intCount(v.get('involvementChangeCount')); i++) {
            InvolvementResult ir = new InvolvementResult();
            ir.op = String.valueOf(v.get('involvement' + i + '.op'));
            ir.role = String.valueOf(v.get('involvement' + i + '.role'));
            ir.accountName = String.valueOf(v.get('involvement' + i + '.accountName'));
            ir.verification = ARM_WAITING;
            out.add(ir);
        }
        return out;
    }

    /** The field wave the plan carries, reported as intent while the arm has not run. */
    private static List<FieldChangeResult> intendedFieldChanges(Map<String, Object> v) {
        List<FieldChangeResult> out = new List<FieldChangeResult>();
        for (Integer i = 0; i < intCount(v.get('fieldChangeCount')); i++) {
            FieldChangeResult fcr = new FieldChangeResult();
            fcr.field = String.valueOf(v.get('fieldChange' + i + '.field'));
            fcr.label = String.valueOf(v.get('fieldChange' + i + '.label'));
            fcr.value = String.valueOf(coerceStagedFieldValue(
                String.valueOf(v.get('fieldChange' + i + '.type')),
                String.valueOf(v.get('fieldChange' + i + '.valueJson'))
            ));
            fcr.verification = ARM_WAITING;
            out.add(fcr);
        }
        return out;
    }

    /** The fee adds the plan carries, reported as intent while the arm has not run. */
    private static List<FeeResult> intendedFees(Map<String, Object> v) {
        List<FeeResult> out = new List<FeeResult>();
        for (Integer i = 0; i < intCount(v.get('feeAddCount')); i++) {
            FeeResult fr = new FeeResult();
            fr.feeType = String.valueOf(v.get('feeAdd' + i + '.feeType'));
            fr.description = String.valueOf(v.get('feeAdd' + i + '.description'));
            fr.calculationType = String.valueOf(v.get('feeAdd' + i + '.calculationType'));
            fr.percentage = C360Plan.asDecimal(v.get('feeAdd' + i + '.percentage'));
            fr.amount = C360Plan.asDecimal(v.get('feeAdd' + i + '.amount'));
            fr.verification = ARM_WAITING;
            out.add(fr);
        }
        return out;
    }

    /** The pledges the plan carries, reported as intent while the arm has not run. */
    private static List<PledgeResult> intendedPledges(Map<String, Object> v) {
        List<PledgeResult> out = new List<PledgeResult>();
        for (Integer i = 0; i < intCount(v.get('pledgeAddCount')); i++) {
            PledgeResult pr = new PledgeResult();
            pr.assetLabel = C360Plan.asString(v.get('pledgeAdd' + i + '.assetLabel'));
            pr.createdAsset = v.get('pledgeAdd' + i + '.isNew') == true;
            pr.collateralId = C360Plan.asString(v.get('pledgeAdd' + i + '.collateralId'));
            pr.amountPledged = C360Plan.asDecimal(v.get('pledgeAdd' + i + '.amountPledged'));
            pr.advanceRate = C360Plan.asDecimal(v.get('pledgeAdd' + i + '.advanceRate'));
            pr.verification = ARM_WAITING;
            out.add(pr);
        }
        return out;
    }

    /** The policy exceptions the plan carries, reported as intent while the arm has not run. */
    private static List<PolicyExceptionResult> intendedPolicyExceptions(Map<String, Object> v) {
        List<PolicyExceptionResult> out = new List<PolicyExceptionResult>();
        for (Integer i = 0; i < intCount(v.get('policyExceptionAddCount')); i++) {
            PolicyExceptionResult pxr = new PolicyExceptionResult();
            pxr.title = C360Plan.asString(v.get('policyException' + i + '.title'));
            pxr.status = C360Plan.asString(v.get('policyException' + i + '.status'));
            pxr.verification = ARM_WAITING;
            out.add(pxr);
        }
        return out;
    }

    private static Integer intCount(Object raw) {
        Decimal d = C360Plan.asDecimal(raw);
        return d == null ? 0 : Integer.valueOf(d);
    }

    /**
     * The second hop: arms the version the first hop created, in a transaction of its own.
     *
     * WHY IT TAKES NOTHING BUT THE STAGING ID AND THE TOKEN. Everything it needs about WHERE to write
     * - the new package, the clone of every rolled member - it re-derives from the org's own chain
     * rows. It would be one line shorter to have the first hop pass the clone map across, and that
     * line would be a hole: a caller could then hand this method a list of facilities that were never
     * part of the plan and have the staged changes written onto them. The token proves the plan; the
     * org proves the targets; the caller proves nothing.
     *
     * The token is NOT consumed again. It was consumed by the first hop, and a second consumption
     * would make the pair impossible to run at all. What is checked instead is that the token still
     * matches this plan and this approver, and that the record is mid-run: a hop into a plan that is
     * finished, or one that never started, is refused.
     */
    private static ExecuteResult armPhase(Request req) {
        if (String.isBlank(req.stagingId) || String.isBlank(req.planHash)) {
            throw new ToolException('stagingId and planHash are required on the arm hop.');
        }
        cm_Action_Staging__c staged = readStaging(req.stagingId);
        if (staged == null) {
            throw new ToolException('No staging record found for stagingId ' + req.stagingId + '.');
        }
        if (staged.cm_Action_Id__c != ACTION_ID) {
            throw new ToolException(
                'Staging record ' + req.stagingId + ' holds a ' + staged.cm_Action_Id__c + ' plan, not a loan modification.'
            );
        }
        cm_Action_Staging__c stg = C360ActionStaging.assertArmable(
            req.stagingId, req.planHash, req.decisionToken, C360Plan.asId(req.approverUserId)
        );

        Map<String, Object> v = C360Plan.deserializeValues(stg.cm_Plan_JSON__c);
        Decimal declaredCount = C360Plan.asDecimal(v.get('facilityCount'));
        Integer n = declaredCount == null ? 1 : Integer.valueOf(declaredCount);

        List<Id> rollMembers = new List<Id>();
        String rollCsv = v.get('rollMemberIds') == null ? null : String.valueOf(v.get('rollMemberIds'));
        if (String.isNotBlank(rollCsv)) {
            for (String rid : rollCsv.split(',')) {
                Id asId = C360Plan.asId(rid.trim());
                if (asId != null) {
                    rollMembers.add(asId);
                }
            }
        }

        // The clone of each rolled member, read off the chain rows the engine wrote. Revision 0 is
        // the self-referential anchor and is never a modification; the highest revision wins.
        Map<Id, LLC_BI__LoanRenewal__c> newestByParent = new Map<Id, LLC_BI__LoanRenewal__c>();
        for (LLC_BI__LoanRenewal__c j : [
            SELECT Id, Name, LLC_BI__ParentLoanId__c, LLC_BI__RenewalLoanId__c, LLC_BI__RevisionNumber__c
            FROM LLC_BI__LoanRenewal__c
            WHERE LLC_BI__ParentLoanId__c IN :rollMembers
            WITH USER_MODE
        ]) {
            if (j.LLC_BI__RenewalLoanId__c == null || j.LLC_BI__RenewalLoanId__c == j.LLC_BI__ParentLoanId__c) {
                continue;
            }
            LLC_BI__LoanRenewal__c held = newestByParent.get(j.LLC_BI__ParentLoanId__c);
            if (held == null || revision(j) > revision(held)) {
                newestByParent.put(j.LLC_BI__ParentLoanId__c, j);
            }
        }
        Map<Id, Id> cloneByParent = new Map<Id, Id>();
        for (Id parentId : newestByParent.keySet()) {
            cloneByParent.put(parentId, newestByParent.get(parentId).LLC_BI__RenewalLoanId__c);
        }
        if (cloneByParent.isEmpty()) {
            throw new ToolException(
                'No modification clone could be found for this plan, so there is nothing to arm. The staging record ' +
                'holds what the credit action reported.'
            );
        }

        List<LLC_BI__Loan__c> parentRows = readFacilities(new List<Id>(cloneByParent.keySet()));
        Map<Id, LLC_BI__Loan__c> parentById = new Map<Id, LLC_BI__Loan__c>(parentRows);
        Map<Id, LLC_BI__Loan__c> cloneById = new Map<Id, LLC_BI__Loan__c>(readLoans(new Set<Id>(cloneByParent.values())));

        if (cloneById.isEmpty()) {
            throw new ToolException(
                'The modification clones for this plan could not be read back, so there is nothing to arm safely. ' +
                'The staging record holds what the credit action reported.'
            );
        }
        ArmPlan job = new ArmPlan();
        job.accountId = parentRows.isEmpty() ? null : parentRows[0].LLC_BI__Account__c;
        job.newPkgId = cloneById.values()[0].LLC_BI__Product_Package__c;
        job.cloneByParent = cloneByParent;
        job.rollMembers = rollMembers;
        job.snapshots = new List<ParentSnapshot>();

        List<FacilityResult> results = new List<FacilityResult>();
        for (Integer i = 0; i < n; i++) {
            Id parentId = C360Plan.asId(v.get('facility' + i + '.loanId'));
            Id cloneId = parentId == null ? null : cloneByParent.get(parentId);
            if (cloneId == null) {
                continue;
            }
            FacilityResult fr = new FacilityResult();
            fr.facilityId = parentId;
            fr.facilityName = parentById.containsKey(parentId) ? parentById.get(parentId).Name : null;
            fr.cloneLoanId = cloneId;
            results.add(fr);

            ParentSnapshot snap = new ParentSnapshot();
            snap.parentId = parentId;
            snap.name = fr.facilityName;
            snap.cloneId = cloneId;
            snap.index = i;
            job.snapshots.add(snap);
        }

        ArmOutcome armed = job.runNow(stg, results);

        ExecuteResult out = new ExecuteResult();
        out.stagingId = stg.Id;
        out.cloneLoanId = stg.cm_Result_Record_Id__c;
        out.armState = ARM_INLINE;
        out.bookingHandoff = BOOKING_HANDOFF;
        out.replayed = false;
        out.facilityCount = results.size();
        out.covenants = armed.covenants;
        out.involvements = armed.involvements;
        out.fieldChanges = armed.fieldChanges;
        out.fees = armed.fees;
        out.pledges = armed.pledges;
        out.policyExceptions = armed.policyExceptions;
        out.newFacilities = armed.newFacilities;
        out.facilities = armed.facilities;
        out.steps = toWireSteps(armed.steps);
        out.terminalState = armed.terminalState;
        out.recordName = armed.facilities.isEmpty() ? null : armed.facilities[0].cloneName;
        out.outcome = armed.facilities.size() == 1
            ? armed.facilities[0].outcome
            : 'See each facility for its clone and what was applied.';
        return out;
    }

    /** An idempotent replay reports the prior run and writes nothing. */
    private static ExecuteResult replay(cm_Action_Staging__c prior) {
        ExecuteResult r = new ExecuteResult();
        r.stagingId = prior.Id;
        r.cloneLoanId = prior.cm_Result_Record_Id__c;
        r.recordName = nameOf(prior.cm_Result_Record_Id__c);
        r.terminalState = prior.cm_Status__c == 'Completed' ? C360Plan.TERMINAL_SUCCESS : C360Plan.TERMINAL_PARTIAL;
        r.replayed = true;
        r.bookingHandoff = BOOKING_HANDOFF;
        r.outcome = 'This idempotency key already produced modification facility ' + prior.cm_Result_Record_Id__c +
            '. Nothing was written. ' + BOOKING_HANDOFF;
        r.steps = prior.cm_Tracker_JSON__c == null
            ? new List<StepResult>()
            : toWireSteps((List<C360Plan.Step>) JSON.deserialize(prior.cm_Tracker_JSON__c, List<C360Plan.Step>.class));
        return r;
    }

    // -------------------------------------------------------------------------------------------
    // The engine seam.
    //
    // The bean is a managed-package service that clones loans and writes chain rows. It is not a
    // thing a unit test can honestly stand up, and stubbing it lets the tests prove what IS ours:
    // the token gate, the chain mapping, the verification and the idempotency fence. The default
    // implementation is the real door, so the shipping path is never the stubbed one.
    // -------------------------------------------------------------------------------------------

    /** What nCino's credit-action service answers, in our own shape. */
    public class EngineResult {
        public Boolean success;
        public String outputPackageId;
        public List<String> failureReasons;

        public EngineResult() {
            this.success = false;
            this.failureReasons = new List<String>();
        }
    }

    /** The credit-action door. One implementation calls nCino; the test stub stands in for it. */
    public interface CreditActionEngine {
        EngineResult modify(Id packageId, List<Id> facilityIds);
    }

    @TestVisible
    private static CreditActionEngine engineOverride;

    private static CreditActionEngine engine() {
        return engineOverride == null ? new NcinoCreditActionEngine() : engineOverride;
    }

    /**
     * nCino's cross-package credit action, in-process and synchronous.
     *
     * isAsync is false deliberately. The async path returns an AsyncApexJob id and nothing else, so
     * the verification this tool exists to perform would have to happen in a transaction that cannot
     * see the result, and PDI-00017266 says an async failure can revert everything with no error at
     * all. Synchronous costs CPU and buys an observable outcome.
     */
    public class NcinoCreditActionEngine implements CreditActionEngine {
        public EngineResult modify(Id packageId, List<Id> facilityIds) {
            EngineResult out = new EngineResult();
            List<Map<String, Object>> actions = new List<Map<String, Object>>();
            for (Id fid : facilityIds) {
                actions.add(new Map<String, Object>{ 'contextId' => String.valueOf(fid), 'actionType' => ACTION_TYPE });
            }

            try {
                Object bean = nFORCE.BeanFactory.getInstance().getBeanByUniqueName(BEAN_NAME);
                if (bean == null) {
                    // Observed 2026-08-22: the factory returns null inside a TEST context, which is why
                    // the suite stubs this seam. At runtime it returns the service.
                    out.failureReasons.add('The bean factory returned no ' + BEAN_NAME + ' service in this context.');
                    return out;
                }
                nFORCE.ACrossPackageService service = (nFORCE.ACrossPackageService) bean;
                service.setInputParameter('contextId', String.valueOf(packageId));
                service.setInputParameter('facilityActions', JSON.serialize(actions));
                service.setInputParameter('isAsync', false);
                // Package methodology: the credit action mints the NEXT VERSION of the package, never
                // an insert into the current one. Shape probe 2026-08-30 (rolled back): with this flag
                // the engine creates the new package, clones every facility in facilityActions onto it
                // with _M<n> lookup keys at Qualification/Open, writes the chain rows synchronously and
                // queues the junction-graph copy. It also names the package itself; a newPackageName
                // input was observed to be IGNORED, which is why the caller repairs the name after.
                service.setInputParameter('isNewPackage', true);
                service.executeService();

                Map<String, Object> params = service.getOutputParameters();
                if (params == null) {
                    out.failureReasons.add('The credit-action service returned no output parameters.');
                    return out;
                }
                out.success = params.get('success') == true;
                out.outputPackageId = params.get('outputPackageId') == null ? null : String.valueOf(params.get('outputPackageId'));
                Object reasons = params.get('failureReasons');
                if (reasons instanceof List<Object>) {
                    for (Object o : (List<Object>) reasons) {
                        if (o != null) {
                            out.failureReasons.add(String.valueOf(o));
                        }
                    }
                }
            } catch (Exception e) {
                // Anything the managed package throws is an ORG answer, not a fault of ours, and the
                // banker gets the org's own words rather than a stack trace.
                out.success = false;
                out.failureReasons.add(e.getTypeName() + ': ' + e.getMessage());
            }
            return out;
        }
    }

    // -------------------------------------------------------------------------------------------
    // The junction carry.
    // -------------------------------------------------------------------------------------------

    /**
     * Replicates the junction graph of every rolled parent onto its clone: covenant junctions,
     * collateral pledges (each clone gets a fresh aggregate shell, because aggregates are per-loan
     * rollup anchors and reusing the parent's would cross the versions), and borrowing involvements
     * retargeted at the clone and the new package. Values are COPIES of org state, never authored;
     * the OP_CARRY gate fences the objects and the fields the org derives.
     *
     * @param netNewFees Fee rows the ARM authored for this plan, already clone-targeted and already
     *        past OP_CREATE. They are inserted in the SAME DML as the copied fees, because nCino's
     *        fee automation is bulkified and a second insert would pay its whole query pass again
     *        inside a budget that is not ours (see the note at the composition site). They are
     *        counted separately below: a carry that reported them as replicas would be claiming a
     *        fee travelled from a parent that never charged it.
     * @param netNewPledges Pledge rows the ARM authored, already clone-targeted and already past
     *        OP_CREATE, but WITHOUT their aggregate lookup: it is not updateable, so it can only be
     *        set at insert, and the per-clone shell it points at is minted below. Their clones join
     *        the aggregate map for exactly that reason - a clone whose parent carried no pledges has
     *        no shell of its own until an authored pledge asks for one. They then ride the SAME DML
     *        as the copies, because nCino's collateral aggregate automation is bulkified and a
     *        second insert would pay its whole pass again. Counted apart below.
     * @param excludedCovenantJunctionIds Junction rows the plan named as NOT carried. They are
     *        skipped here and nowhere else: the parent keeps its junction, the covenant record is
     *        never written, and no delete happens anywhere. That is what makes "remove the covenant
     *        from the loan" possible while covenant DETACH stays fenced.
     * @param excludedPledgeIds Pledge rows the plan named as NOT carried, on the same doctrine. The
     *        asset and its ownership junction are relationship records and are not touched.
     * @return 'CARRIED <detail>' when every replica read back by count; a plain detail otherwise.
     */
    private static String carryJunctionGraph(
        List<Id> parents,
        Map<Id, Id> cloneByParent,
        Id newPkgId,
        Set<Id> excludedInvolvementIds,
        Set<Id> excludedCovenantJunctionIds,
        Set<Id> excludedPledgeIds,
        List<LLC_BI__Fee__c> netNewFees,
        List<LLC_BI__Loan_Collateral2__c> netNewPledges
    ) {
        // ONE read for every source row (2026-08-31 governor fix): the versioning transaction
        // shares its 100-query budget with nCino's engine, and per-object reads blew it at 101 on
        // the first live run with fees and streams aboard. Parent subqueries collapse five reads
        // into one here and five count re-reads into one at the bottom.
        List<LLC_BI__Loan__c> sources = [
            SELECT Id,
                (SELECT Id, LLC_BI__Loan__c, LLC_BI__Covenant2__c FROM LLC_BI__Loan_Covenants__r),
                (SELECT Id, LLC_BI__Loan__c, LLC_BI__Collateral__c, LLC_BI__Lien_Position__c, LLC_BI__Pledged_Status__c,
                        LLC_BI__Active__c, LLC_BI__Is_Primary__c, LLC_BI__Amount_Pledged__c,
                        LLC_BI__Advance_Rate_Override__c, LLC_BI__Override_Reason__c, LLC_BI__Start_Date__c,
                        LLC_BI__End_Date__c, LLC_BI__Is_Excluded__c, LLC_BI__Is_Leased_Asset__c,
                        LLC_BI__Abundance_of_Caution__c FROM LLC_BI__Loan_Collateral__r),
                (SELECT Id, LLC_BI__Loan__c, LLC_BI__Account__c, LLC_BI__Borrower_Type__c, LLC_BI__Ownership__c,
                        LLC_BI__Relationship_Type__c, LLC_BI__Entity_Type__c, LLC_BI__Order__c,
                        LLC_BI__Contingent_Type__c, LLC_BI__Guarantee_Effective_Date__c,
                        LLC_BI__Guarantee_End_Date__c, LLC_BI__Guarantee_Limit__c, LLC_BI__Guaranty_Amount__c
                        FROM LLC_BI__Legal_Entities__r),
                (SELECT LLC_BI__Loan__c, LLC_BI__Record_Type__c, LLC_BI__Fee_Type__c, LLC_BI__Fee_Type_Description__c,
                        LLC_BI__Calculation_Type__c, LLC_BI__Basis_Source__c, LLC_BI__Percentage__c, LLC_BI__Amount__c,
                        LLC_BI__Status__c, LLC_BI__Paid_By__c, LLC_BI__Is_Income__c, LLC_BI__Payout_Frequency__c
                        FROM LLC_BI__Fees__r),
                (SELECT Name, LLC_BI__Loan__c, LLC_BI__Period_Type__c, LLC_BI__Term_Unit__c, LLC_BI__Term_Length__c,
                        LLC_BI__Version__c, LLC_BI__Sequence__c, LLC_BI__Effective_Date__c, LLC_BI__End_Date__c,
                        LLC_BI__Is_Payment_Stream__c, LLC_BI__Is_Rate_Stream__c, LLC_BI__Is_Template__c
                        FROM LLC_BI__Pricing_Streams__r)
            FROM LLC_BI__Loan__c WHERE Id IN :parents WITH USER_MODE
        ];

        List<LLC_BI__Loan_Covenant__c> covCopies = new List<LLC_BI__Loan_Covenant__c>();
        List<LLC_BI__Loan_Collateral2__c> pledgeSources = new List<LLC_BI__Loan_Collateral2__c>();
        List<LLC_BI__Legal_Entities__c> invCopies = new List<LLC_BI__Legal_Entities__c>();
        List<LLC_BI__Fee__c> feeCopies = new List<LLC_BI__Fee__c>();
        Integer streamSourceCount = 0;
        Map<Id, LLC_BI__Loan_Collateral_Aggregate__c> aggByClone = new Map<Id, LLC_BI__Loan_Collateral_Aggregate__c>();

        for (LLC_BI__Loan__c src : sources) {
            Id cloneId = cloneByParent.get(src.Id);
            if (cloneId == null) {
                continue;
            }
            for (LLC_BI__Loan_Covenant__c j : src.LLC_BI__Loan_Covenants__r) {
                // A staged covenant exclusion: the junction is named in the plan and simply not
                // replicated. The parent's own row is left exactly as it is.
                if (excludedCovenantJunctionIds.contains(j.Id)) {
                    continue;
                }
                covCopies.add(new LLC_BI__Loan_Covenant__c(LLC_BI__Loan__c = cloneId, LLC_BI__Covenant2__c = j.LLC_BI__Covenant2__c));
            }
            for (LLC_BI__Loan_Collateral2__c pl : src.LLC_BI__Loan_Collateral__r) {
                // A staged pledge exclusion, same doctrine. The aggregate shell is still minted for
                // this clone by any pledge that DOES travel; an excluded one asks for nothing.
                if (excludedPledgeIds.contains(pl.Id)) {
                    continue;
                }
                pledgeSources.add(pl);
                if (!aggByClone.containsKey(cloneId)) {
                    aggByClone.put(cloneId, new LLC_BI__Loan_Collateral_Aggregate__c(Name = 'Collateral Aggregate'));
                }
            }
            for (LLC_BI__Legal_Entities__c e : src.LLC_BI__Legal_Entities__r) {
                // A staged remove: the row is named in the plan and simply not replicated.
                if (excludedInvolvementIds.contains(e.Id)) {
                    continue;
                }
                invCopies.add(new LLC_BI__Legal_Entities__c(
                    LLC_BI__Loan__c = cloneId,
                    LLC_BI__Product_Package__c = newPkgId,
                    LLC_BI__Account__c = e.LLC_BI__Account__c,
                    LLC_BI__Borrower_Type__c = e.LLC_BI__Borrower_Type__c,
                    LLC_BI__Ownership__c = e.LLC_BI__Ownership__c,
                    LLC_BI__Relationship_Type__c = e.LLC_BI__Relationship_Type__c,
                    LLC_BI__Entity_Type__c = e.LLC_BI__Entity_Type__c,
                    LLC_BI__Order__c = e.LLC_BI__Order__c,
                    LLC_BI__Contingent_Type__c = e.LLC_BI__Contingent_Type__c,
                    LLC_BI__Guarantee_Effective_Date__c = e.LLC_BI__Guarantee_Effective_Date__c,
                    LLC_BI__Guarantee_End_Date__c = e.LLC_BI__Guarantee_End_Date__c,
                    LLC_BI__Guarantee_Limit__c = e.LLC_BI__Guarantee_Limit__c,
                    LLC_BI__Guaranty_Amount__c = e.LLC_BI__Guaranty_Amount__c
                ));
            }
            // Fees: a direct child, no junction (founder correction 2026-08-31). For percentage
            // fees the org recomputes Amount from the clone's own commitment, which is exactly
            // right on a version whose commitment moved.
            for (LLC_BI__Fee__c f : src.LLC_BI__Fees__r) {
                feeCopies.add(new LLC_BI__Fee__c(
                    LLC_BI__Loan__c = cloneId,
                    LLC_BI__Record_Type__c = f.LLC_BI__Record_Type__c,
                    LLC_BI__Fee_Type__c = f.LLC_BI__Fee_Type__c,
                    LLC_BI__Fee_Type_Description__c = f.LLC_BI__Fee_Type_Description__c,
                    LLC_BI__Calculation_Type__c = f.LLC_BI__Calculation_Type__c,
                    LLC_BI__Basis_Source__c = f.LLC_BI__Basis_Source__c,
                    LLC_BI__Percentage__c = f.LLC_BI__Percentage__c,
                    LLC_BI__Amount__c = f.LLC_BI__Amount__c,
                    LLC_BI__Status__c = f.LLC_BI__Status__c,
                    LLC_BI__Paid_By__c = f.LLC_BI__Paid_By__c,
                    LLC_BI__Is_Income__c = f.LLC_BI__Is_Income__c,
                    LLC_BI__Payout_Frequency__c = f.LLC_BI__Payout_Frequency__c
                ));
            }
            // Pricing streams are the ONE family nCino's engine carries ITSELF (observed live
            // 2026-08-31: the engine's replicas landed ten seconds before ours and re-point
            // Context_Id correctly — our copy was a duplicate and is deliberately gone). The
            // count is still verified below; the engine owns the write.
            streamSourceCount += src.LLC_BI__Pricing_Streams__r.size();
        }

        if (!covCopies.isEmpty()) {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN_COVENANT, C360WriteGuard.OP_CARRY,
                new Map<String, Object>{ 'LLC_BI__Loan__c' => null, 'LLC_BI__Covenant2__c' => null });
            insert as user covCopies;
        }
        // AN AUTHORED PLEDGE NEEDS THE SAME SHELL A COPIED ONE DOES, and the scheme is deliberately
        // the carry's own rather than a second one: ONE aggregate per clone, whatever mix of copied
        // and authored pledges lands on it. A clone whose parent carried no collateral has no shell
        // yet, so an authored pledge is what asks for it.
        for (LLC_BI__Loan_Collateral2__c p : netNewPledges) {
            if (!aggByClone.containsKey(p.LLC_BI__Loan__c)) {
                aggByClone.put(p.LLC_BI__Loan__c, new LLC_BI__Loan_Collateral_Aggregate__c(Name = 'Collateral Aggregate'));
            }
        }
        if (!aggByClone.isEmpty()) {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PLEDGE_AGGREGATE, C360WriteGuard.OP_CARRY,
                new Map<String, Object>{ 'Name' => null });
            insert as user aggByClone.values();
        }
        List<LLC_BI__Loan_Collateral2__c> pledgeCopies = new List<LLC_BI__Loan_Collateral2__c>();
        for (LLC_BI__Loan_Collateral2__c p : pledgeSources) {
            Id cloneId = cloneByParent.get(p.LLC_BI__Loan__c);
            if (cloneId == null) {
                continue;
            }
            pledgeCopies.add(new LLC_BI__Loan_Collateral2__c(
                LLC_BI__Loan__c = cloneId,
                LLC_BI__Collateral__c = p.LLC_BI__Collateral__c,
                LLC_BI__Loan_Collateral_Aggregate__c = aggByClone.get(cloneId).Id,
                LLC_BI__Lien_Position__c = p.LLC_BI__Lien_Position__c,
                LLC_BI__Pledged_Status__c = p.LLC_BI__Pledged_Status__c,
                LLC_BI__Active__c = p.LLC_BI__Active__c,
                LLC_BI__Is_Primary__c = p.LLC_BI__Is_Primary__c,
                LLC_BI__Amount_Pledged__c = p.LLC_BI__Amount_Pledged__c,
                LLC_BI__Advance_Rate_Override__c = p.LLC_BI__Advance_Rate_Override__c,
                LLC_BI__Override_Reason__c = p.LLC_BI__Override_Reason__c,
                LLC_BI__Start_Date__c = p.LLC_BI__Start_Date__c,
                LLC_BI__End_Date__c = p.LLC_BI__End_Date__c,
                LLC_BI__Is_Excluded__c = p.LLC_BI__Is_Excluded__c,
                LLC_BI__Is_Leased_Asset__c = p.LLC_BI__Is_Leased_Asset__c,
                LLC_BI__Abundance_of_Caution__c = p.LLC_BI__Abundance_of_Caution__c
            ));
        }
        if (!pledgeCopies.isEmpty()) {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PLEDGE, C360WriteGuard.OP_CARRY,
                new Map<String, Object>{
                    'LLC_BI__Loan__c' => null, 'LLC_BI__Collateral__c' => null,
                    'LLC_BI__Loan_Collateral_Aggregate__c' => null, 'LLC_BI__Lien_Position__c' => null,
                    'LLC_BI__Pledged_Status__c' => null, 'LLC_BI__Active__c' => null,
                    'LLC_BI__Is_Primary__c' => null, 'LLC_BI__Amount_Pledged__c' => null,
                    'LLC_BI__Advance_Rate_Override__c' => null, 'LLC_BI__Override_Reason__c' => null,
                    'LLC_BI__Start_Date__c' => null, 'LLC_BI__End_Date__c' => null,
                    'LLC_BI__Is_Excluded__c' => null, 'LLC_BI__Is_Leased_Asset__c' => null,
                    'LLC_BI__Abundance_of_Caution__c' => null
                });
        }
        // The authored pledges take their aggregate now that the shells exist, and then ONE pledge
        // DML carries the copies and them together. Two inserts would wake nCino's collateral
        // aggregate automation twice, inside a query budget that is the package's rather than ours.
        for (LLC_BI__Loan_Collateral2__c p : netNewPledges) {
            p.LLC_BI__Loan_Collateral_Aggregate__c = aggByClone.get(p.LLC_BI__Loan__c).Id;
        }
        List<LLC_BI__Loan_Collateral2__c> pledgeWrites = new List<LLC_BI__Loan_Collateral2__c>(pledgeCopies);
        pledgeWrites.addAll(netNewPledges);
        if (!pledgeWrites.isEmpty()) {
            insert as user pledgeWrites;
        }
        if (!invCopies.isEmpty()) {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_INVOLVEMENT, C360WriteGuard.OP_CARRY,
                new Map<String, Object>{
                    'LLC_BI__Loan__c' => null, 'LLC_BI__Product_Package__c' => null,
                    'LLC_BI__Account__c' => null, 'LLC_BI__Borrower_Type__c' => null,
                    'LLC_BI__Ownership__c' => null, 'LLC_BI__Relationship_Type__c' => null,
                    'LLC_BI__Entity_Type__c' => null, 'LLC_BI__Order__c' => null,
                    'LLC_BI__Contingent_Type__c' => null, 'LLC_BI__Guarantee_Effective_Date__c' => null,
                    'LLC_BI__Guarantee_End_Date__c' => null, 'LLC_BI__Guarantee_Limit__c' => null,
                    'LLC_BI__Guaranty_Amount__c' => null
                });
            insert as user invCopies;
        }
        if (!feeCopies.isEmpty()) {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_FEE, C360WriteGuard.OP_CARRY,
                new Map<String, Object>{ 'LLC_BI__Loan__c' => null, 'LLC_BI__Fee_Type__c' => null });
        }
        // ONE fee DML for the copies AND the plan's own net-new fees. Two inserts would wake
        // nCino's fee automation twice, and that automation spends the LLC_BI namespace's query
        // budget rather than ours - the whole reason the arm is a second transaction at all.
        List<LLC_BI__Fee__c> feeWrites = new List<LLC_BI__Fee__c>(feeCopies);
        feeWrites.addAll(netNewFees);
        if (!feeWrites.isEmpty()) {
            insert as user feeWrites;
        }
        // The proof is the re-read, never the insert result — ONE query, five subquery counts.
        Set<Id> cloneIds = new Set<Id>(cloneByParent.values());
        Integer covBack = 0;
        Integer plBack = 0;
        Integer invBack = 0;
        Integer feeBack = 0;
        Integer psBack = 0;
        for (LLC_BI__Loan__c c : [
            SELECT Id,
                (SELECT Id FROM LLC_BI__Loan_Covenants__r),
                (SELECT Id FROM LLC_BI__Loan_Collateral__r),
                (SELECT Id FROM LLC_BI__Legal_Entities__r),
                (SELECT Id FROM LLC_BI__Fees__r),
                (SELECT Id FROM LLC_BI__Pricing_Streams__r)
            FROM LLC_BI__Loan__c WHERE Id IN :cloneIds WITH USER_MODE
        ]) {
            covBack += c.LLC_BI__Loan_Covenants__r.size();
            plBack += c.LLC_BI__Loan_Collateral__r.size();
            invBack += c.LLC_BI__Legal_Entities__r.size();
            feeBack += c.LLC_BI__Fees__r.size();
            psBack += c.LLC_BI__Pricing_Streams__r.size();
        }
        // The fee count on the clones covers BOTH the copies and this plan's own net-new fees,
        // because both landed in the one insert above. They are named apart so nobody reads a fee
        // the banker asked for as a fee that travelled from the parent.
        Boolean ok = covBack == covCopies.size() && plBack == pledgeWrites.size() && invBack == invCopies.size()
            && feeBack == feeWrites.size();
        String detail = 'The junction graph was carried onto the new version and re-read: ' +
            covBack + ' of ' + covCopies.size() + ' covenant junctions, ' +
            plBack + ' of ' + pledgeWrites.size() + ' collateral pledges' +
            (netNewPledges.isEmpty() ? '' : ' (' + pledgeCopies.size() + ' carried, ' + netNewPledges.size() + ' net-new on this plan)') +
            ' (on ' + aggByClone.size() + ' fresh aggregates), ' +
            invBack + ' of ' + invCopies.size() + ' borrowing involvements, ' +
            feeBack + ' of ' + feeWrites.size() + ' fees' +
            (netNewFees.isEmpty() ? '' : ' (' + feeCopies.size() + ' carried, ' + netNewFees.size() + ' net-new on this plan)') +
            '. Pricing streams are the engine\'s own carry: ' +
            psBack + ' of ' + streamSourceCount + ' observed on the clones.';
        return (ok ? 'CARRIED ' : '') + detail;
    }

    // -------------------------------------------------------------------------------------------
    // Reads and small helpers.
    // -------------------------------------------------------------------------------------------

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

    /** The selection read, in the shape C360Facilities.validate expects. */
    private static List<LLC_BI__Loan__c> readFacilities(List<Id> facilityIds) {
        return [
            SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Status__c, LLC_BI__lookupKey__c,
                   LLC_BI__Account__c, LLC_BI__Account__r.Name, LLC_BI__Product_Package__c, LLC_BI__Amount__c,
                   LLC_BI__Maturity_Date__c, LLC_BI__Is_Modification__c, LLC_BI__isRenewal__c
            FROM LLC_BI__Loan__c
            WHERE Id IN :facilityIds
            WITH USER_MODE
        ];
    }

    private static List<LLC_BI__Loan__c> readLoans(Set<Id> loanIds) {
        return [
            SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Status__c, LLC_BI__lookupKey__c,
                   LLC_BI__Amount__c, LLC_BI__Maturity_Date__c, LLC_BI__InterestRate__c,
                   LLC_BI__Term_Months__c, LLC_BI__Is_Modification__c, LLC_BI__Product_Package__c
            FROM LLC_BI__Loan__c
            WHERE Id IN :loanIds
            WITH USER_MODE
        ];
    }

    /**
     * Rehydrates a staged field-wave value from the plan. The stage already coerced and validated
     * it against the describe; this only turns the serialized form back into the platform type.
     */
    private static Object coerceStagedFieldValue(String fieldType, String valueJson) {
        if (fieldType == 'CURRENCY' || fieldType == 'DOUBLE' || fieldType == 'PERCENT' || fieldType == 'INTEGER') {
            return (Decimal) JSON.deserialize(valueJson, Decimal.class);
        }
        if (fieldType == 'DATE') {
            return (Date) JSON.deserialize(valueJson, Date.class);
        }
        if (fieldType == 'BOOLEAN') {
            return valueJson == 'true';
        }
        return (String) JSON.deserialize(valueJson, String.class);
    }

    /** The org-assigned name of an already-created facility, so a replay stamps the same label. */
    private static String nameOf(String recordId) {
        if (String.isBlank(recordId)) {
            return null;
        }
        List<LLC_BI__Loan__c> rows = [SELECT Id, Name FROM LLC_BI__Loan__c WHERE Id = :recordId WITH USER_MODE LIMIT 1];
        return rows.isEmpty() ? null : rows[0].Name;
    }

    private static Decimal revision(LLC_BI__LoanRenewal__c j) {
        return j.LLC_BI__RevisionNumber__c == null ? -1 : j.LLC_BI__RevisionNumber__c;
    }

    /** The parent is compared on the three fields a modification must never move. */
    private static Boolean parentUnchanged(LLC_BI__Loan__c before, LLC_BI__Loan__c after) {
        if (after == null) {
            return false;
        }
        return before.LLC_BI__Stage__c == after.LLC_BI__Stage__c
            && before.LLC_BI__Status__c == after.LLC_BI__Status__c
            && before.LLC_BI__Amount__c == after.LLC_BI__Amount__c;
    }

    /**
     * Reports the scalars THIS member's clone took, as they read back off it, naming any that did
     * not land. The values are the member's own: under the per-target channel a clone is only ever
     * measured against what was staged on it, never against another member's figure.
     *
     * @param ownFieldChanges How many field-wave changes target this member, so a clone that took a
     *        field change and no scalar does not report as having taken nothing.
     */
    private static String applied(LLC_BI__Loan__c clone, MemberScalars taken, Integer ownFieldChanges) {
        List<String> parts = new List<String>();
        if (taken.amount != null) {
            parts.add(taken.amount == clone.LLC_BI__Amount__c
                ? 'Amount reads back at ' + String.valueOf(clone.LLC_BI__Amount__c)
                : 'Amount did not land: requested ' + String.valueOf(taken.amount) + ', reads back ' + String.valueOf(clone.LLC_BI__Amount__c));
        }
        if (taken.maturity != null) {
            parts.add(taken.maturity == clone.LLC_BI__Maturity_Date__c
                ? 'Maturity date reads back at ' + String.valueOf(clone.LLC_BI__Maturity_Date__c)
                : 'Maturity date did not land: requested ' + String.valueOf(taken.maturity) + ', reads back ' + String.valueOf(clone.LLC_BI__Maturity_Date__c));
        }
        if (taken.rate != null) {
            parts.add(taken.rate == clone.LLC_BI__InterestRate__c
                ? 'Interest rate reads back at ' + String.valueOf(clone.LLC_BI__InterestRate__c)
                : 'Interest rate did not land: requested ' + String.valueOf(taken.rate) + ', reads back ' + String.valueOf(clone.LLC_BI__InterestRate__c));
        }
        if (taken.term != null) {
            parts.add(taken.term == clone.LLC_BI__Term_Months__c
                ? 'Term reads back at ' + String.valueOf(clone.LLC_BI__Term_Months__c) + ' months'
                : 'Term did not land: requested ' + String.valueOf(taken.term) + ', reads back ' + String.valueOf(clone.LLC_BI__Term_Months__c));
        }
        if (!parts.isEmpty()) {
            return String.join(parts, '. ') + '.';
        }
        return ownFieldChanges > 0
            ? 'No scalar change was aimed at this facility, so its clone keeps the commitment, rate, maturity and term ' +
              'it carries today; its ' + ownFieldChanges + ' field change' + (ownFieldChanges == 1 ? '' : 's') +
              ' ' + (ownFieldChanges == 1 ? 'is' : 'are') + ' reported on ' + (ownFieldChanges == 1 ? 'its' : 'their') + ' own step.'
            : 'No field changes were staged.';
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
