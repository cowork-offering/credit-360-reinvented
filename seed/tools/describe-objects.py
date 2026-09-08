"""Field facts for every object the seed writes: what is required, what is
createable, what a picklist will accept, and what is a formula or rollup the
seed must never try to set.

READ ONLY.  python3 seed/tools/describe-objects.py [Object [Object ...]]
Writes seed/reference/describe-<object>.json and prints the summary MODEL.md
is built from.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'lib'))
from sfrest import SfError, describe  # noqa: E402

OUT = os.path.normpath(os.path.join(HERE, '..', 'reference'))

OBJECTS = sys.argv[1:] or [
    'Account', 'LLC_BI__Product_Package__c', 'LLC_BI__Loan__c', 'LLC_BI__Loan_Detail__c',
    'LLC_BI__Legal_Entities__c', 'LLC_BI__Connection__c',
    'LLC_BI__Covenant2__c', 'LLC_BI__Account_Covenant__c', 'LLC_BI__Loan_Covenant__c',
    'LLC_BI__Covenant_Compliance2__c',
    'LLC_BI__Collateral__c', 'LLC_BI__Account_Collateral__c', 'LLC_BI__Loan_Collateral2__c',
    'LLC_BI__Collateral_Valuation__c',
    'LLC_BI__Pricing_Stream__c', 'LLC_BI__Pricing_Rate_Component__c',
    'LLC_BI__Pricing_Payment_Component__c', 'LLC_BI__Fee__c',
    'LLC_BI__Review__c', 'LLC_BI__Annual_Review__c', 'LLC_BI__Policy_Exception__c',
    'Opportunity', 'Case',
]

for obj in OBJECTS:
    try:
        d = describe(obj)
    except SfError as e:
        print(f'{obj}: UNDESCRIBABLE {e.code}')
        continue
    fields = []
    for f in d['fields']:
        fields.append({
            'name': f['name'], 'type': f['type'], 'label': f['label'],
            'createable': f['createable'], 'updateable': f['updateable'],
            'nillable': f['nillable'], 'defaultedOnCreate': f['defaultedOnCreate'],
            'calculated': f['calculated'], 'length': f.get('length'),
            'referenceTo': f.get('referenceTo'),
            'picklistValues': [p['value'] for p in f.get('picklistValues', []) if p.get('active')],
        })
    rts = [{'name': r['name'], 'id': r['recordTypeId'], 'available': r['available'],
            'default': r['defaultRecordTypeMapping']} for r in d.get('recordTypeInfos', [])]
    with open(os.path.join(OUT, f'describe-{obj}.json'), 'w') as fh:
        json.dump({'name': obj, 'fields': fields, 'recordTypes': rts}, fh, indent=2)

    required = [f['name'] for f in fields
                if f['createable'] and not f['nillable'] and not f['defaultedOnCreate']]
    print(f'\n===== {obj}')
    print('  REQUIRED ON CREATE :', ', '.join(required) or '(none)')
    print('  RECORD TYPES       :', ', '.join(
        f"{r['name']}{'*' if r['default'] else ''}{'' if r['available'] else ' (NOT AVAILABLE)'}"
        for r in rts) or '(none)')
    picks = [f for f in fields if f['picklistValues'] and f['createable']]
    for f in picks:
        print(f"  PICKLIST {f['name']:48s} {', '.join(f['picklistValues'])[:220]}")
