# Live stress test, 2026-09-14 (founder, real host, plugin 0.9.26, bankinggpt-at)

Founder call: keep every version created tonight in the org; this file holds the record. Filings land
in `cm_Action_Staging__c`; the orchestrator's watch reports each row and this table is appended as
they come. Nothing here is deleted unless the founder says so.

| # | Row | Filed (UTC) | Action | Relationship / package | Result | Audit |
|---|---|---|---|---|---|---|
| 1 | STG-0000000161 | 17:01:07 staged, 17:01:27 completed (20 s org-side; 60 to 70 s wall clock on the page incl. relay and polling) | loan-modification | Hartwell Precision Manufacturing LLC, booked package a5Fbb000000IHFJEA4 → version a5Fbb000000JINpEAO ("9/14/2026 - PP") | success, 13 steps: 12 verified, 1 filed_unverified (org side effects) | 6 of 7 members rolled (Equipment $3M at Proposal stays on the booked package, as the plan said); Line of Credit $15M → clone at $30,000,000, Qualification; amortized term 300 months, first payment 2026-10-01; Elena Hartwell removed from the clone's involvements (parent keeps 4, clone carries 3, the other five members carry identical counts); 6 pledges, 2 covenant junctions, 20 involvements, 4 fees carried; 6 chain rows parent→clone, 6 parents read hasRenewal true; sweep_aggregates removed 5 orphan shells minted by the copy, 0 true orphans after; parents untouched ($15M still $15M, Booked). |
