# Credit 360 Cockpit — Maintenance & Monitoring Surfaces

*Accenture Commercial Credit Brain · Customer 360 MCP · blueprint stage 06 (Servicing & Monitoring) and stage 05 (Offering & Set-up).*
*Anchored to `SCHEMA-VERIFIED.md`, `CAPABILITY-MAP.md`, `ROLE-REQUIREMENTS.md`, `VALIDATION-AND-DECISIONS.md`, `PERSONAS.md`. Extends `EXPERIENCE-SPEC.md` sections 3.1 to 3.7; does not regress them.*
*Single voice, no em dashes. Every regulated number is deterministic server-side code; the LLM never computes a regulated figure. Self-learning ranks and frames, never computes. Memory informs, never sources. DRAFT-until-committee. Run-as-user is the sharing floor.*

---

## 0. Where this fits

`EXPERIENCE-SPEC.md` 3.1 to 3.7 is the **single-customer cockpit**: open one borrower, conclude its health, drill its evidence, act in your lane. That spec proves the relationship snapshot. It does not answer the question five of the seven roles actually live by: **"across my whole book, what is due, what is overdue, what just changed, and is what we booked still what we approved?"** Stage 06 is not a snapshot, it is a clock and a queue. This document writes that clock.

The spine stays the credit lifecycle. These surfaces are the **maintain-and-monitor half** of it: originate (03/04) is documented in the memo and the existing sections; this is what happens after a package books and for the rest of its life. KYC, collateral, and covenants are first-class through-lines here exactly as they are upstream: KYC gets a refresh tickler (02/03 clearance becomes 06 re-screen), collateral gets a revaluation tickler and a coverage-drift watch (03 estimation becomes 05 valuation becomes 06 monitoring), covenants get a next-test tickler and a breach-trend watch (04 finalization becomes 05 tracking becomes 06 monitoring).

Five new surfaces, plus the elevation of two existing sections:

| # | Surface | Blueprint stage | Folds in gap | Home persona(s) |
|---|---|---|---|---|
| A | Work Queue / Tickler | 06 (+05) | Gap 1 (work queue) | PM, Loan Ops, RM |
| B | Event / Trigger feed | 01/05/06 cross-stage | Gap 5 (cross-sell timing trigger) | RM, TMO |
| C | Boarding Reconcile | 05 | Gap 4 (boarding reconcile) | Loan Ops |
| D | Portfolio Roll-up tier | 06 | Gap 2 (portfolio roll-up) | PM, Executive |
| E | Exam / QC Provenance Pack | 06 (Regulatory reporting) | Gap 6 (provenance/audit deliverable) | Officer, Ops, Executive |
| 3.3+ | Collateral-monitoring elevation | 05/06 | collateral through-line | Loan Ops, PM |
| 3.6+ | Covenant-monitoring elevation | 04/05/06 | covenant through-line | PM, RM |

Two gaps from `ROLE-REQUIREMENTS.md` §4 are not new surfaces and are not re-litigated here: gap 3 (authority/routing) is an element of header/verdict and the editable layer (`VALIDATION-AND-DECISIONS.md` §4.4, §5.2); gap 7 (persona-scoped FLS + partial-view marker) is the cross-cutting security primitive (`VALIDATION-AND-DECISIONS.md` §1, §8.5). Each surface below inherits both. Each is one contract: **Question / Conclusion / Evidence and drill path / Actions / Per-persona variation / Data anchors.** As in 3.1 to 3.7, the Data anchors block is a provenance appendix; fields cited inline in the evidence are not re-listed.

**The cross-cutting fence for all of stage 06.** A tickler date, an aging bucket, a concentration percentage, a grade-migration count, a coverage ratio, a breach-trend slope: every one of these is a deterministic server-side computation over verified fields, computed as the running user, never by the LLM, never naive-summed. The LLM ranks which item surfaces first and frames the one banker sentence. The "what is due" math, the "how overdue" math, and the "how close to limit" math are code. This is the same `boomFinancials.js` discipline carried from the single deal to the whole book.

---

## A. Work Queue / Tickler

**Question.** "Across my book, what is due, what is overdue, and what is closest to going wrong, ranked so the thing I open next is the thing that matters most, not the thing I happened to remember?" The PM asks it about reviews and covenant tests; Loan Ops asks it about doc/UCC/insurance exceptions with a regulatory clock; the RM asks it about renewals and whitespace. Same queue, three first sentences.

**Conclusion.** The queue does not list dates. It **concludes a ranked worklist with a reason and a clock on each line**, and it leads with the single most urgent item as a sentence. For a PM whose book contains Piedmont:

> "7 items need you this week; the sharpest is not overdue yet but it is the one to open: Piedmont's DSC covenant tests next quarter and the cushion is already the thinnest in your book at 1.42x against 1.25x and thinning on margin. Two annual reviews are genuinely overdue (14 and 31 days). Everything else is routine."

Each line is a conclusion, not a row: **what is due, why it matters, how much clock is left, and the one move.** "Piedmont annual review, due in 22 days, Pass/Watch on a thinning DSC, start now because the spread refresh drives the covenant test" is a line. "Piedmont, 2026-07-20" is not.

The ranking is **deterministic and computed on a normalized urgency, not raw date order**, so a not-yet-due thin-cushion covenant can correctly outrank a mildly-overdue routine review. Urgency fuses days-to-due (or days-overdue), the regulatory-clock class (an FDPA 45-day flood window outranks a soft internal review date), and the linked risk signal (a covenant test on a thinning cushion outranks one with wide headroom). The fusion weights are a ranking layer the cockpit learns and a persona tunes; the **dates and aging buckets underneath are sourced and locked.**

For a **credit-only relationship like Piedmont** the RM's version of the same queue concludes differently: "Piedmont's renewal clock is your whitespace clock: the 2027 revolver renewal is 1 item, and it is the wedge for the $0-wallet treasury play; open the cross-sell now while the renewal is leverage." The work queue and the whitespace section (3.7) point at the same dated action from two angles.

**Evidence and drill path.** The queue is assembled server-side from the dated obligations already living in verified objects, each item carrying its own drill into the single-customer 360 section that owns it:

1. **Covenant tests due.** Source: `LLC_BI__Covenant2__c.LLC_BI__Frequency__c` plus the last evaluation, producing a next-evaluation date. **The verified schema confirms `LLC_BI__Frequency__c` and the last-evaluation fields; it does not confirm a specific next-evaluation-date API name. The next-test date is therefore computed deterministically (last evaluation date plus frequency) or read from a config-mapped next-eval field where the tenant carries one, never asserted against an unverified field name.** Per-period history (`LLC_BI__Covenant_Compliance2__c`) supplies the last-tested date. Drill lands on the covenant-monitoring view (3.6+), on the binding covenant as a conclusion, not a four-row grid.
2. **Annual reviews / renewals due.** Source: the review wrapper `LLC_BI__Relationship_Risk_Review__c` (review-date / next-review fields where the tenant populates them) and the facility maturity `LLC_BI__Loan__c.LLC_BI__Maturity_Date__c` (the renewal clock, asserted only where real, per 3.7's no-invented-countdown rule). Drill lands on the risk section or the exposure section.
3. **Collateral revaluation due.** Source: `LLC_BI__Collateral_Valuation__c.LLC_BI__Valuation_Date__c` against a staleness window (config `collateralRevaluationMonths`, e.g. 12). Drill lands on the collateral-monitoring view (3.3+), on "this appraisal is N months old" as a conclusion.
4. **KYC / compliance refresh due.** Source: `KYC__c` / `Compliance_Check__c` last-screening date against the refresh cadence (config `kycRefreshMonths`). **Empty-not-pass discipline (per `EXPERIENCE-SPEC.md` 8.4) governs here exactly: if Piedmont's KYC/Compliance rows are absent, the queue does not show "refresh due", it shows "KYC clearance unverified, on file: none, this blocks decisioning at renewal", and that item is loud, not silent. Clearance and its clock are asserted only on real rows.**
5. **UCC continuation / insurance / flood expiry.** Source: collateral-perfection dates on `LLC_BI__Collateral__c` / `LLC_BI__Account_Collateral__c` and the policy/UCC tracking fields where the tenant carries them, each with its regulatory clock (UCC Article 9 continuation window, FDPA 45-day flood notice). Drill lands on the collateral-monitoring view.

Partial-view honesty (gap 7) holds on the queue as on every section: items on relationships the running user cannot see are omitted, and the queue footer reads "partial view, N relationships in your nominal book not visible to you" rather than silently shortening the list. The book is exactly what Salesforce sharing grants the running identity.

Provenance lock: every date and every aging count is read-only and sourced; an analyst who thinks a date is wrong files the correction at the source, never edits the queue.

**Actions.**
- **Drill** any line into the 360 section that owns it (covenant to 3.6+, collateral to 3.3+, review to risk, renewal to exposure, KYC to the compliance conclusion).
- **Lens-change** the ranking dimension per persona (PM: cushion-thinness then review-aging; Ops: regulatory-clock then doc-aging; RM: renewal-then-whitespace) and the window (this week / this month / overdue-only). A presentation choice; recomputes nothing of record.
- **Capture-decision** on an item ("reviewed, no action, re-test next cycle" / "pulled forward, financials requested"), `record_decision`, proposed-not-committed, server-stamped actor and time.
- **Schedule / trigger** a reminder or a watch on an item keyed to its real cadence (`LLC_BI__Frequency__c` for covenants), or stage the renewal package-prep, or route an Ops exception to the exception worklist. Decision-support: it schedules a human's action, it commits no credit action.
- **Annotate** an item as a tickler note (fenced as untrusted data), never overwriting the sourced date.

The two genuinely mutating credit verbs (`ncino_advance_stage`, `ncino_approve_package`) are not queue buttons; the queue routes work to a human, it does not decide credit.

**Per-persona variation.** Same queue, persona-filtered by `cockpitSectionVisibilityMap`, never seven code paths.
- **Portfolio Manager** (home screen). Leads with covenant tests and reviews, ranked by cushion-thinness then aging. The DSC-on-a-thinning-cushion item is the headline. May propose (`record_decision`), set the watch; no grade write.
- **Loan Operations / Servicing** (home screen). Leads with doc/UCC/insurance/flood exceptions, each with its regulatory clock visible (the FDPA 45-day window is a first-class countdown). Ranked by regulatory-clock then doc-aging. Fires the gated AFS handoff tools; read-only on sourced figures.
- **RM / Loan Officer** (home screen, growth-framed). Leads with renewals-due and whitespace-due (the renewal-as-cross-sell-wedge). Ranked by renewal-then-revenue-at-stake. Stages the wallet opportunity; read-only on figures.
- **Credit Analyst** (secondary). Sees the assigned-deals slice of the queue (own book, least-privilege), ranked by underwriting priority and spread-refresh-driving-the-test.
- **Credit Officer** (secondary). Sees the approval/attestation backlog and any item whose covenant is trending toward a grade-boundary; the decision queue, not the tickler queue.
- **Treasury / Cash-Management** (overlay). Sees the renewal/QBR clock as the cross-sell-timing queue (shared with the Event feed, surface B); ranked by fee-upside-then-credit-event-timing.
- **Portfolio / Risk Executive** (aggregate). Sees the queue rolled up: "N overdue reviews, M stale ratings, K covenant tests due this month across your book", a count-and-drill, never a per-item tickler list; read-only oversight.

**Data anchors (provenance, with conclusions).**
- `LLC_BI__Covenant2__c.LLC_BI__Frequency__c` plus last-evaluation fields, and `LLC_BI__Covenant_Compliance2__c` (last-tested date) — the covenant-test tickler; next-test date computed (last + frequency) or config-mapped, never an unverified field name.
- `LLC_BI__Loan__c.LLC_BI__Maturity_Date__c` — the renewal/maturity clock; asserted only where real (no invented countdown).
- `LLC_BI__Relationship_Risk_Review__c` — the annual-review wrapper; review/next-review dates where the tenant populates them.
- `LLC_BI__Collateral_Valuation__c.LLC_BI__Valuation_Date__c` — the revaluation-due tickler, against `collateralRevaluationMonths`.
- `KYC__c` / `Compliance_Check__c` — the KYC-refresh tickler; **empty means "unverified, blocks decisioning", never "due" and never "clear"** (8.4).
- `LLC_BI__Collateral__c` / `LLC_BI__Account_Collateral__c` perfection/expiry fields — UCC continuation, insurance, flood; each with its regulatory clock.
- Config knobs: `collateralRevaluationMonths`, `kycRefreshMonths`, `reviewCadenceMonths` (the staleness windows that turn a date into a due/overdue conclusion); `urgencyRankingWeights` (the learned, persona-tunable ranking layer over the locked dates); `cockpitSectionVisibilityMap` (per-persona queue filter and default ranking dimension). No LLM-computed date or count.

---

## B. Event / Trigger feed

**Question.** "What just happened on this relationship or in my book that changes the timing of what I should do, the moment I should do it, not the static gap I already know about?" The TMO's whole problem is timing: the operating account is won at loan closing, and that trigger lives in the RM's pipeline, invisible to Treasury until it is too late. The RM asks it as "what changed that I should act on." The feed answers the moment, not the content.

**Conclusion.** The feed does not stream raw record changes. It **concludes the credit-or-relationship event and the time-boxed move it unlocks**, ranked by how perishable the moment is. For Piedmont in a Treasury overlay's feed:

> "Piedmont's C&I package is approaching its 2027 revolver renewal: this is the cross-sell moment for the $0 operating wallet. The renewal is the one window where the operating account is easiest to win, because they need us. Open the treasury conversation now; after the renewal closes, the leverage is gone."

The events that matter and the move each unlocks:
- **Package booked / closed / renewed** (the cross-sell trigger): the operating-deposit and treasury suite is captured at this moment for a credit-rich/deposit-poor name; this is the moment the static whitespace gap (3.7) becomes time-boxed.
- **Renewal / maturity approaching** (the leverage window): the renewal is the wedge for the wallet play and for re-pricing on the relationship.
- **EWS fire** (the protect trigger): a covenant cushion thinning toward the watch band, a utilization spike, payment slippage. The downside event, ranked against the upside events because a banker does not separate "grow this" from "protect this" (the same fusion principle as 3.7).
- **Stale-financials / past-due-BBC** (the chase trigger): a review or spread refresh is now blocked on a missing input.

The conclusion is **the move and its window**, not the event log. "Package renewed, win the wallet now, the window is the next quarter" is the conclusion; "Product_Package StageName changed at 14:32" is not.

For a **deposit-rich relationship** the feed inverts, as the whole cockpit does: on Timothy Norton Household, "balance run-off detected on the $910,800 household, this is a retention trigger, not a cross-sell one, call before the competitor does."

**Evidence and drill path.** Each event is derived deterministically from a verified state change, drilling to the section that explains it:

1. **Booking / close / renewal.** Source: `LLC_BI__Product_Package__c` stage/status and `LLC_BI__Loan__c.LLC_BI__Maturity_Date__c`. The "renewal approaching" event is the same dated obligation the Work Queue (A) carries; the feed frames it as a *moment to act*, the queue frames it as *work due*. One sourced date, two lenses. Drill lands on exposure (3.3) and whitespace (3.7).
2. **EWS fire.** Source: the deterministic `deal_covenant_grade` over `LLC_BI__Covenant2__c` crossing toward the watch band (config `watchThresholdPct`), plus servicing signals from afs-mcp (`revolver_utilization`, `payment_history`) that corroborate or contradict. The fire is computed, not guessed; the LLM ranks it against the upside events. Drill lands on covenant-monitoring (3.6+) and the Boom margin trend (3.5).
3. **Cross-sell timing.** Source: the join of a booking/renewal event with a `walletSource = both` empty/low wallet (`LLC_BI__Deposit__c` / `LLC_BI__Treasury_Service__c` / `FinServ__FinancialAccount__c`). The event fires only when credit-event-timing meets a thin wallet, which is exactly the `creditRichDepositPoorRule`. Drill lands on deposits/treasury (3.4).
4. **Stale-financials / aging opportunity.** Source: spread-period staleness (Boom last-period vs today) and `Opportunity.LLC_BI__Days_at_Current_Stage__c` (the aging-at-stage signal, shared with 3.7).

Provenance lock: the event's *trigger* is a sourced state change; the *ranking and framing* are the editable, learned layer. Memory may note "we raised this cross-sell last cycle and deferred it pending the credit decision, now unblocked" (`recall_decisions`), but memory is never the source of the trigger; the trigger is re-read from the live state.

The feed is decision-support, not automation: it surfaces the moment to a human. It never auto-creates an Opportunity, never auto-sends an outreach, never moves money or advances a stage. The DRAFT-until-committee banner persists on anything touching the credit decision.

**Actions.**
- **Drill** the event into its owning section (booking to exposure, EWS to covenants, cross-sell to wallet).
- **Lens-change** the feed's ranking dimension (perishability / revenue-at-stake / risk-velocity) and scope (this relationship / my book), per persona.
- **Stage** the time-boxed move the event unlocks: stage a draft cross-sell opportunity for human confirmation (never auto-create), set a covenant-watch reminder keyed to `LLC_BI__Frequency__c`, kick the renewal package-prep, or route to the Treasury queue.
- **Capture-decision** on an event ("acted, opportunity staged" / "deferred, re-surface at renewal"), `record_decision`, the loop through which the cockpit learns which triggers convert.
- **Subscribe** a persona to an event class (Treasury subscribes to booking/renewal/run-off; PM subscribes to EWS fires), so the feed pushes rather than waits to be pulled.

**Per-persona variation.**
- **RM / Loan Officer** (full). The growth events lead (booking, renewal-as-wedge); EWS shows as relationship context. Closes the RM-pipeline-to-Treasury visibility gap by making the credit trigger shareable.
- **Treasury / Cash-Management** (full, the persona this surface exists for). The booking/closing/renewal/run-off events are the headline; ranked by fee-upside then credit-event timing. This is where the "operating account won at loan closing" moment becomes visible to the person who can act on it.
- **Portfolio Manager** (full, inverted). EWS fires lead, ranked by risk-velocity; sets the watch-trigger off the feed.
- **Credit Officer** (summary). Sees state-transition events relevant to a pending decision and any covenant trending toward a grade boundary.
- **Loan Operations** (summary). Sees booking events as the boarding trigger (hands to surface C) and perfection/expiry events as exception triggers (hands to surface A).
- **Credit Analyst** (summary). Sees stale-financials / new-spread-period events that change what to underwrite.
- **Portfolio / Risk Executive** (aggregate). Sees the event feed rolled up: "N new bookings, M EWS fires, K renewals this month across your book", count-and-drill, read-only.

**Data anchors (provenance, with conclusions).**
- `LLC_BI__Product_Package__c` (stage/status) and `LLC_BI__Loan__c.LLC_BI__Maturity_Date__c` — the booking/close/renewal trigger and the renewal-leverage window.
- `deal_covenant_grade` over `LLC_BI__Covenant2__c`, plus afs-mcp `revolver_utilization` / `payment_history` — the EWS fire and its corroborating servicing signals; deterministic, never an LLM tally.
- `LLC_BI__Deposit__c` / `LLC_BI__Treasury_Service__c` / `FinServ__FinancialAccount__c` — the wallet-thinness half of the cross-sell-timing join; the absence is the trigger.
- `Opportunity.LLC_BI__Days_at_Current_Stage__c` — the aging-opportunity event.
- Config knobs: `creditRichDepositPoorRule` (fires the cross-sell event), `walletSource` (decides whether the wallet is thin enough to fire), `watchThresholdPct` (promotes a covenant drift to an EWS fire), `eventRankingWeights` (the perishability-vs-revenue-vs-velocity ranking layer), `cockpitSectionVisibilityMap`. The event trigger is sourced; the ranking is learned.

---

## C. Boarding Reconcile

**Question.** "Does what we are about to book to the core, or what we just booked, faithfully match the package the committee approved, and is anything still open that should stop me from funding?" Loan Ops' headline KPI is boarding accuracy, and its single biggest error source is re-keying approved terms into the core. This surface is the stage-05 step no other persona owns.

**Conclusion.** The surface does not show two columns of fields and leave the eye to compare. It **concludes a boarding-readiness verdict: matches, mismatches, and the funding gate.** For Piedmont at boarding:

> "Not yet bookable. The approved package is $12.5M TCE across 3 facilities ($5M / $5M / $7.5M, limit/sublimit); 2 of 3 facilities reconcile clean to the staged core values, but the $7.5M LOC sublimit is keyed as a standalone $7.5M limit, which would over-state the line and double-count exposure. 1 documentation condition (key-person life insurance) is open. Resolve the sublimit booking and clear the condition before you fund."

Each line is a conclusion: **approved value, booked/about-to-be-booked value, match or mismatch, and the consequence of the mismatch.** The load-bearing one for Piedmont is the **limit/sublimit trap** (`EXPERIENCE-SPEC.md` 3.3, 4.5): Loan Ops is the persona most likely to mis-book by summing the three facilities to $17.5M instead of trusting the $12.5M package rollup, so the reconcile leads with that exact failure mode and concludes against it.

The funding gate is a **hard conclusion, not advice**: where conditions are open or a material mismatch stands, the handoff actions are gated. Ops can refuse to fund until conditions are met; that is an operational gate, server-enforced, and it is the one place stage 05 says "no" to the rest of the lifecycle.

**Evidence and drill path.** The reconcile diffs the **approved source of truth** against the **staged/booked values**, every comparison deterministic:

1. **Package-level terms.** Approved: `LLC_BI__Product_Package__c` (TCE/TBE/TOE $12.5M / $12.5M / $4.25M, Risk Rating "5"). The reconcile **trusts the package rollup as the truth and tests the booked sum against it**, surfacing any naive-summed $17.5M as the mismatch it is. Drill lands on exposure (3.3).
2. **Facility-level terms.** Approved: `LLC_BI__Loan__c` (`LLC_BI__Total_Facility_Amount__c`, `LLC_BI__Maturity_Date__c`, `LLC_BI__Risk_Grade__c`, and the `LLC_BI__Is_Limit__c` / `LLC_BI__Is_Sublimit__c` wiring). Each facility's approved amount, maturity, and limit/sublimit role is compared to the staged core value; the sublimit-vs-limit role is the field that prevents the double-count. **Per 3.3, the verified files state the bare amounts and the label but not which loan is limit vs sublimit; the reconcile reads `Is_Limit__c` / `Is_Sublimit__c` for the wiring rather than asserting it.**
3. **Collateral and lien.** Approved: `LLC_BI__Loan_Collateral2__c` (advance rate 80%, 1st lien, the 5 pledges, lendable to ~$10M) and `LLC_BI__Account_Collateral__c` (ownership, pledging authority). The reconcile confirms the booked lien position and advance rate match approval, and that perfection (UCC, the blanket plus PMSI on the 3 Mazak machines) is staged.
4. **Conditions / documentation.** The approval conditions (key-person life insurance for the 100% key-person guaranty, per the ownership conclusion in 3.2) tracked as open/cleared. **KYC/compliance clearance is a funding-gate input under the empty-not-pass rule: if `KYC__c` / `Compliance_Check__c` is unpopulated, the gate reads "compliance clearance unverified, cannot fund" and does not pass, never "clear" (8.4).**

The diff is computed server-side; the LLM narrates the verdict and ranks which mismatch is most material, it never decides whether two numbers match. Provenance lock: the approved values and the booked values are both sourced and read-only; the reconcile produces a conclusion *about* them, it edits neither.

**Actions.**
- **Drill** any mismatch into the owning section (facility to exposure, collateral to collateral-monitoring, condition to the compliance conclusion).
- **Capture-decision** on a reconcile item ("sublimit booking corrected", "condition waived pending insurance binder, escalated"), `record_decision`, the materiality routing on an exception.
- **Servicing-handoff actions, gated:** `reserve_obligation_number` and `create_workpackage` (afs-mcp), **fired only when the reconcile passes and conditions clear**, gated to the Loan Ops permission set server-side. A read-only persona or an Ops user with open conditions is rejected, not merely un-buttoned. If a tenant descopes this persona, these tools are intentionally not surfaced.
- **Annotate** a checklist/documentation note (fenced as untrusted data).

Ops authors documentation and fires the gated booking/handoff write tools; Ops is rejected from any rating, approval, threshold, or figure-edit action. The boundary is a server-side permission check, not a UI convention (`ROLE-REQUIREMENTS.md` §4.5, the ops-execution-gate-vs-credit-authority tension).

**Per-persona variation.** This is a **Loan Ops surface**; for other personas it is summary or hidden, per `cockpitSectionVisibilityMap`.
- **Loan Operations / Servicing** (full, the owner). The boarding worksheet, the diff, the funding gate, the gated handoff actions. Home alongside the Work Queue.
- **Credit Officer** (summary, read). Sees boarding status as confirmation that the approved package is being stood up faithfully; no boarding write.
- **RM / Loan Officer** (summary, read). Sees "booking in progress / N conditions open" as relationship status.
- **Portfolio Manager** (summary, read). Sees boarding completion as the start of the monitoring clock (when boarding finishes, the covenant-tracking and review ticklers begin).
- **Credit Analyst, Treasury, Executive** — hidden or aggregate-only; not their work.

**Data anchors (provenance, with conclusions).**
- `LLC_BI__Product_Package__c` (TCE/TBE/TOE, Risk Rating) — the approved package truth the booked sum is tested against; the anti-double-count anchor.
- `LLC_BI__Loan__c` (`Total_Facility_Amount__c`, `Maturity_Date__c`, `Risk_Grade__c`, `Is_Limit__c` / `Is_Sublimit__c`) — facility-level approved terms and the limit/sublimit wiring that prevents the mis-book.
- `LLC_BI__Loan_Collateral2__c` / `LLC_BI__Account_Collateral__c` — approved advance rate, lien, perfection to confirm at boarding.
- `KYC__c` / `Compliance_Check__c` — a funding-gate input; empty blocks funding (unverified, never "clear").
- `reserve_obligation_number` / `create_workpackage` (afs-mcp) — the gated servicing-handoff writes, fired only on a clean reconcile with cleared conditions.
- Config knobs: `boardingDiffFields` (which approved fields are reconciled against core), `fundingGateConditions` (which conditions block funding), `writeToolSurfaceMap` (whether this persona/tenant surfaces the AFS handoff). The diff and gate are deterministic; no LLM decides a match.

---

## D. Portfolio Roll-up tier

**Question.** "Across my whole book, where am I most concentrated against my limits, how is risk migrating, and which names are aggregately deteriorating, and let me drill from any of that straight into the one relationship that drives it?" The PM works concentration across the book; the Executive works concentration-vs-Tier-1+ACL, migration, and watch-list trend. The existing single-customer sections have no home for this; this tier sits *above* the 360, and the drill pillar runs upward into it, not only downward from it.

**Conclusion.** The tier does not render a concentration grid. It **concludes where the book is most exposed and how it is moving**, leading with the one bucket closest to a limit and the one migration trend that matters. For a PM/Executive book containing Piedmont:

> "Your sharpest concentration is single-key-person-guaranty exposure: several watch-grade credits, Piedmont among them, rest the full facility on one individual's guaranty. By NAICS, manufacturing (332710) is your second-densest bucket. Grade migration is mildly adverse this quarter: 2 net downgrades, watch-list up by 1. No bucket is over its limit, but key-person-guaranty concentration is the one to watch as those credits thin."

Each conclusion is **a bucket, its measure against its limit, and its trend**, not a static percentage. For the Executive the measure is concentration as a live percentage of Tier 1 + ACL with proximity-to-limit and breach flags (OCC Concentrations of Credit, Bulletin 2020-90). For the PM it is concentration against internal hold limits and the aggregated deterioration feed. **Both are computed server-side, never naive-summed, honoring exposure-exclusion flags** (`Exclude_From_Account_Exposure__c` / `Exclude_From_Product_Package_Exposure__c`), the same discipline that protects the single-customer exposure number in 3.3.

The deterioration feed is the book-level twin of 3.7's EWS: net downgrades, watch-list growth, new classifieds, covenant breaches trending, utilization spikes, payment slippage, **rolled into one deterioration view with grade-drift over time**, each contributor drillable to the name that drives it. Piedmont appears here as **one contributor reached by drilling**, exactly as `PERSONAS.md` 4.7 specifies, never as the center of the Executive's view.

**Evidence and drill path.** The roll-up aggregates the same verified package and risk fields across the running user's book, drilling *down* into the single-customer 360 on every line:

1. **Concentration by bucket.** Source: `LLC_BI__Product_Package__c` exposure rollups (TCE/Outstanding) aggregated by `Account.NAICS_Code__c` / `Industry`, by grouping key (single-borrower group via the `LLC_BI__Connection__c` graph), by grade band, by officer, by collateral type. **Aggregated server-side, exposure-exclusion flags honored, never re-summed from loan tiles.** The "single-key-person-guaranty" bucket is computed from the guaranty structure (`LLC_BI__Legal_Entities__c` full-note individual guarantor joined to `LLC_BI__Connection__c` 100%-ownership), which is exactly the Piedmont shape. Drill lands on the single-customer entity/ownership section (3.2) for any contributing name.
2. **Concentration vs limit.** Source: the bucket exposure against the tenant's configured limit (`concentrationLimits` config) and, for the Executive, against Tier 1 + ACL (a tenant capital input, config-supplied, not in this sandbox; the cockpit concludes "vs limit once configured", never a hypothetical, per 8.2's no-assert-without-ground-truth rule).
3. **Grade migration.** Source: `LLC_BI__Product_Package__c.LLC_BI__Risk_Rating__c` and `LLC_BI__Loan__c.LLC_BI__Risk_Grade__c` change over time (net downgrades, weighted-average grade drift), and `LLC_BI__Relationship_Risk_Review__c.Performing_Status__c` (watch-list count). **Counted deterministically server-side, never an LLM tally** (the same fence 3.6 applies to the Executive's aggregated watch/breach counts).
4. **Aggregated deterioration.** Source: the per-relationship deterioration signal (covenant cushion thinning via `deal_covenant_grade`, utilization via afs-mcp, payment slippage) rolled to the book, ranked. Drill lands on the single-customer covenant-monitoring (3.6+) and risk sections.

The wide view is **legitimate only because Salesforce sharing grants it.** Per `VALIDATION-AND-DECISIONS.md` 4.7 and open-question 1: the roll-up rolls subordinate books up only when the tenant's OWD plus "Grant Access Using Hierarchies" actually do so (`sharingModelGrantsHierarchyRollup`); where that is false or unverified, the view collapses to the user's own book and the cockpit says so, with the partial-view marker. The cockpit presents the configured view and lets the platform enforce what they can see; it does not *claim* it is enforcing least privilege until OWD is verified.

Provenance lock: every aggregate is a deterministic server-side computation over verified fields; no concentration percentage, migration count, or deterioration score passes through the LLM.

**Actions.**
- **Drill down** from any bucket / migration line / deterioration contributor into the single-customer 360, then into the deal memo (`deal_show_summary`). The end-to-end drill (portfolio aggregate to cohort to single-customer 360 to deal memo) is the Executive's defining requirement.
- **Lens-change** the slice dimension (NAICS / geography / grade band / officer / single-borrower group / collateral type) and the limit basis (internal hold limit / Tier 1 + ACL once configured).
- **Capture-decision** at portfolio grain (PM: "add the key-person-guaranty cohort to the quarterly watch theme"; Executive owns policy-level calls but in this oversight tier acts read-only, no per-deal write).
- **Subscribe** to a breach/migration alert (a bucket approaching its limit, a new classified, a stale rating), pushed not pulled.

The Executive tier is **strictly read-only oversight, no per-deal write or approval.** The PM may propose at relationship grain (the write lands in the single-customer section, not here). All roll-ups are server-side and provenance-locked.

**Per-persona variation.**
- **Portfolio Manager** (full, concentration across the book against internal limits, the aggregated deterioration feed leading; drills to the names; proposes at relationship grain).
- **Portfolio / Credit-Risk Executive** (full, concentration vs Tier 1 + ACL once configured, migration and watch-list analytics, the book-level credit story; read-only, no per-deal write; the drill-to-evidence is the exam answer).
- **Credit Officer** (summary, concentration impact at decision time, surfaced on the single approval not the whole book; the per-deal concentration check lives in header/verdict, this tier gives the book context).
- **RM / Loan Officer** (summary, own-book concentration as relationship context).
- **Credit Analyst, Treasury, Loan Ops** — summary or hidden; the book aggregate is not their lane (Treasury's book view is the cross-sell queue, surface B, not credit concentration).

**Data anchors (provenance, with conclusions).**
- `LLC_BI__Product_Package__c` (TCE/Outstanding rollups) aggregated by `Account.NAICS_Code__c` / `Industry` / grouping key / grade / officer — the concentration spine; exposure-exclusion flags honored, never naive-summed.
- `LLC_BI__Legal_Entities__c` (full-note individual guarantor) joined to `LLC_BI__Connection__c` (100% ownership) — the single-key-person-guaranty concentration bucket, the Piedmont-shaped risk.
- `LLC_BI__Risk_Rating__c` / `LLC_BI__Risk_Grade__c` over time, `LLC_BI__Relationship_Risk_Review__c.Performing_Status__c` — grade migration and watch-list trend, counted deterministically.
- `deal_covenant_grade`, afs-mcp `revolver_utilization` / `payment_history` — the per-name deterioration signals rolled to the book.
- Config knobs: `concentrationLimits` (per-bucket limit basis), `tier1PlusACL` (the Executive's capital denominator, tenant-supplied, "vs limit once configured" until present), `sharingModelGrantsHierarchyRollup` (gates whether the book rolls up subordinates or collapses to own-book), `exposureExclusionFields`, `cockpitSectionVisibilityMap`. Every aggregate is deterministic; the LLM ranks and narrates, never sums.

---

## E. Exam / QC Provenance Pack

**Question.** "When the examiner or loan review asks, can I hand them, from the cockpit, an examiner-ready audit of this relationship: every regulated number traced Boom to Snowflake to nCino, every conclusion marked AI-proposed vs human-attested, and the decision trail showing who attested what, when, under which identity, without a weeks-long scramble?" The Officer, Ops, and Executive all need provenance and the audit trail as a deliverable, not as an implied pillar.

**Conclusion.** The pack does not dump a log. It **concludes examiner-defensibility and assembles the artifact that proves it.** For Piedmont:

> "This relationship is exam-ready. Every regulated number on the file (TCE $12.5M, DSC 1.42x/1.25x, Grade 5, ~$10M lendable, EBITDA 8.1%) carries full Boom to Snowflake to nCino lineage and a lock chip. Every conclusion is marked AI-proposed or human-attested: the cockpit drafted the verdict, a named analyst attested the spread, a named officer approved the package, all under run-as-user identity, all timestamped, none silent. One open item: KYC/compliance clearance is unverified (no rows on file), which the pack flags as a gap an examiner will ask about, not as a pass."

The pack leads with the **conclusion an examiner cares about, defensibility**, then assembles the evidence: the lineage chain, the AI-proposed-vs-human-attested split, and the append-only decision/audit trail. It is the answer to the two pain points named across roles: "the weeks-long exam scramble" and "prove the rating was independent."

The **AI-proposed vs human-attested distinction is the load-bearing one.** Under SR 11-7, the cockpit is decision-support: it proposes, drafts, ranks, frames; a human attests and commits. The pack makes that boundary visible and exportable, so the examiner sees exactly where the model's contribution ends and the banker's judgment begins. Development (the drafting agent / analyst) and validation (the reviewer agent / officer) are distinct, attributed entries; the same identity never both drafts and approves the same package.

**Evidence and drill path.** The pack assembles from the two memory stores (`EXPERIENCE-SPEC.md` §7, kept clean and never merged) plus the lineage already attached to every number:

1. **Lineage chain (the WHAT, sourced).** Every regulated figure's Boom to Snowflake to nCino provenance: the exposure rollup (`LLC_BI__Product_Package__c`), the covenant grade (`deal_covenant_grade` over `LLC_BI__Covenant2__c`, tied to the spread period via `LLC_BI__Linked_Spread_Statement_Record__c`, into the Boom line items by `accountCode`), the collateral lendable math (`Current_Lendable_Value__c`), the Boom spread (`boom_get_spread`). The lineage is the same drill a banker walks forward in 5.1; the pack exports it as a static, dated artifact.
2. **The audit trail (the WHAT, immutable).** `get_audit_trail` over the `log_audit_event` store: one append-only, identity-bound row per consequential action (attestations, writes to the system of record, state transitions, god-mode entries), each framed around the conclusion it enables. **Append-only and tamper-evident (a hash-chain is the recommended implementation, not an asserted property of the verified surface, per 7.2).** Every entry is identity-bound to the authenticated Salesforce user from the run-as-user OAuth context (the hardened `actorStamp()` discipline; the actor is the authenticated principal, never an agent-supplied parameter). A god-mode entry records both the elevated identity and the View-All flag, so an elevated write is never mistaken for an ordinary one.
3. **The decision ledger (the WHY, as context, never examiner-facing data).** `recall_decisions` surfaces the rationale alongside the artifact as **decision-support context, explicitly not promoted into the examiner-facing record** (the WHY/WHAT split, 7.1). The pack carries it labelled as judgment, so the examiner sees the bank's reasoning without it ever becoming a regulated field.
4. **AI-proposed vs human-attested split.** Each conclusion tagged: agent-proposed entries are distinct and non-agent-writable from human-confirmed entries (5.2). The pack renders the split as a column, the proof of human-in-the-loop and of development-vs-validation separation.

Empty-not-pass holds in the pack as everywhere: where KYC/compliance rows are absent, the pack reports the gap honestly ("clearance unverified, blocks decisioning") rather than presenting a clean compliance line the data does not support (8.4).

Provenance lock: the pack reports the locked floor and the trail; it adds no number and changes none. It is a read-and-export surface.

**Actions.**
- **Export** the examiner-ready pack (the lineage chain, the audit trail, the AI-vs-human split) as a dated artifact; the published examiner-facing memo is saved separately via `ncino_docman_save` (the ledger rationale travels alongside as context, never promoted into a DocMan field, 7.2).
- **Drill** any line of the pack to its source-of-source (a number to its Boom line item, an attestation to its audit row, a decision to its ledger entry).
- **Filter** the pack by date range, by actor, by action class (attestations only / writes only / god-mode only) for a targeted exam request.
- **Capture-decision** is not an action here: the pack is read-and-export; it produces no judgment, it documents it.

**Per-persona variation.**
- **Credit Officer / Approver** (full). The effective-challenge and decision-defensibility view: who attested what version, when, so a downgrade reversal is never silent. The pack is the officer's exam interface.
- **Loan Operations / Servicing** (full). The QC and audit view: the boarding/maintenance trail, the documentation/exception history, append-only for SOX-style maintenance-control exams.
- **Portfolio / Credit-Risk Executive** (full, aggregate-then-drill). The book-level exam story: provenance-as-data across the portfolio, drilling to any single relationship's pack; the answer to SR 13-1 / SR 11-7 / CAMELS readiness.
- **Credit Analyst** (summary). Sees the lineage of their own attested work (development side).
- **RM / Loan Officer, Treasury** (summary or hidden). Not their deliverable; they see that the file is exam-ready, not the trail detail.

**Data anchors (provenance, with conclusions).**
- `get_audit_trail` / `log_audit_event` — the immutable, identity-bound, append-only WHAT; the examiner's evidence; tamper-evidence (hash-chain) recommended, not asserted.
- `recall_decisions` / `record_decision` — the mutable WHY, carried as decision-support context, never promoted into the examiner-facing record.
- `ncino_docman_save` — the separately-saved published examiner-facing memo artifact.
- The lineage drill of every regulated figure (`LLC_BI__Product_Package__c` rollups, `deal_covenant_grade` over `LLC_BI__Covenant2__c` to `LLC_BI__Linked_Spread_Statement_Record__c` to Boom line items, `Current_Lendable_Value__c`, `boom_get_spread`) — Boom to Snowflake to nCino, exported static and dated.
- `KYC__c` / `Compliance_Check__c` — reported as a gap when empty (unverified), never as a clean line.
- Config knobs: `auditExportFields`, `examPackDateDefault`, `godModeAuditLabel` (the elevated-context marker on god-mode rows), `cockpitSectionVisibilityMap`. The pack reports the locked floor and the trail; it computes no number and changes none.

---

## 3.3+ Collateral-monitoring elevation

This extends `EXPERIENCE-SPEC.md` 3.3 (exposure plus collateral coverage). 3.3 concludes the **origination-time** coverage verdict: "~$10M lendable vs $12.5M committed, 80% coverage, 1st lien, fully secured on the outstanding." The monitoring lens adds the **ongoing-time** verdict: coverage is not a fact you establish once, it is a number that drifts, and stage 06 watches the drift.

**The added conclusion.** Beside 3.3's static coverage, the monitoring lens concludes **what is moving and what is due**:

> "Coverage was ~$10M lendable at origination, but the PMSI valuation on the 3 Mazak machines is 14 months old, past the 12-month staleness window, so the lendable number is drifting on stale inputs. Order the revaluation before the next covenant test, because the spread and the collateral both feed the credit picture the test relies on."

The four monitoring conclusions the lens adds:
1. **Revaluation due / stale.** The appraisal age against the staleness window: "this valuation is N months old, past/within the window", the same conclusion the Work Queue (A) carries as a tickler, here shown in collateral context with the coverage consequence.
2. **Advance / lendable drift.** Lendable value moves when the underlying asset value moves or the advance rate changes; the lens concludes the *direction and size* of the drift since the last valuation, not just today's number.
3. **Coverage erosion.** Coverage-on-committed and coverage-on-outstanding (3.3's 80% vs >100% toggle) re-read against today's lendable; the lens flags erosion *before* it crosses a policy line, the collateral twin of covenant breach-trending.
4. **Perfection expiry.** UCC continuation, insurance, flood, each with its regulatory clock; an expiring UCC silently un-perfects the lien, so this is a coverage conclusion, not a paperwork one.

**Evidence and drill.** Valuation freshness from `LLC_BI__Collateral_Valuation__c.LLC_BI__Valuation_Date__c` / `LLC_BI__Value__c` against `collateralRevaluationMonths`; lendable drift from `LLC_BI__Loan_Collateral2__c.LLC_BI__Current_Lendable_Value__c` (value times advance rate) compared across valuations, **excluding `Abundance_of_Caution__c` / `Is_Excluded__c` exactly as 3.3 does**; perfection/expiry from the collateral and account-collateral perfection fields. Every figure deterministic and provenance-locked; the lendable math is never recomputed naively, the drift is the difference of two sourced lendable values. Drill runs into 3.3's existing asset-to-valuation-to-ownership chain and into the Work Queue tickler.

**Actions.** Order a revaluation (stage the action for a human, the same revaluation tickler the queue surfaces); annotate ("PMSI Mazak appraisal 14 months old, order revaluation", the exact 3.3 annotation, now driven by a computed staleness flag); capture-decision ("accept stale valuation for one cycle given wide coverage on the outstanding"); set a watch on coverage erosion. Decision-support; no figure edited.

**Per-persona.** Loan Ops owns the perfection/expiry and revaluation-due conclusions (the servicing clock); PM owns the coverage-erosion-before-the-test conclusion (the credit-quality lens); RM sees it as relationship context; Analyst reads it into the underwrite. Read-only on every sourced figure for all.

**Data anchors.** `LLC_BI__Collateral_Valuation__c` (freshness), `LLC_BI__Loan_Collateral2__c.LLC_BI__Current_Lendable_Value__c` (drift, exclusions honored), collateral perfection/expiry fields (UCC/insurance/flood clocks). Config: `collateralRevaluationMonths`, `coverageErosionThreshold`. Same locked floor as 3.3; the monitoring lens adds time, never a new number outside the deterministic engine.

---

## 3.6+ Covenant-monitoring elevation

This extends `EXPERIENCE-SPEC.md` 3.6 (risk plus covenant compliance). 3.6 concludes the **point-in-time** verdict: "all four Compliant today, DSC 1.42x vs 1.25x is the binding one, the thinnest cushion at ≈14%." The monitoring lens adds the **forward** verdict: a covenant that is compliant today can fail next quarter, and stage 06 watches the trajectory, not just the snapshot. 3.6 already gestures at this ("the question is the next two quarters, not this one"); the monitoring lens makes that the explicit conclusion.

**The added conclusion.** Beside 3.6's binding-covenant verdict, the monitoring lens concludes **when the next test is and where the cushion is heading**:

> "DSC tests next quarter on the refreshed spread. It is Compliant today at 1.42x against 1.25x, a 0.17x cushion (≈14%, the fixed convention), but it is thinning: the cushion was wider last cycle and EBITDA margin compressed from ~11% to 8.1%, which is the lever directly under DSC. Project the trend and another point of margin slippage puts the thinnest covenant at the line. This is a watch, not a breach, and the watch has a date: schedule the conversation before the test, not after."

The three monitoring conclusions the lens adds:
1. **Next-test tickler.** When each covenant tests next, from `LLC_BI__Frequency__c` plus the last evaluation (computed or config-mapped next-eval date, never an unverified field name, the same provenance discipline as surface A). The binding covenant's next test is the headline.
2. **Cushion trend, not just cushion.** 3.6 gives today's cushion (normalized percent-of-threshold, DSC 13.6%). The lens gives the *direction*: is the cushion widening or thinning across `LLC_BI__Covenant_Compliance2__c` history, and at what slope? The trend is what turns "Compliant" into "Compliant but heading the wrong way."
3. **Breach-trending before the test date.** The forward conclusion: given the margin trajectory (Boom) feeding the DSC actual, where does the cushion land at the next test? **This projection is framed as a watch signal, ranked and surfaced, never as a computed future grade** (the grade is `deal_covenant_grade` on actuals only; a projected breach is a watch card, not a regulated number). The SR 11-7 fence: the projection ranks and warns, it does not pre-compute a grade or feed one.

**Evidence and drill.** Today's actuals from `LLC_BI__Covenant2__c` (threshold `LLC_BI__Financial_Indicator_Value__c`, actual `LLC_BI__Last_Evaluation_Value__c`, status, type, frequency); the trend from `LLC_BI__Covenant_Compliance2__c` per-period history; the driver from Boom (`boom_get_ratios` / `boom_get_spread`, the margin compression that moves DSC), tied via `LLC_BI__Linked_Spread_Statement_Record__c`. **The grade and the cushion are deterministic `deal_covenant_grade` output on sourced actuals; the trend slope is a deterministic server-side computation over the compliance history; only the ranking of the watch is the learned layer.** Drill runs into 3.6's existing covenant-to-spread-period-to-Boom-line-item chain and into the Work Queue next-test tickler and the Event feed EWS fire.

**Actions.** Set a covenant-watch reminder keyed to `LLC_BI__Frequency__c` (the real cadence, the exact 3.6 action, now anchored to the next-test date); subscribe to early-warning when the cushion drifts toward the watch band (`watchThresholdPct`); capture-decision (the rating-call WHY, with a revisit trigger like "re-open if DSC cushion thins below 1.30x", the exact ledger pattern from §7.1); draft the watch-memo paragraph. The forward projection stages a human conversation before the test; it commits no credit action and the DRAFT-until-committee banner persists.

**Per-persona.** PM owns the breach-trending-before-the-test conclusion (catch it in-quarter, not at next annual review, the 4.2 requirement); RM reads it as the one-sentence watch verdict and the conversation-to-schedule; Analyst reads the trend into the underwrite and files adjustments; Credit Officer reads the trajectory to test the rating call; Executive sees the aggregated count of covenants-trending-to-breach (deterministic, never an LLM tally, the same fence as 3.6). Read-only on sourced figures for all but the analyst's adjustment records and the officer's approval.

**Data anchors.** `LLC_BI__Covenant2__c` (today's actual/threshold/status/frequency), `LLC_BI__Covenant_Compliance2__c` (the per-period trend), `deal_covenant_grade` (deterministic grade and cushion, never the LLM), Boom (`boom_get_ratios` / `boom_get_spread`, the driver), `LLC_BI__Linked_Spread_Statement_Record__c` (the tie). Config: `watchThresholdPct` (promotes thin-but-compliant to a watch and to an EWS fire), next-test cadence from `LLC_BI__Frequency__c`. Same locked floor as 3.6; the monitoring lens adds the next-test date and the cushion trend, both computed, and ranks the watch; it never projects a grade as a number.

---

## Closing: the maintenance half holds the same bar

Every surface above is the same contract as 3.1 to 3.7: **conclude, do not display; conclusion plus drill plus action, every element; grounded in Piedmont's real data; regulated numbers deterministic server-side, never LLM-computed.** What changes in stage 06 is the axis. The single-customer sections conclude *state*; the maintenance surfaces conclude *time and book*: what is due, what changed, what we booked vs approved, where the book concentrates, and what an examiner will ask. The three through-lines run all the way through: KYC gets a refresh tickler and an empty-not-pass gate, collateral gets a revaluation tickler and a coverage-drift watch, covenants get a next-test tickler and a breach-trend watch. The fences hold unchanged: self-learning ranks the queue and the events but computes no date and no count; memory warms the next session but sources no figure; DRAFT-until-committee gates every write; run-as-user is the floor on every roll-up; the two mutating credit verbs are never maintenance buttons. The cockpit that proves the relationship in 3.1 to 3.7 is the same cockpit that keeps it, for the rest of the facility's life.
