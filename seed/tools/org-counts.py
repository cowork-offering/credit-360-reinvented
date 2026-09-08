"""Row counts per object, org-wide, so a seed and a cleanup can be proved to be
each other's inverse. READ ONLY.

    python3 seed/tools/org-counts.py > before.json
    ...
    python3 seed/tools/org-counts.py --against before.json
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'lib'))
from sfrest import SfError, call  # noqa: E402
import urllib.parse  # noqa: E402

OBJECTS = [
    'Account', 'Contact', 'Opportunity', 'Case',
    'LLC_BI__Product_Package__c', 'LLC_BI__Loan__c', 'LLC_BI__Loan_Detail__c',
    'LLC_BI__Legal_Entities__c', 'LLC_BI__Connection__c',
    'LLC_BI__Pricing_Stream__c', 'LLC_BI__Pricing_Rate_Component__c',
    'LLC_BI__Pricing_Payment_Component__c', 'LLC_BI__Fee__c',
    'LLC_BI__Covenant2__c', 'LLC_BI__Account_Covenant__c', 'LLC_BI__Loan_Covenant__c',
    'LLC_BI__Covenant_Compliance2__c',
    'LLC_BI__Collateral__c', 'LLC_BI__Account_Collateral__c', 'LLC_BI__Loan_Collateral2__c',
    'LLC_BI__Loan_Collateral_Aggregate__c', 'LLC_BI__Collateral_Valuation__c',
    'LLC_BI__Review__c', 'LLC_BI__Annual_Review__c', 'LLC_BI__Policy_Exception__c',
    'LLC_BI__Loan_Modification__c', 'LLC_BI__LoanRenewal__c',
]


def count(obj):
    soql = urllib.parse.quote(f'SELECT COUNT() FROM {obj}')
    return call('GET', f'/services/data/v62.0/query?q={soql}')['totalSize']


ap = argparse.ArgumentParser()
ap.add_argument('--against', help='a counts file from an earlier run')
args = ap.parse_args()

now = {}
for obj in OBJECTS:
    try:
        now[obj] = count(obj)
    except SfError as e:
        now[obj] = f'ERROR {e.code}'

if not args.against:
    print(json.dumps(now, indent=2))
    sys.exit(0)

with open(args.against) as f:
    before = json.load(f)
drift = 0
print(f'{"object":44s} {"before":>8s} {"after":>8s} {"delta":>8s}')
for obj in OBJECTS:
    b, a = before.get(obj), now.get(obj)
    d = (a - b) if isinstance(a, int) and isinstance(b, int) else '?'
    if d != 0:
        drift += 1 if d != '?' else 1
    print(f'{obj:44s} {str(b):>8s} {str(a):>8s} {str(d):>8s}'
          + ('   <-- DRIFT' if d != 0 else ''))
print(f'\n{drift} objects differ from the baseline'
      if drift else '\nevery object is back at its baseline count')
sys.exit(1 if drift else 0)
