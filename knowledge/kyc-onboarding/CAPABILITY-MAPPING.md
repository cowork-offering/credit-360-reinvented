# Merged Dreamforce Pitch — Capability Mapping + Harmonization Feasibility

**Aethon Wealth Advisor (their team) × Commercial Credit / Customer 360 MCP fleet (our team)**
Assessment date: 2026-07-12 · Direction: **commercial-first** (wealth second); their surface patterns mount on our commercial spine.
Author: research pass over both asset sets. Every "we have it" claim cites a file/tool; anything I could not verify from source is marked **UNVERIFIED**.

---

## 0. Grounding — what each side actually is

**Theirs (Aethon)** is two things wearing one brand:
1. A **C-suite pitch microsite** (Vite/React SPA, GSAP scrollytelling; 4 routes home/value/architecture/accelerator). Pure narrative asset — no live demo wired (`#demo` / `#contact` are placeholders). Source: `WEBSITE-ANALYSIS.md`, `extracted-site-*.txt`.
2. An **as-built advisor portal** (React 19 + Next.js App Router; `/api/chat`, `/api/voice-session`, `/api/voice-actions`, `/api/analysis/book`, `/api/documents/evaluate`; `salesforce-mcp-client.ts`; LiveKit + ElevenLabs + Simli avatar voice tab; Claude Opus/Sonnet via **AWS Bedrock**; FSC behind a **hosted MCP** exposing sobject-reads / sobject-mutations / invokeflows). Source: `extracted-aethon-asbuilt.txt`.
   - Governance marketing ("Agentforce governance / Einstein Trust Layer") **diverges from as-built** (Agentforce marked *Available*, not *In Use*; real controls are FSC Sharing/FLS/Shield/Audit via hosted MCP). `WEBSITE-ANALYSIS.md` flags this as the thread not to let a technical audience pull.
   - KYC/onboarding is **aspirational across all their assets** — first-use-case options in the accelerator, not built product. Their portal is advisor-facing; nothing client-facing exists.

**Ours** is a **built, verified MCP fleet** on the `bankinggpt` sandbox (FSC + nCino co-resident), commercial-banking, deal-level + relationship-level:
- **Customer360 SF-hosted MCP** — 8 read-only Apex `@InvocableMethod` tools deployed live to `bankinggpt`, invoked against real Piedmont data (`HANDOVER-2026-07-01.md §1`; tools: `Customer360Snapshot/RelationshipGraph/Exposure/Covenants/Opportunities/StructuralSignals/Portfolio/SearchAccounts`).
- **experience-mcp** — cross-source join + governance + nCino write path + decision ledger/audit (Snowflake). 12 registered tools incl. `deal_covenant_grade`, `deal_show_summary`, `ncino_docman_save`, `ncino_submit_for_approval`, `ncino_approve_package`, `ncino_publish_credit_memo`, `ncino_sync_memo_sections`, `ncino_finalize_credit_memo`, `record_decision`, `recall_decisions`, `get_audit_trail`, `log_audit_event` (`experience-mcp/src/tools.js`).
- **boom-mcp** — spreading engine, compute-on-read ratios + **Financials widget** (`boom_get_spread/get_ratios/show_spread`; `boom-mcp/widget/{financials,metric,portfolio}.html`).
- **afs-mcp** — servicing: `revolver_utilization`, `payment_history`, `loan_summary`, `reserve_obligation_number`, `create_workpackage`, `portfolio_by_officer`.
- **credit-memo-reinvented** — orchestrator agent + reviewer agent + **14 skills** = the 10-step underwriting framework (`collateral-valuation`, `compliance-due-diligence`, `credit-binder`, `credit-review`, `decision-notice`, `finalize-and-writeback`, `loan-setup`, `policy-exceptions`, `pricing`, `risk-rating-analysis`, `spreads`, `sr-11-7-model-risk`, `terms-and-covenants`, `commercial-credit-memo`).
- **customer-360-reinvented** — the relationship cockpit as a **Cowork artifact** (`artifact/customer-360-template.html`, 1605 lines, real; skill `credit-360-cockpit/SKILL.md`; agent-fetches-then-injects `window.C360_DATA`, `sendPrompt` loop). Ownership graph, exposure & collateral, covenants, whitespace, EWS, "Explain this" panel.
- Deal-level widgets in experience-mcp: `deal-summary.html`, `finalize.html`.

The single most load-bearing architectural fact on our side (`HANDOVER §3`): **SF hosted MCP is per-user OAuth+PKCE only** — no server-to-server on-behalf-of. So the agent connects to Customer360 directly as the authenticated user and passes data into the widget. This is *the same identity honesty* their as-built has (hosted MCP, per-user OAuth), which is a shared-story asset, not a tension.

---

## 1. Component-by-component map

Classification key: **EXISTS** = we have the direct counterpart, built. **ADAPT** = we have the spine, needs commercial re-skin/extension. **BUILD** = net-new. **SKIP/DEFER** = not worth building for Dreamforce.

| # | Their component | Class | Our counterpart / what it takes |
|---|---|---|---|
| 1 | **Daily brief / book monitoring** ("background agents monitor the whole book; drift, funding, estate events flagged early") | **ADAPT** | We have `Customer360StructuralSignals` (modification clustering, renewal/maturity proximity, guarantor distress) + `deal_covenant_grade` + AFS `revolver_utilization`/`payment_history` + the Work Queue/Tickler + Portfolio roll-up design (`USE-CASE-CATALOG` PM-1 "morning book-health triage", EX personas). The *engine* exists; what's missing is a **standing "daily brief" render** — the wealth "advisor's day rebuilt" panel → RM/PM morning triage panel. The data and deterministic urgency scoring are designed (`EXPERIENCE-SPEC §5.1`); the always-on brief surface is not yet a built widget. |
| 2 | **Chat orchestrator w/ Salesforce reads + writes** (`/api/chat`, `salesforce-mcp-client.ts`) | **EXISTS (stronger)** | This is our core. Claude client → Customer360 MCP (reads, run-as-user) + experience-mcp (writes: `ncino_docman_save`, `ncino_submit_for_approval`, `ncino_approve_package`, `ncino_sync_memo_sections`). Ours is arguably ahead: gated/audited writes, SR 11-7 deterministic wall, decision ledger. Theirs runs Claude via Bedrock; ours runs in Claude/Cowork hosts natively. |
| 3 | **Voice tab w/ avatar** (LiveKit + ElevenLabs TTS + Simli avatar; `/api/voice-session`, `/api/voice-actions`) | **BUILD (THEATER)** | **Zero equivalent in our stack** (grep for livekit/elevenlabs/simli/avatar/voice-session = empty). Net-new, and high-effort (Python voice agent, WebRTC room, avatar rig). Judgment: **demo theater** — high wow, low substance, and off-thesis for a commercial-credit audience (an RM does not want an avatar; a credit officer wants an audit trail). See §4 THEATER. |
| 4 | **Document evaluation pipeline** (`/api/documents/evaluate`, Sonnet doc eval) | **ADAPT** | We have adjacent pieces: Boom ingests financials (the `Piedmont_..._Financials_FY2023-2025.xlsx` → spread), and the `compliance-due-diligence` skill. We do **not** have a generic "drop a document, extract + evaluate" intake endpoint. For commercial, the equivalent is **borrower financial-statement intake → Boom spread** and **KYC document intake → beneficial-ownership/OFAC evaluation**. The spreading side is effectively built (Boom); the intake-and-classify front door is BUILD-lite. |
| 5 | **Onboarding-compression use case** (20d→<24h, automated KYC routing, parallel doc workflows) | **ADAPT** | Commercial equivalent = **borrower onboarding: intake → KYC/beneficial-ownership via the relationship graph → parallel doc collection feeding Boom spreading**. We have the graph (`Customer360RelationshipGraph`, `LLC_BI__Connection__c` 208 edges), the KYC gate design (`relationship_kyc`, `compliance-due-diligence` skill), and the spread. Missing: the **client-facing intake trigger** and the parallel-workflow orchestration render. See §2.2. |
| 6 | **Compliance queue triage use case** (KYC/AML screening, proactive flags, audit trail) | **ADAPT (mostly EXISTS)** | Commercial equivalent = **covenant-breach + KYC-refresh + collateral-perfection queue**. We have this designed in depth: BSA/Compliance persona (`USE-CASE-CATALOG §7`, 7 use cases), CDD refresh staleness clock, OFAC gate, `get_audit_trail`/`log_audit_event`, immutable ledger. The triage *logic and audit* exist; the **queue UI** is the Work Queue/Tickler design not yet rendered as a shipped widget. |
| 7 | **Meeting-prep use case** (AI brief per meeting: portfolio summary, life events, tasks, NBA) | **EXISTS (as design), ADAPT (as surface)** | Commercial equivalent = **RM annual-review / pre-meeting portfolio brief** (`USE-CASE-CATALOG` RM-1 "walk into the annual review already prepared"). The cockpit header verdict (`EXPERIENCE-SPEC §4.1`) *is* the meeting brief: rating, exposure, watch item, NBA in one sentence. Rendered today via the customer-360 artifact. Needs packaging as a "brief" entry point. |
| 8 | **The 5-layer architecture frame** (Engagement / Agency / Work / Context / Record) | **EXISTS (maps 1:1)** | `WEBSITE-ANALYSIS` already found this: Engagement = Cowork/Claude clients + widgets; Agency = orchestrator agent + skills; Work = deterministic MCP tools (Boom ratios, covenant grade, renderer); Context = Boom/AFS/Snowflake/CapIQ; Record = Salesforce (nCino + FSC) + AFS. We can present the merged architecture **in their vocabulary with zero rebuild**. Cheap alignment win. Our `ARCHITECTURE-MCP-FLEET.md` is the same story with more rigor (SR 11-7 deterministic wall, run-as-user OAuth, god-mode seam). |
| 9 | **The value model** ($606M, 4 levers: onboarding compression, advisor productivity, compliance, contact-center deflection) | **ADAPT** | The *mechanics* port; the *numbers* must be re-derived for commercial (§5). Onboarding compression → memo cycle time; advisor productivity → RM/analyst capacity; compliance → covenant-breach early warning + exam-readiness; contact-center deflection → (weakest fit commercial-side, likely dropped or reframed as portfolio-monitoring-alert deflection). |
| 10 | **Build-vs-buy table** (DIY vs Salesforce+Anthropic across initial build / ongoing / compliance / time-to-value) | **EXISTS (reusable as-is)** | Vertical-neutral. Survives re-verticalization verbatim; only the examples change. |
| 11 | **"No rip-and-replace / headless Salesforce / trust boundary stays in platform"** doctrine | **EXISTS (identical doctrine)** | Our entire design is this (`EXPERIENCE-SPEC` pillars 2, 3, 9; run-as-user OAuth, `WITH USER_MODE`). One shared story. |
| 12 | **Delivery credentials** ("40 core CSA processes mapped", NeuraFlash + SFBG) | **ADAPT** | Our analogue is the **10-step underwriting framework = 14 credit-memo skills** + the 6-stage commercial-lending blueprint + 9 personas × 71 use cases (`USE-CASE-CATALOG`, `CAPABILITY-MAP`). This is a *stronger* credential than "40 processes mapped" because ours is built and executable, not a slideware library. |

### Prose read

The map splits cleanly. **Everything on the reasoning/governance/writeback spine is EXISTS or better on our side** — chat orchestrator, Salesforce reads+writes, the 5-layer frame, the trust doctrine, the audit ledger, the underwriting-skill library. Their as-built has an advisor portal we do not have as a *portal*, but the capability behind it (governed MCP over FSC) is exactly what we run over nCino+FSC.

**Everything client-facing and everything voice is where the real gaps are** — and those gaps exist on *both* teams. Neither side has a client-facing intake surface; theirs is advisor-facing, ours is banker-facing. The voice/avatar tab is the one thing they built that we have nothing for, and it is precisely the piece with the least commercial substance.

The use cases (onboarding, compliance triage, meeting prep) are all **ADAPT, not BUILD**: we own the deterministic engine and the persona logic for each; what we lack is the *rendered surface* that makes them demo-legible. That is the honest scope of the merge — we are re-skinning proven engines, not building new brains.

---

## 2. The commercial translation of their three wealth use cases

### 2.1 "Advisor meeting prep" → **RM portfolio / relationship brief**
- **Their version:** per-meeting AI brief — portfolio summary, recent life events, outstanding tasks, next-best-action.
- **Commercial version:** RM walks into an annual review or a borrower meeting with a one-breath relationship verdict: rating + trend, total exposure (package rollup, not naive sum), the single watch item, covenant cushions + next test dates, maturities, and the top NBA (wallet gap).
- **Carries it today:** `Customer360Snapshot` + `Customer360Covenants` + `Customer360Exposure` + Boom (`boom_get_ratios`) + AFS (`revolver_utilization`), assembled into the cockpit header verdict (`EXPERIENCE-SPEC §4.1`), rendered in `customer-360-template.html`. Use case is fully specified: `USE-CASE-CATALOG` RM-1.
- **Missing:** a "brief" entry point / packaging (today it's "open the cockpit"); "recent life events" has no commercial-data analogue and should be replaced by "recent credit events" (new spread, utilization spike, new BO edge, covenant test approaching) — all of which `Customer360StructuralSignals` + AFS already surface. **Effort: S** (repackage, not rebuild).

### 2.2 "Onboarding compression w/ KYC routing" → **commercial borrower onboarding**
- **Their version:** signed client → funded account in <24h; straight-through processing; automated KYC routing; parallel document workflows.
- **Commercial version:** borrower intake → KYC / beneficial-ownership resolution via the relationship graph → OFAC/CDD screen → parallel document collection (financials → Boom spread; entity docs → ownership edges) → deal setup (`loan-setup` skill) → underwriting-ready package.
- **Carries it today:** `Customer360RelationshipGraph` (ownership 100% Margaret Holloway from `LLC_BI__Connection__c`); the `compliance-due-diligence` skill (KYC/OFAC/beneficial-ownership/adverse-media clearance summary); `loan-setup` skill (facilities, parties, guarantors, collateral links, doc checklist in nCino); Boom for the financial-statement leg. The KYC-gate-blocks-decisioning discipline is designed throughout (`EXPERIENCE-SPEC §3.2`, RM-5, CA-6, BSA-1).
- **Missing:** (a) the **client-facing / RM-facing intake front door** — the trigger that starts the flow (this is the unresolved "client-facing surface" from `WEBSITE-ANALYSIS` Q1/Q4, a gap on both teams); (b) `KYC__c` is **empty org-wide** in the sandbox — the demo must lead with the *beneficial-ownership graph as the real KYC signal* and conclude "KYC unverified, blocks decisioning," never fake a clearance (`HANDOVER §3`, `EXPERIENCE-SPEC §3.2`); (c) the parallel-workflow *orchestration render*. **Effort: M.**

### 2.3 "Compliance queue triage w/ KYC/AML screening" → **covenant-breach + KYC-refresh + perfection queue**
- **Their version:** automated KYC/AML screening, proactive flag surfacing, full audit trail in Salesforce, runs alongside existing workflow.
- **Commercial version:** a monitoring queue that ranks the book by (covenant cushion thinning toward a not-yet-due test) + (CDD/KYC refresh due/overdue) + (UCC continuation / flood-cert / collateral revaluation clocks) + (sanctions re-screen hits), each with the audit chain attached.
- **Carries it today:** `deal_covenant_grade` (deterministic breach math); `Customer360StructuralSignals`; the BSA/Compliance persona's full 7-use-case design incl. CDD refresh staleness clock and OFAC gate (`USE-CASE-CATALOG §7`); Loan-Ops perfection-clock use cases (Ops-3 UCC/flood, Ops-4 revaluation); `get_audit_trail` + `log_audit_event` + the immutable Snowflake ledger. This is our **strongest** translation — the logic is largely EXISTS.
- **Missing:** the **queue UI itself** (Work Queue/Tickler surface, `EXPERIENCE-SPEC §5.1`, designed not shipped) and live KYC data (same sandbox caveat — lead with covenant/perfection clocks, which *are* real on Piedmont, and treat KYC-refresh as the honest-absence case). **Effort: M** (mostly a render of an existing engine).

**Net:** all three translate onto built engines. The recurring missing piece across all three is **rendered surfaces + a client/RM intake front door**, not missing intelligence.

---

## 3. Surface strategy

**The honest starting position:** their surface is a bespoke Next.js advisor portal; ours is MCP-native (Cowork/Claude clients + MCP-Apps widgets + the customer-360 Cowork artifact). Both put governed MCP behind the surface; the difference is the shell.

**Recommendation for the merged Dreamforce demo — a two-surface show, commercial-first:**

1. **Primary surface: the MCP-native cockpit in a Claude/Cowork host.** This is our built, verified path (`customer-360-reinvented` artifact + `credit-memo-reinvented` skills over the live `bankinggpt` org). It is the demo that *works today* against real Piedmont data. Lead here: open Piedmont, get the one-breath verdict, drill to Boom spread / covenant grade / ownership graph, draft the memo, write back to nCino, show the audit ledger. **This is the substance.**

2. **The portability differentiator — make it the headline, not a footnote.** MCP Apps is a **cross-host standard**: the same MCP servers + widgets render in Claude *and* ChatGPT hosts (`reference_chatgpt_work_platform`, `reference_mcp_protocol_and_apps` in memory). Their portal is one bespoke surface locked to one deployment; ours is write-once-run-in-any-MCP-host. Against a build-vs-buy audience this is the sharpest line: *"they built a portal; we built a capability that shows up wherever the banker already works — Claude, ChatGPT, Slack, and (roadmap) natively in Salesforce via AXL."* This directly instantiates their own "Engagement layer = any surface" claim, but real.

3. **Does an RM portal need to be built?** **No, not for Dreamforce.** Two options, in preference order:
   - **(Preferred) Adopt their portal *pattern* with our MCP servers behind it** only if a bespoke-web surface is judged necessary for a specific buyer. Their Next.js shell is re-pointable: swap `salesforce-mcp-client.ts`'s FSC hosted-MCP for our Customer360 + experience-mcp fleet, swap wealth copy for commercial. But note the identity constraint (`HANDOVER §3`): SF hosted MCP is per-user OAuth only, so a server-side portal calling Customer360 on-behalf-of the user is **not** a supported path — the portal would need per-user OAuth, exactly as our agent does. This is real work and **not** required for the demo.
   - **(Sufficient) Show the MCP-native cockpit as the surface.** For a Dreamforce/Anthropic/Salesforce audience, an agentic cockpit in Cowork *is* a credible, on-message surface. It is more novel than a React portal and it is what we have running.

4. **The minimal credible client-facing intake surface.** This is the one genuine BUILD if we want to claim onboarding compression client-side. Minimal version: a thin intake form (borrower name, entity, docs upload) that fires `sendPrompt` into the agent, which resolves the ownership graph, stages KYC, and kicks the spread — rendered as a single MCP-App widget, not a portal. **Effort: M.** Judgment: **SHOULD, not MUST** — the demo can run entirely banker-facing (RM opens an existing borrower) and still land onboarding compression as "here's the RM's side of a compressed onboarding." Only build the client-facing form if the pitch specifically sells client self-service.

**Bottom line:** show the MCP-native cockpit + memo + writeback against live data as the spine; frame cross-host portability as the differentiator that beats a bespoke portal; keep their portal as an optional re-skin, not a dependency; build the intake widget only if client-facing self-service is explicitly in scope.

---

## 4. Gaps ranked for the Dreamforce demo (Sept/Oct 2026)

Assumption: two builders part-time. Effort: **S** ≈ days, **M** ≈ 1–2 weeks, **L** ≈ 3+ weeks.

### MUST-HAVE (demo breaks without it)
1. **[M] The commercial "meeting brief" / cockpit entry as the opening beat.** The header verdict exists (`EXPERIENCE-SPEC §4.1`) and the artifact renders (1605-line template); package it as the demo's first screen against live Piedmont. Mostly integration + polish, not new logic.
2. **[M] The monitoring/triage queue render** (Work Queue/Tickler, `§5.1`). This is the commercial translation of their compliance-triage use case *and* the daily-brief — one surface serves both. Engine exists (`deal_covenant_grade`, `StructuralSignals`, AFS, audit ledger); the ranked queue UI does not. Highest leverage single build.
3. **[S] Re-verticalized value + architecture narrative assets** (§5) — the deck can't ship wealth numbers for a commercial demo. Content, not code, but demo-blocking.
4. **[S] Merged 5-layer architecture slide in their vocabulary** mapped to our fleet (already 1:1; needs producing). Blocks the "one bank on one spine" umbrella framing that stops us being a bolt-on slide.
5. **[S] Live-data rehearsal on `bankinggpt`** — verify the full path (fetch → cockpit → memo draft → nCino writeback → audit) runs clean end to end. `HANDOVER §5` lists "build the widget" and "stand up customer-360-reinvented" as still-open; confirm current state before demo day.

### SHOULD (strengthens, not blocking)
6. **[M] Client/RM intake widget** for onboarding-compression client-side credibility (§3.4). Only if client-facing self-service is in the pitch.
7. **[M] Onboarding-compression flow render** — intake → graph → KYC gate → parallel spread, as a visible sequence (§2.2). Engines exist; the orchestration visualization does not.
8. **[S] Cross-host proof** — the same widget rendered in both a Claude host and a ChatGPT host, screen-recorded. Cheap, and it is *the* differentiator (§3.2). High wow, real substance — rare combination.
9. **[S] Governance-honesty slide** — state plainly which controls are platform-enforced today (FLS/sharing/audit via hosted MCP, run-as-user OAuth, SR 11-7 deterministic wall) vs roadmap (Trust Layer/Agentforce/AXL). Defuses the thread `WEBSITE-ANALYSIS` warns a technical audience will pull. Protects credibility more than it adds wow.

### THEATER (high wow, low substance — judge inclusion)
10. **[L] Voice tab + avatar** (LiveKit/ElevenLabs/Simli). We have nothing; it is expensive; and it is **off-thesis for commercial credit** — the buyer wants auditability and cycle-time, not a talking head. **Recommendation: exclude from the commercial-first spine.** If their team wants the avatar in the *wealth* half of the merged demo (where it already exists and adoption-theater plays better), let it ride there as their contribution — do not spend our two builders on porting it to commercial. If a voice moment is wanted, a **voice-to-text "ask the cockpit" prompt** (no avatar) is a fraction of the effort and stays on-message, but still SHOULD-at-most.

**Ordering for two part-time builders:** 5 (verify what runs) → 3+4 (narrative, unblocks the deck) → 1 (opening beat) → 2 (the queue, biggest single win) → 8 (cross-host proof, cheap differentiator) → 9 (governance honesty) → then 6/7 if client-facing is in scope. Skip 10.

---

## 5. Narrative assets — what survives re-verticalization vs what we produce fresh

### Survives (port with example swaps, mechanics intact)
- **The build-vs-buy table** — vertical-neutral; reuse verbatim, swap examples (`extracted-site-value.txt` / `extracted-site-architecture.txt`). EXISTS.
- **The 5-layer frame** (Engagement/Agency/Work/Context/Record) — maps 1:1 to our fleet (§1 #8). Reuse the frame; relabel the boxes with our nodes (`ARCHITECTURE-MCP-FLEET.md`).
- **The value-lever *mechanics*** — "every day between X and Y is revenue on hold," "same team, larger book, no new headcount," "the fine that never happens," compounding-levers-against-a-real-book. The rhetorical structure ports; the numbers do not.
- **"No rip-and-replace / headless / trust stays in platform"** doctrine — identical to ours; one shared story.
- **Defense-in-depth guardrails narrative** — port with the honesty correction (state real vs roadmap controls per §4.9).

### Must produce fresh (commercial numbers + credentials)
- **Commercial value numbers**, replacing wealth ones:
  - Onboarding compression → **memo cycle-time compression** (e.g. underwriting/credit-memo turnaround days → hours; the 14-skill framework is the mechanism). *Numbers UNVERIFIED — must be modelled against a real book or clearly labelled illustrative, same discipline as our "no products live" rule.*
  - Advisor productivity → **RM / credit-analyst capacity** (more relationships per RM, more memos per analyst, admin time returned). *UNVERIFIED — model or label illustrative.*
  - Compliance → **covenant-breach early warning + exam-readiness** (breaches caught in-quarter not at test; exam-ready provenance pack, `§5.5`). This is a *stronger, more concrete* commercial claim than the wealth "fine that never happens."
  - Contact-center deflection → **weakest commercial fit.** Recommend dropping or reframing as "portfolio-monitoring alerts surface issues before they escalate to workout" (loss-avoidance, not call-cost).
- **The commercial "$606M"-equivalent headline** — a single defensible three-year uplift number for a mid-size commercial bank. **Do not invent it** — build the model or present it explicitly as illustrative. `WEBSITE-ANALYSIS` already flags "in production" / hard-number discipline as the risk to manage.
- **The credential swap: "40 CSA processes mapped" → our underwriting framework.** Our analogue is concrete and *built*: the 6-stage commercial-lending blueprint (`CAPABILITY-MAP.md`) + the **10-step underwriting framework = 14 executable credit-memo skills** + 9 personas × 71 mapped use cases (`USE-CASE-CATALOG.md`). Frame this as "not a process library on a slide — an executable underwriting brain running against a live nCino+FSC org." This is our credibility high ground; lead with it.
- **The umbrella one level up** — "the AI-native bank on Salesforce," with **commercial and wealth as two proof points on one spine** (`WEBSITE-ANALYSIS` tension #3). Commercial-first means commercial is the lead proof; wealth is the second. This slide is net-new and is what prevents us being a bolt-on inside their wealth deck.

---

## Appendix — UNVERIFIED / caveats
- All commercial value numbers (cycle time, RM capacity, uplift $) are **not yet modelled** — do not present as fact.
- Their portal's exact re-pointability is inferred from `salesforce-mcp-client.ts` + hosted-MCP topology (`extracted-aethon-asbuilt.txt`); not hands-on verified.
- `HANDOVER-2026-07-01.md §5` lists "build the customer-360 widget" and "stand up customer-360-reinvented" as open next-steps; the `customer-360-reinvented` repo now contains a 1605-line artifact + skill, so the widget appears built since that handover, but **end-to-end live-run state should be re-confirmed before demo day** (gap #5).
- `KYC__c` is **empty org-wide** in `bankinggpt`; every KYC/onboarding/compliance demo beat must lead with the beneficial-ownership graph as the real signal and treat KYC status as honest-absence ("unverified, blocks decisioning"), never a fabricated clearance.
- Governance divergence on *their* side (Agentforce/Trust Layer marketed, not in use) is theirs to reconcile; our merged deck should state real-vs-roadmap controls honestly (gap #9).
- Voice/avatar: confirmed **absent** from our entire stack by grep; any inclusion is net-new build.
