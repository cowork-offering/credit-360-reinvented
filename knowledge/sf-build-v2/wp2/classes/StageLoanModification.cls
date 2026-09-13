/**
 * StageLoanModification - MCP tool: stage_loan_modification.
 *
 * EXECUTION IS AVAILABLE. execute_loan_modification runs this plan behind the single-use decision
 * token. That was not true for one wave, and the change is a probe finding rather than a change of
 * mind (EVIDENCE-SEPT4.md "Mod-execute probe", 2026-08-20, and the WS0.5 probe in the same file).
 *
 * WHAT THE HOLD ACTUALLY WAS. A credit action acts only on a "valid facility": probe 9 read every
 * LLC_BI__LoanRenewal__c chain in the org and found every parent at Stage = Booked, Status = Open,
 * with a non-null core lookupKey. Anything else returns "The request contains invalid facilities".
 * The hold assumed a Booked parent was unreachable, because Loan_Validation_06 refuses a manual move
 * to a post-approval stage with no permission bypass. LV06 keys on PRIORVALUE, which is blank on an
 * INSERT, so a facility filed AT Booked with a lookupKey never trips it, and the credit action then
 * ran live end to end on throwaway data. The valid-facility rule still stands and is still enforced
 * here; what was wrong was the belief that no facility could ever satisfy it.
 *
 * WHAT IS STILL HELD, AND ALWAYS WILL BE. Execution produces a modification CLONE at Qualification.
 * BOOKING that clone is nCino's own process: Submit for Approval, real approvers, LV06 unchanged.
 * This tool plans a modification, not an approval, and the warnings say so before the banker confirms.
 *
 * PACKAGE-ANCHORED, MULTI-FACILITY (ACTIONS-DESIGN 5.1 anchor correction, Fabian, 2026-07-25). The
 * anchor is the PRODUCT PACKAGE: nCino's CreditActionSoaXPkg takes the package id plus a list of
 * (booked facility, action) pairs, so a facility is a member selection within the package rather
 * than the anchor. This tool takes `facilityIds` as that package-anchored shape and keeps the flat
 * `loanId` as the single-facility back-compat shape. Exactly one shape per call. One call produces
 * ONE plan, ONE plan hash and ONE decision token, carrying N per-facility typed steps. The selection
 * contract itself lives in C360Facilities, shared with stage_renewal so the two cannot drift.
 *
 * TWO CHANNELS FOR THE FOUR SCALARS (2026-08-31). Founder: "there is the possibility that there is a
 * change on a loan which does not have an increase or decrease". The flat requestedAmount /
 * requestedMaturityDate / requestedRate / requestedTermMonths BROADCAST: one value onto every
 * selected clone. That is right for a single-facility plan, and for a change every member genuinely
 * shares. It cannot express a mixed plan, and worse, it files silently on members that never asked:
 * an amount on the line of credit staged beside a field change on the equipment loan used to take
 * the equipment clone to the line's commitment. `scalarChangesJson` carries the same four keys PER
 * TARGET, so each clone takes only its own. The two are mutually exclusive by refusal.
 *
 * INPUT SHAPE AND THE required=true TRAP (lesson 16aa). `required=true` on an @InvocableVariable is
 * enforced by the REST Actions API BEFORE Apex runs, and NO Apex unit test can see it, because a
 * direct test invocation constructs the Request itself. A tool that grows an alternative input shape
 * must therefore drop required=true from every field the new shape supersedes, or the platform
 * refuses the new shape and our Apex never executes. `loanId` is no longer flagged required;
 * requiredness is enforced in Apex, where it can also say WHICH facility is wrong. `idempotencyKey`,
 * `productPackageId` and `rationale` keep required=true: both shapes need all three.
 *
 * NET-NEW FACILITIES INSIDE THE MODIFICATION (founder, 2026-09-03: "Do we allow new loans to be
 * created as part of the modification and renewal? This should be fully possible."). Because the
 * credit action versions the PACKAGE, the new version is the right place for new money, and adding a
 * facility to it is what a bank does rather than filing a separate credit action against a package
 * nobody is approving. `newFacilitiesJson` carries them, C360NewFacilities owns the shape so the
 * create route and this one cannot drift, and every other arm may name one by its LABEL because the
 * id does not exist until execute time. A carry exclusion is the one arm that may NOT: there is
 * nothing on a facility being created for the new version to leave behind.
 *
 * THE ARM PARSERS ARE SHARED, NOT COPIED (0.9.23). `StageAmendVersion` stages the same seven arms
 * against the loans of an unbooked VERSION instead of against clones that do not exist yet, and the
 * tool contract requires the same JSON shapes. So the arm parsers below carry `public` rather than
 * `private` visibility and StageAmendVersion calls them with a Request it fills in itself. Nothing
 * about their behaviour changed with that widening: every check, every refusal and every resolved
 * value is byte-identical to the wave that shipped, and this class's own tests cover them unchanged.
 * The alternative was a second copy of roughly fifteen hundred lines of org-resolution logic, which
 * is the kind of duplication that drifts silently the first time a picklist moves.
 *
 * Org contract: A33.4.1. Two corrections carried from probe 5: LLC_BI__RootLoanId__c DOES NOT EXIST
 * on Loan in this org, so nothing here walks a chain through it; and the org rewrites the loan name,
 * so no name is echoed anywhere in this plan.
 */
global with sharing class StageLoanModification {

    /** Raised for a domain-level validation failure. Surfaces as ok:false, never as a fault. */
    public class ToolException extends Exception {}

    global class Request {
        @InvocableVariable(label='Idempotency Key' required=true)
        global String idempotencyKey;
        @InvocableVariable(label='Product Package Id' description='The deal anchor. Every selected facility must be a member of it.' required=true)
        global String productPackageId;
        @InvocableVariable(label='Loan Id' description='Single-facility path. Supply this OR facilityIds, never both. Not flagged required on the invocable because facilityIds supersedes it; requiredness is enforced in Apex.')
        global String loanId;
        @InvocableVariable(label='Facility Ids' description='Package-anchored path: the member facilities of this package to modify, in one plan under one decision token. Omit it and the single loanId above is used.')
        global List<Id> facilityIds;
        @InvocableVariable(label='Rationale' required=true)
        global String rationale;
        @InvocableVariable(label='Requested Amount' description='BROADCAST: applied to EVERY selected facility. Use scalarChangesJson instead when the members need different figures.')
        global Decimal requestedAmount;
        @InvocableVariable(label='Requested Maturity Date' description='BROADCAST: applied to EVERY selected facility.')
        global Date requestedMaturityDate;
        @InvocableVariable(label='Requested Rate' description='BROADCAST: applied to EVERY selected facility.')
        global Decimal requestedRate;
        @InvocableVariable(label='Requested Term Months' description='BROADCAST: applied to EVERY selected facility.')
        global Decimal requestedTermMonths;
        @InvocableVariable(label='Scalar Changes JSON' description='Optional. THE FOUR SCALARS, PER TARGET: JSON list [{"key" (requestedAmount|requestedMaturityDate|requestedRate|requestedTermMonths), "value", "targetLoanId"?}]. Each lands on the CLONE of the named facility ALONE, so one plan can take one member to a new commitment while another takes a different change entirely. MUTUALLY EXCLUSIVE with the four flat fields above, which broadcast one value to every selected facility: a request carrying both is refused, because the clone would hold two figures and no rule to choose between them. targetLoanId may be omitted when exactly one facility is selected.')
        global String scalarChangesJson;
        @InvocableVariable(label='Covenant Adds JSON' description='Optional. JSON list of net-new covenants to create and attach: [{"typeName" or "typeId", "threshold", "operator" (< <= = >= >), "frequency"?, "effectiveDate"? (YYYY-MM-DD), "targetLoanId"?}]. Each is created Pending/Active on the borrower account and attached to the CLONE of the targeted facility on the new package version, never to the booked parent. targetLoanId may be omitted when exactly one facility is selected.')
        global String covenantAddsJson;
        @InvocableVariable(label='Involvement Changes JSON' description='Optional. JSON list of borrowing-structure amendments: [{"op" (add|remove), "role" (Borrower|Co-Borrower|Guarantor|Limited Guarantor|Related Entity), "accountId" or "accountName", "ownership"?, "targetLoanId"?}]. An ADD authors the involvement on the CLONE of the targeted facility on the new package version. A REMOVE is a carry exclusion: the parent keeps its row and the clone starts without it — nothing is ever deleted. targetLoanId may be omitted when exactly one facility is selected.')
        global String involvementChangesJson;
        @InvocableVariable(label='Field Changes JSON' description='Optional. THE FIELD WAVE: JSON list of loan-field amendments applied to the CLONE: [{"field" (API name or exact field label), "value", "targetLoanId"?}]. The field must be updateable and non-formula per the org\'s own describe, outside the doctrine deny-list (stage, status, the four scalar keys, anchoring lookups). Values are coerced by the field\'s own type; a picklist value is validated against the org\'s active values and a refusal carries the legal list. targetLoanId may be omitted when exactly one facility is selected.')
        global String fieldChangesJson;
        @InvocableVariable(label='Fee Adds JSON' description='Optional. NET-NEW FEES authored on the CLONE: [{"feeType" (an active LLC_BI__Fee_Type__c value), "description" (the human label; Name on a fee is an autonumber), "calculationType" (Percentage|Flat Amount), "percentage"? , "amount"?, "basisSource"?, "recordType"? (Fees|Costs|Adjustments), "paidBy"?, "targetLoanId"?}]. A PERCENTAGE fee carries a percentage and a basis and NO amount: the org\'s own FeeTrigger derives the basis amount and the money from the clone\'s commitment, and a supplied amount is refused rather than overwritten. A FLAT AMOUNT fee carries an amount and no percentage. RecordTypeId is never written (no Fee record type is assigned to the integration user\'s profile); recordType is the independent LLC_BI__Record_Type__c picklist. targetLoanId may be omitted when exactly one facility is selected.')
        global String feeAddsJson;
        @InvocableVariable(label='Pledge Adds JSON' description='Optional. COLLATERAL PLEDGES authored on the CLONE: [{"collateralId"? (an existing LLC_BI__Collateral__c the BORROWER owns), "newCollateral"? {"description", "collateralType", "value"}, "advanceRate"?, "advanceRateReason"?, "amountPledged"?, "authoriseOverPledge"?, "lienPosition"?, "targetLoanId"?}]. EXACTLY ONE of collateralId and newCollateral per entry. An existing collateral must be owned by the borrower through LLC_BI__Account_Collateral__c (LLC_BI__Collateral__c carries no account lookup at all) and must not already be pledged to that facility. A newCollateral is authored as asset, then ownership junction, then pledge. Its DESCRIPTION is at most 255 characters, which is the length of LLC_BI__Description__c on this org, and a longer one is refused with its own length rather than truncated or left to fail on the insert. Its COLLATERALTYPE takes EITHER an LLC_BI__Collateral_Type__c record id (the a33 prefix, which is what Customer360Catalog returns as acceptedValues) OR the type\'s exact name: names are NOT unique in this catalog, so a name matching more than one row is refused with the candidate ids and their advance rates and the id settles it. A type whose own advance rate is null is refused before the org\'s Advance_Rate_should_not_be_null rule fires on the insert. advanceRate is REQUIRED on a create and rides LLC_BI__Advance_Rate_Override__c (the plain advance rate is a formula), which makes the org\'s Advance_Rate_Override rule demand a reason beside it. amountPledged is OPTIONAL and DEFAULTS to the asset\'s lendable value, which is its value times the rate this pledge resolves to: the override where one is stated, the type\'s own rate otherwise. A figure ABOVE the lendable value is refused with that value and the rate behind it, because the org\'s Pledge_More_Than_Lendable_Value rule refuses the row unless LLC_BI__Authorize__c (Authorize Pledge Amount) is set; send "authoriseOverPledge": true on the same entry to set it, which records the banker authorising the over-pledge on the row rather than the tool doing it silently. The flag is written only where it does work: sent on a pledge within the lendable value it is ignored, because there is nothing to authorise. targetLoanId may be omitted when exactly one facility is selected.')
        global String pledgeAddsJson;
        @InvocableVariable(label='Covenant Exclusions JSON' description='Optional. COVENANT CARRY EXCLUSIONS: [{"covenantId" or "junctionId", "targetLoanId"?}]. On a modification nothing is deleted on the booked loan: the new VERSION simply does not carry that LLC_BI__Loan_Covenant__c junction onto the clone. The parent keeps its junction and the covenant record itself is untouched, so the delete fence and the covenant-detach fence both stay intact. The exact junction row is resolved at stage time against the target parent, so the banker confirms a named covenant rather than a description. targetLoanId may be omitted when exactly one facility is selected.')
        global String covenantExclusionsJson;
        @InvocableVariable(label='Pledge Exclusions JSON' description='Optional. PLEDGE CARRY EXCLUSIONS: [{"pledgeId" or "collateralId", "targetLoanId"?}]. The collateral counterpart of a covenant exclusion: the named LLC_BI__Loan_Collateral2__c pledge does not travel onto the clone. The booked facility keeps the pledge it holds today, the asset and its ownership junction are untouched, and nothing is deleted. The exact pledge row is resolved at stage time against the target parent. targetLoanId may be omitted when exactly one facility is selected.')
        global String pledgeExclusionsJson;
        @InvocableVariable(label='Covenant Attaches JSON' description='Optional. ASSOCIATE AN EXISTING COVENANT to a facility: [{"covenantId", "targetLoanId"?}]. A junction-only create. No covenant is inserted, nothing is deleted: an LLC_BI__Loan_Covenant__c row ties a covenant the borrower already holds to the CLONE of the targeted facility, which is the instrument for a relationship-level covenant that carries no loan junction and is therefore NOT associated to the loan. The covenant must belong to the borrower on this package, and a covenant already attached to the target is refused by name rather than junctioned twice. targetLoanId may be omitted when exactly one facility is selected.')
        global String covenantAttachesJson;
        @InvocableVariable(label='Policy Exception Adds JSON' description='Optional. POLICY EXCEPTIONS authored on the CLONE and anchored on the borrower: [{"title" (the exception\'s readable name, <=80 chars), "status" (Waived|Mitigated|Unmitigated), "mitigationReasons"? (up to 3, <=100 chars each), "severity"?, "severityValue"?, "code"?, "type"? (defaults to "Policy"), "targetLoanId"?}]. TITLE IS REQUIRED: Name on this object is plain text rather than an autonumber, and the org\'s trigger stack backfills an omitted one with the record\'s own 15-character Id, so an unnamed exception is a row nobody can find. STATUS IS REQUIRED: the org defaults a new row to Unmitigated, which reads as a decision rather than as an absent value. A Mitigated exception needs at least one mitigation reason and an Unmitigated one may carry none, because "nothing mitigates this" and "here is what mitigates it" cannot both be true on one record. Over-long reasons are refused with their length, never truncated. WARNING: a committed write here fires the org-local PolicyExceptionCDC trigger, which POSTs the serialised record to an external AWS EventBridge endpoint. No approval starts and no email fires (probed 2026-08-31), but the record\'s data leaves the org. targetLoanId may be omitted when exactly one facility is selected.')
        global String policyExceptionAddsJson;
        @InvocableVariable(label='New Facilities JSON' description='Optional. NET-NEW FACILITIES filed on the NEW package version this modification creates: [{"label"? ("new:1", "new:2", defaulted by position), "product" (an exact Commercial Loan record-type product: Construction, Deposit, Equipment, HELOC, Line of Credit, Purchase), "amount", "termMonths", "purpose" (the primary loan purpose), "amortizedTermMonths"?, "firstPaymentDate"? (YYYY-MM-DD)}]. In nCino a modification versions the whole PACKAGE, and adding a facility to the version being approved is ordinary practice; this is that, rather than a separate credit action on the current package. Each facility is filed at Qualification/Open with the borrower on its borrowing structure, carries no chain row and no modification flag because it is a new loan rather than a version of one, and takes the two pricing prerequisites where they are given. The purpose lands on the Loan Detail nCino creates in its own transaction after the filing, so it is written where that record has already appeared and reported as a handoff where it has not. Every other arm of this same request may target a new facility by its LABEL in place of targetLoanId, so a covenant, a party, a pledge, a fee or a field change can be staged onto a facility that has no id yet.')
        global String newFacilitiesJson;
    }

    /** One of the four scalars, aimed at ONE selected facility. */
    public class ScalarChange {
        /** The canonical request-key name, echoed back in refusals and the plan. */
        public String key;
        /** Set for requestedAmount, requestedRate and requestedTermMonths. */
        public Decimal numberValue;
        /** Set for requestedMaturityDate. */
        public Date dateValue;
        public Id targetLoanId;
    }

    /** One parsed field-wave amendment, resolved against the org's own describe. */
    public class FieldChange {
        public String fieldName;
        public String fieldLabel;
        public String fieldType;
        /** The coerced value, re-serialized for the plan. */
        public String valueJson;
        public Id targetLoanId;
        /** Set instead of targetLoanId where the target is a NET-NEW facility this same plan
         *  creates, named by its label ("new:1"). The id does not exist until execute time. */
        public String targetNewLabel;
    }

    /** One parsed borrowing-structure amendment, resolved against the org. */
    public class InvolvementChange {
        public String op;
        public String role;
        public Id accountId;
        public String accountName;
        public Decimal ownership;
        public Id targetLoanId;
        /** Set instead of targetLoanId where the target is a NET-NEW facility this same plan
         *  creates, named by its label ("new:1"). The id does not exist until execute time. */
        public String targetNewLabel;
        /** The involvement row a REMOVE excludes from the carry, resolved at stage time. */
        public Id sourceRowId;
    }

    /**
     * One covenant junction the clone will NOT carry, resolved to its exact row at stage time.
     *
     * A modification never deletes anything on the booked loan. The diff the manifest expresses is
     * a CARRY diff: everything not named travels onto the new version, and what is named as removed
     * simply never reaches it. The covenant record itself, its account association and the parent's
     * own junction are all untouched, which is why this does not breach the delete fence or the
     * covenant-detach fence (detach would be a delete of a junction whose every field is
     * non-updateable; this writes nothing at all).
     */
    public class CovenantExclusion {
        /** The LLC_BI__Loan_Covenant__c row on the PARENT that the carry will skip. */
        public Id junctionId;
        public Id covenantId;
        /** The covenant's org-assigned autonumber, so the plan names a record the banker can find. */
        public String covenantName;
        public String typeName;
        public Decimal threshold;
        public Id targetLoanId;
    }

    /** One pledge the clone will NOT carry. Same doctrine as a covenant exclusion, on collateral. */
    public class PledgeExclusion {
        /** The LLC_BI__Loan_Collateral2__c row on the PARENT that the carry will skip. */
        public Id pledgeId;
        public Id collateralId;
        /** The asset as the org names it: its description where it has one, else the autonumber. */
        public String assetLabel;
        public Decimal amountPledged;
        public Id targetLoanId;
    }

    /**
     * One EXISTING covenant to associate to a facility: a junction-only create.
     *
     * The founder's correction (2026-09-02): a relationship-level covenant carries no loan junction,
     * so it is not associated to the loan, and "the relationship level already covers it" is wrong.
     * Dedupe is per loan-covenant junction. When the covenant is not on that loan the room offers
     * three instruments, and this is the second: associate the existing covenant rather than mint a
     * near-duplicate of it.
     */
    public class CovenantAttach {
        public Id covenantId;
        public String covenantName;
        public String typeName;
        public Decimal threshold;
        public String operator;
        public Id targetLoanId;
        /** Set instead of targetLoanId where the target is a NET-NEW facility this same plan
         *  creates, named by its label ("new:1"). The id does not exist until execute time. */
        public String targetNewLabel;
    }

    /** One parsed net-new fee, resolved against the org's own fee picklists. */
    public class FeeAdd {
        public String feeType;
        /** The human label. `Name` on a fee is an autonumber, so this is the only place it can go. */
        public String description;
        public String calculationType;
        /** Percentage fees only. The field the org computes the basis amount from. */
        public String basisSource;
        public Decimal percentage;
        /** Flat fees only. Null on a percentage fee, where the org derives it. */
        public Decimal amount;
        public String recordType;
        public String status;
        public String paidBy;
        public Boolean isIncome;
        public Id targetLoanId;
        /** Set instead of targetLoanId where the target is a NET-NEW facility this same plan
         *  creates, named by its label ("new:1"). The id does not exist until execute time. */
        public String targetNewLabel;
    }

    /** One parsed pledge, in whichever of its two shapes the caller sent. */
    public class PledgeAdd {
        /** An EXISTING collateral, proven owned by the borrower. Null on a create. */
        public Id collateralId;
        /** True when this run has to author the asset and its ownership junction first. */
        public Boolean isNew;
        /** The asset's readable label. `Name` on a collateral is an autonumber (COL-000nnn). */
        public String description;
        /** The resolved `LLC_BI__Collateral_Type__c` record, never a name. */
        public Id collateralTypeId;
        public String collateralTypeName;
        /** The type's OWN advance rate, which is what a pledge falls back to. */
        public Decimal typeAdvanceRate;
        public Decimal newValue;
        /** Rides `LLC_BI__Advance_Rate_Override__c`; the plain advance rate is a formula. */
        public Decimal advanceRate;
        /** Demanded by the org's `Advance_Rate_Override` rule whenever the override is set. */
        public String advanceRateReason;
        /** This facility's share of the asset. Above the lendable value only where the caller
         *  authorised it, which is what `authoriseOverPledge` below records. */
        public Decimal amountPledged;
        /** Set ONLY where the share exceeds the lendable value AND the caller sent
         *  `authoriseOverPledge: true`. It rides `LLC_BI__Authorize__c`, the org's own escape from
         *  `Pledge_More_Than_Lendable_Value`, so the checkbox states a decision somebody took. */
        public Boolean authoriseOverPledge;
        public String lienPosition;
        public String pledgedStatus;
        /** What the asset is worth, whether authored here or read off the org. */
        public Decimal collateralValue;
        /** The asset as the plan names it, which is the description or the autonumber. */
        public String assetLabel;
        public Id targetLoanId;
        /** Set instead of targetLoanId where the target is a NET-NEW facility this same plan
         *  creates, named by its label ("new:1"). The id does not exist until execute time. */
        public String targetNewLabel;
    }

    /** One parsed policy exception, resolved against the org's own status picklist. */
    public class PolicyExceptionAdd {
        /** The row's readable identity. `Name` is plain text here, and an omitted one is
         *  backfilled by the org with the record's own Id. */
        public String title;
        public String status;
        /** Free text, and the object's only required field. Every row this org holds reads
         *  "Policy"; the guard fences it to that. */
        public String exceptionType;
        public String code;
        /** Free text on this org too: "Major" is a data convention, not a picklist. */
        public String severity;
        public Decimal severityValue;
        /** Laid onto `LLC_BI__Mitigation_Reason_1..3__c`, in order. */
        public List<String> reasons;
        public Id targetLoanId;
    }

    /** One parsed net-new covenant, resolved against the org's own type catalog. */
    public class CovenantAdd {
        public Id typeId;
        public String typeName;
        public Decimal threshold;
        public String operator;
        public String frequency;
        public Date effectiveDate;
        public Id targetLoanId;
        /** Set instead of targetLoanId where the target is a NET-NEW facility this same plan
         *  creates, named by its label ("new:1"). The id does not exist until execute time. */
        public String targetNewLabel;
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
        @InvocableVariable(label='Covenant Carryover Count' description='Loan Covenant junction rows on this facility that would clone onto its modification.')
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
        @InvocableVariable(label='Execution Held' description='False since execute_loan_modification shipped. Kept on the contract so a caller written against the held wave still reads a defined answer.')
        global Boolean executionHeld;
        @InvocableVariable(label='Held Reason' description='Null while execution is available. Booking the resulting clone is a separate nCino step and is carried in the warnings, not here.')
        global String heldReason;
        @InvocableVariable(label='Covenant Carryover Count' description='Loan Covenant junction rows that would clone, totalled across every selected facility. An empty list is a real answer, not blank space.')
        global Integer covenantCarryoverCount;
        @InvocableVariable(label='Facilities' description='One entry per selected facility, with the plan step ids that belong to it.')
        global List<PlannedFacility> facilities;
        @InvocableVariable(label='Facility Count')
        global Integer facilityCount;
        @InvocableVariable(label='New Facility Count' description='Net-new facilities this plan files on the new package version. Zero is the ordinary answer.')
        global Integer newFacilityCount;
        @InvocableVariable(label='New Facility Labels' description='The labels the other arms of this request may target, in the order they were sent.')
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
     * Stages a loan modification. Writes no domain record; execution is a separate, token-gated call.
     *
     * @param requests One request per staged action. Element i of the response belongs to input i.
     * @return One response per request.
     */
    @InvocableMethod(
        label='stage_loan_modification'
        description='Validate a package-anchored facility modification and return an immutable execution plan with a plan hash. Takes either the single loanId or facilityIds, the member facilities of the package, never both. NET-NEW FACILITIES may ride the same request in newFacilitiesJson: a modification versions the whole package, and a new loan on the version being approved is ordinary nCino practice, so a covenant, a party, a pledge, a fee or a field change may target one by its label (new:1) in place of targetLoanId. Writes nothing: execute_loan_modification runs the plan behind the single-use decision token. Executing produces a modification clone at Qualification; booking that clone still requires nCino\'s human Submit for Approval.'
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
        if (req.requestedAmount == null && req.requestedMaturityDate == null && req.requestedRate == null &&
            req.requestedTermMonths == null && String.isBlank(req.scalarChangesJson) && String.isBlank(req.covenantAddsJson) &&
            String.isBlank(req.involvementChangesJson) && String.isBlank(req.fieldChangesJson) &&
            String.isBlank(req.feeAddsJson) && String.isBlank(req.pledgeAddsJson) &&
            String.isBlank(req.policyExceptionAddsJson) && String.isBlank(req.covenantExclusionsJson) &&
            String.isBlank(req.pledgeExclusionsJson) && String.isBlank(req.covenantAttachesJson) &&
            String.isBlank(req.newFacilitiesJson)) {
            throw new ToolException('At least one requested change is required: amount, maturity date, rate, term, a covenant add, a covenant association, a covenant or pledge carry exclusion, a borrowing-structure change, a field change, a fee add, a collateral pledge, a policy exception, or a net-new facility on the new version.');
        }
        if (req.requestedAmount != null && req.requestedAmount <= 0) {
            throw new ToolException('requestedAmount must be greater than zero.');
        }

        Id packageId = C360Facilities.packageId(req.productPackageId);
        List<Id> selected = C360Facilities.resolve(req.loanId, req.facilityIds, 'modification');
        List<LLC_BI__Loan__c> facilities =
            C360Facilities.validate(readFacilities(selected), selected, packageId, 'Modifications');
        Map<Id, Integer> carryoverByFacility = C360Facilities.covenantCarryover(selected);

        // nCino package methodology (founder correction, 2026-08-30): a modification never versions
        // a loan alone. The credit action rolls the WHOLE package: every eligible member is cloned
        // into the next package version, the selected ones then take the requested changes, the rest
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

        List<String> covenantWarnings = new List<String>();
        // THE NET-NEW FACILITIES ARE READ FIRST, because every other arm may name one. A label is
        // resolved against this list at stage time, so an arm aimed at a facility nobody staged is
        // refused here rather than landing nowhere at execute time.
        List<C360NewFacilities.NewFacility> newFacilities =
            C360NewFacilities.parse(req.newFacilitiesJson, 'modification');
        List<ScalarChange> scalarChanges = parseScalarChanges(req, facilities);
        List<CovenantAdd> covenantAdds = parseCovenantAdds(req, facilities, newFacilities, covenantWarnings);
        List<InvolvementChange> involvementChanges = parseInvolvementChanges(req, facilities, newFacilities, covenantWarnings);
        List<FieldChange> fieldChanges = parseFieldChanges(req, facilities, newFacilities);
        List<FeeAdd> feeAdds = parseFeeAdds(req, facilities, newFacilities);
        List<PledgeAdd> pledgeAdds = parsePledgeAdds(req, facilities, newFacilities);
        Integer createdAssets = newCollaterals(pledgeAdds);
        List<PolicyExceptionAdd> policyExceptionAdds = parsePolicyExceptionAdds(req, facilities);
        List<CovenantExclusion> covenantExclusions = parseCovenantExclusions(req, facilities);
        List<PledgeExclusion> pledgeExclusions = parsePledgeExclusions(req, facilities);
        List<CovenantAttach> covenantAttaches = parseCovenantAttaches(req, facilities, newFacilities, covenantWarnings);
        // A plan that excludes a covenant from a facility's carry AND associates the same covenant
        // to that facility's clone says two opposite things about one junction. The arm would honour
        // both in order and the banker would read "removed" beside a covenant that is there.
        Set<String> excludedPairs = new Set<String>();
        for (CovenantExclusion ce : covenantExclusions) {
            excludedPairs.add(String.valueOf(ce.covenantId) + ':' + String.valueOf(ce.targetLoanId));
        }
        for (CovenantAttach ca : covenantAttaches) {
            if (excludedPairs.contains(String.valueOf(ca.covenantId) + ':' + String.valueOf(ca.targetLoanId))) {
                throw new ToolException(
                    'This plan both excludes ' + ca.covenantName + ' from the carry and associates it to the same ' +
                    'facility. Those are opposite instructions about one junction. Name one or the other.'
                );
            }
        }

        // What each member's own clone will take, so the plan steps and the summary can name the
        // figures per facility instead of describing one broadcast the banker did not ask for.
        Boolean broadcastScalars = req.requestedAmount != null || req.requestedMaturityDate != null ||
            req.requestedRate != null || req.requestedTermMonths != null;
        Map<Id, List<String>> scalarWordsByTarget = new Map<Id, List<String>>();
        for (ScalarChange sc : scalarChanges) {
            if (!scalarWordsByTarget.containsKey(sc.targetLoanId)) {
                scalarWordsByTarget.put(sc.targetLoanId, new List<String>());
            }
            scalarWordsByTarget.get(sc.targetLoanId).add(scalarPhrase(sc));
        }

        Integer n = facilities.size();
        Integer carryover = 0;
        Map<String, Object> resolved = new Map<String, Object>{
            'productPackageId' => packageId,
            'actionType' => 'Modification',
            'facilityCount' => n,
            'rollMemberIds' => String.join(rollIds, ','),
            'rollMemberCount' => rollIds.size(),
            'excludedMemberCount' => excludedNames.size(),
            'requestedAmount' => req.requestedAmount,
            'requestedMaturityDate' => req.requestedMaturityDate,
            'requestedRate' => req.requestedRate,
            'requestedTermMonths' => req.requestedTermMonths
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
                new C360Plan.Step('credit_action_' + s, C360Plan.TYPE_WRITE, 'Roll ' + loan.Name + ' into the new package version (its clone is the one this plan modifies)')
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
            // The label names THIS member's own figures once the scalars are targeted. A step that
            // said "the requested changes" over a mixed plan would be describing a broadcast the
            // banker never asked for, on the one step where the difference is the whole point.
            String applyLabel;
            if (scalarChanges.isEmpty()) {
                applyLabel = 'Apply the requested changes to the new facility cloned from ' + loan.Name;
            } else if (scalarWordsByTarget.containsKey(loan.Id)) {
                applyLabel = 'Set ' + String.join(scalarWordsByTarget.get(loan.Id), ' and ') +
                    ' on the new facility cloned from ' + loan.Name + ', and on that clone only';
            } else {
                applyLabel = 'No scalar change is aimed at ' + loan.Name + ': its clone keeps the commitment, rate, ' +
                    'maturity and term it carries today';
            }
            steps.add(
                new C360Plan.Step('apply_changes_' + s, C360Plan.TYPE_WRITE, applyLabel)
                    .onObject('LLC_BI__Loan__c', new List<String>{ 'LLC_BI__Amount__c', 'LLC_BI__Maturity_Date__c', 'LLC_BI__InterestRate__c', 'LLC_BI__Term_Months__c' })
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
        // copies no junction rows in this org (verified live 2026-08-30), so the execute tool
        // replicates each member's graph itself and proves the counts by re-query.
        Integer pledgeCount = [SELECT COUNT() FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c IN :rollIds WITH USER_MODE];
        Integer involvementCount = [SELECT COUNT() FROM LLC_BI__Legal_Entities__c WHERE LLC_BI__Loan__c IN :rollIds WITH USER_MODE];
        Integer covenantJunctionCount = [SELECT COUNT() FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c IN :rollIds WITH USER_MODE];
        Integer feeCount = [SELECT COUNT() FROM LLC_BI__Fee__c WHERE LLC_BI__Loan__c IN :rollIds WITH USER_MODE];
        Integer streamCount = [SELECT COUNT() FROM LLC_BI__Pricing_Stream__c WHERE LLC_BI__Loan__c IN :rollIds WITH USER_MODE];
        steps.add(
            new C360Plan.Step('carry_junctions', C360Plan.TYPE_WRITE,
                'Carry each rolled member\'s junction graph onto its clone: ' + covenantJunctionCount +
                ' covenant junction' + (covenantJunctionCount == 1 ? '' : 's') + ', ' + pledgeCount +
                ' collateral pledge' + (pledgeCount == 1 ? '' : 's') + ', ' + involvementCount +
                ' borrowing involvement' + (involvementCount == 1 ? '' : 's') + ', ' + feeCount +
                ' fee' + (feeCount == 1 ? '' : 's') + '; ' + streamCount +
                ' pricing stream' + (streamCount == 1 ? '' : 's') + ' ride nCino\'s own engine carry')
                .onObject('LLC_BI__Loan_Covenant__c', new List<String>{ 'replicas retargeted at the clones, verified by count' })
                .provenBy('SELECT COUNT() FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c IN :cloneIds')
        );

        // NET-NEW FACILITIES ON THE NEW VERSION (founder, 2026-09-03). A modification versions the
        // whole package, and the bank puts new money on the version being approved rather than on a
        // package nobody is looking at. The facilities are filed AFTER the clones exist and after
        // the carry, so they land on the new package version alongside them, and every arm below may
        // name one by its label instead of by an id it cannot have yet.
        for (Integer i = 0; i < newFacilities.size(); i++) {
            C360NewFacilities.NewFacility nf = newFacilities[i];
            C360NewFacilities.putResolved(resolved, i, nf);
            steps.addAll(C360NewFacilities.steps(i, nf, 'the new package version'));
        }
        resolved.put('newFacilityCount', newFacilities.size());

        // Net-new covenants: created on the borrower account, attached to the CLONE of the targeted
        // member on the new version. SAFE by live probe (2026-08-30): a Covenant2 insert plus its
        // junction mints no compliance row, starts no approval and sends no email; the unrecallable
        // acnpex approval fires on COMPLIANCE create only, which this plan never performs.
        Map<Id, LLC_BI__Loan__c> facilityById = new Map<Id, LLC_BI__Loan__c>(facilities);
        for (Integer i = 0; i < covenantAdds.size(); i++) {
            CovenantAdd a = covenantAdds[i];
            String s = String.valueOf(i);
            resolved.put('covenantAdd' + s + '.typeId', String.valueOf(a.typeId));
            resolved.put('covenantAdd' + s + '.typeName', a.typeName);
            resolved.put('covenantAdd' + s + '.threshold', a.threshold);
            resolved.put('covenantAdd' + s + '.operator', a.operator);
            resolved.put('covenantAdd' + s + '.frequency', a.frequency);
            resolved.put('covenantAdd' + s + '.effectiveDate', a.effectiveDate);
            resolved.put('covenantAdd' + s + '.targetLoanId', String.valueOf(a.targetLoanId));
            resolved.put('covenantAdd' + s + '.targetNewLabel', a.targetNewLabel);
            String targetName = armTargetName(a.targetLoanId, a.targetNewLabel, facilityById, newFacilities);
            steps.add(
                new C360Plan.Step('covenant_create_' + s, C360Plan.TYPE_WRITE,
                    'Create net-new covenant on the borrower: ' + a.typeName + ' ' + a.operator + ' ' +
                    String.valueOf(a.threshold) + ', tested ' + a.frequency + ', effective ' + String.valueOf(a.effectiveDate) +
                    ', born Pending and Active')
                    .onObject('LLC_BI__Covenant2__c', new List<String>{
                        'LLC_BI__Covenant_Type__c', 'LLC_BI__Financial_Indicator_Value__c', 'Financial_Indicator_Operator__c',
                        'LLC_BI__Frequency__c', 'LLC_BI__Effective_Date__c'
                    })
                    .provenBy('SELECT Id, LLC_BI__Financial_Indicator_Value__c FROM LLC_BI__Covenant2__c WHERE Id = :createdId')
            );
            steps.add(
                new C360Plan.Step('covenant_attach_' + s, C360Plan.TYPE_WRITE,
                    'Attach it to the clone of ' + targetName + ' on the new package version (never to the booked parent), and associate it to the borrower account the way nCino\'s own UI does')
                    .onObject('LLC_BI__Loan_Covenant__c', new List<String>{ 'LLC_BI__Loan__c', 'LLC_BI__Covenant2__c', 'LLC_BI__Account_Covenant__c: LLC_BI__Account__c + LLC_BI__Covenant2__c' })
                    .provenBy('SELECT Id FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :cloneId AND LLC_BI__Covenant2__c = :createdId')
            );
            steps.add(
                new C360Plan.Step('covenant_verify_' + s, C360Plan.TYPE_VERIFICATION,
                    'Re-read the covenant and its junction on the clone of ' + targetName)
                    .onObject('LLC_BI__Covenant2__c', new List<String>{ 'Id', 'LLC_BI__Financial_Indicator_Value__c' })
                    .provenBy('SELECT Id FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :cloneId AND LLC_BI__Covenant2__c = :createdId')
            );
        }
        resolved.put('covenantAddCount', covenantAdds.size());

        // ASSOCIATE AN EXISTING COVENANT. A junction-only create: no covenant is inserted and
        // nothing is deleted. This is the instrument for a covenant the borrower already holds at
        // relationship level, which carries no loan junction and is therefore NOT on the loan,
        // whatever the relationship view suggests (founder correction 2026-09-02). The account
        // association is minted only if the covenant does not already carry one, because a
        // relationship-level covenant has its own and a second row would be a duplicate.
        for (Integer i = 0; i < covenantAttaches.size(); i++) {
            CovenantAttach ca = covenantAttaches[i];
            String s8 = String.valueOf(i);
            resolved.put('covenantAttach' + s8 + '.covenantId', String.valueOf(ca.covenantId));
            resolved.put('covenantAttach' + s8 + '.covenantName', ca.covenantName);
            resolved.put('covenantAttach' + s8 + '.typeName', ca.typeName);
            resolved.put('covenantAttach' + s8 + '.threshold', ca.threshold);
            resolved.put('covenantAttach' + s8 + '.operator', ca.operator);
            resolved.put('covenantAttach' + s8 + '.targetLoanId', String.valueOf(ca.targetLoanId));
            resolved.put('covenantAttach' + s8 + '.targetNewLabel', ca.targetNewLabel);
            String attachTarget = armTargetName(ca.targetLoanId, ca.targetNewLabel, facilityById, newFacilities);
            steps.add(
                new C360Plan.Step('covenant_associate_' + s8, C360Plan.TYPE_WRITE,
                    'Associate the existing covenant ' + ca.covenantName + ' (' + ca.typeName +
                    ') to the clone of ' + attachTarget +
                    ': a junction only, no covenant is created and none is amended')
                    .onObject('LLC_BI__Loan_Covenant__c', new List<String>{ 'LLC_BI__Loan__c', 'LLC_BI__Covenant2__c' })
                    .provenBy('SELECT Id FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :cloneId AND LLC_BI__Covenant2__c = :covenantId')
            );
            steps.add(
                new C360Plan.Step('covenant_associate_verify_' + s8, C360Plan.TYPE_VERIFICATION,
                    'Re-read the junction on the clone of ' + attachTarget +
                    ' and prove the covenant record itself is unchanged')
                    .onObject('LLC_BI__Loan_Covenant__c', new List<String>{ 'Id' })
                    .provenBy('SELECT Id FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :cloneId AND LLC_BI__Covenant2__c = :covenantId')
            );
        }
        resolved.put('covenantAttachCount', covenantAttaches.size());

        // Borrowing-structure amendments. An ADD is authored on the clone; a REMOVE is a carry
        // exclusion — the roll-over diff made literal: everything not named is KEPT, and what is
        // named as removed simply never reaches the new version. Nothing is deleted anywhere.
        for (Integer i = 0; i < involvementChanges.size(); i++) {
            InvolvementChange ic = involvementChanges[i];
            String s2 = String.valueOf(i);
            resolved.put('involvement' + s2 + '.op', ic.op);
            resolved.put('involvement' + s2 + '.role', ic.role);
            resolved.put('involvement' + s2 + '.accountId', String.valueOf(ic.accountId));
            resolved.put('involvement' + s2 + '.accountName', ic.accountName);
            resolved.put('involvement' + s2 + '.ownership', ic.ownership);
            resolved.put('involvement' + s2 + '.targetLoanId', String.valueOf(ic.targetLoanId));
            resolved.put('involvement' + s2 + '.sourceRowId', ic.sourceRowId == null ? null : String.valueOf(ic.sourceRowId));
            resolved.put('involvement' + s2 + '.targetNewLabel', ic.targetNewLabel);
            String targetName2 = armTargetName(ic.targetLoanId, ic.targetNewLabel, facilityById, newFacilities);
            if (ic.op == 'add') {
                steps.add(
                    new C360Plan.Step('involvement_change_' + s2, C360Plan.TYPE_WRITE,
                        'Add ' + ic.accountName + ' as ' + ic.role + ' on the clone of ' + targetName2 +
                        (ic.ownership == null ? '' : ' at ' + String.valueOf(ic.ownership) + '% ownership'))
                        .onObject('LLC_BI__Legal_Entities__c', new List<String>{
                            'LLC_BI__Account__c', 'LLC_BI__Borrower_Type__c', 'LLC_BI__Ownership__c'
                        })
                        .provenBy('SELECT Id FROM LLC_BI__Legal_Entities__c WHERE LLC_BI__Loan__c = :cloneId AND LLC_BI__Account__c = :accountId')
                );
            } else {
                steps.add(
                    new C360Plan.Step('involvement_change_' + s2, C360Plan.TYPE_WRITE,
                        'Carry the structure of ' + targetName2 + ' WITHOUT ' + ic.accountName + ' (' + ic.role +
                        '): the booked facility keeps its row, the clone starts without it, nothing is deleted')
                        .onObject('LLC_BI__Legal_Entities__c', new List<String>{ 'carry exclusion — the replica is simply not written' })
                        .provenBy('SELECT COUNT() FROM LLC_BI__Legal_Entities__c WHERE LLC_BI__Loan__c = :cloneId AND LLC_BI__Account__c = :accountId')
                );
            }
            steps.add(
                new C360Plan.Step('involvement_verify_' + s2, C360Plan.TYPE_VERIFICATION,
                    ic.op == 'add'
                        ? 'Re-read the involvement on the clone of ' + targetName2
                        : 'Prove the clone of ' + targetName2 + ' carries no row for ' + ic.accountName + ' and the parent still does')
                    .onObject('LLC_BI__Legal_Entities__c', new List<String>{ 'Id' })
                    .provenBy('re-query on the clone and the parent')
            );
        }
        resolved.put('involvementChangeCount', involvementChanges.size());

        // COVENANT CARRY EXCLUSIONS. The founder's requirement, in the only shape nCino allows:
        // "remove the covenant from the open loan when the modification happens" is not a delete
        // and not a detach. The booked loan keeps its junction, the covenant record keeps every
        // field it has, and the NEW VERSION simply starts without that junction. The delete fence
        // is untouched because there is no delete, and the covenant-detach fence is untouched
        // because nothing on the parent's junction is written.
        for (Integer i = 0; i < covenantExclusions.size(); i++) {
            CovenantExclusion ce = covenantExclusions[i];
            String s9 = String.valueOf(i);
            resolved.put('covenantExclusion' + s9 + '.junctionId', String.valueOf(ce.junctionId));
            resolved.put('covenantExclusion' + s9 + '.covenantId', String.valueOf(ce.covenantId));
            resolved.put('covenantExclusion' + s9 + '.covenantName', ce.covenantName);
            resolved.put('covenantExclusion' + s9 + '.typeName', ce.typeName);
            resolved.put('covenantExclusion' + s9 + '.threshold', ce.threshold);
            resolved.put('covenantExclusion' + s9 + '.targetLoanId', String.valueOf(ce.targetLoanId));
            String exTarget = facilityById.get(ce.targetLoanId).Name;
            steps.add(
                new C360Plan.Step('covenant_exclusion_' + s9, C360Plan.TYPE_WRITE,
                    'Carry the covenants of ' + exTarget + ' WITHOUT ' + ce.covenantName + ' (' + ce.typeName +
                    '): the booked facility keeps its junction, the clone starts without it, and the covenant ' +
                    'record itself is not touched')
                    .onObject('LLC_BI__Loan_Covenant__c', new List<String>{ 'carry exclusion: the replica is simply not written' })
                    .provenBy('SELECT COUNT() FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :cloneId AND LLC_BI__Covenant2__c = :covenantId')
            );
            steps.add(
                new C360Plan.Step('covenant_exclusion_verify_' + s9, C360Plan.TYPE_VERIFICATION,
                    'Prove the clone of ' + exTarget + ' carries no junction for ' + ce.covenantName +
                    ' and the parent still carries its own')
                    .onObject('LLC_BI__Loan_Covenant__c', new List<String>{ 'Id' })
                    .provenBy('re-query on the clone and the parent junction row')
            );
        }
        resolved.put('covenantExclusionCount', covenantExclusions.size());

        // PLEDGE CARRY EXCLUSIONS. The same instrument on collateral, which is what line 9 of the
        // everything plan actually asked for. The asset and its ownership junction are relationship
        // records and survive whatever the bank decides about this version; only the PLEDGE, which
        // is per facility, fails to travel.
        for (Integer i = 0; i < pledgeExclusions.size(); i++) {
            PledgeExclusion pe = pledgeExclusions[i];
            String s10 = String.valueOf(i);
            resolved.put('pledgeExclusion' + s10 + '.pledgeId', String.valueOf(pe.pledgeId));
            resolved.put('pledgeExclusion' + s10 + '.collateralId', String.valueOf(pe.collateralId));
            resolved.put('pledgeExclusion' + s10 + '.assetLabel', pe.assetLabel);
            resolved.put('pledgeExclusion' + s10 + '.amountPledged', pe.amountPledged);
            resolved.put('pledgeExclusion' + s10 + '.targetLoanId', String.valueOf(pe.targetLoanId));
            String pxTarget = facilityById.get(pe.targetLoanId).Name;
            steps.add(
                new C360Plan.Step('pledge_exclusion_' + s10, C360Plan.TYPE_WRITE,
                    'Carry the collateral of ' + pxTarget + ' WITHOUT the pledge of ' + pe.assetLabel +
                    ': the booked facility keeps its pledge, the clone starts without it, and the asset ' +
                    'and its ownership junction are not touched')
                    .onObject('LLC_BI__Loan_Collateral2__c', new List<String>{ 'carry exclusion: the replica is simply not written' })
                    .provenBy('SELECT COUNT() FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c = :cloneId AND LLC_BI__Collateral__c = :collateralId')
            );
            steps.add(
                new C360Plan.Step('pledge_exclusion_verify_' + s10, C360Plan.TYPE_VERIFICATION,
                    'Prove the clone of ' + pxTarget + ' carries no pledge of ' + pe.assetLabel +
                    ' and the parent still carries its own')
                    .onObject('LLC_BI__Loan_Collateral2__c', new List<String>{ 'Id' })
                    .provenBy('re-query on the clone and the parent pledge row')
            );
        }
        resolved.put('pledgeExclusionCount', pledgeExclusions.size());

        // The field wave: any field the org's own describe says is writable, outside the deny-list,
        // applied to the clone with the same discipline as the four scalars. The banker's sentence
        // was resolved to an API name and a typed value HERE, at stage time, so the confirm gate
        // hashes exactly what will be written.
        for (Integer i = 0; i < fieldChanges.size(); i++) {
            FieldChange fc = fieldChanges[i];
            String s3 = String.valueOf(i);
            resolved.put('fieldChange' + s3 + '.field', fc.fieldName);
            resolved.put('fieldChange' + s3 + '.label', fc.fieldLabel);
            resolved.put('fieldChange' + s3 + '.type', fc.fieldType);
            resolved.put('fieldChange' + s3 + '.valueJson', fc.valueJson);
            resolved.put('fieldChange' + s3 + '.targetLoanId', String.valueOf(fc.targetLoanId));
            resolved.put('fieldChange' + s3 + '.targetNewLabel', fc.targetNewLabel);
            String targetName3 = armTargetName(fc.targetLoanId, fc.targetNewLabel, facilityById, newFacilities);
            steps.add(
                new C360Plan.Step('field_change_' + s3, C360Plan.TYPE_WRITE,
                    'Set ' + fc.fieldLabel + ' (' + fc.fieldName + ') to ' + displayValue(fc) + ' on the clone of ' + targetName3)
                    .onObject('LLC_BI__Loan__c', new List<String>{ fc.fieldName })
                    .provenBy('SELECT ' + fc.fieldName + ' FROM LLC_BI__Loan__c WHERE Id = :cloneId')
            );
        }
        resolved.put('fieldChangeCount', fieldChanges.size());

        // Net-new fees: authored on the CLONE of the targeted member, never on the booked parent.
        // A fee row is a DIRECT child of the loan with no junction, and LLC_BI__Loan__c on it is not
        // updateable, so it is bound to its loan at insert and can never be re-pointed afterwards.
        for (Integer i = 0; i < feeAdds.size(); i++) {
            FeeAdd fa = feeAdds[i];
            String s5 = String.valueOf(i);
            resolved.put('feeAdd' + s5 + '.feeType', fa.feeType);
            resolved.put('feeAdd' + s5 + '.description', fa.description);
            resolved.put('feeAdd' + s5 + '.calculationType', fa.calculationType);
            resolved.put('feeAdd' + s5 + '.basisSource', fa.basisSource);
            resolved.put('feeAdd' + s5 + '.percentage', fa.percentage);
            resolved.put('feeAdd' + s5 + '.amount', fa.amount);
            resolved.put('feeAdd' + s5 + '.recordType', fa.recordType);
            resolved.put('feeAdd' + s5 + '.status', fa.status);
            resolved.put('feeAdd' + s5 + '.paidBy', fa.paidBy);
            resolved.put('feeAdd' + s5 + '.isIncome', fa.isIncome);
            resolved.put('feeAdd' + s5 + '.targetLoanId', String.valueOf(fa.targetLoanId));
            resolved.put('feeAdd' + s5 + '.targetNewLabel', fa.targetNewLabel);
            String targetName4 = armTargetName(fa.targetLoanId, fa.targetNewLabel, facilityById, newFacilities);
            steps.add(
                new C360Plan.Step('fee_add_' + s5, C360Plan.TYPE_WRITE,
                    'Add ' + fa.description + ' to the clone of ' + targetName4 + ': ' + feePhrase(fa) +
                    ', ' + fa.recordType + ' / ' + fa.status + ', paid by ' + fa.paidBy)
                    .onObject('LLC_BI__Fee__c', new List<String>{
                        'LLC_BI__Loan__c', 'LLC_BI__Fee_Type__c', 'LLC_BI__Fee_Type_Description__c',
                        'LLC_BI__Calculation_Type__c', 'LLC_BI__Basis_Source__c', 'LLC_BI__Percentage__c',
                        'LLC_BI__Amount__c', 'LLC_BI__Record_Type__c', 'LLC_BI__Status__c', 'LLC_BI__Paid_By__c'
                    })
                    .wakes(new List<String>{
                        'nCino FeeTrigger: on a percentage fee it computes LLC_BI__Basis_Amount__c and ' +
                        'LLC_BI__Amount__c from the clone\'s own commitment, and the loan\'s fee aggregate follows'
                    })
                    .provenBy('SELECT Id, LLC_BI__Amount__c, LLC_BI__Basis_Amount__c FROM LLC_BI__Fee__c WHERE Id = :createdId')
            );
            steps.add(
                new C360Plan.Step('fee_verify_' + s5, C360Plan.TYPE_VERIFICATION,
                    'Re-read the fee on the clone of ' + targetName4 +
                    (fa.calculationType == 'Percentage'
                        ? ', with the money the org computed rather than one this plan supplied'
                        : ', with the amount this plan staged'))
                    .onObject('LLC_BI__Fee__c', new List<String>{ 'Id', 'Name', 'LLC_BI__Amount__c' })
                    .provenBy('SELECT Id, Name, LLC_BI__Amount__c FROM LLC_BI__Fee__c WHERE LLC_BI__Loan__c = :cloneId')
            );
        }
        resolved.put('feeAddCount', feeAdds.size());

        // Collateral pledges: authored on the CLONE of the targeted member, beside the pledges the
        // carry replicates from its parent. A NET-NEW asset is three connected writes and the plan
        // shows all three, because `LLC_BI__Collateral__c` has no account lookup of any kind on this
        // org: the ownership junction is the asset's ONLY link to the borrower, and skipping it
        // would leave an asset nobody owns securing a loan.
        for (Integer i = 0; i < pledgeAdds.size(); i++) {
            PledgeAdd pa = pledgeAdds[i];
            String s6 = String.valueOf(i);
            resolved.put('pledgeAdd' + s6 + '.isNew', pa.isNew);
            // NULL STAYS NULL. String.valueOf(null) is the four-character string 'null', and
            // C360Plan.asId on the other side would try to make a record id out of it.
            resolved.put('pledgeAdd' + s6 + '.collateralId', pa.collateralId == null ? null : String.valueOf(pa.collateralId));
            resolved.put('pledgeAdd' + s6 + '.description', pa.description);
            resolved.put('pledgeAdd' + s6 + '.collateralTypeId', pa.collateralTypeId == null ? null : String.valueOf(pa.collateralTypeId));
            resolved.put('pledgeAdd' + s6 + '.collateralTypeName', pa.collateralTypeName);
            resolved.put('pledgeAdd' + s6 + '.newValue', pa.newValue);
            resolved.put('pledgeAdd' + s6 + '.advanceRate', pa.advanceRate);
            resolved.put('pledgeAdd' + s6 + '.advanceRateReason', pa.advanceRateReason);
            resolved.put('pledgeAdd' + s6 + '.amountPledged', pa.amountPledged);
            resolved.put('pledgeAdd' + s6 + '.authoriseOverPledge', pa.authoriseOverPledge);
            resolved.put('pledgeAdd' + s6 + '.lienPosition', pa.lienPosition);
            resolved.put('pledgeAdd' + s6 + '.pledgedStatus', pa.pledgedStatus);
            resolved.put('pledgeAdd' + s6 + '.assetLabel', pa.assetLabel);
            resolved.put('pledgeAdd' + s6 + '.targetLoanId', String.valueOf(pa.targetLoanId));
            resolved.put('pledgeAdd' + s6 + '.targetNewLabel', pa.targetNewLabel);
            String targetName5 = armTargetName(pa.targetLoanId, pa.targetNewLabel, facilityById, newFacilities);

            if (pa.isNew) {
                steps.add(
                    new C360Plan.Step('collateral_create_' + s6, C360Plan.TYPE_WRITE,
                        'Create the asset "' + pa.description + '" as ' + pa.collateralTypeName +
                        ', valued at ' + String.valueOf(pa.newValue) +
                        '. Name on a collateral is an autonumber, so the description is its readable identity')
                        .onObject('LLC_BI__Collateral__c', new List<String>{
                            'LLC_BI__Collateral_Type__c', 'LLC_BI__Value__c', 'LLC_BI__Description__c'
                        })
                        .provenBy('SELECT Id, Name, LLC_BI__Value__c FROM LLC_BI__Collateral__c WHERE Id = :createdId')
                );
                steps.add(
                    new C360Plan.Step('collateral_own_' + s6, C360Plan.TYPE_WRITE,
                        'Record the borrower as owner of "' + pa.description +
                        '". LLC_BI__Collateral__c carries NO account lookup, so this junction is the asset\'s only link to the relationship')
                        .onObject('LLC_BI__Account_Collateral__c', new List<String>{
                            'LLC_BI__Account__c', 'LLC_BI__Collateral__c', 'LLC_BI__Ownership_Percentage__c', 'LLC_BI__Primary_Owner__c'
                        })
                        .provenBy('SELECT Id FROM LLC_BI__Account_Collateral__c WHERE LLC_BI__Collateral__c = :createdId')
                );
            }
            steps.add(
                new C360Plan.Step('pledge_add_' + s6, C360Plan.TYPE_WRITE,
                    'Pledge ' + pa.assetLabel + ' to the clone of ' + targetName5 + ': ' + pledgePhrase(pa))
                    .onObject('LLC_BI__Loan_Collateral2__c', new List<String>{
                        'LLC_BI__Loan__c', 'LLC_BI__Collateral__c', 'LLC_BI__Loan_Collateral_Aggregate__c',
                        'LLC_BI__Pledged_Status__c', 'LLC_BI__Active__c', 'LLC_BI__Amount_Pledged__c',
                        'LLC_BI__Lien_Position__c', 'LLC_BI__Advance_Rate_Override__c', 'LLC_BI__Override_Reason__c'
                    })
                    .wakes(new List<String>{
                        'nCino collateral aggregate automation: the pledge hangs off a per-clone ' +
                        'LLC_BI__Loan_Collateral_Aggregate__c shell, which is created first because the ' +
                        'lookup is not updateable afterwards, and the loan\'s own collateral rollups follow'
                    })
                    .provenBy('SELECT Id, LLC_BI__Advance_Rate__c, LLC_BI__Current_Lendable_Value__c FROM LLC_BI__Loan_Collateral2__c WHERE Id = :createdId')
            );
            steps.add(
                new C360Plan.Step('pledge_verify_' + s6, C360Plan.TYPE_VERIFICATION,
                    'Re-read the pledge on the clone of ' + targetName5 +
                    ', with the advance rate the org resolved and the lendable value it derived from it')
                    .onObject('LLC_BI__Loan_Collateral2__c', new List<String>{
                        'Id', 'LLC_BI__Collateral__c', 'LLC_BI__Advance_Rate__c', 'LLC_BI__Current_Lendable_Value__c'
                    })
                    .provenBy('SELECT Id, LLC_BI__Collateral__c, LLC_BI__Advance_Rate__c FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c = :cloneId')
            );
        }
        resolved.put('pledgeAddCount', pledgeAdds.size());

        // Policy exceptions: authored on the CLONE of the targeted member and anchored on the
        // borrower, so the bank reads the exception both on the facility it applies to and at
        // relationship level, which is where a credit officer looks for them. The three mitigation
        // reasons ride flat keys rather than a list: everything else in `resolved` is a scalar, the
        // plan hash covers String.valueOf of each value, and the org's own storage IS three fields.
        for (Integer i = 0; i < policyExceptionAdds.size(); i++) {
            PolicyExceptionAdd px = policyExceptionAdds[i];
            String s7 = String.valueOf(i);
            resolved.put('policyException' + s7 + '.title', px.title);
            resolved.put('policyException' + s7 + '.type', px.exceptionType);
            resolved.put('policyException' + s7 + '.status', px.status);
            resolved.put('policyException' + s7 + '.code', px.code);
            resolved.put('policyException' + s7 + '.severity', px.severity);
            resolved.put('policyException' + s7 + '.severityValue', px.severityValue);
            resolved.put('policyException' + s7 + '.reason1', px.reasons.size() > 0 ? px.reasons[0] : null);
            resolved.put('policyException' + s7 + '.reason2', px.reasons.size() > 1 ? px.reasons[1] : null);
            resolved.put('policyException' + s7 + '.reason3', px.reasons.size() > 2 ? px.reasons[2] : null);
            resolved.put('policyException' + s7 + '.targetLoanId', String.valueOf(px.targetLoanId));
            String targetName6 = facilityById.get(px.targetLoanId).Name;
            steps.add(
                new C360Plan.Step('policy_exception_add_' + s7, C360Plan.TYPE_WRITE,
                    'Log the policy exception "' + px.title + '" against the clone of ' + targetName6 +
                    ' and the borrower: ' + exceptionPhrase(px))
                    .onObject('LLC_BI__Policy_Exception__c', new List<String>{
                        'Name', 'LLC_BI__Type__c', 'LLC_BI__Status__c', 'LLC_BI__Loan__c',
                        'LLC_BI__Relationship__c', 'LLC_BI__Code__c', 'LLC_BI__Severity__c',
                        'LLC_BI__Severity_Value__c', 'LLC_BI__Mitigation_Reason_1__c',
                        'LLC_BI__Mitigation_Reason_2__c', 'LLC_BI__Mitigation_Reason_3__c'
                    })
                    .wakes(new List<String>{
                        'PolicyExceptionTrigger (nCino managed); and the ORG-LOCAL PolicyExceptionCDC ' +
                        'trigger, which enqueues an EventBridgeCallout POSTing the serialised record to ' +
                        'an external AWS endpoint. No approval process targets this object and no email ' +
                        'fires (both probed 2026-08-31), but the record\'s data leaves the org'
                    })
                    .provenBy('SELECT Id, Name, LLC_BI__Status__c FROM LLC_BI__Policy_Exception__c WHERE Id = :createdId')
            );
            steps.add(
                new C360Plan.Step('policy_exception_verify_' + s7, C360Plan.TYPE_VERIFICATION,
                    'Re-read the exception on the clone of ' + targetName6 +
                    ', with the name, the status and the mitigants the org holds')
                    .onObject('LLC_BI__Policy_Exception__c', new List<String>{
                        'Id', 'Name', 'LLC_BI__Status__c', 'LLC_BI__Loan__c', 'LLC_BI__Relationship__c'
                    })
                    .provenBy('SELECT Id, Name, LLC_BI__Status__c FROM LLC_BI__Policy_Exception__c WHERE LLC_BI__Loan__c = :cloneId')
            );
        }
        resolved.put('policyExceptionAddCount', policyExceptionAdds.size());

        // The per-target scalars ride the resolved values, which is what the plan hash covers: the
        // banker confirms the figure AND the clone it lands on, and execute reads back exactly that.
        for (Integer i = 0; i < scalarChanges.size(); i++) {
            ScalarChange sc = scalarChanges[i];
            String s4 = String.valueOf(i);
            resolved.put('scalarChange' + s4 + '.key', sc.key);
            resolved.put('scalarChange' + s4 + '.value', sc.key == 'requestedMaturityDate' ? (Object) sc.dateValue : (Object) sc.numberValue);
            resolved.put('scalarChange' + s4 + '.targetLoanId', String.valueOf(sc.targetLoanId));
        }
        resolved.put('scalarChangeCount', scalarChanges.size());

        steps.add(
            new C360Plan.Step('observe_side_effects', C360Plan.TYPE_OBSERVED, 'Stage-driven email alerts and memo status changes the org may run')
                .wakes(new List<String>{ 'nCino Commercial - Loan After Save' })
        );
        // The step id is unchanged on purpose: the confirm gate, the tracker and the persisted plans
        // from the held wave all address this step by id. What it hands off is now the BOOKING of the
        // modification, not the modification itself.
        steps.add(
            new C360Plan.Step('held_execution', C360Plan.TYPE_HANDOFF, 'HANDOFF: booking the modification is nCino\'s own approval run')
                .wakes(new List<String>{ 'nCino Submit for Approval, driven by a human' })
        );

        List<String> warnings = new List<String>{
            'Execution is available. ' + (n == 1 ? 'This facility is' : 'These facilities are') +
                ' booked and open, which is what a credit action requires, so execute_loan_modification will run this plan behind the decision token.' +
                C360Facilities.lookupKeyWarning(facilities),
            'nCino package methodology: a modification versions the whole package, never a loan alone. Executing this plan creates a ' +
                'NEW package version holding clones of all ' + String.valueOf(rollIds.size()) + ' eligible members (' +
                String.join(rollNames, ', ') + '); the current package and every original loan stay exactly as they are.',
            'nCino\'s engine copies NO junction rows in this org (verified live 2026-08-30: every related-lists copy default ' +
                'flipped on, engine run, zero rows landed). The execute tool therefore carries each member\'s covenant junctions, ' +
                'collateral pledges and borrowing involvements onto its clone itself, and proves the counts by re-query.',
            'This plans a modification, NOT an approval. Executing it produces a clone facility at Qualification; BOOKING that clone requires nCino\'s Submit for Approval button, which Loan_Validation_06 enforces with no permission bypass.',
            'The junction object has no validation rules, no triggers and no flows, so a malformed row would fail silently. Execution therefore verifies the clone and its chain row by re-query and claims nothing the org will not read back.',
            'The platform is known to produce duplicate modification loans on failed background Apex, so idempotency is enforced by this tool rather than assumed.',
            carryover == 0
                ? 'No loan-level covenants are attached to ' + (n == 1 ? 'this facility' : 'these facilities') + ', so nothing would carry over.'
                : String.valueOf(carryover) + ' loan-level covenant junction rows carry onto the new ' + (n == 1 ? 'facility' : 'facilities') +
                  '. The carry replicates the junction, not the covenant, and nCino\'s own guidance says a business process must decide what happens to each one.'
        };
        warnings.addAll(covenantWarnings);
        if (!involvementChanges.isEmpty()) {
            warnings.add(
                'Borrowing-structure removes are CARRY EXCLUSIONS, never deletes: the booked facility keeps its involvement ' +
                'rows untouched, and the named row simply does not travel to the new version. The structure binds when the ' +
                'bank\'s own approval books that version.'
            );
        }
        if (!covenantExclusions.isEmpty() || !pledgeExclusions.isEmpty()) {
            List<String> what = new List<String>();
            if (!covenantExclusions.isEmpty()) {
                what.add(String.valueOf(covenantExclusions.size()) + ' covenant junction' +
                    (covenantExclusions.size() == 1 ? '' : 's'));
            }
            if (!pledgeExclusions.isEmpty()) {
                what.add(String.valueOf(pledgeExclusions.size()) + ' collateral pledge' +
                    (pledgeExclusions.size() == 1 ? '' : 's'));
            }
            warnings.add(
                'REMOVED MEANS NOT CARRIED, not deleted. ' + String.join(what, ' and ') +
                ' will not travel onto the new version. The booked facility keeps every junction and every pledge ' +
                'it holds today, the covenant records and the collateral assets are untouched, and nothing anywhere ' +
                'is deleted. This is why the removal is possible at all: covenant DETACH is fenced (every junction ' +
                'field is non-updateable, so a detach would be a delete) and deletes are fenced on every object. ' +
                'The removal binds when the bank\'s own approval books the new version.'
            );
        }
        if (!covenantAttaches.isEmpty()) {
            warnings.add(
                String.valueOf(covenantAttaches.size()) + ' EXISTING covenant' +
                (covenantAttaches.size() == 1 ? ' is' : 's are') + ' associated to the ' +
                (covenantAttaches.size() == 1 ? 'clone' : 'clones') + ' by a junction only. No covenant is created ' +
                'and none is amended: the threshold, the frequency and the schedule stay exactly as the borrower ' +
                'holds them. A covenant that sits at relationship level carries NO loan junction, so it is not ' +
                'associated to the facility however it reads at relationship level, and this is the write that ' +
                'associates it.'
            );
        }
        if (!covenantAdds.isEmpty()) {
            warnings.add(
                'Net-new covenants are created Pending and Active on the borrower account and attached to the CLONE only. ' +
                'No compliance row is minted and no approval starts (probed live 2026-08-30): the org\'s own covenant review ' +
                'cycle owns the schedule from here, and booking the new version is what makes the covenant bind.'
            );
        }
        if (!feeAdds.isEmpty()) {
            Integer pctFees = percentageFees(feeAdds);
            warnings.add(
                String.valueOf(feeAdds.size()) + ' net-new ' + (feeAdds.size() == 1 ? 'fee is' : 'fees are') +
                ' authored on the CLONE only; the booked facility keeps exactly the fees it charges today. ' +
                'A fee row is bound to its loan at insert (LLC_BI__Loan__c is not updateable on it), so this is a ' +
                'creation on the new version rather than a move.' +
                (pctFees == 0 ? '' :
                    ' On the ' + String.valueOf(pctFees) + ' percentage ' + (pctFees == 1 ? 'fee' : 'fees') +
                    ' this plan sends NO money figure: nCino\'s own FeeTrigger computes the basis and the amount from ' +
                    'the clone\'s commitment, which is the commitment this plan may itself be moving. The execution ' +
                    'reports what the org worked out.')
            );
        }
        warnings.addAll(C360NewFacilities.warnings(newFacilities, 'the new package version'));
        if (!pledgeAdds.isEmpty()) {
            Integer noLien = 0;
            Integer authorised = 0;
            for (PledgeAdd pa : pledgeAdds) {
                if (String.isBlank(pa.lienPosition)) {
                    noLien++;
                }
                if (pa.authoriseOverPledge == true) {
                    authorised++;
                }
            }
            warnings.add(
                String.valueOf(pledgeAdds.size()) + ' collateral ' + (pledgeAdds.size() == 1 ? 'pledge is' : 'pledges are') +
                ' authored on the CLONE only; the booked facility keeps exactly the security it holds today, and no ' +
                'existing pledge anywhere is touched.' +
                (createdAssets == 0 ? '' :
                    ' ' + String.valueOf(createdAssets) + ' of them ' + (createdAssets == 1 ? 'creates a NEW asset' : 'create NEW assets') +
                    ', which is three connected writes each: the asset, then the LLC_BI__Account_Collateral__c ownership ' +
                    'junction (LLC_BI__Collateral__c has no account lookup of its own, so this is the borrower link), then ' +
                    'the pledge. The asset itself is a permanent record on the relationship and survives whatever the ' +
                    'bank decides about this version.') +
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
        if (!policyExceptionAdds.isEmpty()) {
            // THE EGRESS IS ITS OWN WARNING, and it leads. Everything else this plan does stays
            // inside the org; this is the one write whose data goes somewhere the bank's own
            // Salesforce audit trail cannot follow it.
            warnings.add(
                'DATA LEAVES THE ORG. Every committed write to LLC_BI__Policy_Exception__c fires the org-local ' +
                'PolicyExceptionCDC trigger, which enqueues an EventBridgeCallout POSTing the serialised record to ' +
                'an external AWS endpoint. That is not an approval and not an email - of the 16 approval processes ' +
                'in this org none targets this object, and a rollback probe on 2026-08-31 moved the email counter by ' +
                'zero - but the ' + String.valueOf(policyExceptionAdds.size()) + ' exception' +
                (policyExceptionAdds.size() == 1 ? '' : 's') + ' below will be transmitted. All of them are inserted ' +
                'in ONE DML, which is one callout for the plan rather than one per exception.'
            );
            warnings.add(
                String.valueOf(policyExceptionAdds.size()) + ' policy exception' +
                (policyExceptionAdds.size() == 1 ? ' is' : 's are') + ' authored on the CLONE only and anchored on the ' +
                'borrower, so the bank reads ' + (policyExceptionAdds.size() == 1 ? 'it' : 'them') + ' both on the ' +
                'facility and at relationship level. The booked facility carries no new exception, and the exceptions ' +
                'it already holds do NOT travel: an exception records what the bank decided about the facility as it ' +
                'stands, and copying one onto a version nobody has approved would restate a decision about terms that ' +
                'do not exist yet.'
            );
        }
        if (n > 1) {
            warnings.add(
                'This is one plan over ' + n + ' facilities on the same package, under a single confirmation and a single decision token. ' +
                'Each facility carries its own credit action, verification and apply step, so a failure on one is reported against that facility ' +
                'and does not silently discard the others.'
            );
        }
        if (broadcastScalars && n > 1) {
            warnings.add(
                'The amount, maturity date, rate and term on this request BROADCAST: each one applies to every selected ' +
                'facility. Send them in scalarChangesJson instead if the members need different figures.'
            );
        } else if (!scalarChanges.isEmpty()) {
            warnings.add(
                'Each scalar names the facility it lands on, and reaches no other clone. ' +
                String.join(perMemberScalars(facilities, scalarWordsByTarget), '; ') + '.'
            );
        }

        Map<String, Object> provenance = new Map<String, Object>{
            'facilityIds' => new Map<String, String>{ 'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => String.join(selected, ', ') },
            'productPackageId' => new Map<String, String>{ 'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => String.valueOf(packageId) }
        };

        String bookingHandoff =
            'Executing this plan creates the modification at Qualification and stops there. Booking it is nCino\'s own run: ' +
            'Submit for Approval with real approvers, which Loan_Validation_06 enforces with no permission bypass.';

        String summary =
            'Plans the next VERSION of the package, nCino package methodology: one credit action rolls all ' +
            String.valueOf(rollIds.size()) + ' eligible members into a new package with their junction graphs. ' +
            (n == 1
                ? facilityNames[0] + ' is the member being modified'
                : String.valueOf(n) + ' members are being modified: ' + String.join(facilityNames, ', ')) +
            '; the rest carry unchanged' +
            (excludedNames.isEmpty() ? '. ' : ', and ' + String.join(excludedNames, ', ') + ' stays on the current version because it is not Booked/Open. ') +
            'The requested changes are applied to the ' + (n == 1 ? 'clone' : 'clones') + ' only; every original loan and the current package stay untouched. ' +
            (scalarChanges.isEmpty() ? '' : String.valueOf(scalarChanges.size()) + ' scalar ' +
                (scalarChanges.size() == 1 ? 'change is' : 'changes are') + ' aimed at a NAMED member each, so a clone takes ' +
                'only what was staged on it and the warnings say which figure lands where. ') +
            (newFacilities.isEmpty() ? '' : String.valueOf(newFacilities.size()) + ' NET-NEW ' +
                (newFacilities.size() == 1 ? 'facility is' : 'facilities are') + ' filed on the new version beside the clones: ' +
                C360NewFacilities.labelList(newFacilities) + '. Each is a new loan rather than a version of an existing one, ' +
                'so it carries the borrower on its own structure and no chain row at all. ') +
            (covenantAdds.isEmpty() ? '' : String.valueOf(covenantAdds.size()) + ' net-new covenant' +
                (covenantAdds.size() == 1 ? ' is' : 's are') + ' created on the borrower and attached to the ' +
                (covenantAdds.size() == 1 ? 'clone' : 'clones') + ', born Pending and Active. ') +
            (involvementChanges.isEmpty() ? '' : String.valueOf(involvementChanges.size()) + ' borrowing-structure ' +
                (involvementChanges.size() == 1 ? 'change lands' : 'changes land') + ' on the new version: adds are authored on the ' +
                'clone, removes are carry exclusions — the booked facilities keep every row they have today. ') +
            (covenantAttaches.isEmpty() ? '' : String.valueOf(covenantAttaches.size()) + ' existing covenant' +
                (covenantAttaches.size() == 1 ? ' is' : 's are') + ' associated to the ' +
                (covenantAttaches.size() == 1 ? 'clone' : 'clones') + ' by a junction only, with no covenant created ' +
                'and none amended. ') +
            (covenantExclusions.isEmpty() && pledgeExclusions.isEmpty() ? '' :
                String.valueOf(covenantExclusions.size() + pledgeExclusions.size()) + ' carry exclusion' +
                (covenantExclusions.size() + pledgeExclusions.size() == 1 ? ' means' : 's mean') + ' the new version ' +
                'starts without ' +
                (covenantExclusions.isEmpty() ? '' : String.valueOf(covenantExclusions.size()) + ' covenant junction' +
                    (covenantExclusions.size() == 1 ? '' : 's')) +
                (covenantExclusions.isEmpty() || pledgeExclusions.isEmpty() ? '' : ' and ') +
                (pledgeExclusions.isEmpty() ? '' : String.valueOf(pledgeExclusions.size()) + ' pledge' +
                    (pledgeExclusions.size() == 1 ? '' : 's')) +
                ' the booked facilities keep. Nothing is deleted and no covenant is detached. ') +
            (fieldChanges.isEmpty() ? '' : String.valueOf(fieldChanges.size()) + ' field ' +
                (fieldChanges.size() == 1 ? 'change is' : 'changes are') + ' applied to the clone, each resolved against the ' +
                'org\'s own describe and named with its value in the plan. ') +
            (feeAdds.isEmpty() ? '' : String.valueOf(feeAdds.size()) + ' net-new fee' +
                (feeAdds.size() == 1 ? ' is' : 's are') + ' created on the ' + (feeAdds.size() == 1 ? 'clone' : 'clones') +
                ', each resolved against the org\'s own fee picklists; a percentage fee carries its basis and its rate and ' +
                'lets the org compute the money. ') +
            (pledgeAdds.isEmpty() ? '' : String.valueOf(pledgeAdds.size()) + ' collateral pledge' +
                (pledgeAdds.size() == 1 ? ' is' : 's are') + ' authored on the ' + (pledgeAdds.size() == 1 ? 'clone' : 'clones') +
                (createdAssets == 0 ? ', each on an asset the borrower already owns. '
                    : ', creating ' + String.valueOf(createdAssets) + ' new asset' + (createdAssets == 1 ? '' : 's') +
                      ' and the ownership junction that ties ' + (createdAssets == 1 ? 'it' : 'them') + ' to the borrower. ')) +
            (policyExceptionAdds.isEmpty() ? '' : String.valueOf(policyExceptionAdds.size()) + ' policy exception' +
                (policyExceptionAdds.size() == 1 ? ' is' : 's are') + ' logged against the ' +
                (policyExceptionAdds.size() == 1 ? 'clone' : 'clones') + ' and the borrower, each with the status the ' +
                'banker decided rather than the org\'s Unmitigated default; a committed exception is transmitted to the ' +
                'bank\'s own external change-stream endpoint. ') +
            'NOTHING IS WRITTEN BY THIS CALL: staging computes and holds the plan, and execute_loan_modification runs it behind the decision token. ' +
            bookingHandoff;

        String planJson = C360Plan.serializePlan(summary, steps, warnings, provenance, resolved);
        String planHash = C360Plan.hash('loan-modification', steps, resolved);

        C360ActionStaging.Staged staged = C360ActionStaging.stagePlan(
            'loan-modification', req.idempotencyKey, facilities[0].LLC_BI__Account__c, packageId, planJson, planHash
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
        r.executionHeld = false;
        r.heldReason = null;
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
     * Parses and RESOLVES the net-new covenant adds. Everything a banker could get wrong is
     * settled here, at stage time, against the org's own catalog: the type must exist (by id, or
     * by exact name — an ambiguous name is refused with the candidate ids, because this org
     * carries duplicate type names), the operator must be one the org's picklists express, and
     * the target must be one of the selected facilities. An equivalent covenant already attached
     * to the target is NAMED as a warning before the banker confirms. Nothing is created here.
     */
    public static List<CovenantAdd> parseCovenantAdds(
        Request req,
        List<LLC_BI__Loan__c> facilities,
        List<C360NewFacilities.NewFacility> newFacilities,
        List<String> warnings
    ) {
        List<CovenantAdd> out = new List<CovenantAdd>();
        if (String.isBlank(req.covenantAddsJson)) {
            return out;
        }
        List<Object> raw;
        try {
            raw = (List<Object>) JSON.deserializeUntyped(req.covenantAddsJson);
        } catch (Exception e) {
            throw new ToolException('covenantAddsJson could not be read as a JSON list: ' + e.getMessage());
        }
        Set<String> validOps = new Set<String>{ '<', '<=', '=', '>=', '>' };
        Map<Id, LLC_BI__Loan__c> byId = new Map<Id, LLC_BI__Loan__c>(facilities);
        for (Object o : raw) {
            Map<String, Object> m = (Map<String, Object>) o;
            CovenantAdd a = new CovenantAdd();
            a.typeId = C360Plan.asId(m.get('typeId'));
            a.typeName = m.get('typeName') == null ? null : String.valueOf(m.get('typeName')).trim();
            a.threshold = C360Plan.asDecimal(m.get('threshold'));
            a.operator = m.get('operator') == null ? null : String.valueOf(m.get('operator')).trim();
            a.frequency = m.get('frequency') == null ? 'Quarterly' : String.valueOf(m.get('frequency')).trim();
            a.effectiveDate = m.get('effectiveDate') == null ? Date.today() : Date.valueOf(String.valueOf(m.get('effectiveDate')));
            a.targetNewLabel = armLabel(m.get('targetLoanId'), newFacilities, 'covenant add');
            a.targetLoanId = a.targetNewLabel == null ? C360Plan.asId(m.get('targetLoanId')) : null;
            if (a.threshold == null) {
                throw new ToolException('A covenant add needs a threshold. The threshold IS the covenant; without one there is nothing for a review cycle to test.');
            }
            if (a.operator == null || !validOps.contains(a.operator)) {
                throw new ToolException('A covenant add needs an operator, one of < <= = >= >. Supplied: ' + a.operator + '.');
            }
            if (a.targetNewLabel == null && a.targetLoanId == null) {
                if (facilities.size() != 1) {
                    throw new ToolException('targetLoanId is required on each covenant add when more than one facility is selected.');
                }
                a.targetLoanId = facilities[0].Id;
            }
            if (a.targetNewLabel == null && !byId.containsKey(a.targetLoanId)) {
                throw new ToolException(
                    'A covenant add targets facility ' + a.targetLoanId + ', which is not one of the selected facilities. ' +
                    'The covenant attaches to the CLONE of a facility this plan modifies.'
                );
            }
            resolveCovenantType(a);
            out.add(a);
        }
        // The connectedness check, on the PARENTS: the clones do not exist yet, and what the banker
        // needs to hear is what the facility carries today.
        Set<Id> targetIds = new Set<Id>();
        for (CovenantAdd a : out) {
            // A net-new facility carries no junction yet, so it has nothing for the connectedness
            // check to find and nothing the carry could duplicate.
            if (a.targetLoanId != null) {
                targetIds.add(a.targetLoanId);
            }
        }
        for (LLC_BI__Loan_Covenant__c j : [
            SELECT LLC_BI__Loan__c, LLC_BI__Covenant2__r.LLC_BI__Covenant_Type__c,
                   LLC_BI__Covenant2__r.LLC_BI__Covenant_Type__r.Name,
                   LLC_BI__Covenant2__r.LLC_BI__Financial_Indicator_Value__c
            FROM LLC_BI__Loan_Covenant__c
            WHERE LLC_BI__Loan__c IN :targetIds
            WITH USER_MODE
        ]) {
            for (CovenantAdd a : out) {
                if (a.targetLoanId == j.LLC_BI__Loan__c && a.typeId == j.LLC_BI__Covenant2__r.LLC_BI__Covenant_Type__c) {
                    warnings.add(
                        byId.get(a.targetLoanId).Name + ' ALREADY carries a ' + a.typeName + ' covenant at ' +
                        String.valueOf(j.LLC_BI__Covenant2__r.LLC_BI__Financial_Indicator_Value__c) +
                        ', and the carry will bring it onto the clone. This plan files a SECOND one at ' + a.operator + ' ' +
                        String.valueOf(a.threshold) + ' only because the banker confirms it knowingly; amending the existing covenant may be the better instrument.'
                    );
                }
            }
        }
        return out;
    }

    /** The two calculation shapes a fee can have, and the whole difference between them. */
    private static final String FEE_PERCENTAGE = 'Percentage';
    private static final String FEE_FLAT = 'Flat Amount';
    /** 255 on the org (recon Task 1, finding 5), and the only place a fee's human label can go. */
    private static final Integer FEE_DESCRIPTION_MAX = 255;

    /**
     * Parses and RESOLVES the net-new fees against the org's OWN fee model, which is unusual
     * enough that every one of these checks is a live finding rather than a convention
     * (`knowledge/sf-build-v2/recon-20260831.md` Task 1):
     *
     *   - `LLC_BI__Fee_Type__c` is a residential/TRID picklist. A C&I fee has no value in it, so
     *     the caller sends "Other" plus a description; whatever it sends is validated against the
     *     org's ACTIVE values and a refusal carries the legal list.
     *   - `Name` is an autonumber, so the description IS the label and is required. A fee whose
     *     only readable identity is FEE-000007 is a row nobody can find.
     *   - A PERCENTAGE fee trips the validation rule `Percentage_Fee_Required_Fields` without a
     *     basis source and a percentage, and the org's FeeTrigger then DERIVES Basis_Amount and
     *     Amount from the loan. So a percentage fee must carry both and must NOT carry an amount:
     *     a supplied one is refused rather than silently overwritten, because a caller that sent it
     *     believes a number that is about to be replaced.
     *   - `RecordTypeId` is never accepted from us at all, so it is not a parameter: the record
     *     type rides the independent `LLC_BI__Record_Type__c` picklist.
     *
     * Nothing is created here. The arm hop of the execute pair writes the rows.
     */
    public static List<FeeAdd> parseFeeAdds(
        Request req,
        List<LLC_BI__Loan__c> facilities,
        List<C360NewFacilities.NewFacility> newFacilities
    ) {
        List<FeeAdd> out = new List<FeeAdd>();
        if (String.isBlank(req.feeAddsJson)) {
            return out;
        }
        List<Object> raw;
        try {
            raw = (List<Object>) JSON.deserializeUntyped(req.feeAddsJson);
        } catch (Exception e) {
            throw new ToolException('feeAddsJson could not be read as a JSON list: ' + e.getMessage());
        }
        Map<Id, LLC_BI__Loan__c> byId = new Map<Id, LLC_BI__Loan__c>(facilities);
        for (Object o : raw) {
            Map<String, Object> m = (Map<String, Object>) o;
            FeeAdd fa = new FeeAdd();

            fa.description = m.get('description') == null ? null : String.valueOf(m.get('description')).trim();
            if (String.isBlank(fa.description)) {
                throw new ToolException(
                    'Each fee add needs a description. Name on a fee is an autonumber, so the description is the only ' +
                    'label the row carries and a fee without one cannot be found by anybody looking for it.'
                );
            }
            if (fa.description.length() > FEE_DESCRIPTION_MAX) {
                throw new ToolException(
                    'A fee description is at most ' + FEE_DESCRIPTION_MAX + ' characters on this org; this one is ' +
                    fa.description.length() + '.'
                );
            }

            fa.feeType = feePicklist('LLC_BI__Fee_Type__c', m.get('feeType'), 'fee type');
            fa.calculationType = feePicklist('LLC_BI__Calculation_Type__c', m.get('calculationType'), 'fee calculation type');
            if (fa.calculationType != FEE_PERCENTAGE && fa.calculationType != FEE_FLAT) {
                throw new ToolException(
                    'A fee add is calculated as "' + FEE_PERCENTAGE + '" or "' + FEE_FLAT + '". Supplied: ' +
                    fa.calculationType + '.'
                );
            }
            fa.percentage = C360Plan.asDecimal(m.get('percentage'));
            fa.amount = C360Plan.asDecimal(m.get('amount'));

            if (fa.calculationType == FEE_PERCENTAGE) {
                if (fa.percentage == null || fa.percentage <= 0) {
                    throw new ToolException(
                        'A percentage fee needs a percentage greater than zero: the org\'s Percentage_Fee_Required_Fields ' +
                        'rule refuses the row without one, and the rate IS the fee.'
                    );
                }
                if (fa.amount != null) {
                    throw new ToolException(
                        'A percentage fee carries no amount. nCino\'s FeeTrigger computes LLC_BI__Basis_Amount__c and ' +
                        'LLC_BI__Amount__c from the loan\'s own commitment, so an amount sent here would be replaced by ' +
                        'the org and is refused rather than accepted and lost.'
                    );
                }
                fa.basisSource = feePicklist(
                    'LLC_BI__Basis_Source__c',
                    m.get('basisSource') == null ? 'LLC_BI__Amount__c' : m.get('basisSource'),
                    'fee basis source'
                );
            } else {
                if (fa.amount == null || fa.amount <= 0) {
                    throw new ToolException('A flat fee needs an amount greater than zero.');
                }
                if (fa.percentage != null) {
                    throw new ToolException(
                        'A flat fee carries no percentage. Send it as a Percentage fee if the rate is what was agreed.'
                    );
                }
            }

            // Reasonable defaults, every one of them the shape the org's own fee rows carry.
            fa.recordType = feePicklist(
                'LLC_BI__Record_Type__c', m.get('recordType') == null ? 'Fees' : m.get('recordType'), 'fee record type'
            );
            fa.paidBy = feePicklist(
                'LLC_BI__Paid_By__c',
                m.get('paidBy') == null ? 'Financed from Proceeds' : m.get('paidBy'),
                'fee paid-by'
            );
            // Active is the guard's only legal birth state: an inactive fee is a fee nobody charges,
            // which is not what adding one means.
            fa.status = 'Active';
            // Income is what the record type already says: a "Fees" row is the bank's revenue, a
            // "Costs" row is a third-party charge passing through.
            fa.isIncome = fa.recordType == 'Fees';

            fa.targetNewLabel = armLabel(m.get('targetLoanId'), newFacilities, 'fee add');
            fa.targetLoanId = fa.targetNewLabel == null ? C360Plan.asId(m.get('targetLoanId')) : null;
            if (fa.targetNewLabel == null && fa.targetLoanId == null) {
                if (facilities.size() != 1) {
                    throw new ToolException('targetLoanId is required on each fee add when more than one facility is selected.');
                }
                fa.targetLoanId = facilities[0].Id;
            }
            if (fa.targetNewLabel == null && !byId.containsKey(fa.targetLoanId)) {
                throw new ToolException(
                    'A fee add targets facility ' + fa.targetLoanId + ', which is not one of the selected facilities. ' +
                    'A fee is created on the CLONE of a facility this plan modifies.'
                );
            }
            out.add(fa);
        }
        return out;
    }

    /**
     * Resolves one value against a LIVE picklist on LLC_BI__Fee__c, by value or by label, and
     * refuses with the org's own legal list. The describe is the authority: this org's fee
     * picklists are configured, not standard, and a near-miss written blind is a row the bank
     * cannot report on.
     */
    private static String feePicklist(String fieldName, Object supplied, String what) {
        if (supplied == null || String.isBlank(String.valueOf(supplied))) {
            throw new ToolException('Each fee add names its ' + what + '.');
        }
        return orgPicklist(
            Schema.SObjectType.LLC_BI__Fee__c.fields.getMap().get(fieldName.toLowerCase()).getDescribe(), supplied, what
        );
    }

    /**
     * Resolves one value against a LIVE picklist on any object this tool writes, by value or by
     * label, and refuses with the org's own legal list.
     *
     * ONE BODY, THREE ARMS. Fees, pledges and policy exceptions each resolve caller words against a
     * picklist and each refuses with the org's candidates; three copies of these fifteen lines is
     * three places for the refusal wording, the isActive() filter and the label fallback to drift
     * apart. The describe is the authority in all three: this org's picklists are configured rather
     * than standard, and a near-miss written blind is a row the bank cannot report on.
     */
    private static String orgPicklist(Schema.DescribeFieldResult dfr, Object supplied, String what) {
        String sv = String.valueOf(supplied).trim();
        List<String> legal = new List<String>();
        for (Schema.PicklistEntry pe : dfr.getPicklistValues()) {
            if (!pe.isActive()) {
                continue;
            }
            legal.add(pe.getValue());
            if (pe.getValue().equalsIgnoreCase(sv) || pe.getLabel().equalsIgnoreCase(sv)) {
                return pe.getValue();
            }
        }
        throw new ToolException(
            '"' + sv + '" is not a legal ' + what + ' on this org. The org offers: ' + String.join(legal, ', ') + '.'
        );
    }

    /** One fee as the banker should read it in a plan step. */
    public static String feePhrase(FeeAdd fa) {
        return fa.calculationType == FEE_PERCENTAGE
            ? String.valueOf(fa.percentage) + '% of ' + fa.basisSource + ', with the money computed by the org'
            : String.valueOf(fa.amount) + ' flat';
    }

    /** How many of the staged fees let the org do the arithmetic. */
    public static Integer percentageFees(List<FeeAdd> feeAdds) {
        Integer n = 0;
        for (FeeAdd fa : feeAdds) {
            if (fa.calculationType == FEE_PERCENTAGE) {
                n++;
            }
        }
        return n;
    }

    /* ------------------------------------------------------------------------------- pledges */

    /**
     * A PLEDGE WAKES nCino's collateral aggregate automation AND this org's own CDC triggers, and a
     * CREATE wakes them three times over - asset, ownership junction, pledge - because each of those
     * objects carries an org-local change-stream trigger that enqueues an EventBridge callout
     * (the shared-sandbox shield in C360TestFixture names all 24 of them). The platform allows 50
     * queueables in one synchronous transaction and the arm hop already spends some of that budget
     * on the carry, so the cap is deliberate and low. stage_collateral_valuation caps its own items
     * at 20 for exactly this reason; a pledge costs up to three where a valuation costs one.
     */
    private static final Integer PLEDGE_MAX = 5;
    /** 255 on `LLC_BI__Collateral__c.LLC_BI__Description__c` (LESSONS 15ad). */
    private static final Integer COLLATERAL_DESCRIPTION_MAX = 255;

    /**
     * Parses and RESOLVES the pledges against the org's OWN collateral model. Every refusal below is
     * a live finding rather than a convention:
     *
     *   - `LLC_BI__Collateral__c` has NO account lookup of any kind, so "does the borrower own this
     *     asset?" is answerable ONLY through `LLC_BI__Account_Collateral__c`. An existing collateral
     *     with no ownership row for this borrower is refused: pledging a stranger's asset is the one
     *     mistake in this arm that a bank cannot unwind by deleting a record.
     *   - A collateral already pledged to the target facility carries onto the clone by itself. A
     *     second pledge there is a duplicate rather than a second lien, and is refused by name.
     *   - `LLC_BI__Collateral_Type__c` is a 43-record config catalog, and the caller may send EITHER
     *     a record id or a WORD. THE ID IS THE HONEST FORM and the catalog tool publishes ids for
     *     exactly that reason: this org holds DUPLICATE type names (Real Estate-Construction exists
     *     twice, at 80% and at 90%), so a name is not an identifier. A word resolves by exact name,
     *     then by containment, and a word matching more than one row is refused with the candidate
     *     ids AND their advance rates - the rate is what the lendable value is computed from, so
     *     picking the wrong twin is a credit error rather than a cosmetic one. A type whose own
     *     `LLC_BI__Advance_Rate__c` is null is refused HERE, because the org's
     *     `Advance_Rate_should_not_be_null` rule fires on the COLLATERAL insert rather than on the
     *     type, and a refusal at write time reads as a mystery.
     *   - `LLC_BI__Advance_Rate__c` on a pledge is a FORMULA resolving override -> auto-applied ->
     *     the type's default (LESSONS 29). A stated rate is therefore an OVERRIDE, and the org's
     *     `Advance_Rate_Override` rule refuses the row unless `LLC_BI__Override_Reason__c` carries
     *     something. The caller may send that reason; where it does not, one is composed as
     *     PROVENANCE - where the number came from - never as a credit justification nobody gave.
     *   - `Pledge_More_Than_Lendable_Value` fires when `LLC_BI__Amount_Pledged__c` exceeds the
     *     lendable value and `LLC_BI__Authorize__c` is false. An UNSTATED amount is not a zero and
     *     not a guess: it defaults to the lendable value itself, the asset's value at the rate this
     *     pledge resolves to. A STATED amount above that value is refused with the value and the
     *     rate behind it, and the refusal names the one way through: `authoriseOverPledge: true` on
     *     the entry, which sets Authorize. The checkbox is still a banker's decision - what changed
     *     on 2026-09-03 is that the banker can now express it here instead of being told the tool
     *     will never do it. It is written ONLY where the amount actually exceeds the lendable value,
     *     so the flag on a record always corresponds to an over-pledge somebody authorised.
     *
     * Nothing is created here. The arm hop of the execute pair writes the rows.
     */
    public static List<PledgeAdd> parsePledgeAdds(
        Request req,
        List<LLC_BI__Loan__c> facilities,
        List<C360NewFacilities.NewFacility> newFacilities
    ) {
        List<PledgeAdd> out = new List<PledgeAdd>();
        if (String.isBlank(req.pledgeAddsJson)) {
            return out;
        }
        List<Object> raw;
        try {
            raw = (List<Object>) JSON.deserializeUntyped(req.pledgeAddsJson);
        } catch (Exception e) {
            throw new ToolException('pledgeAddsJson could not be read as a JSON list: ' + e.getMessage());
        }
        if (raw.size() > PLEDGE_MAX) {
            throw new ToolException(
                'At most ' + PLEDGE_MAX + ' collateral pledges in one plan; this one carries ' + raw.size() + '. Each ' +
                'pledge wakes nCino\'s collateral aggregate automation, and a create wakes this org\'s change-stream ' +
                'triggers three times over, against a ceiling of 50 queued jobs in one transaction. Split the plan.'
            );
        }
        Map<Id, LLC_BI__Loan__c> byId = new Map<Id, LLC_BI__Loan__c>(facilities);
        Id borrowerId = facilities[0].LLC_BI__Account__c;

        // ONE read for every existing collateral the plan names, and one for every type word, rather
        // than a pair per entry. Staging writes nothing, but it is still the call a banker waits on.
        Set<Id> existingIds = new Set<Id>();
        Set<String> typeWords = new Set<String>();
        for (Object o : raw) {
            Map<String, Object> m = (Map<String, Object>) o;
            Id cid = C360Plan.asId(m.get('collateralId'));
            if (cid != null) {
                existingIds.add(cid);
            }
            Map<String, Object> nc = m.get('newCollateral') == null ? null : (Map<String, Object>) m.get('newCollateral');
            if (nc != null && nc.get('collateralType') != null) {
                typeWords.add(String.valueOf(nc.get('collateralType')).trim().toLowerCase());
            }
        }
        Map<Id, LLC_BI__Collateral__c> assets = existingIds.isEmpty()
            ? new Map<Id, LLC_BI__Collateral__c>()
            : new Map<Id, LLC_BI__Collateral__c>([
                SELECT Id, Name, LLC_BI__Description__c, LLC_BI__Value__c,
                       LLC_BI__Collateral_Type__r.Name, LLC_BI__Collateral_Type__r.LLC_BI__Advance_Rate__c
                FROM LLC_BI__Collateral__c WHERE Id IN :existingIds WITH USER_MODE
            ]);
        Set<Id> ownedByBorrower = new Set<Id>();
        if (!existingIds.isEmpty()) {
            for (LLC_BI__Account_Collateral__c own : [
                SELECT LLC_BI__Collateral__c FROM LLC_BI__Account_Collateral__c
                WHERE LLC_BI__Collateral__c IN :existingIds AND LLC_BI__Account__c = :borrowerId WITH USER_MODE
            ]) {
                ownedByBorrower.add(own.LLC_BI__Collateral__c);
            }
        }
        // What each selected facility already secures, so a duplicate is named rather than filed.
        // KEYED ON THE TARGET, WHICHEVER SHAPE IT HAS. A net-new facility has no id yet, so its
        // bucket is its label; without that every new facility on one plan would share one bucket
        // and the second pledge onto the second facility would read as a duplicate of the first.
        Map<String, Set<Id>> pledgedByFacility = new Map<String, Set<Id>>();
        Set<Id> selectedIds = byId.keySet();
        if (!existingIds.isEmpty()) {
            for (LLC_BI__Loan_Collateral2__c p : [
                SELECT LLC_BI__Loan__c, LLC_BI__Collateral__c FROM LLC_BI__Loan_Collateral2__c
                WHERE LLC_BI__Loan__c IN :selectedIds AND LLC_BI__Collateral__c IN :existingIds WITH USER_MODE
            ]) {
                String bucket = String.valueOf(p.LLC_BI__Loan__c);
                if (!pledgedByFacility.containsKey(bucket)) {
                    pledgedByFacility.put(bucket, new Set<Id>());
                }
                pledgedByFacility.get(bucket).add(p.LLC_BI__Collateral__c);
            }
        }
        List<LLC_BI__Collateral_Type__c> types = typeWords.isEmpty()
            ? new List<LLC_BI__Collateral_Type__c>()
            : [SELECT Id, Name, LLC_BI__Advance_Rate__c FROM LLC_BI__Collateral_Type__c WITH USER_MODE LIMIT 500];

        for (Object o : raw) {
            Map<String, Object> m = (Map<String, Object>) o;
            PledgeAdd pa = new PledgeAdd();
            pa.collateralId = C360Plan.asId(m.get('collateralId'));
            Map<String, Object> nc = m.get('newCollateral') == null ? null : (Map<String, Object>) m.get('newCollateral');
            pa.isNew = nc != null;

            if (pa.collateralId != null && pa.isNew) {
                throw new ToolException(
                    'A pledge names an EXISTING collateral or describes a NEW one, never both. Entry carries collateralId ' +
                    pa.collateralId + ' and a newCollateral block.'
                );
            }
            if (pa.collateralId == null && !pa.isNew) {
                throw new ToolException(
                    'Each pledge names its asset: collateralId for one the borrower already owns, or newCollateral ' +
                    '{description, collateralType, value} for one this plan should create.'
                );
            }

            pa.targetNewLabel = armLabel(m.get('targetLoanId'), newFacilities, 'pledge');
            pa.targetLoanId = pa.targetNewLabel == null ? C360Plan.asId(m.get('targetLoanId')) : null;
            if (pa.targetNewLabel == null && pa.targetLoanId == null) {
                if (facilities.size() != 1) {
                    throw new ToolException('targetLoanId is required on each pledge when more than one facility is selected.');
                }
                pa.targetLoanId = facilities[0].Id;
            }
            if (pa.targetNewLabel == null && !byId.containsKey(pa.targetLoanId)) {
                throw new ToolException(
                    'A pledge targets facility ' + pa.targetLoanId + ', which is not one of the selected facilities. ' +
                    'A pledge is authored on the CLONE of a facility this plan modifies.'
                );
            }

            pa.advanceRate = C360Plan.asDecimal(m.get('advanceRate'));
            if (pa.advanceRate != null && (pa.advanceRate <= 0 || pa.advanceRate > 100)) {
                throw new ToolException('An advance rate is a percentage above zero and at most 100. Supplied: ' + pa.advanceRate + '.');
            }

            if (pa.isNew) {
                pa.description = nc.get('description') == null ? null : String.valueOf(nc.get('description')).trim();
                if (String.isBlank(pa.description)) {
                    throw new ToolException(
                        'A new collateral needs a description. Name on a collateral is an autonumber (COL-000nnn), so the ' +
                        'description is the only readable identity the asset carries.'
                    );
                }
                if (pa.description.length() > COLLATERAL_DESCRIPTION_MAX) {
                    throw new ToolException(
                        'A collateral description is at most ' + COLLATERAL_DESCRIPTION_MAX + ' characters on this org; ' +
                        'this one is ' + pa.description.length() + '. The 32k narrative field is ' +
                        'LLC_BI__Collateral_Legal_Description__c, which this arm does not write.'
                    );
                }
                pa.newValue = C360Plan.asDecimal(nc.get('value'));
                if (pa.newValue == null || pa.newValue <= 0) {
                    throw new ToolException('A new collateral needs a value greater than zero: the lendable value is derived from it.');
                }
                if (pa.advanceRate == null) {
                    throw new ToolException(
                        'A new collateral needs an advance rate. It is a credit decision on an asset nobody has lent ' +
                        'against yet, and this tool does not fall back to the collateral type\'s default on the banker\'s behalf.'
                    );
                }
                resolveCollateralType(pa, nc.get('collateralType'), types);
                pa.collateralValue = pa.newValue;
                pa.assetLabel = pa.description;
            } else {
                LLC_BI__Collateral__c asset = assets.get(pa.collateralId);
                if (asset == null) {
                    throw new ToolException('No collateral exists with id ' + pa.collateralId + '.');
                }
                if (!ownedByBorrower.contains(pa.collateralId)) {
                    throw new ToolException(
                        'Collateral ' + asset.Name + ' is not owned by this borrower. LLC_BI__Collateral__c carries no ' +
                        'account lookup at all on this org, so ownership is the LLC_BI__Account_Collateral__c junction ' +
                        'and there is no row joining this asset to the relationship. Record the ownership first, or ' +
                        'pledge an asset the borrower holds.'
                    );
                }
                // Already on the facility, so the carry brings it onto the clone by itself; or named
                // twice by this same plan, which is the same duplicate arriving from the other side.
                String bucket = targetKey(pa.targetLoanId, pa.targetNewLabel);
                Set<Id> already = pledgedByFacility.get(bucket);
                if (already == null) {
                    already = new Set<Id>();
                    pledgedByFacility.put(bucket, already);
                }
                if (already.contains(pa.collateralId)) {
                    throw new ToolException(
                        'Collateral ' + asset.Name + ' is already pledged to ' +
                        (pa.targetNewLabel == null ? byId.get(pa.targetLoanId).Name : pa.targetNewLabel) +
                        ', or this plan pledges it there twice. Either way the modification carries one pledge onto ' +
                        'the clone, and a second row there is a duplicate rather than a second lien.'
                    );
                }
                already.add(pa.collateralId);
                pa.description = asset.LLC_BI__Description__c;
                pa.collateralTypeName = asset.LLC_BI__Collateral_Type__r.Name;
                pa.typeAdvanceRate = asset.LLC_BI__Collateral_Type__r.LLC_BI__Advance_Rate__c;
                pa.collateralValue = asset.LLC_BI__Value__c;
                pa.assetLabel = String.isBlank(asset.LLC_BI__Description__c) ? asset.Name : asset.LLC_BI__Description__c;
            }

            // Active is the only birth state the guard admits: an inactive pledge is security nobody
            // is claiming, which is not what pledging an asset means.
            pa.pledgedStatus = 'Active';
            pa.lienPosition = m.get('lienPosition') == null
                ? null
                : pledgePicklist('LLC_BI__Lien_Position__c', m.get('lienPosition'), 'lien position');

            // THE OVERRIDE AND ITS REASON TRAVEL TOGETHER, or the org refuses the row.
            if (pa.advanceRate != null) {
                pa.advanceRateReason = m.get('advanceRateReason') == null
                    ? null : String.valueOf(m.get('advanceRateReason')).trim();
                if (String.isBlank(pa.advanceRateReason)) {
                    pa.advanceRateReason =
                        'Advance rate of ' + String.valueOf(pa.advanceRate) + '% stated by the approver on this ' +
                        'modification when the collateral was pledged' +
                        (pa.typeAdvanceRate == null ? '' :
                            ', against the ' + pa.collateralTypeName + ' type default of ' + String.valueOf(pa.typeAdvanceRate) + '%') +
                        '. Recorded as provenance: the org requires a reason with any override, and this states where ' +
                        'the figure came from rather than why it was judged right.';
                }
            }

            // THE FACILITY'S SHARE. Left unstated it is zero, and a pledge contributing nothing to
            // the facility's coverage is a row that reads as security and is not. So it defaults to
            // the whole lendable value of the asset AT THE RATE THIS PLEDGE WILL RESOLVE TO - which
            // is the override where one is stated, and the type's own rate otherwise.
            Decimal effectiveRate = pa.advanceRate != null ? pa.advanceRate : pa.typeAdvanceRate;
            Decimal lendable = (pa.collateralValue == null || effectiveRate == null)
                ? null
                : (pa.collateralValue * effectiveRate / 100).setScale(2);
            pa.amountPledged = C360Plan.asDecimal(m.get('amountPledged'));
            pa.authoriseOverPledge = false;
            if (pa.amountPledged == null) {
                pa.amountPledged = lendable;
            } else if (pa.amountPledged <= 0) {
                throw new ToolException('An amount pledged is greater than zero, or it is left out and the lendable value is used.');
            } else if (lendable != null && pa.amountPledged > lendable) {
                // THE ONE WAY THROUGH, and it is the caller's to take. Sending the flag is the
                // banker saying the bank will lend past the asset's lendable value on this pledge;
                // withholding it leaves the org's own rule standing.
                if (!C360Plan.asBool(m.get('authoriseOverPledge'))) {
                    throw new ToolException(
                        'A pledged amount of ' + pa.amountPledged + ' exceeds the asset\'s lendable value of ' + lendable +
                        ' at ' + effectiveRate + '%. The org\'s Pledge_More_Than_Lendable_Value rule refuses that row ' +
                        'unless LLC_BI__Authorize__c (Authorize Pledge Amount) is set. Send "authoriseOverPledge": true ' +
                        'on this pledge to set it, and the plan will say in words that the over-pledge was authorised; ' +
                        'or leave amountPledged out and the lendable value of ' + lendable + ' is used.'
                    );
                }
                pa.authoriseOverPledge = true;
            }
            out.add(pa);
        }
        return out;
    }

    /**
     * Resolves the caller's answer for the kind of asset against the org's OWN collateral-type
     * catalog. TWO FORMS, and the first one is the one to prefer: an LLC_BI__Collateral_Type__c
     * record id, which is what Customer360Catalog publishes as acceptedValues, or the type's exact
     * name. Names are NOT unique in this catalog - the org carries Real Estate-Construction twice,
     * at 80% and at 90% - so a name that matches more than one row comes back with the candidate
     * ids AND their advance rates rather than resolving to whichever row was read first. Failing to
     * refuse that would pick a lendable value nobody chose.
     *
     * The type must carry an advance rate of its own, because the org's
     * `Advance_Rate_should_not_be_null` rule surfaces on the COLLATERAL insert rather than on the
     * type record, where nobody would think to look for it.
     */
    private static void resolveCollateralType(PledgeAdd pa, Object supplied, List<LLC_BI__Collateral_Type__c> types) {
        if (supplied == null || String.isBlank(String.valueOf(supplied))) {
            throw new ToolException(
                'A new collateral names its collateralType, as the LLC_BI__Collateral_Type__c record id or as the ' +
                'type\'s exact name: the org resolves it against its own catalog.'
            );
        }
        String word = String.valueOf(supplied).trim();
        List<LLC_BI__Collateral_Type__c> hits = new List<LLC_BI__Collateral_Type__c>();

        Id suppliedId = asCollateralTypeId(word);
        if (suppliedId != null) {
            for (LLC_BI__Collateral_Type__c t : types) {
                if (t.Id == suppliedId) {
                    hits.add(t);
                }
            }
            if (hits.isEmpty()) {
                throw new ToolException(
                    'No collateral type exists with id ' + word + ' in this org\'s catalog. The org offers: ' +
                    typeNames(types) + '.'
                );
            }
        } else {
            // EVERY exact match, not the first one: the duplicates are exact matches of each other.
            for (LLC_BI__Collateral_Type__c t : types) {
                if (t.Name != null && t.Name.equalsIgnoreCase(word)) {
                    hits.add(t);
                }
            }
            if (hits.isEmpty()) {
                for (LLC_BI__Collateral_Type__c t : types) {
                    if (t.Name != null && t.Name.toLowerCase().contains(word.toLowerCase())) {
                        hits.add(t);
                    }
                }
            }
            if (hits.isEmpty()) {
                throw new ToolException(
                    '"' + word + '" is not a collateral type this org holds. The org offers: ' + typeNames(types) + '.'
                );
            }
            if (hits.size() > 1) {
                throw new ToolException(
                    '"' + word + '" matches ' + hits.size() + ' collateral types on this org, and the name does not ' +
                    'tell them apart: ' + typeCandidates(hits) + '. Send the id of the one you mean as collateralType. ' +
                    'The advance rates differ, and the advance rate is what the lendable value is computed from.'
                );
            }
        }
        if (hits[0].LLC_BI__Advance_Rate__c == null) {
            throw new ToolException(
                'Collateral type "' + hits[0].Name + '" carries no advance rate of its own, and the org\'s ' +
                'Advance_Rate_should_not_be_null rule refuses a collateral created against it - the error surfaces on ' +
                'the ASSET insert rather than on the type. Set the type\'s advance rate in the org, or pick another type.'
            );
        }
        pa.collateralTypeId = hits[0].Id;
        pa.collateralTypeName = hits[0].Name;
        pa.typeAdvanceRate = hits[0].LLC_BI__Advance_Rate__c;
    }

    /**
     * The supplied word AS AN ID, or null where it is a name. Deliberately not `C360Plan.asId`,
     * which throws on anything that is not an id: here a non-id is the ordinary other case.
     */
    private static Id asCollateralTypeId(String word) {
        String prefix = LLC_BI__Collateral_Type__c.SObjectType.getDescribe().getKeyPrefix();
        if (String.isBlank(prefix) || !word.startsWith(prefix)) {
            return null;
        }
        if (word.length() != 15 && word.length() != 18) {
            return null;
        }
        try {
            return Id.valueOf(word);
        } catch (Exception e) {
            return null;
        }
    }

    /** Candidates a caller can actually choose between: the id that settles it, and the rate that
     *  makes the choice matter. */
    private static String typeCandidates(List<LLC_BI__Collateral_Type__c> types) {
        List<String> out = new List<String>();
        for (LLC_BI__Collateral_Type__c t : types) {
            out.add(
                t.Name + ' (' + t.Id + ', advance rate ' +
                (t.LLC_BI__Advance_Rate__c == null ? 'not set' : String.valueOf(t.LLC_BI__Advance_Rate__c) + '%') + ')'
            );
        }
        return String.join(out, ', ');
    }

    /** The org's own candidate list, for a refusal that can be acted on. */
    private static String typeNames(List<LLC_BI__Collateral_Type__c> types) {
        List<String> names = new List<String>();
        for (LLC_BI__Collateral_Type__c t : types) {
            if (t.Name != null) {
                names.add(t.Name);
            }
            if (names.size() == 40) {
                names.add('(and more)');
                break;
            }
        }
        names.sort();
        return String.join(names, ', ');
    }

    /** Resolves one value against a LIVE picklist on the pledge junction. */
    private static String pledgePicklist(String fieldName, Object supplied, String what) {
        return orgPicklist(
            Schema.SObjectType.LLC_BI__Loan_Collateral2__c.fields.getMap().get(fieldName.toLowerCase()).getDescribe(),
            supplied,
            what
        );
    }

    /** One pledge as the banker should read it in a plan step. */
    public static String pledgePhrase(PledgeAdd pa) {
        return (pa.amountPledged == null ? 'no stated share of the asset' : String.valueOf(pa.amountPledged) + ' pledged') +
            (pa.advanceRate == null
                ? ', at the ' + pa.collateralTypeName + ' type\'s own advance rate'
                : ', at a ' + String.valueOf(pa.advanceRate) + '% advance-rate override with its reason recorded') +
            (String.isBlank(pa.lienPosition) ? ', lien position not stated' : ', ' + pa.lienPosition + ' lien') +
            (pa.authoriseOverPledge == true
                ? ', OVER the asset\'s lendable value with Authorize Pledge Amount set, which is the authorisation the ' +
                  'caller gave and the org\'s Pledge_More_Than_Lendable_Value rule reads'
                : '');
    }

    /** How many of the staged pledges have to author their asset first. */
    public static Integer newCollaterals(List<PledgeAdd> pledgeAdds) {
        Integer n = 0;
        for (PledgeAdd pa : pledgeAdds) {
            if (pa.isNew) {
                n++;
            }
        }
        return n;
    }

    /* ---------------------------------------------------------------------- policy exceptions */

    /**
     * FIVE, AND THE REASON IS EGRESS RATHER THAN GOVERNORS. Every exception in a plan is inserted
     * in ONE DML, so the CDC queueable costs the same whether there is one or twenty and the 50-job
     * ceiling is nowhere near. What the cap bounds is the PAYLOAD: that one callout POSTs every row
     * it carries to an external endpoint, and a plan that could ship twenty exceptions in a single
     * transmission is a plan whose blast radius nobody read before confirming.
     */
    private static final Integer POLICY_EXCEPTION_MAX = 5;
    /** `Name` is string(80) on this object, and it is plain text rather than an autonumber. */
    private static final Integer EXCEPTION_TITLE_MAX = 80;
    /** Each of the three `LLC_BI__Mitigation_Reason_N__c` fields is string(100). */
    private static final Integer MITIGATION_REASON_MAX = 100;
    /** `LLC_BI__Code__c` and `LLC_BI__Severity__c` are both string(50) on this org. */
    private static final Integer EXCEPTION_SHORT_TEXT_MAX = 50;
    /** The org holds exactly three mitigation reasons; a fourth has nowhere to go. */
    private static final Integer MITIGATION_SLOTS = 3;
    /** Every one of this org's 81 exceptions carries it, and it is the only required field. */
    private static final String EXCEPTION_TYPE_DEFAULT = 'Policy';
    private static final String STATUS_MITIGATED = 'Mitigated';
    private static final String STATUS_UNMITIGATED = 'Unmitigated';

    /**
     * Parses and RESOLVES the policy exceptions against the org's OWN exception model. Every
     * refusal below is a live finding from the 2026-08-31 rollback probe rather than a convention:
     *
     *   - `Name` is PLAIN TEXT here, not an autonumber, and omitting it is worse than either: the
     *     org's trigger stack backfills it with the record's own 15-character Id (probe variant A
     *     read back "a4rbb000003OwSX" as its own name). So a title is required, and a title over
     *     80 characters is refused with its length rather than cut.
     *   - `LLC_BI__Status__c` DEFAULTS TO UNMITIGATED, which reads as a decision rather than as an
     *     absent value: a credit file cannot tell "nobody said" from "nobody mitigated it". So the
     *     status is required and is resolved against the org's live picklist.
     *   - A MITIGATED exception with no mitigant is a claim with nothing under it, and an
     *     UNMITIGATED one carrying mitigants says both "nothing mitigates this" and "here is what
     *     mitigates it" on one record. Both are refused.
     *   - The three `LLC_BI__Mitigation_Reason_N__c` fields are 100 characters EACH. A longer one
     *     is refused with its length: truncating leaves a mitigant that stops mid-clause on a credit
     *     record, and splitting one across the three fields would file one mitigant as three, which
     *     is the distinction the org's own hand-authored Hartwell row uses those fields to make.
     *   - `LLC_BI__Severity__c` is FREE TEXT (string(50)); "Major" is a data convention in this org
     *     rather than an enforced value, so a severity is length-checked and passed through rather
     *     than validated against a picklist that does not exist.
     *
     * Nothing is created here. The arm hop of the execute pair writes the rows.
     */
    private static List<PolicyExceptionAdd> parsePolicyExceptionAdds(Request req, List<LLC_BI__Loan__c> facilities) {
        List<PolicyExceptionAdd> out = new List<PolicyExceptionAdd>();
        if (String.isBlank(req.policyExceptionAddsJson)) {
            return out;
        }
        List<Object> raw;
        try {
            raw = (List<Object>) JSON.deserializeUntyped(req.policyExceptionAddsJson);
        } catch (Exception e) {
            throw new ToolException('policyExceptionAddsJson could not be read as a JSON list: ' + e.getMessage());
        }
        if (raw.size() > POLICY_EXCEPTION_MAX) {
            throw new ToolException(
                'At most ' + POLICY_EXCEPTION_MAX + ' policy exceptions in one plan; this one carries ' + raw.size() +
                '. Every committed exception is POSTed to the bank\'s external change-stream endpoint in a single ' +
                'transmission, and a plan carrying more than a handful is one whose blast radius nobody read. Split it.'
            );
        }
        Map<Id, LLC_BI__Loan__c> byId = new Map<Id, LLC_BI__Loan__c>(facilities);
        Schema.DescribeFieldResult statusField =
            Schema.SObjectType.LLC_BI__Policy_Exception__c.fields.getMap().get('llc_bi__status__c').getDescribe();

        for (Object o : raw) {
            Map<String, Object> m = (Map<String, Object>) o;
            PolicyExceptionAdd px = new PolicyExceptionAdd();

            px.title = m.get('title') == null ? null : String.valueOf(m.get('title')).trim();
            if (String.isBlank(px.title)) {
                throw new ToolException(
                    'Each policy exception needs a title. Name on this object is plain text rather than an autonumber, ' +
                    'and the org\'s trigger stack backfills an omitted one with the record\'s own Id - so an exception ' +
                    'without a title is a row nobody can find and nobody can read.'
                );
            }
            if (px.title.length() > EXCEPTION_TITLE_MAX) {
                throw new ToolException(
                    'A policy exception\'s title is at most ' + EXCEPTION_TITLE_MAX + ' characters on this org; this ' +
                    'one is ' + px.title.length() + '. It is refused rather than cut: a name that stops mid-word is ' +
                    'how an exception becomes unfindable.'
                );
            }

            if (m.get('status') == null || String.isBlank(String.valueOf(m.get('status')))) {
                throw new ToolException(
                    'Each policy exception names its status. The org DEFAULTS a new row to ' + STATUS_UNMITIGATED +
                    ', which reads as a decision rather than as an absent value, so this tool will not take that ' +
                    'default on the bank\'s behalf.'
                );
            }
            px.status = orgPicklist(statusField, m.get('status'), 'policy exception status');

            px.exceptionType = m.get('type') == null || String.isBlank(String.valueOf(m.get('type')))
                ? EXCEPTION_TYPE_DEFAULT
                : String.valueOf(m.get('type')).trim();

            px.reasons = readMitigationReasons(m.get('mitigationReasons'));
            if (px.status == STATUS_MITIGATED && px.reasons.isEmpty()) {
                throw new ToolException(
                    'A ' + STATUS_MITIGATED + ' policy exception needs at least one mitigation reason. Recording the ' +
                    'status without the mitigant is a claim the credit file cannot stand on.'
                );
            }
            if (px.status == STATUS_UNMITIGATED && !px.reasons.isEmpty()) {
                throw new ToolException(
                    'An ' + STATUS_UNMITIGATED + ' policy exception carries no mitigation reasons: the record would ' +
                    'say both that nothing mitigates this and here is what mitigates it. Send it as ' + STATUS_MITIGATED +
                    ' if the mitigants are real.'
                );
            }

            px.code = trimmedWithin(m.get('code'), EXCEPTION_SHORT_TEXT_MAX, 'policy exception code');
            px.severity = trimmedWithin(m.get('severity'), EXCEPTION_SHORT_TEXT_MAX, 'policy exception severity');
            px.severityValue = C360Plan.asDecimal(m.get('severityValue'));

            px.targetLoanId = C360Plan.asId(m.get('targetLoanId'));
            if (px.targetLoanId == null) {
                if (facilities.size() != 1) {
                    throw new ToolException('targetLoanId is required on each policy exception when more than one facility is selected.');
                }
                px.targetLoanId = facilities[0].Id;
            }
            if (!byId.containsKey(px.targetLoanId)) {
                throw new ToolException(
                    'A policy exception targets facility ' + px.targetLoanId + ', which is not one of the selected ' +
                    'facilities. An exception is logged against the CLONE of a facility this plan modifies.'
                );
            }
            out.add(px);
        }
        return out;
    }

    /**
     * Reads the mitigation reasons off one entry, refusing anything the org's three 100-character
     * fields cannot hold. Nothing is truncated and nothing is merged: both would put words on a
     * credit record in a shape nobody wrote them in.
     */
    private static List<String> readMitigationReasons(Object supplied) {
        List<String> out = new List<String>();
        if (supplied == null) {
            return out;
        }
        if (!(supplied instanceof List<Object>)) {
            throw new ToolException(
                'mitigationReasons is a list of strings, one per mitigant: the org holds ' + MITIGATION_SLOTS +
                ' of them as separate fields and a single joined string would file three mitigants as one.'
            );
        }
        for (Object r : (List<Object>) supplied) {
            if (r == null) {
                continue;
            }
            String reason = String.valueOf(r).trim();
            if (String.isBlank(reason)) {
                continue;
            }
            if (reason.length() > MITIGATION_REASON_MAX) {
                throw new ToolException(
                    'A mitigation reason is at most ' + MITIGATION_REASON_MAX + ' characters on this org; "' +
                    reason.abbreviate(60) + '" is ' + reason.length() + '. Shorten it or split it into separate ' +
                    'mitigants - it is refused rather than truncated, because a mitigant that stops mid-clause reads ' +
                    'as a different mitigant.'
                );
            }
            out.add(reason);
        }
        if (out.size() > MITIGATION_SLOTS) {
            throw new ToolException(
                'The org holds ' + MITIGATION_SLOTS + ' mitigation reasons on a policy exception and this entry ' +
                'carries ' + out.size() + '. The extras are refused rather than dropped quietly.'
            );
        }
        return out;
    }

    /** One optional free-text field, trimmed and held to the org's own length. */
    private static String trimmedWithin(Object supplied, Integer max, String what) {
        if (supplied == null || String.isBlank(String.valueOf(supplied))) {
            return null;
        }
        String s = String.valueOf(supplied).trim();
        if (s.length() > max) {
            throw new ToolException('A ' + what + ' is at most ' + max + ' characters on this org; this one is ' + s.length() + '.');
        }
        return s;
    }

    /** One policy exception as the banker should read it in a plan step. */
    private static String exceptionPhrase(PolicyExceptionAdd px) {
        return px.status +
            (px.reasons.isEmpty()
                ? ', with no mitigant recorded'
                : ', mitigated by ' + String.join(px.reasons, '; ')) +
            (String.isBlank(px.severity) ? '' : ', severity ' + px.severity) +
            (String.isBlank(px.code) ? '' : ', policy code ' + px.code);
    }

    /**
     * THE FOUR SCALARS, in the spelling a refusal hands back. This is the whole legal set for
     * scalarChangesJson: everything else on the Loan rides fieldChangesJson, where the org resolves
     * the name against its own describe.
     */
    private static final List<String> SCALAR_ORDER = new List<String>{
        'requestedAmount', 'requestedMaturityDate', 'requestedRate', 'requestedTermMonths'
    };

    /** The word a banker reads each scalar by, for the plan steps and the warnings. */
    private static final Map<String, String> SCALAR_WORD = new Map<String, String>{
        'requestedAmount' => 'amount',
        'requestedMaturityDate' => 'maturity date',
        'requestedRate' => 'interest rate',
        'requestedTermMonths' => 'term'
    };

    private static String canonicalScalar(String raw) {
        if (String.isBlank(raw)) {
            return null;
        }
        for (String k : SCALAR_ORDER) {
            if (k.equalsIgnoreCase(raw.trim())) {
                return k;
            }
        }
        return null;
    }

    /**
     * Parses and RESOLVES the per-target scalars.
     *
     * WHY THIS EXISTS (founder, 2026-08-31): "there is the possibility that there is a change on a
     * loan which does not have an increase or decrease". The four scalars used to travel ONCE per
     * request and land on every selected clone, so an amount on the line of credit could not be
     * staged beside an amortisation change on the equipment loan without silently taking the
     * equipment clone to the line's commitment. Each scalar now names the member it lands on.
     *
     * The two channels are EXCLUSIVE. The flat fields broadcast by contract; these target by
     * contract. A request carrying both leaves a clone with two figures and no rule to pick between
     * them, so it is refused rather than resolved by precedence.
     */
    public static List<ScalarChange> parseScalarChanges(Request req, List<LLC_BI__Loan__c> facilities) {
        List<ScalarChange> out = new List<ScalarChange>();
        if (String.isBlank(req.scalarChangesJson)) {
            return out;
        }
        if (req.requestedAmount != null || req.requestedMaturityDate != null ||
            req.requestedRate != null || req.requestedTermMonths != null) {
            throw new ToolException(
                'scalarChangesJson carries the scalars PER FACILITY, and requestedAmount, requestedMaturityDate, ' +
                'requestedRate and requestedTermMonths broadcast ONE value to every selected facility. Sending both ' +
                'leaves it undecided which figure a clone should take. Send one channel or the other.'
            );
        }
        List<Object> raw;
        try {
            raw = (List<Object>) JSON.deserializeUntyped(req.scalarChangesJson);
        } catch (Exception e) {
            throw new ToolException('scalarChangesJson could not be read as a JSON list: ' + e.getMessage());
        }
        Map<Id, LLC_BI__Loan__c> byId = new Map<Id, LLC_BI__Loan__c>(facilities);
        Set<String> claimed = new Set<String>();
        for (Object o : raw) {
            Map<String, Object> m = (Map<String, Object>) o;
            String rawKey = m.get('key') == null ? null : String.valueOf(m.get('key'));
            ScalarChange sc = new ScalarChange();
            sc.key = canonicalScalar(rawKey);
            if (sc.key == null) {
                throw new ToolException(
                    '"' + rawKey + '" is not one of the scalars this tool files. The legal keys are: ' +
                    String.join(SCALAR_ORDER, ', ') + '. Any other loan field rides fieldChangesJson, where the org ' +
                    'resolves the name against its own describe.'
                );
            }
            sc.targetLoanId = C360Plan.asId(m.get('targetLoanId'));
            if (sc.targetLoanId == null) {
                if (facilities.size() != 1) {
                    throw new ToolException('targetLoanId is required on each scalar change when more than one facility is selected.');
                }
                sc.targetLoanId = facilities[0].Id;
            }
            if (!byId.containsKey(sc.targetLoanId)) {
                List<String> legal = new List<String>();
                for (LLC_BI__Loan__c f : facilities) {
                    legal.add(f.Name + ' (' + f.Id + ')');
                }
                throw new ToolException(
                    'A scalar change targets facility ' + sc.targetLoanId + ', which is not one of the selected facilities. ' +
                    'A scalar lands on the CLONE of a facility this plan modifies, so the legal targets are: ' +
                    String.join(legal, ', ') + '.'
                );
            }
            String at = sc.key + '@' + sc.targetLoanId;
            if (claimed.contains(at)) {
                throw new ToolException(
                    sc.key + ' is staged twice on ' + byId.get(sc.targetLoanId).Name + '. A scalar travels once per ' +
                    'facility; a second figure for the same field on the same clone is a later modification, not this one.'
                );
            }
            claimed.add(at);
            coerceScalarValue(sc, m.get('value'));
            out.add(sc);
        }
        return out;
    }

    /** Coerces a per-target scalar into the type its clone field takes. */
    private static void coerceScalarValue(ScalarChange sc, Object supplied) {
        if (supplied == null) {
            throw new ToolException(sc.key + ' needs a value. Clearing a scalar is not a change this tool files.');
        }
        String sv = String.valueOf(supplied).trim();
        if (sc.key == 'requestedMaturityDate') {
            try {
                sc.dateValue = Date.valueOf(sv);
            } catch (Exception e) {
                throw new ToolException('requestedMaturityDate is a date; supply YYYY-MM-DD. Got "' + sv + '".');
            }
            return;
        }
        try {
            sc.numberValue = Decimal.valueOf(sv.replace(',', ''));
        } catch (Exception e) {
            throw new ToolException(sc.key + ' is a number; "' + sv + '" is not one.');
        }
        if (sc.key == 'requestedAmount' && sc.numberValue <= 0) {
            throw new ToolException('requestedAmount must be greater than zero.');
        }
    }

    /** One scalar as the banker should read it in a plan step. */
    public static String scalarPhrase(ScalarChange sc) {
        String value = sc.key == 'requestedMaturityDate' ? String.valueOf(sc.dateValue) : String.valueOf(sc.numberValue);
        return SCALAR_WORD.get(sc.key) + ' to ' + value + (sc.key == 'requestedTermMonths' ? ' months' : '');
    }

    /** Every selected member and the scalars aimed at it, including the ones aimed at nothing. */
    private static List<String> perMemberScalars(List<LLC_BI__Loan__c> facilities, Map<Id, List<String>> wordsByTarget) {
        List<String> out = new List<String>();
        for (LLC_BI__Loan__c f : facilities) {
            out.add(f.Name + ': ' + (wordsByTarget.containsKey(f.Id)
                ? String.join(wordsByTarget.get(f.Id), ' and ')
                : 'no scalar change'));
        }
        return out;
    }

    /**
     * THE FIELD-WAVE DENY LIST. Everything else the describe says is writable and non-formula on
     * the Loan may file onto the clone. Four kinds of field stay out, each for a named reason:
     * the four scalars (they have their own request keys and drift baselines), stage and status
     * (the guard owns the one legal hop), the anchoring lookups (a re-anchored clone is a corrupted
     * version), and the versioning flags the engine itself owns.
     */
    private static final Set<String> FIELD_WAVE_DENY = new Set<String>{
        'llc_bi__amount__c', 'llc_bi__maturity_date__c', 'llc_bi__interestrate__c', 'llc_bi__term_months__c',
        'llc_bi__stage__c', 'llc_bi__status__c',
        'llc_bi__account__c', 'llc_bi__product_package__c', 'llc_bi__parentloan__c',
        'llc_bi__originalparentloan__c', 'llc_bi__highest__c', 'llc_bi__lookupkey__c',
        'llc_bi__isrenewal__c', 'llc_bi__is_modification__c', 'llc_bi__is_no_action_placeholder__c',
        'llc_bi__is_original_inactive_loan__c', 'ownerid', 'recordtypeid', 'currencyisocode'
    };

    /**
     * Parses and RESOLVES the field wave against the org's OWN describe: the field must exist on
     * Loan (by API name or exact label, case-insensitive), be updateable and non-formula, and sit
     * outside the deny-list. The value is coerced by the field's own type, and a picklist value is
     * validated against the org's active values — a refusal carries the legal list, so the caller
     * can correct itself with the org's vocabulary rather than guessing again.
     */
    public static List<FieldChange> parseFieldChanges(
        Request req,
        List<LLC_BI__Loan__c> facilities,
        List<C360NewFacilities.NewFacility> newFacilities
    ) {
        List<FieldChange> out = new List<FieldChange>();
        if (String.isBlank(req.fieldChangesJson)) {
            return out;
        }
        List<Object> raw;
        try {
            raw = (List<Object>) JSON.deserializeUntyped(req.fieldChangesJson);
        } catch (Exception e) {
            throw new ToolException('fieldChangesJson could not be read as a JSON list: ' + e.getMessage());
        }
        Map<String, Schema.SObjectField> fieldMap = Schema.SObjectType.LLC_BI__Loan__c.fields.getMap();
        // Labels resolve too: the banker's word for a field is its label, not its API name.
        Map<String, String> byLabel = new Map<String, String>();
        for (String key : fieldMap.keySet()) {
            Schema.DescribeFieldResult dfr = fieldMap.get(key).getDescribe();
            byLabel.put(dfr.getLabel().toLowerCase(), dfr.getName());
        }
        Map<Id, LLC_BI__Loan__c> byId = new Map<Id, LLC_BI__Loan__c>(facilities);
        for (Object o : raw) {
            Map<String, Object> m = (Map<String, Object>) o;
            String rawField = m.get('field') == null ? null : String.valueOf(m.get('field')).trim();
            if (String.isBlank(rawField)) {
                throw new ToolException('Each field change names its field: the API name or the exact field label.');
            }
            String apiName = fieldMap.containsKey(rawField.toLowerCase())
                ? fieldMap.get(rawField.toLowerCase()).getDescribe().getName()
                : byLabel.get(rawField.toLowerCase());
            if (apiName == null) {
                throw new ToolException('No field named "' + rawField + '" exists on the facility in this org, by API name or by label.');
            }
            if (FIELD_WAVE_DENY.contains(apiName.toLowerCase())) {
                throw new ToolException(
                    apiName + ' is outside the field wave: the four scalars ride their own request keys, and stage, ' +
                    'status, anchors and versioning flags belong to the org and the engine.'
                );
            }
            Schema.DescribeFieldResult dfr = fieldMap.get(apiName.toLowerCase()).getDescribe();
            if (!dfr.isUpdateable() || dfr.isCalculated() || dfr.isAutoNumber()) {
                throw new ToolException(apiName + ' is not writable in this org (formula, rollup or system-owned). The describe is the authority.');
            }
            FieldChange fc = new FieldChange();
            fc.fieldName = apiName;
            fc.fieldLabel = dfr.getLabel();
            fc.targetNewLabel = armLabel(m.get('targetLoanId'), newFacilities, 'field change');
            fc.targetLoanId = fc.targetNewLabel == null ? C360Plan.asId(m.get('targetLoanId')) : null;
            if (fc.targetNewLabel == null && fc.targetLoanId == null) {
                if (facilities.size() != 1) {
                    throw new ToolException('targetLoanId is required on each field change when more than one facility is selected.');
                }
                fc.targetLoanId = facilities[0].Id;
            }
            if (fc.targetNewLabel == null && !byId.containsKey(fc.targetLoanId)) {
                throw new ToolException('A field change targets facility ' + fc.targetLoanId + ', which is not one of the selected facilities.');
            }
            coerceFieldValue(fc, dfr, m.get('value'));
            out.add(fc);
        }
        return out;
    }

    /** Coerces the supplied value into the field's own type and validates picklists. */
    private static void coerceFieldValue(FieldChange fc, Schema.DescribeFieldResult dfr, Object supplied) {
        if (supplied == null) {
            throw new ToolException(fc.fieldName + ' needs a value. Clearing a field is not a change this wave files.');
        }
        Schema.DisplayType t = dfr.getType();
        fc.fieldType = String.valueOf(t);
        String sv = String.valueOf(supplied).trim();
        if (t == Schema.DisplayType.CURRENCY || t == Schema.DisplayType.DOUBLE || t == Schema.DisplayType.PERCENT || t == Schema.DisplayType.INTEGER) {
            Decimal d;
            try { d = Decimal.valueOf(sv.replace(',', '')); } catch (Exception e) {
                throw new ToolException(fc.fieldName + ' is a number (' + fc.fieldType + '); "' + sv + '" is not one.');
            }
            fc.valueJson = JSON.serialize(d);
        } else if (t == Schema.DisplayType.DATE) {
            try { fc.valueJson = JSON.serialize(Date.valueOf(sv)); } catch (Exception e) {
                throw new ToolException(fc.fieldName + ' is a date; supply YYYY-MM-DD. Got "' + sv + '".');
            }
        } else if (t == Schema.DisplayType.BOOLEAN) {
            if (sv.toLowerCase() != 'true' && sv.toLowerCase() != 'false') {
                throw new ToolException(fc.fieldName + ' is a checkbox; supply true or false. Got "' + sv + '".');
            }
            fc.valueJson = sv.toLowerCase();
        } else if (t == Schema.DisplayType.PICKLIST || t == Schema.DisplayType.MULTIPICKLIST) {
            List<String> legal = new List<String>();
            String matched;
            for (Schema.PicklistEntry pe : dfr.getPicklistValues()) {
                if (!pe.isActive()) { continue; }
                legal.add(pe.getValue());
                if (pe.getValue().toLowerCase() == sv.toLowerCase() || pe.getLabel().toLowerCase() == sv.toLowerCase()) {
                    matched = pe.getValue();
                }
            }
            if (matched == null) {
                throw new ToolException(
                    '"' + sv + '" is not a legal value for ' + fc.fieldName + '. The org offers: ' + String.join(legal, ', ') + '.'
                );
            }
            fc.valueJson = JSON.serialize(matched);
        } else if (t == Schema.DisplayType.STRING || t == Schema.DisplayType.TEXTAREA || t == Schema.DisplayType.URL || t == Schema.DisplayType.EMAIL || t == Schema.DisplayType.PHONE) {
            fc.valueJson = JSON.serialize(sv);
        } else if (t == Schema.DisplayType.REFERENCE) {
            throw new ToolException(fc.fieldName + ' is a lookup. Re-anchoring records is not a field change; use the arm that owns that relationship.');
        } else {
            throw new ToolException(fc.fieldName + ' is a ' + fc.fieldType + ' field, which this wave does not coerce yet.');
        }
    }

    /** The staged value as the banker should read it in the plan step. */
    public static String displayValue(FieldChange fc) {
        Object v = JSON.deserializeUntyped(fc.valueJson);
        return String.valueOf(v);
    }

    /** The borrowing-structure roles the amendment arm may file. Grantor and Contractor stay out:
     *  collateral and construction semantics, not borrowing structure. */
    private static final Set<String> INVOLVEMENT_ROLES = new Set<String>{
        'Borrower', 'Co-Borrower', 'Guarantor', 'Limited Guarantor', 'Related Entity'
    };

    /**
     * Parses and RESOLVES the borrowing-structure amendments. An ADD resolves its account against
     * the org (by id, or by exact name — ambiguity refused with the candidate ids) and warns when
     * that account is already involved on the target. A REMOVE resolves the EXACT involvement row
     * it excludes from the carry, at stage time, so the banker confirms a named row rather than a
     * description — and an account involved under two roles is refused until the role settles it.
     */
    public static List<InvolvementChange> parseInvolvementChanges(
        Request req,
        List<LLC_BI__Loan__c> facilities,
        List<C360NewFacilities.NewFacility> newFacilities,
        List<String> warnings
    ) {
        List<InvolvementChange> out = new List<InvolvementChange>();
        if (String.isBlank(req.involvementChangesJson)) {
            return out;
        }
        List<Object> raw;
        try {
            raw = (List<Object>) JSON.deserializeUntyped(req.involvementChangesJson);
        } catch (Exception e) {
            throw new ToolException('involvementChangesJson could not be read as a JSON list: ' + e.getMessage());
        }
        Map<Id, LLC_BI__Loan__c> byId = new Map<Id, LLC_BI__Loan__c>(facilities);
        for (Object o : raw) {
            Map<String, Object> m = (Map<String, Object>) o;
            InvolvementChange ic = new InvolvementChange();
            ic.op = m.get('op') == null ? null : String.valueOf(m.get('op')).trim().toLowerCase();
            ic.role = m.get('role') == null ? null : String.valueOf(m.get('role')).trim();
            ic.accountId = C360Plan.asId(m.get('accountId'));
            ic.accountName = m.get('accountName') == null ? null : String.valueOf(m.get('accountName')).trim();
            ic.ownership = C360Plan.asDecimal(m.get('ownership'));
            ic.targetNewLabel = armLabel(m.get('targetLoanId'), newFacilities, 'borrowing-structure change');
            ic.targetLoanId = ic.targetNewLabel == null ? C360Plan.asId(m.get('targetLoanId')) : null;
            if (ic.op != 'add' && ic.op != 'remove') {
                throw new ToolException('Each borrowing-structure change carries op "add" or "remove". Supplied: ' + ic.op + '.');
            }
            // A REMOVE is a CARRY EXCLUSION: the parent keeps its row and the new version starts
            // without it. A facility this plan is creating carries nothing to leave behind, so a
            // remove aimed at one is not a narrower version of the same act, it is a request with
            // no referent at all.
            if (ic.targetNewLabel != null && ic.op == 'remove') {
                throw new ToolException(
                    'A borrowing-structure REMOVE targets ' + ic.targetNewLabel + ', which is a facility this plan is ' +
                    'creating. A remove is a carry exclusion and a new facility carries nothing: it starts with the ' +
                    'borrower alone, and anybody else on it is an ADD.'
                );
            }
            if (ic.targetNewLabel == null && ic.targetLoanId == null) {
                if (facilities.size() != 1) {
                    throw new ToolException('targetLoanId is required on each borrowing-structure change when more than one facility is selected.');
                }
                ic.targetLoanId = facilities[0].Id;
            }
            if (ic.targetNewLabel == null && !byId.containsKey(ic.targetLoanId)) {
                throw new ToolException(
                    'A borrowing-structure change targets facility ' + ic.targetLoanId + ', which is not one of the selected facilities.'
                );
            }
            if (ic.op == 'add') {
                if (String.isBlank(ic.role) || !INVOLVEMENT_ROLES.contains(ic.role)) {
                    List<String> ok = new List<String>(INVOLVEMENT_ROLES);
                    ok.sort();
                    throw new ToolException('An involvement ADD names its role, one of: ' + String.join(ok, ', ') + '. Supplied: ' + ic.role + '.');
                }
                resolveAccount(ic);
                // The already-involved warning reads the TARGET's own structure. A facility this
                // plan creates has none yet, so the query is skipped rather than run against null.
                List<LLC_BI__Legal_Entities__c> onTarget = new List<LLC_BI__Legal_Entities__c>();
                if (ic.targetNewLabel == null) {
                    onTarget = [
                        SELECT Id, LLC_BI__Borrower_Type__c FROM LLC_BI__Legal_Entities__c
                        WHERE LLC_BI__Loan__c = :ic.targetLoanId AND LLC_BI__Account__c = :ic.accountId
                        WITH USER_MODE
                    ];
                }
                for (LLC_BI__Legal_Entities__c e : onTarget) {
                    warnings.add(
                        ic.accountName + ' is ALREADY involved on ' + byId.get(ic.targetLoanId).Name + ' as ' +
                        e.LLC_BI__Borrower_Type__c + ', and the carry will bring that row onto the clone. This plan adds a ' +
                        ic.role + ' row BESIDE it only because the banker confirms it knowingly.'
                    );
                }
            } else {
                resolveRemoval(ic, byId.get(ic.targetLoanId).Name);
            }
            out.add(ic);
        }
        return out;
    }

    /** Resolves an ADD's account by id or exact name; ambiguity and absence are both refused. */
    private static void resolveAccount(InvolvementChange ic) {
        if (ic.accountId != null) {
            List<Account> a = [SELECT Id, Name FROM Account WHERE Id = :ic.accountId WITH USER_MODE LIMIT 1];
            if (a.isEmpty()) {
                throw new ToolException('No account exists with id ' + ic.accountId + '.');
            }
            ic.accountName = a[0].Name;
            return;
        }
        if (String.isBlank(ic.accountName)) {
            throw new ToolException('Each involvement ADD names its entity: accountId or accountName.');
        }
        List<Account> matches = [SELECT Id, Name FROM Account WHERE Name = :ic.accountName WITH USER_MODE LIMIT 5];
        if (matches.isEmpty()) {
            throw new ToolException(
                'No account named "' + ic.accountName + '" exists in this org. The name must match exactly; ' +
                'create the account first if the entity is genuinely new to the bank.'
            );
        }
        if (matches.size() > 1) {
            List<String> ids = new List<String>();
            for (Account a : matches) {
                ids.add(String.valueOf(a.Id));
            }
            throw new ToolException(
                'This org carries ' + matches.size() + ' accounts named "' + ic.accountName +
                '". Supply accountId to settle which one: ' + String.join(ids, ', ') + '.'
            );
        }
        ic.accountId = matches[0].Id;
        ic.accountName = matches[0].Name;
    }

    /** Resolves the EXACT involvement row a REMOVE excludes, on the target parent. */
    private static void resolveRemoval(InvolvementChange ic, String targetName) {
        List<LLC_BI__Legal_Entities__c> rows;
        if (ic.accountId != null) {
            rows = [
                SELECT Id, LLC_BI__Account__c, LLC_BI__Account__r.Name, LLC_BI__Borrower_Type__c, LLC_BI__Ownership__c
                FROM LLC_BI__Legal_Entities__c
                WHERE LLC_BI__Loan__c = :ic.targetLoanId AND LLC_BI__Account__c = :ic.accountId
                WITH USER_MODE
            ];
        } else if (String.isNotBlank(ic.accountName)) {
            rows = [
                SELECT Id, LLC_BI__Account__c, LLC_BI__Account__r.Name, LLC_BI__Borrower_Type__c, LLC_BI__Ownership__c
                FROM LLC_BI__Legal_Entities__c
                WHERE LLC_BI__Loan__c = :ic.targetLoanId AND LLC_BI__Account__r.Name = :ic.accountName
                WITH USER_MODE
            ];
        } else {
            throw new ToolException('Each involvement REMOVE names its entity: accountId or accountName.');
        }
        if (String.isNotBlank(ic.role)) {
            List<LLC_BI__Legal_Entities__c> narrowed = new List<LLC_BI__Legal_Entities__c>();
            for (LLC_BI__Legal_Entities__c r : rows) {
                if (r.LLC_BI__Borrower_Type__c == ic.role) {
                    narrowed.add(r);
                }
            }
            rows = narrowed;
        }
        if (rows.isEmpty()) {
            throw new ToolException(
                (ic.accountName != null ? ic.accountName : String.valueOf(ic.accountId)) +
                (String.isBlank(ic.role) ? '' : ' (' + ic.role + ')') +
                ' is not involved on ' + targetName + ', so there is nothing to remove. The structure the clone starts from is the parent\'s own.'
            );
        }
        if (rows.size() > 1) {
            List<String> roles = new List<String>();
            for (LLC_BI__Legal_Entities__c r : rows) {
                roles.add(r.LLC_BI__Borrower_Type__c);
            }
            throw new ToolException(
                rows[0].LLC_BI__Account__r.Name + ' is involved on ' + targetName + ' under ' + rows.size() +
                ' roles (' + String.join(roles, ', ') + '). Name the role so exactly one row is excluded.'
            );
        }
        ic.sourceRowId = rows[0].Id;
        ic.accountId = rows[0].LLC_BI__Account__c;
        ic.accountName = rows[0].LLC_BI__Account__r.Name;
        ic.role = rows[0].LLC_BI__Borrower_Type__c;
        ic.ownership = rows[0].LLC_BI__Ownership__c;
    }

    /**
     * A cap on each carry-exclusion list, and it is a governor cap rather than a policy one: each
     * entry resolves its exact row with its own query, and a plan naming dozens of removals is a
     * different conversation from a modification.
     */
    private static final Integer EXCLUSION_MAX = 10;

    /**
     * Reads an id out of the request and refuses a malformed one BY NAME rather than letting
     * Id.valueOf throw a platform exception the banker cannot read.
     */
    private static Id exclusionId(Object raw, String fieldName) {
        if (raw == null || String.isBlank(String.valueOf(raw))) {
            return null;
        }
        try {
            return Id.valueOf(String.valueOf(raw));
        } catch (Exception e) {
            throw new ToolException('"' + String.valueOf(raw) + '" is not a Salesforce id, so it cannot be a ' + fieldName + '.');
        }
    }

    /* ---------------------------------------------------------------- the label target

       A NET-NEW FACILITY HAS NO ID UNTIL EXECUTE TIME (founder, 2026-09-03). A covenant, a party, a
       pledge, a fee or a field change staged onto a facility this same plan is CREATING therefore
       cannot name it by id: it names it by LABEL, and the execute leg resolves the label to the id
       it minted. This is the only forward reference in the package and it is deliberately narrow.

       The arms that take one are the ADDS. A carry exclusion is refused on a label by construction
       and needs no check: a new facility carries no junction for the new version to leave behind,
       so there is nothing there to exclude. */

    /**
     * The label an arm entry targets, or null where it targets a facility by id.
     *
     * @param raw The caller's targetLoanId, which may be an id, a label or nothing.
     * @param newFacilities The net-new facilities this plan creates.
     * @param what The arm being staged, for the banker copy.
     * @return The canonical label, or null.
     */
    private static String armLabel(Object raw, List<C360NewFacilities.NewFacility> newFacilities, String what) {
        String label = C360NewFacilities.canonicalLabel(raw);
        if (label == null) {
            return null;
        }
        C360NewFacilities.byLabel(label, newFacilities, what);
        return label;
    }

    /** How the plan names an arm's target, whether it is a booked member or one this plan creates. */
    private static String armTargetName(
        Id targetLoanId,
        String targetNewLabel,
        Map<Id, LLC_BI__Loan__c> facilityById,
        List<C360NewFacilities.NewFacility> newFacilities
    ) {
        if (targetNewLabel == null) {
            return facilityById.get(targetLoanId).Name;
        }
        return targetNewLabel + ', ' + C360NewFacilities.phrase(
            C360NewFacilities.byLabel(targetNewLabel, newFacilities, 'plan step')
        );
    }

    /** One dedupe bucket per target, whichever of the two shapes the target has. */
    private static String targetKey(Id targetLoanId, String targetNewLabel) {
        return targetNewLabel == null ? String.valueOf(targetLoanId) : targetNewLabel;
    }

    /** The target facility for one exclusion entry, with the same rule the other arms use. */
    private static Id exclusionTarget(Object raw, List<LLC_BI__Loan__c> facilities, Map<Id, LLC_BI__Loan__c> byId, String what) {
        Id targetId = exclusionId(raw, 'targetLoanId');
        if (targetId == null) {
            if (facilities.size() != 1) {
                throw new ToolException('targetLoanId is required on each ' + what + ' when more than one facility is selected.');
            }
            return facilities[0].Id;
        }
        if (!byId.containsKey(targetId)) {
            throw new ToolException(
                'A ' + what + ' targets facility ' + targetId + ', which is not one of the selected facilities. ' +
                'This plan can only touch a facility it is versioning.'
            );
        }
        return targetId;
    }

    /**
     * Parses and RESOLVES the covenant carry exclusions.
     *
     * The doctrine, and the reason this arm exists at all: on a modification nothing is deleted on
     * the booked loan. The banker who says "remove the Minimum Liquidity covenant from the line"
     * means the new version should not carry it, and the correct nCino instrument is the CARRY
     * DIFF, exactly as it already is for involvements. So this resolves the EXACT
     * LLC_BI__Loan_Covenant__c row on the target PARENT at stage time, so the banker confirms a
     * named covenant rather than a description, and execute simply does not replicate that row.
     *
     * An entry names the covenant (`covenantId`) or the junction itself (`junctionId`). An id that
     * resolves to no junction on that facility is refused BY NAME: the facility does not carry that
     * covenant, and "nothing to remove" is an answer, never a silent no-op.
     */
    private static List<CovenantExclusion> parseCovenantExclusions(Request req, List<LLC_BI__Loan__c> facilities) {
        List<CovenantExclusion> out = new List<CovenantExclusion>();
        if (String.isBlank(req.covenantExclusionsJson)) {
            return out;
        }
        List<Object> raw;
        try {
            raw = (List<Object>) JSON.deserializeUntyped(req.covenantExclusionsJson);
        } catch (Exception e) {
            throw new ToolException('covenantExclusionsJson could not be read as a JSON list: ' + e.getMessage());
        }
        if (raw.size() > EXCLUSION_MAX) {
            throw new ToolException(
                'This plan names ' + raw.size() + ' covenant exclusions. ' + EXCLUSION_MAX +
                ' is the cap: each one resolves its own junction row, and a plan removing more than that is a ' +
                'restructure rather than a modification.'
            );
        }
        Map<Id, LLC_BI__Loan__c> byId = new Map<Id, LLC_BI__Loan__c>(facilities);
        Set<Id> seen = new Set<Id>();
        for (Object o : raw) {
            Map<String, Object> m = (Map<String, Object>) o;
            CovenantExclusion ce = new CovenantExclusion();
            Id covenantId = exclusionId(m.get('covenantId'), 'covenant id');
            Id junctionId = exclusionId(m.get('junctionId'), 'covenant junction id');
            if (covenantId == null && junctionId == null) {
                throw new ToolException('Each covenant exclusion names what is not carried: covenantId or junctionId.');
            }
            ce.targetLoanId = exclusionTarget(m.get('targetLoanId'), facilities, byId, 'covenant exclusion');
            resolveCovenantExclusion(ce, covenantId, junctionId, byId.get(ce.targetLoanId).Name);
            if (seen.contains(ce.junctionId)) {
                throw new ToolException(
                    ce.covenantName + ' is named twice in this plan\'s covenant exclusions. One junction, one exclusion.'
                );
            }
            seen.add(ce.junctionId);
            out.add(ce);
        }
        return out;
    }

    /** Resolves the EXACT covenant junction a carry exclusion skips, on the target parent. */
    private static void resolveCovenantExclusion(CovenantExclusion ce, Id covenantId, Id junctionId, String targetName) {
        List<LLC_BI__Loan_Covenant__c> rows;
        try {
            if (junctionId != null) {
                rows = [
                    SELECT Id, LLC_BI__Loan__c, LLC_BI__Covenant2__c, LLC_BI__Covenant2__r.Name,
                           LLC_BI__Covenant2__r.LLC_BI__Covenant_Type__r.Name,
                           LLC_BI__Covenant2__r.LLC_BI__Financial_Indicator_Value__c
                    FROM LLC_BI__Loan_Covenant__c
                    WHERE Id = :junctionId AND LLC_BI__Loan__c = :ce.targetLoanId
                    WITH USER_MODE
                ];
            } else {
                rows = [
                    SELECT Id, LLC_BI__Loan__c, LLC_BI__Covenant2__c, LLC_BI__Covenant2__r.Name,
                           LLC_BI__Covenant2__r.LLC_BI__Covenant_Type__r.Name,
                           LLC_BI__Covenant2__r.LLC_BI__Financial_Indicator_Value__c
                    FROM LLC_BI__Loan_Covenant__c
                    WHERE LLC_BI__Covenant2__c = :covenantId AND LLC_BI__Loan__c = :ce.targetLoanId
                    WITH USER_MODE
                ];
            }
        } catch (QueryException e) {
            throw new ToolException(
                String.valueOf(junctionId == null ? covenantId : junctionId) +
                ' is not an id this org can read as a covenant junction on ' + targetName + '.'
            );
        }
        if (rows.isEmpty()) {
            throw new ToolException(
                (junctionId == null
                    ? 'Covenant ' + covenantId + ' is not attached to ' + targetName
                    : 'Covenant junction ' + junctionId + ' is not on ' + targetName) +
                ', so there is nothing for the new version to leave behind. The clone starts from what the parent ' +
                'carries today, and the parent does not carry this one. A covenant that reads at relationship level ' +
                'has no loan junction at all, which is exactly this answer.'
            );
        }
        if (rows.size() > 1) {
            List<String> ids = new List<String>();
            for (LLC_BI__Loan_Covenant__c j : rows) {
                ids.add(String.valueOf(j.Id));
            }
            throw new ToolException(
                targetName + ' carries ' + rows.size() + ' junctions for this covenant. Name the junction with ' +
                'junctionId so exactly one is excluded: ' + String.join(ids, ', ') + '.'
            );
        }
        ce.junctionId = rows[0].Id;
        ce.covenantId = rows[0].LLC_BI__Covenant2__c;
        ce.covenantName = rows[0].LLC_BI__Covenant2__r == null ? String.valueOf(rows[0].LLC_BI__Covenant2__c) : rows[0].LLC_BI__Covenant2__r.Name;
        ce.typeName = rows[0].LLC_BI__Covenant2__r != null && rows[0].LLC_BI__Covenant2__r.LLC_BI__Covenant_Type__r != null
            ? rows[0].LLC_BI__Covenant2__r.LLC_BI__Covenant_Type__r.Name : null;
        ce.threshold = rows[0].LLC_BI__Covenant2__r == null ? null : rows[0].LLC_BI__Covenant2__r.LLC_BI__Financial_Indicator_Value__c;
    }

    /**
     * Parses and RESOLVES the pledge carry exclusions: the collateral counterpart, same doctrine.
     *
     * An entry names the pledge (`pledgeId`) or the asset (`collateralId`). The asset itself and its
     * LLC_BI__Account_Collateral__c ownership junction are RELATIONSHIP records and are never
     * touched here: what fails to travel is the per-facility pledge alone.
     */
    private static List<PledgeExclusion> parsePledgeExclusions(Request req, List<LLC_BI__Loan__c> facilities) {
        List<PledgeExclusion> out = new List<PledgeExclusion>();
        if (String.isBlank(req.pledgeExclusionsJson)) {
            return out;
        }
        List<Object> raw;
        try {
            raw = (List<Object>) JSON.deserializeUntyped(req.pledgeExclusionsJson);
        } catch (Exception e) {
            throw new ToolException('pledgeExclusionsJson could not be read as a JSON list: ' + e.getMessage());
        }
        if (raw.size() > EXCLUSION_MAX) {
            throw new ToolException(
                'This plan names ' + raw.size() + ' pledge exclusions. ' + EXCLUSION_MAX +
                ' is the cap: each one resolves its own pledge row, and a plan releasing more than that is a ' +
                'collateral restructure rather than a modification.'
            );
        }
        Map<Id, LLC_BI__Loan__c> byId = new Map<Id, LLC_BI__Loan__c>(facilities);
        Set<Id> seen = new Set<Id>();
        for (Object o : raw) {
            Map<String, Object> m = (Map<String, Object>) o;
            PledgeExclusion pe = new PledgeExclusion();
            Id pledgeId = exclusionId(m.get('pledgeId'), 'pledge id');
            Id collateralId = exclusionId(m.get('collateralId'), 'collateral id');
            if (pledgeId == null && collateralId == null) {
                throw new ToolException('Each pledge exclusion names what is not carried: pledgeId or collateralId.');
            }
            pe.targetLoanId = exclusionTarget(m.get('targetLoanId'), facilities, byId, 'pledge exclusion');
            resolvePledgeExclusion(pe, pledgeId, collateralId, byId.get(pe.targetLoanId).Name);
            if (seen.contains(pe.pledgeId)) {
                throw new ToolException(
                    pe.assetLabel + ' is named twice in this plan\'s pledge exclusions. One pledge, one exclusion.'
                );
            }
            seen.add(pe.pledgeId);
            out.add(pe);
        }
        return out;
    }

    /** Resolves the EXACT pledge row a carry exclusion skips, on the target parent. */
    private static void resolvePledgeExclusion(PledgeExclusion pe, Id pledgeId, Id collateralId, String targetName) {
        List<LLC_BI__Loan_Collateral2__c> rows;
        try {
            if (pledgeId != null) {
                rows = [
                    SELECT Id, LLC_BI__Loan__c, LLC_BI__Collateral__c, LLC_BI__Collateral__r.Name,
                           LLC_BI__Collateral__r.LLC_BI__Description__c, LLC_BI__Amount_Pledged__c
                    FROM LLC_BI__Loan_Collateral2__c
                    WHERE Id = :pledgeId AND LLC_BI__Loan__c = :pe.targetLoanId
                    WITH USER_MODE
                ];
            } else {
                rows = [
                    SELECT Id, LLC_BI__Loan__c, LLC_BI__Collateral__c, LLC_BI__Collateral__r.Name,
                           LLC_BI__Collateral__r.LLC_BI__Description__c, LLC_BI__Amount_Pledged__c
                    FROM LLC_BI__Loan_Collateral2__c
                    WHERE LLC_BI__Collateral__c = :collateralId AND LLC_BI__Loan__c = :pe.targetLoanId
                    WITH USER_MODE
                ];
            }
        } catch (QueryException e) {
            throw new ToolException(
                String.valueOf(pledgeId == null ? collateralId : pledgeId) +
                ' is not an id this org can read as a pledge on ' + targetName + '.'
            );
        }
        if (rows.isEmpty()) {
            throw new ToolException(
                (pledgeId == null
                    ? 'Asset ' + collateralId + ' is not pledged to ' + targetName
                    : 'Pledge ' + pledgeId + ' is not on ' + targetName) +
                ', so there is nothing for the new version to leave behind. The clone starts from the security the ' +
                'parent holds today, and this is not part of it.'
            );
        }
        if (rows.size() > 1) {
            List<String> ids = new List<String>();
            for (LLC_BI__Loan_Collateral2__c pl : rows) {
                ids.add(String.valueOf(pl.Id));
            }
            throw new ToolException(
                targetName + ' carries ' + rows.size() + ' pledges of this asset. Name the pledge with pledgeId so ' +
                'exactly one is excluded: ' + String.join(ids, ', ') + '.'
            );
        }
        pe.pledgeId = rows[0].Id;
        pe.collateralId = rows[0].LLC_BI__Collateral__c;
        pe.amountPledged = rows[0].LLC_BI__Amount_Pledged__c;
        pe.assetLabel = assetLabelOf(rows[0]);
    }

    /** The asset as the org names it: its description where it has one, else its autonumber. */
    private static String assetLabelOf(LLC_BI__Loan_Collateral2__c pledge) {
        if (pledge.LLC_BI__Collateral__r == null) {
            return String.valueOf(pledge.LLC_BI__Collateral__c);
        }
        return String.isNotBlank(pledge.LLC_BI__Collateral__r.LLC_BI__Description__c)
            ? pledge.LLC_BI__Collateral__r.LLC_BI__Description__c
            : pledge.LLC_BI__Collateral__r.Name;
    }

    /**
     * Parses and RESOLVES the covenant associations: attaching an EXISTING covenant to a facility.
     *
     * P1, the founder's correction of 2026-09-02. "It already runs at relationship level, nothing
     * needs putting up twice" is wrong: a relationship-level covenant carries NO loan junction, so
     * it is not associated to the loan at all. Dedupe is per junction, and when a covenant is not on
     * the loan the honest offer is three instruments, of which this is the middle one.
     *
     * Everything is checked here so the banker confirms a real record: the covenant must exist, it
     * must belong to the BORROWER on this package (a covenant from another relationship is refused
     * rather than quietly cross-linked), and it must not already be attached to the target, because
     * the carry will bring an attached one onto the clone by itself and a second junction would be
     * a duplicate nobody asked for.
     */
    public static List<CovenantAttach> parseCovenantAttaches(
        Request req,
        List<LLC_BI__Loan__c> facilities,
        List<C360NewFacilities.NewFacility> newFacilities,
        List<String> warnings
    ) {
        List<CovenantAttach> out = new List<CovenantAttach>();
        if (String.isBlank(req.covenantAttachesJson)) {
            return out;
        }
        List<Object> raw;
        try {
            raw = (List<Object>) JSON.deserializeUntyped(req.covenantAttachesJson);
        } catch (Exception e) {
            throw new ToolException('covenantAttachesJson could not be read as a JSON list: ' + e.getMessage());
        }
        if (raw.size() > EXCLUSION_MAX) {
            throw new ToolException(
                'This plan associates ' + raw.size() + ' existing covenants. ' + EXCLUSION_MAX + ' is the cap.'
            );
        }
        Map<Id, LLC_BI__Loan__c> byId = new Map<Id, LLC_BI__Loan__c>(facilities);
        Id borrowerId = facilities[0].LLC_BI__Account__c;
        Set<String> seen = new Set<String>();
        for (Object o : raw) {
            Map<String, Object> m = (Map<String, Object>) o;
            CovenantAttach ca = new CovenantAttach();
            ca.covenantId = exclusionId(m.get('covenantId'), 'covenant id');
            if (ca.covenantId == null) {
                throw new ToolException(
                    'Each covenant association names the covenant it associates: covenantId. A covenant to be ' +
                    'CREATED goes in covenantAddsJson instead, with its type and threshold.'
                );
            }
            ca.targetNewLabel = armLabel(m.get('targetLoanId'), newFacilities, 'covenant association');
            ca.targetLoanId = ca.targetNewLabel == null
                ? exclusionTarget(m.get('targetLoanId'), facilities, byId, 'covenant association')
                : null;
            // resolveCovenantAttach proves the covenant belongs to this borrower and is not already
            // on the target. On a new facility the second half is true by construction: the query it
            // runs against a null loan id returns nothing, which is the right answer.
            resolveCovenantAttach(ca, borrowerId, armTargetName(ca.targetLoanId, ca.targetNewLabel, byId, newFacilities));
            String pairKey = String.valueOf(ca.covenantId) + ':' + String.valueOf(ca.targetLoanId);
            if (seen.contains(pairKey)) {
                throw new ToolException(
                    ca.covenantName + ' is associated twice to the same facility in this plan. One junction, once.'
                );
            }
            seen.add(pairKey);
            out.add(ca);
        }
        return out;
    }

    /** Resolves an association's covenant and refuses everything that would make the junction wrong. */
    private static void resolveCovenantAttach(CovenantAttach ca, Id borrowerId, String targetName) {
        List<LLC_BI__Covenant2__c> covs;
        try {
            covs = [
                SELECT Id, Name, LLC_BI__Account__c, LLC_BI__Account__r.Name, LLC_BI__Active__c,
                       LLC_BI__Financial_Indicator_Value__c, Acnpex_Operator__c,
                       LLC_BI__Covenant_Type__r.Name
                FROM LLC_BI__Covenant2__c WHERE Id = :ca.covenantId WITH USER_MODE LIMIT 1
            ];
        } catch (QueryException e) {
            throw new ToolException(String.valueOf(ca.covenantId) + ' is not an id this org can read as a covenant.');
        }
        if (covs.isEmpty()) {
            throw new ToolException(
                'No covenant exists with id ' + ca.covenantId + '. Associate a covenant the read returned, or create ' +
                'a new one with covenantAddsJson.'
            );
        }
        LLC_BI__Covenant2__c cov = covs[0];
        if (cov.LLC_BI__Account__c != borrowerId) {
            throw new ToolException(
                'Covenant ' + cov.Name + ' belongs to ' +
                (cov.LLC_BI__Account__r == null ? String.valueOf(cov.LLC_BI__Account__c) : cov.LLC_BI__Account__r.Name) +
                ', not to the borrower on this package. A covenant is not moved between relationships by a junction.'
            );
        }
        Integer already = [
            SELECT COUNT() FROM LLC_BI__Loan_Covenant__c
            WHERE LLC_BI__Loan__c = :ca.targetLoanId AND LLC_BI__Covenant2__c = :ca.covenantId
            WITH USER_MODE
        ];
        if (already > 0) {
            throw new ToolException(
                targetName + ' is ALREADY associated to covenant ' + cov.Name +
                ', and the carry brings that junction onto the clone by itself. A second junction would be a ' +
                'duplicate. Nothing needs doing for this covenant on this facility.'
            );
        }
        ca.covenantName = cov.Name;
        ca.typeName = cov.LLC_BI__Covenant_Type__r == null ? null : cov.LLC_BI__Covenant_Type__r.Name;
        ca.threshold = cov.LLC_BI__Financial_Indicator_Value__c;
        ca.operator = cov.Acnpex_Operator__c;
    }

    /** Resolves the covenant type by id or exact name against the org's own catalog. */
    private static void resolveCovenantType(CovenantAdd a) {
        if (a.typeId != null) {
            List<LLC_BI__Covenant_Type__c> t = [
                SELECT Id, Name FROM LLC_BI__Covenant_Type__c WHERE Id = :a.typeId WITH USER_MODE LIMIT 1
            ];
            if (t.isEmpty()) {
                throw new ToolException('No covenant type exists with id ' + a.typeId + '.');
            }
            a.typeName = t[0].Name;
            return;
        }
        if (String.isBlank(a.typeName)) {
            throw new ToolException('Each covenant add names its type: typeName or typeId.');
        }
        List<LLC_BI__Covenant_Type__c> matches = [
            SELECT Id, Name FROM LLC_BI__Covenant_Type__c WHERE Name = :a.typeName WITH USER_MODE
        ];
        if (matches.isEmpty()) {
            throw new ToolException(
                'No covenant type named "' + a.typeName + '" exists in this org\'s catalog. The name must match the catalog exactly.'
            );
        }
        if (matches.size() > 1) {
            List<String> ids = new List<String>();
            for (LLC_BI__Covenant_Type__c t : matches) {
                ids.add(String.valueOf(t.Id));
            }
            throw new ToolException(
                'This org carries ' + matches.size() + ' covenant types named "' + a.typeName +
                '". Supply typeId to settle which one: ' + String.join(ids, ', ') + '.'
            );
        }
        a.typeId = matches[0].Id;
        a.typeName = matches[0].Name;
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
