# Customer 360 — Road to Success (v2, 2026-08-22)

Plan of record. v1 scoped with Fabian 2026-08-20; v2 reconciles the program timeline from the
2026-08-20 management-support meeting (Fabian, Alexis, Lisa, Jon) and Alexis' PMO tasks.
Non-negotiables, in Fabian's words: **both surfaces spotless, literally NO ROOM for errors**
(career-shaping); "Disney on Ice", the sophisticated base brought to 100, ideally 110; full
credit-memo-pattern policy layer; full KYC stage/approve loop; **C360 is the flagship**.

## The date ladder (program-aligned)

| Date | Milestone | Meaning |
|---|---|---|
| Aug 22 (Sat) | Road to Success shared | this document, v2 |
| Aug 24 (Mon) | Kickoff with support (Alexis, Jon, Jordan?, Noland on arrival) | support split agreed (below) |
| Aug 21-24 | WS0.5 Apex action wave | tools refined on proven mechanics |
| ~~Aug 23-27~~ | ~~WS1 KYC loop~~ — REMOVED from scope 2026-08-27 | ~~G1~~ |
| Aug 21-29 | WS2 gateway + ledger + policy pack (Jon) | G2 |
| Aug 27 - Sep 1 | WS3 Cowork natural chat | G3 |
| **Sep 1** | **Internal feature freeze** | from here: fixes, polish, rehearsal only |
| **Sep 4** | **Demo walkthrough for Steph** (working demo only; gateway hosting may trail) | G4 |
| Sep 4-11 | UAT / stress test with 3-4 SF+nCino integration testers (not bank testers) | fixes only; Sep 7 = US Labor Day |
| Sep 5-15 | Finetuning window incl. UI polish pass (intent-gated) | |
| Sep 10-11 | Hardening + gateway registration complete | |
| **Sep 11** | **Hard freeze** (Sep 13 Sunday = absolute fallback) | |
| **Sep 14** | **Absolute lock. No material changes after this point.** | |
| Sep 15-16 | Dreamforce, SPIN booth, Demo 2 | |

## Meeting decisions baked in (2026-08-20)
- Commercial framing stays (infrastructure could serve wealth; not repositioned).
- Sep 4 requires a working demo only; AWS MCP gateway wiring/hosting proceeds in the background.
- **Spreading + credit memo surface in C360 as CALL-OUTS to Noland's credit-memo plugin**
  ("generate spreading", "draft credit memo" client actions) — never rebuilt.
- Early-warning trackers OUT of scope for this deployment.
- UI reactivity work aligned with Debra's team methodology/standards (polish pass, post Sep 4).
- UAT = integration-pattern experts, Sep 4-11.
- Agent methodology content (covenant review, collateral testing ways-of-working): lift what nCino
  ships (mechanics + cadence, per NCINO-PROCESS-ALIGNMENT-DRAFT.md) + policy pack for the
  judgment nCino does not cover (cure periods, waiver authority, revaluation triggers, escalation).

## Support split proposal for Monday kickoff
| Who | Takes | Why |
|---|---|---|
| Fabian (Archy seat) | WS0.5, WS1, WS3, WS4, org writes, rehearsals | owner; org auth |
| Jon (Banksy seat) | WS2: gateway integration, decision ledger, policy pack substrate, Snowflake call | gateway+data native (fnma-mcp, Snowflake ontology, AgentCore memory) |
| Noland (on arrival) | Credit-memo call-out wiring (C360 → credit-memo plugin actions); second pair of eyes on plan; booth identity setup (UserRole + permsets for any demo user) | owns the credit-memo plugin |
| Alexis | UAT tester lineup + schedule (Sep 4-11), PMO tracking, Steph walkthrough logistics | offered; owns timeline |
| Jordan (if available) | Codex adversarial review coordination + UAT execution | TBD with Fabian |

## The two seats

| Seat | Who | Owns |
|---|---|---|
| **Archy** (org seat) | Fabian's Archy sessions | nCino org writes + verification, cockpit + both surfaces, publish pipeline, KYC cockpit wiring |
| **Banksy** (data seat) | **Jon Taylor** (jon@claudeeshannon.com, gh jon883) + Fabian's Banksy sessions | IDB gateway integration, decision ledger + audit trail, Snowflake decision, policy pack |

Lane rationale (evidence, 2026-08-20): Jon built `cowork-offering/fnma-mcp` (16-API MCP server +
dashboard widgets), co-owned the Snowflake data-domains/ontology task (done Aug 8), and drove the
credit-memo AgentCore-memory/gateway decisions. He is a gateway+data native. Confirm lane with Jon
at kickoff; this doc assumes it.

Seat rules: sf CLI auth to `bankinggpt` stays Archy-only. If Jon needs org access it is a
deliberate, named new auth, never improvised. Cross-seat memory = Banksy brain
(`/opt/brain/knowledge/projects/customer-360/` + ontology + brain-write events). Every material
decision gets a brain-write `decision` event AND lands in this repo's knowledge tree.

## Workstreams and dates

### WS0 — Re-establish truth (Aug 20-22) · Archy · GATE G0
The §4 verification campaign in HANDOVER-2026-08-20 (steps 0-5; step 6 = Fabian's browser).
Evidence table or it didn't happen. Nothing below builds on unverified ground.
**G0 pass = org intact, suite green, reads live, mod + bulk staging observed.**

### WS0 RESULT (2026-08-20): **G0 PASSED** — receipts in EVIDENCE-SEPT4.md. Highlights: suite
138/138 after fixing org-wide CDC-trigger drift; modification credit action EXECUTED LIVE for the
first time (acnpex_CreditActionRequest → clone + junction observed on Hartwell, rolled back clean);
nCino process research done (NCINO-PROCESS-ALIGNMENT-DRAFT.md, 39-entry danger register).
Fence change by Fabian 2026-08-20: sandbox approval emails are acceptable, incl. the covenant
outlook address. Step 6 (artifact golden path in Fabian's browser) still pending.

### WS0.5 — Apex action wave (Aug 21-24) · Archy · feeds G1/G3
Scope fixed by the G0 findings + process research. All changes wire-probed, suite-covered
(armCalloutMock), envelopes archived:
1. **execute_loan_modification** — token-gated wrapper over the PROVEN mechanics: consume staged
   plan → acnpex_CreditActionRequest (sync) → verify clone + junction by re-query → apply staged
   changes to the CLONE (Qualification) → report. Never touches the parent.
2. **Covenant review rebuild (package-scoped bulk)** — per nCino lifecycle: N compliance
   assessments under ONE plan/token; traversal unions loan AND account junctions (dedupe);
   status precondition (only Pending → terminal advances the schedule); add `Waived` to the
   allowlist; write the value to `LLC_BI__Historic_Financial_Indicator__c` (double, org-verified)
   alongside our cm_ audit field; STRUCTURAL guard against the auto-next-row trap (never assume
   no frequency template — check, warn in plan, and never touch Effective Date in a status
   transaction: PDI-00023403 is OPEN).
3. **Collateral valuation hardening** — explicit `productPackageId` anchor; items[] cap 20
   (CDC-trigger queueable math: 24 triggers × per-record enqueue vs limit 50); `valuationDate`
   required (nCino names it as the latest-valuation determinant).
4. **Precondition checks for demo identities** — UserRole + Credit Actions Delete permset probe
   for ANY user who will drive the demo (Noland at the booth).
5. **Exception display correction** (cockpit): Exception ≠ breached; render administrative vs
   financial exception honestly (org data: 101/140 Exception rows carry no measured value).
6. Re-verify `Stages_Renewal_Allowed` post-Aug-14 upgrade before any renewal work.
Wave gate: suite green, envelopes for every new shape, danger-register items 1-6 closed or
explicitly deferred with reason.

### WS0.5 RESULT (2026-08-22): CLOSED, two days early. All 7 items + 2 consequences shipped and verified:
execute_loan_modification (wire-proven, manifest 24), package-scoped bulk covenant review + hardened
valuation (177/177 Apex across 13 classes, probes residue zero), plugin packaging 0.4.3, demo identities,
renewal property check, cockpit Exception classifier + mod-execute unhold + adaptation to the new shapes
(1,483/1,483), both artifact URLs republished with explicit 23-tool manifest (D3 closed). Demo beat
rehearsed on Hartwell through our own tools. Decision surfaced to Fabian: execute_covenant_review is now
UNHELD in the cockpit (org guards intact) since the email fence was relaxed; re-hold is one line if wanted.
Evidence: EVIDENCE-SEPT4.md + ws05-side-findings*.md.

### WS1 — KYC loop · REMOVED (Fabian, 2026-08-27)
**Decision of record: KYC is removed from Customer 360 scope entirely. C360 core only.** This
supersedes the 2026-08-25 downgrade-to-stretch — the lane is not deferred, it is out of scope, and
G1 is struck as a gate. Executed 2026-08-27 on branch `remove-kyc`: the cockpit's KYC & Onboarding
zone, its five tabs, the onboarding write-action flow and the new-onboarding wizard are deleted, and
the plugin now routes any KYC ask as out of scope rather than as "coming later".

Deliberately kept: the never-claim guards (the cockpit and the agent still refuse to render a KYC
cleared state, because no source exists), and the archived gateway KYC read observations under
`knowledge/sf-build-v2/gateway/` — evidence of what was probed on 2026-08-25, not a live plan.

### WS2 — Gateway + policy layer (Aug 21-29) · Jon/Banksy · GATE G2
Bake C360 into the IDB gateway the credit-memo way:
1. **Decision ledger + audit trail** — record_decision / recall_decisions / log_audit_event
   equivalents keyed on the relationship (Hartwell), so a session opens WARM ("last cycle the team
   held grade 4 because…"). Store: Jon decides Snowflake vs the gateway's own store — his call to
   make by Aug 25, criteria: demo-reliable > architecturally pure.
2. **Policy pack** — credit policy + KYC policy documents the agent reasons against when analysing.
   This is the substrate for Fabian's vision: agents that think and analyse based on policies.
   Format: markdown policy docs served through the gateway (or bundled), each with citable section
   ids so analysis can quote chapter and verse.
3. **Policy-aware analysis moment** — one flagship demo beat: "assess Hartwell against policy" →
   agent pulls covenants + exposure + KYC state, reasons against the policy pack, cites sections,
   flags the 7bps FCCR cushion. SR 26-2 framing (decision-support, human decides).
**G2 pass = ledger round-trips (record → recall), policy analysis produces a cited assessment.**

### WS3 — Cowork natural chat (Aug 27 - Sept 1) · Archy, Jon reviews · GATE G3
Plugin v0.5.0: skill prose rewritten to the real 24 tools, command routing for natural chat
("show me Hartwell", "stage the increase to 20M", "run the KYC checks", "assess against policy"),
assemble-cockpit refreshed, marketplace bump. The plugin is the natural-chat front door; the
cockpit renders the same bundle.
**G3 pass = a cold Cowork session with the plugin installed handles the demo conversation end-to-end.**

### WS4 — Artifact parity (continuous, freeze Sept 1) · Archy
Every cockpit change ships to both artifact URLs same-day via the one pipeline
(assemble-artifact.mjs, QA gate, byte-verify). No divergence between surfaces, ever.

### WS5 — Perfection pass (Sept 1-4) · both seats · GATE G4
- **Sept 1: feature freeze.** After this, only fixes.
- Codex adversarial review of the full delta (wire payloads, guards, prose).
- Fabian click-through on BOTH surfaces, every action.
- The printed beat rehearsed ×3 with stopwatch: email arrives → sync → CLIENT REQUEST →
  suggestion → prefilled package-anchored ticket → staged plan → approve. Timings recorded.
- Evidence pack: every gate's receipts in one doc.
**G4 pass (Sept 4) = both surfaces demo the full arc without a single error. Then finetuning only.**

## Backlog (explicitly NOT before Sept 4)
- **Agentforce integration** (Fabian, 2026-08-20: explore as backlog item).
- Mod/renewal EXECUTE unblock (design decision; LV06 wall is by design).
- Covenant execute first live run (founder-gated, fires real email).
- Renewal clone re-probe (⚠️ required before execute_renewal is EVER considered).
- Voice (belongs to Demo 1).

## Execution flow (how two seats stay coherent)
1. This doc is the plan of record. Changes to it = commit + push + Banksy brain sync.
2. Daily: each seat ends its working session with a brain-write `context` event on its box
   (Banksy events reach `/opt/brain`; Archy events reach the Connectry brain) + repo knowledge
   update when material.
3. Gates are named G0-G4; a gate claim requires receipts in `knowledge/EVIDENCE-SEPT4.md`
   (created at G0).
4. Blockers surface to Fabian same-day, never sat on.
5. Jon kickoff: Fabian intros; Jon reads STATUS.md → HANDOVER-2026-08-20 → this doc →
   DREAMFORCE-SPIN-CONTEXT.md, then confirms or renegotiates the WS2 lane.

## Risks, named
- **Shared sandbox drift** (bankinggpt): mitigated by G0 now + re-smoke at freeze.
- **Both-surfaces scope**: mitigated by WS4 single-pipeline parity, not double builds.
- **IDB staging env stability**: unknown uptime; WS1/WS2 archive envelopes so baked fallback data
  stays honest if staging wobbles on demo day.
- **Booth network**: live org + M365 + gateway calls need connectivity; rehearsal must include a
  fallback story (baked bundle) — decide at G4 whether fallback is armed.
- **Jon ramp time**: the knowledge tree is the mitigation; it is complete and indexed on Banksy.

## Doctrine addendum (Fabian, 2026-08-20): aggregation-first, package-anchored — EVERYTHING

nCino's container is the Product Package, and every action operates on the PP (or relationship)
AGGREGATE. Single loans, single covenants, single collateral are MEMBER SELECTIONS inside the
container, never standalone anchors. A banker reviews the covenant package of a PP, values the
collateral pool of a relationship, modifies facilities within a package — not items in isolation.

Audit vs this doctrine (2026-08-20): mod/renewal, new facility, annual review, risk rating,
service request ✅ aligned. Gaps to close in the build block: (1) stage_covenant_review is
single-compliance-row — rebuild as package-scoped bulk (all covenants, one plan, one token,
per-covenant assessments as items); (2) stage_collateral_valuation gets an explicit
productPackageId anchor. Same wave as execute_loan_modification, BEFORE chat prose (WS3).

## UI polish pass (Fabian, 2026-08-20) — scheduled Sept 5-15 finetuning window, NOT before
Expectation: real-React feel — skeleton loaders, smooth zone transitions, live sync progress,
Accenture-branded shell (logo). Explicitly not prio before Sept 4. Process: design-intent gate
first (one concrete branded mock, Fabian picks, THEN build). Rides the normal publish pipeline
to both surfaces.

## Plugin parity with credit-memo-reinvented (measured 2026-08-22, folds into WS3)

Already true: repo is in cowork-offering; marketplace serves `client-360` 0.4.2 from repo root.
Delta vs the credit-memo plugin (`credit-memo-agent/` subdir, 14 guided skills, 2 agents,
brand assets, intentionally-empty .mcp.json + RUNBOOK prerequisites):

| # | Item | Effort | When |
|---|---|---|---|
| 1 | Isolate plugin into `client-360/` subdir (plugin.json, skills, agents, assets incl. bundled template + live-data, render, README, RUNBOOK); marketplace path → subdir; assemble pipeline copies template into `client-360/assets/`. Stops shipping `app/` + 11MB `knowledge/` to every installer | 0.5 d | Mon Aug 24 (low risk, mechanical) |
| 2 | `.mcp.json` intentionally empty + RUNBOOK §2 prerequisites (Customer 360 Salesforce MCP connector, Microsoft 365, IDB Gateway, Boom) — same connector-model doctrine as credit memo | 0.25 d | with #1 |
| 3 | `agents/credit-360.md` — the banker's counterpart: persona, command routing table (open cockpit / client request → action / covenant review / collateral / KYC / policy assessment / credit-memo call-out), fences | 1 d | WS3 |
| 4 | Skills split into guided workflows matching the credit-memo pattern: open-cockpit, client-request-to-action, covenant-review (package-scoped), collateral-valuation, kyc-checks, policy-assessment, credit-memo-callout (invokes the credit-memo plugin, never rebuilds) — prose written against OBSERVED tools (after WS0.5) | 2 d | WS3 |
| 5 | Brand assets reused from credit-memo (accenture-logo.svg, brand-tokens.css) for visual consistency | 0.25 d | polish pass |
| 6 | Plugin-level smoke test (assemble-cockpit from live-data → validate) like credit-memo `test/` | 0.25 d | WS3 |
| 7 | Version 0.5.0 + marketplace bump | 0.1 d | G3 |
Total ≈ 4.5 dev-days, inside the WS3 window; #1/#2 pulled forward to Monday.

## Strategic lanes added 2026-08-26 (Fabian, committed direction: "we will not fail on this")
1. THE MODIFICATION WORKROOM (Sept 1): conversational composer that COMMITS — spec in
   DESIGN-MOD-WORKROOM.md, mock in co-design, wiring Aug 27-31. The flagship interaction.
2. PORTFOLIO EXECUTOR (backlog, post-Sept): agents redeem human-approved tokens at scale
   (book-wide covenant reviews, mass revaluations, maturity waves); agents execute, never approve;
   org isAsync for large trees; natural Agentforce landing zone.
3. KNOWLEDGE OVERLAY as product (backlog): base skills (shipped) + org overlay (the discovery +
   process-alignment method, repeatable per client org) + bank overlay (policy pack, WS2 first
   instance). Layers 2+3 are the recurring commercial engine.
