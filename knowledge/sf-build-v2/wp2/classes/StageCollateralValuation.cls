/**
 * StageCollateralValuation - MCP tool: stage_collateral_valuation.
 *
 * A33.0.1: this tool performs ZERO domain-object DML. It validates the request against the
 * A33.4.5 org contract, computes the execution plan, and returns a plan hash with a staging
 * handle and a decision token. The only row it writes is the staging record, which is not a
 * domain object in the bank's credit model.
 *
 * The plan carries the collateral-rollup verification step A33.4.5(d) requires. nCino binds the
 * collateral auto-update to the Add Valuation button and states it does not function via New, and
 * this org had zero prior valuation rows, so whether the parent moves is genuinely unsettled. The
 * plan re-queries the collateral and the terminal state reports "valuation filed, collateral value
 * unchanged" when it did not move. No coverage improvement is claimed on an unproven rollup.
 *
 * INPUT SHAPE AND THE required=true TRAP. This tool takes EITHER the flat single-item fields OR
 * items[], and neither may be flagged required=true on the invocable variable. `required=true` is
 * enforced by the REST Actions API BEFORE Apex runs, so leaving it on the flat fields made an
 * items-only call impossible: the platform refused it with REQUIRED_FIELD_MISSING and our Apex never
 * executed. Direct Apex test invocations do not enforce required-ness, so no unit test can catch
 * this: it is only observable on the wire. Requiredness is therefore enforced in Apex, where it can
 * also say WHICH item is wrong. `productPackageId` and `valuationDate` became required in this wave
 * and are enforced the same way, for the same reason plus one more: a platform-level refusal returns
 * REQUIRED_FIELD_MISSING and nothing else, where Apex can name the field, the reason and the item.
 *
 * THE ANCHOR IS THE RELATIONSHIP, 2026-09-13 (founder: "covenants and collateral are driven from
 * the relationship; a package is an association, never a filter"). A bank's collateral belongs to
 * the BORROWER: LLC_BI__Collateral__c carries no account lookup at all and reaches the relationship
 * only through LLC_BI__Account_Collateral__c, while a pledge ties it to a facility and, through that
 * facility, to a package. So `accountId` is the anchor and the scope is every asset the account
 * owns, wherever it is pledged; `productPackageId` is OPTIONAL and, where given, is a narrowing THE
 * CALLER CHOSE. Every item reports its ASSOCIATIONS - the facilities it is pledged to and the
 * packages those facilities sit on - as data the room shows on the row, never as a filter.
 *
 * BACK-COMPAT IS DELIBERATE. A caller sending `productPackageId` alone keeps working: the borrower
 * is derived from the package's own LLC_BI__Account__c and becomes the anchor, and membership is
 * proved against the package exactly as before. The deployed cockpit 0.9.23 sends the package.
 *
 * WHAT THE 2026-08-22 WAVE HARDENED, AND WHY EACH ONE MATTERED.
 *   1. AN ANCHOR AT ALL. The tool used to derive its account and package by reading whichever
 *      pledge it happened to see first, which meant a batch could span relationships and nothing
 *      said so. Every item is now proved to reach the anchor before anything is staged: owned by
 *      the relationship, or pledged to one of its facilities. Where the caller narrows to a package
 *      the narrower package test runs in place of it, because the package scope is a strict subset
 *      and the refusal should name the deal the banker is working with.
 *   2. BATCH CAP OF 20. items[] was unbounded. 24 org-local *CDC triggers enqueue one
 *      EventBridgeCallout queueable PER RECORD against a platform ceiling of 50 queued jobs per
 *      synchronous transaction, so a 51-item call raised "Too many queueable jobs added to the
 *      queue" and rolled the whole insert back. That was a live uncapped exposure on a deployed
 *      tool. 20 leaves headroom for the platform's own async work on the same objects.
 *   3. VALUATION DATE REQUIRED. nCino: "The system uses this field to determine the latest valuation
 *      record" (mapId:AxjTjH5MIQKVIp_wnaek5g), and names it as a required input for the collateral
 *      auto-update (mapId:2opWW8UJI0Rg_v6i6wVYoQ). A null-dated valuation is unorderable in nCino's
 *      own latest-wins logic, so it is refused rather than defaulted: defaulting to today makes
 *      same-date collisions the normal case, which is the next item.
 *   4. SAME COLLATERAL, SAME DATE, REFUSED. PDI-00020349: two valuations on one collateral with the
 *      same Valuation Date raise "System.ListException: Duplicate id in list" (affected 2025_04,
 *      resolved 2025_10). This org is on a 2026 release so the defect is likely fixed here, and the
 *      refusal stands anyway: two valuations of one asset on one date is a data-quality problem
 *      before it is a defect workaround.
 *
 * Org contract: A33.4.5. Write evidence: PROBE-LEDGER.md probe 1 (CONFIRMED, 2026-07-25).
 */
global with sharing class StageCollateralValuation {

    /** Raised for a domain-level validation failure. Surfaces as ok:false, never as a fault. */
    public class ToolException extends Exception {}

    /**
     * The batch ceiling. 24 org-local *CDC triggers enqueue one EventBridgeCallout queueable per
     * record and the platform allows 50 per synchronous transaction, so this is a governor budget
     * rather than a business threshold and belongs in the code.
     */
    public static final Integer MAX_ITEMS = 20;

    /**
     * One valuation in a batch. The flat fields on Request remain the single-item path and are
     * folded into a one-element list, so every existing caller keeps working unchanged.
     */
    global class ValuationItem {
        @InvocableVariable(label='Collateral Id' description='Required in practice, enforced in Apex. Not flagged required=true: see the class header on Actions-API enforcement.')
        global String collateralId;
        @InvocableVariable(label='Value' description='Required in practice, enforced in Apex.')
        global Decimal value;
        @InvocableVariable(label='Valuation Date' description='Required in practice, enforced in Apex. nCino uses this field to decide which valuation is the latest, so a null-dated row is unorderable in the platform\'s own logic.')
        global Date valuationDate;
        @InvocableVariable(label='Type')
        global String type;
        @InvocableVariable(label='Source')
        global String source;
        @InvocableVariable(label='Description')
        global String description;
        @InvocableVariable(label='Primary')
        global Boolean primary;
    }

    global class Request {
        @InvocableVariable(label='Idempotency Key' description='Client-generated, stable across resume. Enforced by us, never assumed from the platform.' required=true)
        global String idempotencyKey;
        @InvocableVariable(label='Rationale' description='Why this valuation is being filed. Feeds the audit ledger.' required=true)
        global String rationale;
        @InvocableVariable(label='Account Id' description='THE ANCHOR. The relationship that owns the assets being valued: every collateral in the batch must be owned by it through LLC_BI__Account_Collateral__c, wherever it happens to be pledged. Required in Apex unless productPackageId is supplied, in which case the borrower is derived from the package.')
        global String accountId;
        @InvocableVariable(label='Product Package Id' description='OPTIONAL NARROWING, never an anchor. Supply it to work one deal and every collateral must additionally reach that package, by pledge to one of its loans or by ownership through its borrower. Omit it and the scope is every asset the relationship owns. Each item reports the facilities and packages it is pledged to either way; the association is shown, never used to filter.')
        global String productPackageId;
        @InvocableVariable(label='Collateral Id' description='Single-item path. Supply this and value, OR items, never both. Not flagged required=true because items supersedes it; requiredness is enforced in Apex.')
        global String collateralId;
        @InvocableVariable(label='Value' description='Single-item path. The valuation amount.')
        global Decimal value;
        @InvocableVariable(label='Valuation Date')
        global Date valuationDate;
        @InvocableVariable(label='Type' description='LLC_BI__Type__c picklist value, read from the org. For example Fair Market Value - Real Estate, Net Orderly Liquidation Value, As Is Value.')
        global String type;
        @InvocableVariable(label='Source' description='LLC_BI__Source__c picklist value, read from the org. For example Appraisal, Internal Valuation, Third Party Source.')
        global String source;
        @InvocableVariable(label='Description')
        global String description;
        @InvocableVariable(label='Primary' description='Set explicitly. The three booleans on this object default to false, so a revaluation states its intent.')
        global Boolean primary;
        @InvocableVariable(label='Items' description='Bulk path: value several collaterals in one plan, one staging row, one token. Leave empty and the flat fields above are used as a single item.')
        global List<ValuationItem> items;
    }

    global class PlanStep {
        @InvocableVariable(label='Step Id')
        global String id;
        @InvocableVariable(label='Type' description='write, verification, wait, handoff or observed_side_effect.')
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

    global class PlannedItem {
        @InvocableVariable(label='Collateral Id')
        global String collateralId;
        @InvocableVariable(label='Collateral Name')
        global String collateralName;
        @InvocableVariable(label='Value')
        global Decimal value;
        @InvocableVariable(label='Associations' description='The facilities and packages this asset is pledged to, as JSON: [{"loanId","loanName","productPackageId","packageName"}]. An empty list means the asset is owned but pledged nowhere, which is a real answer about an unencumbered asset rather than a gap. This is DATA THE ROOM SHOWS on the row; it is never a filter and never a narrowing control.')
        global String associations;
        @InvocableVariable(label='Write Step Id')
        global String writeStepId;
        @InvocableVariable(label='Verify Step Id')
        global String verifyStepId;
        @InvocableVariable(label='Rollup Step Id')
        global String rollupStepId;
    }

    global class StageResult {
        @InvocableVariable(label='Staging Id')
        global String stagingId;
        @InvocableVariable(label='Plan Hash')
        global String planHash;
        @InvocableVariable(label='Decision Token' description='Single use, bound to this staging id, plan hash and user. Null on an idempotent replay: the caller already holds it.')
        global String decisionToken;
        @InvocableVariable(label='Summary' description='What will be written, in banker language. Drives the confirm gate copy.')
        global String summary;
        @InvocableVariable(label='Steps')
        global List<PlanStep> steps;
        @InvocableVariable(label='Warnings')
        global List<String> warnings;
        @InvocableVariable(label='Provenance JSON')
        global String provenanceJson;
        @InvocableVariable(label='Account Id' description='The relationship this plan is anchored on, and the anchor the staging row carries.')
        global String accountId;
        @InvocableVariable(label='Product Package Id' description='The single package this plan touches, where every asset it values is pledged into exactly one. Null where they span several packages or none: there is then no one deal to deep-link to, and the staging row carries no package either.')
        global String productPackageId;
        @InvocableVariable(label='Items' description='One entry per valuation in the batch, with its associations and the plan step ids that belong to it.')
        global List<PlannedItem> items;
        @InvocableVariable(label='Item Count')
        global Integer itemCount;
        @InvocableVariable(label='Replayed')
        global Boolean replayed;
        @InvocableVariable(label='Token Rotated' description='True when this call re-issued the confirmation token for a plan the org already held at Staged: the earlier token, which the caller never received, is void. At most one valid token exists per staging row.')
        global Boolean tokenRotated;
    }

    global class Response {
        @InvocableVariable(label='OK' description='Discriminates the typed result. Domain failure is a successful invocation carrying ok = false.')
        global Boolean ok;
        @InvocableVariable(label='Result')
        global StageResult result;
        @InvocableVariable(label='Error')
        global ToolError error;
    }

    /**
     * Stages a collateral valuation. Writes no domain record.
     *
     * @param requests One request per staged action. Element i of the response belongs to input i.
     * @return One response per request. A domain failure carries ok = false and does not
     *         contaminate its siblings.
     */
    @InvocableMethod(
        label='stage_collateral_valuation'
        description='Validate a collateral valuation against the org contract and return an immutable execution plan with a plan hash and a single-use decision token. accountId is the anchor: the scope is every asset the RELATIONSHIP owns, wherever it is pledged, plus anything pledged to its facilities. productPackageId is an OPTIONAL narrowing the caller chooses, never a requirement, and a caller that sends only a package still works because the borrower is derived from it. Every item reports the facilities and packages it is pledged to, as data to show rather than as a filter. Writes NO domain record: the valuation itself is created only by execute_collateral_valuation behind the token gate.'
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
        if (String.isBlank(req.rationale)) {
            throw new ToolException('rationale is required. It feeds the audit ledger.');
        }
        if (String.isBlank(req.accountId) && String.isBlank(req.productPackageId)) {
            throw new ToolException(
                'accountId is required. It is the anchor, and every collateral valued must be provably owned by it through the ' +
                'Collateral Ownership junction: LLC_BI__Collateral__c carries no account lookup of its own. productPackageId is only ' +
                'a narrowing the caller chooses; send it alone and the borrower is derived from it.'
            );
        }
        Id packageId = String.isBlank(req.productPackageId) ? null : C360Facilities.packageId(req.productPackageId);

        List<ValuationItem> items = normalise(req);
        if (items.isEmpty()) {
            throw new ToolException('At least one valuation is required: supply items, or the single collateralId and value.');
        }
        if (items.size() > MAX_ITEMS) {
            throw new ToolException(
                'items carries ' + items.size() + ' valuations; the cap is ' + MAX_ITEMS + ' per plan. ' +
                'Every valuation insert wakes a change-data trigger that enqueues one queueable per record, against a platform ceiling of 50 queued jobs ' +
                'per synchronous transaction, and exceeding it rolls the whole insert back rather than filing what it could. Stage the rest as a second plan.'
            );
        }

        Set<String> seen = new Set<String>();
        Set<Id> collateralIds = new Set<Id>();
        for (Integer i = 0; i < items.size(); i++) {
            ValuationItem it = items[i];
            String itemRef = ' (item ' + (i + 1) + ' of ' + items.size() + ')';
            if (String.isBlank(it.collateralId)) {
                throw new ToolException('collateralId is required' + itemRef + '. It is the one hard-required field on the valuation object.');
            }
            if (it.value == null) {
                throw new ToolException('value is required' + itemRef + '.');
            }
            if (it.value < 0) {
                throw new ToolException('value must not be negative' + itemRef + '. A zero valuation and a missing valuation are different facts.');
            }
            if (it.valuationDate == null) {
                throw new ToolException(
                    'valuationDate is required' + itemRef +
                    '. nCino uses it to decide which valuation record is the latest, so a null-dated row cannot be ordered against the ones already on file. ' +
                    'It is not defaulted to today: that would make two valuations of one asset on one date the normal case, which the platform has raised errors on.'
                );
            }
            if (seen.contains(it.collateralId)) {
                throw new ToolException(
                    'collateral ' + it.collateralId + ' appears more than once' + itemRef +
                    '. Two valuations of the same collateral in one batch would race each other for Primary.'
                );
            }
            seen.add(it.collateralId);
            assertPicklist('LLC_BI__Type__c', it.type, itemRef);
            assertPicklist('LLC_BI__Source__c', it.source, itemRef);
            collateralIds.add(it.collateralId);
        }

        Map<Id, LLC_BI__Collateral__c> collateralById = new Map<Id, LLC_BI__Collateral__c>([
            SELECT Id, Name, LLC_BI__Value__c, LLC_BI__Lendable_Value__c
            FROM LLC_BI__Collateral__c
            WHERE Id IN :collateralIds
            WITH USER_MODE
        ]);
        for (ValuationItem it : items) {
            if (!collateralById.containsKey(it.collateralId)) {
                throw new ToolException('Collateral ' + it.collateralId + ' was not found, or is not visible to you.');
            }
        }

        Id accountId = anchorAccount(req, packageId);
        assertReachesAnchor(items, collateralById, accountId, packageId);
        assertNoSameDateValuation(items, collateralById);

        // THE ASSOCIATIONS. One query over every asset in the batch, deliberately NOT constrained by
        // the caller's package: an association is what the row SHOWS, so narrowing it to the package
        // the caller happened to name would hide exactly the cross-deal pledges the room exists to
        // surface (three of Hartwell's four assets are pledged to two facilities each).
        Map<Id, List<C360Facilities.Association>> associations = pledgeAssociations(collateralById.keySet());
        List<C360Facilities.Association> allAssociations = new List<C360Facilities.Association>();
        for (ValuationItem it : items) {
            if (associations.containsKey(it.collateralId)) {
                allAssociations.addAll(associations.get(it.collateralId));
            }
        }
        Map<Id, String> touchedPackages = C360Facilities.packagesIn(allAssociations);
        Id anchorPackageId = touchedPackages.size() == 1
            ? new List<Id>(touchedPackages.keySet())[0]
            : null;

        Map<String, Object> resolved = new Map<String, Object>{
            'itemCount' => items.size(),
            'accountId' => String.valueOf(accountId),
            'productPackageId' => packageId == null ? null : String.valueOf(packageId),
            'anchorPackageId' => anchorPackageId == null ? null : String.valueOf(anchorPackageId)
        };
        List<C360Plan.Step> steps = new List<C360Plan.Step>();
        List<PlannedItem> planned = new List<PlannedItem>();

        for (Integer i = 0; i < items.size(); i++) {
            ValuationItem it = items[i];
            LLC_BI__Collateral__c coll = collateralById.get(it.collateralId);
            Boolean isPrimary = it.primary == true;
            String n = String.valueOf(i);

            // Per-item values are namespaced into the plan so execute replays each one exactly.
            resolved.put('item' + n + '.LLC_BI__Collateral__c', it.collateralId);
            resolved.put('item' + n + '.LLC_BI__Value__c', it.value);
            resolved.put('item' + n + '.LLC_BI__Valuation_Date__c', it.valuationDate);
            resolved.put('item' + n + '.LLC_BI__Type__c', it.type);
            resolved.put('item' + n + '.LLC_BI__Source__c', it.source);
            resolved.put('item' + n + '.LLC_BI__Valuation_Description__c', it.description);
            resolved.put('item' + n + '.LLC_BI__Primary__c', isPrimary);

            steps.add(
                new C360Plan.Step('write_valuation_' + n, C360Plan.TYPE_WRITE, 'File the valuation against ' + coll.Name)
                    .onObject(C360WriteGuard.OBJ_VALUATION, new List<String>{
                        'LLC_BI__Collateral__c', 'LLC_BI__Value__c', 'LLC_BI__Valuation_Date__c', 'LLC_BI__Type__c',
                        'LLC_BI__Source__c', 'LLC_BI__Valuation_Description__c', 'LLC_BI__Primary__c',
                        'LLC_BI__Active__c', 'LLC_BI__Original_Value__c'
                    })
                    .wakes(new List<String>{ 'LLC_BI.CollateralValuationTrigger (before insert only)' })
                    .provenBy('SELECT Id, Name, LLC_BI__Value__c FROM LLC_BI__Collateral_Valuation__c WHERE Id = :newId')
            );
            steps.add(
                new C360Plan.Step('verify_valuation_' + n, C360Plan.TYPE_VERIFICATION, 'Confirm the valuation for ' + coll.Name + ' landed')
                    .onObject(C360WriteGuard.OBJ_VALUATION, new List<String>{ 'LLC_BI__Value__c' })
                    .provenBy('SELECT Id, LLC_BI__Value__c FROM LLC_BI__Collateral_Valuation__c WHERE Id = :newId')
            );
            steps.add(
                new C360Plan.Step('verify_rollup_' + n, C360Plan.TYPE_VERIFICATION, 'Re-read ' + coll.Name + ' to see whether the value rolled up')
                    .onObject('LLC_BI__Collateral__c', new List<String>{ 'LLC_BI__Value__c', 'LLC_BI__Lendable_Value__c' })
                    .provenBy('SELECT Id, LLC_BI__Value__c, LLC_BI__Lendable_Value__c FROM LLC_BI__Collateral__c WHERE Id = :collateralId')
            );

            PlannedItem pi = new PlannedItem();
            pi.collateralId = it.collateralId;
            pi.collateralName = coll.Name;
            pi.value = it.value;
            pi.associations = C360Facilities.associationsJson(associations.get(it.collateralId));
            pi.writeStepId = 'write_valuation_' + n;
            pi.verifyStepId = 'verify_valuation_' + n;
            pi.rollupStepId = 'verify_rollup_' + n;
            planned.add(pi);
        }

        List<String> warnings = new List<String>{
            'nCino binds the collateral auto-update to the Add Valuation button and it does not fire headlessly. Wave 3 probe 6 settled this on both arms: filing a valuation does NOT move the collateral value. Each item reports its own rollup answer and none of them claims a coverage improvement.',
            'Sub-collateral creation is not offered: it fires the parent validation rules even when nothing changed, and the documented workaround has no headless equivalent.'
        };
        if (items.size() > 1) {
            warnings.add(
                'This is one batch of ' + items.size() + ' valuations under a single confirmation. Each is written and verified separately, ' +
                'so a failure on one is reported against that collateral and does not silently discard the others.'
            );
        }
        List<String> packageNames = new List<String>();
        for (Id p : touchedPackages.keySet()) {
            packageNames.add(touchedPackages.get(p) == null ? String.valueOf(p) : touchedPackages.get(p));
        }
        packageNames.sort();
        warnings.add(
            'Every asset in this batch was proved to reach this relationship before anything was staged: owned through the ' +
            'Collateral Ownership junction, which is the only account anchor LLC_BI__Collateral__c has, or pledged to one of ' +
            'the relationship\'s facilities. ' +
            (packageId == null
                ? 'No product package was named: the caller is valuing the relationship\'s assets rather than one deal\'s. '
                : 'The caller narrowed the batch to one package, and every asset was proved to reach it too. ') +
            (packageNames.isEmpty()
                ? 'None of these assets is pledged anywhere, so no facility\'s coverage moves.'
                : (packageNames.size() == 1
                    ? 'They are pledged into package ' + packageNames[0] + '.'
                    : 'They are pledged across ' + packageNames.size() + ' packages: ' + String.join(packageNames, ', ') +
                      '. That is what each item\'s associations report, and it is shown rather than filtered on.'))
        );

        Map<String, Object> provenance = new Map<String, Object>{
            'LLC_BI__Collateral__c' => new Map<String, String>{ 'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => 'Selected collateral records.' },
            'LLC_BI__Value__c' => new Map<String, String>{ 'prefill' => 'BANKER', 'provenance' => null, 'citation' => null },
            'LLC_BI__Active__c' => new Map<String, String>{ 'prefill' => 'COMPUTED', 'provenance' => 'DERIVED', 'citation' => 'A33.4.5(a): the three booleans default to false, so a revaluation sets Active and Primary explicitly.' }
        };

        String summary = items.size() == 1
            ? 'Files a new valuation of ' + String.valueOf(items[0].value) + ' against collateral ' +
              collateralById.get(items[0].collateralId).Name + '. Creates one valuation record, marked Active' +
              (items[0].primary == true ? ' and Primary' : '') + ' and not the original value. No status is changed anywhere and no credit decision is made or implied.'
            : 'Files ' + items.size() + ' new valuations in one batch, each marked Active and not the original value. ' +
              'Every item is written and verified on its own, and each reports whether its collateral value moved. ' +
              'No status is changed anywhere and no credit decision is made or implied.';

        String planJson = C360Plan.serializePlan(summary, steps, warnings, provenance, resolved);
        String planHash = C360Plan.hash('collateral-valuation', steps, resolved);

        C360ActionStaging.Staged staged = C360ActionStaging.stagePlan(
            'collateral-valuation', req.idempotencyKey, accountId, anchorPackageId, planJson, planHash
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
        r.accountId = accountId;
        r.productPackageId = anchorPackageId;
        r.items = planned;
        r.itemCount = planned.size();
        r.steps = toWireSteps(steps);
        return r;
    }

    /**
     * Folds the single-item flat fields into a one-element list so the old shape keeps working.
     * Supplying both is refused rather than silently merged: a caller who does that has two
     * different intentions and we should not guess which one wins.
     */
    private static List<ValuationItem> normalise(Request req) {
        Boolean hasFlat = String.isNotBlank(req.collateralId) || req.value != null;
        Boolean hasItems = req.items != null && !req.items.isEmpty();

        if (hasFlat && hasItems) {
            throw new ToolException(
                'Supply either the single collateralId and value, or items, but not both. Two shapes in one request is two intentions.'
            );
        }
        if (!hasFlat && !hasItems) {
            throw new ToolException(
                'No valuation supplied. Provide items[], or the single collateralId and value. ' +
                'These are not flagged required on the invocable because either shape is valid, so the check lives here.'
            );
        }
        if (hasItems) {
            return req.items;
        }

        ValuationItem one = new ValuationItem();
        one.collateralId = req.collateralId;
        one.value = req.value;
        one.valuationDate = req.valuationDate;
        one.type = req.type;
        one.source = req.source;
        one.description = req.description;
        one.primary = req.primary;
        return new List<ValuationItem>{ one };
    }

    /**
     * The relationship this plan anchors on.
     *
     * The caller's `accountId` where one was sent. Otherwise the package's own borrower, which is
     * what keeps the deployed cockpit's package-only call working without a second plan shape. When
     * BOTH arrive they must agree: a package on another relationship is refused by name rather than
     * silently anchored on one of the two.
     *
     * @param req The staged request.
     * @param packageId The caller's narrowing, already parsed, or null.
     * @return The anchor account.
     */
    private static Id anchorAccount(Request req, Id packageId) {
        Id said = null;
        if (String.isNotBlank(req.accountId)) {
            try {
                said = Id.valueOf(req.accountId);
            } catch (Exception e) {
                throw new ToolException('accountId ' + req.accountId + ' is not a record id.');
            }
            if (said.getSObjectType() != Account.SObjectType) {
                throw new ToolException('accountId ' + said + ' is not an account id.');
            }
        }
        if (packageId == null) {
            return said;
        }

        List<LLC_BI__Product_Package__c> pkgs = [
            SELECT Id, Name, LLC_BI__Account__c FROM LLC_BI__Product_Package__c WHERE Id = :packageId WITH USER_MODE LIMIT 1
        ];
        if (pkgs.isEmpty()) {
            throw new ToolException('Product package ' + packageId + ' was not found, or is not visible to you.');
        }
        Id owner = pkgs[0].LLC_BI__Account__c;
        if (said == null) {
            if (owner == null) {
                throw new ToolException(
                    'Product package ' + pkgs[0].Name + ' carries no account, so no relationship can be derived from it. Supply accountId.'
                );
            }
            return owner;
        }
        if (owner != said) {
            throw new ToolException(
                'Product package ' + pkgs[0].Name + ' belongs to relationship ' + owner + ', not to ' + said +
                '. A package is a narrowing WITHIN a relationship, so one that sits on another relationship narrows nothing.'
            );
        }
        return said;
    }

    /**
     * Proves every collateral in the batch reaches the anchor, and names the item that does not.
     *
     * THE ANCHOR IS THE RELATIONSHIP, and an asset reaches it two ways, which are nCino's own two:
     * the borrower OWNS it (`LLC_BI__Account_Collateral__c`, the only account anchor the collateral
     * object has, since `LLC_BI__Collateral__c` carries no account lookup at all), or it is PLEDGED
     * to one of the relationship's facilities, wherever that facility sits. The second arm is what
     * admits a guarantor's asset taken as security for this borrower's deal.
     *
     * WHERE THE CALLER NARROWED TO A PACKAGE, THE PACKAGE TEST IS THE ONLY ONE THAT RUNS, and it is
     * unchanged from the 2026-08-22 wave: pledged to a loan of that package, or owned by that
     * package's borrower. That is deliberate rather than lazy. The package scope is a strict SUBSET
     * of the relationship scope - a package's loans are the relationship's loans and a package's
     * borrower is the relationship - so passing the narrower test implies passing the wider one, and
     * running both would only replace a refusal that names the deal the banker is working with a
     * vaguer one about the relationship.
     *
     * @param items The batch.
     * @param collateralById The collateral records, for names in the refusal.
     * @param accountId The anchor relationship.
     * @param packageId The caller's narrowing, or null.
     */
    private static void assertReachesAnchor(
        List<ValuationItem> items,
        Map<Id, LLC_BI__Collateral__c> collateralById,
        Id accountId,
        Id packageId
    ) {
        Set<Id> collateralIds = collateralById.keySet();
        Set<Id> member = new Set<Id>();

        if (packageId == null) {
            for (LLC_BI__Account_Collateral__c own : [
                SELECT LLC_BI__Collateral__c
                FROM LLC_BI__Account_Collateral__c
                WHERE LLC_BI__Collateral__c IN :collateralIds AND LLC_BI__Account__c = :accountId
                WITH USER_MODE
            ]) {
                member.add(own.LLC_BI__Collateral__c);
            }
            for (LLC_BI__Loan_Collateral2__c pledge : [
                SELECT LLC_BI__Collateral__c
                FROM LLC_BI__Loan_Collateral2__c
                WHERE LLC_BI__Collateral__c IN :collateralIds
                  AND LLC_BI__Loan__r.LLC_BI__Account__c = :accountId
                WITH USER_MODE
            ]) {
                member.add(pledge.LLC_BI__Collateral__c);
            }
            for (Integer i = 0; i < items.size(); i++) {
                Id cid = items[i].collateralId;
                if (!member.contains(cid)) {
                    throw new ToolException(
                        'Collateral ' + collateralById.get(cid).Name + ' does not reach relationship ' + accountId +
                        ' (item ' + (i + 1) + ' of ' + items.size() + '). The relationship does not own it through the ' +
                        'Collateral Ownership junction, which is the only account anchor LLC_BI__Collateral__c has on this org, ' +
                        'and it is pledged to none of the relationship\'s facilities. A valuation batch is anchored on one ' +
                        'relationship, so an asset that reaches it through neither route is refused rather than filed against ' +
                        'the wrong borrower.'
                    );
                }
            }
            return;
        }

        List<LLC_BI__Product_Package__c> packages = [
            SELECT Id, Name FROM LLC_BI__Product_Package__c WHERE Id = :packageId WITH USER_MODE LIMIT 1
        ];
        if (packages.isEmpty()) {
            throw new ToolException('Product package ' + packageId + ' was not found, or is not visible to you.');
        }
        for (LLC_BI__Loan_Collateral2__c pledge : [
            SELECT LLC_BI__Collateral__c
            FROM LLC_BI__Loan_Collateral2__c
            WHERE LLC_BI__Collateral__c IN :collateralIds
              AND LLC_BI__Loan__r.LLC_BI__Product_Package__c = :packageId
            WITH USER_MODE
        ]) {
            member.add(pledge.LLC_BI__Collateral__c);
        }
        if (accountId != null) {
            for (LLC_BI__Account_Collateral__c owned : [
                SELECT LLC_BI__Collateral__c
                FROM LLC_BI__Account_Collateral__c
                WHERE LLC_BI__Collateral__c IN :collateralIds AND LLC_BI__Account__c = :accountId
                WITH USER_MODE
            ]) {
                member.add(owned.LLC_BI__Collateral__c);
            }
        }
        for (Integer i = 0; i < items.size(); i++) {
            Id cid = items[i].collateralId;
            if (!member.contains(cid)) {
                throw new ToolException(
                    'Collateral ' + collateralById.get(cid).Name + ' is not part of product package ' + packages[0].Name +
                    ' (item ' + (i + 1) + ' of ' + items.size() + '). It is pledged to no loan on this package, and it is not owned by the package\'s borrower. ' +
                    'A valuation batch is anchored on one deal, so a collateral that reaches it through neither route is refused rather than filed against the wrong package. ' +
                    'Omit productPackageId to value the relationship\'s assets without narrowing to one deal.'
                );
            }
        }
    }

    /**
     * Every facility each asset is pledged to, with the package behind each facility.
     *
     * ONE query for the whole batch. This is the ASSOCIATION the row shows, so it is read for every
     * pledge the asset carries, across every package, rather than for the one the caller named.
     *
     * @param collateralIds The assets in the batch.
     * @return Collateral id to its associations, ordered by facility name. An asset pledged nowhere
     *         is simply absent from the map, and renders as an empty list.
     */
    private static Map<Id, List<C360Facilities.Association>> pledgeAssociations(Set<Id> collateralIds) {
        Map<Id, List<C360Facilities.Association>> out = new Map<Id, List<C360Facilities.Association>>();
        if (collateralIds.isEmpty()) {
            return out;
        }
        for (LLC_BI__Loan_Collateral2__c p : [
            SELECT LLC_BI__Collateral__c, LLC_BI__Loan__c, LLC_BI__Loan__r.Name,
                   LLC_BI__Loan__r.LLC_BI__Product_Package__c,
                   LLC_BI__Loan__r.LLC_BI__Product_Package__r.Name
            FROM LLC_BI__Loan_Collateral2__c
            WHERE LLC_BI__Collateral__c IN :collateralIds AND LLC_BI__Loan__c != null
            WITH USER_MODE
            ORDER BY LLC_BI__Loan__r.Name ASC
        ]) {
            if (!out.containsKey(p.LLC_BI__Collateral__c)) {
                out.put(p.LLC_BI__Collateral__c, new List<C360Facilities.Association>());
            }
            out.get(p.LLC_BI__Collateral__c).add(C360Facilities.association(
                p.LLC_BI__Loan__c,
                p.LLC_BI__Loan__r == null ? null : p.LLC_BI__Loan__r.Name,
                p.LLC_BI__Loan__r == null ? null : p.LLC_BI__Loan__r.LLC_BI__Product_Package__c,
                p.LLC_BI__Loan__r == null || p.LLC_BI__Loan__r.LLC_BI__Product_Package__r == null
                    ? null
                    : p.LLC_BI__Loan__r.LLC_BI__Product_Package__r.Name
            ));
        }
        return out;
    }

    /**
     * Refuses a valuation that would duplicate an existing one on the same collateral and date.
     *
     * PDI-00020349: the platform has raised "System.ListException: Duplicate id in list" on exactly
     * this shape. The defect is resolved on recent releases, and the rule stands independently:
     * two valuations of one asset on one date leave nCino's latest-wins ordering undecidable.
     */
    private static void assertNoSameDateValuation(List<ValuationItem> items, Map<Id, LLC_BI__Collateral__c> collateralById) {
        Set<Id> collateralIds = collateralById.keySet();
        List<Date> dates = new List<Date>();
        for (ValuationItem it : items) {
            dates.add(it.valuationDate);
        }

        Map<String, LLC_BI__Collateral_Valuation__c> existing = new Map<String, LLC_BI__Collateral_Valuation__c>();
        for (LLC_BI__Collateral_Valuation__c cv : [
            SELECT Id, Name, LLC_BI__Collateral__c, LLC_BI__Valuation_Date__c
            FROM LLC_BI__Collateral_Valuation__c
            WHERE LLC_BI__Collateral__c IN :collateralIds AND LLC_BI__Valuation_Date__c IN :dates
            WITH USER_MODE
        ]) {
            existing.put(String.valueOf(cv.LLC_BI__Collateral__c) + '|' + String.valueOf(cv.LLC_BI__Valuation_Date__c), cv);
        }

        for (Integer i = 0; i < items.size(); i++) {
            ValuationItem it = items[i];
            String k = String.valueOf(it.collateralId) + '|' + String.valueOf(it.valuationDate);
            if (existing.containsKey(k)) {
                throw new ToolException(
                    collateralById.get(it.collateralId).Name + ' already carries valuation ' + existing.get(k).Name + ' dated ' +
                    String.valueOf(it.valuationDate) + ' (item ' + (i + 1) + ' of ' + items.size() + '). ' +
                    'Two valuations of one asset on one date leave nCino unable to decide which is the latest. Use a different date, or amend the existing record outside this tool.'
                );
            }
        }
    }

    private static void assertPicklist(String fieldApiName, String value, String itemRef) {
        if (String.isBlank(value)) {
            return;
        }
        Set<String> allowed = C360Picklist.activeValues(C360WriteGuard.OBJ_VALUATION, fieldApiName);
        if (!allowed.contains(value)) {
            List<String> sorted = new List<String>(allowed);
            sorted.sort();
            throw new ToolException(
                fieldApiName + ' value \'' + value + '\' is not offered by this org' + itemRef + '. Available: ' + String.join(sorted, ', ') + '.'
            );
        }
    }

    /** Maps the internal plan steps onto the wire shape. */
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
