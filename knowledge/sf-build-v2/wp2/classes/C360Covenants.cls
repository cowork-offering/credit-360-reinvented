/**
 * C360Covenants - relationship-anchored covenant resolution and the compliance-row precondition.
 *
 * THE ANCHOR IS THE ACCOUNT (founder, 2026-09-13: "covenants and collateral are driven from the
 * relationship; a package is an association, never a filter"). A covenant belongs to a borrower, not
 * to a deal: nCino attaches it to the ACCOUNT and to LOANS, and the package is a read aggregation
 * over those loans. So the scope of a covenant review is every covenant on the relationship, and a
 * product package, where the caller names one, is a NARROWING THE CALLER CHOSE rather than a
 * required anchor. Each covenant carries its associations - the facilities and packages it is tied
 * to - so the room can show them on the row without ever filtering on them.
 *
 * Lives here rather than inside StageCovenantReview because execute_covenant_review has to apply
 * the SAME precondition again at write time, on org state that may have moved since staging. Two
 * copies of a rule this subtle would drift, and the rule is the whole safety argument.
 *
 * THE TRAVERSAL. nCino's own words (kb:kAHHu000000XZTaOAO): "The product package shows an
 * aggregated list of the covenants included in the loans within the package. The user still needs
 * to manage the covenants at the individual loan or Relationship level." So the package is a READ
 * aggregation and the covenant is the unit of management. The aggregation is a UNION, not a
 * loan walk:
 *
 *     package -> loans -> LLC_BI__Loan_Covenant__c  -> covenant     (loan-level)
 *     package -> borrower accounts -> LLC_BI__Account_Covenant__c -> covenant (relationship-level)
 *
 * deduped by covenant id, because nCino's stated best practice is one covenant linked to many
 * loans, so a naive loan-by-loan fan-out double-counts. In `bankinggpt` this is not a corner case:
 * 4 of Hartwell's 6 covenants carry no loan junction at all and a loans-only traversal misses them.
 *
 * THE PRECONDITION. kb:kAHHu000000XZOTOA4, verbatim: "Automation will push the Next Evaluation Date
 * on the associated Covenant Management record when the Status is changed from 'Pending' to
 * 'Compliant', 'Waived' or 'Exception' - using any other status will prevent the automation from
 * firing." A write onto an `In Progress` row therefore succeeds at the DML level and is INERT: the
 * schedule does not move and nothing in the response would say so. That is the failure mode this
 * class exists to prevent, so a non-Pending row is refused per covenant unless the caller opted in
 * explicitly.
 */
public with sharing class C360Covenants {

    /** Raised for a domain-level resolution failure. The calling tool maps it to ok:false. */
    public class ResolutionException extends Exception {}

    /** The only statuses a compliance row may be moved TO. nCino's complete-status set. */
    public static final Set<String> TERMINAL_STATUSES = new Set<String>{ 'Compliant', 'Waived', 'Exception' };

    /** The only source status from which a terminal write actually advances the schedule. */
    public static final String SOURCE_PENDING = 'Pending';

    /** The org's two Reason for Exception values, read live 2026-08-22. */
    public static final Set<String> EXCEPTION_REASONS = new Set<String>{ 'Breached', 'Overdue' };

    /**
     * D8 budget. 24 org-local *CDC triggers enqueue one EventBridgeCallout queueable per record
     * against a platform ceiling of 50 per synchronous transaction, and a terminal status write may
     * make nCino insert the NEXT compliance row, which is a second enqueue on the same object. So
     * budget two per assessment and stop at 20.
     */
    public static final Integer MAX_ASSESSMENTS = 20;

    /** Per-covenant outcome of resolution. `state` is what the banker reads. */
    public static final String STATE_PLANNED = 'planned';
    public static final String STATE_NOT_ASSESSED = 'not_assessed';
    public static final String STATE_NO_COMPLIANCE_ROW = 'not_assessable_no_compliance_row';
    public static final String STATE_NOT_PENDING = 'not_assessable_row_not_pending';
    public static final String STATE_INACTIVE = 'not_assessable_covenant_inactive';

    /** One covenant in package scope, with everything the plan and the banker need. */
    public class Resolved {
        public Id covenantId;
        public String covenantName;
        public String covenantType;
        public Boolean active;
        public Boolean loanLevel;
        public Boolean relationshipLevel;
        public Id complianceId;
        public String complianceStatus;
        /** True when Active + Frequency Template + Effective Date, the three conditions nCino's
            managed trigger needs to mint the NEXT compliance row on a terminal write. */
        public Boolean generatesNextRow;
        /** Frequency Template type, when one is configured. `One-Time` terminates the covenant. */
        public String frequencyTemplateType;
        public String state;
        public String reason;
        /** Every facility junction this covenant carries, with the package each facility sits on.
            An association is shown on the row; it is NEVER a filter (founder, 2026-09-13). The shape
            lives in C360Facilities because collateral valuation surfaces the same one. */
        public List<C360Facilities.Association> associations = new List<C360Facilities.Association>();
    }

    /** The associations of one covenant, as the `[{loanId, loanName, productPackageId, packageName}]` wire string. */
    public static String associationsJson(Resolved r) {
        return C360Facilities.associationsJson(r.associations);
    }

    /**
     * The packages the covenants in a plan are associated with, id to name.
     *
     * @param planned The covenants this plan will write.
     * @return Package id to package name, empty when the covenants reach no package at all.
     */
    public static Map<Id, String> packagesTouched(List<Resolved> planned) {
        List<C360Facilities.Association> all = new List<C360Facilities.Association>();
        for (Resolved r : planned) {
            all.addAll(r.associations);
        }
        return C360Facilities.packagesIn(all);
    }

    /**
     * Resolves the covenants in scope for a review.
     *
     * THE ACCOUNT IS THE ANCHOR AND THE PACKAGE IS A NARROWING (founder, 2026-09-13). With no
     * package the scope is EVERY covenant on the relationship:
     *
     *     account -> LLC_BI__Account_Covenant__c            -> covenant   (relationship-level)
     *     account -> its facilities, across every package,
     *                -> LLC_BI__Loan_Covenant__c            -> covenant   (loan-level)
     *     account -> LLC_BI__Covenant2__c.LLC_BI__Account__c -> covenant   (the covenant's own owner)
     *
     * deduped by covenant id, because nCino's stated best practice is one covenant linked to many
     * loans and a naive facility-by-facility fan-out double-counts. The third arm matters because a
     * covenant can carry the borrower on its own lookup and no junction at all, and "every covenant
     * on the account" has to mean that one too.
     *
     * With a package the traversal is the one nCino's own package view aggregates - its loans'
     * junctions UNION its borrowers' junctions - and it is a SUBSET of the relationship scope. It is
     * offered because a caller may deliberately want to work one deal, never because a covenant
     * needs a deal to exist.
     *
     * @param accountId The relationship anchor. Required unless a package is supplied, in which
     *        case the package's own borrower stands in for it.
     * @param packageId Optional narrowing the caller chose. Null means the whole relationship.
     * @param selection Optional member selection. Null or empty means every covenant in scope.
     * @return The covenants in scope, ordered by covenant name, each carrying its associations.
     *         Templates are excluded: they live in the same table as live covenants and counting
     *         them inflates every sweep.
     */
    public static List<Resolved> resolveScope(Id accountId, Id packageId, List<Id> selection) {
        Set<Id> loanIds = new Set<Id>();
        Set<Id> borrowerIds = new Set<Id>();
        Set<Id> ownedByAccount = new Set<Id>();

        if (packageId != null) {
            List<LLC_BI__Product_Package__c> pkgs = [
                SELECT Id, LLC_BI__Account__c FROM LLC_BI__Product_Package__c WHERE Id = :packageId WITH USER_MODE LIMIT 1
            ];
            if (pkgs.isEmpty()) {
                throw new ResolutionException('Product package ' + packageId + ' was not found, or is not visible to you.');
            }
            if (pkgs[0].LLC_BI__Account__c != null) {
                borrowerIds.add(pkgs[0].LLC_BI__Account__c);
            }
            for (LLC_BI__Loan__c l : [
                SELECT Id, LLC_BI__Account__c FROM LLC_BI__Loan__c
                WHERE LLC_BI__Product_Package__c = :packageId WITH USER_MODE
            ]) {
                loanIds.add(l.Id);
                if (l.LLC_BI__Account__c != null) {
                    borrowerIds.add(l.LLC_BI__Account__c);
                }
            }
        } else {
            if (accountId == null) {
                throw new ResolutionException(
                    'accountId is required when no product package narrows the scope. Covenants are driven from the relationship.'
                );
            }
            borrowerIds.add(accountId);
            for (LLC_BI__Loan__c l : [
                SELECT Id FROM LLC_BI__Loan__c WHERE LLC_BI__Account__c = :accountId WITH USER_MODE
            ]) {
                loanIds.add(l.Id);
            }
            for (LLC_BI__Covenant2__c c : [
                SELECT Id FROM LLC_BI__Covenant2__c
                WHERE LLC_BI__Account__c = :accountId AND LLC_BI__Is_Template__c = false WITH USER_MODE
            ]) {
                ownedByAccount.add(c.Id);
            }
        }

        Set<Id> loanLevel = new Set<Id>();
        Set<Id> relationshipLevel = new Set<Id>(ownedByAccount);
        if (!loanIds.isEmpty()) {
            for (LLC_BI__Loan_Covenant__c lc : [
                SELECT LLC_BI__Covenant2__c FROM LLC_BI__Loan_Covenant__c
                WHERE LLC_BI__Loan__c IN :loanIds AND LLC_BI__Covenant2__c != null WITH USER_MODE
            ]) {
                loanLevel.add(lc.LLC_BI__Covenant2__c);
            }
        }
        if (!borrowerIds.isEmpty()) {
            for (LLC_BI__Account_Covenant__c ac : [
                SELECT LLC_BI__Covenant2__c FROM LLC_BI__Account_Covenant__c
                WHERE LLC_BI__Account__c IN :borrowerIds AND LLC_BI__Covenant2__c != null WITH USER_MODE
            ]) {
                relationshipLevel.add(ac.LLC_BI__Covenant2__c);
            }
        }

        Set<Id> scope = new Set<Id>(loanLevel);
        scope.addAll(relationshipLevel);

        if (selection != null && !selection.isEmpty()) {
            Set<Id> wanted = new Set<Id>(selection);
            for (Id requested : wanted) {
                if (!scope.contains(requested)) {
                    throw new ResolutionException(
                        packageId == null
                            ? ('Covenant ' + requested + ' is not a covenant of relationship ' + accountId + '. ' +
                               'The relationship holds the covenants on its own account and the covenants of its facilities across every package; this one reaches it through none of those.')
                            : ('Covenant ' + requested + ' is not a covenant of product package ' + packageId + '. ' +
                               'The package aggregates the covenants of its loans and of its borrower relationships; this one reaches it through neither.')
                    );
                }
            }
            scope.retainAll(wanted);
        }

        return hydrate(scope, loanLevel, relationshipLevel);
    }

    /**
     * Reads each covenant, picks the compliance row a review would act on, and states why a
     * covenant cannot be assessed when it cannot.
     *
     * The row picked is the OPEN one with the earliest due date, matching ACT's own eligibility
     * rule: "Tests covenants with compliances in the In Progress and Pending statuses. Excludes
     * covenants if the compliance status is Waived, Exception, or Compliant" (mapId:FE_EonXfEU5WbW_VcgN7kw).
     * When no open row exists the most recent row is reported anyway, because "this covenant was
     * closed out on 3 March" is a better answer than silence.
     */
    private static List<Resolved> hydrate(Set<Id> scope, Set<Id> loanLevel, Set<Id> relationshipLevel) {
        List<Resolved> out = new List<Resolved>();
        if (scope.isEmpty()) {
            return out;
        }

        Map<Id, LLC_BI__Covenant2__c> covenants = new Map<Id, LLC_BI__Covenant2__c>([
            SELECT Id, Name, LLC_BI__Active__c, LLC_BI__Is_Template__c, LLC_BI__Effective_Date__c,
                   LLC_BI__Frequency_Template__c, LLC_BI__Frequency_Template__r.LLC_BI__Template_Type__c,
                   LLC_BI__Covenant_Type__r.Name
            FROM LLC_BI__Covenant2__c
            WHERE Id IN :scope AND LLC_BI__Is_Template__c = false
            WITH USER_MODE
            ORDER BY Name ASC
        ]);

        Map<Id, List<C360Facilities.Association>> associations = hydrateAssociations(covenants.keySet());

        Map<Id, LLC_BI__Covenant_Compliance2__c> openRow = new Map<Id, LLC_BI__Covenant_Compliance2__c>();
        Map<Id, LLC_BI__Covenant_Compliance2__c> latestRow = new Map<Id, LLC_BI__Covenant_Compliance2__c>();
        for (LLC_BI__Covenant_Compliance2__c cc : [
            SELECT Id, LLC_BI__Covenant__c, LLC_BI__Status__c
            FROM LLC_BI__Covenant_Compliance2__c
            WHERE LLC_BI__Covenant__c IN :covenants.keySet()
            WITH USER_MODE
            ORDER BY LLC_BI__Due_Date__c ASC NULLS LAST, CreatedDate ASC
        ]) {
            Id cid = cc.LLC_BI__Covenant__c;
            latestRow.put(cid, cc);
            Boolean isOpen = cc.LLC_BI__Status__c == SOURCE_PENDING || cc.LLC_BI__Status__c == 'In Progress';
            if (isOpen && !openRow.containsKey(cid)) {
                openRow.put(cid, cc);
            }
        }

        for (LLC_BI__Covenant2__c c : covenants.values()) {
            Resolved r = new Resolved();
            r.covenantId = c.Id;
            r.covenantName = c.Name;
            r.covenantType = c.LLC_BI__Covenant_Type__r == null ? null : c.LLC_BI__Covenant_Type__r.Name;
            r.active = c.LLC_BI__Active__c == true;
            r.loanLevel = loanLevel.contains(c.Id);
            r.relationshipLevel = relationshipLevel.contains(c.Id);
            r.frequencyTemplateType = c.LLC_BI__Frequency_Template__r == null
                ? null
                : c.LLC_BI__Frequency_Template__r.LLC_BI__Template_Type__c;
            r.generatesNextRow = r.active && c.LLC_BI__Frequency_Template__c != null && c.LLC_BI__Effective_Date__c != null;

            LLC_BI__Covenant_Compliance2__c row = openRow.containsKey(c.Id) ? openRow.get(c.Id) : latestRow.get(c.Id);
            if (row != null) {
                r.complianceId = row.Id;
                r.complianceStatus = row.LLC_BI__Status__c;
            }
            r.state = STATE_NOT_ASSESSED;
            if (associations.containsKey(c.Id)) {
                r.associations = associations.get(c.Id);
            }
            out.add(r);
        }
        return out;
    }

    /**
     * Every facility junction each covenant carries, with the package behind each facility.
     *
     * ONE query for the whole scope, and it is deliberately NOT constrained by the caller's package:
     * an association is what the row shows, so narrowing it to the package the caller happened to
     * name would hide exactly the cross-deal ties the room exists to surface. A covenant with no
     * junction gets an empty list, which is a real answer and renders as "not tied to a facility".
     *
     * @param scope The covenant ids in scope.
     * @return Covenant id to its associations, ordered by facility name.
     */
    private static Map<Id, List<C360Facilities.Association>> hydrateAssociations(Set<Id> scope) {
        Map<Id, List<C360Facilities.Association>> out = new Map<Id, List<C360Facilities.Association>>();
        if (scope.isEmpty()) {
            return out;
        }
        for (LLC_BI__Loan_Covenant__c j : [
            SELECT LLC_BI__Covenant2__c, LLC_BI__Loan__c, LLC_BI__Loan__r.Name,
                   LLC_BI__Loan__r.LLC_BI__Product_Package__c,
                   LLC_BI__Loan__r.LLC_BI__Product_Package__r.Name
            FROM LLC_BI__Loan_Covenant__c
            WHERE LLC_BI__Covenant2__c IN :scope AND LLC_BI__Loan__c != null
            WITH USER_MODE
            ORDER BY LLC_BI__Loan__r.Name ASC
        ]) {
            if (!out.containsKey(j.LLC_BI__Covenant2__c)) {
                out.put(j.LLC_BI__Covenant2__c, new List<C360Facilities.Association>());
            }
            out.get(j.LLC_BI__Covenant2__c).add(C360Facilities.association(
                j.LLC_BI__Loan__c,
                j.LLC_BI__Loan__r == null ? null : j.LLC_BI__Loan__r.Name,
                j.LLC_BI__Loan__r == null ? null : j.LLC_BI__Loan__r.LLC_BI__Product_Package__c,
                j.LLC_BI__Loan__r == null || j.LLC_BI__Loan__r.LLC_BI__Product_Package__r == null
                    ? null
                    : j.LLC_BI__Loan__r.LLC_BI__Product_Package__r.Name
            ));
        }
        return out;
    }

    /**
     * Applies the write precondition to one resolved covenant and stamps its state and reason.
     *
     * Called at STAGE time so a plan never promises a write the org will make inert, and again at
     * EXECUTE time against the re-read row so a resumed run never writes onto state that moved.
     *
     * @param r The resolved covenant, mutated in place.
     * @param allowNonPending The caller's explicit opt-in to writing onto a non-Pending row.
     * @return True when the covenant may be written.
     */
    public static Boolean applyPrecondition(Resolved r, Boolean allowNonPending) {
        if (!r.active) {
            r.state = STATE_INACTIVE;
            r.reason = 'The covenant is not Active. nCino evaluates Active covenants only, and activation is the bank\'s own booking automation.';
            return false;
        }
        if (r.complianceId == null) {
            r.state = STATE_NO_COMPLIANCE_ROW;
            r.reason = 'No compliance row exists. nCino generates them only for an Active covenant that carries a Frequency Template and an Effective Date, and creating one here is forbidden: a create is what raises the bank\'s covenant approval work item.';
            return false;
        }
        if (r.complianceStatus != SOURCE_PENDING) {
            if (allowNonPending != true) {
                r.state = STATE_NOT_PENDING;
                r.reason = 'The compliance row is at ' + String.valueOf(r.complianceStatus) +
                    ', not Pending. Only a Pending row advances the schedule when it moves to a complete status, so a write here would succeed and change nothing. ' +
                    'Set allowNonPending to record the assessment on the row anyway, knowing the schedule will not move.';
                return false;
            }
            r.state = STATE_PLANNED;
            r.reason = 'The compliance row is at ' + String.valueOf(r.complianceStatus) +
                ' rather than Pending and allowNonPending was set. The assessment will be recorded; the covenant schedule will NOT advance.';
            return true;
        }
        r.state = STATE_PLANNED;
        r.reason = null;
        return true;
    }

    /**
     * The structural approval-trap warning, per covenant.
     *
     * Three vendor sources say that moving a compliance row into a complete status is what makes
     * nCino CREATE the next compliance row, and that create is what fires
     * `acnpex_covenantApprovalProcess`, an ApprovalWorkflow with zero entry filters assigned to a
     * named human. So an update-only tool can still start the chain indirectly. The condition is
     * read from the covenant, never assumed.
     *
     * @param planned The covenants this plan will write.
     * @return Warning sentences, empty when no covenant in the plan can generate a next row.
     */
    public static List<String> generationWarnings(List<Resolved> planned) {
        List<String> names = new List<String>();
        List<String> terminating = new List<String>();
        for (Resolved r : planned) {
            if (r.generatesNextRow == true) {
                names.add(r.covenantName);
                if (r.frequencyTemplateType == 'One-Time') {
                    terminating.add(r.covenantName);
                }
            }
        }

        List<String> out = new List<String>();
        if (names.isEmpty()) {
            out.add(
                'No covenant in this plan carries the Active plus Frequency Template plus Effective Date combination nCino needs to mint the next compliance row, ' +
                'so completing these rows is not expected to create a successor row or raise a covenant approval. Execution measures this rather than asserting it.'
            );
            return out;
        }
        out.add(
            'COMPLETING THESE ROWS MAY MINT THE NEXT ONE. ' + String.join(names, ', ') +
            ' ' + (names.size() == 1 ? 'is' : 'are') + ' Active with a Frequency Template and an Effective Date, which is the configuration nCino\'s managed trigger uses to create the NEXT compliance record when this one reaches a complete status. ' +
            'That create is what raises the bank\'s covenant approval work item, and it is assigned to a named human. This tool creates nothing itself; the platform may.'
        );
        if (!terminating.isEmpty()) {
            out.add(
                'ONE-TIME COVENANT, TERMINATING. ' + String.join(terminating, ', ') +
                ' ' + (terminating.size() == 1 ? 'carries' : 'carry') + ' a One-Time frequency template. nCino generates no further compliance record and marks the covenant Inactive once this row reaches a complete status. That is not reversible through this tool.'
            );
        }
        return out;
    }

    /** Validates a status against the complete-status set, naming what the org actually offers. */
    public static void assertStatus(String status, String itemRef) {
        if (String.isBlank(status) || !TERMINAL_STATUSES.contains(status)) {
            throw new ResolutionException(
                'status must be Compliant, Waived or Exception' + itemRef +
                '. Those are the three complete statuses nCino advances a schedule on. This org\'s compliance status picklist holds ' +
                'Compliant, Exception, In Progress, Pending and Waived, and carries no separate non-compliant value: a failed test is recorded as ' +
                'Exception with Reason for Exception = Breached.'
            );
        }
    }

    /** Validates a Reason for Exception against the org's two values. */
    public static void assertReason(String reason, String itemRef) {
        if (String.isNotBlank(reason) && !EXCEPTION_REASONS.contains(reason)) {
            throw new ResolutionException(
                'reasonForException must be Breached or Overdue' + itemRef +
                '. Those are the only two values this org offers, and they are what separates a failed test from an undelivered document.'
            );
        }
    }
}
