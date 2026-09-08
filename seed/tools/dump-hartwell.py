"""Dump every record the Customer 360 read tools can reach from Hartwell.

READ ONLY. This script issues no DML of any kind. It exists so the seed recipe
is derived from what the org actually holds on the reference relationship rather
than from anybody's memory of it.

    read TOK INST <<< "$(~/.local/bin/bankinggpt-rest)"; export TOK INST
    python3 seed/tools/dump-hartwell.py

Writes seed/reference/hartwell-<object>.json, one file per object, every field
value included (FIELDS(ALL), which is why every leg is capped at 200 rows: the
whole Hartwell tree is two orders of magnitude below that).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'lib'))
from sfrest import SfError, q, soql_in  # noqa: E402

ACCT = '001bb00001I7FPNAA3'
OUT = os.path.normpath(os.path.join(HERE, '..', 'reference'))

written = {}


def dump(obj, where, note=''):
    try:
        rows = q(f'SELECT FIELDS(ALL) FROM {obj} WHERE {where} LIMIT 200')
    except SfError as e:
        print(f'  {obj:42s} UNREADABLE  {e.body[:160]}')
        return []
    for r in rows:
        r.pop('attributes', None)
    path = os.path.join(OUT, f'hartwell-{obj}.json')
    with open(path, 'w') as f:
        json.dump(rows, f, indent=2, sort_keys=True)
    written[obj] = len(rows)
    print(f'  {obj:42s} {len(rows):4d}  {note}')
    return rows


os.makedirs(OUT, exist_ok=True)

# --- the spine ------------------------------------------------------------
packages = dump('LLC_BI__Product_Package__c', f"LLC_BI__Account__c='{ACCT}'")
pkg_ids = [r['Id'] for r in packages]
loans = dump('LLC_BI__Loan__c', f"LLC_BI__Account__c='{ACCT}'")
loan_ids = [r['Id'] for r in loans]
inL, inP = soql_in(loan_ids), soql_in(pkg_ids)

# --- the household: every account the graph or the involvements name --------
conns = dump('LLC_BI__Connection__c',
             f"LLC_BI__Connected_From__c='{ACCT}' OR LLC_BI__Connected_To__c='{ACCT}'")
ents = dump('LLC_BI__Legal_Entities__c',
            f"LLC_BI__Account__c='{ACCT}' OR LLC_BI__Loan__c IN {inL} "
            f"OR LLC_BI__Product_Package__c IN {inP}")
household = {ACCT}
for c in conns:
    household.add(c.get('LLC_BI__Connected_From__c'))
    household.add(c.get('LLC_BI__Connected_To__c'))
for e in ents:
    household.add(e.get('LLC_BI__Account__c'))
household.discard(None)
dump('Account', f'Id IN {soql_in(sorted(household))}', 'anchor + household')
dump('AccountContactRelation', f'AccountId IN {soql_in(sorted(household))}')
dump('Contact', f'AccountId IN {soql_in(sorted(household))}')

# --- facility detail -------------------------------------------------------
dump('LLC_BI__Loan_Detail__c', f'LLC_BI__Loan__c IN {inL}', 'nCino mints one per loan')
streams = dump('LLC_BI__Pricing_Stream__c', f'LLC_BI__Loan__c IN {inL}')
inS = soql_in([r['Id'] for r in streams])
dump('LLC_BI__Pricing_Rate_Component__c', f'LLC_BI__Pricing_Stream__c IN {inS}')
dump('LLC_BI__Pricing_Payment_Component__c', f'LLC_BI__Pricing_Stream__c IN {inS}')
dump('LLC_BI__Fee__c', f'LLC_BI__Loan__c IN {inL}')
dump('LLC_BI__Loan_Modification__c', f'LLC_BI__Loan__c IN {inL}')
dump('LLC_BI__LoanRenewal__c', f'LLC_BI__ParentLoanId__c IN {inL}')

# --- covenants -------------------------------------------------------------
covs = dump('LLC_BI__Covenant2__c', f"LLC_BI__Account__c='{ACCT}'")
inCov = soql_in([r['Id'] for r in covs])
dump('LLC_BI__Account_Covenant__c', f"LLC_BI__Account__c='{ACCT}'")
dump('LLC_BI__Loan_Covenant__c', f'LLC_BI__Loan__c IN {inL} OR LLC_BI__Covenant2__c IN {inCov}')
dump('LLC_BI__Covenant_Compliance2__c', f'LLC_BI__Covenant__c IN {inCov}')

# --- collateral ------------------------------------------------------------
acol = dump('LLC_BI__Account_Collateral__c', f"LLC_BI__Account__c IN {soql_in(sorted(household))}")
col_ids = sorted({r['LLC_BI__Collateral__c'] for r in acol if r.get('LLC_BI__Collateral__c')})
pledges = dump('LLC_BI__Loan_Collateral2__c', f'LLC_BI__Loan__c IN {inL}')
col_ids = sorted(set(col_ids) | {p['LLC_BI__Collateral__c'] for p in pledges if p.get('LLC_BI__Collateral__c')})
inC = soql_in(col_ids)
dump('LLC_BI__Collateral__c', f'Id IN {inC}')
dump('LLC_BI__Collateral_Valuation__c', f'LLC_BI__Collateral__c IN {inC}')
aggs = sorted({p['LLC_BI__Loan_Collateral_Aggregate__c'] for p in pledges
               if p.get('LLC_BI__Loan_Collateral_Aggregate__c')})
dump('LLC_BI__Loan_Collateral_Aggregate__c', f'Id IN {soql_in(aggs)}', 'auto-minted per loan')

# --- governance ------------------------------------------------------------
dump('LLC_BI__Review__c', f"LLC_BI__Account__c='{ACCT}'", 'annual review')
dump('LLC_BI__Annual_Review__c', f"LLC_BI__Account__c='{ACCT}'", 'risk rating review')
dump('LLC_BI__Policy_Exception__c', f'LLC_BI__Loan__c IN {inL}')
dump('Opportunity', f"AccountId='{ACCT}'")
dump('Case', f"AccountId='{ACCT}'")
dump('cm_Action_Staging__c', f"cm_Account__c='{ACCT}'", 'cockpit action trail')

# --- the catalogs the seed has to pick ids out of --------------------------
dump('LLC_BI__Covenant_Type__c', 'Id != null')
dump('LLC_BI__Collateral_Type__c', 'Id != null')
dump('LLC_BI__Connection_Role__c', 'Id != null')
dump('LLC_BI__Product__c', 'Id != null')

with open(os.path.join(OUT, 'INDEX.json'), 'w') as f:
    json.dump({'account': ACCT, 'counts': written}, f, indent=2, sort_keys=True)
print('\n', len(written), 'objects dumped ->', OUT)
