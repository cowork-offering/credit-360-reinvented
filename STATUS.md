# Credit 360, status and changelog

## Changelog

- **0.9.28 (2026-09-15)** THE BOOM LANE. Boom is its own MCP server (`boom-mcp`) and the cockpit talks
  to it directly: the two reads dropped the gateway's `boom-mcp-js___` prefix, `boom_get_ratios` takes
  a BORROWER and `boom_get_spread` the FILE those ratios name, and the Spreading room walks the real
  four-call ladder (`boom_ensure_company`, `boom_create_upload`, `boom_upload_bytes`,
  `boom_process_file`) with `boom_list_files` in front of it so a re-drop reuses the file Boom already
  holds. THE CONNECTOR IS FOUND, NOT NAMED (decision D1): the page asks `listTools()` which connector
  serves both reads, since the viewer names it when they add it; "Boom" is the fallback, the grant's
  declared name and the health row's label, and the manifest can only declare that one spelling.
  THE WAIT IS THE ROOM'S OWN (D3): repeated `boom_await_file` calls of 20 s inside a two-minute budget,
  the first expiry a statement ("Boom is still processing … I will keep checking") that re-arms itself
  and only the second offering the two doors; the file handle is written down the moment a file id
  exists, so a closed room resumes from `boom_get_file` and never sends the bytes twice. The spread
  that lands is Boom's, so it is published with `provenance: "boom"` and nothing on the glass says
  provisional; the cap on one file is Boom's own (3 MB of base64, 2.3 MB of file) and is named in the
  refusal. A borrower Boom has never heard of reads as "not in Boom", never as an error toast. File
  groups are skipped (D4: Boom refuses them on this org); the stub lane stays behind one constant and
  says it is the stub on every surface when it is flipped back.
  Proofs: the live server's own answers, saved verbatim in `app/src/__fixtures__/boom-live/` and
  `knowledge/proofs/boom-live-2026-09-15-ratios.json`; Boom's `raw` matches the on-file snapshot to the
  digit for Piedmont (leverage 3.8460068781047, coverage 2.637546468401487) and `spread/coverage.ts`
  restrikes the same figure off the live spread.
  Gates: tsc 0; vitest 230 files, 5,431 passed, 0 failed; `drive-boom.mjs` 5 scenarios / 35 assertions
  green; spread-e2e csv, xlsx and pdf on Kingsley all completed with no provisional word and no page
  errors; drive matrix PASS, 0 findings (589 s, run alone); bundle 2,127,773 B (2.029 MiB).
  THE STATEMENT REGISTER, in the Spreading room (founder: "Noland has a ton of exciting spreading stuff, check the MCP UIs for the workroom, cool, sexy and working"; design pick delegated, `knowledge/DESIGN-0.9.28-SPREAD-REGISTER.md`): ported from Noland's Boom workspace widget as native components (`components/workroom/register/`): a real statement select, period chips, Full/K/M, Variance and Variance % behind one toggle (`n/m` where the prior is not meaningful), Adjusted vs As given as a SERVER re-read through `boom_get_spread(adjusted)`, account-code chips in the nine `--cat-*` families with the mis-map flag, per-period coverage ticks, "Validated in Boom · N of M lines carry a Boom account code · $ in thousands", the provenance footer with Open in Boom last; `flipSign` applied; markers only on the lines that feed a headline ratio; Boom's "[Abstract]" header rows hidden. It replaces `SpreadStatements` and the file-level badge (a fact twice); tiles, trend, prose and the two doors are untouched. The Financials tab carries the same register compact (no chip column, three newest periods and Variance %) where the book holds full statements, the four-column table as the fallback. THE IDB GATEWAY IS RETIRED: its last role, the vocabulary restate fallback, is gone; the assist is session-door only and the honest miss is the degrade; connector list = Customer 360, Boom, Microsoft 365, Experience / nCino, AFS, optional Salesforce Read Backup. Gates: tsc 0; vitest 230 files, 5,442 passed, 0 failed; drive matrix PASS, 33 workroom rows plus 3 spread files on 3 books, 0 findings (589 s, run alone); drive-boom 5 scenarios, 35 assertions; capabilities in step (Boom 10 tools); IRIS grep 0; IDB Gateway 0 in the bundle; bundle 2,141,397 B (2.042 MiB, +21.1 KB over 0.9.27). Preview (stub lanes): https://bot.connectry.io/s/db13c58d9bb2/ .
- **0.9.27 (2026-09-15)** THE LIVE-TEST RELEASE. Everything in it came out of the founder's real filings on
  0.9.26 the evening before Dreamforce, and every fix is proven on the org or on the built bundle.
  Org side (bankinggpt-at): (55) every facility the cockpit inserts sets `LLC_BI__Default_App__c =
  loans.dashboard-loan` (`C360NewFacilities.LOAN_DEFAULT_APP`, both insert sites, read back by
  `verify_loan`; 0Afbb00000DwEUYCA3), because the field's own default in this org is the misspelt
  `loan.dashboard-loan` and nCino's Loan page renders empty on it (the reason Sunbelt's loans had no
  Loan UI; 61 seeded loans across eight example relationships were corrected by hand the same evening);
  (58) a package the New-facility room creates can be rolled back: `create_package` opens it at Pending
  and stamps it on the ledger row, the discard classifier accepts the ledger as evidence, and a
  parentless package deletes clean (0Afbb00000DwHaTCAV; proven: Piedmont proof package created,
  rendered, discarded to zero rows, STG-0000000163/164). Cockpit: (57) the founder's Blue Ridge transcript, seven defects in the facility room: a covenant waiver / forbearance / exception ask is refused by name with the in-scope alternatives, and while that exchange is open no duration typed for it reaches the term or amortisation parser ("waive for 6 months" had been staged as a 6-month term); role-based removals ("remove all limited guarantors") list the rows and stage one removal each; a party name the book does not carry is searched in the org (Customer360SearchAccounts) and kept as typed; "a different facility" re-asks on the new facility with the party carried; a fee percentage lands on the fee and the fee arm owns its exchange (no leaked term question); a question ("do we need to add a new covenant?") goes to the desk, not to a repeated card. Drive `founderBlueRidge` on Hartwell and Kingsley (Blue Ridge is not baked; the lines run on each book's own names). (53) the rainbow card no longer jumps on approve + execute: it held its ascent 320 ms before the room was still, so it moved 443 px in one frame; it now ascends into the box it keeps (4 px of travel measured against 450), and the conic glow is clipped to the card radius (`finale-clip.css`, `clip-path` after `filter`), same colours, same animation. (54) spent turns keep only their settled recap line; option chips ride only on the live turn (`withoutChips` in threadCondense, one rule for all rooms; on the bundle after four moves: 5 recap lines, 0 chips).
  Gates: tsc 0; vitest 227 files, 5,350 passed, 0 failed; drive matrix PASS, 33 workroom rows plus 3 spread files on 3 books, 0 findings (603 s, run alone); bundle 2,120,298 B (2.022 MiB, +8.8 KB over 0.9.26).
  Proofs: SPEC-0.9.23-ORG-PROOF.md section F, `knowledge/proofs/0927-*.json`, stress ledger
  `knowledge/STRESS-TEST-2026-09-14.md`. Next: the Boom lane (new Boom MCP server in, IDB Gateway out).
- **0.9.26 (2026-09-14)** HOTFIX: THE AGGREGATE SHELL ON THE TRANSITION ALLOWLIST. The founder's first
  live modification on 0.9.25 was refused at the confirm gate: "step sweep_aggregates:
  LLC_BI__Loan_Collateral_Aggregate__c is not on the transition allowlist". The morning's Apex (A5)
  added that step to every version-creating plan (modification, amend, new facility); the page's
  mirror of the fence refuses unknown objects by design and was not taught this one, and the drive
  gate could not catch it because the stub's stage plan did not carry the org's step set. Fix:
  `TRANSITION_ALLOWLIST` gains a policy for the aggregate object (never created, never updated by
  this cockpit; `removesOwnRows` names `sweep_aggregates` as the one removal it may carry, the
  org's own sweep of shells its transaction minted and left unlinked); `DISCARD_VERSION_OBJECTS`
  names the object after the facilities and before the package, as the org deletes it; the stub's
  stage plan and discard inventory now mirror the live objects, so the 33-row drive validates the
  same plan the org sends. Rule from here: a new step object lands in three places in one commit,
  the Apex plan, the allowlist (or the discard fence), and the stub's plan. Gates: tsc 0; vitest
  226 files, 5,312 passed, 0 failed; drive matrix PASS, 33 workroom rows plus 3 spread files on 3 books, 0 findings (561 s); bundle 2,111,257 B (2.013 MiB, +563 B).
- **0.9.25 (2026-09-14)** THE ENTRY-SHEET RELEASE. Founder, 2026-09-13 from the road, on the 0.9.22
  preview: "we need to think about that entry and make it more cinematic, elegant maybe; less a bubble,
  more centric; and it does not make sense to even offer booked PPs on the new facility flow"; then, on
  the 0.9.24 design (knowledge/DESIGN-0.9.24-ENTRY.md, design-intent gate, one option): "explain me
  here what it is and lets build it; ideally the same for the relationship workroom but tailored to the
  actions in there so its unified for those two." Both rooms now open on ONE centred sheet, the finale's
  mirror (`EntrySheet.tsx`, `entry.css`, `.wk-sheet` glass reused by class, not one colour declared):
  the relationship's name, one line of state off figures the room already holds (grade, committed, the
  signal that opened it), the doors, the read chips. A door is `.wk-sheet-go` with a second line; a door
  the book has shut stays on the glass carrying the book's own refusal verbatim (IN_FLIGHT, VERSION_AMEND,
  NOT_AMENDABLE, NO_COMPLIANCE_ROW), quiet rather than red. Facility room doors: Modify, Renew, New
  facility, Credit memo, Shape this version where the room stands in one; New facility never offers a
  booked package. Relationship room doors: the six reviews plus the two version doors, which, with no
  package chosen, say of the relationship what the registry says of a package ("Nothing on this
  relationship is in flight to amend"). The 0.9.24 briefing sits UNDER the doors: built above them
  first, and on Hartwell it pushed all eight doors below the fold, so the state line carries the signal
  and the briefing is the why beneath (orchestrator gate call, logged in intent-gate.jsonl; founder to
  confirm on the preview). While the sheet is open the thread stays at its head instead of following
  the briefing down. Picking a door folds the sheet into one recap line ("Modify, chosen") and the room
  runs as it always has: the scoped package question where the route needs one, the first step where
  it does not. `lockReason` is one judgement for two surfaces (the door and the typed route), so a
  modification typed at a room standing in a version no longer binds an engine its door refuses. The
  relationship header reads "2 on this relationship" rather than "no product package". Org side
  (bankinggpt-at, 0Afbb00000Dvcp3CAR then 0Afbb00000DvdBdCAJ), backlog 46 closed at its root: the
  collateral aggregate shells are minted at version CREATION by nCino's managed triggers while pledges
  are copied onto the clones (orphans from birth), not by the discard; `C360AggregateSweep` now sweeps
  them in the same transaction (`sweep_aggregates`, verified) in the modification, amend and new-facility
  executes, and the discard freezes the clones' aggregates plus the build-window orphans and reads
  nCino's cascade (ENTITY_IS_DELETED) as `already_gone`. The staging trail was cleared to zero and 18
  orphan shells removed on the founder's "start fresh". Gates: tsc 0; vitest 225 files, 5,308 passed, 0 failed; drive
  matrix PASS, 33 workroom rows plus 3 spread files on 3 books, 0 findings (563 s); IRIS grep 0; bundle 2,110,694 B (2.013 MiB, +5.5 KB over 0.9.24 for the sheet
  and its styles). Proofs: `knowledge/proofs/0925-discard-aggregates-*.json`, SPEC-0.9.23-ORG-PROOF.md
  section E. Commit 2192fe6. Preview (stub lanes, Hartwell's real book, nothing reaches Salesforce):
  https://bot.connectry.io/s/5c5dbf93ef38/ .
- **0.9.24 (2026-09-14)** THE RELATIONSHIP-ROOM RELEASE. Founder, 2026-09-13, from the road: "why
  are we driving everything from a PP perspective in the relationship workroom; covenants and
  collateral should be driven from the relationship; a package is an association the row shows,
  never a filter; and it feels flat and out of touch: yes ok it is a covenant review, but for what,
  what does the room need from me and why, and it should pull in information from all over the
  relationship; and it needs to work everywhere, not only Hartwell." Org side (bankinggpt-at,
  0Afbb00000Dvb8DCAR): `StageCovenantReview` and `StageCollateralValuation` are anchored on the
  ACCOUNT (`productPackageId` optional, a narrowing the caller chose, never required; a package-only
  call still derives the borrower so the 0.9.23 cockpit keeps working); every planned covenant and
  item carries its `associations` (the facilities and packages it is tied to, read off the junctions,
  unconstrained by any package); the staging row anchors on the account; `StageNewFacility` (and its
  execute) and `StageRenewal` (held) take the covenant add, covenant attach and pledge add arms of the
  modification through the shared `C360FacilityArms`; the discard marks the modification row that
  FILED the version Withdrawn too. Proven on Hartwell (SPEC-0.9.23-ORG-PROOF.md D): a covenant review
  with `accountId` only scopes all covenants across both packages with their associations. Cockpit:
  the covenant review and the collateral valuation open on the relationship with no package question
  and no package chip; every covenant and every owned asset is listed with the facilities and packages
  it is tied to on the row ("Line of Credit $15M, Construction $12M; Non-RE/RE package",
  "Relationship level, on no facility"); the plan card says "What this touches"; the trail row says
  "Covenant review on Hartwell, across the Non-RE and RE packages". THE BRIEFING: the relationship
  room opens by explaining, not asking: per covenant what it tests, the threshold against the measured
  figure with its source and date, the last verdict, the next test, the trend where two points exist,
  the facilities and packages it sits on; what changed on the relationship since, drawn from every lane
  the cockpit holds (spread and ratios, exposure and drawn balances, pledges and coverage, the trail,
  signals; the inbox and the memo named as gaps where not loaded); what the room needs from the banker
  and why; what the committee will ask, derived and never a policy verdict; and what is not in front of
  it, named. Pure builder (`channel/relationshipBriefing.ts`), tested on all five baked books, never
  invents; the same shape for the valuation, the annual review, the risk-rating review and the service
  request; the governed ask stays last. EVERYWHERE, NOT ONLY HARTWELL (founder): the drives now take a book (`--book`, `design/probes/lib/book.mjs` derives every figure a scenario quotes off the baked bundle with the app's own rules) and the gate runs the matrix on Hartwell, Kingsley (one package, one revolver, a Paid Off loan) and Piedmont (nothing booked); a book that cannot ask a question asserts the simple path and says which it took. What the other books surfaced and was fixed: the modification room went blind to every party when the graph named a package the exposure read did not carry (a version, or the sample books), a party change was staged on a package with nothing booked, a singular party reference fanned out over every facility whose name carried the borrower's word, a guarantor's own name was read as the facility scope, "each once" over a single party, the same refusal printed three times word for word, and the probe's version fixture cloned inactive members so the whole version lifecycle was invisible on Kingsley; the relationship reviews on a book with no compliance rows or no pledged asset refuse at the door in the room's own words and the drive asserts that path. Also: the briefing's gaps read as one sentence each, and the no-collateral refusal speaks of the relationship, not a package. The facility workroom stays package-driven (founder:
  "how it is in the facility room is good already"). Gates: tsc 0; vitest 224 files, 5,285 passed, 0 failed, 11 todo; bundle 2,105,219 B (2.008 MiB; the hard cap moved once from 2.0 to 2.25 MiB with the load reasoning in rename-bundle.mjs, the next move is a trim; baseline moved); IRIS 0; the drive matrix (design/probes/gate.mjs): eleven scenarios on Hartwell, Kingsley and Piedmont plus the three spread files on Kingsley, 36 rows, 0 findings, 0 pending. Backlog: 45, 49, 50 FIXED; 51 FIXED (the matrix is the gate);
  43 (the cinematic entry) is a design-intent gate, one option in knowledge/DESIGN-0.9.24-ENTRY.md,
  built only on the founder's yes; 46, 48 open (founder calls).

- **0.9.23 (2026-09-13)** THE VERSION LIFECYCLE, AND A WRITE THAT ALWAYS LANDS. Founder ask on the
  road: shape a modification a day later, undo it whole, never a 502 again. Org side (bankinggpt-at):
  `StageAmendVersion` / `ExecuteAmendVersion` reuse the modification's own arms (scalar and field
  changes, covenant adds and attaches, pledge adds, fees, involvement adds) landing DIRECTLY on the
  version's own loans, no credit action, no clone, gated to a version still the banker's (no member
  at Approval / Loan Committee) or a cockpit-created pre-approval package; `StageDiscardVersion` /
  `ExecuteDiscardVersion` discover the delete set (chain rows, pledges, covenant junctions, pricing,
  fees, involvements, clone loans, the version package) and remove it in order with a re-query after
  every group, refusing a version in approval or one carrying children the cockpit did not create;
  `cm_Status__c` gained `Withdrawn` so the trail is kept, never deleted; the server definition was
  rebuilt from the LIVE org (28 tools) plus the four new rows (the repo copies were stale and would
  have dropped every write tool); `C360ActionStaging` rotates the confirmation token on a same-key
  replay of a Staged, unexecuted row by the same actor, so a lost first answer never strands a row.
  ORG PROOF (section C of SPEC-0.9.23-ORG-PROOF.md): a real Hartwell version created ($15M line to
  $16M, six members), amended in place (rate 7.60 to 7.10, covenant COV-000727, pledge COL-000774,
  booked parent untouched), discarded (66 records, all seven parents back to hasRenewal false,
  version gone, trail Withdrawn, replay idempotent). Cockpit: amend is the fourth room mode ("Shape
  this version", same parser, same pricing gate, version members everywhere); the relationship room
  gains "Add a covenant to this version" and "Pledge collateral to this version" with the plan
  explaining what moves, what does not, and the coverage or re-test it implies; the memo's pro forma
  reads the version; "Discard this version" on the Client Actions row and the Activity trail's
  standing "Modification in Progress" row, inventory and what stays shown before the confirm, the
  book re-read after; the create room leads with "New package" always, a version leads when the
  room stands in one, and the booked source of a version is never offered; the door asks the ROUTE
  first and the package second, scoped by the route (Modify and Renew a booked package, New facility
  never a booked package, Credit memo the package the memo is for). THE 502 (feedback bucket
  bug-1789312699582): the org had staged the founder's 18-step plan (STG-0000000149, 2.8 s on a
  direct replay) and the relay dropped the answer twice; writes were never retried by an August rule
  that predates the idempotency keys. Now every stage and execute is re-asked up to three times under
  the SAME key on a relay failure, recovers the plan or the outcome from the trail when all three
  fail, prefers the org's rotated token and only re-issues under a derived key where a replay carries
  none, and the banker reads a sentence ("Salesforce took the plan; the answer did not come back,
  asking again", "Filed as STG-149 on the second ask") instead of a platform string; the feedback
  write takes the same three asks before the clipboard. THE ROOM (founder, 0.9.22 preview):
  "collaterals", "guarantors", "entities", "parties" are read topics answered from the book; a party
  resolves by first name when unique; "remove Elena from this loan" asks which of her two loans with
  chips; a bare percentage after "to" is a price; a same line said twice narrows instead of repeating;
  the relationship room's opening remark stands beside the greeting at full width instead of nested
  under it at 78 percent. One ratio one definition (coverage), condensed thread and the 0.9.22 fixes
  carried forward. Gates: tsc 0; vitest 220 files, 5,184 passed, 0 failed, 11 todo; bundle
  2,064,906 B (1.969 MiB; JUSTIFY: amend engine, version routes, discard door, retry ladder, parties
  grammar, +109.3 KB over the 0.9.19 baseline, baseline moved); IRIS 0; spread drive csv/xlsx/pdf
  green; workroom drive nine scenarios (founderTranscript, stressRate, relativeAndSign,
  founderParties, discardVersion, createFromRelationship, createInsideVersion, amendVersion,
  relayDrop) all findings []. Backlog: 38, 39, 40, 44, 47 FIXED; open for 0.9.24: 43 (cinematic
  entry), 45, 46, 48, 49 (relationship-driven covenants and collateral, packages as associations),
  50 (the room as a briefing), 51 (drives on three books).

- **0.9.22 (2026-09-13)** THE LOCK, THE PILE-UP, THE CHAT. Founder feedback bucket
  `bug-1789294443785` (Hartwell modification, 0.9.20 in the real host): after "Hold 6.58%" every
  later line was refused with "One decision at a time" and no card on screen; the cockpit chat sat
  on "Composing" for over three minutes; spent chips and "Filed: [settled]" rows piled above the
  live question; the memo's opening chips read cluttered. ROOT CAUSE OF THE LOCK: settled
  exchanges stay mounted off the glass, and `openGates` counted every live item in the thread
  array, so any card a multi-chip Confirm settled off-screen became an invisible open gate for
  the rest of the session. Now: the gate counts only what is on stage; the refusal, where it is
  still right, names its card ("The rate card above is still open: pick Hold 6.58%, a new all-in
  rate or index plus spread"); questions are answered from the book inside an open gate and the
  decision is restated; "yes increase to 7.25%" after a hold re-opens the rate and stages it; an
  invariant test says a refusal implies something on the glass; the transcript is a repro test
  (`oneDecisionLock.repro.test.tsx`, 5 of 11 failed before the fix). THE CHAT: the new word
  pacer painted the bubble empty on mount and filled it from animation frames, so in a throttled
  or hidden view it stayed blank (jsdom reports reduced motion, which is why no test saw it); it
  now lands whole after 1.2 s without a frame, an empty desk answer gets the honest sentence, and
  the chat now asks the desk on the WORKLIST view too, with a portfolio context (the queue rows loudest first with reasons, grade, exposure, coverage, next test and maturity; the book totals with their scope; a standing honesty list; capped at 5,000 chars, 2,819 on the real book), so "who needs attention today", "which relationship has the thinnest coverage" and "how much is committed across the book" answer from the page's own figures; every desk failure lands a bubble (a declined door says the notice once and then what still answers; a timeout says the wait it spent; anything else says the ask did not reach the desk; one console.info carries the failure code for the next real-host report), and the composer is enabled only for a lane the send will actually try. The connector grant warm-up added in 0.9.20 (four reads at open, each raising a host
  consent dialog) is OFF by default (`GRANT_WARMUP_ENABLED=false`) until a real-host run proves
  the host does not queue the session door behind an open dialog. CONDENSED THREAD, LIVE PRESENT:
  only the current turn renders in full; every earlier turn is one recap line in the settled
  register ("Commitment amount: $15M to $35M, confirmed · challenged, acknowledged"), one click
  re-opens it, spent chip rows leave the glass, nothing unmounts; wired in the facility, the
  relationship and the memo rooms; the Feedback transcript now prints what each receipt recorded
  instead of "[settled]"; the memo's opening chip row and chips are capped to the workroom chip
  register. In the facility room the condensed thread keeps a spent block mounted off the glass (the room's absence grammar; a confirmed chip is its own receipt) and pins any turn that asks something, so a refusal that says "the open card above" never has its card condensed away; the earlier-step recap lines sit directly in the column so the step census stays honest. RELATIONSHIP ROOM READS: a recognised read question whose card comes back empty (Hartwell's pledges sit outside the anchored package) used to fall through the step machine and be FILED as the step's answer ("show me the pledges on this loan, recorded"); a read is now always answered as a read (card, else desk, else the honest gap sentence) and the live step is restated, on the desk lane and on the no-desk lane alike (`relationshipRoomQuestion.render.test.tsx`, fails on the old code with the founder's literal string in the settled row). ONE RATIO, ONE DEFINITION: after a stub spread the room panel printed coverage from the drop's own lines while the Financials tab and the memo kept the on-file LTM ratio (3.09x beside 2.95x on one page); Boom's definition is operating profit over interest expense, proved against Piedmont's own snapshot, stated once in `spread/coverage.ts`, restruck on publish only when the spread carries the newest period and never invented where the book has none (`coverageParity.e2e.test.tsx`: room, rendered tab and memo are the identical number). STRESS SCRIPTS ON THE BUILT PAGE (not in the founder's transcript, same class): a singular "the line of credit" on a package with two of them now asks which, one chip per member (a plural reference stays a selection; a figure in the sentence still narrows out loud); a bps token or a percentage with a move verb is a rate move ("add 50bps": 6.58% to 7.08%, "take 25 bps off" down); a rate typed into another field's open question stages the rate and restates the question; a signed figure is refused with both readings computed off the book and chips; an unreadable answer quotes what the room heard instead of repeating the question; "keep it" and "no change" land as the keep chip; a member question holds until answered; the gateway assist's restatement is accepted only when it produces an amendment (the stub's canned paragraph was being read as a term question). NEW GATE: `design/probes/workroom-e2e.mjs` drives the built page with the
  probe stub lanes plus Hartwell's real book, types the founder's transcript and the
  stress-script lines into the real composer, takes Confirm and Acknowledge like the banker did,
  and asserts every turn replies, no reply repeats, no refusal without a visible card, no em
  dash; on 0.9.21 it reproduced the founder's breakage, on 0.9.22 it passes. Fixtures and the
  spread drive ship under `design/probes/`. Gates: tsc 0; vitest 209 files, 4,932 passed, 0 failed, 11 todo; bundle 1,996,730 B (1.904 MiB, under the soft gate); IRIS 0; spread drive csv/xlsx/pdf green (ladder complete, provisional badge, coverage 3.09x on every surface); workroom drive founderTranscript / stressRate / relativeAndSign: findings [] and no page errors. Warm-up stays OFF. Follow-ups in backlog rows 37 (a bare date at an idle room), 38 to 40 (0.9.23: shape and undo the version, create room), 42 (Key ratios card period labels).

- **0.9.21 (2026-09-13)** THE MEMO'S KEY METRICS TABLE (founder review of the Piedmont memo). Before:
  one "as of" ratio set repeated across every fiscal column and stamped "(unchanged)" in a fourth,
  three columns cap (Hartwell's FY2023 fell off silently), nCino's last covenant test printed inside
  a fiscal-year column, three vocabularies for one absence ("flagged for RM", "not modeled", the
  marker), and Debt ÷ EBITDA at 2.17x while the Executive Summary printed Boom's 3.85x. Root cause of
  the last one was a data bug: the dossier's line picker matched Boom's "Line of Credit and Current
  Portion of Long-Term Debt" as long-term debt, double-counting the short-term balance and dropping
  the long-term one ($11.35M against a real $20.13M). After: one column per period the spread
  carries, oldest to newest; revenue, cash and free cash flow per period off the spread; Adjusted
  EBITDA and Debt ÷ EBITDA only in the period Boom computed them for (3.85x, equal to the KPI);
  the covenant test moved under the table with its own evaluation date; the pro forma column only
  where an executed step moved a commitment, and only the leverage that step supports (Piedmont
  4.32x); one marker for every absence; two notes name the source of every row and claim no
  estimate. The renderer's hardcoded cells are corrected post-render through the override seam
  (`overrides.ts key_metrics_table`, `keyMetricsFrom`); `renderMemo.vendor.mjs` untouched, four
  vendor-side notes recorded for Noland's renderer. `memo/keyMetrics.test.ts` (61 tests over four
  memos). tsc clean; vitest 202 files, 4,831 passed, 0 failed, 11 todo; bundle 1.887 MiB (+25.5 KB
  over 0.9.19's baseline, inside the soft tier). PDF drive through the built page green.

- **0.9.20 (2026-09-13)** THE GUIDED SPREADING ROOM, SYNC THAT FORCES, GRANTS UP FRONT, AND THE
  MEMO'S GAPS. Founder test of 0.9.19 in the browser: the send step sat in the middle with the
  financials already showing below it, the file card said the same fact twice, the button was a
  solid fill outside the glass register, the trend showed FY2025 twice, and the post-read read
  facts without connecting them. SPREADING ROOM: five-step spine (Drop, Read, Confirm, Boom,
  Financials) with one guidance sentence per stage; the drop zone collapses to a bar after the
  first file; the card is a fact list with tags ("already on file", "differs from the
  relationship"); the plan is the LAST element and lives on the workroom finale sheet (the same
  glass and rim as the filed summary) with glass doors: "Confirm and spread" / "Leave it for now",
  then "Draft the credit memo" / "Back to <account>"; the plan morphs into the Boom ladder in
  place; the financials panel and the narrative reveal only when the spread lands; trend merged by
  label with the newest spread as the latest point (an older LTM sits before it); an "Explain"
  door on the panel. CONNECT THE DOTS, honestly: the post-read now re-tests EVERY covenant on the
  book where its ratio is derivable ("Maximum Debt to Worth tests at 1.60x against its 3.00x
  ceiling, inside it") and says why the others cannot be recomputed from a statement, states the
  three-period direction, the margin and balance-sheet moves, and the committee questions that
  RULES raise (margin fell while revenue grew; coverage moved toward its floor; debt outran EBITDA;
  a covenant now tests within a tenth of its threshold); session Claude may only rephrase those
  facts (S6 guard unchanged). Fixed on the way: "Browse files", the recommended chip and the new
  column's figures rendered white on white (--accent-ink on a light ground). SYNC FORCES EVERY
  LANE (founder: a modification showed only after Sync and a reload): the Sync gesture bypasses the
  slow-tier skip window; the open path keeps it. CONNECTOR GRANTS UP FRONT (founder: prompts came
  one by one per page): 1.2 s after first paint, one safe read per configured connector, so every
  permission prompt comes at the start, once (AFS only where a servicing key exists). MEMO GAPS:
  a gap audit (`memo/gapAudit.test.ts`) builds the dossier for Hartwell and Piedmont from the real bundles, renders it, and classifies every "[not in source system; flagged for RM]": class A (in the book, never mapped) is now FILLED: borrower profile (industry, NAICS, revenue), guaranty type, the Key Metrics table and spreading charts on display-only books (figures labelled "Boom, as displayed on the cockpit's book", no Boom file fabricated; balance-sheet ratios stay marked and a zero-debt leverage artefact is overridden), supporting documents (spread file, valuations), before-key semantics on the executive summary; the narrative FIGURES block now carries ownership, coverage, structural signals incl. the in-flight revision, opportunities and executed steps. Hartwell markers 8/9 to 6, empty blocks 8 to 5; Piedmont unchanged at 5 (all B/C). Class B (in the org, on no read: NAICS title, business description, package name, rating history, legal-entity ids, term/amortisation/first payment on Exposure, AFS coordinates) and class C (HRB, URE, past-due statements, scenarios, peers, written mitigants, an ungraded Proposal facility) keep the marker by doctrine; both lists are in the audit test. Org hygiene: Hartwell's 09-11 test modification removed in full (clone loans, package
  version, chain rows, staging rows; parents read hasRenewal=false). tsc clean; vitest 201 files, 4,770 passed, 0 failed, 11 todo; bundle 1.882 MiB (+20.8 KB, inside the soft tier); browser gate: CSV, XLSX and PDF driven through the built page, six screenshots reviewed per state.

- **0.9.19 (2026-09-13)** SPREAD FINANCIALS (on the stub), THE GOLDEN RULE PART TWO, AND THE
  FALLBACK AND LATENCY AUDITS. SPREAD FINANCIALS: a sixth FAB satellite opens the Spreading
  room (arc respread r=124 → r=150, 46.9 px rhythm kept, both anchors unchanged): drop
  PDF / XLSX / CSV / images, each file becomes a card on the first frame and the pre-read
  fills it in place (kind, pages, statements, periods, quality, provisional read; pdf.js
  3.11.174 and SheetJS 0.18.5 load lazily from cdnjs, never bundled; 5 MB a file, ten a
  plan, sha256 identity so a re-drop never forks a period); one ask at a time with chips
  (recommended only where a sibling file grounds it); one governed plan; a per-file Boom
  ladder; then the live financials panel (tiles, trend, IS/BS/CF, new period marked) and
  the post-read (what changed, which covenant tests move, "not yet verified in Boom").
  THE SPREAD LANDS IN THE COCKPIT: `spread/publishSpread.ts` merges the returned
  statements into the raw Boom file and re-normalises through `boom-normalise.mjs`, so the
  Financials tab (badge "Provisional, Boom verification pending") and the memo's Boom graph
  pick the new period up; the covenant challenge is deliberately NOT recomputed until it can
  carry a provisional qualifier (backlog 20). Activity trail entry "Boom (stub, provisional)".
  BOOM IS A LATER DELIVERY: Noland's read + write Boom MCP server does not exist yet;
  `channel/boomUpload.ts` implements the adapter with the STUB active (real ladder, 4-8 s,
  spread built from the pre-read, never "verified"), the live mapping written against four
  expected tools (`boom_upload_statement`, `boom_upload_status`, `boom_create_file_group`,
  `boom_validation_session`), `SERVERS.boom` = the gateway name until the connector lands
  (health row "Boom (via gateway)"); both existing Boom reads now address `SERVERS.boom`, so
  the flip is one line. An 8-test honesty suite pins that no surface says "verified" on the
  stub. GOLDEN RULE PART TWO (items 9/13/14/15): one context builder
  (`channel/relationshipContext.ts`) behind the workroom envelope, the cockpit chat and the
  relationship room (proven identical by `contextUnity.test.ts`); standing `notCarried`;
  `counterpartyId` on the group rows; rule C wording on the two grounded asks. FALLBACK
  AUDITS (chat + workrooms, 62 findings, all P1 fixed, 81 repro tests): the chat no longer
  says "unavailable" with the session door open, the desk wait is bounded (75 s) and honest,
  relative moves ("add 50bps", "increase by $5M") are computed off the figure on file and a
  minus sign is refused with options, a blank or gibberish line keeps the pending question,
  a correction supersedes the earlier entry ("That replaces the earlier 7%."), typed
  new-facility amounts land, empty choosers are refused with a door, term / first-payment
  asks lead with the current figure, connector wording leaves the KPI band and the actions
  panel, rung-3 waits say they can take up to two minutes. LATENCY (measured, L1): room
  lookup shimmer 1,500 ms → adaptive (400 ms floor); compose floor only when the desk was
  asked; no second shimmer on Renew / New facility; chat streams through the shared pacer
  (140 words 8.4 s → ~3 s); cold relationship open goes wide and navigates before the graph
  wave; the FAB arc no longer moves a backdrop-filter and tightens to 0.28 s; `.itab` no
  longer transitions layout. Budgets: DOCTRINE_BUDGET_BYTES 19,000 → 20,500 (measured
  19,983; `credit-policy` must survive, pinned); relationship envelope 9,407 / 10,000 B;
  chat context 6,579 / 7,000 B. Bundle gate reset (item 16): HARD 2.0 MiB, SOFT +50 KB over
  the shipped baseline. Browser gate (new, mandatory): scratchpad spread-e2e drive of the BUILT page with the stub lanes for CSV, XLSX and PDF: room 55-59 ms to first paint, card 25-40 ms, stub ladder completed, provisional panel, Financials tab "Boom · 4 periods, FY2025 · Provisional", activity entry "Boom (stub, provisional)", zero connector calls, no IRIS, no em dashes; it caught six defects the unit suite did not (stub died without a model, PDF lines joined on one line, singular "Auditor's" regex, units ask on a stated scale, periods replaced not appended, badge missing, a policy sentence through the post-read guard). tsc clean; vitest 198 files, 4,691 passed, 0 failed, 11 todo. Bundle 1.863 MiB (+97.8 KB over 0.9.18: the spread room, the audit suites are test-only, the line map, the publish path); baseline reset to 1,952,974 B.

- **0.9.18 (2026-09-12)** THE CHAT GOLDEN RULE, ROUND ONE — plus the memo agents.
  Two audits (chat / envelope, and the relationship room) found 8 + 4
  showcase-blocking defects, each pinned as a repro test first; two fixer agents
  then made every repro pass. RELATIONSHIP ROOM: "Renew at current terms" is a
  recommendation, not facility work; the valuation counter counts what it will
  ask (no "Step 2 of 65"); the value ask leads with the on-file appraisal and its
  date as a chip; intake never files "an asset" as the description; the asset's
  own COL-number is accepted; a mid-review read card returns to the live question
  and never offers modification work; collateral loops escalate on the second
  miss; keep-words, contradictory answers and junk are handled; "six reviews".
  DELIBERATE REVERSAL (founder to confirm, recommended keep): an empty catalog read
  falls back to the bundled type mirror instead of dead-ending the room.
  ENVELOPE + COCKPIT CHAT: the OBLIGOR GROUP now reaches the model (role,
  ownership, own grade) and `notCarried` refuses by name what is not read; the
  in-flight version travels (workroom AND chat) so a lock is explained, not
  refused blind; the chat states covenant threshold + operator + current value
  ("what is this covenant doing?" is answerable); every total states its scope;
  the doctrine names each new fact and when to use it (budget 18→19 KB, measured:
  the widest line was silently dropping credit-policy). NEW TOOL
  `connectedPartyBook`: a connected party's own exposure and covenants on
  demand, bounded to the anchored graph, with a ladder entry so "the guarantor's
  own exposure" reaches it. The cockpit chat is no longer stateless: last 6 turns,
  one markdown-free bubble, echo + server copy render once, "Ask again" echoes
  once. Renewal: no keep-chip on the required maturity (a 0.9.7 bug), real
  +12/+24/+36-month options. Em dashes out of the rooms' own sentences.
  MEMO AGENTS: `credit-memo` + `credit-reviewer` vendored (v0.53.2, AFS
  throughout, fast path proven from this plugin's root, provenance + drift gate);
  routing in credit-360.md. Envelope on Hartwell 8,079 / 10,000 B; tsc clean;
  vitest 174 files, 4282 passed, 0 failed. Bundle 1.767 MiB — budget moved
  1.76 → 1.77 MiB (+17.7 KB of context/tool/guard code); second move in a day, so
  a founder decision is logged to reset the gate to a load-derived cap.
  Follow-ups (part 2): one context builder over the three surfaces; grounded
  recommendation wording per doctrine C; permanent tests for three polish items;
  a standing `notCarried` for the chat; ids on the group rows.

- **0.9.17 (2026-09-12)** P1 — THE PACKAGE LIFECYCLE (knowledge/PACKAGE-LIFECYCLE-SPEC.md),
  built against the LIVE nCino ladder read from the org (11 stages; approval is
  "Approval / Loan Committee"; a replaced original carries Status "Superseded", a
  discarded modification "Withdrawn"). (1) One `packagePick(entry, ask)` decides the
  lock for ALL THREE package pickers — the bound modify picker, the header
  switch-peek (which had NO lock before: a banker could walk the room onto an
  unbooked version), and the relationship room. In the modification flow the booked
  source of an in-flight version is hard-blocked as **"Modification in Progress · a
  version of this package is unbooked with the org"**; a room standing IN a version
  refuses Modify/Renew. (2) `inFlightEditable`: the version stays workable until one
  member reaches approval, then the whole version locks ("editable until approval"
  → "in approval · locked"). (3) Archival + exposure = the live set only — and a
  LIVE DOUBLE-COUNT the spec did not name: the hero subtracted only
  /proposal|application/, so a version at Qualification (Hartwell's real fork)
  counted as BOOKED ($67.5M shown vs $54.0M true). Pending is now ladder position
  below Booked; archived = Superseded/Withdrawn/Declined; committed = gross −
  pending − archived, fixed once in hero.ts. +13 packages tests, +2 room tests;
  tsc clean; 4229 passed, 0 failed. CAVEAT (honest): post-booking archival is
  INFERRED from what the org writes on a replaced original — no modification has
  ever BOOKED in bankinggpt-at; one real booked modification is needed to confirm.
  Bundle budget nudged 1.75 → 1.76 MiB (63 bytes over on +2.0 KB of lifecycle
  logic; justified in rename-bundle.mjs). Also in this release as findings-only:
  the chat golden-rule audit (CHAT-TUNING-PROPOSAL.md, 33 repros) and the
  relationship-room audit (9 it.skip repros) — fixes follow in 0.9.18.

- **0.9.16 (2026-09-11)** RESTATE ASSIST, SESSION-FIRST — fixes the "connect to IDB
  Gateway" prompt in the workrooms AND the slow / re-asking loop in modifications
  (feedback bugs `bug-1789112493629` + the gateway-prompt report). The room's
  narration already ran session-first (brainLane.doorFor), but the engines'
  `restate` — the deterministic-parser ASSIST fired when a banker's phrasing
  misses the parser — called `SERVERS.gateway` (IDB Gateway / Bedrock) DIRECTLY in
  modifyEngine's inline copy and in the shared `gatewayRestate` (renew + create).
  Reaching for an unconnected connector raised the platform's consent prompt, and
  the gateway bridge is the slow, flaky path ("structured tripped at ask 2… a read
  retry can hold the conversation open indefinitely"), which is the re-ask loop.
  Both now try the SESSION DOOR first (`sampleAvailable()` → `askSession(prompt,
  {tier:"quick"})`, the banker's own Claude, no connector), gateway only as the
  rung beneath. Each engine's prompt is unchanged — channel only. Test env has no
  session door so the gateway path is what the suite exercises; 4177 green.
  NOTE (not a bug): a filing reported "failed" with Customer 360 connected means
  the org REJECTED the write — on 2026-09-11 07:41 Hartwell still carried an
  in-flight Qualification clone (since deleted), so a second modification hit the
  version-chain conflict. That is the P1 lifecycle item (PACKAGE-LIFECYCLE-SPEC).

- **0.9.15 (2026-09-10)** IRIS PURGED FROM THE BUILD. "IRIS" is a Truist-specific
  system name and must never appear in a Credit 360 surface (founder rule,
  2026-09-09); the rating / PD / covenant-grade source is AFS. The rendered memo
  already showed "AFS" (0 visible "IRIS"), but the internal dossier key and
  provenance strings were still `iris`, and the rating source's badge monogram
  read "IR" (IRIS's initials). Renamed the dossier input `iris` -> the neutral
  `ic` across the whole memo layer (dossier.ts, types.ts, narrative.ts, the
  vendored render `render-memo.mjs` which DERIVES renderMemo.vendor.mjs, the
  assembler, the seed file iris_placeholder.json -> ic_placeholder.json, and the
  vendor manifest re-recorded), and the badge "IR" -> "AF" to match its "AFS"
  label. Golden parity fixture updated to the compliant output (a deliberate,
  documented divergence from the upstream credit-memo plugin, whose own rename was
  reverted and which is off-limits to edit). GATE: `grep -i iris` on the shipped
  template = 0 (both "iris" and "IRIS"). Full suite 4177 green; vendor-check clean.
  DIRECTIVE: run `grep -i iris` on the built template before every C360 release.

- **0.9.14 (2026-09-10)** FEEDBACK PILL EXTENDED to the RelationshipRoom — covenant
  review, collateral valuation, annual review and the other relationship flows now
  carry the same Feedback control in their header (left of close), building the
  transcript from the room's own thread. MemoRoom still has none: it is
  section-based (no conversation thread) and its only close is the finale
  afterglow, so it needs a bespoke serializer + a slot — deferred. Full suite 4177
  green.

- **0.9.13 (2026-09-10)** FEEDBACK BUCKET — the pill now opens a report form, not
  a silent copy. Pick what went wrong (multi-select: inaccurate information, loop,
  repeating, wrong action, missing data, UI, slow, crash, other), add a note, and
  the conversation rides along; Submit writes ONE document to the `bugs`
  collection in the artifact's SHARED store — the same guarded door the cockpit
  uses for its book cache and state — so every viewer's reports land in one bucket
  a session reads back with `read_db` and triages (status open -> fixed ->
  closed). No external server (the artifact CSP blocks that anyway), and no store
  = it copies to the clipboard so nothing is lost. The store's door rejects any
  field over 32 KB or carrying a markup-shaped token, so the transcript is
  byte-clipped and neutralised (zero-width spaces break `<script` / `javascript:`
  / inline-handlers) BEFORE the write — no silent refusal. Glass modal in the
  cockpit register, one --brand accent on Send. New components/bugReport.ts +
  BugReportSheet.tsx, 7 tests (sanitiser, byte-cap, store-vs-clipboard routing);
  full suite 4177 green. STILL: mounted in the modify/renew Workroom + chat only,
  not yet the RelationshipRoom or MemoRoom.
  HOW TO READ THE BUCKET: `read_db` on the cockpit URL, collection `bugs`.

- **0.9.12 (2026-09-10)** FEEDBACK (BUG) BUTTON, MADE FINDABLE. It was there all
  along in the workroom header and the chat, but painted --ink-faint, icon-only,
  on the near-white header — invisible and impossible to aim at next to close
  (founder: "hovered the area and only close was there"). Now a small hairline
  pill in muted ink with an always-on "Feedback" label, so it reads as a button
  and has a real hit area; the label still swaps to "Copied" / "Copy failed" for
  a beat after a click. CSS + one label word. KNOWN GAP (not this release): the
  button is mounted only in the modify/renew Workroom and the chat, NOT in the
  RelationshipRoom (covenant review, collateral valuation) or MemoRoom — those
  room shells never got it.

- **0.9.11 (2026-09-10)** FILED-FINALE BUTTONS, MADE GLASS. The two doors
  ("Draft the credit memo" / "Back to <account>") were still reading too dark:
  the primary sat on a near-black ink pill against the cream sheet. Both are now
  the sheet's OWN material — translucent white, hairline, the same backdrop blur
  as the card — so they belong to the finale instead of sitting on top of it.
  The primary is a touch more opaque and warms to the brand violet on hover; the
  secondary is lighter and quieter. Also fixed the button FONT: a bare <button>
  had fallen back to the browser's UI font, so the labels were off; both now
  inherit the card's --font-sans. CSS only.

- **0.9.10 (2026-09-10)** KPI FAST-ACTIONS POPOVER — the landing's actionable
  numbers now open. Clicking **Needs action**, **Reviews due** or **EWS active**
  (the totals stay plain — no action attaches to a sum) drops an anchored popover
  from the cell. Each row states the account's own "so what" (a breach reads
  "23d overdue, a real miss to record against threshold"; a maturity reads
  "matures in 18d") and offers two doors: a primary CTA that opens the workroom
  named for the concern (Start covenant review / Start renewal / Open the request)
  and a quiet "Copy prompt" that drops the account-specific instruction into the
  composer for the chat-native banker. Both the read and the prompt come from ONE
  ACTION REQUIREMENT declaration (`kpiActions.ts`), so they never drift. Reuses
  the queue's own rows and the proven open path (flyName / openAccountLive); the
  popover only routes. New `components/kpiActions.ts` + `KpiActionSheet.tsx`, 6
  derivation/routing tests; full suite 4170 green; register-clean (one --brand
  accent on the primary CTA, hairlines, rule-13 no meters).

- **0.9.9 (2026-09-10)** SHIPPED-TEMPLATE FIX, the reason 0.9.2 through 0.9.8
  "showed no change" for viewers. The release steps bumped `plugin.json` and
  promoted the fresh build to `artifact/customer-360-template.html`, but never ran
  `scripts/sync-plugin-assets.mjs`, so the plugin's OWN payload template
  (`client-360/assets/customer-360-template.html`, which the rebuild path and
  every fresh publish actually read) stayed frozen at the 0.9.1 build. The
  cinematic boot skeleton, the guidance chips, the finale restyle and the new-PP
  link were all in the repo but never reached a rebuilt cockpit. Synced the plugin
  payload to the 0.9.8 build (byte-identical, drift check clean) so a rebuild now
  serves the skeleton (no more raw five-relationship flash) and every shipped fix.
  DIRECTIVE: every release MUST run `node scripts/sync-plugin-assets.mjs` (or its
  `--check`) before commit — a version bump without the sync ships a stale plugin.

- **0.9.8 (2026-09-10)** The shared read card (covenant review, structure,
  collateral) no longer stretches in the wider relationship room: it was capped
  at 86% of the column, which ballooned it and opened a canyon between each label
  and its figure. Capped to min(86%, 560px) so the figure stays a glance from its
  label in either room. CSS only; full suite 4164 green.

- **0.9.7 (2026-09-10)** MODIFICATION, MADE GUIDING AND ROBUST FOR THE DEMO. (1) A
  one-click "Keep <current>" chip on every rate / amount / term / maturity
  question (modify + renew), so keep-current is a click, never a typed word you
  must know. (2) The FORCED rate ask now takes a typed "hold" / "keep it" too, not
  only its chip — a banker who types it at the ask they cannot skip is no longer
  stuck. (3) The filed finale speaks the room's own button language (ink pill,
  brand violet on hover; the dark-plus-purple-halo look is gone) and LINKS to the
  package the filing created ("Open the new package in nCino"). Full suite 4164
  green. Known next: collateral loop, new facility, covenant review + collateral
  valuation (relationship room).

- **0.9.6 (2026-09-10)** TWO WORKROOM IMPROVEMENTS, shipped together with the 0.9.5
  cold-open work. (1) A BUG / COPY-TRANSCRIPT BUTTON: a quiet ink glyph in every
  workroom header and in the chat copies the whole conversation to the clipboard
  as markdown (agent lines, typed answers, clicked chips, settled receipts), so a
  tester or banker can paste the exact end-to-end back for feedback. Read-only,
  reads each surface's own already-complete state. (2) "HOLD" NO LONGER LOOPS:
  answering a rate / amount / term / maturity question with "hold" / "keep it" /
  "no change" / "leave as is" / "unchanged" / "same" now holds the field at its
  current figure and moves on, instead of re-asking the same question forever
  (parseModify keep-current, shared by modification and renewal). Recognised only
  where the field's own reader found no value and the line carries no digit, so
  "keep it at 7%" still stages 7%. KNOWN, NOT YET FIXED: the pricing-gate rate
  CHIP ("Hold 7.60%") and the create/collateral asset-kind loop are separate
  paths and land next. Full suite 4161 green.
- **0.9.5 (2026-09-09)** THE COLD OPEN NO LONGER FLASHES THE BAKED TEST BOOK. On a fresh open with a
  connector the landing showed the five baked relationships (three of them samples) for the few
  seconds the live Customer360Portfolio read takes, then swapped abruptly to the org's real book.
  Two changes close it. (1) A BOOK CACHE: every good portfolio read is written to one `cache/book`
  document (channel/lastGood.ts, putBook/loadBook), and the next open seeds from it, so a returning
  viewer sees their own last book instantly, marked with its age, and the live read settles over it
  identically when nothing moved (same object reference, no reflow). (2) A CINEMATIC SKELETON: a
  truly fresh open with nothing cached shows a shimmer of the real band, briefing and queue geometry
  (components/HomeSkeleton.tsx, gated by a new `booting` flag on useLivePortfolio) instead of the
  samples, and the book reconciles in when it lands. Neutral wash sweep, rule-21 clean (no purple on
  the ground), reduced-motion stills to a flat wash. A share link with no connector never boots and
  renders the baked book exactly as before; a wedged read reveals the baked book at a backstop
  (~READ_DEADLINE + 2s) rather than shimmering forever. 17 new tests; probe re-run green except two
  pre-existing date-drift assertions (sc12 severity order, sc13 "in 153d" now 122d) unrelated to this
  change. The two probe helpers (`openPage`, `openAccount`) now wait for the settled home, and six
  navigation-test files open the home pre-settled via the `__skipBootForTests` seam.
- **0.9.4 (2026-09-09)** A FIRST OPEN ON A NEW SEAT NOW WORKS END TO END. Two defects sat on step 4
  of the open, the path a viewer with no cockpit takes. (1) The shipped five-borrower book,
  `assets/live-data.json`, could not be assembled at all: it was baked in two passes and the clock
  was left at the first, so five Hartwell activity rows postdated `meta.generatedAt` and the
  assembler's A10 assertion refused the file. The DATA is fixed, not the assertion: no repo script
  queries the org (a re-bake needs a session holding the Customer 360 connector), so
  `meta.generatedAt` moves to the LATEST OBSERVATION TIMESTAMP the file carries, computed over every
  historical instant in it (`activity[].ts`, `requests[].receivedAt`, boom `createdAt`):
  `2026-08-25T04:55:34Z`. Forward-looking scheduled dates run to 2036 and are excluded by design,
  since they are compared against the clock as a window. A new `meta.generatedAtNote` records the
  two-pass history and what the next re-bake must undo. The corrected clock changes three derived
  states on Hartwell and the tests move with it: the room's opener now leads on the DSC test 36 days
  out rather than the AR test 6 days out, the AR test reads 25 days overdue in the room's overdue
  tier, and the ticket quotes Aug 25 as the prepared-on date. The quiet-tier negative test now
  CONSTRUCTS its "nothing overdue" premise instead of inheriting it from whatever the last bake held.
  Challenge count (19) and data-quality findings (1) are identical on both clocks. (2) The favicon had
  no value anywhere in the repo, so a first publish had nothing to pass. It is 🏦, the icon the
  canonical cockpit carries, now fixed in `SKILL.md` step 4, `app/PUBLISH.md` §6.5 and
  `assets/cockpit.json`'s `_comment`: on the first publish, never changed. Step 4 also now names its
  DATA: it bakes the bundled `assets/live-data.json` with no fetch in front of it, because the page
  refreshes itself through the viewer's own connectors on landing, and `assets/sample-data.json` is
  test-only and never published to a banker. Step 4 carries one honest caveat: the bundled snapshot
  stages the baker's `meta.userId`, so the first governed WRITE from a fresh seat needs a rebuild from
  that viewer's own session.
- **0.9.3 (2026-09-09)** The cockpit resolves PER VIEWER, because a single canonical URL cannot serve
  more than one organization. An artifact declaring runtime capabilities is organization-internal and
  never opens by public link, so the pinned `canonicalArtifactUrl` (published 13:24 from an account in
  a different claude.ai organization) answered "artifact not found" for every other seat. The open now
  takes, in order: the URL this session's own publish returned; the most recently updated artifact
  titled "Credit 360 · Relationship Cockpit" (or the older "Customer 360 · Relationship Cockpit") the
  viewer owns or is shared, found with `list` over `scope: "all"` and verified with `read`; the
  canonical URL, only if `read` succeeds for it; otherwise a fresh publish on the rebuild path, with
  one line telling the viewer to share it to their organization from the page's Share control. Steps 1
  to 3 stay instant: one listing call and one read, no fetch and no assembler. "One URL for everyone"
  is retired everywhere in favour of "one cockpit per organization, resolved per viewer". Skill, agent,
  README, RUNBOOK, `cockpit.json` `_comment` and the plugin description. No code change.
- **0.9.2 (2026-09-09)** Marketplace `cowork-offering/credit-360-reinvented` (name `credit-360-reinvented`,
  owner Fabian Goetzens); the two same-day predecessors `credit-360` and `credit-360-cockpit` are deleted.
- **0.9.1 (2026-09-09)** The canonical cockpit is republished under a new claude.ai account and
  `client-360/assets/cockpit.json` points at it. No code change; the bundle is the 7f5b399 build.
  Cowork never refreshes a marketplace it has fetched, so a hand-over is always a fresh repo and a fresh name.
- **0.9.0 (2026-09-09)** The product is named Credit 360 everywhere (plugin `credit-360`, skill
  `credit-360-cockpit`, page title, docs); the Salesforce connector keeps its name `Customer 360`.
  Marketplace repo `cowork-offering/credit-360`. Polished README with connector setup.
- **0.8.x (2026-09-08 to 09)** The book's read is a poll, not a watch (the runtime refuses a watch on
  this connector's tools). The hero summary and chips are derived live for every relationship. The
  vendored memo copy names the rating source AFS. Live worklist derived from Customer360Portfolio;
  the book rule (exposure or a grade); a new facility always creates a new Product Package.
- **0.7.0 (2026-09-06)** Stability build: instant open, last-good cache, per-lane retry and knock, wall
  clocks, the Salesforce Read Backup lane, room deadlines and resume, chaos harness, memo store lean.

**Read this first.** This repo is the single source for Credit 360: code, plugin packaging,
and the full knowledge tree (`knowledge/`). New sessions start here, then
`knowledge/HANDOFF-2026-07-27.md` for deep context.

## Why this matters

Credit 360 is a **component of the Commercial Credit Brain** (alongside the Commercial Credit
Memo) and **the showcase for Dreamforce**. The story it carries: a governed, write-capable MCP
server built entirely Salesforce-native (Apex invocables + McpServerDefinition, no middleware),
with a product-grade cockpit on top. Deliverable quality bar: spot-on.

## What exists, all live-verified

| Layer | State |
|---|---|
| **Salesforce MCP server** | 24 Apex tools in org `bankinggpt`, `Customer360` McpServerDefinition (23 in artifact manifest). 9 reads + stage/execute write pairs (bulk collateral valuation hardened to a required package anchor + required per-item date + 20 cap, service request, annual + risk-rating reviews, new facility w/ package-first + borrowing structure, package-scoped BULK covenant review) + modification stage/execute pair + stage-only renewal. WS0.5 items 2+3 (2026-08-22) changed those two tool SHAPES; no tool name changed and the McpServerDefinition was not touched. Engine: plan/planHash/single-use decisionToken, write-guard transition allowlist, idempotency, verification re-queries. Apex suite 170/170. Rebuild mirror: `knowledge/sf-build-v2/wp2/`. |
| **Cockpit (React)** | `app/` — worklist-first client overview (KYC & Onboarding removed from scope 2026-08-27), deal-grammar tickets (package-anchored mod/renewal, bulk collateral picker, review fork), email→action suggestions, sync tiers + persistent overlay, ~1,200 tests. Compiled to `artifact/customer-360-template.html`. |
| **Published artifact** | claude.ai artifact URLs (main `f7a6006f-…`, copy `95cf2a8d-…`), verified byte-identical to repo HEAD bundle + data. Page calls connectors live via `window.claude.mcp` with viewer credentials. |
| **Cowork plugin** | `.claude-plugin/` + `skills/credit-360-cockpit` + bundled template + `render/assemble-cockpit.mjs` (agent fetches data → assembler bakes JSON → Cowork artifact). ⚠️ Plugin bundle STALE at commit `6eda1b6` (Jul 26) — pre-deal-grammar. Sync = outstanding item 1. |
| **Demo data** | Hartwell Industrial Group (91 records, $46MM, 6 booked loans, ids in `knowledge/DEMO-RELATIONSHIP.md`) + Piedmont anchor. Live-observed envelope datasets baked in `artifact/live-data.json`. |

## Wiring map

- **Org:** `bankinggpt` (shared Accenture sandbox — refresh risk acknowledged; mirror in
  `knowledge/sf-build-v2/` is the rebuild path). sf CLI auth on the Archy box.
- **Connectors (claude.ai):** Customer 360 (org MCP), IDB Gateway (LLM, 3 tools),
  Microsoft 365 (`outlook_email_search`).
- **Publish pipeline:** `app/npm run build` → `scripts/release-artifact.mjs` →
  `app/scripts/assemble-artifact.mjs` (full-tag marker injection, slot-verified — NEVER ad-hoc
  replace, see HANDOFF hard lesson) → Artifact republish to both URLs.
- **Sibling product:** Commercial Credit Memo (plugin `credit-memo-reinvented`, Experience MCP at
  `experience-mcp.vercel.app`). Shared doctrine: skills carry methodology, servers carry facts and
  writes, plugins ship the parts.
- **Dev seats:** Archy box (original) + **Banksy** (`ubuntu@98.87.86.133`) — migration COMPLETE and
  verified 2026-08-14: repo cloned at `/home/ubuntu/projects/customer-360` with working GitHub push
  auth (Credit Brain Dev app token), all 39 knowledge docs indexed in hybrid recall (probes 0.99-1.00),
  ontology nodes linked (repo -> project -> product, server -> project). Banksy rule: everything
  ubuntu-owned, never sudo git.
- **Functionality status: COMPLETE and live.** Everything in the "What exists" table works today on
  the published artifact URLs against the real org. The outstanding list below is packaging, sign-off
  and gated-by-design items — not missing functionality.

## Outstanding (priority order)

1. **Plugin sync** — refresh bundled template/data/skill to repo HEAD (`20bf17a`), skill prose
   still says 8 read tools (24 exist), version bump 0.4.1 → 0.5.0.
2. **Fabian's 100%-certain click-through** — incl. staging a real modification on a Hartwell
   booked loan (task open since July campaign).
3. **Codex adversarial review** of the full campaign delta (planned closer, never run).
4. **⚠️ ARMED WARNING:** renewal clone field set does not exclude `Loan_Collateral_Aggregate` —
   re-probe before `execute_renewal` is ever unblocked (HANDOFF §2).
5. ~~**Covenant execute** — founder-gated.~~ CLEARED 2026-08-22 (WS0.5): run live on both arms on
   throwaway data, now in the manifest and called by the cockpit behind the confirm gate. What still
   holds it is the ORG — `executionHeld` on the staged plan, and a per-covenant refusal on any
   compliance row that is not Pending unless the banker opts in.
6. **Renewal execute** — stage-only by design (clone collateral-aggregate re-probe outstanding). Modification execute shipped 2026-08-22 (WS0.5); the cockpit calls it on both surfaces.
7. Housekeeping: Piedmont test rows (CV-0000000002/3, R-4) deletion decision; Credit Memo 0.54.0
   connector swap (sibling, tracked there).
8. Dreamforce is now CONCRETE: SPIN booth (690 Folsom St, SF), Sept 15-16 2026, C360/Cowork =
   **Demo 2, COMMERCIAL banking** (Wealth = Demo 1, the web app — the "steer C360 to Wealth" idea
   is superseded for the demo; Wealth stays roadmap). The print-approved journey panel names our
   email-to-action moment; the demo must deliver it, and has NO voice. Full context:
   `knowledge/DREAMFORCE-SPIN-CONTEXT.md`. Demo script still on Fabian's hold.
9. **Regulatory currency:** SR 11-7 superseded by **SR 26-2** (Fed, Apr 2026) — update citations
   after the control-set diff (see DREAMFORCE-SPIN-CONTEXT.md).

## Key doctrine (short form; full: knowledge/HANDOFF + LESSONS-NCINO-APEX)

- Stage = zero domain DML; execute = exactly `{idempotencyKey, stagingId, planHash, decisionToken,
  approverUserId}`; approver == running identity.
- Observe wire envelopes before pinning shapes (invocable `required=true` is REST-enforced,
  test-invisible).
- Aggregate-by-identity on every per-involvement list; honest empties; display correctness is a
  contract for ALL relationships.
- Never touch pre-existing bankinggpt build; additive deploys with receipts.
