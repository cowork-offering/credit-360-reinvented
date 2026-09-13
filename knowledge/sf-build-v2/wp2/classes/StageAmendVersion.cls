/**
 * StageAmendVersion - MCP tool: stage_amend_version.
 *
 * SHAPE THE VERSION IN PLACE. A modification creates a new package version and stops; until 0.9.23
 * nothing in the cockpit could then CHANGE that version, so a banker who moved a rate on Monday had
 * to discard the whole thing on Tuesday to move it again. This tool is the missing route: the same
 * authoring arms `stage_loan_modification` carries, landing on the version's OWN loans.
 *
 * NO CREDIT ACTION, NO CLONE, NO NEW PACKAGE. An amend is an ordinary update of records nobody has
 * approved. The scalars and the field wave are written straight onto the version's loans through
 * `C360WriteGuard` OP_UPDATE; covenants, associations, pledges, fees and borrowing-structure adds
 * are authored exactly as the modification's execute authors them, with the version loan standing
 * where the clone stood. That also means none of the modification's two-hop relay machinery is
 * needed here: there is no nCino engine in this transaction, so there is no engine query budget to
 * share and nothing that a hosted-MCP context cannot host.
 *
 * WHAT MAY BE AMENDED, AND THE LADDER THAT DECIDES IT. Two shapes qualify and only two:
 *   (a) an IN-FLIGHT VERSION - an unbooked package whose members carry LLC_BI__Is_Modification__c or
 *       LLC_BI__isRenewal__c, or which a LLC_BI__LoanRenewal__c chain row points at as a renewal
 *       loan (the self-anchor row at revision 0 is excluded: ACTIONS-DESIGN 1.4, a naive join
 *       reports a loan as its own modification);
 *   (b) a PACKAGE THE COCKPIT CREATED that is still before approval - package stage Pending or In
 *       Review (or, where the org filled the local field instead, cm_Credit_Stage__c at Application,
 *       Credit Underwriting or Final Review), with no member Booked or Complete.
 * Either way every member must sit BELOW `Approval / Loan Committee` on the org's own eleven-rung
 * loan ladder, read live off the describe on 2026-09-13. One member at that rung takes the whole
 * version out of the banker's hands, because the org approves a VERSION rather than a loan, which is
 * why the test is "any member" rather than "every member". The gate mirrors `amendablePackage` in
 * the cockpit's `book/packages.ts` exactly, and it FAILS CLOSED: a stage this org does not name is
 * never ranked as early.
 *
 * IT IS RE-READ AT EXECUTE. A version that climbs to approval between the confirm gate and the
 * confirm is refused there with nothing written, which is the whole reason the gate is a function
 * rather than a stage-time snapshot.
 *
 * NO BROADCAST SCALARS. `stage_loan_modification` keeps the four flat scalar fields as its
 * single-facility back-compat shape and they broadcast onto every selected clone. There is no such
 * history here and a version routinely holds several loans, so every figure names the loan it lands
 * on: `scalarChangesJson` is the only scalar channel this tool has.
 *
 * THE ARMS ARE THE MODIFICATION'S OWN. The parsers live in `StageLoanModification` and are called
 * from here rather than copied, so the JSON shapes, the org resolution (covenant type catalog, fee
 * picklists, collateral types and their advance rates, account names, the field-wave describe) and
 * every refusal are the same in both tools by construction. The @InvocableVariable descriptions
 * below are the modification's own text with one change and only one: where they said the write
 * lands on the CLONE of a facility, they say it lands on the version's own loan, because on an
 * amend there is no clone and a banker-facing agent reads these.
 *
 * Refusal codes, per the frozen contract: VERSION_NOT_EDITABLE, PACKAGE_BOOKED, NOT_A_VERSION,
 * TARGET_NOT_IN_VERSION, NO_ARMS.
 *
 * Contract: knowledge/SPEC-0.9.23-TOOL-CONTRACT.md, frozen 2026-09-13.
 */
global with sharing class StageAmendVersion {

    /** Raised for a domain-level validation failure. Surfaces as ok:false, never as a fault. */
    public class ToolException extends Exception {}

    /**
     * A gate refusal carrying the contract's own code.
     *
     * The code is a member rather than a constructor argument because Apex owns an exception
     * class's constructors and will not let one be redefined. It is set through `refuse()` below,
     * which is the only place that mints one.
     */
    public class RefusalException extends Exception {
        public String code;
    }

    private static final String ACTION_ID = 'amend-version';

    /**
     * `LLC_BI__Loan__c.LLC_BI__Stage__c`, the whole picklist in the org's own order, read off
     * `sf sobject describe` on bankinggpt-at (2026-09-13). The ORDER is the fact: "past approval" is
     * a position on this ladder rather than a word anyone can guess at.
     */
    private static final List<String> STAGE_LADDER = new List<String>{
        'Qualification', 'Proposal', 'Credit Underwriting', 'Final Review', 'Approval / Loan Committee',
        'Processing', 'Doc Prep', 'Closing', 'Boarding', 'Booked', 'Complete'
    };
    /** The rung a version locks at. The org's own words, verbatim. */
    private static final String APPROVAL_STAGE = 'Approval / Loan Committee';
    /** The two rungs that mean live business rather than a draft the banker still owns. */
    private static final Set<String> BOOKED_STAGES = new Set<String>{ 'Booked', 'Complete' };
    /** `LLC_BI__Product_Package__c.LLC_BI__Stage__c`, the MANAGED field and the declared authority. */
    private static final Set<String> PACKAGE_STAGE_BEFORE_APPROVAL = new Set<String>{ 'Pending', 'In Review' };
    /**
     * `cm_Credit_Stage__c`, the LOCAL field, which is not an authority and is read anyway: the org
     * runs both and disagrees with itself about which one is filled (ACTIONS-DESIGN section 3).
     * Approval starts at Credit Decisioning, so the three before it are the pre-approval ones.
     */
    private static final Set<String> CREDIT_STAGE_BEFORE_APPROVAL = new Set<String>{
        'Application', 'Credit Underwriting', 'Final Review'
    };

    /** The arms this tool carries, by request key, in the order the plan reports them. */
    private static final List<String> ARM_KEYS = new List<String>{
        'scalarChangesJson', 'fieldChangesJson', 'covenantAddsJson', 'covenantAttachesJson',
        'pledgeAddsJson', 'feeAddsJson', 'involvementChangesJson'
    };

    global class Request {
        @InvocableVariable(label='Idempotency Key' required=true)
        global String idempotencyKey;
        @InvocableVariable(label='Version Package Id' description='The UNBOOKED package to amend: an in-flight modification or renewal version, or a package the cockpit created that is still before approval. Every targetLoanId on every arm must be a member of it. A booked package is refused: a change to one of those is a modification, which versions the package rather than amending it.' required=true)
        global String versionPackageId;
        @InvocableVariable(label='Rationale' required=true)
        global String rationale;
        @InvocableVariable(label='Scalar Changes JSON' description='Optional. THE FOUR SCALARS, PER TARGET: JSON list [{"key" (requestedAmount|requestedMaturityDate|requestedRate|requestedTermMonths), "value", "targetLoanId"?}]. Each lands on the NAMED member of this version ALONE, so one plan can take one facility to a new commitment while another takes a different change entirely. There is no broadcast channel on an amend: every figure names its loan. targetLoanId may be omitted when the version holds exactly one facility.')
        global String scalarChangesJson;
        @InvocableVariable(label='Covenant Adds JSON' description='Optional. JSON list of net-new covenants to create and attach: [{"typeName" or "typeId", "threshold", "operator" (< <= = >= >), "frequency"?, "effectiveDate"? (YYYY-MM-DD), "targetLoanId"?}]. Each is created Pending/Active on the borrower account and attached to the NAMED member of this version, never to a booked facility. targetLoanId may be omitted when the version holds exactly one facility.')
        global String covenantAddsJson;
        @InvocableVariable(label='Involvement Changes JSON' description='Optional. JSON list of borrowing-structure amendments: [{"op" (add), "role" (Borrower|Co-Borrower|Guarantor|Limited Guarantor|Related Entity), "accountId" or "accountName", "ownership"?, "targetLoanId"?}]. An ADD authors the involvement on the named member of this version. A REMOVE is refused here: on a modification a remove is a carry exclusion onto a clone that does not exist yet, and on a version the row already exists, so removing it would be a real delete. Nothing in this package deletes. targetLoanId may be omitted when the version holds exactly one facility.')
        global String involvementChangesJson;
        @InvocableVariable(label='Field Changes JSON' description='Optional. THE FIELD WAVE: JSON list of loan-field amendments applied to the version\'s own loan: [{"field" (API name or exact field label), "value", "targetLoanId"?}]. The field must be updateable and non-formula per the org\'s own describe, outside the doctrine deny-list (stage, status, the four scalar keys, anchoring lookups). Values are coerced by the field\'s own type; a picklist value is validated against the org\'s active values and a refusal carries the legal list. targetLoanId may be omitted when the version holds exactly one facility.')
        global String fieldChangesJson;
        @InvocableVariable(label='Fee Adds JSON' description='Optional. NET-NEW FEES authored on the version\'s own loan: [{"feeType" (an active LLC_BI__Fee_Type__c value), "description" (the human label; Name on a fee is an autonumber), "calculationType" (Percentage|Flat Amount), "percentage"? , "amount"?, "basisSource"?, "recordType"? (Fees|Costs|Adjustments), "paidBy"?, "targetLoanId"?}]. A PERCENTAGE fee carries a percentage and a basis and NO amount: the org\'s own FeeTrigger derives the basis amount and the money from the facility\'s commitment, and a supplied amount is refused rather than overwritten. A FLAT AMOUNT fee carries an amount and no percentage. RecordTypeId is never written (no Fee record type is assigned to the integration user\'s profile); recordType is the independent LLC_BI__Record_Type__c picklist. targetLoanId may be omitted when the version holds exactly one facility.')
        global String feeAddsJson;
        @InvocableVariable(label='Pledge Adds JSON' description='Optional. COLLATERAL PLEDGES authored on the version\'s own loan: [{"collateralId"? (an existing LLC_BI__Collateral__c the BORROWER owns), "newCollateral"? {"description", "collateralType", "value"}, "advanceRate"?, "advanceRateReason"?, "amountPledged"?, "authoriseOverPledge"?, "lienPosition"?, "targetLoanId"?}]. EXACTLY ONE of collateralId and newCollateral per entry. An existing collateral must be owned by the borrower through LLC_BI__Account_Collateral__c (LLC_BI__Collateral__c carries no account lookup at all) and must not already be pledged to that facility. A newCollateral is authored as asset, then ownership junction, then pledge. Its DESCRIPTION is at most 255 characters, which is the length of LLC_BI__Description__c on this org, and a longer one is refused with its own length rather than truncated or left to fail on the insert. Its COLLATERALTYPE takes EITHER an LLC_BI__Collateral_Type__c record id (the a33 prefix, which is what Customer360Catalog returns as acceptedValues) OR the type\'s exact name: names are NOT unique in this catalog, so a name matching more than one row is refused with the candidate ids and their advance rates and the id settles it. A type whose own advance rate is null is refused before the org\'s Advance_Rate_should_not_be_null rule fires on the insert. advanceRate is REQUIRED on a create and rides LLC_BI__Advance_Rate_Override__c (the plain advance rate is a formula), which makes the org\'s Advance_Rate_Override rule demand a reason beside it. amountPledged is OPTIONAL and DEFAULTS to the asset\'s lendable value, which is its value times the rate this pledge resolves to: the override where one is stated, the type\'s own rate otherwise. A figure ABOVE the lendable value is refused with that value and the rate behind it, because the org\'s Pledge_More_Than_Lendable_Value rule refuses the row unless LLC_BI__Authorize__c (Authorize Pledge Amount) is set; send "authoriseOverPledge": true on the same entry to set it, which records the banker authorising the over-pledge on the row rather than the tool doing it silently. The flag is written only where it does work: sent on a pledge within the lendable value it is ignored, because there is nothing to authorise. targetLoanId may be omitted when the version holds exactly one facility.')
        global String pledgeAddsJson;
        @InvocableVariable(label='Covenant Attaches JSON' description='Optional. ASSOCIATE AN EXISTING COVENANT to a facility: [{"covenantId", "targetLoanId"?}]. A junction-only create. No covenant is inserted, nothing is deleted: an LLC_BI__Loan_Covenant__c row ties a covenant the borrower already holds to the named member of this version, which is the instrument for a relationship-level covenant that carries no loan junction and is therefore NOT associated to the loan. The covenant must belong to the borrower on this package, and a covenant already attached to the target is refused by name rather than junctioned twice. targetLoanId may be omitted when the version holds exactly one facility.')
        global String covenantAttachesJson;
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
        @InvocableVariable(label='Code' description='VERSION_NOT_EDITABLE, PACKAGE_BOOKED, NOT_A_VERSION, TARGET_NOT_IN_VERSION and NO_ARMS are this tool\'s own refusals; VALIDATION_FAILED, STAGING_REFUSED, STAGING_WRITE_FAILED and READ_FAILED are the shared ones every stage_* carries.')
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

    /** One member of the version an arm actually aims at, and what moves on it. */
    global class PlannedFacility {
        @InvocableVariable(label='Facility Id' description='The version\'s own loan. There is no clone: this is the record the plan writes to.')
        global String facilityId;
        @InvocableVariable(label='Facility Name' description='The org-assigned name. The org rewrites loan names on save, so this is read back, never echoed.')
        global String facilityName;
        @InvocableVariable(label='Apply Changes Step Id')
        global String applyStepId;
        @InvocableVariable(label='Verify Step Id')
        global String verifyStepId;
        @InvocableVariable(label='Fields' description='The fields that move on this facility, in plan order. Empty where the only arms aimed at it author child records rather than move a figure.')
        global List<String> fields;
        @InvocableVariable(label='From' description='What each field in Fields reads today, element for element.')
        global List<String> fromValues;
        @InvocableVariable(label='To' description='What each field in Fields will read after the amend, element for element.')
        global List<String> toValues;
        @InvocableVariable(label='Arm Count' description='How many arm entries of any kind are aimed at this facility.')
        global Integer armCount;
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
        @InvocableVariable(label='Steps' description='The plan the banker confirms: write steps and the verification that proves each one.')
        global List<PlanStep> steps;
        @InvocableVariable(label='Warnings')
        global List<String> warnings;
        @InvocableVariable(label='Provenance JSON')
        global String provenanceJson;
        @InvocableVariable(label='Account Id')
        global String accountId;
        @InvocableVariable(label='Product Package Id' description='The version being amended. The same value as versionPackageId, under the name every other tool in this package answers under.')
        global String productPackageId;
        @InvocableVariable(label='Version Package Id')
        global String versionPackageId;
        @InvocableVariable(label='Version Package Name' description='The org-assigned package name, read back rather than echoed.')
        global String versionPackageName;
        @InvocableVariable(label='Version Kind' description='in-flight version, or cockpit package before approval. Which of the two gates this package passed.')
        global String versionKind;
        @InvocableVariable(label='Member Count' description='Every facility on the version, whether an arm aims at it or not.')
        global Integer memberCount;
        @InvocableVariable(label='Execution Held' description='False: an amend writes records nobody has approved, so there is nothing to hold. A version the org has taken is REFUSED at the gate rather than held, because holding would suggest a later retry that will not come.')
        global Boolean executionHeld;
        @InvocableVariable(label='Held Reason' description='Null while execution is available.')
        global String heldReason;
        @InvocableVariable(label='Facilities' description='One entry per TOUCHED member, with the fields that move and their from and to values.')
        global List<PlannedFacility> facilities;
        @InvocableVariable(label='Facility Count' description='How many members this plan touches. Never more than memberCount.')
        global Integer facilityCount;
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
     * Stages an amendment of an unbooked version. Writes no domain record; execution is a separate,
     * token-gated call.
     *
     * @param requests One request per staged action. Element i of the response belongs to input i.
     * @return One response per request.
     */
    @InvocableMethod(
        label='stage_amend_version'
        description='Validate a change to an UNBOOKED package - an in-flight modification or renewal version, or a package the cockpit created that is still before approval - and return an immutable execution plan with a plan hash. The arms are the modification\'s own, landing on the version\'s own loans rather than on a clone: per-target scalars, the field wave, net-new covenants, covenant associations, collateral pledges, fees and borrowing-structure adds. No credit action runs, no clone is created and no new package version is minted. Refused on a booked package, on a version any member of which has reached Approval / Loan Committee, and on any target that is not a member of the named version. Writes nothing: execute_amend_version runs the plan behind the single-use decision token and re-reads the gate before it writes.'
    )
    global static List<Response> stage(List<Request> requests) {
        List<Response> out = new List<Response>();
        for (Request req : requests) {
            Response res = new Response();
            try {
                res.result = build(req);
                res.ok = true;
            } catch (RefusalException e) {
                res.ok = false;
                res.error = err(e.code, e.getMessage(), null, req.idempotencyKey);
            } catch (ToolException e) {
                res.ok = false;
                res.error = err('VALIDATION_FAILED', e.getMessage(), null, req.idempotencyKey);
            } catch (StageLoanModification.ToolException e) {
                // The shared arm parsers refuse in the modification's own words. Their checks are
                // the checks this tool wants; only the code is ours to name.
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

    // -----------------------------------------------------------------------------------------
    // THE GATE. Shared with the execute pair, which re-runs it before it writes anything.
    // -----------------------------------------------------------------------------------------

    /** What the gate proved about one package, and everything downstream needs from it. */
    public class VersionGate {
        public LLC_BI__Product_Package__c pkg;
        public List<LLC_BI__Loan__c> members;
        /** 'in-flight version' or 'cockpit package before approval'. */
        public String kind;
    }

    /** Mints a refusal carrying the contract's own code. The only place one is made. */
    private static RefusalException refuse(String code, String message) {
        RefusalException e = new RefusalException(message);
        e.code = code;
        return e;
    }

    /**
     * Where a stage sits on the org's own ladder, or -1 for one this org does not name.
     *
     * An unknown stage is never ranked against a known one: -1 compares below everything, and the
     * caller treats it as "cannot tell" rather than "early". Fail closed is the whole point.
     */
    private static Integer rung(String stage) {
        if (String.isBlank(stage)) {
            return -1;
        }
        for (Integer i = 0; i < STAGE_LADDER.size(); i++) {
            if (STAGE_LADDER[i].equalsIgnoreCase(stage.trim())) {
                return i;
            }
        }
        return -1;
    }

    private static Integer approvalRung() {
        return rung(APPROVAL_STAGE);
    }

    /**
     * Reads the package and its members and decides whether this is a version the banker still owns.
     *
     * The order of the refusals is the order the banker needs them in: a package that is live
     * business is PACKAGE_BOOKED whatever else is true of it; a package that is neither a version
     * nor a cockpit draft is NOT_A_VERSION; and only a package that IS one of those two can be
     * VERSION_NOT_EDITABLE, which is a statement about timing rather than about kind.
     *
     * @param packageId The validated package anchor.
     * @return The gate result, carrying the package and every member.
     * @throws RefusalException with PACKAGE_BOOKED, NOT_A_VERSION or VERSION_NOT_EDITABLE.
     */
    public static VersionGate gate(Id packageId) {
        List<LLC_BI__Product_Package__c> pkgs = [
            SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Status__c, cm_Credit_Stage__c,
                   LLC_BI__Account__c, LLC_BI__Account__r.Name
            FROM LLC_BI__Product_Package__c
            WHERE Id = :packageId
            WITH USER_MODE
            LIMIT 1
        ];
        if (pkgs.isEmpty()) {
            throw refuse('NOT_A_VERSION', 'No product package exists with id ' + packageId + ', so there is nothing to amend.');
        }
        LLC_BI__Product_Package__c pkg = pkgs[0];

        List<LLC_BI__Loan__c> members = readMembers(packageId);
        if (members.isEmpty()) {
            throw refuse(
                'NOT_A_VERSION',
                'Package ' + pkg.Name + ' carries no facility, so there is nothing on it to amend. An amend changes ' +
                'the loans of a version; a package with no members is a shell, and a facility is filed onto it rather ' +
                'than amended on it.'
            );
        }

        // LIVE BUSINESS FIRST. A booked member settles the question before anything else is asked:
        // a change to a booked facility is a modification, which versions the package rather than
        // amending it, and that is a different action with its own confirmation.
        for (LLC_BI__Loan__c m : members) {
            if (BOOKED_STAGES.contains(m.LLC_BI__Stage__c)) {
                throw refuse(
                    'PACKAGE_BOOKED',
                    pkg.Name + ' carries ' + m.Name + ' at stage ' + m.LLC_BI__Stage__c + ', so this package is live ' +
                    'business rather than a version the banker still owns. A change to a booked facility is a ' +
                    'MODIFICATION: it versions the whole package through nCino\'s credit action. Stage that instead.'
                );
            }
        }
        if (pkg.LLC_BI__Stage__c == 'Complete') {
            throw refuse(
                'PACKAGE_BOOKED',
                pkg.Name + ' reads package stage Complete, so its run has ended. An amend shapes a version that is ' +
                'still open; a completed package is changed, if at all, by a new credit action.'
            );
        }

        String kind = isVersion(members) ? 'in-flight version' : null;
        if (kind == null) {
            Boolean cockpitDraft =
                PACKAGE_STAGE_BEFORE_APPROVAL.contains(pkg.LLC_BI__Stage__c) ||
                CREDIT_STAGE_BEFORE_APPROVAL.contains(pkg.cm_Credit_Stage__c);
            if (!cockpitDraft) {
                throw refuse(
                    'NOT_A_VERSION',
                    pkg.Name + ' is neither an in-flight version nor a package still before approval: no member carries ' +
                    'the modification or renewal flag, no chain row points at one, and the package reads stage "' +
                    String.valueOf(pkg.LLC_BI__Stage__c) + '" with credit stage "' + String.valueOf(pkg.cm_Credit_Stage__c) +
                    '". This tool shapes a version in place; anything else is a modification or a new facility.'
                );
            }
            kind = 'cockpit package before approval';
        }

        // THE RUNG. One member at Approval / Loan Committee or above takes the whole version out of
        // the banker's hands, because the org approves a VERSION rather than a loan.
        Integer locked = approvalRung();
        for (LLC_BI__Loan__c m : members) {
            Integer r = rung(m.LLC_BI__Stage__c);
            if (r < 0) {
                throw refuse(
                    'VERSION_NOT_EDITABLE',
                    m.Name + ' reads stage "' + String.valueOf(m.LLC_BI__Stage__c) + '", which is not a rung this org\'s ' +
                    'own loan ladder names. A stage this tool cannot place is never treated as an early one: the amend ' +
                    'is refused rather than run against a version whose position nobody can state.'
                );
            }
            if (r >= locked) {
                throw refuse(
                    'VERSION_NOT_EDITABLE',
                    pkg.Name + ' is no longer editable: ' + m.Name + ' has reached ' + m.LLC_BI__Stage__c +
                    ', which is at or past ' + APPROVAL_STAGE + ' on this org\'s ladder. The org approves a VERSION ' +
                    'rather than a loan, so one member at that rung locks all ' + members.size() + '. Work it through ' +
                    'approval in Salesforce, or send it back a stage there before changing it.'
                );
            }
        }

        VersionGate g = new VersionGate();
        g.pkg = pkg;
        g.members = members;
        g.kind = kind;
        return g;
    }

    /**
     * Is this package a VERSION of another one?
     *
     * Two independent signals, either of which is enough: a member carrying the modification or
     * renewal flag, or a LLC_BI__LoanRenewal__c row naming a member as its renewal loan. The chain
     * read excludes the REVISION 0 SELF-ANCHOR (ParentLoanId == RenewalLoanId): ACTIONS-DESIGN 1.4
     * records that a naive join reports a loan as its own modification.
     */
    private static Boolean isVersion(List<LLC_BI__Loan__c> members) {
        Set<Id> memberIds = new Set<Id>();
        for (LLC_BI__Loan__c m : members) {
            if (m.LLC_BI__Is_Modification__c == true || m.LLC_BI__isRenewal__c == true) {
                return true;
            }
            memberIds.add(m.Id);
        }
        for (LLC_BI__LoanRenewal__c j : [
            SELECT Id, LLC_BI__ParentLoanId__c, LLC_BI__RenewalLoanId__c
            FROM LLC_BI__LoanRenewal__c
            WHERE LLC_BI__RenewalLoanId__c IN :memberIds
            WITH USER_MODE
        ]) {
            if (j.LLC_BI__ParentLoanId__c != null && j.LLC_BI__ParentLoanId__c != j.LLC_BI__RenewalLoanId__c) {
                return true;
            }
        }
        return false;
    }

    /** Every facility on the version, with the fields the plan reports from and to. */
    public static List<LLC_BI__Loan__c> readMembers(Id packageId) {
        return [
            SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Status__c, LLC_BI__lookupKey__c,
                   LLC_BI__Account__c, LLC_BI__Account__r.Name, LLC_BI__Product_Package__c,
                   LLC_BI__Amount__c, LLC_BI__InterestRate__c, LLC_BI__Term_Months__c,
                   LLC_BI__Maturity_Date__c, LLC_BI__Amortized_Term_Months__c,
                   LLC_BI__First_Payment_Date__c, LLC_BI__Is_Modification__c, LLC_BI__isRenewal__c
            FROM LLC_BI__Loan__c
            WHERE LLC_BI__Product_Package__c = :packageId
            WITH USER_MODE
            ORDER BY Name
        ];
    }

    // -----------------------------------------------------------------------------------------
    // THE PLAN.
    // -----------------------------------------------------------------------------------------

    private static StageResult build(Request req) {
        if (String.isBlank(req.versionPackageId)) {
            throw new ToolException('versionPackageId is required. It is the version being amended.');
        }
        if (String.isBlank(req.rationale)) {
            throw new ToolException('rationale is required. It feeds the audit ledger.');
        }
        if (!anyArm(req)) {
            throw refuse(
                'NO_ARMS',
                'This request carries no change. An amend needs at least one of: a scalar change, a field change, a ' +
                'net-new covenant, a covenant association, a collateral pledge, a fee, or a borrowing-structure add.'
            );
        }

        Id packageId = C360Facilities.packageId(req.versionPackageId);
        VersionGate g = gate(packageId);
        List<LLC_BI__Loan__c> members = g.members;
        Map<Id, LLC_BI__Loan__c> memberById = new Map<Id, LLC_BI__Loan__c>(members);

        // THE MEMBERSHIP CHECK RUNS BEFORE THE PARSERS, and it is why it is here rather than left to
        // them. The shared arm parsers refuse a target outside the selection in the modification's
        // own words; the contract wants a target outside the VERSION refused by name, under its own
        // code, so the ids are read out of the arms and checked against the roster first.
        assertTargetsAreMembers(req, memberById);
        assertNoInvolvementRemove(req);

        // The parsers are the modification's, called with a Request this tool fills in. The four
        // broadcast scalars stay null, which is what makes scalarChangesJson the only channel.
        StageLoanModification.Request armReq = new StageLoanModification.Request();
        armReq.idempotencyKey = req.idempotencyKey;
        armReq.productPackageId = req.versionPackageId;
        armReq.rationale = req.rationale;
        armReq.scalarChangesJson = req.scalarChangesJson;
        armReq.fieldChangesJson = req.fieldChangesJson;
        armReq.covenantAddsJson = req.covenantAddsJson;
        armReq.covenantAttachesJson = req.covenantAttachesJson;
        armReq.pledgeAddsJson = req.pledgeAddsJson;
        armReq.feeAddsJson = req.feeAddsJson;
        armReq.involvementChangesJson = req.involvementChangesJson;

        // An amend creates no facility, so there is no label for an arm to point at. An arm that
        // names one is refused by the shared resolver with the reason.
        List<C360NewFacilities.NewFacility> noNewFacilities = new List<C360NewFacilities.NewFacility>();
        List<String> armWarnings = new List<String>();

        List<StageLoanModification.ScalarChange> scalarChanges =
            StageLoanModification.parseScalarChanges(armReq, members);
        List<StageLoanModification.FieldChange> fieldChanges =
            StageLoanModification.parseFieldChanges(armReq, members, noNewFacilities);
        List<StageLoanModification.CovenantAdd> covenantAdds =
            StageLoanModification.parseCovenantAdds(armReq, members, noNewFacilities, armWarnings);
        List<StageLoanModification.CovenantAttach> covenantAttaches =
            StageLoanModification.parseCovenantAttaches(armReq, members, noNewFacilities, armWarnings);
        List<StageLoanModification.PledgeAdd> pledgeAdds =
            StageLoanModification.parsePledgeAdds(armReq, members, noNewFacilities);
        List<StageLoanModification.FeeAdd> feeAdds =
            StageLoanModification.parseFeeAdds(armReq, members, noNewFacilities);
        List<StageLoanModification.InvolvementChange> involvementChanges =
            StageLoanModification.parseInvolvementChanges(armReq, members, noNewFacilities, armWarnings);

        Integer createdAssets = StageLoanModification.newCollaterals(pledgeAdds);

        // WHICH MEMBERS THIS PLAN TOUCHES, and what moves on each. A member the arms never name is
        // not reported as amended: saying "three facilities" over a plan that changes one would be
        // describing the version rather than the change.
        Map<Id, Integer> armsByTarget = new Map<Id, Integer>();
        Map<Id, List<String>> movedFields = new Map<Id, List<String>>();
        Map<Id, List<String>> movedFrom = new Map<Id, List<String>>();
        Map<Id, List<String>> movedTo = new Map<Id, List<String>>();

        Map<Id, List<StageLoanModification.ScalarChange>> scalarsByTarget =
            new Map<Id, List<StageLoanModification.ScalarChange>>();
        for (StageLoanModification.ScalarChange sc : scalarChanges) {
            countArm(armsByTarget, sc.targetLoanId);
            if (!scalarsByTarget.containsKey(sc.targetLoanId)) {
                scalarsByTarget.put(sc.targetLoanId, new List<StageLoanModification.ScalarChange>());
            }
            scalarsByTarget.get(sc.targetLoanId).add(sc);
            LLC_BI__Loan__c m = memberById.get(sc.targetLoanId);
            String fieldName = SCALAR_FIELD.get(sc.key);
            recordMove(movedFields, movedFrom, movedTo, sc.targetLoanId, fieldName,
                currentScalar(m, sc.key), scalarTarget(sc));
        }
        for (StageLoanModification.FieldChange fc : fieldChanges) {
            countArm(armsByTarget, fc.targetLoanId);
            recordMove(movedFields, movedFrom, movedTo, fc.targetLoanId, fc.fieldName,
                'the value the org holds today', StageLoanModification.displayValue(fc));
        }
        for (StageLoanModification.CovenantAdd a : covenantAdds) {
            countArm(armsByTarget, a.targetLoanId);
        }
        for (StageLoanModification.CovenantAttach ca : covenantAttaches) {
            countArm(armsByTarget, ca.targetLoanId);
        }
        for (StageLoanModification.PledgeAdd pa : pledgeAdds) {
            countArm(armsByTarget, pa.targetLoanId);
        }
        for (StageLoanModification.FeeAdd fa : feeAdds) {
            countArm(armsByTarget, fa.targetLoanId);
        }
        for (StageLoanModification.InvolvementChange ic : involvementChanges) {
            countArm(armsByTarget, ic.targetLoanId);
        }

        // In plan order, which is the roster's order: a banker reads the version the way the room
        // lists it, not the way the request happened to be typed.
        List<LLC_BI__Loan__c> touched = new List<LLC_BI__Loan__c>();
        for (LLC_BI__Loan__c m : members) {
            if (armsByTarget.containsKey(m.Id)) {
                touched.add(m);
            }
        }

        Map<String, Object> resolved = new Map<String, Object>{
            'versionPackageId' => packageId,
            'productPackageId' => packageId,
            'actionType' => 'Amend',
            'versionKind' => g.kind,
            'memberCount' => members.size(),
            'facilityCount' => touched.size()
        };

        List<C360Plan.Step> steps = new List<C360Plan.Step>();
        List<PlannedFacility> planned = new List<PlannedFacility>();

        for (Integer i = 0; i < touched.size(); i++) {
            LLC_BI__Loan__c m = touched[i];
            String s = String.valueOf(i);
            resolved.put('facility' + s + '.loanId', String.valueOf(m.Id));

            List<String> words = new List<String>();
            for (StageLoanModification.ScalarChange sc : scalarsByTarget.containsKey(m.Id)
                    ? scalarsByTarget.get(m.Id) : new List<StageLoanModification.ScalarChange>()) {
                words.add(StageLoanModification.scalarPhrase(sc));
            }
            String applyLabel = words.isEmpty()
                ? 'No figure moves on ' + m.Name + ': the arms aimed at it author records beside it rather than change ' +
                  'its commitment, rate, maturity or term'
                : 'Set ' + String.join(words, ' and ') + ' on ' + m.Name + ' itself, directly on the version\'s own loan';
            steps.add(
                new C360Plan.Step('apply_changes_' + s, C360Plan.TYPE_WRITE, applyLabel)
                    .onObject('LLC_BI__Loan__c', new List<String>{
                        'LLC_BI__Amount__c', 'LLC_BI__InterestRate__c', 'LLC_BI__Term_Months__c',
                        'LLC_BI__Maturity_Date__c'
                    })
                    .wakes(new List<String>{
                        'nCino Commercial - Loan After Save; the fee and collateral aggregates and the exposure ' +
                        'rollups follow any commitment change'
                    })
                    .provenBy('SELECT Id, LLC_BI__Amount__c, LLC_BI__InterestRate__c, LLC_BI__Term_Months__c, LLC_BI__Maturity_Date__c FROM LLC_BI__Loan__c WHERE Id = :versionLoanId')
            );
            steps.add(
                new C360Plan.Step('verify_apply_' + s, C360Plan.TYPE_VERIFICATION,
                    'Re-read ' + m.Name + ' and compare every figure this plan moved against what the org holds')
                    .onObject('LLC_BI__Loan__c', new List<String>{ 'Id', 'Name' })
                    .provenBy('SELECT Id, Name, LLC_BI__Amount__c FROM LLC_BI__Loan__c WHERE Id = :versionLoanId')
            );

            PlannedFacility pf = new PlannedFacility();
            pf.facilityId = m.Id;
            pf.facilityName = m.Name;
            pf.applyStepId = 'apply_changes_' + s;
            pf.verifyStepId = 'verify_apply_' + s;
            pf.fields = movedFields.containsKey(m.Id) ? movedFields.get(m.Id) : new List<String>();
            pf.fromValues = movedFrom.containsKey(m.Id) ? movedFrom.get(m.Id) : new List<String>();
            pf.toValues = movedTo.containsKey(m.Id) ? movedTo.get(m.Id) : new List<String>();
            pf.armCount = armsByTarget.get(m.Id);
            planned.add(pf);
        }

        for (Integer i = 0; i < scalarChanges.size(); i++) {
            StageLoanModification.ScalarChange sc = scalarChanges[i];
            String s = String.valueOf(i);
            resolved.put('scalarChange' + s + '.key', sc.key);
            resolved.put('scalarChange' + s + '.value',
                sc.key == 'requestedMaturityDate' ? (Object) sc.dateValue : (Object) sc.numberValue);
            resolved.put('scalarChange' + s + '.targetLoanId', String.valueOf(sc.targetLoanId));
        }
        resolved.put('scalarChangeCount', scalarChanges.size());

        for (Integer i = 0; i < fieldChanges.size(); i++) {
            StageLoanModification.FieldChange fc = fieldChanges[i];
            String s = String.valueOf(i);
            resolved.put('fieldChange' + s + '.field', fc.fieldName);
            resolved.put('fieldChange' + s + '.label', fc.fieldLabel);
            resolved.put('fieldChange' + s + '.type', fc.fieldType);
            resolved.put('fieldChange' + s + '.valueJson', fc.valueJson);
            resolved.put('fieldChange' + s + '.targetLoanId', String.valueOf(fc.targetLoanId));
            steps.add(
                new C360Plan.Step('field_change_' + s, C360Plan.TYPE_WRITE,
                    'Set ' + fc.fieldLabel + ' (' + fc.fieldName + ') to ' + StageLoanModification.displayValue(fc) +
                    ' on ' + memberById.get(fc.targetLoanId).Name)
                    .onObject('LLC_BI__Loan__c', new List<String>{ fc.fieldName })
                    .provenBy('SELECT ' + fc.fieldName + ' FROM LLC_BI__Loan__c WHERE Id = :versionLoanId')
            );
        }
        resolved.put('fieldChangeCount', fieldChanges.size());

        for (Integer i = 0; i < covenantAdds.size(); i++) {
            StageLoanModification.CovenantAdd a = covenantAdds[i];
            String s = String.valueOf(i);
            resolved.put('covenantAdd' + s + '.typeId', String.valueOf(a.typeId));
            resolved.put('covenantAdd' + s + '.typeName', a.typeName);
            resolved.put('covenantAdd' + s + '.threshold', a.threshold);
            resolved.put('covenantAdd' + s + '.operator', a.operator);
            resolved.put('covenantAdd' + s + '.frequency', a.frequency);
            resolved.put('covenantAdd' + s + '.effectiveDate', a.effectiveDate);
            resolved.put('covenantAdd' + s + '.targetLoanId', String.valueOf(a.targetLoanId));
            String targetName = memberById.get(a.targetLoanId).Name;
            steps.add(
                new C360Plan.Step('covenant_create_' + s, C360Plan.TYPE_WRITE,
                    'Create net-new covenant on the borrower: ' + a.typeName + ' ' + a.operator + ' ' +
                    String.valueOf(a.threshold) + ', tested ' + a.frequency + ', effective ' +
                    String.valueOf(a.effectiveDate) + ', born Pending and Active')
                    .onObject('LLC_BI__Covenant2__c', new List<String>{
                        'LLC_BI__Covenant_Type__c', 'LLC_BI__Financial_Indicator_Value__c', 'Financial_Indicator_Operator__c',
                        'LLC_BI__Frequency__c', 'LLC_BI__Effective_Date__c'
                    })
                    .provenBy('SELECT Id, LLC_BI__Financial_Indicator_Value__c FROM LLC_BI__Covenant2__c WHERE Id = :createdId')
            );
            steps.add(
                new C360Plan.Step('covenant_attach_' + s, C360Plan.TYPE_WRITE,
                    'Attach it to ' + targetName + ' on this version, and associate it to the borrower account the ' +
                    'way nCino\'s own UI does')
                    .onObject('LLC_BI__Loan_Covenant__c', new List<String>{
                        'LLC_BI__Loan__c', 'LLC_BI__Covenant2__c',
                        'LLC_BI__Account_Covenant__c: LLC_BI__Account__c + LLC_BI__Covenant2__c'
                    })
                    .provenBy('SELECT Id FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :versionLoanId AND LLC_BI__Covenant2__c = :createdId')
            );
            steps.add(
                new C360Plan.Step('covenant_verify_' + s, C360Plan.TYPE_VERIFICATION,
                    'Re-read the covenant and its junction on ' + targetName)
                    .onObject('LLC_BI__Covenant2__c', new List<String>{ 'Id', 'LLC_BI__Financial_Indicator_Value__c' })
                    .provenBy('SELECT Id FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :versionLoanId AND LLC_BI__Covenant2__c = :createdId')
            );
        }
        resolved.put('covenantAddCount', covenantAdds.size());

        for (Integer i = 0; i < covenantAttaches.size(); i++) {
            StageLoanModification.CovenantAttach ca = covenantAttaches[i];
            String s = String.valueOf(i);
            resolved.put('covenantAttach' + s + '.covenantId', String.valueOf(ca.covenantId));
            resolved.put('covenantAttach' + s + '.covenantName', ca.covenantName);
            resolved.put('covenantAttach' + s + '.typeName', ca.typeName);
            resolved.put('covenantAttach' + s + '.threshold', ca.threshold);
            resolved.put('covenantAttach' + s + '.operator', ca.operator);
            resolved.put('covenantAttach' + s + '.targetLoanId', String.valueOf(ca.targetLoanId));
            String targetName = memberById.get(ca.targetLoanId).Name;
            steps.add(
                new C360Plan.Step('covenant_associate_' + s, C360Plan.TYPE_WRITE,
                    'Associate the existing covenant ' + ca.covenantName + ' (' + ca.typeName + ') to ' + targetName +
                    ': a junction only, no covenant is created and none is amended')
                    .onObject('LLC_BI__Loan_Covenant__c', new List<String>{ 'LLC_BI__Loan__c', 'LLC_BI__Covenant2__c' })
                    .provenBy('SELECT Id FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :versionLoanId AND LLC_BI__Covenant2__c = :covenantId')
            );
            steps.add(
                new C360Plan.Step('covenant_associate_verify_' + s, C360Plan.TYPE_VERIFICATION,
                    'Re-read the junction on ' + targetName + ' and prove the covenant record itself is unchanged')
                    .onObject('LLC_BI__Loan_Covenant__c', new List<String>{ 'Id' })
                    .provenBy('SELECT Id FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :versionLoanId AND LLC_BI__Covenant2__c = :covenantId')
            );
        }
        resolved.put('covenantAttachCount', covenantAttaches.size());

        for (Integer i = 0; i < involvementChanges.size(); i++) {
            StageLoanModification.InvolvementChange ic = involvementChanges[i];
            String s = String.valueOf(i);
            resolved.put('involvement' + s + '.op', ic.op);
            resolved.put('involvement' + s + '.role', ic.role);
            resolved.put('involvement' + s + '.accountId', String.valueOf(ic.accountId));
            resolved.put('involvement' + s + '.accountName', ic.accountName);
            resolved.put('involvement' + s + '.ownership', ic.ownership);
            resolved.put('involvement' + s + '.targetLoanId', String.valueOf(ic.targetLoanId));
            String targetName = memberById.get(ic.targetLoanId).Name;
            steps.add(
                new C360Plan.Step('involvement_change_' + s, C360Plan.TYPE_WRITE,
                    'Add ' + ic.accountName + ' as ' + ic.role + ' on ' + targetName +
                    (ic.ownership == null ? '' : ' at ' + String.valueOf(ic.ownership) + '% ownership'))
                    .onObject('LLC_BI__Legal_Entities__c', new List<String>{
                        'LLC_BI__Account__c', 'LLC_BI__Borrower_Type__c', 'LLC_BI__Ownership__c'
                    })
                    .provenBy('SELECT Id FROM LLC_BI__Legal_Entities__c WHERE LLC_BI__Loan__c = :versionLoanId AND LLC_BI__Account__c = :accountId')
            );
            steps.add(
                new C360Plan.Step('involvement_verify_' + s, C360Plan.TYPE_VERIFICATION,
                    'Re-read the involvement on ' + targetName)
                    .onObject('LLC_BI__Legal_Entities__c', new List<String>{ 'Id' })
                    .provenBy('SELECT Id FROM LLC_BI__Legal_Entities__c WHERE LLC_BI__Loan__c = :versionLoanId AND LLC_BI__Account__c = :accountId')
            );
        }
        resolved.put('involvementChangeCount', involvementChanges.size());

        for (Integer i = 0; i < feeAdds.size(); i++) {
            StageLoanModification.FeeAdd fa = feeAdds[i];
            String s = String.valueOf(i);
            resolved.put('feeAdd' + s + '.feeType', fa.feeType);
            resolved.put('feeAdd' + s + '.description', fa.description);
            resolved.put('feeAdd' + s + '.calculationType', fa.calculationType);
            resolved.put('feeAdd' + s + '.basisSource', fa.basisSource);
            resolved.put('feeAdd' + s + '.percentage', fa.percentage);
            resolved.put('feeAdd' + s + '.amount', fa.amount);
            resolved.put('feeAdd' + s + '.recordType', fa.recordType);
            resolved.put('feeAdd' + s + '.status', fa.status);
            resolved.put('feeAdd' + s + '.paidBy', fa.paidBy);
            resolved.put('feeAdd' + s + '.isIncome', fa.isIncome);
            resolved.put('feeAdd' + s + '.targetLoanId', String.valueOf(fa.targetLoanId));
            String targetName = memberById.get(fa.targetLoanId).Name;
            steps.add(
                new C360Plan.Step('fee_add_' + s, C360Plan.TYPE_WRITE,
                    'Add ' + fa.description + ' to ' + targetName + ': ' + StageLoanModification.feePhrase(fa) +
                    ', ' + fa.recordType + ' / ' + fa.status + ', paid by ' + fa.paidBy)
                    .onObject('LLC_BI__Fee__c', new List<String>{
                        'LLC_BI__Loan__c', 'LLC_BI__Fee_Type__c', 'LLC_BI__Fee_Type_Description__c',
                        'LLC_BI__Calculation_Type__c', 'LLC_BI__Basis_Source__c', 'LLC_BI__Percentage__c',
                        'LLC_BI__Amount__c', 'LLC_BI__Record_Type__c', 'LLC_BI__Status__c', 'LLC_BI__Paid_By__c'
                    })
                    .wakes(new List<String>{
                        'nCino FeeTrigger: on a percentage fee it computes LLC_BI__Basis_Amount__c and ' +
                        'LLC_BI__Amount__c from the facility\'s own commitment, and the loan\'s fee aggregate follows'
                    })
                    .provenBy('SELECT Id, LLC_BI__Amount__c, LLC_BI__Basis_Amount__c FROM LLC_BI__Fee__c WHERE Id = :createdId')
            );
            steps.add(
                new C360Plan.Step('fee_verify_' + s, C360Plan.TYPE_VERIFICATION,
                    'Re-read the fee on ' + targetName +
                    (fa.calculationType == 'Percentage'
                        ? ', with the money the org computed rather than one this plan supplied'
                        : ', with the amount this plan staged'))
                    .onObject('LLC_BI__Fee__c', new List<String>{ 'Id', 'Name', 'LLC_BI__Amount__c' })
                    .provenBy('SELECT Id, Name, LLC_BI__Amount__c FROM LLC_BI__Fee__c WHERE LLC_BI__Loan__c = :versionLoanId')
            );
        }
        resolved.put('feeAddCount', feeAdds.size());

        for (Integer i = 0; i < pledgeAdds.size(); i++) {
            StageLoanModification.PledgeAdd pa = pledgeAdds[i];
            String s = String.valueOf(i);
            resolved.put('pledgeAdd' + s + '.isNew', pa.isNew);
            // NULL STAYS NULL. String.valueOf(null) is the four-character string 'null', and
            // C360Plan.asId on the other side would try to make a record id out of it.
            resolved.put('pledgeAdd' + s + '.collateralId', pa.collateralId == null ? null : String.valueOf(pa.collateralId));
            resolved.put('pledgeAdd' + s + '.description', pa.description);
            resolved.put('pledgeAdd' + s + '.collateralTypeId', pa.collateralTypeId == null ? null : String.valueOf(pa.collateralTypeId));
            resolved.put('pledgeAdd' + s + '.collateralTypeName', pa.collateralTypeName);
            resolved.put('pledgeAdd' + s + '.newValue', pa.newValue);
            resolved.put('pledgeAdd' + s + '.advanceRate', pa.advanceRate);
            resolved.put('pledgeAdd' + s + '.advanceRateReason', pa.advanceRateReason);
            resolved.put('pledgeAdd' + s + '.amountPledged', pa.amountPledged);
            resolved.put('pledgeAdd' + s + '.authoriseOverPledge', pa.authoriseOverPledge);
            resolved.put('pledgeAdd' + s + '.lienPosition', pa.lienPosition);
            resolved.put('pledgeAdd' + s + '.pledgedStatus', pa.pledgedStatus);
            resolved.put('pledgeAdd' + s + '.assetLabel', pa.assetLabel);
            resolved.put('pledgeAdd' + s + '.targetLoanId', String.valueOf(pa.targetLoanId));
            String targetName = memberById.get(pa.targetLoanId).Name;

            if (pa.isNew) {
                steps.add(
                    new C360Plan.Step('collateral_create_' + s, C360Plan.TYPE_WRITE,
                        'Create the asset "' + pa.description + '" as ' + pa.collateralTypeName + ', valued at ' +
                        String.valueOf(pa.newValue) +
                        '. Name on a collateral is an autonumber, so the description is its readable identity')
                        .onObject('LLC_BI__Collateral__c', new List<String>{
                            'LLC_BI__Collateral_Type__c', 'LLC_BI__Value__c', 'LLC_BI__Description__c'
                        })
                        .provenBy('SELECT Id, Name, LLC_BI__Value__c FROM LLC_BI__Collateral__c WHERE Id = :createdId')
                );
                steps.add(
                    new C360Plan.Step('collateral_own_' + s, C360Plan.TYPE_WRITE,
                        'Record the borrower as owner of "' + pa.description +
                        '". LLC_BI__Collateral__c carries NO account lookup, so this junction is the asset\'s only ' +
                        'link to the relationship')
                        .onObject('LLC_BI__Account_Collateral__c', new List<String>{
                            'LLC_BI__Account__c', 'LLC_BI__Collateral__c', 'LLC_BI__Ownership_Percentage__c', 'LLC_BI__Primary_Owner__c'
                        })
                        .provenBy('SELECT Id FROM LLC_BI__Account_Collateral__c WHERE LLC_BI__Collateral__c = :createdId')
                );
            }
            steps.add(
                new C360Plan.Step('pledge_add_' + s, C360Plan.TYPE_WRITE,
                    'Pledge ' + pa.assetLabel + ' to ' + targetName + ': ' + StageLoanModification.pledgePhrase(pa))
                    .onObject('LLC_BI__Loan_Collateral2__c', new List<String>{
                        'LLC_BI__Loan__c', 'LLC_BI__Collateral__c', 'LLC_BI__Loan_Collateral_Aggregate__c',
                        'LLC_BI__Pledged_Status__c', 'LLC_BI__Active__c', 'LLC_BI__Amount_Pledged__c',
                        'LLC_BI__Lien_Position__c', 'LLC_BI__Advance_Rate_Override__c', 'LLC_BI__Override_Reason__c'
                    })
                    .wakes(new List<String>{
                        'nCino collateral aggregate automation: the pledge hangs off the facility\'s own ' +
                        'LLC_BI__Loan_Collateral_Aggregate__c, reused where the version loan already carries one and ' +
                        'minted where it does not, because the lookup is not updateable afterwards'
                    })
                    .provenBy('SELECT Id, LLC_BI__Advance_Rate__c, LLC_BI__Current_Lendable_Value__c FROM LLC_BI__Loan_Collateral2__c WHERE Id = :createdId')
            );
            steps.add(
                new C360Plan.Step('pledge_verify_' + s, C360Plan.TYPE_VERIFICATION,
                    'Re-read the pledge on ' + targetName +
                    ', with the advance rate the org resolved and the lendable value it derived from it')
                    .onObject('LLC_BI__Loan_Collateral2__c', new List<String>{
                        'Id', 'LLC_BI__Collateral__c', 'LLC_BI__Advance_Rate__c', 'LLC_BI__Current_Lendable_Value__c'
                    })
                    .provenBy('SELECT Id, LLC_BI__Collateral__c, LLC_BI__Advance_Rate__c FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c = :versionLoanId')
            );
        }
        resolved.put('pledgeAddCount', pledgeAdds.size());

        steps.add(
            new C360Plan.Step('observe_side_effects', C360Plan.TYPE_OBSERVED,
                'Stage-driven email alerts and memo status changes the org may run')
                .wakes(new List<String>{ 'nCino Commercial - Loan After Save' })
        );

        List<String> warnings = warningsFor(
            g, members, touched, scalarChanges, fieldChanges, covenantAdds, covenantAttaches,
            involvementChanges, feeAdds, pledgeAdds, createdAssets
        );
        warnings.addAll(armWarnings);

        Map<String, Object> provenance = new Map<String, Object>{
            'versionPackageId' => new Map<String, String>{
                'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => String.valueOf(packageId)
            },
            'facilityIds' => new Map<String, String>{
                'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => facilityCitation(touched)
            }
        };

        String summary = summaryFor(
            g, members, touched, scalarChanges, fieldChanges, covenantAdds, covenantAttaches,
            involvementChanges, feeAdds, pledgeAdds, createdAssets
        );

        String planJson = C360Plan.serializePlan(summary, steps, warnings, provenance, resolved);
        String planHash = C360Plan.hash(ACTION_ID, steps, resolved);

        C360ActionStaging.Staged staged = C360ActionStaging.stagePlan(
            ACTION_ID, req.idempotencyKey, g.pkg.LLC_BI__Account__c, packageId, planJson, planHash
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
        r.accountId = g.pkg.LLC_BI__Account__c;
        r.productPackageId = packageId;
        r.versionPackageId = packageId;
        r.versionPackageName = g.pkg.Name;
        r.versionKind = g.kind;
        r.memberCount = members.size();
        r.executionHeld = false;
        r.heldReason = null;
        r.facilities = planned;
        r.facilityCount = touched.size();
        r.steps = toWireSteps(steps);
        return r;
    }

    // -----------------------------------------------------------------------------------------
    // Membership, and the arm targets that have to satisfy it.
    // -----------------------------------------------------------------------------------------

    /**
     * Refuses any arm entry whose `targetLoanId` is not a member of the version, BY NAME and under
     * the contract's own code.
     *
     * The shared parsers make the same check and refuse in the modification's words. This runs
     * first so the banker gets the version's own vocabulary and the caller gets a code it can
     * branch on. An entry with no target at all is left to the parsers, which default it to the
     * only member or refuse it where there is more than one.
     */
    private static void assertTargetsAreMembers(Request req, Map<Id, LLC_BI__Loan__c> memberById) {
        List<String> roster = new List<String>();
        for (LLC_BI__Loan__c m : memberById.values()) {
            roster.add(m.Name + ' (' + m.Id + ')');
        }
        for (String armKey : ARM_KEYS) {
            // NOT NAMED `json`. Apex identifiers are case-insensitive, so a local called `json`
            // shadows the system JSON class and `JSON.deserializeUntyped` below resolves to a
            // method on a String. Same trap as a local that shadows a method (LESSONS 25).
            String armBody = armJson(req, armKey);
            if (String.isBlank(armBody)) {
                continue;
            }
            List<Object> raw;
            try {
                raw = (List<Object>) JSON.deserializeUntyped(armBody);
            } catch (Exception e) {
                // Left to the parser, which names the arm and quotes the parse error.
                continue;
            }
            for (Object o : raw) {
                if (!(o instanceof Map<String, Object>)) {
                    continue;
                }
                Object target = ((Map<String, Object>) o).get('targetLoanId');
                if (target == null || String.isBlank(String.valueOf(target))) {
                    continue;
                }
                Id targetId;
                try {
                    targetId = Id.valueOf(String.valueOf(target));
                } catch (Exception e) {
                    // A label, or a malformed id. Both are the parser's to explain.
                    continue;
                }
                if (!memberById.containsKey(targetId)) {
                    throw refuse(
                        'TARGET_NOT_IN_VERSION',
                        armKey + ' targets facility ' + targetId + ', which is not a member of this version. An amend ' +
                        'writes to the version\'s own loans and to nothing else, so the legal targets are: ' +
                        String.join(roster, ', ') + '.'
                    );
                }
            }
        }
    }

    /**
     * Refuses a borrowing-structure REMOVE, and refuses it BEFORE the shared parser runs.
     *
     * A REMOVE ON A VERSION IS A DELETE, and nothing in this package deletes. On a modification the
     * same instruction is a CARRY EXCLUSION: the clone simply never takes the row and the booked
     * parent keeps its own. There is no carry here, because the row is already on the version, so
     * honouring a remove would mean deleting a record.
     *
     * It runs first because the shared parser RESOLVES a remove against the target's own structure,
     * and would refuse "that party is not involved on this facility" before it ever reached the
     * point of refusing the instruction itself. A banker told the wrong thing for the right reason
     * goes and adds the party so the remove will work.
     */
    private static void assertNoInvolvementRemove(Request req) {
        if (String.isBlank(req.involvementChangesJson)) {
            return;
        }
        List<Object> raw;
        try {
            raw = (List<Object>) JSON.deserializeUntyped(req.involvementChangesJson);
        } catch (Exception e) {
            // Left to the parser, which names the arm and quotes the parse error.
            return;
        }
        for (Object o : raw) {
            if (!(o instanceof Map<String, Object>)) {
                continue;
            }
            Object op = ((Map<String, Object>) o).get('op');
            if (op != null && String.valueOf(op).trim().toLowerCase() == 'remove') {
                throw new ToolException(
                    'A borrowing-structure REMOVE is not an amend. On a modification a remove is a CARRY EXCLUSION: ' +
                    'the new version simply never takes the row and the booked facility keeps its own. On a version ' +
                    'the row is already there, so removing it would be a real delete, and nothing in this package ' +
                    'deletes. Discard the version and stage the modification again without that party, or remove the ' +
                    'involvement in Salesforce.'
                );
            }
        }
    }

    /** One arm's JSON off the request, by its key. Keeps the membership sweep from being seven copies. */
    private static String armJson(Request req, String armKey) {
        if (armKey == 'scalarChangesJson') {
            return req.scalarChangesJson;
        }
        if (armKey == 'fieldChangesJson') {
            return req.fieldChangesJson;
        }
        if (armKey == 'covenantAddsJson') {
            return req.covenantAddsJson;
        }
        if (armKey == 'covenantAttachesJson') {
            return req.covenantAttachesJson;
        }
        if (armKey == 'pledgeAddsJson') {
            return req.pledgeAddsJson;
        }
        if (armKey == 'feeAddsJson') {
            return req.feeAddsJson;
        }
        return req.involvementChangesJson;
    }

    private static Boolean anyArm(Request req) {
        for (String armKey : ARM_KEYS) {
            if (String.isNotBlank(armJson(req, armKey))) {
                return true;
            }
        }
        return false;
    }

    // -----------------------------------------------------------------------------------------
    // The from -> to report, and the banker copy.
    // -----------------------------------------------------------------------------------------

    /** The loan field each scalar key writes. Named once, here and in the execute pair. */
    private static final Map<String, String> SCALAR_FIELD = new Map<String, String>{
        'requestedAmount' => 'LLC_BI__Amount__c',
        'requestedMaturityDate' => 'LLC_BI__Maturity_Date__c',
        'requestedRate' => 'LLC_BI__InterestRate__c',
        'requestedTermMonths' => 'LLC_BI__Term_Months__c'
    };

    private static void countArm(Map<Id, Integer> armsByTarget, Id targetId) {
        armsByTarget.put(targetId, (armsByTarget.containsKey(targetId) ? armsByTarget.get(targetId) : 0) + 1);
    }

    private static void recordMove(
        Map<Id, List<String>> fields,
        Map<Id, List<String>> fromValues,
        Map<Id, List<String>> toValues,
        Id targetId,
        String fieldName,
        String fromValue,
        String toValue
    ) {
        if (!fields.containsKey(targetId)) {
            fields.put(targetId, new List<String>());
            fromValues.put(targetId, new List<String>());
            toValues.put(targetId, new List<String>());
        }
        fields.get(targetId).add(fieldName);
        fromValues.get(targetId).add(fromValue);
        toValues.get(targetId).add(toValue);
    }

    /** What the version's own loan reads today for one scalar. The FROM half of the report. */
    private static String currentScalar(LLC_BI__Loan__c m, String key) {
        if (key == 'requestedAmount') {
            return String.valueOf(m.LLC_BI__Amount__c);
        }
        if (key == 'requestedMaturityDate') {
            return String.valueOf(m.LLC_BI__Maturity_Date__c);
        }
        if (key == 'requestedRate') {
            return String.valueOf(m.LLC_BI__InterestRate__c);
        }
        return String.valueOf(m.LLC_BI__Term_Months__c);
    }

    /** What it will read after the amend. The TO half. */
    private static String scalarTarget(StageLoanModification.ScalarChange sc) {
        return sc.key == 'requestedMaturityDate' ? String.valueOf(sc.dateValue) : String.valueOf(sc.numberValue);
    }

    private static String facilityCitation(List<LLC_BI__Loan__c> touched) {
        List<String> ids = new List<String>();
        for (LLC_BI__Loan__c m : touched) {
            ids.add(String.valueOf(m.Id));
        }
        return String.join(ids, ', ');
    }

    private static List<String> warningsFor(
        VersionGate g,
        List<LLC_BI__Loan__c> members,
        List<LLC_BI__Loan__c> touched,
        List<StageLoanModification.ScalarChange> scalarChanges,
        List<StageLoanModification.FieldChange> fieldChanges,
        List<StageLoanModification.CovenantAdd> covenantAdds,
        List<StageLoanModification.CovenantAttach> covenantAttaches,
        List<StageLoanModification.InvolvementChange> involvementChanges,
        List<StageLoanModification.FeeAdd> feeAdds,
        List<StageLoanModification.PledgeAdd> pledgeAdds,
        Integer createdAssets
    ) {
        List<String> out = new List<String>();
        out.add(
            'THIS WRITES TO THE VERSION ITSELF. There is no credit action, no clone and no new package version: the ' +
            'figures move on ' + g.pkg.Name + '\'s own loans, which nobody has approved. Every booked package on this ' +
            'relationship is untouched, and so is every facility on them.'
        );
        out.add(
            'The version is editable because no member has reached ' + APPROVAL_STAGE + ' on this org\'s own ladder. ' +
            'That is re-read at execute rather than assumed from now: a version that climbs to approval between this ' +
            'plan and the confirm is refused there with nothing written.'
        );
        if (touched.size() < members.size()) {
            out.add(
                'This plan touches ' + touched.size() + ' of the ' + members.size() + ' facilities on the version. The ' +
                'other ' + (members.size() - touched.size()) + ' keep every figure and every record they carry today.'
            );
        }
        if (!scalarChanges.isEmpty()) {
            out.add(
                'Each figure names the facility it lands on and reaches no other. There is no broadcast channel on an ' +
                'amend: a version routinely holds several loans, and one value spread across all of them is a change ' +
                'nobody asked for.'
            );
        }
        if (!fieldChanges.isEmpty()) {
            out.add(
                String.valueOf(fieldChanges.size()) + ' field ' + (fieldChanges.size() == 1 ? 'change is' : 'changes are') +
                ' applied directly to the version\'s own loans, each resolved against the org\'s own describe and named ' +
                'with its value in the plan. Stage, status, the four scalar keys and the anchoring lookups are outside ' +
                'the wave by doctrine.'
            );
        }
        if (!covenantAdds.isEmpty()) {
            out.add(
                'Net-new covenants are created Pending and Active on the borrower account and attached to the version\'s ' +
                'own loan. No compliance row is minted and no approval starts (probed live 2026-08-30): the org\'s own ' +
                'covenant review cycle owns the schedule from here, and booking the version is what makes the covenant bind.'
            );
        }
        if (!covenantAttaches.isEmpty()) {
            out.add(
                String.valueOf(covenantAttaches.size()) + ' EXISTING covenant' +
                (covenantAttaches.size() == 1 ? ' is' : 's are') + ' associated by a junction only. No covenant is ' +
                'created and none is amended: the threshold, the frequency and the schedule stay exactly as the ' +
                'borrower holds them. A covenant that sits at relationship level carries NO loan junction, so it is ' +
                'not associated to the facility however it reads at relationship level, and this is the write that ' +
                'associates it.'
            );
        }
        if (!involvementChanges.isEmpty()) {
            out.add(
                String.valueOf(involvementChanges.size()) + ' borrowing-structure ' +
                (involvementChanges.size() == 1 ? 'row is' : 'rows are') + ' added to the version. An amend ADDS only: ' +
                'removing a party from a version would be a real delete rather than the carry exclusion a modification ' +
                'can express, and nothing in this package deletes.'
            );
        }
        if (!feeAdds.isEmpty()) {
            Integer pctFees = StageLoanModification.percentageFees(feeAdds);
            out.add(
                String.valueOf(feeAdds.size()) + ' net-new ' + (feeAdds.size() == 1 ? 'fee is' : 'fees are') +
                ' authored on the version\'s own loans. A fee row is bound to its loan at insert ' +
                '(LLC_BI__Loan__c is not updateable on it), so this is a creation rather than a move.' +
                (pctFees == 0 ? '' :
                    ' On the ' + String.valueOf(pctFees) + ' percentage ' + (pctFees == 1 ? 'fee' : 'fees') +
                    ' this plan sends NO money figure: nCino\'s own FeeTrigger computes the basis and the amount from ' +
                    'the facility\'s commitment, which is the commitment this plan may itself be moving. The execution ' +
                    'reports what the org worked out.')
            );
        }
        if (!pledgeAdds.isEmpty()) {
            Integer noLien = 0;
            Integer authorised = 0;
            for (StageLoanModification.PledgeAdd pa : pledgeAdds) {
                if (String.isBlank(pa.lienPosition)) {
                    noLien++;
                }
                if (pa.authoriseOverPledge == true) {
                    authorised++;
                }
            }
            out.add(
                String.valueOf(pledgeAdds.size()) + ' collateral ' + (pledgeAdds.size() == 1 ? 'pledge is' : 'pledges are') +
                ' authored on the version\'s own loans, and no existing pledge anywhere is touched.' +
                (createdAssets == 0 ? '' :
                    ' ' + String.valueOf(createdAssets) + ' of them ' + (createdAssets == 1 ? 'creates a NEW asset' : 'create NEW assets') +
                    ', which is three connected writes each: the asset, then the LLC_BI__Account_Collateral__c ownership ' +
                    'junction (LLC_BI__Collateral__c has no account lookup of its own, so this is the borrower link), ' +
                    'then the pledge. The asset itself is a permanent record on the relationship and survives whatever ' +
                    'the bank decides about this version.') +
                (noLien == 0 ? '' :
                    ' ' + String.valueOf(noLien) + ' ' + (noLien == 1 ? 'pledge states' : 'pledges state') +
                    ' NO lien position: nobody said one, and priority is a perfection question this tool does not settle.') +
                (authorised == 0 ? '' :
                    ' ' + String.valueOf(authorised) + ' ' + (authorised == 1 ? 'pledge takes' : 'pledges take') +
                    ' MORE than the lendable value of the asset behind ' + (authorised == 1 ? 'it' : 'them') +
                    ', and ' + (authorised == 1 ? 'carries' : 'carry') + ' the Authorize Pledge Amount checkbox because ' +
                    'the request asked for it. That is the org\'s own escape from Pledge_More_Than_Lendable_Value and ' +
                    'it records a decision, so read the figure before confirming.')
            );
        }
        out.add(
            'This amends a version, NOT an approval. The version still reaches the bank through nCino\'s own Submit ' +
            'for Approval with real approvers; nothing here approves anything.'
        );
        return out;
    }

    private static String summaryFor(
        VersionGate g,
        List<LLC_BI__Loan__c> members,
        List<LLC_BI__Loan__c> touched,
        List<StageLoanModification.ScalarChange> scalarChanges,
        List<StageLoanModification.FieldChange> fieldChanges,
        List<StageLoanModification.CovenantAdd> covenantAdds,
        List<StageLoanModification.CovenantAttach> covenantAttaches,
        List<StageLoanModification.InvolvementChange> involvementChanges,
        List<StageLoanModification.FeeAdd> feeAdds,
        List<StageLoanModification.PledgeAdd> pledgeAdds,
        Integer createdAssets
    ) {
        List<String> names = new List<String>();
        for (LLC_BI__Loan__c m : touched) {
            names.add(m.Name);
        }
        return
            'Amends ' + g.pkg.Name + ' in place: it is an ' + g.kind + ' with ' + members.size() + ' ' +
            (members.size() == 1 ? 'facility' : 'facilities') + ', every one of them below ' + APPROVAL_STAGE +
            ', so the figures move on the version\'s own loans rather than through a credit action. ' +
            (touched.isEmpty()
                ? ''
                : (touched.size() == 1 ? names[0] + ' is the facility being amended. ' :
                   String.valueOf(touched.size()) + ' facilities are being amended: ' + String.join(names, ', ') + '. ')) +
            (scalarChanges.isEmpty() ? '' : String.valueOf(scalarChanges.size()) + ' scalar ' +
                (scalarChanges.size() == 1 ? 'change is' : 'changes are') + ' aimed at a NAMED facility each. ') +
            (fieldChanges.isEmpty() ? '' : String.valueOf(fieldChanges.size()) + ' field ' +
                (fieldChanges.size() == 1 ? 'change is' : 'changes are') + ' applied, each resolved against the org\'s ' +
                'own describe and named with its value in the plan. ') +
            (covenantAdds.isEmpty() ? '' : String.valueOf(covenantAdds.size()) + ' net-new covenant' +
                (covenantAdds.size() == 1 ? ' is' : 's are') + ' created on the borrower and attached to the version, ' +
                'born Pending and Active. ') +
            (covenantAttaches.isEmpty() ? '' : String.valueOf(covenantAttaches.size()) + ' existing covenant' +
                (covenantAttaches.size() == 1 ? ' is' : 's are') + ' associated by a junction only, with no covenant ' +
                'created and none amended. ') +
            (involvementChanges.isEmpty() ? '' : String.valueOf(involvementChanges.size()) + ' borrowing-structure ' +
                (involvementChanges.size() == 1 ? 'row is' : 'rows are') + ' added. ') +
            (feeAdds.isEmpty() ? '' : String.valueOf(feeAdds.size()) + ' net-new fee' +
                (feeAdds.size() == 1 ? ' is' : 's are') + ' created, each resolved against the org\'s own fee ' +
                'picklists; a percentage fee carries its basis and its rate and lets the org compute the money. ') +
            (pledgeAdds.isEmpty() ? '' : String.valueOf(pledgeAdds.size()) + ' collateral pledge' +
                (pledgeAdds.size() == 1 ? ' is' : 's are') + ' authored' +
                (createdAssets == 0 ? ', each on an asset the borrower already owns. '
                    : ', creating ' + String.valueOf(createdAssets) + ' new asset' + (createdAssets == 1 ? '' : 's') +
                      ' and the ownership junction that ties ' + (createdAssets == 1 ? 'it' : 'them') + ' to the borrower. ')) +
            'NOTHING IS WRITTEN BY THIS CALL: staging computes and holds the plan, and execute_amend_version runs it ' +
            'behind the decision token after re-reading the gate.';
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
