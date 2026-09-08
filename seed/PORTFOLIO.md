# The seven relationships, and how to put any of them back

Seven full commercial-credit relationships live in the bankinggpt sandbox
(`00DDz000001qeO2MAI`, alias `bankinggpt-at`) beside Hartwell and Piedmont. They were built on
2026-09-08 by seven agents running `seed/seed_relationship.py` in parallel, one relationship each,
against `knowledge/projects/customer-360/TEST-PORTFOLIO-DESIGN.md`. Every one of them comes back
**48/48 assertions pass** from `seed/verify_relationship.py`, which reads them through the org's
own `Customer360*` invocable classes and not through a private query.

Every figure on this page was read out of the org on 2026-09-08, not carried over from the specs.
Committed is `LLC_BI__TCE__c` summed across the relationship's packages, which is what
`Customer360Snapshot` reports as total credit exposure; outstanding is `LLC_BI__Outstanding__c`
summed the same way.

| Relationship | Anchor account | Committed | Outstanding | Grade | The governance signal it carries |
|---|---|---|---|---|---|
| Meridian Coastal Logistics LLC | `001bb00001Ld0ZqAAJ` | $35,700,000 | $25,076,000 | 5 | **annual review due in 30 days** (2026-10-08) |
| Blue Ridge Orthopedic Partners PC | `001bb00001Ld0pxAAB` | $27,750,000 | $24,600,000 | 4 | **covenant test overdue by 20 days** (DSC, due 2026-08-19) |
| Sunbelt Hospitality Group Inc | `001bb00001Ld0rZAAR` | $38,500,000 | $34,743,000 | 6 | **an unmitigated policy exception**: LTV 72.1 percent after a reappraisal |
| Prairie Ag Holdings LP | `001bb00001Ld1HNAAZ` | $25,600,000 | $20,514,000 | 4 | **a maturity inside the window**: the $10MM seasonal revolver matures 2027-02-08, 153 days out |
| Cascade Software Solutions Inc | `001bb00001Ld14VAAR` | $19,950,000 | $17,015,000 | 5 | **a live covenant exception**: net leverage 3.70x against a 3.50x step-down |
| Lakeshore Dental Supply Distributors Inc | `001bb00001LcIAeAAN` | $29,950,000 | $23,475,000 | 5 | **an overdue field exam** (25 days) beside an unmitigated availability exception |
| Northgate Multifamily Investors LLC | `001bb00001LcuL8AAJ` | $63,950,000 | $51,983,000 | 4 | **annual review due in 20 days** (2026-09-28) |
| **Seven relationships** | | **$241,400,000** | **$197,406,000** | | |

Two of them (Meridian, Northgate) additionally carry ONE unapproved package with a Proposal loan
in it, which is what the cockpit's pending delta and its "join an unapproved package" path need.
Those are the only non-booked packages in the portfolio.

---

## 1. Meridian Coastal Logistics LLC

Trucking and 3PL, NAICS 484121, Savannah GA. Revenue $88MM, grade 5. Anchor
`001bb00001Ld0ZqAAJ`, manifest `seed/manifests/meridian.json`, spec `seed/examples/meridian.json`.

| Package | Id | Credit stage | Committed | Outstanding | Name |
|---|---|---|---|---|---|
| `working-capital` | `a5Fbb000000JBFtEAO` | Booked | $19,000,000 | $13,925,000 | Meridian Working Capital Package |
| `real-estate` | `a5Fbb000000JBFuEAO` | Booked | $7,700,000 | $7,452,000 | Meridian Real Estate Package |
| `fleet` | `a5Fbb000000JBFvEAO` | Booked | $4,000,000 | $3,699,000 | Meridian Fleet Package |
| `distribution-centre` | `a5Fbb000000JBFwEAO` | Credit Underwriting | $5,000,000 | $0 | Meridian Distribution Centre Package |

**Signal: the review clock.** `LLC_BI__Next_Review_Date__c` on the anchor is 2026-10-08, thirty
days out, which is what the worklist's needs-action state reads. Beside it: a waived DSC exception
(fuel surcharge recovery lagged the April 2026 diesel spike) and a mitigated second-lien advance
rate exception. Four relationship covenants, one of them Waived, none overdue.

152 records, 26 more minted by the org and recorded for cleanup. 10 facilities across four
packages, 31 involvements, 6 collateral assets, 10 pledges.

## 2. Blue Ridge Orthopedic Partners PC

Medical practice, NAICS 621111, Asheville NC. Revenue $41MM, grade 4. Anchor
`001bb00001Ld0pxAAB`, manifest `seed/manifests/blue-ridge.json`.

| Package | Id | Credit stage | Committed | Outstanding | Name |
|---|---|---|---|---|---|
| `practice` | `a5Fbb000000JBHVEA4` | Booked | $11,300,000 | $9,280,000 | Blue Ridge Practice Package |
| `real-estate` | `a5Fbb000000JBHWEA4` | Booked | $11,300,000 | $10,745,000 | Blue Ridge Real Estate Package |
| `asc` | `a5Fbb000000JBHXEA4` | Booked | $5,150,000 | $4,575,000 | Blue Ridge Surgery Center Package |

**Signal: an overdue covenant test.** The 1.30x debt service coverage covenant was due 2026-08-19
and reads `LLC_BI__Overdue__c` true, twenty days past, status In Progress. The capex covenant
carries an Exception status against its $1.5MM annual limit, and the mitigated policy exception
beside it is the imaging suite that caused it.

163 records, 24 org-minted. The widest household of the seven: 7 accounts, 10 edges, four
physician partners on limited guaranties, 39 involvements, 6 covenants.

## 3. Sunbelt Hospitality Group Inc

Hotels, NAICS 721110, Orlando FL. Revenue $63MM, grade 6. Anchor `001bb00001Ld0rZAAR`, manifest
`seed/manifests/sunbelt.json`.

| Package | Id | Credit stage | Committed | Outstanding | Name |
|---|---|---|---|---|---|
| `lakeside` | `a5Fbb000000JBJ7EAO` | Booked | $20,500,000 | $19,030,000 | Sunbelt Lakeside Hotel Package |
| `airport` | `a5Fbb000000JBJ8EAO` | Booked | $15,100,000 | $13,695,000 | Sunbelt Airport Hotel Package |
| `corporate` | `a5Fbb000000JBJ9EAO` | Booked | $2,900,000 | $2,018,000 | Sunbelt Corporate Package |

**Signal: an unmitigated exception on a live breach.** The 14 August 2026 update appraisal put the
Lakeside resort at $23.5MM against $26.0MM at origination, which takes the first mortgage to 72.1
percent LTV against a 70 percent policy and covenant maximum. The exception is Unmitigated and
Major; the LTV covenant reads Exception; the valuation that caused it is in the collateral's own
history, dated and sourced. This is the relationship that exercises the watch-grade path: 6 on the
account and the annual review's watch note.

125 records, 16 org-minted. Four of its eight household edges are `Beneficial Owner`, the role that
mints no reciprocal, which is why its derived count is the smallest of the seven.

## 4. Prairie Ag Holdings LP

Grain and row crops, NAICS 111150, Ames IA. Revenue $52MM, grade 4. Anchor
`001bb00001Ld1HNAAZ`, manifest `seed/manifests/prairie-ag.json`.

| Package | Id | Credit stage | Committed | Outstanding | Name |
|---|---|---|---|---|---|
| `operating` | `a5Fbb000000JBNxEAO` | Booked | $11,400,000 | $7,882,000 | Prairie Ag Operating Package |
| `land` | `a5Fbb000000JBNyEAO` | Booked | $10,000,000 | $8,932,000 | Prairie Ag Farmland Package |
| `storage` | `a5Fbb000000JBNzEAO` | Booked | $4,200,000 | $3,700,000 | Prairie Grain Storage Package |

**Signal: a maturity inside the window.** The $10MM seasonal operating revolver matures 2027-02-08,
153 days out and the earliest booked maturity in the portfolio, which is the renewal trigger the
worklist is meant to raise. The current-ratio covenant is Waived on a 1.34x result against a 1.50x
minimum at the December harvest, with the waived policy exception to match.

145 records, 21 org-minted. 8 collateral assets and 14 valuations, the deepest collateral history
of the seven: growing crops, grain inventory, receivables, the equipment schedule, two farmland
parcels, the elevator and the dryer.

## 5. Cascade Software Solutions Inc

SaaS, NAICS 513210, Portland OR. Revenue $34MM ARR, grade 5. Anchor `001bb00001Ld14VAAR`,
manifest `seed/manifests/cascade.json`.

| Package | Id | Credit stage | Committed | Outstanding | Name |
|---|---|---|---|---|---|
| `senior` | `a5Fbb000000JBKjEAO` | Booked | $14,000,000 | $11,430,000 | Cascade Senior Facilities Package |
| `acquisition` | `a5Fbb000000JBKkEAO` | Booked | $5,000,000 | $4,775,000 | Cascade Acquisition Package |
| `equipment-other` | `a5Fbb000000JBKlEAO` | Booked | $950,000 | $810,000 | Cascade Equipment and Other Package |

**Signal: a covenant exception a sponsor cured.** Net leverage came in at 3.70x against the 3.50x
level that took effect for the quarter ending 30 June 2026, missed because the April acquisition
drew before the acquired book contributed a full quarter of EBITDA. The covenant reads Exception,
the policy exception is Mitigated and Major, and the mitigant is sponsor equity rather than a
personal guaranty. This is the relationship that lights the memo's PEG and sponsor modules.

122 records, 20 org-minted. The smallest book and the only one whose collateral is intangible:
receivables, the IP blanket and a pledge of TopCo equity.

## 6. Lakeshore Dental Supply Distributors Inc

Wholesale distribution, NAICS 423450, Milwaukee WI. Revenue $147MM, grade 5. Anchor
`001bb00001LcIAeAAN`, manifest `seed/manifests/lakeshore.json`.

| Package | Id | Credit stage | Committed | Outstanding | Name |
|---|---|---|---|---|---|
| `abl` | `a5Fbb000000JBPZEA4` | Booked | $19,400,000 | $13,688,000 | Lakeshore Asset Based Lending Package |
| `real-estate` | `a5Fbb000000JBPaEAO` | Booked | $6,350,000 | $5,943,000 | Lakeshore Real Estate Package |
| `growth` | `a5Fbb000000JBPbEAO` | Booked | $4,200,000 | $3,844,000 | Lakeshore Growth Package |

**Signal: two at once, an overdue test and an open exception.** The semi-annual field exam covenant
was due 2026-08-14 and reads overdue by 25 days; the minimum-availability covenant reads Exception
against its $1.5MM block. One policy exception is Unmitigated and Major (availability below the
block, awaiting the autumn borrowing base certificates), the other Waived (the field exam, a bank
scheduling failure). It also carries the portfolio's only second review, an AdHoc one.

150 records, 24 org-minted. 9 facilities, the most in a single relationship, and an ESOP trust in
the household.

## 7. Northgate Multifamily Investors LLC

CRE investor, NAICS 531110, Charlotte NC. Revenue $29MM NOI-based, grade 4. Anchor
`001bb00001LcuL8AAJ`, manifest `seed/manifests/northgate.json`.

| Package | Id | Credit stage | Committed | Outstanding | Name |
|---|---|---|---|---|---|
| `ridge` | `a5Fbb000000JBMLEA4` | Booked | $23,500,000 | $22,225,000 | Northgate Ridge Package |
| `park-place` | `a5Fbb000000JBMMEA4` | Booked | $16,800,000 | $16,050,000 | Northgate Park Place Package |
| `crossing` | `a5Fbb000000JBMNEA4` | Booked | $14,650,000 | $13,708,000 | Northgate Crossing Package |
| `highland` | `a5Fbb000000JBMOEA4` | Credit Underwriting | $9,000,000 | $0 | Northgate Highland Acquisition Package |

**Signal: the review clock at 20 days.** `LLC_BI__Next_Review_Date__c` is 2026-09-28. The occupancy
covenant carries a waived Exception (87 percent physical at Crossing during renovation) and the
combined-LTV exception is Mitigated and Major.

161 records, 22 org-minted. It is also the relationship that exposes the R3 coverage defect most
sharply: three of its four assets carry both a senior mortgage pledge and a junior capex or
renovation pledge, and the relationship-level coverage figure keeps the junior row. It reads 0.11x
where every facility reads 1.00x to 1.54x. That is a READ-CLASS defect and not seed data:
`knowledge/NCINO-FUNCTIONAL-VALIDATION.md` section 5.1 has the ids and the arithmetic.

---

## Resetting one relationship

Every relationship is removable and rebuildable on its own. Nothing here touches another
relationship, Hartwell or Piedmont: cleanup deletes only the ids in the manifest it is handed and
refuses an id given on a command line.

```bash
cd /opt/connectry/projects/commercial-credit-reinvented/wt-seed
read TOK INST <<< "$(~/.local/bin/bankinggpt-rest)"; export TOK INST

# 1. see what would go. Every id is resolved against the org first.
python3 seed/cleanup_relationship.py <slug> --dry-run

# 2. take it away. The slug has to be repeated; that is the whole safety.
python3 seed/cleanup_relationship.py <slug> --confirm <slug>

# 3. check the spec offline, including against every other spec in the folder.
python3 seed/validate_spec.py --all seed/examples/*.json

# 4. build it back.
python3 seed/seed_relationship.py seed/examples/<slug>.json

# 5. read it back through the org's own cockpit tools.
python3 seed/verify_relationship.py <slug>
```

| Slug | Manifest | Spec | Records the dry run resolves |
|---|---|---|---|
| `meridian` | `seed/manifests/meridian.json` | `seed/examples/meridian.json` | 178 |
| `blue-ridge` | `seed/manifests/blue-ridge.json` | `seed/examples/blue-ridge.json` | 187 |
| `sunbelt` | `seed/manifests/sunbelt.json` | `seed/examples/sunbelt.json` | 141 |
| `prairie-ag` | `seed/manifests/prairie-ag.json` | `seed/examples/prairie-ag.json` | 166 |
| `cascade` | `seed/manifests/cascade.json` | `seed/examples/cascade.json` | 142 |
| `lakeshore` | `seed/manifests/lakeshore.json` | `seed/examples/lakeshore.json` | 174 |
| `northgate` | `seed/manifests/northgate.json` | `seed/examples/northgate.json` | 183 |

**A rebuild does not return the same ids.** The manifest is overwritten by the new run and every id
in this file changes. Anything that pins an id (a saved bundle, a test fixture, a screenshot in a
deck) has to be re-taken after a reset. If you only want the relationship to be current, re-run the
seed WITHOUT cleaning up first: it is idempotent, it creates only what is missing, and a pass over
a finished relationship creates nothing and exits 0.

**Never `--confirm` a slug you did not clean up in the same breath.** The manifest is the only
index; there is no tag query that finds these records, because several of the fields the tag lands
in are long text areas the org refuses to filter on.

## What the seven do not hold, and why

- **No `LLC_BI__Covenant_Compliance2__c` rows anywhere.** Every insert of one fires
  `acnpex_covenantApprovalProcess` unconditionally at a hard-coded human. The covenant history is
  on the covenant's own `LLC_BI__Last_Evaluation_Value__c`, `_Status__c` and `_Date__c`, which is
  the Hartwell pattern. The covenant review room will say "no open test period" on all seven; that
  is expected and is not a defect.
- **Every review is In Progress at Qualification, never Complete.** `RV02` refuses a review born at
  a post-approval stage: a review is approved by pressing Submit for Approval, not by an insert.
  The design's "one completed annual review per relationship" is a shortfall, recorded as one.
- **Every loan is named for the ANCHOR account, not for the entity that borrows it.** nCino renames
  a loan on insert off its account lookup, and every loan's account lookup is the anchor because
  `Customer360Exposure` filters on it. Blue Ridge's real estate notes, Lakeshore's distribution
  centre mortgage and all of Northgate's SPE mortgages read under the anchor's name. The real
  borrower is on the involvement row and on the package's `LLC_BI__Primary_Entity__c`.
- **Relationship-level coverage is wrong on four of the seven** (Northgate 0.11, Cascade 0.26,
  Lakeshore 0.42, Meridian 0.60) wherever an asset carries a senior and a junior pledge at
  different advance rates. Facility-level coverage is right everywhere. R3.
