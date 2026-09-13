# 0.9.23: shape the version, undo the version (spec, 2026-09-13)

Founder ask (Fabian, 2026-09-13, travelling): "a modification we created a day ago: add a covenant
or collateral, change the facility information; same for packages I created; and a rollback, undo the
whole package creation on an in-flight modification so it is back to the booked package only."
He believed 0.9.17 (P1, the package lifecycle) covered this. It covered the STATE, not the ROUTES.

## 1. Code facts (verified 2026-09-13, not from memory)

| Fact | Where |
|---|---|
| The in-flight version is a first-class state: `inFlightVersion`, `inFlightEditable` (true until a member reaches Approval / Loan Committee), `inFlightVersionId` on the source, `hasInFlightModification`. | `app/src/book/packages.ts` `packageRoster()` |
| Lock 1: the booked source of an in-flight version refuses a second fork ("Modification in Progress"). | `lockedSourcePackage`, `IN_FLIGHT_REFUSAL` |
| Lock 2: a version at approval refuses all work. | `lockedInFlightVersion`, `IN_APPROVAL_REFUSAL` |
| A room standing IN an editable version refuses Modify/Renew with "Change the figures in this version, or book it in Salesforce first." NO ROUTE IN THE COCKPIT CHANGES THE FIGURES IN THE VERSION. | `forkTargetVersion`, `VERSION_TARGET_REFUSAL`; `Workroom.tsx:1370-1385` |
| Covenant and collateral flows cannot anchor on any unbooked package: `packagePick(entry, "review")` blocks it. | `RelationshipRoom.tsx:3182`, `packages.ts:342` |
| A new facility creates a new package by default; a pre-approval package is an offer, never pre-selected. The joinable rule reads package stage + credit stage + member stages only; it does NOT read the in-flight lock, so a package with a modification in flight can be offered as a home for a new facility. | `data/packageStage.ts`, `workroom/createEngine.ts:225-250` |
| Write tools: `stage_*` / `execute_*` for modification, new facility, covenant review, collateral valuation, annual review, risk rating, service request, intake, renewal. NO discard, NO amend-version, NO delete of any kind. | `channel/writeTools.ts`; Apex under `knowledge/sf-build-v2/wp2/classes/` |
| The modification clone: loan clone at Qualification, `Is_Modification` true, lookupKey `_M1`, parent untouched, `hasRenewal` formula flipped, two `LLC_BI__LoanRenewal__c` rows (revision 0 self-anchor, revision 1 to the clone), pricing streams cloned by the nCino engine, pledges copied per clone. | `ExecuteLoanModification.cls` header |
| Full manual cleanup proven in the org 2026-09-11 (Hartwell): delete clone loans + clone package + the `LLC_BI__LoanRenewal__c` chain rows for the parents + the `cm_Action_Staging__c` rows; parents then read `hasRenewal=false`. Deleting the clone alone leaves `HasActiveRenewalLoan=true` rows behind and every later roll is refused ("The request contains invalid facilities"). | brain feedback 2026-09-11; STATUS 0.9.17 |
| nCino's own posture: automatic rollback of a failed credit action needs the "Credit Actions Delete" permission set (PDI-00018042); >200 collateral rows break nCino rollback (PDI-00015762); async clone failure can recycle-bin silently (PDI-00017266). | `knowledge/ACTIONS-DESIGN.md:498,858` |
| Org ladder: a replaced original carries Status "Superseded", a discarded modification "Withdrawn". | STATUS 0.9.17 |

## 2. What 0.9.23 builds

TOOL CONTRACT (frozen, supersedes the class names sketched below): `knowledge/SPEC-0.9.23-TOOL-CONTRACT.md`. Two pairs only: `amend_version` (all authoring arms of the modification, landing on the version's own loans) and `discard_version`. The covenant-add and collateral-pledge routes are `amend_version` calls carrying one arm.

### 2a. Shape the version (amend in place)
Scope: an EDITABLE in-flight version (modification or renewal) and any package the cockpit created
that is still before approval. Never a booked package (that stays a fork), never a version in approval.

1. **Facility figures on the version.** New engine `workroom/amendEngine.ts` reusing the modify
   engine's field catalog, parser (`parseModify`, member resolution over the VERSION's members) and
   the same four-field pricing gate; the plan writes the fields directly on the version's loans
   (`LLC_BI__Loan__c` update through the write guard, `OP_UPDATE`, allowlisted fields = the modify
   field wire: amount, rate, term months, maturity, amortised term, first payment date). No credit
   action, no clone. Apex: `StageAmendVersion` / `ExecuteAmendVersion` (staged plan, single-use
   decision token, verify by re-query, action trail row "Version amended"). Guard: refuse if any
   member of the version is at or past Approval / Loan Committee (re-read at execute, not at stage).
2. **Add a facility to the version.** Already possible through the create room's offer; make the
   offer list the version by its own name and "editable until approval" line; the in-flight SOURCE
   package (booked, with a version in flight) is NOT offered (closes the joinable gap).
3. **Covenants on the version.** `packagePick(entry, "amend")` (new ask kind) allows an editable
   version; the covenant flow gains an ADD route: `LLC_BI__Covenant__c` create on the version
   package (type from the org picklist via `C360Picklist`, threshold, frequency, next test date),
   staged and confirmed like a review. Apex: extend `StageCovenantReview`/`ExecuteCovenantReview`
   or a small `StageCovenantAdd`/`ExecuteCovenantAdd` (prefer the latter, one class one job).
4. **Collateral on the version.** ADD route on the collateral flow: pledge an existing collateral
   record to a version loan (`LLC_BI__Loan_Collateral2__c` create, share percentage) or create a new
   collateral record + pledge; existing org catalog for collateral types (`elicit.ts` already asks
   the exact type). Apex: `StageCollateralPledge`/`ExecuteCollateralPledge`.
5. **Pickers.** The header switch-peek, the facility room's ask and the relationship room's ask all
   render an editable version as pickable for amend/add routes, blocked for Modify/Renew/review,
   with the line "editable until approval". One function (`packagePick`) still decides all three.
6. **Chat and memo.** The desk context (`deskAsk.ts` relationship context) already names the version;
   add its editable/locked state and the amended fields so the chat answers "what did we change on
   the version" from the trail. The memo's pro forma reads the version's figures where one exists
   (dossier already prefers the staged step; extend to the version).

### 2b. Undo the version (rollback to the booked package only)
1. **Door.** From the room standing in the version, from the source package's "Modification in
   Progress" row, and from the Activity trail row: "Discard this version". Confirm gate with the
   full list of what goes (the version package, N clone loans, the renewal chain rows, the copied
   pledges, the cloned pricing streams, the staging rows) and what stays (the booked package,
   untouched). Single-use decision token, one click.
2. **Apex `DiscardVersion` (stage + execute).** Stage: discover the delete set by query from the
   version package id, refuse if any member is at or past Approval / Loan Committee, refuse if the
   version has children the cockpit did not create (a document, an approval submission), return the
   inventory. Execute, in this order, all-or-nothing (Database.delete with allOrNone in one
   transaction where the objects allow, otherwise ordered with verification between steps):
   `LLC_BI__LoanRenewal__c` rows for the parents (both revisions), pledges on the clones, pricing
   components/streams on the clones, clone loans, the version package, then mark the
   `cm_Action_Staging__c` rows "Withdrawn" (keep them: they are the audit; never delete the trail).
   Verify by re-query: every parent `LLC_BI__hasRenewal__c = false`, `Number_Of_Renewals__c`
   decremented, version id gone, action history row "Version discarded" written.
   Permission: our integration user needs "Credit Actions Delete" (or the equivalent object
   delete rights); check on the org BEFORE building (sf CLI, one query of PermissionSetAssignment).
3. **Prefer nCino's own undo if it exists.** Before writing DiscardVersion, probe the org for a
   managed credit-action undo (LLC_BI CreditAction / LoanRenewal delete behaviour); if the managed
   engine undoes a renewal cleanly, call it in-process (same rule as ExecuteLoanModification) and
   keep our delete chain as the verified fallback. Record the finding in LESSONS-NCINO-APEX.md.
4. **Room state after undo.** The roster re-reads; the source package unlocks; the Activity trail
   shows "Version discarded" with the inventory; the chat's context drops the version.

### 2c. Create room, the two dodgy bits
1. "New package" must lead the offer whether the room was opened from the relationship or from
   inside a package; opened from inside an in-flight version, the offer is "this version" first and
   "New package" second; the booked SOURCE of a version is never offered.
2. Browser drive scenario `createFromRelationship` and `createInsideVersion` in
   `design/probes/workroom-e2e.mjs` (stub lanes need a version in the stub book: extend
   `stub-lanes.js` livePatch with a fabricated version package + LoanRenewal-shaped history rows).


### 2c.3 The door: route first, package second, scoped by route (founder, 2026-09-13, from the 0.9.22 preview)
Today the facility room asks "Which package does this run in?" before the route on a multi-package
relationship, then offers Modify / Renew / New facility / Credit memo. Founder: the ROUTE comes first,
and the package question only follows where the route needs one, scoped by it:
- Modify / Renew: pick a BOOKED package (the in-flight lock and the version-in-approval lock as today);
  a room standing in an editable version offers Amend (2a) instead.
- New facility: NEVER a booked package. The only homes are an editable in-flight version (or a
  cockpit-created pre-approval package) and "New package"; with none in flight the room does not ask
  at all and the plan creates the package.
- Credit memo: the package the memo is for (booked or version), same picker as review.
One package on the relationship still binds silently. The read chips (Package, Covenants,
Collateral, Maturities, Entities) stay available under the route chips as they are.
Owner: the wave-2 integration agent (C1 owns Workroom.tsx in wave 1 and was briefed before this
landed); tests: the drive scenarios createFromRelationship / createInsideVersion assert the order.

### 9.24 (parked, founder 2026-09-13): a cinematic entry
The room's opening is a chat bubble with chips. Founder wants a smoother, more elegant entry: less
a bubble, more centred, the three routes as the first thing the eye lands on, the package choice
folded into the route it belongs to. Design-intent gate before building (one real option, founder
picks). Backlog row 43.

## 3. Carried forward, unchanged
Everything 0.9.19 to 0.9.22 shipped stays wired: golden rule context builder, condensed thread,
one-decision gate counting the stage only, chat pacer landing whole, portfolio desk, Spreading room
on the stub with Financials tab / memo graph / covenant re-test, warm-up OFF. New rooms use the same
`RoomBoundary`, `ConfirmGate`, deadlines, transcript receipts and decision ledger.

## 4. Gate for 0.9.23
tsc 0; vitest 0 failed; bundle under the soft gate or JUSTIFY; IRIS grep 0; spread drive csv/xlsx/pdf;
workroom drive: founderTranscript, stressRate, relativeAndSign, createFromRelationship,
createInsideVersion, amendVersion, discardVersion (all `findings: []`); ORG PROOF on bankinggpt-at:
one real amend on a fresh Hartwell version, one real discard, parents `hasRenewal=false` after,
both screenshotted into the STATUS entry. No push without the org proof: this release deletes.

## 5. Open for the founder (defaults chosen, say if wrong)
- Staging/trail rows on discard: KEPT and marked "Withdrawn" (audit), not deleted.
- A version with an approval submission or a document attached: REFUSED with the reason; the
  banker withdraws that in Salesforce first. Discard never deletes what the cockpit did not create.
- Amend allowlist = the modify field wire only; anything else (borrower, product, structure) is a
  new facility or a fork, not an amend.

## 0.9.24: the relationship room as a briefing, not a form (founder, 2026-09-13, in flight)

"It says there is a covenant test due or a collateral valuation, but what does that really mean, what
does the room need from me and why, and it should pull in information from all over the relationship."
Backlog rows 49 (account-driven anchor; packages are associations shown on the row, never a filter)
and 50 (depth). The design, so the next iteration starts from it:

THE OPENING IS A BRIEFING. Before the room asks for anything it says, in a credit officer's voice:
1. What is due and what it means: "The Debt Service Coverage covenant on Hartwell tests in 36 days
   (31 October). It requires 1.25x; the last test read 1.42x on the FY2024 spread; the FY2025 spread
   Boom holds reads 1.31x, so the cushion has thinned by 0.11x." Threshold, measured figure, source and
   date of the figure, last verdict, next test, trend.
2. What it is tied to: the facilities and packages the covenant or asset is associated with (shown, not
   filtered), the exposure behind them, the coverage that depends on them.
3. What changed on the relationship since the last test, drawn from every lane: the Boom spread and
   ratios (financials), exposure and drawn balances (nCino), pledges and valuations (collateral), the
   Activity trail (last review, the modification in flight, what was filed), the inbox (the client's
   own emails on financials or covenants, Microsoft 365), the structural signals (EWS), the memo if one
   exists. One paragraph, connected, no list of tiles.
4. What the room needs from the banker and why: "To file this test I need the measured DSCR for the
   period or the compliance certificate; Boom's FY2025 figure can stand as the measure if you confirm
   it; policy requires the verdict before the test date, and a Pending row past its date shows on the
   committee's exception list." Then the ask, as chips where the answer set is finite.
5. What the committee will ask, one or two lines, before the plan.
Same shape for a collateral valuation (asset, basis of value, lendable value, pledges across
facilities and packages, coverage before and after, the last valuation and its source, what changed),
an annual review (the year in the relationship: spreads, exposure, covenants, incidents, the memo),
a risk-rating review (the drivers of the current grade and what moved).

RULES. Golden rule voice; every figure traces to its source and date; nothing said twice; a gap is
named ("the FY2025 compliance certificate is not in the inbox"), never filled; the governed ask is the
LAST element; the plan card says why this review now, what it files and what it does not. Reads come
from the bundle the cockpit already holds plus the inbox lane; no new connector.

BUILD SHAPE. A `relationshipBriefing.ts` builder (pure, tested on the real Hartwell bundle) that
composes the briefing per route from the book + trail + inbox + signals + memo; the relationship room
opens with it under the route; drive scenarios assert the briefing names the threshold, the measured
figure with its source, the associations, one change since the last test, and the ask with its reason.
