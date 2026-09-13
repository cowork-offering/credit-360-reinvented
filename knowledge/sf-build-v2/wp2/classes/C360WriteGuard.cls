/**
 * C360WriteGuard - the A33.3.1 per-action transition allowlist, enforced in Apex.
 *
 * A33.3.1 is explicit that this is the primary fence for Case, Collateral Valuation and
 * Review: withholding LLC_BI__Exclude_Validation fences Loan stage movement and nothing
 * else, so those three objects need their own wall. "Anything not on this table is refused
 * by the tool, not merely absent from the UI."
 *
 * Every write in this package passes through assertAllowed(), including the ones that are
 * refused, so a refusal is provable by calling the same entry point the tool calls rather
 * than by the absence of a code path.
 *
 * The allowlist is hardcoded deliberately. It is a control, not a business threshold: A26.2
 * bans hardcoded business literals, and a state fence is not one. Bank thresholds live in the
 * policy pack (A33.2.5a) and never appear here.
 *
 * DELETES (added 0.9.23, the version lifecycle). `assertAllowed` refuses OP_DELETE on every object
 * it knows, unchanged and unconditionally. The one action in this package that deletes reaches its
 * deletes through `assertAllowedForTool`, against a SEPARATE per-tool delete table, so the sentence
 * "no object may be deleted through the object gate" stays literally true and the only way to
 * remove a record is to be named, by action and by object, on TOOL_DELETE_OBJECTS.
 */
public with sharing class C360WriteGuard {

    /** Raised when a tool attempts a write the allowlist does not permit. */
    public class GuardException extends Exception {}

    public static final String OBJ_CASE = 'Case';
    public static final String OBJ_VALUATION = 'LLC_BI__Collateral_Valuation__c';
    public static final String OBJ_REVIEW = 'LLC_BI__Review__c';
    // Wave 2 additions. Every state below is probe-backed in PROBE-LEDGER wave 3.
    public static final String OBJ_LOAN = 'LLC_BI__Loan__c';
    public static final String OBJ_RISK_RATING = 'LLC_BI__Annual_Review__c';
    public static final String OBJ_COVENANT_COMPLIANCE = 'LLC_BI__Covenant_Compliance2__c';
    public static final String OBJ_PRODUCT_PACKAGE = 'LLC_BI__Product_Package__c';
    public static final String OBJ_INVOLVEMENT = 'LLC_BI__Legal_Entities__c';
    /**
     * THE LOAN DETAIL, and the ONE field this package writes on it (2026-09-03).
     *
     * `LLC_BI__Primary_Loan_Purpose__c` lives here and nowhere else: the Loan
     * itself carries no primary-purpose field at all. nCino CREATES this record
     * from an after-commit flow, so creation is never ours; what is ours is a
     * single-field update, and the forbidden list below is what makes that
     * literal rather than a convention.
     */
    public static final String OBJ_LOAN_DETAIL = 'LLC_BI__Loan_Detail__c';

    public static final String OP_CREATE = 'create';
    public static final String OP_UPDATE = 'update';
    public static final String OP_DELETE = 'delete';
    /**
     * The versioning carry (2026-08-30). nCino's credit-action engine copies NO junction rows in
     * this org: the related-lists copy configuration only ever fed the retired classic wizard's
     * checklist (verified live: all eight defaults on, engine run, zero rows landed, no copy job
     * enqueued). Package methodology requires every member's junction graph to carry onto the new
     * version, so the execute tool composes the carry itself. OP_CARRY exists so that composition
     * passes THIS gate like every other write, under its own doctrine: it may only REPLICATE rows
     * that already exist on a version parent, onto a clone the same transaction created, with the
     * anchor lookups retargeted and nothing else authored.
     */
    public static final String OP_CARRY = 'carry';

    // CARRY EXCLUSIONS NEED NO OPERATION OF THEIR OWN, and that is the whole point of them.
    //
    // A banker who says "remove this covenant from the loan" on a modification is not asking for a
    // delete and not asking for a detach: the booked facility keeps everything it has, and the new
    // VERSION simply starts without the named row. Involvements have worked this way since
    // 2026-08-30; covenants and pledges joined them on 2026-09-02 (founder P2). The carry writes
    // FEWER rows than it otherwise would, and writing fewer rows needs no permission: every row it
    // does write still passes OP_CARRY with the same fields it always did.
    //
    // So there is deliberately nothing here for an exclusion, and there must never be. A guard
    // entry for "remove" would be a doorway to a delete, which is fenced on every object in this
    // package. If a future arm ever needs to un-write something on a BOOKED record, that is a
    // founder decision and a new fence, not an extension of this one.

    public static final String OBJ_LOAN_COVENANT = 'LLC_BI__Loan_Covenant__c';
    public static final String OBJ_PLEDGE = 'LLC_BI__Loan_Collateral2__c';
    public static final String OBJ_PLEDGE_AGGREGATE = 'LLC_BI__Loan_Collateral_Aggregate__c';
    public static final String OBJ_COVENANT = 'LLC_BI__Covenant2__c';
    public static final String OBJ_ACCOUNT_COVENANT = 'LLC_BI__Account_Covenant__c';
    public static final String OBJ_FEE = 'LLC_BI__Fee__c';
    public static final String OBJ_PRICING_STREAM = 'LLC_BI__Pricing_Stream__c';
    public static final String OBJ_COLLATERAL = 'LLC_BI__Collateral__c';
    public static final String OBJ_ACCOUNT_COLLATERAL = 'LLC_BI__Account_Collateral__c';
    public static final String OBJ_POLICY_EXCEPTION = 'LLC_BI__Policy_Exception__c';

    /**
     * THE THREE OBJECTS THAT APPEAR HERE ONLY TO BE DELETED (0.9.23, the version lifecycle).
     *
     * The renewal chain junction and the two pricing components are on no create table and on no
     * update table, and they never will be: nothing in this package authors a chain row, and the
     * pricing components are nCino's own clone output. They are named because `discard-version` has
     * to take them away, and a delete names its object out loud like every other write does. They
     * are deliberately kept OUT of KNOWN_OBJECTS, so a create or an update on any of them still
     * reads "no transition allowlist exists" exactly as it did before this table existed.
     */
    public static final String OBJ_LOAN_RENEWAL = 'LLC_BI__LoanRenewal__c';
    public static final String OBJ_PRICING_RATE_COMPONENT = 'LLC_BI__Pricing_Rate_Component__c';
    public static final String OBJ_PRICING_PAYMENT_COMPONENT = 'LLC_BI__Pricing_Payment_Component__c';

    /** The junction graph OP_CARRY may replicate, and nothing else. */
    // Pricing streams are DELIBERATELY absent: nCino's engine carries them itself on every
    // credit action (observed live 2026-08-31) and a doorway here produced duplicates.
    // Policy exceptions are absent too, and that is a STATEMENT rather than an omission: an
    // exception records what the bank decided about a facility as it stands, and replicating one
    // onto a version the bank has not approved would restate a decision nobody took about the new
    // terms. A clone therefore carries only the exceptions this plan authors on it, and the parent
    // keeps its own. Carrying them is a founder call, not a gap to close quietly.
    private static final Set<String> CARRY_OBJECTS = new Set<String>{
        OBJ_LOAN_COVENANT, OBJ_PLEDGE, OBJ_PLEDGE_AGGREGATE, OBJ_INVOLVEMENT, OBJ_FEE
    };

    /**
     * Fields OP_CARRY must never write even as copies: the mutually-exclusive contingent amount
     * (15v), the formula flags, and every rollup the org derives itself.
     */
    private static final Map<String, Set<String>> CARRY_FORBIDDEN = new Map<String, Set<String>>{
        OBJ_LOAN_COVENANT => new Set<String>(),
        OBJ_PLEDGE => new Set<String>{
            'LLC_BI__Advance_Rate__c', 'LLC_BI__Current_Lendable_Value__c', 'LLC_BI__Collateral_Value__c',
            'LLC_BI__Total_Pledged_Rollup_Value__c', 'LLC_BI__Total_Pledged_Rollup_Lendable_Value__c'
        },
        OBJ_PLEDGE_AGGREGATE => new Set<String>(),
        OBJ_INVOLVEMENT => new Set<String>{
            'LLC_BI__Is_Borrower__c', 'LLC_BI__Is_Guarantor__c', 'LLC_BI__Is_CoBorrower__c',
            'LLC_BI__Is_Grantor__c', 'LLC_BI__Is_Related_Entity__c', 'LLC_BI__Contingent_Amount__c'
        },
        OBJ_FEE => new Set<String>(),
        // The lookupKey is nCino's own dedupe key: copying one across records risks nCino treating
        // the replica as the SAME stream. OwnerId defaults to the running user rather than pinning
        // the clone to the original's owner. (Recon 2026-08-31.)
        OBJ_PRICING_STREAM => new Set<String>{ 'LLC_BI__lookupKey__c', 'OwnerId' }
    };

    /**
     * The only states each object may be CREATED with (A33.3.1). A field present here must
     * carry exactly the listed value; an empty map means the object has no state fence on
     * create, only the forbidden-field list below.
     */
    private static final Map<String, Map<String, Set<String>>> CREATE_STATES = new Map<String, Map<String, Set<String>>>{
        OBJ_CASE => new Map<String, Set<String>>{ 'Status' => new Set<String>{ 'New' } },
        OBJ_REVIEW => new Map<String, Set<String>>{ 'LLC_BI__Status__c' => new Set<String>{ 'In Progress' } },
        OBJ_VALUATION => new Map<String, Set<String>>(),
        // Probe 5: a six-field payload at Qualification/Open passed 21 validation rules.
        OBJ_LOAN => new Map<String, Set<String>>{
            'LLC_BI__Stage__c' => new Set<String>{ 'Qualification' },
            'LLC_BI__Status__c' => new Set<String>{ 'Open' },
            'LLC_BI__isRenewal__c' => new Set<String>{ 'false' },
            'LLC_BI__Is_Modification__c' => new Set<String>{ 'false' }
        },
        // Probe 4: status defaults to 'Not Approved', which reads as a DECISION rather than as an
        // absent value. Worse than Review's null, so the create state is mandatory here.
        OBJ_RISK_RATING => new Map<String, Set<String>>{ 'LLC_BI__Status__c' => new Set<String>{ 'In Review' } },
        // Package creation is name and account only. Live SOQL over this org: all 12 most recent
        // packages carry a NULL RecordTypeId, including the ones nCino's own wizard created, and
        // 516 of 518 follow the "<Account> - <M/D/YYYY> - PP" convention. We match the org rather
        // than inventing a shape, and we set no stage or status: PPCacheCreation and
        // ProductPackageBaselineCaptureTrigger own what happens next and swallow their own failures.
        OBJ_PRODUCT_PACKAGE => new Map<String, Set<String>>(),
        // Borrowing structure. The creation wave files the Borrower row; the modification arm
        // (2026-08-30) amends the fuller structure — guarantors, co-borrowers, related entities —
        // always on a CLONE, never on a booked facility. Grantor and Contractor stay refused:
        // they are collateral and construction semantics, not borrowing structure. The role IS
        // the flag on this object: the Is_* fields are formulas derived from Borrower_Type.
        OBJ_INVOLVEMENT => new Map<String, Set<String>>{
            'LLC_BI__Borrower_Type__c' => new Set<String>{
                'Borrower', 'Co-Borrower', 'Guarantor', 'Limited Guarantor', 'Related Entity'
            }
        },
        // Net-new covenant (2026-08-30). SAFE by live probe: inserting a Covenant2 plus its loan
        // junction mints NO compliance row, starts NO approval and sends NO email — the
        // unrecallable acnpex approval fires on COMPLIANCE create only, and nothing auto-mints
        // one from a covenant insert. A new covenant is born Pending (not yet evaluated) and
        // Active; the org's own review cycle owns every status after that.
        OBJ_COVENANT => new Map<String, Set<String>>{
            'LLC_BI__Covenant_Status__c' => new Set<String>{ 'Pending' },
            'LLC_BI__Active__c' => new Set<String>{ 'true' }
        },
        // The attach of a covenant to a facility. Doctrine, widened 2026-09-02 (founder P1): the
        // caller may attach a covenant this same transaction created, OR one the BORROWER on this
        // package already holds, and only ever to a modification clone this same transaction
        // created, never to a booked facility. Associating an existing covenant is the instrument
        // for a relationship-level covenant, which carries no loan junction and is therefore not on
        // the loan however it reads at relationship level; it is a junction create and nothing
        // else, so the covenant AMEND and DETACH fences are untouched. The gate fences the object;
        // the caller owns that scoping, exactly as with OP_CARRY.
        OBJ_LOAN_COVENANT => new Map<String, Set<String>>(),
        // The account association nCino's own UI mints beside every covenant (founder correction,
        // 2026-08-31): a covenant belongs to the borrower as well as to the facility, and 140 such
        // rows exist in this org on other relationships. Two required lookups, nothing else.
        OBJ_ACCOUNT_COVENANT => new Map<String, Set<String>>(),
        // A NET-NEW FEE on a modification clone (2026-08-31). SAFE by live probe: LLC_BI__Fee__c
        // carries only nCino's managed FeeTrigger — no CDC trigger, so a fee insert egresses
        // nothing (recon Task 3d) — and no ProcessDefinition targets it, so a create starts no
        // approval. A fee is born Active: an inactive fee is a fee nobody is charging, which is
        // not what "add a fee" means, and every fee this org holds carries Active.
        OBJ_FEE => new Map<String, Set<String>>{
            'LLC_BI__Status__c' => new Set<String>{ 'Active' }
        },
        // THE COLLATERAL CHAIN on a modification clone (2026-08-31), three objects that only ever
        // travel together. The asset is created, the ownership junction ties it to the borrower -
        // `LLC_BI__Collateral__c` has NO account lookup of any kind on this org, so that junction is
        // the only link there is - and the pledge attaches it to the clone.
        //
        // NO STATE FENCE ON THE ASSET OR THE OWNERSHIP. `LLC_BI__Collateral__c.LLC_BI__Status__c`
        // exists but its active values are not verified on this org, and a fence on a value that
        // turns out to be illegal refuses a legal write with an answer that reads like a bug. The
        // forbidden-field list below is what fences these two.
        OBJ_COLLATERAL => new Map<String, Set<String>>(),
        OBJ_ACCOUNT_COLLATERAL => new Map<String, Set<String>>(),
        // A pledge is born ACTIVE and Active: security nobody is claiming is not what pledging an
        // asset means, and every pledge this org holds carries both.
        OBJ_PLEDGE => new Map<String, Set<String>>{
            'LLC_BI__Pledged_Status__c' => new Set<String>{ 'Active' },
            'LLC_BI__Active__c' => new Set<String>{ 'true' }
        },
        // A POLICY EXCEPTION on a modification clone (2026-08-31). PROBED SAFE, and probed
        // precisely: of the 16 ProcessDefinition records in this org NONE targets this object, and
        // a three-insert rollback probe moved Limits.getEmailInvocations() by zero (recon Task 3d).
        // So a create starts no approval and sends no email.
        //
        // IT IS NOT FREE OF SIDE EFFECTS. The same probe moved Limits.getQueueableJobs() from 0 to
        // 3 - one per DML - because the org-local PolicyExceptionCDC trigger enqueues an
        // EventBridgeCallout that POSTs the serialised record to an external AWS endpoint. That is
        // data egress rather than an approval, and it is why the arm inserts the whole plan's
        // exceptions in ONE DML and the stage warnings say so out loud.
        //
        // TWO STATE FENCES. LLC_BI__Type__c is the object's ONLY required field and every one of
        // the 81 rows this org holds carries "Policy". LLC_BI__Status__c is fenced to the org's
        // whole picklist rather than to one value: waived, mitigated and unmitigated are three real
        // outcomes of logging an exception, and an allowlist that could express only one would
        // force the banker out of the tool with the decision unrecorded - the same reasoning that
        // put `Waived` on the covenant-compliance update set. The fence does require the status to
        // be PRESENT, which is the point: the org defaults it to Unmitigated, and a defaulted
        // Unmitigated reads as a decision nobody made.
        OBJ_POLICY_EXCEPTION => new Map<String, Set<String>>{
            'LLC_BI__Type__c' => new Set<String>{ 'Policy' },
            'LLC_BI__Status__c' => new Set<String>{ 'Waived', 'Mitigated', 'Unmitigated' }
        }
    };

    /**
     * Objects this wave may UPDATE, and the only field transitions permitted on each.
     * Key is object, then field, then the set of values that field may be moved TO.
     *
     * Probe 8 settled the covenant question from Flow metadata with zero writes:
     * acnpex_covenantApprovalProcess is recordTriggerType Create with filters [], so it fires on
     * CREATE ONLY and never on any update. An update-only tool therefore cannot start the bank's
     * approval chain by construction. That is why compliance records are update-only here and are
     * absent from CREATE_STATES entirely.
     */
    private static final Map<String, Map<String, Set<String>>> UPDATE_TRANSITIONS =
        new Map<String, Map<String, Set<String>>>{
            // The complete-status set is nCino's, read from the org: LLC_BI__Status__c offers
            // Compliant, Exception, In Progress, Pending and Waived, and `Waived` is one of the
            // three default Record Create Trigger Statuses. Waiving is a real outcome of a covenant
            // review, and an allowlist that could not express it forced the banker out of the tool
            // with the decision unrecorded. `Pending` and `In Progress` stay off: they are where a
            // row starts, never where a review leaves it. This org's compliance status picklist
            // carries no separate non-compliant value; a failed test is Exception plus a Reason for
            // Exception of Breached, which is why that field is fenced here too.
            OBJ_COVENANT_COMPLIANCE => new Map<String, Set<String>>{
                'LLC_BI__Status__c' => new Set<String>{ 'Compliant', 'Waived', 'Exception' },
                'LLC_BI__Reason_for_Exception__c' => new Set<String>{ 'Breached', 'Overdue' }
            },
            // A33.3.1 / A33.7 Q6: exactly one hop, and only after Loan Detail verification.
            // Probe 9 finding 2 proved this hop headlessly; Booked stays unreachable (LV06).
            OBJ_LOAN => new Map<String, Set<String>>{
                'LLC_BI__Stage__c' => new Set<String>{ 'Proposal' }
            },
            // Package versioning repair (2026-08-30). The credit-action engine names the new package
            // version itself and was observed to produce a blank account prefix ("- 8/30/2026 - PP",
            // shape probe, rolled back). The one package update this wave performs is the Name repair
            // to the org's own "<Account> - <M/D/YYYY> - PP" convention (516 of 518 packages follow
            // THE LOAN DETAIL takes ONE field and no state fence: the primary loan
            // purpose is a RESTRICTED picklist in this org, so the ORG refuses an
            // illegal value outright and pinning the list here would be a second,
            // staler copy of the same rule. Everything else on the object is on
            // the forbidden list below.
            OBJ_LOAN_DETAIL => new Map<String, Set<String>>(),
            // it). RecordTypeId, Stage and Status remain forbidden below; Name is free text, so no
            // state fence applies.
            OBJ_PRODUCT_PACKAGE => new Map<String, Set<String>>()
        };

    /**
     * Fields no tool of ours may write, whatever the value. Review record type is assigned by
     * the Review After Save flow (probe 3, PROBE-LEDGER); cm_Review_Stage__c is read and
     * labelled, never written, and its 'Approval' value is unreachable for anyone (RV01);
     * cm_Approved_Date__c belongs to the org's own approval path.
     */
    private static final Map<String, Set<String>> FORBIDDEN_FIELDS = new Map<String, Set<String>>{
        OBJ_REVIEW => new Set<String>{ 'RecordTypeId', 'cm_Review_Stage__c', 'cm_Approved_Date__c' },
        OBJ_VALUATION => new Set<String>{ 'LLC_BI__Lendable_Value__c' },
        OBJ_CASE => new Set<String>(),
        // Formula and rollup fields, plus the chain anchor A33.4.1 names that DOES NOT EXIST in
        // this org (probe 5 spec correction: LLC_BI__RootLoanId__c returns INVALID_FIELD).
        OBJ_LOAN => new Set<String>{
            'LLC_BI__hasRenewal__c', 'LLC_BI__Number_Of_Renewals__c', 'LLC_BI__RootLoanId__c'
        },
        // Probe 4: this object has NO RecordTypeId and NO OwnerId field at all, so an attempt to
        // set either fails at the platform. Final_Risk_Grade is a formula.
        OBJ_RISK_RATING => new Set<String>{
            'LLC_BI__Final_Risk_Grade__c', 'RecordTypeId', 'OwnerId'
        },
        // Set-once at creation, and creation is not ours. Writing the parent's effective date
        // corrupts the whole compliance schedule (PDI-00023403, unresolved).
        OBJ_COVENANT_COMPLIANCE => new Set<String>{
            'LLC_BI__Covenant__c', 'LLC_BI__Effective_Date__c'
        },
        // No record type: real packages in this org have none, and A33.4.3(d)'s Deal_Proposal
        // concern was moot (probe 9: only Master is available to the running profile anyway).
        // No stage or status either: those belong to the org's own package automation.
        OBJ_PRODUCT_PACKAGE => new Set<String>{
            'RecordTypeId', 'LLC_BI__Stage__c', 'LLC_BI__Status__c'
        },
        // The Is_* fields are FORMULAS derived from Borrower_Type (LESSONS 15u): writing one is
        // impossible and asking for it is a design error worth naming. Contingent Amount is
        // forbidden because it is mutually exclusive with Ownership on a single row and the VR's
        // only escape tests for a Household role value that does not exist in this org (15v).
        OBJ_INVOLVEMENT => new Set<String>{
            'LLC_BI__Is_Borrower__c', 'LLC_BI__Is_Guarantor__c', 'LLC_BI__Is_CoBorrower__c',
            'LLC_BI__Is_Grantor__c', 'LLC_BI__Is_Related_Entity__c', 'LLC_BI__Contingent_Amount__c'
        },
        // Evaluation outcomes and breach flags belong to the org's own covenant review cycle; a
        // tool that could author them could author compliance history. Templates are config.
        OBJ_COVENANT => new Set<String>{
            'LLC_BI__Breached__c', 'LLC_BI__Overdue__c', 'LLC_BI__Is_Template__c',
            'LLC_BI__Last_Evaluation_Date__c', 'LLC_BI__Last_Evaluation_Status__c', 'LLC_BI__Last_Evaluation_Value__c'
        },
        OBJ_LOAN_COVENANT => new Set<String>(),
        OBJ_ACCOUNT_COVENANT => new Set<String>(),
        // The child is nCino's: it creates the row and owns the loan lookup, the
        // application method it pre-fills, and every stage-driven field on it.
        // ONE field is this package's, and this list is the fence around that.
        OBJ_LOAN_DETAIL => new Set<String>{
            'LLC_BI__Loan__c', 'RecordTypeId', 'OwnerId', 'LLC_BI__Application_Method__c',
            'LLC_BI__Additional_Loan_Purposes__c'
        },
        // RecordTypeId is refused by the ORG, not merely by us: three Fee record types exist and
        // none is assigned to the integration user's profile, so an attempt returns
        // INVALID_CROSS_REFERENCE_KEY (recon Task 1, finding 1). The independent picklist
        // LLC_BI__Record_Type__c carries Fees / Costs / Adjustments and is set instead. Name is an
        // autonumber. Basis_Amount is what nCino's FeeTrigger DERIVES from the loan's commitment
        // for a percentage fee, and writing it would put a figure beside the one the org computed.
        OBJ_FEE => new Set<String>{ 'RecordTypeId', 'Name', 'LLC_BI__Basis_Amount__c' },
        // Name is an autonumber (COL-000nnn). Lendable Value is a formula over the asset's own value
        // and its type's rate, and Advance Rate on the ASSET is the type's rate restated - both are
        // the org's arithmetic. RecordTypeId is not written by this tool at all: the asset a pledge
        // needs is a plain collateral, and picking a record type would be picking a data model.
        OBJ_COLLATERAL => new Set<String>{
            'Name', 'RecordTypeId', 'LLC_BI__Lendable_Value__c', 'LLC_BI__Advance_Rate__c'
        },
        OBJ_ACCOUNT_COLLATERAL => new Set<String>(),
        // The same derived fields the carry may not copy, plus Unique_Id, which is nCino's own
        // `<aggregateId> - <collateralId>` key and belongs to the package.
        //
        // LLC_BI__Authorize__c LEFT THIS LIST ON 2026-09-03, and the reason is worth stating. It is
        // the org's escape from Pledge_More_Than_Lendable_Value and it is a BANKER's checkbox, so
        // the first cut refused it outright and refused every over-pledge with it. That left a
        // banker who genuinely wanted to lend past an asset's lendable value with no way to say so
        // and no way to find out there was one. What the fence was protecting against was a tool
        // setting it SILENTLY; what it actually produced was a dead end. The flag is now writable
        // and stage_loan_modification sets it ONLY on an explicit `authoriseOverPledge: true` in
        // the request, ONLY where the amount genuinely exceeds the lendable value, and says so in
        // the plan the banker confirms. The decision stays the banker's; the tool stopped
        // pretending the decision could not be expressed.
        OBJ_PLEDGE => new Set<String>{
            'LLC_BI__Advance_Rate__c', 'LLC_BI__Current_Lendable_Value__c', 'LLC_BI__Collateral_Value__c',
            'LLC_BI__Total_Pledged_Rollup_Value__c', 'LLC_BI__Total_Pledged_Rollup_Lendable_Value__c',
            'LLC_BI__Unique_Id__c'
        },
        // Automatically_Added is the org's own provenance flag: 76 of this org's 81 exceptions are
        // auto-generated exposure rows, and a tool-authored exception claiming to be one of them
        // would misstate where it came from to anyone reading the file. It defaults to false and
        // stays there. RecordTypeId is refused because the object HAS NO SUCH FIELD on this org
        // (recon Task 3a lists all 17 createable fields; it is not among them), so an attempt fails
        // at the platform - the same reasoning as the risk-rating object above.
        OBJ_POLICY_EXCEPTION => new Set<String>{ 'LLC_BI__Automatically_Added__c', 'RecordTypeId' }
    };

    /**
     * Objects this wave may create and nothing else. All three shipping actions create and
     * stop: Case takes no status transition and no closure, the valuation object takes no
     * updates or deletes at all (sub-collateral creation is refused outright), and Review
     * hands off to nCino's Submit for Approval rather than reaching Complete.
     */
    private static final Set<String> CREATE_ONLY = new Set<String>{ OBJ_CASE, OBJ_VALUATION, OBJ_REVIEW, OBJ_INVOLVEMENT };

    /** Every object the fence knows about, in either direction. */
    private static final Set<String> KNOWN_OBJECTS = new Set<String>{
        OBJ_CASE, OBJ_VALUATION, OBJ_REVIEW, OBJ_LOAN, OBJ_RISK_RATING, OBJ_COVENANT_COMPLIANCE,
        OBJ_PRODUCT_PACKAGE, OBJ_INVOLVEMENT, OBJ_COVENANT, OBJ_LOAN_COVENANT, OBJ_ACCOUNT_COVENANT,
        OBJ_FEE, OBJ_COLLATERAL, OBJ_ACCOUNT_COLLATERAL, OBJ_PLEDGE, OBJ_POLICY_EXCEPTION,
        // The Loan Detail is UPDATE-ONLY here: nCino creates the row from its own
        // after-commit flow and this package writes exactly one field on it.
        OBJ_LOAN_DETAIL
    };

    /**
     * PER-TOOL OBJECT FENCES (2026-09-03, relationship intake).
     *
     * The table above fences OBJECTS. That was enough while every arm that could reach an object
     * was the same arm, and it stopped being enough the day a tool arrived whose whole identity is
     * what it must NOT touch. Relationship intake files covenants and assets on the BORROWER: a
     * covenant with its relationship junction and no loan junction, an asset with its ownership
     * junction and no pledge. Both of those junctions are on the object table as legitimate
     * creates, because the modification arm authors them, so the object fence alone would let this
     * tool attach relationship rows to a facility and never say a word.
     *
     * So a tool may declare a NARROWER set than the object table permits, and the fence is by
     * subtraction only: a tool key can take objects away and can never add one, because everything
     * that passes here still passes assertAllowed() afterwards with the same states and the same
     * forbidden fields. Nothing that called assertAllowed() before calls anything different now.
     *
     * The alternative was a code path that simply never inserts a loan junction. That is not a
     * control: it is an absence, it cannot be tested by calling the same entry point the tool
     * calls, and the whole reason this class exists is that "the tool does not do that" is a
     * weaker sentence than "the tool is refused if it tries".
     */
    private static final Map<String, Set<String>> TOOL_CREATE_OBJECTS = new Map<String, Set<String>>{
        // stage_relationship_intake / execute_relationship_intake. Five objects, all relationship
        // level. OBJ_LOAN_COVENANT and OBJ_PLEDGE are deliberately absent: attaching intake to a
        // facility is a different action with its own confirmation.
        'relationship-intake' => new Set<String>{
            OBJ_COVENANT, OBJ_ACCOUNT_COVENANT, OBJ_COLLATERAL, OBJ_ACCOUNT_COLLATERAL, OBJ_VALUATION
        }
    };

    /**
     * PER-TOOL DELETE FENCES (0.9.23, the version lifecycle). THE ONLY DOOR TO A DELETE.
     *
     * `assertAllowed(object, OP_DELETE, ...)` still refuses EVERY object, unconditionally, exactly
     * as it has since this class was written. That sentence stays true, and its test stays true
     * with it. What 0.9.23 adds is a second, narrower door: a delete is permitted only when a NAMED
     * TOOL asks for it on a NAMED OBJECT, through `assertAllowedForTool`. A tool that is not on
     * this table cannot delete anything at all, and a tool that is on it cannot delete one object
     * more than it declared.
     *
     * Why a whole second table rather than a `DELETE_OBJECTS` set beside the create one: the object
     * tables answer "may this object ever be written", and for a delete that is the wrong question.
     * Every object below is one this package also CREATES or CARRIES in some other arm, so an
     * object-level delete permission would hand the delete to the modification arm too. The
     * question worth answering is "may THIS action remove THIS object", and that is what a tool key
     * asks.
     *
     * WHAT `discard-version` MAY REMOVE, and why each one is on the list rather than beside it:
     *   - `LLC_BI__LoanRenewal__c`: the chain rows that keep a booked parent reading hasRenewal
     *     true. Deleting the clone alone strands them (`RenewalLoanId` is a plain lookup), and a
     *     stranded row makes every later credit action fail with "The request contains invalid
     *     facilities" (proven by hand, 2026-09-11).
     *   - `LLC_BI__Loan_Collateral2__c`: the version's copied pledges. NOT the assets and NOT the
     *     `LLC_BI__Account_Collateral__c` ownership rows, which is why neither is on this list.
     *   - `LLC_BI__Loan_Covenant__c`: the version's covenant junctions. NOT `LLC_BI__Covenant2__c`
     *     and NOT `LLC_BI__Account_Covenant__c`: a covenant belongs to the borrower and survives
     *     the version that referenced it.
     *   - the two pricing components and `LLC_BI__Pricing_Stream__c`: nCino's own clone output on
     *     the version's facilities. The parent facility keeps its own streams untouched.
     *   - `LLC_BI__Fee__c` and `LLC_BI__Legal_Entities__c`: fees and borrowing structure authored
     *     onto the version.
     *   - `LLC_BI__Loan__c` and `LLC_BI__Product_Package__c`: the version's own facilities and the
     *     version package. The caller owns the scoping that keeps this to an UNBOOKED version, and
     *     it owns it with a gate that refuses a booked member by name.
     *
     * DELIBERATELY ABSENT, and each absence is a decision rather than an oversight:
     * `LLC_BI__Loan_Collateral_Aggregate__c` (a booked parent's facility can point at one, and the
     * frozen inventory does not name them), `LLC_BI__Loan_Detail__c` and
     * `LLC_BI__LLC_LoanDocument__c` (master-detail children that cascade with the facility, so a
     * delete permission would be a second way to do what the platform already does), every
     * relationship-level object, and `cm_Action_Staging__c`, which is the audit trail and is
     * marked rather than removed.
     */
    private static final Map<String, Set<String>> TOOL_DELETE_OBJECTS = new Map<String, Set<String>>{
        'discard-version' => new Set<String>{
            OBJ_LOAN_RENEWAL, OBJ_PLEDGE, OBJ_LOAN_COVENANT, OBJ_PRICING_RATE_COMPONENT,
            OBJ_PRICING_PAYMENT_COMPONENT, OBJ_PRICING_STREAM, OBJ_FEE, OBJ_INVOLVEMENT,
            OBJ_LOAN, OBJ_PRODUCT_PACKAGE
        }
    };

    /**
     * The gate for a tool that fences itself more narrowly than the object table does, and the only
     * entry point through which a delete can ever be permitted.
     *
     * A delete is answered entirely here, against TOOL_DELETE_OBJECTS, and never reaches
     * assertAllowed, which refuses every delete it is handed. Everything else is checked against
     * TOOL_CREATE_OBJECTS and then handed to assertAllowed exactly as before, so no existing caller
     * behaves differently.
     *
     * @param toolId The tool key, one of the keys of TOOL_CREATE_OBJECTS or TOOL_DELETE_OBJECTS.
     * @param objectApiName The target object API name.
     * @param operation One of OP_CREATE, OP_UPDATE, OP_DELETE, OP_CARRY.
     * @param values The field values the tool intends to write, keyed by field API name. Ignored
     *        for a delete, which names a record rather than a field set.
     * @throws GuardException when the tool has no fence, when the object is outside that tool's
     *         fence, or for any reason assertAllowed would refuse it.
     */
    public static void assertAllowedForTool(
        String toolId,
        String objectApiName,
        String operation,
        Map<String, Object> values
    ) {
        if (operation == OP_DELETE) {
            assertDeleteAllowedForTool(toolId, objectApiName);
            return;
        }

        Set<String> permitted = TOOL_CREATE_OBJECTS.get(toolId);
        if (permitted == null) {
            throw new GuardException(
                'Refused: no per-tool object fence is declared for ' + toolId + '. A tool that asks to be fenced by name ' +
                'must be on the table before it writes anything.'
            );
        }
        if (!permitted.contains(objectApiName)) {
            List<String> ok = new List<String>(permitted);
            ok.sort();
            throw new GuardException(
                'Refused: ' + toolId + ' may not write ' + objectApiName + '. It writes only [' + String.join(ok, ', ') +
                ']. Anything outside that list is a different action with its own confirmation.'
            );
        }
        assertAllowed(objectApiName, operation, values);
    }

    /**
     * The delete fence: a named tool, a named object, and the running identity's own delete right
     * confirmed before a plan promises a record will go.
     *
     * @param toolId The tool key, which must be on TOOL_DELETE_OBJECTS.
     * @param objectApiName The object the tool wants to delete.
     * @throws GuardException when the tool deletes nothing, when the object is outside that tool's
     *         delete set, or when the running identity cannot delete the object at all.
     */
    private static void assertDeleteAllowedForTool(String toolId, String objectApiName) {
        Set<String> permitted = TOOL_DELETE_OBJECTS.get(toolId);
        if (permitted == null) {
            throw new GuardException(
                'Refused: ' + toolId + ' deletes nothing. A delete is permitted only to a tool named on the delete ' +
                'table, and nothing in this package deletes by default.'
            );
        }
        if (!permitted.contains(objectApiName)) {
            List<String> ok = new List<String>(permitted);
            ok.sort();
            throw new GuardException(
                'Refused: ' + toolId + ' may not delete ' + objectApiName + '. It deletes only [' + String.join(ok, ', ') +
                ']. Everything else this action touches is kept on purpose.'
            );
        }
        Schema.SObjectType t = Schema.getGlobalDescribe().get(objectApiName);
        if (t == null || !t.getDescribe().isDeletable()) {
            throw new GuardException(
                'Refused: the running identity cannot delete ' + objectApiName +
                '. Assign the Credit Actions Delete permission set, or the equivalent object delete right, before ' +
                'running this tool.'
            );
        }
    }

    /**
     * The single gate every domain write in this package passes through (A33.5.8 doctrine).
     *
     * @param objectApiName The target object API name.
     * @param operation One of OP_CREATE, OP_UPDATE, OP_DELETE.
     * @param values The field values the tool intends to write, keyed by field API name.
     *        Ignored for update and delete, which are refused outright for this wave.
     * @throws GuardException when the object is unknown to the allowlist, when the operation
     *         is not permitted, when a forbidden field is present, or when a state field
     *         carries a value the allowlist does not permit.
     */
    public static void assertAllowed(String objectApiName, String operation, Map<String, Object> values) {
        // The carry has its own object table. Three junctions now appear in BOTH tables, because a
        // wave learned to author what the carry could only replicate: the covenant junction
        // (2026-08-30), the account-covenant junction and the collateral pledge (2026-08-31). Each
        // is admitted on the CREATE side under its own birth state, and the carry side is unchanged.
        // Everything else on the junction graph is still carry-only.
        if (operation == OP_CARRY) {
            assertCarryAllowed(objectApiName, values);
            return;
        }

        if (!KNOWN_OBJECTS.contains(objectApiName)) {
            throw new GuardException(
                'Refused: no transition allowlist exists for ' + objectApiName +
                '. A33.3.1 refuses anything not on the table.'
            );
        }

        // THIS ENTRY POINT NEVER PERMITS A DELETE, AND THAT DID NOT CHANGE IN 0.9.23. The version
        // lifecycle's discard reaches its deletes through assertAllowedForTool, which answers a
        // delete against the per-tool delete table and never arrives here. So a caller that asks
        // the object gate for a delete is a caller that has not been named, and it is refused.
        if (operation == OP_DELETE) {
            throw new GuardException(
                'Refused: this tool never deletes ' + objectApiName + ' (A33.3.1). A delete is permitted only to a ' +
                'named action through assertAllowedForTool, against its own declared set.'
            );
        }

        if (operation == OP_UPDATE) {
            assertUpdateAllowed(objectApiName, values);
            return;
        }

        if (!CREATE_STATES.containsKey(objectApiName)) {
            throw new GuardException(
                'Refused: ' + objectApiName + ' is never created by this tool (A33.3.1). ' +
                'Generation is the bank\'s managed automation, and on this object a create is what ' +
                'starts the approval chain.'
            );
        }

        assertObjectWritable(objectApiName);

        Set<String> forbidden = FORBIDDEN_FIELDS.get(objectApiName);
        for (String f : values.keySet()) {
            if (forbidden.contains(f)) {
                throw new GuardException('Refused: ' + objectApiName + '.' + f + ' is never written by this tool (A33.3.1).');
            }
        }

        Map<String, Set<String>> required = CREATE_STATES.get(objectApiName);
        for (String stateField : required.keySet()) {
            Object supplied = values.get(stateField);
            Set<String> allowed = required.get(stateField);
            if (supplied == null || !allowed.contains(String.valueOf(supplied))) {
                List<String> ok = new List<String>(allowed);
                ok.sort();
                throw new GuardException(
                    'Refused: ' + objectApiName + ' may be created only with ' + stateField + ' in [' + String.join(ok, ', ') +
                    '] (A33.3.1). Supplied: ' + String.valueOf(supplied) + '.'
                );
            }
        }
    }

    /**
     * Enforces the update side of the allowlist: only the named fields, only to the named values,
     * and never a forbidden field.
     *
     * @param objectApiName The target object API name.
     * @param values The field values the tool intends to write.
     * @throws GuardException when the object takes no update, or a field or value is not permitted.
     */
    private static void assertUpdateAllowed(String objectApiName, Map<String, Object> values) {
        Map<String, Set<String>> allowed = UPDATE_TRANSITIONS.get(objectApiName);
        if (allowed == null) {
            throw new GuardException(
                'Refused: ' + objectApiName + ' takes no update from this tool (A33.3.1). ' +
                'The bank\'s own process owns every state after creation.'
            );
        }

        Set<String> forbidden = FORBIDDEN_FIELDS.get(objectApiName);
        for (String f : values.keySet()) {
            if (forbidden != null && forbidden.contains(f)) {
                throw new GuardException('Refused: ' + objectApiName + '.' + f + ' is never written by this tool (A33.3.1).');
            }
            if (allowed.containsKey(f)) {
                String supplied = String.valueOf(values.get(f));
                if (!allowed.get(f).contains(supplied)) {
                    List<String> ok = new List<String>(allowed.get(f));
                    ok.sort();
                    throw new GuardException(
                        'Refused: ' + objectApiName + '.' + f + ' may only move to ' + String.join(ok, ' or ') +
                        ' (A33.3.1). Supplied: ' + supplied + '.'
                    );
                }
            }
        }
    }

    /**
     * Enforces the carry side of the allowlist: only the junction graph, and never a field the
     * org derives or forbids. The caller owns the scoping doctrine (replicas of version-parent
     * rows onto same-transaction clones); this gate owns the object and field fences.
     *
     * @param objectApiName The junction object being replicated.
     * @param values The field values of ONE replica row, keyed by field API name.
     * @throws GuardException when the object is not carryable or a forbidden field is present.
     */
    private static void assertCarryAllowed(String objectApiName, Map<String, Object> values) {
        if (!CARRY_OBJECTS.contains(objectApiName)) {
            throw new GuardException(
                'Refused: ' + objectApiName + ' is not part of the junction graph the versioning carry may replicate.'
            );
        }
        Set<String> forbidden = CARRY_FORBIDDEN.get(objectApiName);
        for (String f : values.keySet()) {
            if (forbidden.contains(f)) {
                throw new GuardException(
                    'Refused: ' + objectApiName + '.' + f + ' is never written by the carry, even as a copy: ' +
                    'the org derives or forbids it.'
                );
            }
        }
    }

    /**
     * Confirms the running identity can actually create the object before a plan promises it
     * will. A refusal here is a permissions answer, not a validation-rule answer, and the two
     * read very differently to a banker.
     *
     * @param objectApiName The target object API name.
     * @throws GuardException when the object is not createable by the running identity.
     */
    private static void assertObjectWritable(String objectApiName) {
        Schema.SObjectType t = Schema.getGlobalDescribe().get(objectApiName);
        if (t == null || !t.getDescribe().isCreateable()) {
            throw new GuardException(
                'Refused: the running identity cannot create ' + objectApiName +
                '. Grant object create permission before running this tool.'
            );
        }
    }

    /**
     * Applies FLS on create and then proves the fields that must survive actually did.
     *
     * stripInaccessible silently drops fields the running identity cannot create. On Review
     * that is not a cosmetic loss: probe 3 proved nothing defaults Status or Review_Type, so a
     * stripped Status would file a Review in no status at all. PROBE-LEDGER outstanding item 3
     * names FLS drift between System Administrator and the service identity as a live risk,
     * which is why this fails loudly rather than writing whatever survived.
     *
     * @param record The record about to be inserted.
     * @param mustSurvive Field API names whose loss invalidates the write.
     * @return The security-decorated record, safe to insert.
     * @throws GuardException when a required field was stripped by FLS.
     */
    public static SObject stripAndVerify(SObject record, Set<String> mustSurvive) {
        SObjectAccessDecision decision = Security.stripInaccessible(AccessType.CREATABLE, new List<SObject>{ record });
        SObject clean = decision.getRecords()[0];

        Map<String, Set<String>> removed = decision.getRemovedFields();
        for (String obj : removed.keySet()) {
            for (String f : removed.get(obj)) {
                if (mustSurvive.contains(f)) {
                    throw new GuardException(
                        'Refused: field-level security stripped ' + obj + '.' + f + ', which this action must set explicitly. ' +
                        'Grant the service identity edit access on that field before running this tool.'
                    );
                }
            }
        }
        return clean;
    }
}
