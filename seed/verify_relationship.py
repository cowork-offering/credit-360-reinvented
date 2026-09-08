#!/usr/bin/env python3
"""Read a seeded relationship back through the org's own cockpit tools and
assert the design doc's "what done means" list.

    read TOK INST <<< "$(~/.local/bin/bankinggpt-rest)"; export TOK INST
    python3 seed/verify_relationship.py <slug>

The reads are the same @InvocableMethod classes the connector calls, at
POST /services/data/v62.0/actions/custom/apex/<Class> with {"inputs":[{...}]},
so a pass here is a pass in the cockpit and not a pass against a private query.

Exit code 0 only when every assertion holds.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'lib'))
from sfrest import SfError, invoke, q, soql_in  # noqa: E402

READS = ['Customer360Snapshot', 'Customer360Exposure', 'Customer360Covenants',
         'Customer360RelationshipGraph', 'Customer360Opportunities',
         'Customer360StructuralSignals', 'Customer360ActionHistory']

# A line's drawn balance must sit UNDER its commitment; a term loan amortised
# down sits under it too, so the rule is stated on the products that revolve.
REVOLVING = {'Line of Credit', 'HELOC'}


class Report:
    def __init__(self):
        self.rows = []

    def check(self, name, ok, detail=''):
        self.rows.append((bool(ok), name, detail))
        print(f'  {"PASS" if ok else "FAIL"}  {name}' + (f'   {detail}' if detail else ''))
        return bool(ok)

    def failures(self):
        return [r for r in self.rows if not r[0]]


def money(x):
    return f'${x:,.0f}' if isinstance(x, (int, float)) else str(x)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('slug')
    ap.add_argument('--manifest-dir', default=os.path.join(HERE, 'manifests'))
    args = ap.parse_args()

    path = os.path.join(args.manifest_dir, f'{args.slug}.json')
    with open(path) as f:
        man = json.load(f)
    acct = man['account']
    rec = man['records']

    print(f'verifying {man.get("relationship")}  slug={args.slug}  account={acct}\n')

    out = {}
    r = Report()
    for cls in READS:
        try:
            out[cls] = invoke(cls, [{'accountId': acct}])
            r.check(f'{cls} answers', True)
        except SfError as e:
            out[cls] = {}
            r.check(f'{cls} answers', False, str(e)[:200])

    snap = out.get('Customer360Snapshot', {})
    exp = out.get('Customer360Exposure', {})
    cov = out.get('Customer360Covenants', {})
    graph = out.get('Customer360RelationshipGraph', {})
    opps = out.get('Customer360Opportunities', {})
    sig = out.get('Customer360StructuralSignals', {})

    print('\n--- snapshot')
    pkg_ids = list(rec.get('LLC_BI__Product_Package__c', {}).values())
    r.check('snapshot names the relationship', snap.get('name') == man.get('relationship'),
            str(snap.get('name')))
    r.check('snapshot counts every seeded package',
            snap.get('packageCount') == len(pkg_ids),
            f'{snap.get("packageCount")} of {len(pkg_ids)}')
    r.check('snapshot carries exposure', (snap.get('totalCreditExposure') or 0) > 0,
            money(snap.get('totalCreditExposure')))
    r.check('snapshot carries a risk rating and a stage',
            bool(snap.get('primaryRiskRating')) and bool(snap.get('primaryStage')),
            f'grade {snap.get("primaryRiskRating")} / {snap.get("primaryStage")}')
    r.check('snapshot carries the review clock',
            bool(snap.get('nextReviewDate')),
            f'next {snap.get("nextReviewDate")} last {snap.get("lastReviewDate")}')
    r.check('snapshot NAICS and revenue present',
            bool(snap.get('naicsCode')) and (snap.get('annualRevenue') or 0) > 0,
            f'{snap.get("naicsCode")} / {money(snap.get("annualRevenue"))}')

    pkg_rows = q(f'SELECT Id, Name, LLC_BI__TCE__c, LLC_BI__Outstanding__c, LLC_BI__Stage__c, '
                 f'cm_Credit_Stage__c FROM LLC_BI__Product_Package__c '
                 f'WHERE Id IN {soql_in(pkg_ids)}')
    tce_sum = sum(p['LLC_BI__TCE__c'] or 0 for p in pkg_rows)
    r.check('snapshot TCE equals the sum of the package TCEs',
            abs((snap.get('totalCreditExposure') or 0) - tce_sum) < 1,
            f'{money(snap.get("totalCreditExposure"))} vs {money(tce_sum)}')
    booked_pkgs = [p for p in pkg_rows if p['cm_Credit_Stage__c'] == 'Booked']
    r.check('at least three booked packages', len(booked_pkgs) >= 3,
            f'{len(booked_pkgs)} booked of {len(pkg_rows)}')

    print('\n--- exposure')
    loan_ids = list(rec.get('LLC_BI__Loan__c', {}).values())
    loans = q(f'SELECT Id, Name, LLC_BI__Amount__c, LLC_BI__AmountOutstanding__c, '
              f'LLC_BI__Amount_Available__c, LLC_BI__Stage__c, LLC_BI__Product__c, '
              f'LLC_BI__Product_Package__c, LLC_BI__Maturity_Date__c '
              f'FROM LLC_BI__Loan__c WHERE Id IN {soql_in(loan_ids)}')
    booked = [ln for ln in loans if ln['LLC_BI__Stage__c'] == 'Booked']
    booked_sum = sum(ln['LLC_BI__Amount__c'] or 0 for ln in booked)
    facilities = exp.get('facilities') or []
    facility_ids = {f['loanId'] for f in facilities}

    r.check('exposure returns every seeded facility',
            set(loan_ids) <= facility_ids,
            f'{len(facilities)} facilities, {len(set(loan_ids) - facility_ids)} missing')
    r.check('committed equals the sum of the booked loans',
            abs(sum(f['committed'] or 0 for f in facilities
                    if f['loanId'] in {b['Id'] for b in booked}) - booked_sum) < 1,
            money(booked_sum))
    r.check('every booked facility carries an outstanding balance',
            all((ln['LLC_BI__AmountOutstanding__c'] or 0) > 0 for ln in booked),
            f'{sum(1 for ln in booked if not ln["LLC_BI__AmountOutstanding__c"])} without one')

    revolvers = [ln for ln in booked if ln['LLC_BI__Product__c'] in REVOLVING]
    r.check('drawn sits below committed on every line',
            all((ln['LLC_BI__AmountOutstanding__c'] or 0) < (ln['LLC_BI__Amount__c'] or 0)
                for ln in revolvers) and revolvers,
            f'{len(revolvers)} lines')
    r.check('availability is computed on every line',
            all((ln['LLC_BI__Amount_Available__c'] or 0) > 0 for ln in revolvers),
            ', '.join(money(ln['LLC_BI__Amount_Available__c']) for ln in revolvers))

    covered = [f for f in facilities if f.get('collateral')]
    r.check('coverage is computed where collateral is pledged',
            covered and all(f.get('coverageRatio') is not None for f in covered),
            f'{len(covered)} secured facilities')
    r.check('no in-flight facility sits inside a booked package',
            not [ln for ln in loans
                 if ln['LLC_BI__Stage__c'] != 'Booked'
                 and ln['LLC_BI__Product_Package__c'] in {p['Id'] for p in booked_pkgs}],
            '')

    print('\n--- covenants')
    covs = cov.get('covenants') or []
    seeded_covs = list(rec.get('LLC_BI__Covenant2__c', {}).values())
    r.check('every seeded covenant reads at relationship level',
            len(covs) >= len(seeded_covs), f'{len(covs)} of {len(seeded_covs)}')
    r.check('at least two relationship-level covenants', len(covs) >= 2, str(len(covs)))
    r.check('every covenant carries a threshold and a frequency',
            covs and all(c.get('thresholdValue') is not None and c.get('frequency')
                         for c in covs), '')
    r.check('every covenant carries its next test date',
            covs and all(c.get('nextEvaluationDate') for c in covs), '')
    # Compliance rows are not seeded (every insert fires an approval at a real human in this
    # org), so the history the cockpit reads is the covenant's own last evaluation.
    hist = q(f'SELECT Id, LLC_BI__Last_Evaluation_Value__c, LLC_BI__Last_Evaluation_Status__c, '
             f'LLC_BI__Last_Evaluation_Date__c FROM LLC_BI__Covenant2__c WHERE Id IN {soql_in(seeded_covs)}')
    r.check('every covenant carries a last evaluation value, status and date',
            hist and all(h.get('LLC_BI__Last_Evaluation_Value__c') is not None
                         and h.get('LLC_BI__Last_Evaluation_Status__c') and h.get('LLC_BI__Last_Evaluation_Date__c')
                         for h in hist), f'{len(hist)} covenants')
    r.check('the last evaluations are not all one status',
            len({h.get('LLC_BI__Last_Evaluation_Status__c') for h in hist}) >= 2,
            ', '.join(sorted(str(h.get('LLC_BI__Last_Evaluation_Status__c')) for h in hist)))
    junctions = q(f'SELECT Id FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Covenant2__c IN '
                  f'{soql_in(seeded_covs)}')
    r.check('covenants are attached at loan level too', len(junctions) >= 1,
            f'{len(junctions)} junctions')
    assoc = q(f'SELECT Id FROM LLC_BI__Account_Covenant__c WHERE LLC_BI__Covenant2__c IN '
              f'{soql_in(seeded_covs)}')
    r.check('every covenant carries its account association',
            len(assoc) == len(seeded_covs), f'{len(assoc)} of {len(seeded_covs)}')

    print('\n--- relationship graph')
    conns = graph.get('connections') or []
    ents = graph.get('legalEntities') or []
    seeded_conns = list(rec.get('LLC_BI__Connection__c', {}).values())
    r.check('the graph shows the household', len(conns) >= 2, f'{len(conns)} edges')
    # THE GRAPH READ ONLY RETURNS EDGES THAT TOUCH THE ANCHOR. An owner whose stake runs
    # through a holding company has no edge to the borrower and is invisible on the
    # household card, which is how the first proof run lost two of four owners.
    # Only edges that TOUCH the anchor come back, so an owner whose stake runs through
    # a holding company is invisible unless a direct edge carries the indirect percent.
    # That lost two of four owners on the first proof run. The check is therefore on the
    # household members, not the edge count: nCino mints a reciprocal for every edge, so
    # counting edges would compare our seven against the org's fourteen.
    anchor_accounts = {v for k, v in rec.get('Account', {}).items()
                       if v != acct}
    seen = {c.get('counterpartyId') for c in conns}
    missing = anchor_accounts - seen
    r.check('every household member is visible from the anchor', not missing,
            f'{len(seen & anchor_accounts)} of {len(anchor_accounts)} household accounts'
            + (f'; missing {sorted(missing)}' if missing else ''))
    r.check('the household carries ownership percentages',
            any((c.get('ownershipPercent') or c.get('indirectOwnershipPercent')) for c in conns), '')
    r.check('the graph shows the loan involvements', len(ents) >= 2, f'{len(ents)} rows')
    roles = {e.get('borrowerType') for e in ents}
    r.check('involvements carry a borrower and a guarantor',
            'Borrower' in roles and ({'Guarantor', 'Limited Guarantor'} & roles),
            ', '.join(sorted(x for x in roles if x)))
    r.check('guaranties carry their type',
            any(e.get('guarantyAmountType') for e in ents
                if e.get('borrowerType') in ('Guarantor', 'Limited Guarantor')), '')

    print('\n--- signals and the rest')
    r.check('structural signals answer without error', 'note' in sig, '')
    r.check('signals see the guarantors',
            len(sig.get('guarantorSignals') or []) >= 1,
            f'{len(sig.get("guarantorSignals") or [])} guarantor signals')
    r.check('at least one open opportunity',
            len(opps.get('opportunities') or []) >= 1,
            f'{len(opps.get("opportunities") or [])}')

    for obj, label, minimum in [
            ('LLC_BI__Fee__c', 'fees', 1),
            ('LLC_BI__Pricing_Stream__c', 'pricing streams', 1),
            ('LLC_BI__Collateral__c', 'collateral assets', 1),
            ('LLC_BI__Account_Collateral__c', 'collateral ownership rows', 1),
            ('LLC_BI__Loan_Collateral2__c', 'pledges', 1),
            ('LLC_BI__Collateral_Valuation__c', 'valuations', 1),
            ('LLC_BI__Review__c', 'reviews', 1),
            ('LLC_BI__Policy_Exception__c', 'policy exceptions', 1),
            ('Case', 'open cases', 1)]:
        ids = list(rec.get(obj, {}).values())
        alive = q(f'SELECT Id FROM {obj} WHERE Id IN {soql_in(ids)}') if ids else []
        r.check(f'{label} present and readable', len(alive) >= minimum,
                f'{len(alive)} of {len(ids)} recorded')

    print('\n--- summary')
    bad = r.failures()
    total = len(r.rows)
    print(f'{total - len(bad)}/{total} assertions pass')
    if bad:
        print('\nFAILED:')
        for _, name, detail in bad:
            print(f'  {name}   {detail}')
        sys.exit(1)
    print('\nrelationship is complete and internally consistent.')


if __name__ == '__main__':
    main()
