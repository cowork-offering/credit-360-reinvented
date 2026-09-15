# -*- coding: utf-8 -*-
"""Assembles facts.json: statements, covenant reconciliation, note schedules."""
import os as _os
_DIR = _os.path.dirname(_os.path.abspath(__file__))
_WORK = _os.environ.get('STMT_WORK', '/dev/shm/stmts/work')
_os.makedirs(_WORK, exist_ok=True)
import json, sys, datetime, hashlib
sys.path.insert(0, _DIR)
from cfg import C
from supp import S
import model as M
from model import (R, cents_jitter, weights, split_cents, split_weighted, PPE, CPA, CASH_ACCTS,
                   INV_ACCTS, COGS_OVERRIDE, INV_W, CASH_W, AP_W, ACC_W)

LOANS = json.load(open(_os.path.join(_WORK,'loans.json')))
MONTH = ['January','February','March','April','May','June','July','August','September',
         'October','November','December']

def longdate(iso):
    y, m, d = iso.split('-'); return f"{int(d)} {MONTH[int(m)-1]} {y}"

def parse_collateral():
    out = {}
    fol = M.L.FOLDER
    for line in open(_os.path.join(_DIR,'..','org-facts','collateral.txt')):
        p = [x.strip() for x in line.strip().split('|')]
        if len(p) < 5 or p[0] not in fol: continue
        desc = p[4].replace('[C360-SEED-2026-09]', '').strip()
        out.setdefault(fol[p[0]], []).append(dict(id=p[1], value=int(float(p[3])), description=desc))
    return out
COLLATERAL = parse_collateral()

def parse_covenants():
    out = {}
    fol = M.L.FOLDER
    for line in open(_os.path.join(_DIR,'..','org-facts','covenants.txt')):
        p = [x.strip() for x in line.strip().split('|')]
        if len(p) < 10 or p[0] not in fol: continue
        def n(s): return None if s == 'None' else float(s)
        out.setdefault(fol[p[0]], []).append(dict(
            id=p[1], type=p[2], threshold=n(p[3]), orgValue=n(p[4]), status=p[5],
            date=p[6], frequency=p[7], workflow=p[8], definition=p[9]))
    return out
COVENANTS = parse_covenants()

# ------------------------------------------------------------------ maturities
def maturity_schedule(folder):
    ln = LOANS[folder]
    years = {y: 0.0 for y in range(2026, 2031)}
    thereafter = 0.0; revolver_year = {}
    for l in ln['rows']:
        bal = l['bal']
        if bal is None: continue
        if l['paytype'] in ('Revolving Line Of Credit', 'Draw Down Line Of Credit', 'Single Pay',
                            'Construction Permanent'):
            y = int(l['maturity'][:4]) if l['maturity'] != 'None' else 2027
            if y <= 2030: years[y] = years.get(y, 0) + bal
            else: thereafter += bal
            continue
        am = l['am'] or l['term']
        m = M.L.pmt(l['committed'], l['rate'] / 100.0, am)
        i = l['rate'] / 100.0 / 12.0
        b = bal
        for y in range(2026, 2031):
            paid = 0.0
            for _ in range(12):
                if b <= 0: break
                ip = b * i; pp = min(m - ip, b); b -= pp; paid += pp
            years[y] += paid
        thereafter += max(b, 0.0)
    rows = [(y, R(years[y])) for y in range(2026, 2031)]
    tot = R(ln['total_bal'])
    rows.append(('Thereafter', tot - sum(v for _, v in rows)))
    return rows, tot

def facility_rows(folder):
    ln = LOANS[folder]; out = []
    for l in ln['rows']:
        out.append(dict(
            product=l['product'], secured=l['re'], original=R(l['committed']),
            balance=(None if l['bal'] is None else R(l['bal'])), rate=l['rate'],
            maturity=(None if l['maturity'] == 'None' else l['maturity']),
            termMonths=l['term'], paymentType=l['paytype'],
            principal2025=R(l['p2025']), interest2025=R(l['interest'])))
    out.sort(key=lambda r: (-(r['balance'] or 0)))
    return out

# ------------------------------------------------------------------ statements
def income_rows(folder, cfg, m):
    rev25, rev24 = m['rev'][0], m['rev'][1]
    rows = [dict(label='Revenue', role='header')]
    rc25 = weights(rev25, cfg['revComp']); rc24 = weights(rev24, cfg['revComp'])
    for (l1, v1), (_, v2) in zip(rc25, rc24):
        rows.append(dict(label=l1, role='detail', v25=v1, v24=v2))
    rows.append(dict(label='Total revenue', role='subtotal', v25=rev25, v24=rev24))
    if cfg['gm'] is not None:
        cogs25 = COGS_OVERRIDE.get(folder, R(rev25 * (1 - cfg['gm'][0])))
        cogs24 = R(rev24 * (1 - cfg['gm'][1]))
        gp25, gp24 = rev25 - cogs25, rev24 - cogs24
        rows.append(dict(label=cfg['costLabel'], role='header'))
        for (l1, v1), (_, v2) in zip(weights(cogs25, cfg['costComp']), weights(cogs24, cfg['costComp'])):
            rows.append(dict(label=l1, role='detail', v25=v1, v24=v2))
        rows.append(dict(label='Total ' + cfg['costLabel'].lower(), role='subtotal', v25=cogs25, v24=cogs24))
        rows.append(dict(label='Gross profit', role='subtotal', v25=gp25, v24=gp24))
        ox25 = gp25 - m['ebitda'][0]; ox24 = gp24 - m['ebitda'][1]
        comps = cfg['opexComp']
    else:
        gp25 = gp24 = None
        ox25 = rev25 - m['ebitda'][0]; ox24 = rev24 - m['ebitda'][1]
        comps = cfg['costComp']
    rows.append(dict(label='Operating expenses', role='header'))
    oc25 = weights(ox25, comps); oc24 = weights(ox24, comps)
    for (l1, v1), (_, v2) in zip(oc25, oc24):
        rows.append(dict(label=l1, role='detail', v25=v1, v24=v2))
    rows.append(dict(label='Depreciation and amortisation', role='detail',
                     v25=m['da'][0], v24=m['da'][1]))
    rows.append(dict(label='Total operating expenses', role='subtotal',
                     v25=ox25 + m['da'][0], v24=ox24 + m['da'][1]))
    rows.append(dict(label='Income (loss) from operations', role='subtotal',
                     v25=m['oi'][0], v24=m['oi'][1]))
    rows.append(dict(label='Other income (expense)', role='header'))
    rows.append(dict(label='Interest expense', role='detail', v25=-m['interest'][0], v24=-m['interest'][1]))
    rows.append(dict(label='Other income, net', role='detail', v25=m['other'][0], v24=m['other'][1]))
    rows.append(dict(label='Income (loss) before income taxes', role='subtotal',
                     v25=m['pbt'][0], v24=m['pbt'][1]))
    if cfg['taxRate'] or m['tax'][0] or m['tax'][1]:
        rows.append(dict(label='Provision for income taxes', role='detail',
                         v25=-m['tax'][0], v24=-m['tax'][1]))
    rows.append(dict(label='Net income (loss)', role='total', v25=m['ni'][0], v24=m['ni'][1]))
    return rows, gp25, gp24

def balance_rows(cfg, m):
    rows = [dict(label='Assets', role='header'), dict(label='Current assets', role='header2')]
    d24 = {k: v for k, _, v in m['ca'][1]}
    for k, l_, v in m['ca'][0]:
        rows.append(dict(label=l_, role='detail', v25=v, v24=d24.get(k, 0), key=k))
    rows.append(dict(label='Total current assets', role='subtotal',
                     v25=m['ca_tot'][0], v24=m['ca_tot'][1]))
    n24 = {k: v for k, _, v in m['nc'][1]}
    for k, l_, v in m['nc'][0]:
        rows.append(dict(label=l_, role='detail', v25=v, v24=n24.get(k, 0), key=k))
    rows.append(dict(label='Total assets', role='total', v25=m['ta'][0], v24=m['ta'][1]))
    rows.append(dict(label='Liabilities and ' + cfg['equityCaption'].lower(), role='header'))
    rows.append(dict(label='Current liabilities', role='header2'))
    c24 = {k: v for k, _, v in m['cl'][1]}
    for k, l_, v in m['cl'][0]:
        rows.append(dict(label=l_, role='detail', v25=v, v24=c24.get(k, 0), key=k))
    rows.append(dict(label='Total current liabilities', role='subtotal',
                     v25=m['cl_tot'][0], v24=m['cl_tot'][1]))
    t24 = {k: v for k, _, v in m['ltl'][1]}
    for k, l_, v in m['ltl'][0]:
        rows.append(dict(label=l_, role='detail', v25=v, v24=t24.get(k, 0), key=k))
    rows.append(dict(label='Total liabilities', role='subtotal', v25=m['tl'][0], v24=m['tl'][1]))
    rows.append(dict(label=cfg['equityCaption'], role='header2'))
    contributed25 = cfg['bs25']['contributed']
    contributed24 = contributed25 - m['contrib'][0]
    rows.append(dict(label=cfg['contributedLabel'], role='detail',
                     v25=contributed25, v24=contributed24, key='contributed'))
    rows.append(dict(label=cfg['retainedLabel'], role='detail',
                     v25=m['eq'][0] - contributed25, v24=m['eq'][1] - contributed24, key='retained'))
    rows.append(dict(label='Total ' + cfg['equityCaption'].lower(), role='subtotal',
                     v25=m['eq'][0], v24=m['eq'][1]))
    rows.append(dict(label='Total liabilities and ' + cfg['equityCaption'].lower(), role='total',
                     v25=m['ta'][0], v24=m['ta'][1]))
    return rows

def cash_rows(cfg, m):
    rows = [dict(label='Cash flows from operating activities', role='header'),
            dict(label='Net income (loss)', role='detail', v25=m['ni'][0], v24=m['ni'][1]),
            dict(label='Adjustments to reconcile net income (loss) to net cash provided by operating activities:',
                 role='note')]
    rows.append(dict(label='Depreciation and amortisation', role='detail',
                     v25=m['da'][0], v24=m['da'][1]))
    rows.append(dict(label='Changes in operating assets and liabilities:', role='note'))
    w24 = dict(m['wc'][1])
    for l_, v in m['wc'][0]:
        rows.append(dict(label=l_, role='detail', v25=v, v24=w24.get(l_, 0)))
    rows.append(dict(label='Net cash provided by operating activities', role='subtotal',
                     v25=m['cfo'][0], v24=m['cfo'][1]))
    rows.append(dict(label='Cash flows from investing activities', role='header'))
    rows.append(dict(label='Purchases of property and equipment', role='detail',
                     v25=-m['capex'][0], v24=-m['capex'][1]))
    rows.append(dict(label='Net cash used in investing activities', role='subtotal',
                     v25=m['cfi'][0], v24=m['cfi'][1]))
    rows.append(dict(label='Cash flows from financing activities', role='header'))
    rows.append(dict(label='Proceeds from long term debt', role='detail',
                     v25=m['draws'][0], v24=m['draws'][1]))
    rows.append(dict(label='Principal payments on long term debt', role='detail',
                     v25=-m['p'][0], v24=-m['p'][1]))
    rows.append(dict(label='Net borrowings (repayments) on revolving lines of credit', role='detail',
                     v25=m['revolver'][0] - m['revolver'][1], v24=m['revolver'][1] - m['revolver'][2]))
    if m['contrib'][0] or m['contrib'][1]:
        rows.append(dict(label='Capital contributions', role='detail',
                         v25=m['contrib'][0], v24=m['contrib'][1]))
    rows.append(dict(label=cfg['distLabel'], role='detail', v25=-m['dist'][0], v24=-m['dist'][1]))
    rows.append(dict(label='Net cash provided by (used in) financing activities', role='subtotal',
                     v25=m['cff'][0], v24=m['cff'][1]))
    rows.append(dict(label='Net increase (decrease) in cash and cash equivalents', role='subtotal',
                     v25=m['netchg'][0], v24=m['netchg'][1]))
    rows.append(dict(label='Cash and cash equivalents, beginning of year', role='detail',
                     v25=m['cash'][1], v24=m['cash'][2]))
    rows.append(dict(label='Cash and cash equivalents, end of year', role='total',
                     v25=m['cash'][0], v24=m['cash'][1]))
    return rows

def equity_rows(cfg, m):
    c25 = cfg['bs25']['contributed']; c24 = c25 - m['contrib'][0]; c23 = c24 - m['contrib'][1]
    r25, r24, r23 = m['eq'][0] - c25, m['eq'][1] - c24, m['eq'][2] - c23
    rows = [dict(label='Balance at 31 December 2023', role='total', c=c23, r=r23, t=m['eq'][2]),
            dict(label='Net income (loss)', role='detail', c=0, r=m['ni'][1], t=m['ni'][1])]
    if m['contrib'][1]:
        rows.append(dict(label='Capital contributions', role='detail',
                         c=m['contrib'][1], r=0, t=m['contrib'][1]))
    rows.append(dict(label=cfg['distLabel'], role='detail', c=0, r=-m['dist'][1], t=-m['dist'][1]))
    rows.append(dict(label='Balance at 31 December 2024', role='total', c=c24, r=r24, t=m['eq'][1]))
    rows.append(dict(label='Net income (loss)', role='detail', c=0, r=m['ni'][0], t=m['ni'][0]))
    if m['contrib'][0]:
        rows.append(dict(label='Capital contributions', role='detail',
                         c=m['contrib'][0], r=0, t=m['contrib'][0]))
    rows.append(dict(label=cfg['distLabel'], role='detail', c=0, r=-m['dist'][0], t=-m['dist'][0]))
    rows.append(dict(label='Balance at 31 December 2025', role='total', c=c25, r=r25, t=m['eq'][0]))
    assert r24 + m['ni'][0] - m['dist'][0] == r25
    assert r23 + m['ni'][1] - m['dist'][1] == r24
    return rows

# ------------------------------------------------------------------ covenants
def cov(cid, covs, computed, formula, unit, basis=None, precision=2):
    src = next(c for c in covs if c['id'] == cid)
    org = src['orgValue']
    if org is None:
        ok = True; delta = None
    elif unit == 'x' or unit == 'ratio':
        ok = round(computed, precision) == round(org, precision); delta = computed - org
    elif unit == 'pct':
        ok = round(computed, 1) == round(org, 1); delta = computed - org
    elif unit == 'usd':
        ok = R(computed) == R(org); delta = computed - org
    else:
        ok = round(computed, 2) == round(org, 2); delta = computed - org
    return dict(id=cid, type=src['type'], definition=src['definition'], threshold=src['threshold'],
                orgValue=org, computed=computed, unit=unit, formula=formula, status=src['status'],
                testDate=src['date'], frequency=src['frequency'], reconciles=bool(ok),
                basis=basis)

def money(v): return f"${v:,.0f}"

def covenants_for(folder, cfg, m, sp):
    covs = COVENANTS[folder]; out = []
    ebitda, interest, prin = m['ebitda'][0], m['interest'][0], m['p'][0]
    ds = interest + prin
    if folder == 'hartwell':
        out.append(cov('COV-000646', covs, ebitda / ds,
            f"EBITDA {money(ebitda)} / (interest expense {money(interest)} + scheduled principal payments {money(prin)})", 'x'))
        out.append(cov('COV-000647', covs, m['tl'][0] / (m['eq'][0] - sp['intangibles']),
            f"Total liabilities {money(m['tl'][0])} / tangible net worth {money(m['eq'][0]-sp['intangibles'])}", 'x'))
        out.append(cov('COV-000648', covs, m['cash'][0],
            f"Unrestricted cash and cash equivalents {money(m['cash'][0])}", 'usd'))
        rent = sp['rent']
        out.append(cov('COV-000649', covs, (ebitda + rent) / (ds + rent),
            f"(EBITDA {money(ebitda)} + operating lease expense {money(rent)}) / (interest {money(interest)} + scheduled principal {money(prin)} + operating lease expense {money(rent)})", 'x'))
        bb = sp['borrowingBase']
        out.append(cov('COV-000650', covs, bb['arRate'] * 100,
            f"Advance rate on eligible accounts receivable of {bb['arRate']*100:.0f} percent plus {bb['invRate']*100:.0f} percent of eligible inventory, per the borrowing base schedule in Note H", 'pct'))
        out.append(cov('COV-000651', covs, 0,
            'Kokomo plant expansion, disclosed in the commitments note; no financial value held in the book', 'none'))
    elif folder == 'sunbelt':
        out.append(cov('COV-000705', covs, ebitda / ds,
            f"Consolidated EBITDA {money(ebitda)} / (interest expense {money(interest)} + scheduled principal payments {money(prin)})", 'x'))
        n, (name, bal, val) = 0, max(sp['ltv'], key=lambda t: t[1] / t[2])
        out.append(cov('COV-000706', covs, bal / val * 100,
            f"{name}: first mortgage balance {money(bal)} / lender approved appraised value {money(val)}", 'pct'))
        noi = ebitda - sp['ffeReserve']
        out.append(cov('COV-000707', covs, noi / sp['mortgageAndTermDebt'] * 100,
            f"(Consolidated EBITDA {money(ebitda)} less FF&E reserve {money(sp['ffeReserve'])}) {money(noi)} / mortgage and term debt secured by the two properties {money(sp['mortgageAndTermDebt'])}", 'pct'))
        rooms = weights(m['rev'][0], cfg['revComp'])[0][1]
        out.append(cov('COV-000708', covs, rooms / (sp['keys'] * sp['days']),
            f"Rooms revenue {money(rooms)} / available room nights ({sp['keys']} keys x {sp['days']} nights = {sp['keys']*sp['days']:,})", 'usd2'))
    elif folder == 'meridian':
        out.append(cov('COV-000695', covs, ebitda / ds,
            f"EBITDA {money(ebitda)} / (interest expense {money(interest)} + scheduled principal payments {money(prin)})", 'x'))
        out.append(cov('COV-000696', covs, m['debt'][0] / (m['eq'][0] - sp['intangibles']),
            f"Senior funded debt {money(m['debt'][0])} / tangible net worth {money(m['eq'][0]-sp['intangibles'])}", 'x'))
        bb = sp['borrowingBase']
        base = min(R(bb['arEligible'] * bb['arRate'] + bb['invEligible'] * bb['invRate']), bb['cap'])
        out.append(cov('COV-000697', covs, sp['revolverDrawn'] / base * 100,
            f"Revolving advances {money(sp['revolverDrawn'])} / borrowing base {money(base)} (80 percent of eligible receivables plus 50 percent of eligible inventory)", 'pct'))
        avail = base - sp['revolverDrawn'] - sp['letters']
        out.append(cov('COV-000698', covs, m['cash'][0] + avail,
            f"Unrestricted cash {money(m['cash'][0])} + availability under the revolving line {money(avail)} (borrowing base {money(base)} less advances {money(sp['revolverDrawn'])} less letters of credit {money(sp['letters'])})", 'usd'))
    elif folder == 'northgate':
        for cid, p in zip(['COV-000713', 'COV-000714', 'COV-000715'], sp['properties']):
            pds = p['principal'] + p['interest']
            out.append(cov(cid, covs, p['noi'] / pds,
                f"{p['name']}: net operating income {money(p['noi'])} / property debt service (principal {money(p['principal'])} + interest {money(p['interest'])})", 'x'))
        num = sum(p['loan'] for p in sp['properties']) + sum(v for _, v in sp['ltvNumeratorExtra'])
        den = sum(p['appraisal'] for p in sp['properties'])
        out.append(cov('COV-000716', covs, num / den * 100,
            f"Aggregate mortgage and secured real estate debt {money(num)} / aggregate appraised value {money(den)}", 'pct'))
        low = min(sp['properties'], key=lambda p: p['occupancy'])
        out.append(cov('COV-000717', covs, low['occupancy'],
            f"{low['name']}: physical occupancy {low['occupancy']:.0f} percent, per the December 2025 rent roll in the supplementary property schedule", 'pct'))
        worst = min(p['noi'] / (p['principal'] + p['interest']) for p in sp['properties'])
        out.append(cov('COV-000718', covs, worst,
            f"Lowest property debt service coverage ratio in the portfolio ({min(sp['properties'], key=lambda p: p['noi']/(p['principal']+p['interest']))['name']})", 'x'))
    elif folder == 'blueridge':
        out.append(cov('COV-000699', covs, ebitda / ds,
            f"EBITDA {money(ebitda)} / (interest expense {money(interest)} + scheduled principal payments {money(prin)})", 'x'))
        rent = sp['rent']
        out.append(cov('COV-000700', covs, (ebitda + rent) / (ds + rent),
            f"(EBITDA {money(ebitda)} + occupancy and equipment rent {money(rent)}) / (interest {money(interest)} + scheduled principal {money(prin)} + rent {money(rent)}), before physician distributions", 'x'))
        out.append(cov('COV-000701', covs, sp['unfinancedCapex'],
            f"Purchases of property and equipment per the statement of cash flows {money(sp['unfinancedCapex'])}, none of which was financed", 'usd'))
        out.append(cov('COV-000702', covs, sp['keyPersonInsurance'],
            f"Key person life insurance in force {money(sp['keyPersonInsurance'])}, collaterally assigned to the bank (Note J)", 'usd'))
        out.append(cov('COV-000703', covs, sp['mobOccupancy'],
            f"Medical office building leased occupancy {sp['mobOccupancy']:.0f} percent per the certified rent roll (Note J)", 'pct'))
        out.append(cov('COV-000704', covs, sp['collateralInsurance'],
            f"Surgery centre leasehold and equipment insured value {money(sp['collateralInsurance'])} (Note J)", 'usd'))
    elif folder == 'cascade':
        out.append(cov('COV-000709', covs, sp['arr'],
            f"Annual recurring revenue at 31 December 2025 {money(sp['arr'])} (Note K, key operating measures)", 'usd'))
        out.append(cov('COV-000710', covs, m['cash'][0] + sp['recurringRevolverUndrawn'],
            f"Unrestricted cash {money(m['cash'][0])} + undrawn availability under the recurring revenue revolver {money(sp['recurringRevolverUndrawn'])}", 'usd'))
        nd = m['debt'][0] - m['cash'][0]
        out.append(cov('COV-000711', covs, nd / ebitda,
            f"(Total debt {money(m['debt'][0])} less unrestricted cash {money(m['cash'][0])}) {money(nd)} / EBITDA {money(ebitda)}", 'x', precision=1))
        out.append(cov('COV-000712', covs, sp['grossRetention'],
            f"Gross recurring revenue retention {sp['grossRetention']:.0f} percent (Note K, key operating measures)", 'pct'))
    elif folder == 'lakeshore':
        rent = sp['rent']
        out.append(cov('COV-000723', covs, (ebitda + rent) / (ds + rent),
            f"(EBITDA {money(ebitda)} + occupancy and equipment rent {money(rent)}) / (interest {money(interest)} + scheduled principal {money(prin)} + rent {money(rent)})", 'x'))
        bb = sp['borrowingBase']
        base = min(R(bb['arEligible'] * bb['arRate'] + bb['invEligible'] * bb['invRate']), bb['cap'])
        avail = base - sp['revolverDrawn'] - sp['letters']
        out.append(cov('COV-000724', covs, avail,
            f"Lesser of the borrowing base and the {money(bb['cap'])} commitment {money(base)}, less advances {money(sp['revolverDrawn'])}, less outstanding letters of credit {money(sp['letters'])}", 'usd'))
        num = ebitda - m['tax'][0] - sp['unfinancedCapex'] - m['dist'][0]
        out.append(cov('COV-000725', covs, num / ds,
            f"(EBITDA {money(ebitda)} less income taxes {money(m['tax'][0])} less unfinanced capital expenditure {money(sp['unfinancedCapex'])} less dividends {money(m['dist'][0])}) {money(num)} / (interest {money(interest)} + scheduled principal {money(prin)})", 'x'))
        out.append(cov('COV-000726', covs, sp['fieldExamVariance'],
            f"Field examination variance to the reported borrowing base {sp['fieldExamVariance']} percent (Note J)", 'pct'))
    elif folder == 'prairieag':
        wc = m['ca_tot'][0] - m['cl_tot'][0]
        out.append(cov('COV-000719', covs, wc,
            f"Total current assets {money(m['ca_tot'][0])} less total current liabilities {money(m['cl_tot'][0])}", 'usd'))
        out.append(cov('COV-000720', covs, m['ca_tot'][0] / m['cl_tot'][0],
            f"Total current assets {money(m['ca_tot'][0])} / total current liabilities {money(m['cl_tot'][0])}", 'x'))
        out.append(cov('COV-000721', covs, m['debt'][0] / (m['eq'][0] - sp['intangibles']),
            f"Total funded debt {money(m['debt'][0])} / tangible net worth (partners' capital {money(m['eq'][0])} less intangible assets {money(sp['intangibles'])})", 'x'))
        out.append(cov('COV-000722', covs, sp['cropInsuranceLevel'],
            f"Multi peril crop insurance coverage level {sp['cropInsuranceLevel']} percent, bank named as loss payee (Note J)", 'pct'))
    return out

# ------------------------------------------------------------------ Piedmont (Boom pinned)
def piedmont_model():
    k = lambda v: v * 1000
    lab = dict(cash='Cash and Cash Equivalents', ar='Accounts Receivable, Net', inv='Inventory',
               prepaid='Prepaid Expenses and Other Current Assets',
               ppe='Property and Equipment, Net', ap='Accounts Payable',
               accrued='Accrued Expenses and Other Current Liabilities')
    def yr(cash, ar, inv, pre, ppe, rou, ap, cpltd, rev, acc, ltd, olt):
        ca = [('cash', lab['cash'], k(cash)), ('ar', lab['ar'], k(ar)), ('inv', lab['inv'], k(inv)),
              ('prepaid', lab['prepaid'], k(pre))]
        nc = [('ppe', lab['ppe'], k(ppe)),
              ('indnc0', 'Operating Lease ROU Assets and Other Assets', k(rou))]
        cl = [('ap', lab['ap'], k(ap)),
              ('revolver', 'Line of Credit and Current Portion of Long-Term Debt', k(rev + cpltd)),
              ('accrued', lab['accrued'], k(acc))]
        ltl = [('ltd', 'Long-Term Debt, Net of Current Portion', k(ltd)),
               ('otherlt0', 'Other Long-Term Liabilities', k(olt))]
        return ca, nc, cl, ltl
    y25 = yr(4928, 9162, 11965, 815, 18459, 1432, 4786, 2610, 3064, 2604, 14456, 371)
    y24 = yr(3892, 8427, 10995, 706, 15643, 454, 4414, 2480, 2738, 2407, 9969, 335)
    y23 = yr(3092, 7662, 9916, 608, 13768, 1016, 4004, 2350, 2566, 2213, 8957, 306)
    m = dict(
      rev=[k(64486), k(59915), k(56266)], ebitda=[k(5234), k(5744)], da=[k(2396), k(2189)],
      oi=[k(2838), k(3555)], interest=[k(1076), k(1019)], other=[k(55), k(-45)],
      pbt=[k(1817), k(2491)], tax=[k(427), k(623)], ni=[k(1390), k(1868)],
      ca=[y25[0], y24[0], y23[0]], nc=[y25[1], y24[1], y23[1]],
      cl=[y25[2], y24[2], y23[2]], ltl=[y25[3], y24[3], y23[3]],
      ta=[k(46761), k(40117), k(36062)], tl=[k(27891), k(22343), k(20396)],
      eq=[k(18870), k(17774), k(15666)],
      ca_tot=[k(26870), k(24020), k(21278)], cl_tot=[k(13064), k(12039), k(11133)],
      cash=[k(4928), k(3892), k(3092)], ppe=[k(18459), k(15643), k(13768)],
      debt=[k(20130), k(15187), k(13873)], revolver=[k(3064), k(2738), k(2566)],
      cpltd=[k(2610), k(2480), k(2350)], ltd=[k(14456), k(9969), k(8957)],
      p=[k(2610), k(2480)], draws=[k(5762), k(3794)], dist=[k(294), 0], contrib=[0, k(240)],
      capex=[k(5415), k(2601)],
      wc=[[('Changes in Operating Assets and Liabilities, Net', k(-193))],
          [('Changes in Operating Assets and Liabilities, Net', k(128))]],
      cfo=[k(3593), k(4185)], cfi=[k(-5415), k(-2601)], cff=[k(2858), k(-784)],
      netchg=[k(1036), k(800)], accrued_plug=[k(2604), k(2407), k(2213)],
      nonCashDebt=[k(1791), k(2338)], disposalNBV=[k(1994), k(875)],
      disposalCost=k(4860), disposalAccum=k(2866), ppeGross=[k(41200), k(38854)],
    )
    for i in range(3):
        assert m['ta'][i] == m['tl'][i] + m['eq'][i]
    assert m['cfo'][0] + m['cfi'][0] + m['cff'][0] == m['netchg'][0] == m['cash'][0] - m['cash'][1]
    assert m['cfo'][1] + m['cfi'][1] + m['cff'][1] == m['netchg'][1] == m['cash'][1] - m['cash'][2]
    return m

PIEDMONT_CFG = dict(
  legalName='Piedmont Precision Components, Inc.', short='Piedmont Precision',
  city='Greensboro', state='North Carolina', stateAbbr='NC', entity='Inc', naics='332710',
  industry='Precision machining and metal components',
  equityCaption="Stockholders' Equity", contributedLabel='Common Stock and Additional Paid-in Capital',
  retainedLabel='Retained Earnings', distLabel='Dividends',
  governingBody='the Board of Directors', taxNote='ccorp',
  nature=('Piedmont Precision Components, Inc. is a privately held precision machining business '
          'serving industrial, transportation and energy customers from a single plant in '
          'Greensboro, North Carolina. The Company employs 182 people.'),
  bs25=dict(contributed=4_600_000),
  taxRate=0.235, gm=[None, None], rent=[0, 0],
  costLabel='Cost of Sales',
)
PIEDMONT_FACILITIES = [
  dict(product='Revolving line of credit', original=7_500_000, balance=3_064_000, rate=6.85,
       maturity='2027-06-30', paymentType='Revolving Line Of Credit', secured='Non-Real Estate'),
  dict(product='Term note', original=8_000_000, balance=6_420_000, rate=5.95,
       maturity='2031-03-31', paymentType='Installment', secured='Non-Real Estate'),
  dict(product='Term note', original=6_500_000, balance=5_380_000, rate=6.25,
       maturity='2032-09-30', paymentType='Installment', secured='Non-Real Estate'),
  dict(product='Equipment note', original=3_200_000, balance=2_486_000, rate=6.15,
       maturity='2030-05-31', paymentType='Installment', secured='Non-Real Estate'),
  dict(product='Equipment note', original=1_900_000, balance=1_480_000, rate=5.90,
       maturity='2029-08-31', paymentType='Installment', secured='Non-Real Estate'),
  dict(product='Real estate note', original=1_600_000, balance=1_300_000, rate=5.45,
       maturity='2034-11-30', paymentType='Installment', secured='Real Estate'),
]
PIEDMONT_MATURITIES = [(2026, 2_610_000), (2027, 5_806_000), (2028, 2_878_000),
                       (2029, 3_020_000), (2030, 1_860_000), ('Thereafter', 3_956_000)]

def piedmont_covenants(m, sp):
    covs = COVENANTS['piedmont']; out = []
    ds = m['interest'][0] + sp['scheduledPrincipal']
    out.append(cov('COV-000637', covs, m['ebitda'][0] / ds,
        f"EBITDA {money(m['ebitda'][0])} (income from operations {money(m['oi'][0])} plus depreciation and amortisation {money(m['da'][0])}) / (interest expense {money(m['interest'][0])} + scheduled principal payments {money(sp['scheduledPrincipal'])})", 'x'))
    avail = sp['revolverCommitment'] - sp['revolverDrawn'] - sp['letters']
    out.append(cov('COV-000639', covs, m['cash'][0] + avail,
        f"Unrestricted cash {money(m['cash'][0])} + undrawn revolver availability {money(avail)} (commitment {money(sp['revolverCommitment'])} less advances {money(sp['revolverDrawn'])} less letters of credit {money(sp['letters'])})", 'usd'))
    c = cov('COV-000638', covs, m['debt'][0] / m['eq'][0],
        f"Funded debt {money(m['debt'][0])} / tangible net worth {money(m['eq'][0])} (no intangible assets are carried)", 'x',
        basis=('The 2.18x held in nCino is the reading at the 30 April 2026 quarterly test. It is not '
               'reproducible from the 31 December 2025 statements: the Boom spread pins funded debt at '
               '$20,130,000 and stockholders equity at $18,870,000, which give 1.07x. Both measures pass '
               'the 3.00x maximum.'))
    c['reconciles'] = False; out.append(c)
    c = cov('COV-000640', covs, m['capex'][0],
        f"Purchases of property and equipment per the statement of cash flows {money(m['capex'][0])} against the {money(7_500_000)} annual limit", 'usd',
        basis=('The $1,250,000 held in nCino is the fiscal 2026 year to date reading at the 30 April 2026 '
               'annual test. The fiscal 2025 figure on the face of the cash flow statement is $5,415,000, '
               'pinned by the Boom spread, and is inside the $7,500,000 limit.'))
    c['reconciles'] = False; out.append(c)
    order = {'COV-000637': 0, 'COV-000638': 1, 'COV-000639': 2, 'COV-000640': 3}
    out.sort(key=lambda c: order[c['id']])
    return out

# ------------------------------------------------------------------ Piedmont rows
def piedmont_income_rows(m):
    r = lambda l, ro, a, b: dict(label=l, role=ro, v25=a, v24=b)
    return [r('Net Sales', 'detail', m['rev'][0], m['rev'][1]),
            r('Cost of Sales', 'detail', m['rev'][0] - 14_064_000, m['rev'][1] - 14_544_000),
            r('Gross Profit', 'subtotal', 14_064_000, 14_544_000),
            r('Operating Expenses', 'detail', 11_226_000, 10_989_000),
            r('Income from Operations', 'subtotal', m['oi'][0], m['oi'][1]),
            r('Interest Expense', 'detail', -m['interest'][0], -m['interest'][1]),
            r('Other Income (Expense), Net', 'detail', m['other'][0], m['other'][1]),
            r('Income before Income Taxes', 'subtotal', m['pbt'][0], m['pbt'][1]),
            r('Provision for Income Taxes', 'detail', -m['tax'][0], -m['tax'][1]),
            r('Net Income', 'total', m['ni'][0], m['ni'][1])]

def piedmont_balance_rows(m):
    rows = [dict(label='Assets', role='header')]
    d24 = {k: v for k, _, v in m['ca'][1]}
    for k, l_, v in m['ca'][0]:
        rows.append(dict(label=l_, role='detail', v25=v, v24=d24[k], key=k))
    rows.append(dict(label='Total Current Assets', role='subtotal', v25=m['ca_tot'][0], v24=m['ca_tot'][1]))
    n24 = {k: v for k, _, v in m['nc'][1]}
    for k, l_, v in m['nc'][0]:
        rows.append(dict(label=l_, role='detail', v25=v, v24=n24[k], key=k))
    rows.append(dict(label='Total Assets', role='total', v25=m['ta'][0], v24=m['ta'][1]))
    rows.append(dict(label="Liabilities and Stockholders' Equity", role='header'))
    c24 = {k: v for k, _, v in m['cl'][1]}
    for k, l_, v in m['cl'][0]:
        rows.append(dict(label=l_, role='detail', v25=v, v24=c24[k], key=k))
    rows.append(dict(label='Total Current Liabilities', role='subtotal',
                     v25=m['cl_tot'][0], v24=m['cl_tot'][1]))
    t24 = {k: v for k, _, v in m['ltl'][1]}
    for k, l_, v in m['ltl'][0]:
        rows.append(dict(label=l_, role='detail', v25=v, v24=t24[k], key=k))
    rows.append(dict(label='Total Liabilities', role='subtotal', v25=m['tl'][0], v24=m['tl'][1]))
    rows.append(dict(label="Total Stockholders' Equity", role='detail',
                     v25=m['eq'][0], v24=m['eq'][1], key='equity'))
    rows.append(dict(label="Total Liabilities and Stockholders' Equity", role='total',
                     v25=m['ta'][0], v24=m['ta'][1]))
    return rows

def piedmont_cash_rows(m):
    r = lambda l, ro, a, b: dict(label=l, role=ro, v25=a, v24=b)
    return [dict(label='Cash Flows from Operating Activities', role='header'),
            r('Net Income', 'detail', m['ni'][0], m['ni'][1]),
            r('Depreciation and Amortization', 'detail', m['da'][0], m['da'][1]),
            r('Changes in Operating Assets and Liabilities, Net', 'detail',
              m['wc'][0][0][1], m['wc'][1][0][1]),
            r('Net Cash Provided by Operating Activities', 'subtotal', m['cfo'][0], m['cfo'][1]),
            dict(label='Cash Flows from Investing Activities', role='header'),
            r('Purchases of Property and Equipment', 'detail', -m['capex'][0], -m['capex'][1]),
            r('Net Cash Used in Investing Activities', 'subtotal', m['cfi'][0], m['cfi'][1]),
            dict(label='Cash Flows from Financing Activities', role='header'),
            r('Net Borrowings and Other Financing Activities', 'detail', m['cff'][0], m['cff'][1]),
            r('Net Cash Provided by (Used in) Financing Activities', 'subtotal', m['cff'][0], m['cff'][1]),
            r('Net Change in Cash', 'subtotal', m['netchg'][0], m['netchg'][1]),
            r('Cash, Beginning of Year', 'detail', m['cash'][1], m['cash'][2]),
            r('Cash, End of Year', 'total', m['cash'][0], m['cash'][1])]

def piedmont_equity_rows(m):
    c25 = 4_600_000; c24 = 4_600_000; c23 = 4_360_000
    r25, r24, r23 = m['eq'][0] - c25, m['eq'][1] - c24, m['eq'][2] - c23
    rows = [dict(label='Balance at 31 December 2023', role='total', c=c23, r=r23, t=m['eq'][2]),
            dict(label='Net income', role='detail', c=0, r=m['ni'][1], t=m['ni'][1]),
            dict(label='Capital contribution', role='detail', c=240_000, r=0, t=240_000),
            dict(label='Balance at 31 December 2024', role='total', c=c24, r=r24, t=m['eq'][1]),
            dict(label='Net income', role='detail', c=0, r=m['ni'][0], t=m['ni'][0]),
            dict(label='Dividends', role='detail', c=0, r=-294_000, t=-294_000),
            dict(label='Balance at 31 December 2025', role='total', c=c25, r=r25, t=m['eq'][0])]
    assert r23 + m['ni'][1] == r24 and r24 + m['ni'][0] - 294_000 == r25
    return rows

# ------------------------------------------------------------------ xlsx detail
def xlsx_sections(folder, cfg, m, bsrows, isrows, sp):
    """Company-prepared trial balance view: canonical lines split into GL accounts with cents."""
    def pair(key, labels, w, v25, v24):
        comps = list(zip(labels, w))
        a = split_weighted(v25, comps, f'{folder}:{key}25')
        b = split_weighted(v24, comps, f'{folder}:{key}24')
        return [(l, x, y) for (l, x), (_, y) in zip(a, b)]

    def ppe_pair(comps, g25, g24):
        """Land does not move; the year's additions land on the depreciable components."""
        c25 = weights(g25, comps)
        add = g25 - g24
        land = [i for i, (l, _) in enumerate(comps) if l.startswith(('Land', 'Farmland'))]
        wsum = sum(w for i, (_, w) in enumerate(comps) if i not in land)
        c24, run = [], 0
        for i, (l, v) in enumerate(c25):
            if i in land: x = v
            else: x = v - R(add * comps[i][1] / wsum)
            c24.append(x); run += x
        c24[-1] += g24 - run
        a = cents_jitter([v for _, v in c25], f'{folder}:ppe25')
        b = cents_jitter(c24, f'{folder}:ppe24')
        return [(c25[i][0], a[i], b[i]) for i in range(len(c25))]

    B = []   # (label, role, v25, v24)
    d = {r.get('key'): r for r in bsrows if r.get('key')}
    B.append(('Assets', 'group', None, None))
    B.append(('Current Assets', 'sub', None, None))
    B.append(('Bank Accounts', 'group', None, None))
    cash = d['cash']
    rows = pair('cash', CASH_ACCTS, CASH_W, cash['v25'], cash['v24'])
    for i, (l, a, b) in enumerate(rows):
        B.append((l, 'detail_last' if i == len(rows) - 1 else 'detail', a, b))
    B.append(('Total for Bank Accounts', 'subtotal', cash['v25'], cash['v24']))
    ar = d['ar']
    B.append(('Accounts Receivable', 'group', None, None))
    g25, g24 = R(ar['v25'] * 1.0465), R(ar['v24'] * 1.0465)
    B.append(('Accounts receivable, trade', 'detail', float(g25), float(g24)))
    B.append(('Allowance for doubtful accounts', 'detail_last',
              float(ar['v25'] - g25), float(ar['v24'] - g24)))
    B.append(('Total for Accounts Receivable', 'subtotal', float(ar['v25']), float(ar['v24'])))
    B.append(('Other Current Assets', 'group', None, None))
    others = [r for r in bsrows if r.get('key') and r['key'] not in ('cash', 'ar')
              and r['key'].startswith(('inv', 'indca', 'prepaid'))]
    oca25 = oca24 = 0
    tmp = []
    for r in others:
        k = r['key']
        if k == 'inv' and folder in INV_ACCTS:
            tmp += pair('inv', INV_ACCTS[folder], INV_W[folder], r['v25'], r['v24'])
        else:
            tmp.append((r['label'], float(r['v25']), float(r['v24'])))
        oca25 += r['v25']; oca24 += r['v24']
    for i, (l, a, b) in enumerate(tmp):
        B.append((l, 'detail_last' if i == len(tmp) - 1 else 'detail', a, b))
    B.append(('Total for Other Current Assets', 'subtotal', float(oca25), float(oca24)))
    B.append(('Total for Current Assets', 'total',
              float(m['ca_tot'][0]), float(m['ca_tot'][1])))
    B.append(('Fixed Assets', 'group', None, None))
    gross25 = cfg.get('ppeGross25') or m.get('ppeGross', [0])[0]
    gross24 = gross25 - m['capex'][0] + (m.get('disposalCost', 0) or 0) - (m.get('nonCashDebt', [0])[0] or 0)
    comps = PPE.get(folder)
    if comps:
        for l, a, b in ppe_pair(comps, gross25, gross24):
            B.append((l, 'detail', a, b))
    else:
        B.append(('Property and equipment, at cost', 'detail', float(gross25), float(gross24)))
    B.append(('Accumulated depreciation and amortisation', 'detail_last',
              float(m['ppe'][0] - gross25), float(m['ppe'][1] - gross24)))
    B.append(('Total for Fixed Assets', 'subtotal', float(m['ppe'][0]), float(m['ppe'][1])))
    ncs = [r for r in bsrows if r.get('key', '').startswith('indnc')]
    if ncs:
        B.append(('Other Assets', 'group', None, None))
        for i, r in enumerate(ncs):
            B.append((r['label'], 'detail_last' if i == len(ncs) - 1 else 'detail',
                      float(r['v25']), float(r['v24'])))
        B.append(('Total for Other Assets', 'subtotal',
                  float(sum(r['v25'] for r in ncs)), float(sum(r['v24'] for r in ncs))))
    B.append(('Total for Assets', 'total', float(m['ta'][0]), float(m['ta'][1])))
    B.append(('Liabilities and Equity', 'group', None, None))
    B.append(('Current Liabilities', 'sub', None, None))
    cls = [r for r in bsrows if r.get('key') in ('ap', 'accrued', 'revolver', 'cpltd')
           or (r.get('key') or '').startswith('indcl')]
    order = {'ap': 0, 'accrued': 1, 'revolver': 3, 'cpltd': 4}
    cls.sort(key=lambda r: order.get(r['key'], 2))
    tmp = []
    for r in cls:
        if r['key'] == 'ap':
            tmp += pair('ap', ['Accounts payable, trade', 'Received not invoiced'], AP_W,
                        r['v25'], r['v24'])
        elif r['key'] == 'accrued':
            tmp += pair('accrued', ['Accrued payroll and benefits', 'Accrued interest payable',
                                    'Other accrued liabilities'], ACC_W, r['v25'], r['v24'])
        else:
            tmp.append((r['label'], float(r['v25']), float(r['v24'])))
    for i, (l, a, b) in enumerate(tmp):
        B.append((l, 'detail_last' if i == len(tmp) - 1 else 'detail', a, b))
    B.append(('Total for Current Liabilities', 'subtotal',
              float(m['cl_tot'][0]), float(m['cl_tot'][1])))
    B.append(('Long-term Liabilities', 'group', None, None))
    lts = [r for r in bsrows if r.get('key') == 'ltd' or (r.get('key') or '').startswith('otherlt')]
    for i, r in enumerate(lts):
        B.append((r['label'], 'detail_last' if i == len(lts) - 1 else 'detail',
                  float(r['v25']), float(r['v24'])))
    B.append(('Total for Long-term Liabilities', 'subtotal',
              float(sum(r['v25'] for r in lts)), float(sum(r['v24'] for r in lts))))
    B.append(('Total for Liabilities', 'total', float(m['tl'][0]), float(m['tl'][1])))
    B.append(('Equity', 'group', None, None))
    c25 = cfg['bs25']['contributed']; c24 = c25 - m['contrib'][0]; c23 = c24 - m['contrib'][1]
    B.append((cfg['contributedLabel'], 'detail', float(c24), float(c23)))
    if m['contrib'][0] or m['contrib'][1]:
        B.append(('Capital contributions', 'detail', float(m['contrib'][0]), float(m['contrib'][1])))
    B.append(('Retained earnings, beginning of year', 'detail',
              float(m['eq'][1] - c24), float(m['eq'][2] - c23)))
    B.append((cfg['distLabel'], 'detail', float(-m['dist'][0]), float(-m['dist'][1])))
    B.append(('Net income (loss)', 'detail_last', float(m['ni'][0]), float(m['ni'][1])))
    B.append(('Total for Equity', 'subtotal', float(m['eq'][0]), float(m['eq'][1])))
    B.append(('Total for Liabilities and Equity', 'total', float(m['ta'][0]), float(m['ta'][1])))

    I = []
    I.append(('Income', 'group', None, None))
    if folder == 'piedmont':
        I.append(('Net sales', 'detail_last', float(m['rev'][0]), float(m['rev'][1])))
        I.append(('Total for Income', 'subtotal', float(m['rev'][0]), float(m['rev'][1])))
        rest = isrows[1:]
    else:
        revs = []
        for r in isrows:
            if r['role'] == 'header' and r['label'] == 'Revenue': continue
            if r['role'] == 'subtotal' and r['label'] == 'Total revenue': break
            if r['role'] == 'detail': revs.append(r)
        for i, r in enumerate(revs):
            I.append((r['label'], 'detail_last' if i == len(revs) - 1 else 'detail',
                      float(r['v25']), float(r['v24'])))
        I.append(('Total for Income', 'subtotal', float(m['rev'][0]), float(m['rev'][1])))
        idx = [i for i, r in enumerate(isrows)
               if r['role'] == 'subtotal' and r['label'] == 'Total revenue'][0]
        rest = isrows[idx + 1:]
    for r in rest:
        if r['role'] == 'header':
            I.append((r['label'], 'group', None, None))
        elif r['role'] == 'note':
            continue
        else:
            role = {'detail': 'detail', 'subtotal': 'subtotal', 'total': 'total'}[r['role']]
            I.append((r['label'], role, float(r['v25']), float(r['v24'])))
    return B, I

ENTITY_WORD = dict(LLC='limited liability company', Inc='corporation',
                   PC='professional corporation', LP='limited partnership')
TAX_POLICY = dict(
  llc=('The Company is a limited liability company treated as a partnership for federal and state '
       'income tax purposes. No provision for income taxes is made in these financial statements '
       'because the members report their share of the Company taxable income on their own returns.'),
  lp=('The Partnership is not a taxpaying entity for federal and state income tax purposes. No '
      'provision for income taxes is made in these financial statements because the partners report '
      'their share of the Partnership taxable income on their own returns.'),
  scorp=('The Corporation has elected to be taxed as an S corporation. No provision for federal '
         'income tax is made in these financial statements because the shareholders report their '
         'share of the Corporation taxable income on their own returns. State franchise taxes are '
         'included in general and administrative expenses.'),
  ccorp=('Income taxes are provided for the tax effects of transactions reported in the financial '
         'statements and consist of taxes currently due plus deferred taxes related to temporary '
         'differences between the financial reporting and tax bases of assets and liabilities.'),
  ccorp_loss=('Income taxes are accounted for under the asset and liability method. A full valuation '
              'allowance is recorded against the net deferred tax asset because realisation is not '
              'considered more likely than not. Accordingly no benefit has been recognised for the '
              'loss of the current year.'))

def headline_covenant(covs):
    pref = ['Debt Service Coverage of Borrower', 'Global Debt Service Coverage', 'Leverage',
            'Minimum Working Capital', 'Minimum Liquidity', 'Financial Indicators']
    for t in pref:
        for c in covs:
            if c['type'] == t and c['orgValue'] is not None:
                return c
    return next(c for c in covs if c['orgValue'] is not None)

def fmt_cov(c):
    u = c['unit']
    if u in ('x', 'ratio'):
        return f"{c['orgValue']:.2f}x against {c['threshold']:.2f}x"
    if u == 'pct':
        return f"{c['orgValue']:.1f} percent against {c['threshold']:.0f} percent"
    if u == 'usd':
        return f"${c['orgValue']:,.0f} against ${c['threshold']:,.0f}"
    return f"{c['orgValue']} against {c['threshold']}"

def build_all():
    rel = []
    for folder in ['hartwell', 'piedmont', 'sunbelt', 'meridian', 'northgate',
                   'blueridge', 'cascade', 'lakeshore', 'prairieag']:
        sp = S[folder]
        if folder == 'piedmont':
            cfg = dict(PIEDMONT_CFG); m = piedmont_model()
            cfg['ppeGross25'] = m['ppeGross'][0]
            isrows = piedmont_income_rows(m); bsrows = piedmont_balance_rows(m)
            cfrows = piedmont_cash_rows(m); eqrows = piedmont_equity_rows(m)
            covx = piedmont_covenants(m, sp)
            facilities = PIEDMONT_FACILITIES; maturities = PIEDMONT_MATURITIES
            gp25, gp24 = 14_064_000, 14_544_000
            cfg['opexComp'] = []; cfg['revComp'] = [('Net sales', 1.0)]
            cfg['labels'] = {}
            collat = []
        else:
            cfg = C[folder]; m = M.build(folder, cfg)
            isrows, gp25, gp24 = income_rows(folder, cfg, m)
            bsrows = balance_rows(cfg, m); cfrows = cash_rows(cfg, m); eqrows = equity_rows(cfg, m)
            covx = covenants_for(folder, cfg, m, sp)
            facilities = facility_rows(folder); maturities, _tot = maturity_schedule(folder)
            collat = COLLATERAL.get(folder, [])
        xb, xi = xlsx_sections(folder, cfg, m, bsrows, isrows, sp)
        gross25 = cfg.get('ppeGross25', 0)
        gross24 = gross25 - m['capex'][0] + (m.get('disposalCost', 0) or 0) - \
                  ((m.get('nonCashDebt') or [0])[0] or 0)
        comps = PPE.get(folder)
        ppeNote = dict(
            components=[dict(label=l, v25=v1, v24=v2) for (l, v1), (_, v2) in
                        zip(weights(gross25, comps), weights(gross24, comps))] if comps else
                       [dict(label='Property and equipment, at cost', v25=gross25, v24=gross24)],
            gross=[gross25, gross24],
            accum=[m['ppe'][0] - gross25, m['ppe'][1] - gross24],
            net=[m['ppe'][0], m['ppe'][1]],
            depreciation=[m['da'][0], m['da'][1]],
            additions=[m['capex'][0], m['capex'][1]],
            nonCashAdditions=(m.get('nonCashDebt') or [0, 0]),
            disposals=(m.get('disposalNBV') or [0, 0]),
            disposalCost=m.get('disposalCost', 0), disposalAccum=m.get('disposalAccum', 0))
        cp = next(c for c in covx if c['orgValue'] is not None)
        hc = headline_covenant(covx)
        rel.append(dict(
            folder=folder, legalName=cfg['legalName'], short=cfg['short'],
            city=cfg['city'], state=cfg['state'], stateAbbr=cfg['stateAbbr'],
            entity=cfg['entity'], entityWord=ENTITY_WORD[cfg['entity']], naics=cfg['naics'],
            industry=cfg['industry'], equityCaption=cfg['equityCaption'],
            contributedLabel=cfg['contributedLabel'], retainedLabel=cfg['retainedLabel'],
            distLabel=cfg['distLabel'], governingBody=cfg['governingBody'],
            consolidated=cfg.get('consolidated', []), nature=cfg['nature'],
            taxPolicy=TAX_POLICY[cfg['taxNote']],
            cpa=dict(name=CPA[folder][0], city=CPA[folder][1], state=CPA[folder][2],
                     date=CPA[folder][3], dateLong=longdate(CPA[folder][3])),
            statements=dict(income=isrows, balance=bsrows, cash=cfrows, equity=eqrows),
            hasGrossProfit=gp25 is not None,
            totals=dict(revenue=m['rev'][:2], ebitda=m['ebitda'], netIncome=m['ni'],
                        totalAssets=m['ta'][:2], totalDebt=m['debt'][:2], equity=m['eq'][:2],
                        cash=m['cash'][:2], interest=m['interest'], principal=m['p'],
                        capex=m['capex'], da=m['da']),
            notes=dict(ppe=ppeNote, facilities=facilities, maturities=maturities,
                       debtTotal=m['debt'][0], revolverCommitment=sp['revolverCommitment'],
                       revolverDrawn=sp['revolverDrawn'], letters=sp['letters'],
                       borrowingBase=sp.get('borrowingBase'),
                       undrawnCommitments=sp.get('undrawnCommitments', []),
                       rent=sp.get('rent', 0), kpis=sp.get('kpis', []),
                       properties=sp.get('properties'), ltv=sp.get('ltv'),
                       managementFee=sp.get('managementFee'),
                       ffeReserve=sp.get('ffeReserve'), collateral=collat,
                       scheduledPrincipal=sp.get('scheduledPrincipal', m['p'][0])),
            covenants=covx,
            headline=dict(text=f"{hc['type']}: {fmt_cov(hc)}", covenantId=hc['id'],
                          revenue=m['rev'][0], debt=m['debt'][0]),
            xlsx=dict(balance=xb, income=xi),
        ))
    return rel

if __name__ == '__main__':
    rel = build_all()
    bad = []
    for r in rel:
        n = len([x for x in r['xlsx']['balance']]); ni = len(r['xlsx']['income'])
        print(f"{r['folder']:10s} xlsx BS rows {n:3d}  IS rows {ni:3d}   covenants {len(r['covenants'])}")
        if n > 57: bad.append((r['folder'], 'BS', n))
        if ni > 52: bad.append((r['folder'], 'IS', ni))
        for c in r['covenants']:
            if not c['reconciles'] and not c.get('basis'):
                bad.append((r['folder'], c['id'], c['orgValue'], c['computed']))
    print('ISSUES:', bad if bad else 'none')
    out = dict(generated=datetime.datetime.now(datetime.timezone.utc).isoformat(),
               source='nCino org bankinggpt-at, pulled 2026-09-15', relationships=rel)
    json.dump(out, open(_os.path.join(_DIR,'..','facts.json'), 'w'), indent=1)
    print('facts.json written', len(json.dumps(out)), 'bytes')
