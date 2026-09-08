#!/usr/bin/env python3
"""Check a relationship JSON before it touches the org.

    python3 seed/validate_spec.py seed/examples/meridian.json
    python3 seed/validate_spec.py --all seed/examples/*.json

Catches the mistakes that are cheap here and expensive after a half-run: a
reference to a key that does not exist, a duplicate key, a picklist value the
org does not carry, a catalog name that is absent or ambiguous, a lookupKey
missing from a Booked facility, an in-flight loan inside a booked package, a
field longer than the org will hold, a pledge above what the collateral can
lend against.

`--all` adds the check no single file can make: the unique external ids and the
account names of every spec, compared ACROSS the files. Those fields are unique
org-wide and a record key is only promised to be unique inside its own spec, so
two relationships that name an asset the same way collide at insert time in
whichever one runs second. The derived values come from seed_relationship.py's
own `unique_key`, so this cannot drift from what the seed writes.

It reads the CATALOGS from seed/reference/ (the Hartwell dump), so it needs no
org connection and no token. Re-dump the reference if the org's catalogs move.
"""
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, 'reference')
sys.path.insert(0, HERE)
from seed_relationship import unique_key  # noqa: E402

# WHAT THE ORG REFUSES TO HOLD, in characters. Every one of these was hit for real
# by the seven parallel runs; the org's message is STRING_TOO_LONG and it arrives
# after the insert, which is the expensive place to learn it. The seed appends
# " [C360-SEED-2026-09]" to two of them, so their budget is the field minus the tag.
MAX_LEN = {
    'mitigation': (100, 'LLC_BI__Policy_Exception__c.LLC_BI__Mitigation_Reason_1..3__c'),
    'feeDescription': (230, 'LLC_BI__Fee__c.LLC_BI__Fee_Type_Description__c, 255 less the tag'),
    'collateralDescription': (235, 'LLC_BI__Collateral__c.LLC_BI__Description__c, 255 less the tag'),
    'valuationDescription': (255, 'LLC_BI__Collateral_Valuation__c.LLC_BI__Valuation_Description__c'),
}

# Every collateral type in this org defaults to an 80 percent advance rate, so a
# pledge with no override lends against 80 percent of the asset's value.
DEFAULT_ADVANCE_RATE = 80

# Picklists the org accepts, read off the live describes in seed/reference/.
PICK = {}
for obj, field, alias in [
        ('LLC_BI__Loan__c', 'LLC_BI__Product__c', 'product'),
        ('LLC_BI__Loan__c', 'LLC_BI__Product_Type__c', 'productType'),
        ('LLC_BI__Loan__c', 'LLC_BI__Stage__c', 'loanStage'),
        ('LLC_BI__Loan__c', 'LLC_BI__Status__c', 'loanStatus'),
        ('LLC_BI__Loan__c', 'LLC_BI__Payment_Type__c', 'paymentType'),
        ('LLC_BI__Loan__c', 'LLC_BI__Payment_Schedule__c', 'paymentSchedule'),
        ('LLC_BI__Loan__c', 'LLC_BI__Index__c', 'index'),
        ('LLC_BI__Loan__c', 'LLC_BI__Interest_Accrual_Method__c', 'interestAccrualMethod'),
        ('LLC_BI__Loan__c', 'LLC_BI__Loan_Class__c', 'loanClass'),
        ('LLC_BI__Loan__c', 'LLC_BI__Risk_Grade__c', 'loanRiskGrade'),
        ('LLC_BI__Loan_Detail__c', 'LLC_BI__Primary_Loan_Purpose__c', 'purpose'),
        ('LLC_BI__Product_Package__c', 'LLC_BI__Stage__c', 'packageStage'),
        ('LLC_BI__Product_Package__c', 'cm_Credit_Stage__c', 'creditStage'),
        ('LLC_BI__Product_Package__c', 'LLC_BI__Status__c', 'packageStatus'),
        ('LLC_BI__Product_Package__c', 'LLC_BI__Risk_Rating__c', 'riskRating'),
        ('LLC_BI__Legal_Entities__c', 'LLC_BI__Borrower_Type__c', 'borrowerType'),
        ('LLC_BI__Legal_Entities__c', 'LLC_BI__Entity_Type__c', 'entityType'),
        ('LLC_BI__Legal_Entities__c', 'LLC_BI__Guaranty_Amount__c', 'guarantyType'),
        ('LLC_BI__Covenant2__c', 'LLC_BI__Frequency__c', 'frequency'),
        ('LLC_BI__Covenant2__c', 'Financial_Indicator_Operator__c', 'operator'),
        ('LLC_BI__Covenant2__c', 'LLC_BI__Covenant_Status__c', 'covenantStatus'),
        ('LLC_BI__Covenant_Compliance2__c', 'LLC_BI__Status__c', 'evaluationStatus'),
        ('LLC_BI__Collateral__c', 'LLC_BI__Assessment_Method__c', 'assessmentMethod'),
        ('LLC_BI__Collateral__c', 'LLC_BI__Status__c', 'collateralStatus'),
        ('LLC_BI__Collateral_Valuation__c', 'LLC_BI__Source__c', 'valuationSource'),
        ('LLC_BI__Collateral_Valuation__c', 'LLC_BI__Type__c', 'valuationType'),
        ('LLC_BI__Account_Collateral__c', 'LLC_BI__Collateral_Association__c', 'association'),
        ('LLC_BI__Loan_Collateral2__c', 'LLC_BI__Lien_Position__c', 'lienPosition'),
        ('LLC_BI__Fee__c', 'LLC_BI__Fee_Type__c', 'feeType'),
        ('LLC_BI__Fee__c', 'LLC_BI__Record_Type__c', 'feeRecordType'),
        ('LLC_BI__Policy_Exception__c', 'LLC_BI__Status__c', 'exceptionStatus'),
        ('Opportunity', 'StageName', 'oppStage'),
        ('Case', 'Status', 'caseStatus'),
        ('Case', 'Origin', 'caseOrigin'),
        ('Case', 'Type', 'caseType'),
        ('Account', 'Industry', 'industry'),
        ('Account', 'Risk_Status__c', 'riskStatus')]:
    path = os.path.join(REF, f'describe-{obj}.json')
    if not os.path.exists(path):
        continue
    with open(path) as f:
        d = json.load(f)
    hit = [x for x in d['fields'] if x['name'] == field]
    if hit:
        PICK[alias] = set(hit[0]['picklistValues'])


def catalog(obj):
    path = os.path.join(REF, f'hartwell-{obj}.json')
    with open(path) as f:
        return Counter(r['Name'] for r in json.load(f))


COVENANT_TYPES = catalog('LLC_BI__Covenant_Type__c')
COLLATERAL_TYPES = catalog('LLC_BI__Collateral_Type__c')
CONNECTION_ROLES = catalog('LLC_BI__Connection_Role__c')

BOOKED_CREDIT_STAGES = {'Booked', 'Approved', 'Fulfillment'}


def lendable_guard(err, where, pledge, asset):
    """The org refuses a pledge above the collateral's CURRENT LENDABLE VALUE.

        "You are trying to pledge more than the current lendable value of this
         collateral. You must check the Authorize Pledge Amount checkbox to continue."

    Lendable is the asset's value times the pledge's advance rate, and the design's
    standing rule is that Authorize is never checked: the bank does not invent
    coverage the appraisal does not support. A junior lien carries its own slice as
    its advance rate rather than being netted against the senior one, which is how
    the seven relationships model second liens and what the org accepted.
    """
    pledged = pledge.get('amountPledged')
    if pledged is None:
        return
    value = asset.get('value')
    if value is None:
        primary = [v for v in asset.get('valuations', []) if v.get('primary')]
        value = (primary or asset.get('valuations') or [{}])[0].get('value')
    if not value:
        err(where, 'amountPledged with no collateral value to lend against')
        return
    rate = pledge.get('advanceRate', DEFAULT_ADVANCE_RATE)
    lendable = value * rate / 100
    if pledged > lendable:
        err(where, f'amountPledged {pledged:,.0f} is above the lendable value '
                   f'{lendable:,.0f} ({value:,.0f} at {rate} percent); the org refuses '
                   f'this unless Authorize Pledge Amount is checked, and it never is')


def check(path):
    """Every problem in one spec. Returns (spec, problems, one-line counts)."""
    with open(path) as f:
        spec = json.load(f)
    bad = []

    def err(where, msg):
        bad.append(f'{where}: {msg}')

    def too_long(where, kind, text, field):
        if text is None:
            return
        limit, what = MAX_LEN[kind]
        if len(text) > limit:
            err(where, f'{field} is {len(text)} characters; {what} holds {limit}')

    def pick(where, alias, value, field):
        if value is None or alias not in PICK:
            return
        if value not in PICK[alias]:
            sample = ', '.join(sorted(PICK[alias])[:8])
            err(where, f'{field} "{value}" is not in the org picklist (legal: {sample} ...)')

    def unique(name, keys):
        for k, n in Counter(keys).items():
            if n > 1:
                err(name, f'duplicate key "{k}" appears {n} times')

    accounts = {a['key'] for a in spec.get('accounts', [])}
    unique('accounts', [a['key'] for a in spec.get('accounts', [])])
    if spec.get('anchorKey') not in accounts:
        err('anchorKey', f'"{spec.get("anchorKey")}" is not one of the accounts')
    for a in spec.get('accounts', []):
        pick(f'account {a["key"]}', 'industry', a.get('industry'), 'industry')
        pick(f'account {a["key"]}', 'riskStatus', a.get('riskStatus'), 'riskStatus')
    anchor = next((a for a in spec.get('accounts', []) if a['key'] == spec.get('anchorKey')), None)
    if anchor and not anchor.get('nextReviewDate'):
        err('anchor account', 'no nextReviewDate: the snapshot review card will be empty')

    seen_from_anchor = set()
    for c in spec.get('connections', []):
        w = f'connection {c["key"]}'
        for side in ('from', 'to'):
            if c[side] not in accounts:
                err(w, f'{side} "{c[side]}" is not an account key')
        if CONNECTION_ROLES.get(c['roleName'], 0) == 0:
            err(w, f'roleName "{c["roleName"]}" is not in the org catalog')
        elif CONNECTION_ROLES[c['roleName']] > 1:
            err(w, f'roleName "{c["roleName"]}" is ambiguous, {CONNECTION_ROLES[c["roleName"]]} '
                   f'records carry it; the seed picks the first and that may not be yours')
        if spec['anchorKey'] in (c['from'], c['to']):
            seen_from_anchor.add(c['to'] if c['from'] == spec['anchorKey'] else c['from'])
    for a in accounts - {spec['anchorKey']}:
        if a not in seen_from_anchor:
            err('graph', f'household member "{a}" has no edge touching the anchor, so '
                         f'Customer360RelationshipGraph will not show it')

    collateral = {c['key'] for c in spec.get('collateral', [])}
    by_collateral = {c['key']: c for c in spec.get('collateral', [])}
    unique('collateral', [c['key'] for c in spec.get('collateral', [])])
    for c in spec.get('collateral', []):
        w = f'collateral {c["key"]}'
        if COLLATERAL_TYPES.get(c['typeName'], 0) != 1:
            err(w, f'typeName "{c["typeName"]}" is absent or ambiguous in the org catalog '
                   f'({COLLATERAL_TYPES.get(c["typeName"], 0)} matches)')
        pick(w, 'assessmentMethod', c.get('assessmentMethod'), 'assessmentMethod')
        pick(w, 'collateralStatus', c.get('status'), 'status')
        too_long(w, 'collateralDescription', c.get('description'), 'description')
        if not c.get('owners'):
            err(w, 'no owners: an asset with no Account_Collateral row belongs to nobody')
        # ONE ROW PER (ACCOUNT, ASSOCIATION) ON AN ASSET. Two identical owner rows is
        # what a lookupKey collision workaround leaves behind, and the seed's
        # content-idempotency would then map both spec rows onto the one live record.
        # An account may hold two DIFFERENT associations on the same asset (owner and
        # lessee), so the triple is the rule, not the account alone.
        unique(f'{w} owners', [f"{o['account']}/{o.get('association', 'Owner')}"
                               for o in c.get('owners', [])])
        unique(f'{w} owner keys', [o['key'] for o in c.get('owners', []) if o.get('key')])
        for o in c.get('owners', []):
            if o['account'] not in accounts:
                err(w, f'owner account "{o["account"]}" is not an account key')
            pick(w, 'association', o.get('association'), 'owner association')
        for v in c.get('valuations', []):
            pick(f'{w} valuation {v["key"]}', 'valuationSource', v.get('source'), 'source')
            pick(f'{w} valuation {v["key"]}', 'valuationType', v.get('type'), 'type')
            too_long(f'{w} valuation {v["key"]}', 'valuationDescription',
                     v.get('description'), 'description')

    loan_keys = set()
    for p in spec.get('packages', []):
        w = f'package {p["key"]}'
        pick(w, 'packageStage', p.get('stage'), 'stage')
        pick(w, 'creditStage', p.get('creditStage'), 'creditStage')
        pick(w, 'packageStatus', p.get('status'), 'status')
        pick(w, 'riskRating', p.get('riskRating'), 'riskRating')
        if p.get('primaryEntity') and p['primaryEntity'] not in accounts:
            err(w, f'primaryEntity "{p["primaryEntity"]}" is not an account key')
        booked_pkg = (p.get('creditStage', 'Booked') in BOOKED_CREDIT_STAGES)
        for ln in p.get('loans', []):
            lw = f'loan {ln["key"]}'
            loan_keys.add(ln['key'])
            stage = ln.get('stage', 'Booked')
            for alias, field in [('product', 'product'), ('productType', 'productType'),
                                 ('loanStage', 'stage'), ('loanStatus', 'status'),
                                 ('paymentType', 'paymentType'),
                                 ('paymentSchedule', 'paymentSchedule'), ('index', 'index'),
                                 ('interestAccrualMethod', 'interestAccrualMethod'),
                                 ('loanClass', 'loanClass'), ('purpose', 'purpose')]:
                pick(lw, alias, ln.get(field) if field != 'stage' else stage, field)
            pick(lw, 'loanRiskGrade', ln.get('riskGrade'), 'riskGrade')
            if stage == 'Booked' and not ln.get('lookupKey'):
                err(lw, 'Booked without a lookupKey: Loan_Validation_05 refuses it')
            if booked_pkg and stage != 'Booked':
                err(lw, f'stage "{stage}" inside a booked package; the founder rule is no '
                        f'in-flight loans in a booked package')
            if stage == 'Booked' and not ln.get('outstanding'):
                err(lw, 'Booked with no outstanding balance: Amount_Available is a formula '
                        'over commitment minus outstanding, so the facility reads as empty')
            if ln.get('product') in ('Line of Credit', 'HELOC') and \
                    (ln.get('outstanding') or 0) >= (ln.get('amount') or 0):
                err(lw, 'a line must be drawn BELOW its commitment')
            if ln.get('firstPaymentDate') and ln.get('closeDate') \
                    and ln['firstPaymentDate'] < ln['closeDate']:
                err(lw, 'firstPaymentDate is before closeDate; the org refuses it')
            if ln.get('maturityDate') and ln.get('closeDate') \
                    and ln['maturityDate'] <= ln['closeDate']:
                err(lw, 'maturityDate is not after closeDate')
            for i in ln.get('involvements', []):
                iw = f'{lw} involvement {i["key"]}'
                if i['account'] not in accounts:
                    err(iw, f'account "{i["account"]}" is not an account key')
                pick(iw, 'borrowerType', i.get('borrowerType'), 'borrowerType')
                pick(iw, 'entityType', i.get('entityType'), 'entityType')
                pick(iw, 'guarantyType', i.get('guarantyType'), 'guarantyType')
            if stage == 'Booked' and not any(
                    i.get('borrowerType') == 'Borrower' for i in ln.get('involvements', [])):
                err(lw, 'no Borrower involvement')
            for pl in ln.get('pledges', []):
                pw = f'{lw} pledge {pl["key"]}'
                if pl['collateral'] not in collateral:
                    err(pw, f'collateral "{pl["collateral"]}" is not a collateral key')
                else:
                    lendable_guard(err, pw, pl, by_collateral[pl['collateral']])
                pick(pw, 'lienPosition', pl.get('lienPosition'), 'lienPosition')
            for fee in ln.get('fees', []):
                fw = f'{lw} fee {fee["key"]}'
                pick(fw, 'feeType', fee.get('feeType'), 'feeType')
                pick(fw, 'feeRecordType', fee.get('recordType'), 'recordType')
                too_long(fw, 'feeDescription', fee.get('description'), 'description')
                if fee.get('percentage') and fee.get('amount'):
                    err(fw, 'a percentage fee must not carry an amount; the org computes it')
                if not fee.get('percentage') and not fee.get('amount'):
                    err(fw, 'neither percentage nor amount')

    unique('loans', list(loan_keys) if len(loan_keys) == sum(
        len(p.get('loans', [])) for p in spec.get('packages', [])) else
        [ln['key'] for p in spec.get('packages', []) for ln in p.get('loans', [])])
    booked_pkgs = [p for p in spec.get('packages', [])
                   if p.get('creditStage', 'Booked') in BOOKED_CREDIT_STAGES]
    if len(booked_pkgs) < 3:
        err('packages', f'{len(booked_pkgs)} booked packages; the design asks for at least three')
    for p in booked_pkgs:
        n = len(p.get('loans', []))
        if not 2 <= n <= 6:
            err(f'package {p["key"]}', f'{n} loans; the design asks for 2 to 6 in a booked package')

    lookups = [ln.get('lookupKey') for p in spec.get('packages', []) for ln in p.get('loans', [])]
    unique('lookupKeys', [k for k in lookups if k])

    cov_keys = set()
    for c in spec.get('covenants', []):
        w = f'covenant {c["key"]}'
        cov_keys.add(c['key'])
        n = COVENANT_TYPES.get(c['typeName'], 0)
        if n == 0:
            err(w, f'typeName "{c["typeName"]}" is not in the org catalog')
        elif n > 1 and not c.get('typeId'):
            err(w, f'typeName "{c["typeName"]}" is ambiguous ({n} records); set typeId')
        pick(w, 'frequency', c.get('frequency'), 'frequency')
        pick(w, 'operator', c.get('operator'), 'operator')
        pick(w, 'covenantStatus', c.get('covenantStatus'), 'covenantStatus')
        for l in c.get('loans', []):
            if l not in loan_keys:
                err(w, f'attached to loan "{l}" which is not a loan key')
        for e in c.get('evaluations', []):
            pick(f'{w} evaluation {e["key"]}', 'evaluationStatus', e.get('status'), 'status')
    unique('covenants', [c['key'] for c in spec.get('covenants', [])])
    if len(cov_keys) < 2:
        err('covenants', 'fewer than two relationship-level covenants')
    total_evals = sum(len(c.get('evaluations', [])) for c in spec.get('covenants', []))
    if total_evals < 3:
        err('covenants', f'{total_evals} evaluations; the design asks for at least three')
    statuses = {e.get('status') for c in spec.get('covenants', []) for e in c.get('evaluations', [])}
    if not statuses & {'Exception', 'Waived'}:
        err('covenants', 'no Exception or Waived evaluation; the design asks for one exception '
                         'somewhere on each relationship')

    for e in spec.get('policyExceptions', []):
        w = f'policy exception {e["key"]}'
        pick(w, 'exceptionStatus', e.get('status'), 'status')
        if e.get('loan') and e['loan'] not in loan_keys:
            err(w, f'loan "{e["loan"]}" is not a loan key')
        if e.get('collateral') and e['collateral'] not in collateral:
            err(w, f'collateral "{e["collateral"]}" is not a collateral key')
        for i, reason in enumerate(e.get('mitigation', [])):
            too_long(w, 'mitigation', reason, f'mitigation[{i}]')
    if not spec.get('policyExceptions'):
        err('policyExceptions', 'none; the design asks for one to two per relationship')
    for o in spec.get('opportunities', []):
        pick(f'opportunity {o["key"]}', 'oppStage', o.get('stage'), 'stage')
    for c in spec.get('cases', []):
        w = f'case {c["key"]}'
        pick(w, 'caseStatus', c.get('status'), 'status')
        pick(w, 'caseOrigin', c.get('origin'), 'origin')
        pick(w, 'caseType', c.get('type'), 'type')
    for p in spec.get('packages', []):
        if p.get('reviews'):
            err(f'package {p["key"]}', 'reviews belong at the top level, not on a package')
    if not spec.get('reviews'):
        err('reviews', 'none; the design asks for a completed annual review per relationship')

    counts = (f"{len(spec.get('accounts', []))} accounts, "
              f"{len(spec.get('connections', []))} edges, "
              f"{len(spec.get('packages', []))} packages "
              f"({len(booked_pkgs)} booked), "
              f"{sum(len(p.get('loans', [])) for p in spec.get('packages', []))} loans, "
              f"{len(spec.get('collateral', []))} collateral, "
              f"{len(cov_keys)} covenants, {total_evals} evaluations")
    return spec, bad, counts


def org_unique_values(spec):
    """Every value this spec writes that has to be unique across the whole org,
    labelled by the field that owns it. The lookupKey shapes come from
    seed_relationship.unique_key, so a change to the key shape cannot leave this
    check behind."""
    slug = spec['slug']
    out = []
    for a in spec.get('accounts', []):
        out.append(('Account.Name', a['name']))
    for p in spec.get('packages', []):
        for ln in p.get('loans', []):
            if ln.get('lookupKey'):
                out.append(('LLC_BI__Loan__c.LLC_BI__lookupKey__c', ln['lookupKey']))
            for obj in ('LLC_BI__Pricing_Stream__c', 'LLC_BI__Pricing_Rate_Component__c',
                        'LLC_BI__Pricing_Payment_Component__c'):
                out.append((f'{obj}.LLC_BI__lookupKey__c', unique_key(slug, ln['key'])))
            for pl in ln.get('pledges', []):
                out.append(('LLC_BI__Loan_Collateral2__c.LLC_BI__LookupKey__c',
                            unique_key(slug, pl['key'])))
    for c in spec.get('collateral', []):
        for i, ow in enumerate(c.get('owners', [])):
            okey = ow.get('key') or f"{c['key']}#{i}"
            out.append(('LLC_BI__Account_Collateral__c.LLC_BI__lookupKey__c',
                        unique_key(slug, okey.replace('#', '-'))))
    return out


def across(specs):
    """The collisions no single file can see. `specs` is {filename: spec}.

    A record key is only promised to be unique inside its own spec, and these fields
    are unique across the org, so the second relationship to run is simply refused:
    that is how four of the seven parallel runs lost an ownership row to an asset
    another agent had already called "receivables". Account.Name is not a unique field
    in Salesforce and is checked for a different reason: two live accounts with one
    name make Customer360SearchAccounts ambiguous for a banker.
    """
    bad = []
    live = {n: s for n, s in specs.items() if not s.get('retired')}
    for name in sorted(set(specs) - set(live)):
        print(f'  (excluded from the cross-file check: {name}, {specs[name]["retired"]})')
    slugs = {}
    for name, spec in live.items():
        slugs.setdefault(spec['slug'], []).append(name)
    for slug, names in sorted(slugs.items()):
        if len(names) > 1:
            bad.append(f'slug "{slug}" is claimed by {", ".join(sorted(names))}; one slug is '
                       f'one manifest and the scope every derived unique key hangs off')
    seen = {}
    for name, spec in live.items():
        for field, value in org_unique_values(spec):
            seen.setdefault((field, value), []).append(name)
    for (field, value), names in sorted(seen.items()):
        where = ', '.join(sorted(set(names)))
        if field == 'Account.Name' and len(set(names)) > 1:
            bad.append(f'the account "{value}" is in {where}; one name, two accounts, and '
                       f'the cockpit search cannot tell a banker which is which')
        elif field != 'Account.Name' and len(names) > 1:
            bad.append(f'{field} "{value}" is written by {where}; the field is unique '
                       f'org-wide and whichever relationship runs second is refused')
    return bad


def main():
    args = sys.argv[1:]
    every = '--all' in args
    paths = [a for a in args if not a.startswith('-')]
    if not paths:
        raise SystemExit('usage: validate_spec.py [--all] <spec.json> [<spec.json> ...]')

    specs, failed = {}, False
    for path in paths:
        name = os.path.basename(path)
        spec, bad, counts = check(path)
        specs[name] = spec
        if bad:
            failed = True
            print(f'{name}: {len(bad)} problems\n')
            for b in bad:
                print('  ' + b)
            print()
        else:
            print(f'{name}: clean. {counts}')

    if every:
        print(f'\nacross {len(specs)} specs:')
        bad = across(specs)
        if bad:
            failed = True
            print(f'  {len(bad)} collisions')
            for b in bad:
                print('  ' + b)
        else:
            print('  no colliding slug, unique key or account name.')
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
