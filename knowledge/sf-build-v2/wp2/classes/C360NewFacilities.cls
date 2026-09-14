/**
 * C360NewFacilities - the net-new facility, wherever a plan authors one.
 *
 * FOUNDER DIRECTIVE, 2026-09-03: "Do we allow new loans to be created as part of the modification and
 * renewal? This should be fully possible."
 *
 * In nCino Commercial a modification or a renewal is anchored on the PRODUCT PACKAGE and produces the
 * next VERSION of it, holding clones of the booked members. Adding a facility to that new version is
 * ordinary practice: the bank versions the package and the new money goes on the version being
 * approved, not on a package nobody is looking at. Until this file, the room could only file a new
 * loan through its OWN route (stage_new_facility), which anchors on the CURRENT package and is a
 * separate credit action the banker has to approve separately.
 *
 * SO THE SHAPE IS SHARED, NOT COPIED. Three tools now author a facility and every one of them has to
 * write the same field set or the org renders them differently:
 *
 *   stage_new_facility / execute_new_facility   its own route, package anchor unchanged
 *   stage_loan_modification / execute_...       `newFacilitiesJson`, on the NEW package version
 *   stage_renewal                               `newFacilitiesJson`, narrated (execution held)
 *
 * The product catalog, the create state, the loan record and the borrower involvement all live here
 * for exactly the reason C360Facilities holds the selection contract: two copies of a subtle rule
 * drift, and this one is subtle. Probe 5 is the evidence behind every constant below.
 *
 * THE LABEL, AND WHY IT EXISTS. A covenant, a party, a pledge or a fee can be staged onto a facility
 * that has no id yet, because the id is minted at execute time. The plan therefore names it by a
 * LABEL, `new:1`, `new:2`, in the order the caller sent them, and the execute leg resolves the label
 * to the id it just created. That is the only forward reference in this package and it is deliberately
 * narrow: a label names a facility THIS SAME PLAN creates, never anything else, and a label nobody
 * staged is refused at stage time with the labels that exist.
 *
 * THE PURPOSE IS A HANDOFF, and it is one for the same reason execute_new_facility needs two
 * invocations. `LLC_BI__Primary_Loan_Purpose__c` does not exist on the Loan: it lives on the Loan
 * Detail, which nCino creates from an AFTER-COMMIT flow in its own transaction (PROBE-LEDGER wave 3,
 * probe 5). Nothing inside the transaction that inserts the facility can see it, and wave 4 proved a
 * spin-wait burns the CPU ceiling and can never succeed. So the arm writes the purpose where the Loan
 * Detail is already there, and where it is not the plan says so in the banker's own words rather than
 * claiming a write it did not perform.
 */
public with sharing class C360NewFacilities {

    /** Raised for a domain-level validation failure. The calling tool maps it to ok:false. */
    public class NewFacilityException extends Exception {}

    /**
     * Values the COMMERCIAL LOAN RECORD TYPE actually offers, read from
     * /ui-api/object-info/LLC_BI__Loan__c/picklist-values/012bb000000NfLpAAK/LLC_BI__Product__c on
     * 2026-07-26 and recorded in PROBE-LEDGER wave 5.
     *
     * MAINTAINED CONSTANT, not a live read, and the trade is deliberate: ui-api is not callable from
     * Apex without a callout, and a callout on the stage path would make planning depend on network
     * availability.
     *
     * WHY IT EXISTS: record-type scoping is NOT enforced by the API. All three Loan picklists are
     * restrictedPicklist false, so a PATCH writing Product = 'Term' onto a Commercial-RT loan returns
     * 204 and stores it, and it then renders wrong in nCino. Nothing on the platform catches this
     * (LESSONS 15w), so every tool that authors a facility checks it here.
     */
    public static final Set<String> RT_PRODUCT_VALUES = new Set<String>{
        'Construction', 'Equipment', 'Line of Credit', 'HELOC', 'Purchase', 'Deposit'
    };

    /** Where the primary loan purpose actually lives. Not on the Loan. */
    public static final String OBJ_LOAN_DETAIL = 'LLC_BI__Loan_Detail__c';
    public static final String FLD_PRIMARY_PURPOSE = 'LLC_BI__Primary_Loan_Purpose__c';

    /** Confirmed RT-valid in the same read, and the only state a facility may be created with. */
    public static final String RT_CREATE_STAGE = 'Qualification';
    public static final String RT_CREATE_STATUS = 'Open';

    /**
     * The route the nCino Loan record page resolves itself from (LESSONS 8o, 2026-09-14).
     *
     * nFORCE reads LLC_BI__Default_App__c to decide which app renders inside the Loan page. In this
     * org only 'loans.dashboard-loan' resolves; the field's OWN default formula is
     * 'loan.dashboard-loan', which renders the path bar and an EMPTY body with no Aura or Apex error
     * anywhere. A clone inherits the parent's value, so nCino's credit action is safe once the
     * parents are right, but a net-new facility inherits nothing and takes the broken default unless
     * the insert sets this explicitly. Every facility this package writes therefore carries it, and
     * it is one constant here because three tools author a facility and a second copy would drift.
     */
    public static final String LOAN_DEFAULT_APP = 'loans.dashboard-loan';

    /**
     * The stage a credit package this cockpit creates is born at (backlog 58, 2026-09-14).
     *
     * `LLC_BI__Product_Package__c.LLC_BI__Stage__c` is an unrestricted picklist offering Pending,
     * In Review and Complete in this org (describe, 2026-09-14), and Pending is its opening value.
     * A package created with a NULL stage reads exactly like one somebody keyed by hand, which is
     * why `StageDiscardVersion` refused to roll back the first package the new-facility room made:
     * nothing on the record said the cockpit put it there. One constant, beside the Default App and
     * for the same reason: the package-first execute writes it and the stage plan shows the banker
     * the same value, so the plan and the write cannot describe different things. `C360WriteGuard`
     * carries its own copy on purpose, because a fence that read its permitted value off the tool it
     * fences would permit whatever that tool decided to send; `C360WriteGuardTest` asserts the two
     * agree.
     */
    public static final String PACKAGE_CREATE_STAGE = 'Pending';

    /** At most this many net-new facilities on one plan. The banker confirms one manifest. */
    public static final Integer NEW_FACILITY_MAX = 5;

    /** The fields whose loss to FLS invalidates the facility write. */
    public static final Set<String> LOAN_MUST_SURVIVE = new Set<String>{
        'LLC_BI__Account__c', 'LLC_BI__Stage__c', 'LLC_BI__Status__c',
        'LLC_BI__isRenewal__c', 'LLC_BI__Is_Modification__c', 'LLC_BI__Product__c'
    };

    /** The fields whose loss to FLS invalidates the borrowing-structure write. */
    public static final Set<String> INVOLVEMENT_MUST_SURVIVE = new Set<String>{
        'LLC_BI__Account__c', 'LLC_BI__Loan__c', 'LLC_BI__Borrower_Type__c'
    };

    /** One net-new facility, as the caller sent it and as the plan carries it. */
    public class NewFacility {
        /** `new:1`, `new:2`, in the order the caller sent them. The other arms name this. */
        public String label;
        public String product;
        public Decimal amount;
        public Decimal termMonths;
        /** Written on the Loan Detail nCino creates after this transaction, never on the Loan. */
        public String purpose;
        /** Pricing prerequisite. nCino hides the rate and the payment stream without it. */
        public Decimal amortizedTermMonths;
        /** Pricing prerequisite, the last of the four. */
        public Date firstPaymentDate;
    }

    /* ------------------------------------------------------------------- the label */

    /**
     * The canonical form of a label, or null where the value is not one.
     *
     * Case-insensitive because a banker's tool call may send `NEW:1`, and canonicalised so the plan
     * and every arm that names it agree on one spelling.
     *
     * @param raw The caller's target value, which may be a record id, a label or nothing.
     * @return `new:<n>` or null.
     */
    public static String canonicalLabel(Object raw) {
        if (raw == null) {
            return null;
        }
        String said = String.valueOf(raw).trim();
        if (!Pattern.matches('(?i)^new:[0-9]{1,3}$', said)) {
            return null;
        }
        return 'new:' + Integer.valueOf(said.substring(4));
    }

    /**
     * Resolves a label against the facilities this plan creates, refusing one nobody staged.
     *
     * @param label The canonical label.
     * @param newFacilities The plan's net-new facilities.
     * @param what The arm being staged, for the banker copy.
     * @return The named facility.
     */
    public static NewFacility byLabel(String label, List<NewFacility> newFacilities, String what) {
        for (NewFacility nf : newFacilities) {
            if (nf.label == label) {
                return nf;
            }
        }
        if (newFacilities.isEmpty()) {
            throw new NewFacilityException(
                'A ' + what + ' targets ' + label + ', but this plan creates no new facility. ' +
                'Send the facility in newFacilitiesJson in the same request, or target a selected facility by id.'
            );
        }
        throw new NewFacilityException(
            'A ' + what + ' targets ' + label + ', which is not one of the new facilities on this plan. ' +
            'This plan creates ' + labelList(newFacilities) + '.'
        );
    }

    /** The labels this plan carries, for a refusal that names them. */
    public static String labelList(List<NewFacility> newFacilities) {
        List<String> said = new List<String>();
        for (NewFacility nf : newFacilities) {
            said.add(nf.label + ' (' + phrase(nf) + ')');
        }
        return String.join(said, ', ');
    }

    /** How the plan names a new facility before the org has named it. */
    public static String phrase(NewFacility nf) {
        return 'a new ' + nf.product + ' facility of ' + String.valueOf(nf.amount) +
            ' over ' + String.valueOf(nf.termMonths) + ' months';
    }

    /* ------------------------------------------------------------------- the parse */

    /**
     * Reads `newFacilitiesJson` into validated facilities.
     *
     * VALIDATION IS THE SAME AS THE CREATE ROUTE'S, and it is here so it cannot diverge from it. The
     * product must be one the Commercial record type actually offers, the amount must be positive
     * because it gates LV11, and the term must be positive because a facility with no term is not one
     * anybody can price. The purpose is required for the same reason the create route requires it: the
     * org leaves it null and it gates LV12 on any later hop.
     *
     * @param payload The caller's `newFacilitiesJson`, which may be blank.
     * @param actionNoun 'modification' or 'renewal', for the banker copy.
     * @return The facilities, labelled in the order they were sent.
     */
    public static List<NewFacility> parse(String payload, String actionNoun) {
        List<NewFacility> out = new List<NewFacility>();
        if (String.isBlank(payload)) {
            return out;
        }
        List<Object> raw;
        try {
            raw = (List<Object>) JSON.deserializeUntyped(payload);
        } catch (Exception e) {
            throw new NewFacilityException('newFacilitiesJson could not be read as a JSON list: ' + e.getMessage());
        }
        if (raw.size() > NEW_FACILITY_MAX) {
            throw new NewFacilityException(
                'This ' + actionNoun + ' adds ' + raw.size() + ' new facilities and one plan takes at most ' +
                NEW_FACILITY_MAX + '. File the rest as a second credit action.'
            );
        }

        Set<String> seen = new Set<String>();
        for (Integer i = 0; i < raw.size(); i++) {
            Map<String, Object> m = (Map<String, Object>) raw[i];
            NewFacility nf = new NewFacility();

            // The label is positional by default, because the caller counting entries and the plan
            // counting entries are the same count. An explicit label is honoured so a room that
            // composed "new:1" in an earlier turn keeps naming the same facility.
            String supplied = canonicalLabel(m.get('label'));
            if (m.get('label') != null && supplied == null) {
                throw new NewFacilityException(
                    'A new facility carries the label "' + String.valueOf(m.get('label')) +
                    '". A label reads new:<n>, so the other arms of this request can name it before it has an id.'
                );
            }
            nf.label = supplied == null ? 'new:' + (i + 1) : supplied;
            if (seen.contains(nf.label)) {
                throw new NewFacilityException(
                    'Two new facilities on this plan carry the label ' + nf.label +
                    '. A label names exactly one facility, or an arm aimed at it lands nowhere in particular.'
                );
            }
            seen.add(nf.label);

            nf.product = m.get('product') == null ? null : String.valueOf(m.get('product')).trim();
            nf.amount = C360Plan.asDecimal(m.get('amount'));
            nf.termMonths = C360Plan.asDecimal(m.get('termMonths'));
            nf.purpose = m.get('purpose') == null ? null : String.valueOf(m.get('purpose')).trim();
            nf.amortizedTermMonths = C360Plan.asDecimal(m.get('amortizedTermMonths'));
            nf.firstPaymentDate = m.get('firstPaymentDate') == null
                ? null
                : Date.valueOf(String.valueOf(m.get('firstPaymentDate')));

            assertProduct(nf.product, nf.label);
            if (nf.amount == null || nf.amount <= 0) {
                throw new NewFacilityException(
                    nf.label + ' needs an amount greater than zero. It gates LV11 and it is what the org builds the facility name from.'
                );
            }
            if (nf.termMonths == null || nf.termMonths <= 0) {
                throw new NewFacilityException(
                    nf.label + ' needs a term in months greater than zero. nCino prices on the amount and the term, and a facility with neither cannot be priced at all.'
                );
            }
            assertPurpose(nf.purpose, nf.label);
            if (nf.amortizedTermMonths != null && nf.amortizedTermMonths <= 0) {
                throw new NewFacilityException(nf.label + ' carries an amortised term of ' + String.valueOf(nf.amortizedTermMonths) + '. An amortisation is a count of months greater than zero.');
            }
            out.add(nf);
        }
        return out;
    }

    /* ------------------------------------------------------- the purpose field

       THE OBJECT AND THE FIELD, confirmed by describing the org on 2026-09-03:

         LLC_BI__Loan_Detail__c.LLC_BI__Primary_Loan_Purpose__c

       `LLC_BI__Loan__c` carries NO primary-purpose field of its own. The only
       purpose field on the loan is `cm_Purpose_of_Loan__c`, which is org-local
       and is not what nCino reads.

       AND IT IS A RESTRICTED PICKLIST, which is the fact that matters: 23 active
       coded values (`business_expansion`, `equipment`, `refinance_our_loan`, ...)
       and `restrictedPicklist = true`, so the ORG REJECTS anything else outright
       rather than storing it the way the product picklist would. A banker's own
       words are not a legal value, and a tool that let them through would stage a
       plan the org refuses at the moment of the write.

       So the value is checked HERE, against the org's own live describe, and a
       refusal carries the legal list. */

    /** The purpose check, against the org's own active values. */
    public static void assertPurpose(String purpose, String who) {
        if (String.isBlank(purpose)) {
            throw new NewFacilityException(
                who + ' needs a primary loan purpose. The org leaves it null on the Loan Detail it creates, and it gates LV12 on any later stage hop.'
            );
        }
        Set<String> allowed = C360Picklist.activeValues(OBJ_LOAN_DETAIL, FLD_PRIMARY_PURPOSE);
        if (allowed.isEmpty() || allowed.contains(purpose)) {
            return;
        }
        List<String> sorted = new List<String>(allowed);
        sorted.sort();
        throw new NewFacilityException(
            who + ' carries the primary loan purpose \'' + purpose + '\', which this org does not offer. ' +
            FLD_PRIMARY_PURPOSE + ' is a RESTRICTED picklist here, so the org refuses anything outside its own list rather ' +
            'than storing it. Available: ' + String.join(sorted, ', ') + '.'
        );
    }

    /** The product check, in the create route's own words. */
    public static void assertProduct(String product, String who) {
        if (String.isBlank(product)) {
            throw new NewFacilityException(
                who + ' needs a product. The org self-populates Construction when it is blank and rebuilds the loan ' +
                'name from it, so an omitted product ships a facility labelled Construction.'
            );
        }
        if (RT_PRODUCT_VALUES.contains(product)) {
            return;
        }
        List<String> sorted = new List<String>(RT_PRODUCT_VALUES);
        sorted.sort();
        throw new NewFacilityException(
            'product \'' + product + '\' is not offered by the Commercial Loan record type. Available: ' +
            String.join(sorted, ', ') + '. The API would accept the value and store it, and it would then render wrong in nCino.'
        );
    }

    /* ------------------------------------------------------------------- the write */

    /**
     * The field map the guard is asked about before the facility is written.
     *
     * @param accountId The borrower.
     * @param packageId The package the facility hangs off, which on a modification is the NEW version.
     * @param product The RT-valid product.
     * @param amount The commitment.
     * @return The fields, for C360WriteGuard.assertAllowed.
     */
    public static Map<String, Object> loanFields(Id accountId, Id packageId, String product, Decimal amount) {
        return new Map<String, Object>{
            'LLC_BI__Account__c' => accountId,
            'LLC_BI__Product_Package__c' => packageId,
            'LLC_BI__Stage__c' => RT_CREATE_STAGE,
            'LLC_BI__Status__c' => RT_CREATE_STATUS,
            'LLC_BI__isRenewal__c' => false,
            'LLC_BI__Is_Modification__c' => false,
            'LLC_BI__Product__c' => product,
            'LLC_BI__Amount__c' => amount,
            'LLC_BI__Default_App__c' => LOAN_DEFAULT_APP
        };
    }

    /**
     * The facility record itself, in the shape probe 5 proved passes 21 validation rules.
     *
     * NO NAME IS SET. A before-save flow rebuilds it as "<Account> - <Product> - <Amount>" and any
     * value we send is discarded, so nothing here submits one and nothing echoes one back.
     *
     * The renewal and modification FLAGS ARE FALSE on a net-new facility even inside a modification:
     * the loan is new, not a version of anything, and LLC_BI__Is_Modification__c true on a loan with
     * no chain row behind it would misreport it as somebody's clone.
     *
     * @param accountId The borrower.
     * @param packageId The package the facility hangs off.
     * @param nf The validated facility.
     * @return The record, before FLS.
     */
    public static LLC_BI__Loan__c newLoan(Id accountId, Id packageId, NewFacility nf) {
        LLC_BI__Loan__c record = new LLC_BI__Loan__c(
            LLC_BI__Account__c = accountId,
            LLC_BI__Product_Package__c = packageId,
            LLC_BI__Stage__c = RT_CREATE_STAGE,
            LLC_BI__Status__c = RT_CREATE_STATUS,
            LLC_BI__isRenewal__c = false,
            LLC_BI__Is_Modification__c = false,
            LLC_BI__Product__c = nf.product,
            LLC_BI__Amount__c = nf.amount,
            LLC_BI__Default_App__c = LOAN_DEFAULT_APP
        );
        if (nf.termMonths != null) {
            record.LLC_BI__Term_Months__c = nf.termMonths;
        }
        // THE PRICING PREREQUISITES, where the banker gave them. nCino hides the rate and the payment
        // stream until the amount, the term, the amortised term and the first payment date are all
        // defined, so a facility filed without them is one nobody can price on the screen they open
        // next. Neither field is on the guard's OBJ_LOAN deny-list and both are createable.
        if (nf.amortizedTermMonths != null) {
            record.LLC_BI__Amortized_Term_Months__c = nf.amortizedTermMonths;
        }
        if (nf.firstPaymentDate != null) {
            record.LLC_BI__First_Payment_Date__c = nf.firstPaymentDate;
        }
        return record;
    }

    /** The fields the guard is asked about before the borrowing structure is written. */
    public static Map<String, Object> involvementFields(Id accountId, Id loanId, Id packageId) {
        return new Map<String, Object>{
            'LLC_BI__Account__c' => accountId,
            'LLC_BI__Loan__c' => loanId,
            'LLC_BI__Product_Package__c' => packageId,
            'LLC_BI__Borrower_Type__c' => 'Borrower',
            'LLC_BI__Ownership__c' => 100
        };
    }

    /**
     * The borrower row a facility insert does NOT create on its own.
     *
     * Proven with a control (LESSONS 15u): the Loan Detail appeared and involvement rows did not. A
     * facility filed without one has no borrowing structure at all. Ownership is set and Contingent
     * Amount is not: pairing them on one row trips Contingent_Amount_and_Contingent_Percent, whose
     * only escape tests for a Household role value this org does not have (LESSONS 15v).
     *
     * @param accountId The borrower.
     * @param loanId The facility just written.
     * @param packageId The package the facility hangs off.
     * @return The record, before FLS.
     */
    public static LLC_BI__Legal_Entities__c newInvolvement(Id accountId, Id loanId, Id packageId) {
        return new LLC_BI__Legal_Entities__c(
            LLC_BI__Account__c = accountId,
            LLC_BI__Loan__c = loanId,
            LLC_BI__Product_Package__c = packageId,
            LLC_BI__Borrower_Type__c = 'Borrower',
            LLC_BI__Ownership__c = 100
        );
    }

    /* ------------------------------------------------------------------- the plan */

    /** Writes one facility onto the plan's resolved values, under its own index. */
    public static void putResolved(Map<String, Object> resolved, Integer i, NewFacility nf) {
        String s = String.valueOf(i);
        resolved.put('newFacility' + s + '.label', nf.label);
        resolved.put('newFacility' + s + '.product', nf.product);
        resolved.put('newFacility' + s + '.amount', nf.amount);
        resolved.put('newFacility' + s + '.termMonths', nf.termMonths);
        resolved.put('newFacility' + s + '.purpose', nf.purpose);
        resolved.put('newFacility' + s + '.amortizedTermMonths', nf.amortizedTermMonths);
        resolved.put('newFacility' + s + '.firstPaymentDate', nf.firstPaymentDate);
    }

    /** Reads one facility back off the plan at execute time. */
    public static NewFacility fromResolved(Map<String, Object> v, Integer i) {
        String s = String.valueOf(i);
        NewFacility nf = new NewFacility();
        nf.label = v.get('newFacility' + s + '.label') == null ? null : String.valueOf(v.get('newFacility' + s + '.label'));
        nf.product = v.get('newFacility' + s + '.product') == null ? null : String.valueOf(v.get('newFacility' + s + '.product'));
        nf.amount = C360Plan.asDecimal(v.get('newFacility' + s + '.amount'));
        nf.termMonths = C360Plan.asDecimal(v.get('newFacility' + s + '.termMonths'));
        nf.purpose = v.get('newFacility' + s + '.purpose') == null ? null : String.valueOf(v.get('newFacility' + s + '.purpose'));
        nf.amortizedTermMonths = C360Plan.asDecimal(v.get('newFacility' + s + '.amortizedTermMonths'));
        nf.firstPaymentDate = C360Plan.asDate(v.get('newFacility' + s + '.firstPaymentDate'));
        return nf;
    }

    /**
     * The plan steps one net-new facility contributes, in the order they run.
     *
     * @param i The facility's index on the plan.
     * @param nf The validated facility.
     * @param anchorPhrase How the plan names the package it lands on.
     * @return Four steps: the write, the borrowing structure, the read-back and the purpose handoff.
     */
    public static List<C360Plan.Step> steps(Integer i, NewFacility nf, String anchorPhrase) {
        String s = String.valueOf(i);
        List<C360Plan.Step> out = new List<C360Plan.Step>();
        out.add(
            new C360Plan.Step('new_facility_' + s, C360Plan.TYPE_WRITE,
                'File ' + phrase(nf) + ' on ' + anchorPhrase + ' at stage Qualification' +
                (nf.amortizedTermMonths == null && nf.firstPaymentDate == null
                    ? ''
                    : ', with the pricing fields nCino needs before it will show a rate'))
                .onObject(C360WriteGuard.OBJ_LOAN, new List<String>{
                    'LLC_BI__Account__c', 'LLC_BI__Product_Package__c', 'LLC_BI__Stage__c', 'LLC_BI__Status__c',
                    'LLC_BI__isRenewal__c', 'LLC_BI__Is_Modification__c', 'LLC_BI__Product__c', 'LLC_BI__Amount__c',
                    'LLC_BI__Term_Months__c', 'LLC_BI__Default_App__c'
                })
                .wakes(new List<String>{
                    'Five managed namespaces (LLC_BI, nFORCE, nCino, NDOC, nCRED) and 21 validation rules',
                    'A before-save flow that REBUILDS the loan name as Account - Product - Amount',
                    'ACNPEX_ AccountOwnerAsLoanOfficer, which assigns the loan officer'
                })
                .provenBy('SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Product__c FROM LLC_BI__Loan__c WHERE Id = :newFacilityId')
        );
        out.add(
            new C360Plan.Step('new_facility_involve_' + s, C360Plan.TYPE_WRITE,
                'Add the borrower to the new facility\'s borrowing structure at 100 percent ownership')
                .onObject(C360WriteGuard.OBJ_INVOLVEMENT, new List<String>{
                    'LLC_BI__Account__c', 'LLC_BI__Loan__c', 'LLC_BI__Product_Package__c',
                    'LLC_BI__Borrower_Type__c', 'LLC_BI__Ownership__c'
                })
                .provenBy('SELECT Id, LLC_BI__Borrower_Type__c FROM LLC_BI__Legal_Entities__c WHERE LLC_BI__Loan__c = :newFacilityId')
        );
        out.add(
            new C360Plan.Step('new_facility_verify_' + s, C360Plan.TYPE_VERIFICATION,
                'Read the new facility back and report the name the org assigned it')
                .onObject(C360WriteGuard.OBJ_LOAN, new List<String>{
                    'Name', 'LLC_BI__Stage__c', 'LLC_BI__Product__c', 'LLC_BI__Amount__c', 'LLC_BI__Default_App__c'
                })
                .provenBy('SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Amount__c FROM LLC_BI__Loan__c WHERE Id = :newFacilityId')
        );
        out.add(
            new C360Plan.Step('new_facility_purpose_' + s, C360Plan.TYPE_HANDOFF,
                'Set the primary loan purpose "' + nf.purpose + '" on the Loan Detail nCino creates for it')
                .onObject('LLC_BI__Loan_Detail__c', new List<String>{ 'LLC_BI__Primary_Loan_Purpose__c' })
                .wakes(new List<String>{ 'An async-path flow: Loan_Detail_Exists, Create_Loan_Detail, Update_Loan_with_New_Loan_Details_Record' })
                .provenBy('SELECT Id, LLC_BI__Primary_Loan_Purpose__c FROM LLC_BI__Loan_Detail__c WHERE Id = :loanDetailId')
        );
        return out;
    }

    /**
     * What the banker is told about the new facilities before confirming.
     *
     * @param newFacilities The plan's net-new facilities.
     * @param anchorPhrase How the plan names the package they land on.
     * @return The warnings, or an empty list where the plan adds none.
     */
    public static List<String> warnings(List<NewFacility> newFacilities, String anchorPhrase) {
        List<String> out = new List<String>();
        if (newFacilities.isEmpty()) {
            return out;
        }
        Integer n = newFacilities.size();
        out.add(
            String.valueOf(n) + ' NET-NEW ' + (n == 1 ? 'facility is' : 'facilities are') +
            ' filed on ' + anchorPhrase + ', not on the current package: ' + labelList(newFacilities) + '. ' +
            (n == 1 ? 'It is' : 'They are') + ' a new loan rather than a version of an existing one, so ' +
            (n == 1 ? 'it carries' : 'they carry') + ' no chain row and no modification flag, and nothing on the ' +
            'booked side of this relationship changes because of ' + (n == 1 ? 'it' : 'them') + '.'
        );
        out.add(
            'The org names ' + (n == 1 ? 'the new facility' : 'each new facility') +
            ' itself as "Account - Product - Amount" and assigns the loan officer from the account owner. ' +
            'The name you see after execution is the org\'s, not one this panel chose.'
        );
        Boolean anyPurpose = false;
        for (NewFacility nf : newFacilities) {
            if (String.isNotBlank(nf.purpose)) {
                anyPurpose = true;
            }
        }
        if (anyPurpose) {
            out.add(
                'The primary loan purpose lives on LLC_BI__Loan_Detail__c, which nCino creates in its OWN ' +
                'transaction moments after the facility is filed. This run writes it where the Loan Detail has ' +
                'already appeared and reports it as PENDING where it has not: nothing inside the filing ' +
                'transaction can see a record the org creates after that transaction commits. ' +
                'complete_new_facility_detail is the second hop that finishes it, and it writes nothing at all ' +
                'when there is nothing left to write.'
            );
        }
        List<String> unpriced = new List<String>();
        for (NewFacility nf : newFacilities) {
            if (nf.amortizedTermMonths == null || nf.firstPaymentDate == null) {
                unpriced.add(nf.label);
            }
        }
        if (!unpriced.isEmpty()) {
            out.add(
                'nCino needs the amount, the term, the amortised term and the first payment date before it will ' +
                'show a rate or a payment stream. ' + String.join(unpriced, ', ') +
                (unpriced.size() == 1 ? ' carries' : ' carry') + ' fewer than four, so the new version will open ' +
                'without pricing on ' + (unpriced.size() == 1 ? 'it' : 'them') + ' until somebody sets the rest.'
            );
        }
        out.add(
            'Booking is unchanged. The new ' + (n == 1 ? 'facility sits' : 'facilities sit') +
            ' at Qualification beside the clones, and reaching Booked is nCino\'s own Submit for Approval with real approvers.'
        );
        return out;
    }
}
