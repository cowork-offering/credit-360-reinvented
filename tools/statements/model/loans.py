import os as _os
_DIR = _os.path.dirname(_os.path.abspath(__file__))
_WORK = _os.environ.get('STMT_WORK', '/dev/shm/stmts/work')
_os.makedirs(_WORK, exist_ok=True)
import re, json, math
from collections import defaultdict

FOLDER = {
 'Hartwell Precision Manufacturing LLC':'hartwell',
 'Piedmont Precision Components, Inc.':'piedmont',
 'Sunbelt Hospitality Group Inc':'sunbelt',
 'Meridian Coastal Logistics LLC':'meridian',
 'Northgate Multifamily Investors LLC':'northgate',
 'Blue Ridge Orthopedic Partners PC':'blueridge',
 'Cascade Software Solutions Inc':'cascade',
 'Lakeshore Dental Supply Distributors Inc':'lakeshore',
 'Prairie Ag Holdings LP':'prairieag',
}

def parse():
    out=defaultdict(list)
    for line in open(_os.path.join(_DIR,'..','org-facts','loans.txt')):
        p=[x.strip() for x in line.strip().split('|')]
        if len(p)<12: continue
        acct=p[0]
        if acct not in FOLDER: continue
        def num(s): return None if s in ('None','') else float(s)
        out[FOLDER[acct]].append(dict(
            name=p[1], seg=p[2], re=p[3], product=p[4],
            committed=num(p[5]), bal=num(p[6]), rate=num(p[7]),
            maturity=p[8], term=int(p[9]) if p[9] not in ('None','') else None,
            paytype=p[10]))
    return out

def am_months(l):
    pt=l['paytype']; 
    if pt=='Balloon': return 300
    if pt in ('Revolving Line Of Credit','Draw Down Line Of Credit','Single Pay'): return None
    if pt=='Construction Permanent': return None   # interest only in 2025
    return l['term']

def pmt(P,r,n):
    i=r/12.0
    if i==0: return P/n
    return P*i/(1-(1+i)**-n)

def schedule(bal, rate, n_am, orig):
    """monthly payment from ORIGINAL amount over n_am months; roll forward from bal."""
    m = pmt(orig, rate/100.0, n_am)
    i = rate/100.0/12.0
    # forward 12 months (2026 scheduled principal)
    b=bal; fwd=0.0
    for _ in range(12):
        ip=b*i; pp=min(m-ip, b)
        if pp<0: pp=0
        b-=pp; fwd+=pp
        if b<=0: break
    # backward 12 months (2025 principal paid + 2025 interest)
    b=bal; back=0.0; interest=0.0
    for _ in range(12):
        # b_prev such that b_prev - (m - b_prev*i) = b  => b_prev(1+i) = b + m
        bp=(b+m)/(1+i)
        pp=bp-b; ii=m-pp
        back+=pp; interest+=ii
        b=bp
    return m, fwd, back, interest

def analyse(folder, loans):
    tot_bal=0; tot_com=0; rev_drawn=0; rev_com=0; term_bal=0
    p2025=0.0; p2026=0.0; interest=0.0; rows=[]
    for l in loans:
        bal=l['bal']; com=l['committed']; tot_com+=com
        am=am_months(l)
        row=dict(l); row['am']=am
        if bal is None:
            row.update(p2025=0,p2026=0,interest=0,note='undrawn commitment')
            rows.append(row); continue
        tot_bal+=bal
        if l['paytype'] in ('Revolving Line Of Credit','Draw Down Line Of Credit'):
            rev_drawn+=bal; rev_com+=com
            ii=bal*l['rate']/100.0
            interest+=ii
            row.update(p2025=0,p2026=0,interest=ii,note='revolving')
        elif l['paytype']=='Single Pay':
            ii=bal*l['rate']/100.0; interest+=ii
            term_bal+=bal
            row.update(p2025=0,p2026=0,interest=ii,note='single pay at maturity')
        elif l['paytype']=='Construction Permanent':
            ii=bal*l['rate']/100.0*0.8; interest+=ii
            term_bal+=bal
            row.update(p2025=0,p2026=0,interest=ii,note='interest only during construction')
        else:
            m,fwd,back,ii=schedule(bal,l['rate'],am,com)
            p2025+=back; p2026+=fwd; interest+=ii; term_bal+=bal
            row.update(p2025=back,p2026=fwd,interest=ii,pmt=m,note='')
        rows.append(row)
    return dict(folder=folder, total_bal=tot_bal, total_committed=tot_com,
        revolver_drawn=rev_drawn, revolver_committed=rev_com, revolver_undrawn=rev_com-rev_drawn,
        term_bal=term_bal, principal_2025=p2025, principal_2026=p2026, interest=interest, rows=rows)

if __name__=='__main__':
    data=parse()
    res={}
    for f,ls in data.items():
        a=analyse(f,ls); res[f]=a
        print(f"{f:10s} loans={len(ls):2d} debt={a['total_bal']:>12,.0f} revolver={a['revolver_drawn']:>11,.0f}/{a['revolver_committed']:>11,.0f} undrawn={a['revolver_undrawn']:>10,.0f} P2025={a['principal_2025']:>10,.0f} P2026(CPLTD)={a['principal_2026']:>10,.0f} int={a['interest']:>9,.0f}")
    json.dump(res, open(_os.path.join(_WORK,'loans.json'),'w'), indent=1)
