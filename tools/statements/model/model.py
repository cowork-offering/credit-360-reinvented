# -*- coding: utf-8 -*-
"""Builds the nine relationships' FY2025 / FY2024 statement sets and asserts every tie."""
import os as _os
_DIR = _os.path.dirname(_os.path.abspath(__file__))
_WORK = _os.environ.get('STMT_WORK', '/dev/shm/stmts/work')
_os.makedirs(_WORK, exist_ok=True)
import json, sys, hashlib
sys.path.insert(0, _DIR)
from cfg import C
import loans as L

LOANS = json.load(open(_os.path.join(_WORK,'loans.json')))

# ---------------------------------------------------------------- helpers
def R(x):  return int(round(x))

def weights(total, comps):
    """comps = [(label, weight)] -> [(label, int)] summing exactly to total."""
    out, run = [], 0
    for i, (lab, w) in enumerate(comps):
        if i == len(comps) - 1:
            v = total - run
        else:
            v = R(total * w); run += v
        out.append((lab, v))
    return out

INV_W = {'hartwell': [.28, .33, .39], 'sunbelt': [.62, .38], 'meridian': [.68, .32],
         'blueridge': [.55, .45], 'lakeshore': [.66, .28, .06], 'prairieag': [.46, .38, .16]}
CASH_W, AP_W, ACC_W = [.34, .24, .42], [.62, .38], [.44, .21, .35]

def cents_jitter(values, seed):
    """Add deterministic cents to integer dollar amounts; the cents net to zero."""
    h = hashlib.sha256(seed.encode()).digest()
    out, run = [], 0
    for i, v in enumerate(values[:-1]):
        c = ((h[i % 32] * 7 + h[(i + 11) % 32]) % 9900) - 4950     # -49.50 .. +49.49
        out.append(round(v + c / 100.0, 2)); run += c
    out.append(round(values[-1] - run / 100.0, 2))
    return out

def split_weighted(total, comps, seed):
    """comps = [(label, weight)] -> [(label, float)] with cents, summing exactly to total."""
    base = weights(total, comps)
    vals = cents_jitter([v for _, v in base], seed)
    return [(base[i][0], vals[i]) for i in range(len(base))]

def split_cents(total_dollars, labels, seed):
    """Split a whole-dollar total across labels with realistic cents; sums exactly."""
    n = len(labels)
    if n == 1:
        return [(labels[0], round(float(total_dollars), 2))]
    cents = int(round(total_dollars * 100))
    h = hashlib.sha256(seed.encode()).digest()
    base = [abs(total_dollars) // n] * n
    out, run = [], 0
    vals = []
    for i in range(n - 1):
        frac = (h[i] + 1) / 260.0                       # 0.004 .. 0.985
        share = cents / n * (0.72 + 0.56 * frac)
        v = int(round(share))
        v += (h[i + 8] % 97) - 48                       # cents jitter
        vals.append(v); run += v
    vals.append(cents - run)
    return [(labels[i], vals[i] / 100.0) for i in range(n)]

def pct(a, b):  return 0.0 if b == 0 else a / b

# ---------------------------------------------------------------- PP&E charts
PPE = {
 'hartwell':  [('Land and land improvements', .068), ('Buildings and building improvements', .372),
               ('Machinery and production equipment', .418), ('Tooling, fixtures and gauging', .074),
               ('Office equipment, software and vehicles', .068)],
 'sunbelt':   [('Land', .118), ('Buildings and improvements', .612),
               ('Furniture, fixtures and equipment', .214), ('Vehicles and shuttle fleet', .026),
               ('Construction in progress', .030)],
 'meridian':  [('Land and land improvements', .062), ('Buildings and improvements', .214),
               ('Tractors', .318), ('Trailers and chassis', .246),
               ('Shop, dock and material handling equipment', .098),
               ('Office equipment, software and vehicles', .062)],
 'northgate': [('Land', .1548), ('Buildings and improvements', .7840),
               ('Furniture, fixtures and equipment', .0612)],
 'blueridge': [('Land and land improvements', .072), ('Medical office building', .414),
               ('Parking structure', .092), ('Surgery centre leasehold and build out', .148),
               ('Medical and imaging equipment', .208),
               ('Office equipment, software and furniture', .066)],
 'cascade':   [('Computer and network equipment', .524), ('Leasehold improvements', .272),
               ('Furniture and office equipment', .204)],
 'lakeshore': [('Land and land improvements', .074), ('Distribution centre and branch buildings', .418),
               ('Racking, conveyor and sortation', .186), ('Materials handling equipment', .128),
               ('Delivery vehicles', .114), ('Office equipment and software', .080)],
 'prairieag': [('Farmland', .3820), ('Farm buildings, bins and improvements', .1480),
               ('Grain elevator, dryer and rail loadout', .2060),
               ('Machinery and equipment', .2240), ('Vehicles and other', .0400)],
 'piedmont':  [('Land and land improvements', .054), ('Building and building improvements', .318),
               ('Machinery and production equipment', .466), ('Tooling and fixtures', .092),
               ('Office equipment, software and vehicles', .070)],
}

CASH_ACCTS = ['Operating account', 'Payroll account', 'Money market and sweep account']

INV_ACCTS = {
 'hartwell':  ['Raw bar and plate stock', 'Work in process', 'Finished goods'],
 'sunbelt':   ['Food and beverage inventory', 'Operating supplies and guest amenities'],
 'meridian':  ['Parts and tyres', 'Bulk fuel'],
 'blueridge': ['Implants and instrumentation', 'Medical and surgical consumables'],
 'lakeshore': ['Consumables and small equipment', 'Operatory furniture and capital equipment',
               'Inventory in transit'],
 'prairieag': ['Corn in store', 'Soybeans in store', 'Elevator grain, warehouse receipts'],
}

# ---------------------------------------------------------------- CPA firms
CPA = {
 'hartwell':  ('Wexford & Lanning, PLLC',   'Fort Wayne',  'Indiana',        '2026-03-24'),
 'piedmont':  ('Corrigan & Vale, PLLC',     'Greensboro',  'North Carolina', '2026-03-17'),
 'sunbelt':   ('Ardmore & Quillen, PLLC',   'Orlando',     'Florida',        '2026-04-09'),
 'meridian':  ('Hollister & Brandt, PLLC',  'Savannah',    'Georgia',        '2026-03-31'),
 'northgate': ('Ashmore & Delacroix, PLLC', 'Charlotte',   'North Carolina', '2026-04-14'),
 'blueridge': ('Ferriday & Hobbs, PLLC',    'Asheville',   'North Carolina', '2026-03-20'),
 'cascade':   ('Thornbury & Sage, PLLC',    'Portland',    'Oregon',         '2026-04-21'),
 'lakeshore': ('Radleigh & Osterman, PLLC', 'Milwaukee',   'Wisconsin',      '2026-03-27'),
 'prairieag': ('Brunswick & Teale, PLLC',   'Ames',        'Iowa',           '2026-04-28'),
}

COGS_OVERRIDE = {'northgate': 17_471_000}

# ---------------------------------------------------------------- build one
def build(folder, cfg):
    ln = LOANS[folder]
    out = {'folder': folder}
    rev25, rev24, rev23 = cfg['rev']
    interest25 = R(ln['interest'])
    p25 = R(ln['principal_2025'])
    cpltd = R(ln['principal_2026'])
    debt25 = R(ln['total_bal'])
    revolver25 = R(ln['revolver_drawn'])
    term25 = debt25 - revolver25
    ltd25 = debt25 - revolver25 - cpltd

    ebitda25, ebitda24 = cfg['ebitda']
    da25, da24 = cfg['da']
    int24 = cfg['interest'][1]
    oi25, oi24 = ebitda25 - da25, ebitda24 - da24
    other25, other24 = cfg['otherInc']
    pbt25 = oi25 - interest25 + other25
    pbt24 = oi24 - int24 + other24
    tr = cfg['taxRate']
    tax25 = R(pbt25 * tr) if (tr and pbt25 > 0) else 0
    tax24 = R(pbt24 * tr) if (tr and pbt24 > 0) else 0
    ni25, ni24 = pbt25 - tax25, pbt24 - tax24

    b = cfg['bs25']; lab = cfg['labels']
    cash25 = b['cash']
    ca_lines25 = [('cash', lab['cash'], cash25), ('ar', lab['ar'], b['ar'])]
    if b['inv']: ca_lines25.append(('inv', lab['inv'], b['inv']))
    for k, (l_, v) in enumerate(b['indCA']): ca_lines25.append((f'indca{k}', l_, v))
    if b['prepaid']: ca_lines25.append(('prepaid', lab['prepaid'], b['prepaid']))
    ca25 = sum(v for _, _, v in ca_lines25)
    nc_lines25 = [('ppe', lab['ppe'], b['ppe'])] + [(f'indnc{k}', l_, v) for k, (l_, v) in enumerate(b['indNC'])]
    ta25 = ca25 + sum(v for _, _, v in nc_lines25)

    cl_lines25 = [('ap', lab['ap'], b['ap']), ('accrued', lab['accrued'], b['accrued'])]
    for k, (l_, v) in enumerate(b['indCL']): cl_lines25.append((f'indcl{k}', l_, v))
    cl_lines25 += [('revolver', 'Revolving lines of credit', revolver25),
                   ('cpltd', 'Current portion of long term debt', cpltd)]
    cl25 = sum(v for _, _, v in cl_lines25)
    ltl_lines25 = [('ltd', 'Long term debt, net of current portion', ltd25)] + \
                  [(f'otherlt{k}', l_, v) for k, (l_, v) in enumerate(b['otherLT'])]
    tl25 = cl25 + sum(v for _, _, v in ltl_lines25)
    eq25 = b['equity']
    assert ta25 == tl25 + eq25, f'{folder} FY2025 balance sheet: A {ta25:,} != L+E {tl25+eq25:,}'

    # ---- rolls back to FY2024 and FY2023
    capex25, capex24 = cfg['capex']; draws25, draws24 = cfg['draws']; p24 = cfg['p24']
    dist25, dist24 = cfg['dist']; contrib25, contrib24 = cfg['contrib']
    rev_r24, rev_r23 = rev24 / rev25, rev23 / rev25
    ppe24 = b['ppe'] + da25 - capex25
    ppe23 = ppe24 + da24 - capex24
    eq24 = eq25 - ni25 + dist25 - contrib25
    eq23 = eq24 - ni24 + dist24 - contrib24
    revolver24, revolver23 = cfg['revolver24'], cfg['revolver23']
    term24 = term25 + p25 - draws25
    term23 = term24 + p24 - draws24
    debt24, debt23 = revolver24 + term24, revolver23 + term23
    cash24, cash23 = cfg['cash24'], cfg['cash23']

    def scaled(v, r): return R(v * r)
    def yearlines(r, cash, ppe, accrued):
        ca = [('cash', lab['cash'], cash), ('ar', lab['ar'], scaled(b['ar'], r))]
        if b['inv']: ca.append(('inv', lab['inv'], scaled(b['inv'], r)))
        for k, (l_, v) in enumerate(b['indCA']): ca.append((f'indca{k}', l_, scaled(v, r)))
        if b['prepaid']: ca.append(('prepaid', lab['prepaid'], scaled(b['prepaid'], r)))
        nc = [('ppe', lab['ppe'], ppe)] + [(f'indnc{k}', l_, v) for k, (l_, v) in enumerate(b['indNC'])]
        cl = [('ap', lab['ap'], scaled(b['ap'], r)), ('accrued', lab['accrued'], accrued)]
        for k, (l_, v) in enumerate(b['indCL']): cl.append((f'indcl{k}', l_, scaled(v, r)))
        return ca, nc, cl

    def solve_year(r, ppe, eq, revolver, term):
        """Accrued liabilities scale with revenue; CASH is the balancing plug."""
        accrued = R(b['accrued'] * r)
        ca, nc, cl = yearlines(r, 0, ppe, accrued)
        noncash = sum(v for k, _, v in ca if k != 'cash') + sum(v for _, _, v in nc)
        otherlt = sum(v for _, v in b['otherLT'])
        liab = term + revolver + otherlt + sum(v for _, _, v in cl)
        cash = liab + eq - noncash
        ca, nc, cl = yearlines(r, cash, ppe, accrued)
        ta = sum(v for _, _, v in ca) + sum(v for _, _, v in nc)
        return ca, nc, cl, accrued, ta, cash

    cpltd24, cpltd23 = R(p25 * 0.96), R(p24 * 0.96)
    ca24, nc24, cl24, accrued24, ta24, cash24 = solve_year(rev_r24, ppe24, eq24, revolver24, term24)
    ca23, nc23, cl23, accrued23, ta23, cash23 = solve_year(rev_r23, ppe23, eq23, revolver23, term23)
    cl24 += [('revolver', 'Revolving lines of credit', revolver24),
             ('cpltd', 'Current portion of long term debt', cpltd24)]
    cl23 += [('revolver', 'Revolving lines of credit', revolver23),
             ('cpltd', 'Current portion of long term debt', cpltd23)]
    ltl24 = [('ltd', 'Long term debt, net of current portion', term24 - cpltd24)] + \
            [(f'otherlt{k}', l_, v) for k, (l_, v) in enumerate(b['otherLT'])]
    ltl23 = [('ltd', 'Long term debt, net of current portion', term23 - cpltd23)] + \
            [(f'otherlt{k}', l_, v) for k, (l_, v) in enumerate(b['otherLT'])]
    tl24 = sum(v for _, _, v in cl24) + sum(v for _, _, v in ltl24)
    tl23 = sum(v for _, _, v in cl23) + sum(v for _, _, v in ltl23)
    assert ta24 == tl24 + eq24, f'{folder} FY2024 BS off by {ta24-tl24-eq24}'
    assert ta23 == tl23 + eq23, f'{folder} FY2023 BS off by {ta23-tl23-eq23}'
    out['accrued_plug'] = [b['accrued'], accrued24, accrued23]

    # ---- cash flow (FY2025 and FY2024), derived from the balance sheet deltas
    def delta(a, bb, key):
        da_ = dict((k, v) for k, _, v in a); db_ = dict((k, v) for k, _, v in bb)
        return da_.get(key, 0) - db_.get(key, 0)

    def cashflow(caA, ncA, clA, ltlA, caB, ncB, clB, ltlB, ni, da, capex, draws, prin,
                 rev_a, rev_b, dist, contrib, cashA, cashB):
        wc = []
        for k, l_, v in caA:
            if k == 'cash': continue
            d = v - dict((x[0], x[2]) for x in caB).get(k, 0)
            wc.append((f'(Increase) decrease in {l_[0].lower()+l_[1:]}', -d))
        for k, l_, v in clA:
            if k in ('revolver', 'cpltd'): continue
            d = v - dict((x[0], x[2]) for x in clB).get(k, 0)
            wc.append((f'Increase (decrease) in {l_[0].lower()+l_[1:]}', d))
        for k, l_, v in ltlA:
            if k == 'ltd': continue
            d = v - dict((x[0], x[2]) for x in ltlB).get(k, 0)
            if d: wc.append((f'Increase (decrease) in {l_[0].lower()+l_[1:]}', d))
        for k, l_, v in ncA:
            if k == 'ppe': continue
            d = v - dict((x[0], x[2]) for x in ncB).get(k, 0)
            if d: wc.append((f'(Increase) decrease in {l_[0].lower()+l_[1:]}', -d))
        cfo = ni + da + sum(v for _, v in wc)
        cfi = -capex
        cff = draws - prin + (rev_a - rev_b) + contrib - dist
        return wc, cfo, cfi, cff, cfo + cfi + cff

    ltl25 = ltl_lines25
    wc25, cfo25, cfi25, cff25, net25 = cashflow(
        ca_lines25, nc_lines25, cl_lines25, ltl25, ca24, nc24, cl24, ltl24,
        ni25, da25, capex25, draws25, p25, revolver25, revolver24, dist25, contrib25, cash25, cash24)
    wc24, cfo24, cfi24, cff24, net24 = cashflow(
        ca24, nc24, cl24, ltl24, ca23, nc23, cl23, ltl23,
        ni24, da24, capex24, draws24, p24, revolver24, revolver23, dist24, contrib24, cash24, cash23)
    assert net25 == cash25 - cash24, f'{folder} FY2025 cash flow off by {net25-(cash25-cash24)}'
    assert net24 == cash24 - cash23, f'{folder} FY2024 cash flow off by {net24-(cash24-cash23)}'

    out.update(dict(
        rev=[rev25, rev24, rev23], ebitda=[ebitda25, ebitda24], da=[da25, da24],
        oi=[oi25, oi24], interest=[interest25, int24], other=[other25, other24],
        pbt=[pbt25, pbt24], tax=[tax25, tax24], ni=[ni25, ni24],
        ca=[ca_lines25, ca24, ca23], nc=[nc_lines25, nc24, nc23],
        cl=[cl_lines25, cl24, cl23], ltl=[ltl25, ltl24, ltl23],
        ta=[ta25, ta24, ta23], tl=[tl25, tl24, tl23], eq=[eq25, eq24, eq23],
        ca_tot=[ca25, sum(v for _, _, v in ca24), sum(v for _, _, v in ca23)],
        cl_tot=[cl25, sum(v for _, _, v in cl24), sum(v for _, _, v in cl23)],
        cash=[cash25, cash24, cash23], ppe=[b['ppe'], ppe24, ppe23],
        debt=[debt25, debt24, debt23], revolver=[revolver25, revolver24, revolver23],
        cpltd=[cpltd, cpltd24, cpltd23], ltd=[ltd25, term24 - cpltd24, term23 - cpltd23],
        p=[p25, p24], draws=[draws25, draws24], dist=[dist25, dist24], contrib=[contrib25, contrib24],
        capex=[capex25, capex24],
        wc=[wc25, wc24], cfo=[cfo25, cfo24], cfi=[cfi25, cfi24], cff=[cff25, cff24],
        netchg=[net25, net24],
    ))
    return out

if __name__ == '__main__':
    res = {}
    for f, cfg in C.items():
        r = build(f, cfg); res[f] = r
        print(f"{f:10s} rev {r['rev'][0]:>12,} ebitda {r['ebitda'][0]:>10,} NI {r['ni'][0]:>11,} "
              f"TA {r['ta'][0]:>12,} eq {r['eq'][0]:>11,} debt {r['debt'][0]:>11,} "
              f"CFO {r['cfo'][0]:>10,} CFI {r['cfi'][0]:>11,} CFF {r['cff'][0]:>10,} dCash {r['netchg'][0]:>9,}")
    print('ALL TIES OK')
    for f,r in res.items(): print(f"{f:10s} cash 25/24/23 {r['cash'][0]:>10,} {r['cash'][1]:>10,} {r['cash'][2]:>10,}   accrued {r['accrued_plug'][0]:>9,} {r['accrued_plug'][1]:>9,} {r['accrued_plug'][2]:>9,}   ppe {r['ppe'][0]:>11,} {r['ppe'][1]:>11,} {r['ppe'][2]:>11,}")
