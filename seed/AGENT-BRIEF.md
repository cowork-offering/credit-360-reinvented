# Seeding one relationship: the brief

You are building **one** of the seven relationships in
`/opt/connectry/brain/knowledge/projects/customer-360/TEST-PORTFOLIO-DESIGN.md` into the
bankinggpt sandbox. Six other agents are building the other six at the same time. Nothing
you do may touch theirs, Hartwell, or anything else already in the org.

Working directory: `/opt/connectry/projects/commercial-credit-reinvented/wt-seed`.

## The rules, before anything else

1. **You create records only through `seed/seed_relationship.py`.** No ad-hoc REST writes,
   no `sf data create`, no console. If the script cannot express something, say so in your
   report; do not go around it.
2. **You delete only through `seed/cleanup_relationship.py`, and only your own manifest.**
   Never pass an id on a command line. Never delete anything you did not create.
3. **You read anything you like.** Hartwell, the other six, the catalogs: all fair game, all
   read-only.
4. **Never print, log or commit the token.** Get it with
   `read TOK INST <<< "$(~/.local/bin/bankinggpt-rest)"; export TOK INST` and let the scripts
   read it from the environment.
5. **No em dashes in anything you write.**
6. **Your slug is your relationship's short name** (`meridian`, `blueridge`, `sunbelt`,
   `prairie`, `cascade`, `lakeshore`, `northgate`). It names your JSON, your manifest and
   nothing anybody else owns.
7. **Your loan `lookupKey` prefix is yours alone** and must not collide with another
   agent's: use a three-letter prefix from your slug plus a four-digit number
   (`MER1001`, `BLR1001`, `SUN1001`, `PRA1001`, `CAS1001`, `LAK1001`, `NOR1001`).

## The loop

```bash
cd /opt/connectry/projects/commercial-credit-reinvented/wt-seed
read TOK INST <<< "$(~/.local/bin/bankinggpt-rest)"; export TOK INST

# 1. write the JSON
#    seed/examples/meridian.json is relationship 1 written in full: copy its shape.
#    seed/SCHEMA.md is the field-by-field reference.
#    seed/MODEL.md is what the org will and will not accept.

# 2. check it offline. No org connection needed, and it catches most mistakes.
python3 seed/validate_spec.py seed/<slug>.json

# 3. build it
python3 seed/seed_relationship.py seed/<slug>.json

# 4. read it back through the cockpit's own tools
python3 seed/verify_relationship.py <slug>

# 5. fix the JSON, re-run 2 to 4. The seed is idempotent: a re-run creates only
#    what is missing. Never change a key that has already been created.
```

If step 3 refuses records, the manifest holds the org's own message against the input row.
Fix the JSON and re-run; nothing is lost and nothing is duplicated.

## Reading the design section

Your section of the design doc gives you: revenue, grade, NAICS, city, the household with
ownership percentages and who guarantees, three or more booked packages with their
facilities and amounts, the covenants with thresholds and frequency, the collateral and
what it secures, the exception, and the governance signal (review due, test overdue,
maturity near). Everything else is yours to make plausible.

Where the design leaves a number open, choose one a credit officer would not blink at:

- **Balances.** A revolver drawn 55 to 75 percent of its commitment. A term loan amortised
  down 5 to 15 percent per year since its booking. Never a booked loan at zero.
- **Rates.** Lines float: WSJ Prime plus 0.25 to 0.75. Term paper is fixed 6.2 to 7.6
  depending on tenor and grade. Real estate prices tighter than equipment, equipment
  tighter than an unsecured acquisition loan.
- **Tenor.** Lines 12 to 24 months. Equipment 48 to 60. Acquisition and general term 60 to
  84. Commercial mortgages 120 months on a 240 month amortisation, balloon true.
- **Coverage.** CRE 65 to 80 percent LTV. Equipment 70 to 85 of appraised value. An ABL
  base 80 on eligible receivables, 50 on inventory. **Coverage comes from the pledge's
  `advanceRate`**, never from the collateral type: every type in this org defaults to 80.
- **Dates.** Today is 2026-09-08. Booked dates in the past, maturities in the future except
  where your section wants a maturity signal. First payment after the close date, always.

## What "done" means for you

`verify_relationship.py` asserts the design doc's own list and must come back
**all assertions pass**. It checks, through the org's own invocable read classes:

- the snapshot names the relationship, counts every package, carries exposure, a grade, a
  credit stage, the review clock, NAICS and revenue, and its TCE equals the sum of the
  package TCEs;
- at least three booked packages, and no in-flight facility inside one;
- exposure returns every facility, committed equals the sum of the booked loans, every
  booked facility carries a balance, every line is drawn below its commitment with
  availability computed, and coverage is computed wherever collateral is pledged;
- at least two relationship-level covenants, each with a threshold, a frequency and a next
  test date, each with its account association, at least one attached at loan level, three
  or more evaluations, and a history that is not all one status;
- the graph shows the household, every household member is visible from the anchor with
  ownership percentages, the involvements carry a Borrower and a guarantor, and guaranties
  carry their type;
- structural signals answer and see the guarantors;
- fees, pricing streams, collateral, ownership rows, pledges, valuations, a review, a
  policy exception, an opportunity and a case all present and readable.

## What will go wrong, and what to do

These all happened during the proof run. `seed/MODEL.md` section 6 has the full table.

| Symptom | Cause | Fix |
|---|---|---|
| `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST` on the loan purpose | you invented a purpose | use one of the 23 in MODEL.md section 4. `validate_spec.py` catches this before you spend a run |
| `DUPLICATE_VALUE` on a `lookupKey` | your loan lookupKey prefix collides with another agent's, or you reused one | give every loan a unique key under your own prefix; the validator checks for collisions inside your file, not across files, so pick your prefix carefully |
| A covenant type is "ambiguous" | nine names appear twice in the 71-entry catalog | add `"typeId"` with the id you mean, from `seed/reference/hartwell-LLC_BI__Covenant_Type__c.json` |
| The review comes back In Progress when you asked for Complete | RV02 refuses a review born at a post-approval stage | expected. Report it as a shortfall; do not try to patch the stage afterwards |
| The snapshot reports zero exposure | you overrode `tce`/`tbe` with nulls | leave them out; the seed derives them from the loans |
| A facility reads with no availability | you left `outstanding` off a booked loan | every booked loan needs one; the validator refuses without it |
| A household member does not appear in the graph | the only edge to them runs through a holding company | add a direct edge from them to the anchor carrying `indirectOwnershipPercent`; the validator refuses without it |
| The verify says a package has an in-flight facility | you put a Proposal loan in a booked package | proposal loans live only in the one unapproved package your section may have |
| "unresolved reference X:Y" and the run stops | a record Y depends on was refused earlier | read the error above it, fix that record, re-run |
| `ENTITY_IS_DELETED` during cleanup | master-detail cascade | not a failure; the script counts it as removed |
| A field the describe says is createable is refused | field-level security for the integration profile | the three known ones are already dropped from the script. If you hit a new one, report it; do not add a workaround |

## Your report

When you are done, report exactly this:

1. **Slug and account id**, and the manifest path
   (`seed/manifests/<slug>.json`).
2. **The verify output**, in full. It has to say all assertions pass.
3. **Counts**: packages (booked and unapproved), loans, involvements, collateral assets,
   pledges, valuations, covenants, evaluations, fees, pricing streams, reviews, exceptions,
   opportunities, cases. Take them from the manifest, not from memory.
4. **Committed and outstanding**, per package and in total, and the total exposure the
   snapshot reports. State whether they agree.
5. **The governance signal your section asked for** and how it reads in the org: the
   maturity inside the window, the overdue test, the review date, the exception status.
6. **Everything the design asked for that the org cannot hold, and why.** MODEL.md section
   9 lists the ones already known; add anything new you hit, with the org's own error text.
7. **Anything you invented** that the design did not specify, in one paragraph, so the next
   reader can tell your judgement from the founder's instruction.

Do not commit. Do not clean up your relationship unless you are told to. Do not touch
another agent's manifest.
