/**
 * C360Facilities - package-anchored facility selection for the credit-action stage tools.
 *
 * ACTIONS-DESIGN 5.1 anchor correction (Fabian, 2026-07-25): a commercial modification or renewal is
 * anchored on the PRODUCT PACKAGE. nCino's CreditActionSoaXPkg takes the package id plus a list of
 * (booked facility, action) pairs, so a facility is a member selection WITHIN the package rather
 * than the anchor. stage_loan_modification and stage_renewal therefore share one selection contract,
 * and it lives here rather than being written twice: the rules are subtle enough that two copies
 * would drift.
 *
 * Not an invocable class, and it declares no wire-visible type. Lesson 16's "wire types are never
 * shared across classes" is about @InvocableVariable serialisation shapes, which the platform forces
 * each tool to own; shared plan LOGIC is what C360Plan, C360WriteGuard and C360Picklist already do.
 *
 * THE SELECTION CONTRACT, in one place:
 *   - exactly one input shape per call, flat loanId XOR facilityIds, mixing refused;
 *   - an explicitly supplied but empty facilityIds is refused, never silently treated as absent;
 *   - duplicates refused, naming the position;
 *   - every id must be a facility id, and every facility must be a member of the named package;
 *   - every facility must be Booked + Open, which is what nCino calls a valid facility (probe 9).
 * Requiredness is enforced here rather than by required=true on the invocable variable: lesson 16aa,
 * required=true is applied by the Actions API before Apex runs, so it cannot express either-or.
 */
public with sharing class C360Facilities {

    /** Raised for a domain-level validation failure. The calling tool maps it to ok:false. */
    public class SelectionException extends Exception {}

    /**
     * ONE FACILITY A THING IS TIED TO, AND THE PACKAGE THAT FACILITY SITS ON.
     *
     * Founder, 2026-09-13: "covenants and collateral are driven from the relationship; a package is
     * an association, never a filter." This is that association, and it lives here for the same
     * reason the selection contract does: covenant review and collateral valuation both surface it,
     * and two copies of the shape would drift. It travels to the room as a JSON string on the item,
     * because an @InvocableVariable cannot carry a list of Apex-defined types inside another one.
     */
    public class Association {
        public String loanId;
        public String loanName;
        public String productPackageId;
        public String packageName;
    }

    /**
     * Builds one association, with nulls kept as nulls.
     *
     * `String.valueOf(null)` is the four-character string 'null', which the room would render as a
     * package called null and the next reader would try to resolve as an id.
     *
     * @param loanId The facility.
     * @param loanName The facility's org-assigned name.
     * @param productPackageId The package the facility sits on, which may be null.
     * @param packageName That package's name, which may be null.
     * @return The association.
     */
    public static Association association(Id loanId, String loanName, Id productPackageId, String packageName) {
        Association a = new Association();
        a.loanId = loanId == null ? null : String.valueOf(loanId);
        a.loanName = loanName;
        a.productPackageId = productPackageId == null ? null : String.valueOf(productPackageId);
        a.packageName = packageName;
        return a;
    }

    /** The associations of one item, as the wire string the room reads. An empty list serialises as []. */
    public static String associationsJson(List<Association> associations) {
        return JSON.serialize(associations == null ? new List<Association>() : associations);
    }

    /**
     * The packages a set of associations reaches, id to name.
     *
     * The staging row anchors on the ACCOUNT and names a package only where exactly one is touched:
     * a plan that spans two deals has no single deal to deep-link to, and writing one of them onto
     * the trail row would make it claim a narrowing nobody chose.
     *
     * @param associations Every association across the items this plan will write.
     * @return Package id to package name. Empty where the items reach no package at all.
     */
    public static Map<Id, String> packagesIn(List<Association> associations) {
        Map<Id, String> out = new Map<Id, String>();
        if (associations == null) {
            return out;
        }
        for (Association a : associations) {
            if (a.productPackageId != null) {
                out.put(Id.valueOf(a.productPackageId), a.packageName);
            }
        }
        return out;
    }

    /**
     * Validates the product package anchor and returns it as a typed Id.
     *
     * Fails closed on a non-id and on an id belonging to another object: lesson 4b, an id-typed
     * field carries validated ids only, resolved through a prefix-checked helper.
     *
     * @param raw The caller's productPackageId.
     * @return The package id.
     */
    public static Id packageId(String raw) {
        Id parsed;
        try {
            parsed = Id.valueOf(raw);
        } catch (Exception e) {
            throw new SelectionException('productPackageId ' + raw + ' is not a record id.');
        }
        if (parsed.getSObjectType() != LLC_BI__Product_Package__c.SObjectType) {
            throw new SelectionException('productPackageId ' + raw + ' is not a product package id. The deal anchor is the product package.');
        }
        return parsed;
    }

    /**
     * Resolves the two input shapes into one ordered facility list.
     *
     * An empty facilityIds alongside a flat loanId takes the flat path deliberately. The Actions API
     * has not been observed to distinguish an omitted list from an empty one, and lesson 16aa is
     * precisely that no Apex test can settle that question, so the back-compat shape is never made
     * to depend on the answer. An empty facilityIds with no flat loanId is a refusal.
     *
     * @param loanId The flat single-facility input, may be blank.
     * @param facilityIds The package-anchored input, may be null or empty.
     * @param actionNoun 'modification' or 'renewal', for the banker copy.
     * @return The selected facility ids, in the order the caller gave them.
     */
    public static List<Id> resolve(String loanId, List<Id> facilityIds, String actionNoun) {
        Boolean hasFlat = String.isNotBlank(loanId);
        Boolean hasBulk = facilityIds != null && !facilityIds.isEmpty();

        if (hasFlat && hasBulk) {
            throw new SelectionException(
                'Supply either the single loanId or facilityIds, but not both. Two shapes in one request is two intentions, ' +
                'and guessing which one wins would stage a ' + actionNoun + ' against facilities the banker did not choose.'
            );
        }
        if (!hasFlat && !hasBulk) {
            throw new SelectionException(
                facilityIds == null
                    ? 'No facility supplied. Provide facilityIds, the member facilities on this package, or the single loanId. ' +
                      'Neither is flagged required on the invocable because either shape is valid, so the check lives in Apex.'
                    : 'facilityIds is empty. A ' + actionNoun + ' acts on at least one facility: name the members of this package to act on, ' +
                      'or use the single loanId.'
            );
        }

        List<Id> out = new List<Id>();
        if (!hasBulk) {
            out.add(facilityId(loanId, 'loanId ' + loanId));
            return out;
        }

        Set<Id> seen = new Set<Id>();
        for (Integer i = 0; i < facilityIds.size(); i++) {
            String pos = ref(i, facilityIds.size());
            Id fid = facilityIds[i];
            if (fid == null) {
                throw new SelectionException('facilityIds carries an empty entry' + pos + '.');
            }
            if (fid.getSObjectType() != LLC_BI__Loan__c.SObjectType) {
                throw new SelectionException('facilityIds carries ' + fid + ', which is not a facility id' + pos + '.');
            }
            if (seen.contains(fid)) {
                throw new SelectionException(
                    'Facility ' + fid + ' is named more than once' + pos + '. One credit action per facility per plan.'
                );
            }
            seen.add(fid);
            out.add(fid);
        }
        return out;
    }

    /**
     * Validates every selected facility against the package anchor and nCino's valid-facility rule,
     * and returns the records in the caller's order.
     *
     * Probe 9, finding 3: a credit action accepts only a Booked, Open, core-keyed facility. Anything
     * else returns "The request contains invalid facilities", so staging a plan the org can never
     * execute is dishonest staging and the refusal belongs here rather than in a warning.
     *
     * @param found The facility records read for these ids, in any order.
     * @param requested The selected ids, in the caller's order.
     * @param packageId The deal anchor every facility must belong to.
     * @param actionPlural 'Modifications' or 'Renewals', for the banker copy.
     * @return The facility records, ordered as requested.
     */
    public static List<LLC_BI__Loan__c> validate(
        List<LLC_BI__Loan__c> found,
        List<Id> requested,
        Id packageId,
        String actionPlural
    ) {
        Map<Id, LLC_BI__Loan__c> byId = new Map<Id, LLC_BI__Loan__c>(found);
        List<LLC_BI__Loan__c> ordered = new List<LLC_BI__Loan__c>();

        for (Integer i = 0; i < requested.size(); i++) {
            String pos = ref(i, requested.size());
            Id fid = requested[i];
            LLC_BI__Loan__c loan = byId.get(fid);
            if (loan == null) {
                throw new SelectionException('Facility ' + fid + ' was not found, or is not visible to you' + pos + '.');
            }
            if (loan.LLC_BI__Product_Package__c != packageId) {
                throw new SelectionException(
                    'Facility ' + loan.Name + ' is not on product package ' + packageId + pos + '. ' +
                    'The credit action is anchored on the package, so every selected facility must be a member of it. ' +
                    (loan.LLC_BI__Product_Package__c == null
                        ? 'This facility is on no package at all.'
                        : 'It belongs to ' + loan.LLC_BI__Product_Package__c + '.')
                );
            }
            // Cannot_Check_More_Than_One_Loan_Type has no bypass: a facility is renewed or modified,
            // never both. Mirrored here so the banker is told before the org refuses.
            if (loan.LLC_BI__Is_Modification__c == true && loan.LLC_BI__isRenewal__c == true) {
                throw new SelectionException(
                    'Facility ' + loan.Name + ' is already flagged as both a renewal and a modification' + pos +
                    '. A facility can be renewed or modified, not both.'
                );
            }
            if (loan.LLC_BI__Stage__c != 'Booked' || loan.LLC_BI__Status__c != 'Open') {
                throw new SelectionException(
                    actionPlural + ' apply to booked facilities. ' + loan.Name + ' is in ' +
                    String.valueOf(loan.LLC_BI__Stage__c) + ' with status ' + String.valueOf(loan.LLC_BI__Status__c) + '.' + pos
                );
            }
            ordered.add(loan);
        }
        return ordered;
    }

    /**
     * Counts the loan-level covenant junction rows per facility. nCino clones the junction on a
     * credit action, so an empty count is a real answer and is reported as zero rather than omitted.
     *
     * @param facilityIds The selected facilities.
     * @return Carryover count keyed by facility id. Facilities with none are absent from the map.
     */
    public static Map<Id, Integer> covenantCarryover(List<Id> facilityIds) {
        Map<Id, Integer> out = new Map<Id, Integer>();
        for (AggregateResult ar : [
            SELECT LLC_BI__Loan__c lid, COUNT(Id) cnt
            FROM LLC_BI__Loan_Covenant__c
            WHERE LLC_BI__Loan__c IN :facilityIds
            WITH USER_MODE
            GROUP BY LLC_BI__Loan__c
        ]) {
            out.put((Id) ar.get('lid'), (Integer) ar.get('cnt'));
        }
        return out;
    }

    /**
     * The core lookup key is the third leg of nCino's valid-facility rule. It is surfaced rather
     * than refused: a booked facility without one is a core-sync data issue, not a banker error.
     *
     * @param facilities The validated facilities.
     * @return A sentence naming the facilities missing a key, led by a space so it appends onto the
     *         held-execution warning, or an empty string when every facility has one.
     */
    public static String lookupKeyWarning(List<LLC_BI__Loan__c> facilities) {
        List<String> missing = new List<String>();
        for (LLC_BI__Loan__c l : facilities) {
            if (String.isBlank(l.LLC_BI__lookupKey__c)) {
                missing.add(l.Name);
            }
        }
        if (missing.isEmpty()) {
            return '';
        }
        return ' ' + String.join(missing, ', ') + (missing.size() == 1 ? ' carries' : ' carry') +
            ' no core lookup key, which the org\'s own chains all have; that is a core-sync data issue worth checking before execution unblocks.';
    }

    /**
     * Filters an injected facility list to the requested ids, for the stage tools' test seam.
     *
     * @param seam The injected facilities.
     * @param facilityIds The requested ids.
     * @return The matching injected facilities.
     */
    public static List<LLC_BI__Loan__c> fromSeam(List<LLC_BI__Loan__c> seam, List<Id> facilityIds) {
        Set<Id> wanted = new Set<Id>(facilityIds);
        List<LLC_BI__Loan__c> hits = new List<LLC_BI__Loan__c>();
        for (LLC_BI__Loan__c l : seam) {
            if (wanted.contains(l.Id)) {
                hits.add(l);
            }
        }
        return hits;
    }

    /** Validates one id as a facility id, failing closed (lesson 4b). */
    private static Id facilityId(String raw, String label) {
        Id parsed;
        try {
            parsed = Id.valueOf(raw);
        } catch (Exception e) {
            throw new SelectionException(label + ' is not a record id.');
        }
        if (parsed.getSObjectType() != LLC_BI__Loan__c.SObjectType) {
            throw new SelectionException(label + ' is not a facility id.');
        }
        return parsed;
    }

    /**
     * Positional reference for a batch refusal. Empty for a single facility, so the single-facility
     * banker copy is unchanged from before facilityIds existed.
     */
    private static String ref(Integer index, Integer total) {
        return total == 1 ? '' : ' (facility ' + (index + 1) + ' of ' + total + ')';
    }
}
