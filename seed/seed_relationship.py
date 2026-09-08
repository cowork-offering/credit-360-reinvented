#!/usr/bin/env python3
"""Build one full commercial-credit relationship in the bankinggpt sandbox.

    read TOK INST <<< "$(~/.local/bin/bankinggpt-rest)"; export TOK INST
    python3 seed/seed_relationship.py seed/examples/meridian.json

WHAT IT GUARANTEES

  ORDER. Records are created in the one sequence the org's triggers and
  validation rules accept: accounts, connections, packages, loans, involvements,
  pricing, fees, collateral, ownership, pledges, valuations, covenants,
  associations, junctions, evaluations, governance, then the package rollups.
  seed/MODEL.md states why each edge of that order exists.

  A MANIFEST THAT IS ALWAYS AHEAD OF THE ORG. Every id is appended to
  seed/manifests/<slug>.json the moment its batch returns, before the next batch
  starts. A run killed halfway leaves a manifest that cleans up everything it
  made, which is the only reason a half-run is survivable.

  IDEMPOTENCE BY KEY, AND FOR OWNERSHIP BY CONTENT. Every record in the input
  carries a `key` that is unique inside its object. A re-run reads the manifest,
  re-resolves each id against the org, and creates only what is missing. Nothing
  already recorded is ever renamed, so a row created under an older key shape
  stays tracked under that shape for the rest of its life. Account_Collateral
  goes one step further and looks for its own (collateral, account, association)
  in the org before inserting, because that is the row a changed key shape could
  otherwise duplicate. Re-running a finished relationship creates nothing.

  ERRORS THAT DO NOT LIE. allOrNone is false, so one refused record does not
  discard the thirty that were fine. The org's own message is captured against
  the input row that caused it and printed at the end.
"""
import argparse
import datetime
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'lib'))
from sfrest import create, q, soql_in, update  # noqa: E402

TAG = 'C360-SEED-2026-09'

# The org's own ids, read off Hartwell (seed/reference/). A recipe that resolved
# these by name at runtime would be one rename away from picking a different
# record type, so they are pinned and the dump is the receipt.
RT = {
    'Account.Business': '012bb000000NNdRAAW',
    'Account.PersonAccount': '012Hp000002JdDmIAK',
    'LLC_BI__Loan__c.Commercial': '012bb000000NfLpAAK',
    'LLC_BI__Covenant2__c.Financial Ratio': '012bb000001SSLlAAO',
    'LLC_BI__Covenant2__c.Financial Statements': '012bb000001SSNNAA4',
    'LLC_BI__Covenant2__c.Information': '012bb000001SSOzAAO',
    'LLC_BI__Review__c.Account Review Complete': '012bb000000NNeJAAW',
    'LLC_BI__Review__c.Account Review In Progress': '012bb000000NNeKAAW',
}

# THE FREE-TEXT FIELD THE TAG LANDS IN, per object.
#
# Two objects are absent and that is a finding, not an omission: the covenant
# junctions (LLC_BI__Account_Covenant__c, LLC_BI__Loan_Covenant__c) expose no
# createable text field at all. They are manifest-only, and they are reachable
# from their covenant and their loan, so nothing about them is unfindable.
# Fields marked here are UNIQUE external ids in this org, so the bare tag collides
# on the second record that uses one. They get the tag, the relationship's slug and
# the record's own key.
UNIQUE_TAG_FIELD = {
    'LLC_BI__Pricing_Stream__c', 'LLC_BI__Pricing_Rate_Component__c',
    'LLC_BI__Pricing_Payment_Component__c', 'LLC_BI__Account_Collateral__c',
    'LLC_BI__Loan_Collateral2__c',
}

TAG_FIELD = {
    'Account': 'Description',
    'LLC_BI__Connection__c': 'LLC_BI__Description__c',
    'LLC_BI__Product_Package__c': 'LLC_BI__Description__c',
    'LLC_BI__Loan__c': 'LLC_BI__Description__c',
    'LLC_BI__Legal_Entities__c': 'LLC_BI__Notes__c',
    'LLC_BI__Pricing_Stream__c': 'LLC_BI__lookupKey__c',
    'LLC_BI__Pricing_Rate_Component__c': 'LLC_BI__lookupKey__c',
    'LLC_BI__Pricing_Payment_Component__c': 'LLC_BI__lookupKey__c',
    'LLC_BI__Fee__c': 'LLC_BI__Fee_Type_Description__c',
    'LLC_BI__Collateral__c': 'LLC_BI__Description__c',
    'LLC_BI__Account_Collateral__c': 'LLC_BI__lookupKey__c',
    'LLC_BI__Loan_Collateral2__c': 'LLC_BI__LookupKey__c',
    'LLC_BI__Collateral_Valuation__c': 'LLC_BI__Comments__c',
    'LLC_BI__Covenant2__c': 'LLC_BI__Notes__c',
    'LLC_BI__Covenant_Compliance2__c': 'LLC_BI__Comments__c',
    'LLC_BI__Review__c': 'LLC_BI__Narrative__c',
    'LLC_BI__Annual_Review__c': 'LLC_BI__Comments__c',
    'LLC_BI__Policy_Exception__c': 'LLC_BI__Code__c',
    'Opportunity': 'Description',
    'Case': 'Description',
}


def unique_key(slug, key):
    """The value written into a unique external id field.

    THE SLUG IS IN THE KEY BECAUSE THESE FIELDS ARE UNIQUE ORG-WIDE, NOT PER
    RELATIONSHIP. The first shape was `<tag>/<record key>`, and a record key is
    only promised to be unique inside its own spec: four relationships called an
    asset "receivables" and three of them were refused with DUPLICATE_VALUE on a
    row nobody could see, belonging to the one that ran first. Everything derived
    from a record key goes through here, and validate_spec.py imports this same
    function so its cross-file collision check derives exactly what the seed writes.
    """
    return f'{TAG}/{slug}/{key}'


def tagged(obj, record, text=None, key=None, slug=None):
    """Stamp the seed tag onto a record without losing the prose already there."""
    field = TAG_FIELD.get(obj)
    if not field:
        return record
    if obj in UNIQUE_TAG_FIELD:
        if not slug:
            raise SystemExit(f'{obj} writes a unique external id and was tagged without '
                             f'a slug; that is the collision this scoping exists to stop')
        record[field] = unique_key(slug, key)
        return record
    body = text if text is not None else record.get(field)
    record[field] = f'{body} [{TAG}]' if body else TAG
    return record


def prune(record):
    """Drop keys the caller left as None. Sending an explicit null to a picklist
    the org defaults is how a defaulted field ends up empty."""
    return {k: v for k, v in record.items() if v is not None}


class Manifest:
    """Every id this run created, written to disk after every batch."""

    def __init__(self, path, slug, account_name):
        self.path = path
        if os.path.exists(path):
            with open(path) as f:
                self.data = json.load(f)
        else:
            self.data = {'slug': slug, 'tag': TAG, 'relationship': account_name,
                         'account': None, 'createdAt': _now(), 'order': [],
                         'records': {}, 'derived': {}, 'errors': []}
        self.data['updatedAt'] = _now()

    def id_for(self, obj, key):
        return self.data['records'].get(obj, {}).get(key)

    def note(self, obj, key, rec_id):
        self.data['records'].setdefault(obj, {})[key] = rec_id
        self.data['order'].append({'object': obj, 'key': key, 'id': rec_id})

    def note_derived(self, obj, ids):
        """Records nCino's own triggers minted beside ours. Cleanup deletes only
        what a manifest holds, so a row the org created on our behalf has to be
        written down or it becomes an orphan nobody is allowed to remove."""
        have = set(self.data['derived'].setdefault(obj, []))
        for i in ids:
            if i not in have:
                self.data['derived'][obj].append(i)
                have.add(i)

    def fail(self, obj, key, errors):
        """One entry per refused key. A re-run that meets the same refusal replaces
        its entry instead of appending a second, so the block reads as the state of
        the relationship and not as a tape of every attempt ever made."""
        entry = {'object': obj, 'key': key, 'errors': errors, 'at': _now()}
        for i, e in enumerate(self.data['errors']):
            if e['object'] == obj and e['key'] == key and not e.get('resolvedAt'):
                self.data['errors'][i] = entry
                return
        self.data['errors'].append(entry)

    def settle_errors(self):
        """A refusal the org has since accepted is history, not an outstanding debt.

        Every unmarked error whose key now holds an id is stamped `resolvedAt`, and
        what is left unmarked is what this relationship still owes. Without this a
        finished relationship that was refused once on its way in could never exit 0
        again, and the only way to make it clean would be to delete the evidence.
        """
        for e in self.data['errors']:
            if e.get('resolvedAt'):
                continue
            if self.id_for(e['object'], e['key']):
                e['resolvedAt'] = _now()
                e['resolution'] = ('the record exists under this key; the refusal was '
                                   'an earlier attempt')
        return [e for e in self.data['errors'] if not e.get('resolvedAt')]

    def save(self):
        self.data['updatedAt'] = _now()
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(self.data, f, indent=2)
        os.replace(tmp, self.path)

    def prune_vanished(self):
        """A manifest is not proof a record still exists. Anything the org no
        longer returns is dropped so the run rebuilds it instead of skipping it
        and then failing on a dangling lookup."""
        gone = 0
        for obj, bykey in list(self.data['records'].items()):
            ids = list(bykey.values())
            if not ids:
                continue
            alive = {r['Id'] for r in q(f'SELECT Id FROM {obj} WHERE Id IN {soql_in(ids)}')}
            for key, rec_id in list(bykey.items()):
                if rec_id not in alive:
                    del bykey[key]
                    self.data['order'] = [e for e in self.data['order'] if e['id'] != rec_id]
                    gone += 1
        if gone:
            print(f'  manifest: {gone} recorded ids no longer in the org, rebuilding those')
        return gone


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


class Seeder:
    def __init__(self, spec, manifest, slug):
        self.spec = spec
        self.m = manifest
        self.slug = slug
        self.failed = False

    def ref(self, obj, key):
        rec_id = self.m.id_for(obj, key)
        if rec_id is None:
            raise SystemExit(f'unresolved reference {obj}:{key} - a record it depends on '
                             f'was refused earlier in this run; fix that and re-run')
        return rec_id

    def maybe(self, obj, key):
        return self.m.id_for(obj, key) if key else None

    def build(self, obj, rows, label=None):
        """rows: list of (key, record). Already-created keys are skipped."""
        todo = [(k, r) for k, r in rows if self.m.id_for(obj, k) is None]
        skipped = len(rows) - len(todo)
        if not todo:
            if rows:
                print(f'  {label or obj:34s} {len(rows):3d} already present')
            return
        ids, errors = create(obj, [prune(r) for _, r in todo])
        made = 0
        for (key, _), rec_id in zip(todo, ids):
            if rec_id:
                self.m.note(obj, key, rec_id)
                made += 1
        for e in errors:
            key = todo[e['index']][0]
            self.m.fail(obj, key, e['errors'])
            self.failed = True
        self.m.save()
        note = f' ({skipped} present)' if skipped else ''
        bad = f'  {len(errors)} REFUSED' if errors else ''
        print(f'  {label or obj:34s} {made:3d} created{note}{bad}')
        for e in errors:
            print(f'      {todo[e["index"]][0]}: {json.dumps(e["errors"])[:300]}')

    # ---------------------------------------------------------------- accounts
    def accounts(self):
        rows = []
        for a in self.spec.get('accounts', []):
            kind = a.get('kind', 'business')
            rec = {
                'Name': a['name'],
                'RecordTypeId': RT['Account.PersonAccount' if kind == 'person' else 'Account.Business'],
                'Type': a.get('type', 'Customer - Commercial' if kind != 'person' else None),
                'LLC_BI__Status__c': a.get('customerStatus', 'Customer'),
                'Industry': a.get('industry'),
                'NAICS_Code__c': a.get('naics'),
                'AnnualRevenue': a.get('annualRevenue'),
                'LLC_BI__Highest_Risk_Grade__c': a.get('riskGrade'),
                'Risk_Status__c': a.get('riskStatus'),
                'LLC_BI__Next_Review_Date__c': a.get('nextReviewDate'),
                'LLC_BI__Last_Review_Date__c': a.get('lastReviewDate'),
                'BillingCity': a.get('billingCity'),
                'BillingState': a.get('billingState'),
                'BillingCountry': a.get('billingCountry', 'USA') if kind != 'person' else None,
            }
            if kind == 'person':
                # A Person Account refuses Name; it wants the two name halves and
                # keeps Name as a formula over them.
                first, _, last = a['name'].partition(' ')
                rec.pop('Name')
                rec['FirstName'], rec['LastName'] = first, (last or first)
                rec.pop('Type', None)
            rows.append((a['key'], tagged('Account', rec, a.get('description'))))
        self.build('Account', rows, 'Account')
        self.m.data['account'] = self.ref('Account', self.spec['anchorKey'])
        self.m.save()

    def connections(self):
        roles = {r['Name']: r['Id'] for r in q('SELECT Id, Name FROM LLC_BI__Connection_Role__c')}
        rows = []
        for c in self.spec.get('connections', []):
            role = roles.get(c['roleName'])
            if role is None:
                raise SystemExit(f"connection role '{c['roleName']}' is not in this org's "
                                 f"catalog; legal values are in seed/reference/"
                                 f"hartwell-LLC_BI__Connection_Role__c.json")
            rows.append((c['key'], tagged('LLC_BI__Connection__c', {
                'LLC_BI__Connected_From__c': self.ref('Account', c['from']),
                'LLC_BI__Connected_To__c': self.ref('Account', c['to']),
                'LLC_BI__Connection_Role__c': role,
                'LLC_BI__Is_Active__c': True,
                'LLC_BI__Ownership_Percent__c': c.get('ownershipPercent'),
                'LLC_BI__Indirect_Ownership_Percent__c': c.get('indirectOwnershipPercent'),
                'LLC_BI__Official_Title__c': c.get('officialTitle'),
                'LLC_BI__Is_Authorized_Signer__c': c.get('authorizedSigner'),
                'LLC_BI__Is_Control_Prong__c': c.get('controlProng'),
            }, c.get('description'))))
        self.build('LLC_BI__Connection__c', rows, 'Connection (ownership graph)')

        # nCino MINTS THE RECIPROCAL. Every connection created produces a second,
        # mirrored edge with the reciprocal role, written by the managed package and
        # never by us. It is asynchronous, so it is polled; it is recorded, because a
        # cleanup that removed only our seven and left seven mirrors behind would drift
        # the org by exactly the number of household members. Only edges BETWEEN the
        # accounts this manifest created are eligible, so nothing pre-existing is claimed.
        ours = set(self.m.data['records'].get('LLC_BI__Connection__c', {}).values())
        accts = list(self.m.data['records'].get('Account', {}).values())
        if ours and accts:
            mirrors = []
            for attempt in range(6):
                edges = q(f'SELECT Id, LLC_BI__Connected_From__c, LLC_BI__Connected_To__c '
                          f'FROM LLC_BI__Connection__c '
                          f'WHERE LLC_BI__Connected_From__c IN {soql_in(accts)} '
                          f'AND LLC_BI__Connected_To__c IN {soql_in(accts)}')
                mirrors = sorted({e['Id'] for e in edges} - ours)
                if len(mirrors) >= len(ours):
                    break
                time.sleep(1.5 * (attempt + 1))
            self.m.note_derived('LLC_BI__Connection__c', mirrors)
            self.m.save()
            print(f'  {"reciprocal edges (nCino-minted)":34s} {len(mirrors):3d} recorded for cleanup')

    # ------------------------------------------------------- packages + loans
    def packages(self):
        acct = self.m.data['account']
        rows = []
        for p in self.spec['packages']:
            rows.append((p['key'], tagged('LLC_BI__Product_Package__c', {
                'Name': p['name'],
                'LLC_BI__Account__c': acct,
                'LLC_BI__Primary_Entity__c': self.maybe('Account', p.get('primaryEntity')) or acct,
                'LLC_BI__Stage__c': p.get('stage', 'Complete'),
                'LLC_BI__Status__c': p.get('status', 'Approved'),
                'cm_Credit_Stage__c': p.get('creditStage', 'Booked'),
                'LLC_BI__Approval_Status__c': p.get('approvalStatus', 'Ready'),
                'LLC_BI__Deal_Type__c': p.get('dealType', 'Loan Onboarding'),
                'LLC_BI__Review_Frequency__c': p.get('reviewFrequency', 'Annually'),
                'LLC_BI__Risk_Rating__c': p.get('riskRating'),
            }, p.get('description'))))
        self.build('LLC_BI__Product_Package__c', rows, 'Product Package')

        # nCino'S OWN FLOW RENAMES A PACKAGE ON INSERT to "<account> - <date> - PP".
        # The name asked for has to be written back, or every later read shows a
        # package called today's date and the agent brief's naming check fails.
        repair = [{'Id': self.ref('LLC_BI__Product_Package__c', p['key']), 'Name': p['name']}
                  for p in self.spec['packages']]
        errs = update('LLC_BI__Product_Package__c', repair)
        if errs:
            print('    package rename REFUSED:', json.dumps(errs)[:300])
            self.failed = True
        else:
            print(f'  {"package names restored":34s} {len(repair):3d}')

    def loans(self):
        acct = self.m.data['account']
        rows = []
        for p in self.spec['packages']:
            pkg = self.ref('LLC_BI__Product_Package__c', p['key'])
            for ln in p.get('loans', []):
                rows.append((ln['key'], tagged('LLC_BI__Loan__c', {
                    'Name': ln['name'],
                    # THE BORROWER LOOKUP IS ALWAYS THE ANCHOR ACCOUNT, even where
                    # the story's borrower is a household entity. Customer360Exposure
                    # and Customer360StructuralSignals both filter loans by
                    # LLC_BI__Account__c = the anchor, so a facility hung off a
                    # subsidiary is invisible to the cockpit. The entity that
                    # actually borrows is carried on the involvement row instead,
                    # which is where nCino models it and where the graph reads it.
                    'LLC_BI__Account__c': acct,
                    'LLC_BI__Product_Package__c': pkg,
                    'RecordTypeId': RT['LLC_BI__Loan__c.Commercial'],
                    'LLC_BI__Product__c': ln['product'],
                    'LLC_BI__Product_Type__c': ln.get('productType', 'Non-Real Estate'),
                    'LLC_BI__Product_Line__c': ln.get('productLine', 'Commercial'),
                    # BOOKED ON INSERT, and only on insert. Loan_Validation_06 reads
                    # PRIORVALUE and refuses a MOVE to Booked from any pre-approval
                    # stage, so create-then-promote cannot work; Loan_Validation_05
                    # refuses Booked without a lookupKey, so the key is mandatory.
                    'LLC_BI__Stage__c': ln.get('stage', 'Booked'),
                    'LLC_BI__Status__c': ln.get('status', 'Open'),
                    'LLC_BI__lookupKey__c': ln['lookupKey'],
                    'LLC_BI__Risk_Grade__c': ln.get('riskGrade'),
                    'LLC_BI__Amount__c': ln['amount'],
                    'LLC_BI__Approved_Loan_Amount__c': ln.get('approvedAmount', ln['amount']),
                    # Amount_Available is a FORMULA (Amount - AmountOutstanding), so
                    # a loan with no outstanding balance reports nothing available
                    # and the cockpit's drawn/committed line renders empty.
                    'LLC_BI__AmountOutstanding__c': ln.get('outstanding'),
                    'LLC_BI__Principal_Balance__c': ln.get('outstanding'),
                    'LLC_BI__Current_Interest_Rate__c': ln.get('rate'),
                    'LLC_BI__InterestRate__c': ln.get('noteRate', ln.get('rate')),
                    'LLC_BI__Index__c': ln.get('index'),
                    'LLC_BI__Spread__c': ln.get('spread'),
                    'LLC_BI__Term_Months__c': ln.get('termMonths'),
                    'LLC_BI__Amortized_Term_Months__c': ln.get('amortMonths'),
                    'LLC_BI__First_Payment_Date__c': ln.get('firstPaymentDate'),
                    'LLC_BI__Maturity_Date__c': ln.get('maturityDate'),
                    'LLC_BI__CloseDate__c': ln.get('closeDate'),
                    'LLC_BI__Booked_Date__c': ln.get('bookedDate'),
                    'Application_Date__c': ln.get('applicationDate'),
                    'LLC_BI__Payment_Schedule__c': ln.get('paymentSchedule', 'Monthly'),
                    'LLC_BI__Payment_Type__c': ln.get('paymentType'),
                    'LLC_BI__Interest_Accrual_Method__c': ln.get('interestAccrualMethod', '30_360'),
                    'LLC_BI__Financed_Fee_Calculations__c': 'Manual Calculation',
                    'LLC_BI__HMDA_Record_Type__c': 'HMDA-Effective-2018',
                    'LLC_BI__Loan_Class__c': ln.get('loanClass', 'New Loan'),
                    'LLC_BI__Balloon__c': ln.get('balloon', False),
                    'LLC_BI__Is_Secured__c': ln.get('isSecured', True),
                    'Primary_Source_of_Repayment__c': ln.get(
                        'primaryRepayment', 'Cash flow from Operations'),
                    'Secondary_Source_of_Repayment__c': ln.get(
                        'secondaryRepayment', 'Liquidation of Collateral'),
                }, ln.get('description'))))
        self.build('LLC_BI__Loan__c', rows, 'Loan (facility)')

        # nCino mints one Loan Detail per loan from its own after-insert flow. It is
        # where the loan purpose lives, and it has to be written into the manifest
        # or cleanup would leave it behind as an orphan it is not allowed to touch.
        by_loan = {}
        for p in self.spec['packages']:
            for ln in p.get('loans', []):
                by_loan[self.ref('LLC_BI__Loan__c', ln['key'])] = ln
        # THE FLOW IS ASYNCHRONOUS. Queried in the same breath as the insert it
        # returns nothing, which on the first proof run silently recorded zero
        # details and would have left six orphans behind after cleanup. It is
        # polled instead, and a run that never sees them says so rather than
        # pretending the loans have none.
        details = []
        for attempt in range(8):
            details = q(f'SELECT Id, LLC_BI__Loan__c FROM LLC_BI__Loan_Detail__c '
                        f'WHERE LLC_BI__Loan__c IN {soql_in(list(by_loan))}')
            if len(details) >= len(by_loan):
                break
            time.sleep(1.5 * (attempt + 1))
        if len(details) < len(by_loan):
            print(f'  WARNING: {len(by_loan) - len(details)} Loan Detail rows had not '
                  f'appeared after the poll; re-run the seed to record them')
        self.m.note_derived('LLC_BI__Loan_Detail__c', [d['Id'] for d in details])
        self.m.save()
        patch = [{'Id': d['Id'],
                  'LLC_BI__Primary_Loan_Purpose__c': by_loan[d['LLC_BI__Loan__c']].get('purpose')}
                 for d in details if by_loan[d['LLC_BI__Loan__c']].get('purpose')]
        if patch:
            errs = update('LLC_BI__Loan_Detail__c', patch)
            print(f'  {"loan purpose on Loan Detail":34s} {len(patch) - len(errs):3d} set'
                  + (f'  {len(errs)} REFUSED' if errs else ''))
            for e in errs:
                print(f'      {json.dumps(e["errors"])[:250]}')
        print(f'  {"Loan Detail (nCino-minted)":34s} {len(details):3d} recorded for cleanup')

    def involvements(self):
        rows = []
        for p in self.spec['packages']:
            pkg = self.ref('LLC_BI__Product_Package__c', p['key'])
            for ln in p.get('loans', []):
                loan = self.ref('LLC_BI__Loan__c', ln['key'])
                for inv in ln.get('involvements', []):
                    rows.append((inv['key'], tagged('LLC_BI__Legal_Entities__c', {
                        'LLC_BI__Account__c': self.ref('Account', inv['account']),
                        'LLC_BI__Loan__c': loan,
                        'LLC_BI__Product_Package__c': pkg,
                        'LLC_BI__Borrower_Type__c': inv['borrowerType'],
                        'LLC_BI__Entity_Type__c': inv.get('entityType'),
                        'LLC_BI__Relationship_Type__c': inv.get('relationshipType'),
                        'LLC_BI__Contingent_Type__c': inv.get('contingentType', 'Joint & Several'),
                        'LLC_BI__Ownership__c': inv.get('ownership'),
                        'LLC_BI__Guaranty_Amount__c': inv.get('guarantyType'),
                        # LLC_BI__Limited_Guaranty_Amount__c reads as createable on the
                        # describe and is refused at insert by field-level security for
                        # the integration profile. Guarantee_Limit carries the cap.
                        'LLC_BI__Guarantee_Limit__c': inv.get('guarantyLimit'),
                        'LLC_BI__Is_Included_In_Global_Analysis__c': inv.get('inGlobalAnalysis', True),
                        'LLC_BI__Order__c': inv.get('order'),
                    }, inv.get('notes'))))
        self.build('LLC_BI__Legal_Entities__c', rows, 'Involvement (borrowing structure)')

    def pricing(self):
        streams, rates, payments = [], [], []
        for p in self.spec['packages']:
            for ln in p.get('loans', []):
                pr = ln.get('pricing')
                if not pr:
                    continue
                streams.append((ln['key'], {
                    'Name': f"{ln['name'][:60]} - Pricing Stream",
                    'LLC_BI__Loan__c': self.ref('LLC_BI__Loan__c', ln['key']),
                    # Context_Id is a plain TEXT field holding the loan id. It is not
                    # a lookup and nothing enforces it, so it is written explicitly.
                    'LLC_BI__Context_Id__c': self.ref('LLC_BI__Loan__c', ln['key']),
                    'LLC_BI__Period_Type__c': pr.get('periodType', 'Fixed'),
                    'LLC_BI__Term_Unit__c': 'Unit_Monthly',
                    'LLC_BI__Version__c': '2.0',
                    'LLC_BI__Effective_Date__c': pr.get('effectiveDate'),
                    'LLC_BI__End_Date__c': pr.get('endDate'),
                    'LLC_BI__Is_Payment_Stream__c': True,
                    'LLC_BI__Is_Rate_Stream__c': True,
                    'LLC_BI__Sequence__c': 1,
                    'LLC_BI__Term_Length__c': pr.get('termLength', ln.get('termMonths')),
                })
                )
        self.build('LLC_BI__Pricing_Stream__c',
                   [(k, tagged('LLC_BI__Pricing_Stream__c', r, key=k, slug=self.slug))
                    for k, r in streams],
                   'Pricing Stream')

        for p in self.spec['packages']:
            for ln in p.get('loans', []):
                pr = ln.get('pricing')
                if not pr:
                    continue
                sid = self.ref('LLC_BI__Pricing_Stream__c', ln['key'])
                loan = self.ref('LLC_BI__Loan__c', ln['key'])
                rates.append((ln['key'], tagged('LLC_BI__Pricing_Rate_Component__c', key=ln['key'], slug=self.slug, record={
                    'Name': f"{ln['name'][:56]} - Rate",
                    'LLC_BI__Pricing_Stream__c': sid,
                    'cm_Loan__c': loan,
                    'LLC_BI__Interest_Rate_Type__c': pr.get('rateType', 'Fixed'),
                    'LLC_BI__Index__c': pr.get('index'),
                    'LLC_BI__Index_Spread_Type__c': (
                        'Add Spread to Index' if pr.get('index') else None),
                    'LLC_BI__Spread__c': pr.get('spread'),
                    'LLC_BI__Is_Fixed__c': pr.get('rateType', 'Fixed') == 'Fixed',
                    'LLC_BI__Rate__c': pr.get('rate', ln.get('rate')),
                    # There is no floor field on this object in this org; a rate
                    # floor lives in the covenant or the note, not the component.
                    'LLC_BI__Term_Unit__c': 'Unit_Months',
                    'LLC_BI__Frequency__c': 'Frequency_Monthly',
                    'LLC_BI__Applied_Loan_Percentage__c': 100,
                    'LLC_BI__Effective_Date__c': pr.get('effectiveDate'),
                    'LLC_BI__End_Date__c': pr.get('endDate'),
                    'LLC_BI__Sequence__c': 1,
                    'LLC_BI__Term_Length__c': pr.get('termLength', ln.get('termMonths')),
                })))
                amortises = bool(pr.get('amortises'))
                payments.append((ln['key'], tagged('LLC_BI__Pricing_Payment_Component__c', key=ln['key'], slug=self.slug, record={
                    'Name': f"{ln['name'][:53]} - Payment",
                    'LLC_BI__Pricing_Stream__c': sid,
                    'LLC_BI__Rate_Stream__c': sid,
                    'cm_Loan__c': loan,
                    'LLC_BI__Frequency__c': 'Frequency_Monthly',
                    'LLC_BI__Interest_Frequency__c': 'Frequency_Annually',
                    'LLC_BI__Interest_Payment_Frequency__c': 'Frequency_Monthly',
                    'LLC_BI__Principal_Payment_Frequency__c': (
                        'Frequency_Monthly' if amortises else None),
                    'LLC_BI__Term_Unit__c': 'Unit_Months',
                    'LLC_BI__Includes_Interest__c': True,
                    'LLC_BI__Includes_Principal__c': amortises,
                    'LLC_BI__Amount__c': pr.get('paymentAmount') or _payment(
                        ln.get('outstanding') or ln['amount'],
                        pr.get('rate', ln.get('rate')) or 0,
                        pr.get('amortMonths', ln.get('amortMonths')), amortises),
                    'LLC_BI__Effective_Date__c': pr.get('effectiveDate'),
                    'LLC_BI__End_Date__c': pr.get('endDate'),
                    'LLC_BI__Sequence__c': 1,
                    'LLC_BI__Term_Length__c': pr.get('termLength', ln.get('termMonths')),
                })))
        self.build('LLC_BI__Pricing_Rate_Component__c', rates, 'Pricing Rate Component')
        self.build('LLC_BI__Pricing_Payment_Component__c', payments, 'Pricing Payment Component')

    def fees(self):
        rows = []
        for p in self.spec['packages']:
            for ln in p.get('loans', []):
                loan = self.ref('LLC_BI__Loan__c', ln['key'])
                for fee in ln.get('fees', []):
                    pct = fee.get('percentage')
                    rows.append((fee['key'], tagged('LLC_BI__Fee__c', {
                        'LLC_BI__Loan__c': loan,
                        'LLC_BI__Fee_Type__c': fee['feeType'],
                        # RecordTypeId is refused for this integration profile; the
                        # object carries its own LLC_BI__Record_Type__c picklist and
                        # that is the one that works.
                        'LLC_BI__Record_Type__c': fee.get('recordType', 'Fees'),
                        'LLC_BI__Calculation_Type__c': fee.get(
                            'calculationType', 'Percentage' if pct else 'Flat Amount'),
                        # A percentage fee needs its basis AND its percent; the org
                        # computes Amount itself and refuses to be told what it is.
                        'LLC_BI__Basis_Source__c': 'LLC_BI__Amount__c' if pct else None,
                        'LLC_BI__Percentage__c': pct,
                        'LLC_BI__Amount__c': None if pct else fee.get('amount'),
                        'LLC_BI__Status__c': 'Active',
                        'LLC_BI__Paid_By__c': fee.get('paidBy', 'Financed from Proceeds'),
                        # LLC_BI__Is_Paid_By_Borrower__c reads createable on the
                        # describe and is refused at insert by field-level security.
                        'LLC_BI__Is_Income__c': fee.get('isIncome', True),
                        'LLC_BI__Payout_Frequency__c': fee.get('payoutFrequency'),
                        'LLC_BI__Shoppable_Category__c': 'Service You Cannot Shop For',
                    }, fee.get('description'))))
        self.build('LLC_BI__Fee__c', rows, 'Fee')

    # -------------------------------------------------------------- collateral
    def collateral(self):
        types = {r['Name']: r['Id'] for r in
                 q('SELECT Id, Name FROM LLC_BI__Collateral_Type__c ORDER BY CreatedDate')}
        rows = []
        for c in self.spec.get('collateral', []):
            ct = types.get(c['typeName'])
            if ct is None:
                raise SystemExit(f"collateral type '{c['typeName']}' is not in this org's "
                                 f"catalog; legal values are in seed/reference/"
                                 f"hartwell-LLC_BI__Collateral_Type__c.json")
            rows.append((c['key'], tagged('LLC_BI__Collateral__c', {
                'LLC_BI__Collateral_Name__c': c['name'],
                # RecordTypeId is deliberately absent. Every non-Master collateral
                # record type in this org is unavailable to the integration profile
                # and naming one is rejected outright.
                'LLC_BI__Collateral_Type__c': ct,
                'LLC_BI__Collateral_Legal_Description__c': c.get('legalDescription'),
                'LLC_BI__Assessment_Method__c': c.get('assessmentMethod', 'Appraisal'),
                'LLC_BI__Held_By__c': c.get('heldBy', 'Lender'),
                'LLC_BI__Status__c': c.get('status', 'Available'),
                'LLC_BI__Valuation_Frequency__c': c.get('valuationFrequency', 'Annually'),
                'LLC_BI__Appraisal_Date__c': c.get('appraisalDate'),
                'LLC_BI__Next_Revaluation_Due_Date__c': c.get('nextRevaluationDate'),
                'LLC_BI__Value__c': c.get('value'),
                'LLC_BI__Liquidation_Value__c': c.get('liquidationValue'),
                'LLC_BI__Depth__c': 1,
                'LLC_BI__UCC_Financing_Statement__c': c.get('uccFiled', True),
                'LLC_BI__UCC_State_Filing__c': c.get('uccState'),
                'LLC_BI__City__c': c.get('city'),
                'LLC_BI__State__c': c.get('state'),
            }, c.get('description'))))
        self.build('LLC_BI__Collateral__c', rows, 'Collateral')

        # THE OWNERSHIP LINK IS NOT OPTIONAL (association law, 2026-08-31): a
        # collateral asset without an Account_Collateral row belongs to nobody.
        owners = []
        for c in self.spec.get('collateral', []):
            col = self.ref('LLC_BI__Collateral__c', c['key'])
            for i, ow in enumerate(c.get('owners', [])):
                # THE POSITION IN THE LIST IS THE DEFAULT KEY, NEVER THE LAW. Dropping
                # an owner row renumbers every row after it, the manifest stops matching
                # rows that already exist in the org, and the re-run builds a second
                # copy of each. A row that is already live pins its key with "key".
                okey = ow.get('key') or f"{c['key']}#{i}"
                owners.append((okey, tagged('LLC_BI__Account_Collateral__c',
                                            key=okey.replace('#', '-'), slug=self.slug, record={
                    'LLC_BI__Account__c': self.ref('Account', ow['account']),
                    'LLC_BI__Collateral__c': col,
                    'LLC_BI__Collateral_Association__c': ow.get('association', 'Owner'),
                    'LLC_BI__Ownership_Percentage__c': ow.get('percent', 100),
                    'LLC_BI__Pledging_Authority__c': ow.get('pledgingAuthority', True),
                    'LLC_BI__Primary_Owner__c': ow.get('primary', True),
                    'LLC_BI__Start_Date__c': ow.get('startDate'),
                })))
        self.adopt_ownership(owners)
        self.build('LLC_BI__Account_Collateral__c', owners, 'Account Collateral (ownership)')

        vals = []
        for c in self.spec.get('collateral', []):
            col = self.ref('LLC_BI__Collateral__c', c['key'])
            for v in c.get('valuations', []):
                vals.append((v['key'], tagged('LLC_BI__Collateral_Valuation__c', {
                    'LLC_BI__Collateral__c': col,
                    'LLC_BI__Valuation_Date__c': v['date'],
                    'LLC_BI__Value__c': v['value'],
                    'LLC_BI__Source__c': v.get('source', 'Appraisal'),
                    'LLC_BI__Type__c': v.get('type', 'As Is Value'),
                    'LLC_BI__Active__c': v.get('active', True),
                    'LLC_BI__Primary__c': v.get('primary', False),
                    'LLC_BI__Original_Value__c': v.get('original', False),
                    'LLC_BI__Valuation_Description__c': v.get('description'),
                })))
        self.build('LLC_BI__Collateral_Valuation__c', vals, 'Collateral Valuation')

    def adopt_ownership(self, rows):
        """Ownership is idempotent BY CONTENT, not only by key.

        These rows used to derive their unique lookupKey from the collateral key
        alone, so a row refused as a duplicate of another relationship's asset would
        now insert cleanly under the slug-scoped key and the asset would end up owned
        twice. Before anything is created, the same (collateral, account, association)
        triple is looked for in the org, on the collateral THIS manifest created, and
        a row already standing there is adopted under the key the spec asks for.
        """
        obj = 'LLC_BI__Account_Collateral__c'
        todo = [(k, r) for k, r in rows if self.m.id_for(obj, k) is None]
        cols = list(self.m.data['records'].get('LLC_BI__Collateral__c', {}).values())
        if not todo or not cols:
            return
        known = set(self.m.data['records'].get(obj, {}).values())
        pool = {}
        for r in q(f'SELECT Id, LLC_BI__Collateral__c, LLC_BI__Account__c, '
                   f'LLC_BI__Collateral_Association__c FROM {obj} '
                   f'WHERE LLC_BI__Collateral__c IN {soql_in(cols)}'):
            if r['Id'] in known:
                continue
            pool.setdefault((r['LLC_BI__Collateral__c'], r['LLC_BI__Account__c'],
                             r['LLC_BI__Collateral_Association__c']), []).append(r['Id'])
        adopted = 0
        for key, rec in todo:
            match = pool.get((rec['LLC_BI__Collateral__c'], rec['LLC_BI__Account__c'],
                              rec['LLC_BI__Collateral_Association__c']))
            if match:
                self.m.note(obj, key, match.pop(0))
                adopted += 1
        if adopted:
            self.m.save()
            print(f'  {"ownership adopted by content":34s} {adopted:3d} already in the org')

    def pledges(self):
        rows = []
        for p in self.spec['packages']:
            for ln in p.get('loans', []):
                loan = self.ref('LLC_BI__Loan__c', ln['key'])
                for pl in ln.get('pledges', []):
                    rows.append((pl['key'], tagged('LLC_BI__Loan_Collateral2__c', key=pl['key'], slug=self.slug, record={
                        'LLC_BI__Loan__c': loan,
                        'LLC_BI__Collateral__c': self.ref('LLC_BI__Collateral__c', pl['collateral']),
                        'LLC_BI__Lien_Position__c': pl.get('lienPosition', '1st'),
                        'LLC_BI__Pledged_Status__c': pl.get('pledgedStatus', 'Active'),
                        'LLC_BI__Is_Primary__c': pl.get('isPrimary', False),
                        # The type's own advance rate is 80 percent for everything in
                        # this org's catalog, so a realistic LTV comes from the
                        # override and nowhere else.
                        'LLC_BI__Advance_Rate_Override__c': pl.get('advanceRate'),
                        'LLC_BI__Amount_Pledged__c': pl.get('amountPledged'),
                        'LLC_BI__Start_Date__c': pl.get('startDate'),
                        'LLC_BI__Override_Reason__c': pl.get('overrideReason'),
                    })))
        self.build('LLC_BI__Loan_Collateral2__c', rows, 'Pledge (loan collateral)')

        # The aggregate is minted by the org on the first pledge of a loan and is
        # never ours to author. It is written into the manifest so cleanup can take
        # it away with the pledge that caused it.
        pledge_ids = list(self.m.data['records'].get('LLC_BI__Loan_Collateral2__c', {}).values())
        if pledge_ids:
            aggs = {r['LLC_BI__Loan_Collateral_Aggregate__c'] for r in q(
                f'SELECT LLC_BI__Loan_Collateral_Aggregate__c FROM LLC_BI__Loan_Collateral2__c '
                f'WHERE Id IN {soql_in(pledge_ids)}') if r['LLC_BI__Loan_Collateral_Aggregate__c']}
            self.m.note_derived('LLC_BI__Loan_Collateral_Aggregate__c', sorted(aggs))
            self.m.save()
            print(f'  {"Collateral Aggregate (minted)":34s} {len(aggs):3d} recorded for cleanup')

    # --------------------------------------------------------------- covenants
    def covenants(self):
        acct = self.m.data['account']
        types = {}
        for r in q('SELECT Id, Name, LLC_BI__Category__c FROM LLC_BI__Covenant_Type__c'):
            types.setdefault(r['Name'], []).append(r['Id'])
        rows = []
        for c in self.spec.get('covenants', []):
            ids = types.get(c['typeName'])
            if not ids:
                raise SystemExit(f"covenant type '{c['typeName']}' is not in this org's "
                                 f"60-plus entry catalog; legal values are in seed/reference/"
                                 f"hartwell-LLC_BI__Covenant_Type__c.json")
            # A DUPLICATE NAME IS AN AMBIGUITY, NOT A CHOICE. Nine names appear
            # twice in this catalog. The recipe refuses rather than picking one,
            # unless the input names the id outright.
            if len(ids) > 1 and not c.get('typeId'):
                raise SystemExit(f"covenant type '{c['typeName']}' is ambiguous in this org "
                                 f"({len(ids)} records: {', '.join(ids)}); set \"typeId\" to "
                                 f"the one you mean")
            rows.append((c['key'], tagged('LLC_BI__Covenant2__c', {
                'LLC_BI__Account__c': acct,
                'Relationship__c': acct,
                'LLC_BI__Covenant_Type__c': c.get('typeId') or ids[0],
                'RecordTypeId': RT[f"LLC_BI__Covenant2__c.{c.get('recordType', 'Financial Ratio')}"],
                'LLC_BI__Active__c': True,
                'LLC_BI__Required__c': True,
                'LLC_BI__Is_Template__c': False,
                'LLC_BI__Financial_Indicator_Value__c': c.get('threshold'),
                'Acnpex_Threshold_Value__c': c.get('threshold'),
                'Financial_Indicator_Operator__c': c.get('operator'),
                'Acnpex_Operator__c': c.get('acnpexOperator'),
                'LLC_BI__Frequency__c': c.get('frequency', 'Quarterly'),
                'LLC_BI__Effective_Date__c': c.get('effectiveDate'),
                'LLC_BI__Due_Date__c': c.get('dueDate'),
                'LLC_BI__Next_Evaluation_Date__c': c.get('nextEvaluationDate'),
                'LLC_BI__Last_Evaluation_Date__c': c.get('lastEvaluationDate'),
                'LLC_BI__Last_Evaluation_Value__c': c.get('lastEvaluationValue'),
                'LLC_BI__Last_Evaluation_Status__c': c.get('lastEvaluationStatus'),
                'LLC_BI__Covenant_Status__c': c.get('covenantStatus', 'Compliant'),
                'LLC_BI__Breached__c': c.get('breached', False),
                'LLC_BI__Overdue__c': c.get('overdue', False),
                'LLC_BI__Grace_Days__c': c.get('graceDays', 10),
                'LLC_BI__Compliance_Days_Prior__c': c.get('complianceDaysPrior', '30'),
                'LLC_BI__Detail__c': c.get('detail'),
                'Acnpex_Clause__c': c.get('clause'),
                'Acnpex_Description__c': c.get('detail'),
                'Acnpex_Approval_Status__c': 'Approved',
            }, c.get('notes'))))
        self.build('LLC_BI__Covenant2__c', rows, 'Covenant')

        # THE ACCOUNT ASSOCIATION IS THE ONE nCino'S OWN UI WRITES (founder
        # correction 2026-08-31) and Customer360Covenants reads the covenant by
        # LLC_BI__Account__c, so the covenant carries both. The junction is what
        # makes the relationship card agree with the account page.
        assoc = [(c['key'], {'LLC_BI__Account__c': acct,
                             'LLC_BI__Covenant2__c': self.ref('LLC_BI__Covenant2__c', c['key'])})
                 for c in self.spec.get('covenants', [])]
        self.build('LLC_BI__Account_Covenant__c', assoc, 'Account Covenant')

        junc = []
        for c in self.spec.get('covenants', []):
            cov = self.ref('LLC_BI__Covenant2__c', c['key'])
            for loan_key in c.get('loans', []):
                junc.append((f"{c['key']}@{loan_key}", {
                    'LLC_BI__Covenant2__c': cov,
                    'LLC_BI__Loan__c': self.ref('LLC_BI__Loan__c', loan_key)}))
        self.build('LLC_BI__Loan_Covenant__c', junc, 'Loan Covenant (junction)')

        evals = []
        for c in self.spec.get('covenants', []):
            cov = self.ref('LLC_BI__Covenant2__c', c['key'])
            for e in c.get('evaluations', []):
                evals.append((e['key'], tagged('LLC_BI__Covenant_Compliance2__c', {
                    'LLC_BI__Covenant__c': cov,
                    'LLC_BI__Status__c': e.get('status', 'Compliant'),
                    'LLC_BI__Due_Date__c': e.get('dueDate'),
                    'LLC_BI__Original_Due_Date__c': e.get('dueDate'),
                    'LLC_BI__Effective_Date__c': e.get('effectiveDate'),
                    'LLC_BI__Evaluation_Date__c': e.get('evaluationDate'),
                    'LLC_BI__Historic_Financial_Indicator__c': e.get('value'),
                    'cm_Covenant_Compliance_Indicator_Value__c': (
                        None if e.get('value') is None else str(e['value'])),
                    'LLC_BI__Reason_for_Exception__c': e.get('exceptionReason'),
                }, e.get('comments'))))
        # NEVER BY DEFAULT (2026-09-08). Every insert of LLC_BI__Covenant_Compliance2__c in this
        # org fires the unmanaged approval orchestration acnpex_covenantApprovalProcess, with no
        # entry condition, assigned to a hard-coded human (a named individual user). The proof
        # runs fired it 24 times before this was caught. Covenant history lives on the covenant's
        # own LLC_BI__Last_Evaluation_* fields (the Hartwell pattern); compliance rows are written
        # only when the operator sets ALLOW_COMPLIANCE_ROWS=1 knowingly.
        if os.environ.get('ALLOW_COMPLIANCE_ROWS') == '1':
            self.build('LLC_BI__Covenant_Compliance2__c', evals, 'Covenant evaluation (history)')
        elif evals:
            print(f'  skipped {len(evals)} compliance rows: the org fires an approval at a '
                  f'real human on every insert (ALLOW_COMPLIANCE_ROWS=1 overrides)')

    # -------------------------------------------------------------- governance
    def governance(self):
        acct = self.m.data['account']
        rows = []
        for r in self.spec.get('reviews', []):
            # RV02 REFUSES A REVIEW BORN COMPLETE. "You Cannot Manually Change the
            # Review to a Post Approval Stage. The Review Must be Approved by
            # Pressing the Submit for Approval Button." A review is therefore
            # created In Progress at the Qualification stage, whatever the story
            # asks for, and the design's "one completed annual review" is recorded
            # as a shortfall in the agent's report rather than forced.
            status = 'In Progress'
            wanted = r.get('status', 'Complete')
            if wanted != status:
                print(f'    note: review {r["key"]} asked for {wanted}; RV02 refuses a '
                      f'post-approval birth stage, created In Progress')
            rows.append((r['key'], tagged('LLC_BI__Review__c', {
                'LLC_BI__Account__c': acct,
                'LLC_BI__Product_Package__c': self.maybe(
                    'LLC_BI__Product_Package__c', r.get('package')),
                'LLC_BI__Review_Type__c': r.get('type', 'Annual'),
                'LLC_BI__Status__c': status,
                'RecordTypeId': RT['LLC_BI__Review__c.Account Review '
                                   + ('Complete' if status == 'Complete' else 'In Progress')],
                'cm_Review_Stage__c': 'Qualification',
                'cm_Relationship_Summary__c': r.get('summary'),
                'cm_Recommendation_Narrative__c': r.get('recommendation'),
                'cm_Risk_Rating_Comments__c': r.get('riskComments'),
                'cm_Strengths_Narrative__c': r.get('strengths'),
                'cm_Weakness_Narrative__c': r.get('weaknesses'),
                'cm_Current_Relationship_Risk_Rating__c': r.get('currentGrade'),
                'cm_Recommend_Relationship_Rating__c': r.get('recommendedGrade'),
                'cm_Have_the_covenants_been_tested__c': r.get('covenantsTested', 'Yes'),
                'cm_Did_the_Covenants_pass_the_test__c': r.get('covenantsPassed', 'Yes'),
                'cm_Send_to_Credit_Committee__c': r.get('toCommittee', 'No'),
            }, r.get('narrative'))))
        self.build('LLC_BI__Review__c', rows, 'Review (annual/covenant)')

        rr = []
        for r in self.spec.get('riskRatingReviews', []):
            rr.append((r['key'], tagged('LLC_BI__Annual_Review__c', {
                'LLC_BI__Account__c': acct,
                'LLC_BI__Status__c': r.get('status', 'In Review'),
                # LLC_BI__Final_Risk_Grade__c is refused at insert by field-level
                # security: the org derives it from the computed value.
                'LLC_BI__Computed_Risk_Grade_Value__c': r.get('computedGrade', r.get('finalGrade')),
                'LLC_BI__Cash_Flow_Coverage_actual__c': r.get('cashFlowCoverage'),
                'LLC_BI__Credit_Score_actual__c': r.get('creditScore'),
                'LLC_BI__Revenue_Growth_actual__c': r.get('revenueGrowth'),
                'LLC_BI__Management_Experience_actual__c': r.get('managementYears'),
                'LLC_BI__Year_1st__c': r.get('year1'),
                'LLC_BI__Year_2nd__c': r.get('year2'),
                'LLC_BI__Year_3rd__c': r.get('year3'),
            }, r.get('comments'))))
        self.build('LLC_BI__Annual_Review__c', rr, 'Risk Rating Review')

        # POLICY EXCEPTIONS EGRESS. An org-local PolicyExceptionCDC trigger relays
        # every create to an external AWS endpoint (sandbox EventBridge relay,
        # probed 2026-08-31: no approval process, no email). Nothing here is real
        # customer data, and the brief says so plainly rather than quietly.
        pex = []
        for e in self.spec.get('policyExceptions', []):
            reasons = e.get('mitigation', [])
            pex.append((e['key'], tagged('LLC_BI__Policy_Exception__c', {
                'Name': e['name'],
                'LLC_BI__Type__c': e.get('type', 'Policy'),
                'LLC_BI__Status__c': e.get('status', 'Unmitigated'),
                'LLC_BI__Severity__c': e.get('severity', 'Major'),
                'LLC_BI__Severity_Value__c': e.get('severityValue', 2),
                'LLC_BI__Relationship__c': acct,
                'LLC_BI__Loan__c': self.maybe('LLC_BI__Loan__c', e.get('loan')),
                'LLC_BI__Collateral_Mgmt__c': self.maybe(
                    'LLC_BI__Collateral__c', e.get('collateral')),
                'LLC_BI__Mitigation_Reason_1__c': reasons[0] if len(reasons) > 0 else None,
                'LLC_BI__Mitigation_Reason_2__c': reasons[1] if len(reasons) > 1 else None,
                'LLC_BI__Mitigation_Reason_3__c': reasons[2] if len(reasons) > 2 else None,
            }, e.get('code'))))
        self.build('LLC_BI__Policy_Exception__c', pex, 'Policy Exception')

        opps = [(o['key'], tagged('Opportunity', {
            'Name': o['name'], 'AccountId': acct,
            'StageName': o.get('stage', 'Proposal'), 'CloseDate': o['closeDate'],
            'Amount': o.get('amount'), 'Type': o.get('type', 'Existing Business'),
            'Probability': o.get('probability'), 'NextStep': o.get('nextStep'),
            'LeadSource': o.get('leadSource'),
        }, o.get('description'))) for o in self.spec.get('opportunities', [])]
        self.build('Opportunity', opps, 'Opportunity (whitespace)')

        cases = [(c['key'], tagged('Case', {
            'AccountId': acct, 'Subject': c['subject'],
            'Status': c.get('status', 'New'), 'Priority': c.get('priority', 'Medium'),
            'Origin': c.get('origin', 'Email'), 'Type': c.get('type', 'Service Request'),
        }, c.get('description'))) for c in self.spec.get('cases', [])]
        self.build('Case', cases, 'Case (service request)')

    # ------------------------------------------------------------- the rollups
    def rollups(self):
        """The package exposure figures Customer360Snapshot sums.

        TCE/TBE/TOE/Outstanding are plain writable currency fields on the package,
        NOT rollups the org maintains. Left unset, the snapshot reports an
        eight-facility relationship with zero exposure, so they are derived from
        the loans this run created and written last, when every loan is in.
        """
        patch = []
        for p in self.spec['packages']:
            loans = p.get('loans', [])
            committed = sum(ln['amount'] for ln in loans)
            outstanding = sum(ln.get('outstanding') or 0 for ln in loans)
            patch.append({
                'Id': self.ref('LLC_BI__Product_Package__c', p['key']),
                'LLC_BI__TCE__c': p.get('tce', committed),
                'LLC_BI__TBE__c': p.get('tbe', committed),
                'LLC_BI__TOE__c': p.get('toe', outstanding),
                'LLC_BI__Outstanding__c': p.get('outstanding', outstanding),
            })
        errs = update('LLC_BI__Product_Package__c', patch)
        print(f'  {"package exposure rollups":34s} {len(patch) - len(errs):3d} set'
              + (f'  {len(errs)} REFUSED' if errs else ''))
        for e in errs:
            print(f'      {json.dumps(e["errors"])[:250]}')
            self.failed = True

    def run(self):
        for step in (self.accounts, self.connections, self.packages, self.loans,
                     self.involvements, self.pricing, self.fees, self.collateral,
                     self.pledges, self.covenants, self.governance, self.rollups):
            step()
        self.m.save()


def _payment(principal, annual_rate, months, amortises):
    """Level monthly payment, or interest-only where nothing amortises."""
    if not annual_rate or not principal:
        return None
    r = annual_rate / 100 / 12
    if not amortises or not months:
        return round(principal * r, 2)
    return round(principal * r / (1 - (1 + r) ** -months), 2)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('spec', help='the relationship JSON (see seed/SCHEMA.md)')
    ap.add_argument('--slug', help='overrides the slug in the spec')
    ap.add_argument('--manifest-dir', default=os.path.join(HERE, 'manifests'))
    args = ap.parse_args()

    if 'TOK' not in os.environ or 'INST' not in os.environ:
        raise SystemExit('TOK and INST are not set. Run:\n'
                         '  read TOK INST <<< "$(~/.local/bin/bankinggpt-rest)"; export TOK INST')

    with open(args.spec) as f:
        spec = json.load(f)
    slug = args.slug or spec['slug']
    anchor = next(a for a in spec['accounts'] if a['key'] == spec['anchorKey'])

    path = os.path.join(args.manifest_dir, f'{slug}.json')
    m = Manifest(path, slug, anchor['name'])
    print(f'seeding {anchor["name"]}  slug={slug}')
    print(f'manifest {path}')
    if m.data['order']:
        print(f'  resuming: {len(m.data["order"])} records already recorded')
        m.prune_vanished()

    seeder = Seeder(spec, m, slug)
    try:
        seeder.run()
    finally:
        m.save()

    unresolved = m.settle_errors()
    m.save()

    print(f'\naccount   {m.data["account"]}')
    print(f'records   {len(m.data["order"])} created, '
          f'{sum(len(v) for v in m.data["derived"].values())} recorded as org-minted')
    if unresolved or seeder.failed:
        if unresolved:
            print(f'\n{len(unresolved)} RECORDS REFUSED - see the manifest errors block')
            for e in unresolved[-10:]:
                print(f'  {e["object"]}:{e["key"]}  {json.dumps(e["errors"])[:300]}')
        else:
            print('\nan UPDATE was refused; the message is above the summary')
        sys.exit(1)
    # A RELATIONSHIP THAT WAS REFUSED ON ITS WAY IN AND IS WHOLE NOW IS CLEAN. The
    # refusals stay in the manifest as the receipt; each carries the moment it stopped
    # being outstanding, and a pass over a finished relationship exits 0.
    if m.data['errors']:
        print(f'{len(m.data["errors"])} historical refusals, all resolved, nothing outstanding')
    print('\nclean. next: python3 seed/verify_relationship.py ' + slug)


if __name__ == '__main__':
    main()
