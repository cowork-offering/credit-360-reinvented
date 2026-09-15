import os as _os
_DIR = _os.path.dirname(_os.path.abspath(__file__))
_WORK = _os.environ.get('STMT_WORK', '/dev/shm/stmts/work')
_os.makedirs(_WORK, exist_ok=True)
# -*- coding: utf-8 -*-
"""Supplementary FY2025 facts that covenant definitions need but the primary
statements do not show on their face (borrowing bases, letters of credit,
reserves, property level schedules, operating statistics)."""

S = {}

S['hartwell'] = dict(
  rent=1_165_000, intangibles=0,
  revolverCommitment=17_500_000, revolverDrawn=10_350_000, letters=0,
  borrowingBase=dict(arEligible=11_000_000, arRate=.80, invEligible=8_000_000, invRate=.50,
                     reserves=0, cap=15_000_000),
  undrawnCommitments=[('Equipment line of credit, undrawn', 1_500_000),
                      ('Real estate purchase facility, undrawn', 6_500_000)],
  kpis=[('Unfinanced capital expenditure', '$640,000'),
        ('Kokomo plant expansion, costs incurred to date', '$9,860,000')],
)
S['sunbelt'] = dict(
  rent=0, intangibles=1_240_000,
  revolverCommitment=2_000_000, revolverDrawn=1_300_000, letters=0,
  ffeReserve=1_590_000, keys=486, days=365,
  mortgageAndTermDebt=31_965_000,
  ltv=[('Sunbelt Lakeside Hotel LLC', 16_940_000, 23_500_000),
       ('Sunbelt Airport Hotel LLC', 12_935_000, 20_500_000)],
  kpis=[('Available room nights, 486 keys', '177,390'),
        ('Blended revenue per available room', '$126.40'),
        ('Lakeside property improvement plan, 2025 spend', '$4,260,000')],
  undrawnCommitments=[],
)
S['meridian'] = dict(
  rent=0, intangibles=0,
  revolverCommitment=12_000_000, revolverDrawn=7_800_000, letters=2_450_000,
  borrowingBase=dict(arEligible=13_375_000, arRate=.80, invEligible=2_600_000, invRate=.50,
                     reserves=0, cap=12_000_000),
  undrawnCommitments=[],
  kpis=[('Tractors in service', '72'), ('Trailers in service', '140')],
)
S['northgate'] = dict(
  rent=0, intangibles=0,
  revolverCommitment=2_700_000, revolverDrawn=1_735_000, letters=0,
  properties=[
    dict(name='Northgate Ridge Apartments', units=240, revenue=12_400_000, noi=4_228_000,
         loan=21_250_000, principal=1_573_535, interest=1_404_022, appraisal=31_400_000,
         occupancy=95.4),
    dict(name='Northgate Park Place', units=186, revenue=9_100_000, noi=2_906_000,
         loan=15_530_000, principal=1_127_396, interest=1_057_613, appraisal=23_000_000,
         occupancy=96.1),
    dict(name='Northgate Crossing', units=192, revenue=6_300_000, noi=1_995_000,
         loan=11_372_000, principal=774_572, interest=796_222, appraisal=16_800_000,
         occupancy=87.0)],
  ltvNumeratorExtra=[('Real estate line of credit secured by Northgate Park Place', 520_000)],
  managementFee=dict(affiliateRevenue=1_200_000, thirdPartyRevenue=1_200_000),
  undrawnCommitments=[('Renovation draw down facility, undrawn', 660_000)],
  kpis=[('Apartment units owned', '618'), ('Physical occupancy, Northgate Crossing', '87.0 percent')],
)
S['blueridge'] = dict(
  rent=882_000, intangibles=0,
  revolverCommitment=3_000_000, revolverDrawn=1_950_000, letters=0,
  unfinancedCapex=1_870_000, keyPersonInsurance=6_000_000, mobOccupancy=96.0,
  collateralInsurance=6_800_000,
  undrawnCommitments=[],
  kpis=[('Physicians', '19'), ('Staff', '214'),
        ('Medical office building leased occupancy', '96 percent')],
)
S['cascade'] = dict(
  rent=0, intangibles=14_600_000,
  revolverCommitment=5_000_000, revolverDrawn=3_250_000, letters=0,
  recurringRevolverUndrawn=1_750_000,
  arr=34_100_000, grossRetention=92.0,
  undrawnCommitments=[('Equipment line of credit, undrawn', 65_000)],
  kpis=[('Annual recurring revenue at 31 December 2025', '$34,100,000'),
        ('Gross recurring revenue retention, trailing twelve months', '92 percent'),
        ('Subscription share of revenue', '96 percent')],
)
S['lakeshore'] = dict(
  rent=2_400_000, intangibles=0,
  revolverCommitment=15_000_000, revolverDrawn=9_750_000, letters=4_070_000,
  borrowingBase=dict(arEligible=15_120_000, arRate=.85, invEligible=9_200_000, invRate=.50,
                     reserves=0, cap=15_000_000),
  fieldExamVariance=2.4, unfinancedCapex=741_000,
  undrawnCommitments=[],
  kpis=[('Practices served', '4,100'), ('Gross accounts receivable', '$18,900,000'),
        ('Field examination variance to reported borrowing base', '2.4 percent')],
)
S['prairieag'] = dict(
  rent=0, intangibles=0,
  revolverCommitment=10_000_000, revolverDrawn=6_800_000, letters=0,
  cropInsuranceLevel=85,
  undrawnCommitments=[],
  kpis=[('Tillable acres farmed', '8,900'), ('Elevator licensed capacity', '1,600,000 bushels'),
        ('Multi peril crop insurance coverage level', '85 percent')],
)
S['piedmont'] = dict(
  rent=0, intangibles=0,
  revolverCommitment=7_500_000, revolverDrawn=3_064_000, letters=1_164_000,
  scheduledPrincipal=2_610_000, cpltd=2_610_000,
  undrawnCommitments=[],
  kpis=[('Employees', '182'), ('Capital expenditure limit, fiscal year', '$7,500,000')],
)
