# Customer 360 MCP — Personas + Experience Design

Accenture Commercial Credit Brain · Relationship Cockpit
Verified against the bankinggpt sandbox data model (2026-06-28). No new objects. Bank-agnostic by design.

---

## 1. Purpose and how to read this

This document defines the baseline persona set for the Customer 360 MCP, the relationship-level twin of the deal-level credit memo. Where the credit memo zooms IN on one nCino Product Package, the Credit 360 cockpit zooms OUT to the whole customer: entities, all facilities, deposits and treasury, risk and covenants, profitability, and whitespace, assembled across FSC and nCino under one Salesforce org identity.

Three things ground every claim here:

1. **The verified data model.** Object names, field API names, the UserRole hierarchy, the `LLC_BI__Role__c` team-role catalog, the officer-lookup fields, and the Piedmont anatomy all come from a live `describe`/SOQL sweep of the bankinggpt sandbox. They are recorded in `DATA-MODEL-AND-ROLES.md` and `SCHEMA-VERIFIED.md`. This doc does not re-query Salesforce; those files are treated as ground truth.
2. **The locked architecture decisions** in `HANDOVER.md`: a Salesforce-native custom-hosted MCP (Apex/Flow/Named-Query), FSC + nCino co-resident in one org therefore one MCP, cross-source (Boom/AFS/Snowflake) joins staying at the existing `experience-mcp` tier, and roles as a view-config + permission layer rather than separate servers or agents.
3. **The decomposition doctrine and SR 11-7 governance** of the existing fleet: agents by domain, MCPs by system, joins by deterministic tool; the LLM never computes a regulated number; decision-support, never an autonomous credit action.

How to read it: Section 2 states the design principles. Section 3 is the persona table (one row per persona). Section 4 expands each persona. Section 5 is the per-tenant config map a new bank populates to onboard. Section 6 is the cross-cutting security and scalability model (read this before treating any persona's "sharing is the floor" line as already-true; it is gated on an unresolved identity decision). Section 7 is the client experience (book view to single-customer 360 to credit-memo drill). Section 8 is open questions.

**No new objects.** Every field referenced is either a standardized managed-package field (`LLC_BI__*`, `FinServ__*`) or an org-custom field that is named only as a config-map knob, never hardcoded into tool logic.

---

## 2. Design principles

**2.1 Agnostic via managed-package namespace + per-tenant config map.** Tool logic anchors only on standardized managed-package namespaces (`LLC_BI__*`, `FinServ__*`) whose field API names are identical across every nCino+FSC org. Every per-bank variance, the org-custom `cm_*` fields, the org-custom officer/approver lookups, record-type dev-names, role-name strings, the grouping key, and the wallet-source preference, lives in a per-tenant CONFIG MAP. No bank-specific API name appears in a persona contract or tool body. The split is roughly a 30 percent reusable engine plus a 70 percent per-bank definition layer, the same pattern the fleet already uses for ratio definitions and the module manifest. Bank equals config, not code.

**2.2 Roles are a view-config + permission layer, not a server or agent partition.** Per doctrine, you do not cut agents or servers by user role. There is ONE role-aware Customer 360 server. A persona is a config-driven cockpit view (which sections render, at what visibility) plus a permission gate (Profile + Permission Set) plus a surfaced tool menu. Personas never widen visibility; they only shape and narrow what sharing already grants. Write tools are gated by role and, critically, enforced server-side against the acting user (Section 6), not merely hidden from a tool menu.

**2.3 Salesforce record sharing is the security floor, FLS is field-by-field, entitlement layers on top.** The intended floor is: the MCP returns only records the running identity can see under Salesforce record sharing, respects FLS field-by-field, and layers persona entitlement on top of, never in place of, sharing. This floor is **contingent on an identity-model decision that is not yet made** (run-as-user vs service-account-with-explicit-scope) and on the org's OWD/sharing model. Until that decision is locked and the OWD is verified, no persona's "sharing is the floor" claim is guaranteed. Section 6 makes this a blocking precondition.

**2.4 Server-side aggregation, numbers never through the LLM.** All roll-ups (TCE/TBE/TOE exposure, share-of-wallet sums, risk roll-ups, profitability) execute server-side, mirroring `experience-mcp/boomFinancials.js`, so only small decision-relevant results cross the model boundary. This is both a correctness/provenance control and a data-leakage control. Trust the nCino Product Package rollups; never naive-sum loans (the limit/sublimit structure double-counts, proven on Piedmont where three facilities exceed TCE). Honor exposure-exclusion flags where present.

**2.5 SR 11-7 decision-support plus audit.** The cockpit concludes, surfaces, and recommends (next-best-action, whitespace, alerts) but never commits an autonomous credit action. Every regulated figure (exposure roll-up, covenant grade) is deterministic server-side code. Sourced values are provenance-locked. Writes are attributable to a named human and logged to an append-only, tamper-evident ledger. Development (drafting) is separate from validation (approval).

---

## 3. The persona table

Seven personas. Each is a view-and-permission layer over the one server, not a separate server. Field names in book-scope logic are shown as config knobs (the literal Piedmont field is in Section 5).

| Persona | Archetype | SF UserRole | nCino team role(s) | Blueprint stage owned | Cockpit sections (full / summary / read-only) | Book scope (top level) | Drill levels | Entitlement |
|---|---|---|---|---|---|---|---|---|
| **Relationship Manager / Loan Officer** | Front-line relationship owner; opens a borrower already knowing the deal | Relationship Manager (root); Loan Officer (under Commercial Banking Manager) | Officer, Senior Loan Officer, Loan Officer | Prospecting, Sales (feeds Servicing & Monitoring) | Header full · Entities full · Exposure summary · Deposits/treasury full · Boom snapshot summary · Risk read-only · Whitespace/NBA full | Assigned-work queue (my customers) | Queue → single-customer 360 → drill to a Package / memo | nCino Lite Seat or Premium CRM; read-only on sourced figures; no write tools |
| **Portfolio Manager** | Book-health steward; monitors deterioration at book level | Portfolio Manager (under Senior Credit Officer) | Credit, Management, Officer | Servicing & Monitoring (primary); Credit Analysis (reads) | Header full · Entities full · Exposure full · Deposits full · Boom snapshot+trend full · Risk full · Whitespace full | Book/portfolio roll-up (conditional, Section 6) | Book → single-customer 360 → facility/covenant/payment detail | Premium CRM / Standard Platform + credit-monitoring permission set; may PROPOSE decisions; no approval/grade write |
| **Credit Analyst / Underwriter** | Spread-and-memo author (development side) | Credit Analyst / Underwriter (leaf) | Credit Analyst, Underwriting, Credit | Credit Analysis (primary) | Header full · Entities full · Exposure full · Deposits summary · Boom snapshot+spread full · Risk full · Whitespace summary | Assigned-deals queue (no upward roll-up) | Queue → single-customer 360 → spread/ratio/covenant-actual detail | Standard Platform + underwriting permission set; authors narrative + adjustment records; no approval |
| **Credit Officer / Approver** | Validation side and decision authority (effective challenge) | Senior Credit Officer; Chief Credit Officer | Loan Approver, Loan Approver Queue, Credit, Management | Approval (primary); Credit Analysis gate; Servicing oversight | Header full · Entities full · Exposure full · Deposits full · Boom snapshot full · Risk full (approve/reject) · Whitespace summary | Book/portfolio roll-up (conditional, Section 6) | Approval queue → book risk view → single-customer 360 → attest/approve | Highest credit tier + approval permission set; WRITE only on the approval transition + decision rationale; never edits a sourced figure |
| **Loan Operations / Servicing Officer** | Stands up the approved facility on the books | Loan Operations; Loan Ops - DM Reviewer (under COO) | Loan Ops | Offering & Set-up (primary); Servicing & Monitoring (docs/limit setup) | Header full · Entities summary · Exposure full (limit/sublimit setup) · Deposits summary · Boom snapshot summary · Risk read-only · Whitespace hidden | Assigned-work queue (no upward roll-up) | Queue → single-customer 360 → facility / documentation / collateral detail | Standard Platform + loan-ops permission set; read-only on sourced figures; authors documentation/checklist notes; no rating/approval |
| **Treasury / Cash-Management Officer** | Operating-relationship and share-of-wallet owner (functional overlay on RM) | Relationship Manager and/or Commercial Banking Manager line (functional overlay, NOT a distinct rung) | Officer, Management | Prospecting, Sales, Servicing & Monitoring (deposit/treasury cross-sell) | Header full (deposit/treasury revenue lens) · Entities summary · Exposure summary · Deposits/treasury full · Boom snapshot summary · Risk read-only · Whitespace full | Cross-sell queue (credit-rich, deposit-poor) | Queue → single-customer 360 (wallet lens) → treasury-service gap detail | Premium CRM + treasury permission set; read-only on credit figures; authors opportunity/cross-sell notes |
| **Portfolio / Credit-Risk Executive** | Top-of-house oversight; portfolio in aggregate | CEO; Chief Operating Officer (credit-risk-executive view) | Management | Servicing & Monitoring (book oversight); Approval (governance visibility) | Header full (book-aggregate) · Entities summary · Exposure full (concentration) · Deposits summary · Boom snapshot summary · Risk full (read-only oversight) · Whitespace summary | Book/portfolio roll-up (conditional, Section 6) | Portfolio view → segment/cohort → single-customer 360 | Executive tier; READ-ONLY oversight; NO per-deal write/approval; decision-support only |

Notes carried from the critique:

- **Chief Credit Officer maps to the Credit Officer / Approver persona, not the Executive.** A CCO holds approval authority; read-only oversight for a CCO would be wrong. The Executive persona is reserved for CEO and COO (pure oversight, no per-deal approval). This is the stated default for the Chief-Credit-Officer collision (see Section 6, persona resolution: when a user holds an approval-capable role, the write-capable persona wins).
- **Treasury is a functional overlay on the RM role**, differentiated by permission set, treasury-focused section visibility, and the credit-rich/deposit-poor filter, not by a distinct UserRole rung. `Secondary_Officer__c` is a field, not a role; it appears only in book-scope/config (`treasuryOfficerField`), never in `sfUserRoles`.
- **Leaf personas (RM own-book, Analyst, Loan Ops, Treasury) have an "assigned-work queue" top level with no role-hierarchy widening.** Manager personas (PM, Credit Officer, Executive) have a "book/portfolio roll-up" top level that is conditional on the tenant's sharing model.

---

## 4. Persona detail

Each persona below expands archetype, primary questions, data sources/tools (verified fleet tools only), book-scope logic (config knobs, not literal field names), agnostic notes, and security notes.

### 4.1 Relationship Manager / Loan Officer

**Archetype.** The default, primary persona of the cockpit (owner per the handover). Owns the customer connection end to end: lights the single-customer view in Prospecting and Sales, opens a borrower and already knows the deal, the decisions, the open questions, so no banker re-explains the relationship to a blank page.

**Primary questions.** What is the whole relationship (borrower, guarantors, all entities, total exposure) in one connected view? Where is the whitespace / next-best-action (a $0 deposit wallet on a credit-only borrower means win the operating deposits and treasury)? What is my book? What is the deal status and the open questions before I walk into the meeting?

**Data sources / tools.**
- Customer 360 SF-native MCP (this server): `customer_360`, `relationship_entities`, `relationship_exposure`, `deposits_and_treasury`, `relationship_opportunities`. Assembles the single connected view server-side from Account + Product Package + Connection + Deposit/Treasury, mirroring `boomFinancials.js`.
- afs-mcp (booked + in-flight book): `jobs_by_officer`, `portfolio_by_officer`, `afs_show_officer_loans`. The RM's book of in-flight and booked loans is the core servicing entry point.
- boom-mcp (financial snapshot tile): `boom_get_ratios` (raw), `boom_show_spread` (rendered tile). Read-only; no rating authority.
- experience-mcp (assembled deal view + recall, read-only): `ncino_deal_prep`, `deal_show_summary`, `recall_decisions`. The RM reads the assembled deal and prior decision rationale; does not author the grade.

**Book-scope logic (layered, with graceful degradation).** (1) Team membership: Packages/Loans where a `LLC_BI__Product_Package_Team__c` / `LLC_BI__LoanTeam__c` row has User = me with an Officer/Loan Officer team role (`teamRoleStrings` config). (2) Named officer: Accounts where `rmOfficerField` (CONFIG MAP, OPTIONAL) = me, Packages where `LLC_BI__Primary_Officer__c` = me, Loans where `LLC_BI__Loan_Officer__c` = me. (3) AFS bridge: `portfolio_by_officer` for the booked book. The RM officer field is OPTIONAL config: a bank with no RM lookup degrades to team-role + sharing floor. When team and officer lookups are sparse (Piedmont has none set), the book falls back to the SF record-sharing floor; the RM sees exactly the Accounts sharing grants the running identity, never wider.

**Agnostic notes.** Only `LLC_BI__*` / `FinServ__*` names are literals. The RM officer field, the team-role strings, the grouping key, and the wallet-source preference are all config. The RM officer field is org-custom and OPTIONAL.

**Security notes.** Sharing is the floor (contingent on Section 6). FLS field-by-field (profitability fields hidden if FLS denies). No write tools surfaced. Server-side aggregation, stateless calls. Authoring limited to narrative/notes where the cockpit allows commentary.

### 4.2 Portfolio Manager

**Archetype.** Book-health steward. Monitors the live portfolio across its life (deterioration, line utilization, early-warning signals, covenant drift) at book level. Sits above the analyst in the credit chain and one rung in the approval ladder. Co-owner (with RM) of the cockpit.

**Primary questions.** Which credits are deteriorating (revenue/margin/leverage trend, utilization spikes, payment slippage)? Where is covenant cushion thinnest, and which relationships are on watch? What is total exposure and concentration across my managed relationships? Which renewals/reviews are due?

**Data sources / tools.**
- Customer 360 SF-native MCP: `customer_360`, `relationship_exposure`, `relationship_risk`, `relationship_entities`, `deposits_and_treasury`, `relationship_opportunities`. Book-level exposure, relationship risk review, account covenants, concentration, assembled server-side from Package rollups (trust TCE/TBE/TOE, honor exclusion flags, never naive-sum).
- afs-mcp (monitoring signals): `revolver_utilization`, `payment_history`, `loan_summary`, `portfolio_by_officer`, `afs_show_officer_loans`.
- boom-mcp (deterioration trend): `boom_get_ratios`, `boom_get_spread`, `boom_show_spread`. Revenue/margin/leverage trend to flag deterioration before breach.
- experience-mcp (covenant grade + recall): `deal_covenant_grade`, `recall_decisions`, `get_audit_trail`. The deterministic Boom-ratio × nCino-threshold grade (LLM never computes it) and prior decision/audit context.

**Book-scope logic.** (1) Named officer: Loans where `portfolioManagerField` (CONFIG MAP, org-custom, OPTIONAL) = me; Packages where I am `LLC_BI__Primary_Officer__c` / `LLC_BI__Secondary_Officer__c`. (2) Team membership: `...Team__c` rows with User = me and a Credit/Management team role (`teamRoleStrings`). (3) Role-hierarchy roll-up: conditional on `sharingModelGrantsHierarchyRollup` (Section 6); when true, SF sharing rolls my analysts' books up to me. When officer/team lookups are sparse, fall back to the conditional roll-up plus the sharing floor; never wider than sharing grants.

**Agnostic notes.** `portfolioManagerField` is org-custom and OPTIONAL: a vanilla nCino+FSC bank with no credit-memo-reinvented package has no `cm_*` fields, so the named-officer layer is empty by design and book derivation falls to team membership (Credit/Underwriting roles) then the conditional UserRole roll-up / sharing floor. The watch threshold ("within X% of trigger = watch", `watchThresholdPct`) and the role-hierarchy ancestor names are config.

**Security notes.** Sharing floor plus the conditional UserRole roll-up (managers see subordinates' books) only as far as sharing actually grants it; the server never fabricates roll-up beyond sharing. FLS on risk/profitability fields, enforced before aggregation (Section 6). `record_decision` is proposed-not-committed (human-in-the-loop). No approval/grade write.

### 4.3 Credit Analyst / Underwriter

**Archetype.** The spread-and-memo author (development side of effective challenge). Owns the financial spread and the ratios that drive the rating; drafts the credit narrative grounded in sourced figures. Uses the relationship 360 as the context that feeds the deal-level memo.

**Primary questions.** What does the spread say (revenue, EBITDA margin, leverage, coverage) and how do the ratios drive the rating? What is the full relationship exposure and entity/guarantor structure I underwrite against? Where does each covenant actual sit versus its nCino threshold (pass/watch/breach)? What did prior analysts decide and why?

**Data sources / tools.**
- boom-mcp (primary): `boom_find_company`, `boom_lookup_company`, `boom_get_spread`, `boom_get_ratios`, `boom_show_spread`. Owns the spread and ratios. Line-item detail comes from `boom_get_spread` (returns `financialStatements[]` with lineItems by accountCode). Ratios computed on read, never stored.
- experience-mcp (covenant grade + memo authoring + decision capture): `deal_covenant_grade`, `ncino_deal_prep`, `record_decision`, `recall_decisions`, `log_audit_event`. `deal_covenant_grade` joins Boom ratio to nCino threshold deterministically; `record_decision` captures the WHY; recall warms the next session. The LLM drafts narrative but never computes the grade.
- Customer 360 SF-native MCP (relationship context): `customer_360`, `relationship_entities`, `relationship_exposure`, `relationship_risk`. The relationship spine (entities, guarantors, total exposure, relationship risk review) the memo underwrites against.

**Book-scope logic.** (1) Named officer: Loans where `analystField` (CONFIG MAP, org-custom, OPTIONAL) = me. (2) Team membership: `...Team__c` rows with User = me and a Credit Analyst / Underwriting team role (`teamRoleStrings`). (3) No role-hierarchy widening upward (the analyst is a leaf in the UserRole tree, sees own assigned work, not peers'). When `analystField` is absent (no credit-memo-reinvented package), layer 1 is empty by design and derivation falls to team membership then the sharing floor. Sparse-data fallback equals the SF record-sharing floor. Narrowest book by design (least privilege).

**Agnostic notes.** `analystField` is org-custom and OPTIONAL, a credit-memo-reinvented dependency, not an nCino baseline. Ratio definitions, the watch threshold, and peer-grouping (NAICS) are config/definition layers; the engine is identical across banks. Team-role strings are config. No bank-specific field in tool logic.

**Security and the SR 11-7 fence.** Sharing floor (narrow, leaf node, no upward roll-up). FLS field-by-field, before aggregation. SOURCED values are provenance-locked: the analyst may NOT edit a ratio/balance/threshold in place. Analyst number changes (adjusted EBITDA, add-backs, pro-forma) are a first-class ADJUSTMENT RECORD `{value, basis:'analyst-adjustment', rationale, by, asOf}` layered on top with justification, never an in-place edit. VIEW/SELECTION (which ratio, periods, peer set) is freely configurable. NARRATIVE is fully authored. Attestation: ai-drafted → edited/approved, keyed by module id, identity from the authenticated session (not an agent-supplied id). The analyst NEVER hand-authors a regulated number; every ratio/grade is deterministic code. Decision memory informs but is never a source for a figure. **Adjustment-to-grade rule:** whether an analyst adjustment feeds `deal_covenant_grade` must be explicit (Section 6, governance); if it does, the grade is computed on BOTH sourced and adjusted bases, both surfaced with dual lineage, and an adjustment that moves a pass/watch/breach grade is flagged for the credit officer's effective challenge. An adjustment cannot be authored on a record the same analyst later attests without second-person (officer) review of the adjustment basis. Development is separate from validation.

### 4.4 Credit Officer / Approver (Sr / Chief Credit Officer)

**Archetype.** The validation side and decision authority. Performs effective challenge on the drafted, attested memo; holds approve/reject authority on the package; the human who stays in the decision. Reviews the relationship in the round (credit, market, operational risk) before the committee acts.

**Primary questions.** Is the rating call defensible (do ratios, covenant grade, exposure roll-up support the proposed grade)? What is the relationship's Risk 360? What did the analyst decide and why, and does the audit trail support an effective challenge? Approve or reject, and is every value provenance-locked and every section attested before I act?

**Data sources / tools.**
- experience-mcp (review, approve, audit; write-capable on approval): `ncino_approve_package`, `recall_decisions`, `get_audit_trail`, `deal_covenant_grade`, `record_decision`. `ncino_approve_package` is the reviewer approve/reject step; recall + audit trail provide effective challenge and the examiner-facing trail; `record_decision` logs the approval rationale.
- boom-mcp (rating evidence): `boom_get_ratios`, `boom_show_spread`. Ratio actuals plus the covenant grade for the rating call.
- Customer 360 SF-native MCP (risk in the round): `customer_360`, `relationship_risk`, `relationship_exposure`, `relationship_entities`. Risk 360 across the relationship before the decision.
- afs-mcp (performance evidence): `payment_history`, `revolver_utilization`. Servicing performance feeds the renewal / risk-rating review.

**Book-scope logic.** (1) Named approver: Packages where `approverFields` (CONFIG MAP, org-custom, OPTIONAL) = me, or `LLC_BI__Primary_Officer__c` / `LLC_BI__Secondary_Officer__c` on packages routed for decision. (2) Team membership: Loan Approver / Loan Approver Queue rows (`teamRoleStrings`). (3) Role-hierarchy roll-up: conditional on `sharingModelGrantsHierarchyRollup`; when true and the running identity is at/near the top of the credit chain, SF sharing rolls up the subordinate credit book. The agnostic primary path is the managed-package one (Loan Approver / Loan Approver Queue team roles + routed `LLC_BI__Primary/Secondary_Officer__c`); `approverFields` is an optional config overlay (a different bank may use nCino's native approval process with no `Approver_n__c` scalar fields). Sparse fallback equals the sharing floor.

**Agnostic notes.** Approver lookup fields and role-name strings are CONFIG MAP entries. The approval ladder shape (Analyst → PM → Sr CO → Chief CO) is read from UserRole + the role catalog (`userRoleNames`), not hardcoded. Committee-gating policy is config.

**Security notes.** Sharing floor plus conditional top-of-chain roll-up (only as far as sharing grants). FLS field-by-field, before aggregation. WRITE-capable ONLY on the approval transition (`ncino_approve_package`) and decision rationale (`record_decision`); never edits a sourced figure. **The approval authorization is enforced in Salesforce against the ACTING USER, not in the agent** (Section 6): the service tier verifies the acting user holds the approval permission set / is a named approver on that package BEFORE writing, and SF-side validation rules independently enforce it. DRAFT-until-committee: section sign-off is not committee approval; the DRAFT banner persists. Separation of duties: this persona (validation) is distinct from the analyst (development). `log_audit_event` self-fires on the approval transition for the examiner trail.

### 4.5 Loan Operations / Servicing Officer

**Archetype.** Stands up the approved facility on the books. Owns the blueprint's Offering & Set-up stage (drawdown, account and limit set-up, covenant tracking, collateral valuation, documentation), which no other persona owns. This persona gives the fleet's AFS booking/servicing-handoff tools an owner.

**Primary questions.** What facilities and limits/sublimits must I stand up from the approved structure? What documentation and collateral items are outstanding before booking? What obligation numbers and servicing workpackages must be created for the handoff? What is the relationship's facility footprint I am operationalizing?

**Data sources / tools.**
- afs-mcp (booking/servicing handoff, the tools no other persona surfaces): `create_workpackage`, `reserve_obligation_number`, `loan_summary`, `afs_show_summary`.
- Customer 360 SF-native MCP: `customer_360`, `relationship_exposure`. Account context and the facility/limit structure being set up.

**Book-scope logic.** (1) Named officer: Loans where `loanOpsFields` (CONFIG MAP, org-custom, OPTIONAL: e.g. the loan-ops/closer/loan-assistant lookups) = me. (2) Team membership: `...Team__c` rows with User = me and a Loan Ops team role (`teamRoleStrings`). (3) No role-hierarchy widening upward (leaf persona, assigned-work queue). When `loanOpsFields` are absent (no credit-memo-reinvented package), layer 1 is empty by design and derivation falls to team membership then the sharing floor.

**Agnostic notes.** Loan-ops officer lookups are org-custom and OPTIONAL. The Loan Ops team-role string is config. The Offering & Set-up stage ownership is structural, not bank-specific.

**Security notes.** Sharing floor (leaf, no upward roll-up). FLS field-by-field. Read-only on all sourced figures (exposure, grades, balances provenance-locked); no rating/approval authority. Authoring limited to documentation/checklist notes. The AFS write tools (`create_workpackage`, `reserve_obligation_number`) are the servicing-booking handoff; they are gated to this persona by role and enforced server-side against the acting user. If this persona is descoped for a given tenant, these AFS write tools are intentionally NOT surfaced in the cockpit (servicing booking then happens in nCino/AFS native), consistent with the decision-support-only stance, never a silent omission.

### 4.6 Treasury / Cash-Management Officer

**Archetype.** Operating-relationship and share-of-wallet owner. A functional overlay on the RM role. Drives the deposit and treasury-management cross-sell, the headline next-best-action on a credit-only borrower (Piedmont's $0 wallet = win the operating deposits + treasury). Reads the relationship to find and grow the non-credit wallet.

**Primary questions.** What is the customer's deposit + treasury share-of-wallet, and where is the whitespace (credit-only with $0 operating deposits)? Which treasury services (ACH, Lockbox, Wire, Sweep, ZBA, RDC, Reconciliation, Online Banking) does the customer NOT yet use? What is the deposit/net-treasury revenue contribution to profitability? Which of my relationships are credit-rich but deposit-poor?

**Data sources / tools.**
- Customer 360 SF-native MCP (wallet + profitability + opportunities): `deposits_and_treasury`, `customer_360`, `relationship_opportunities`, `relationship_entities`. `deposits_and_treasury` surfaces the nCino Deposit + Treasury_Service suite as authoritative C&I wallet, FSC FinancialAccount as cross-sell signal; profitability shows deposit/fee/net-treasury revenue; opportunities equal the cross-sell whitespace. Wallet roll-up server-side.
- afs-mcp (servicing context for operating flows): `loan_summary`, `revolver_utilization`. The operating/borrowing rhythm the treasury cross-sell should capture (e.g. sweep against the line).
- experience-mcp (deal context, read-only): `deal_show_summary`, `recall_decisions`. Reads the assembled relationship and prior decisions to time the approach; no credit write authority.

**Book-scope logic.** (1) Named officer: Accounts where `treasuryOfficerField` (CONFIG MAP, org-custom, OPTIONAL; may reuse `Secondary_Officer__c` but the Trust-vs-Treasury overload is a per-tenant mapping decision, not a default) = me; Treasury_Service rows where I am the relationship officer. (2) Team membership: Officer/Management rows on packages with a treasury overlay. (3) Cross-sell targeting: within the SF-shared book, filter to relationships where credit exposure exists but deposit/treasury wallet is $0/low (the Piedmont pattern, `creditRichDepositPoorRule` config). Sparse fallback equals the sharing floor. `walletSource` governs which holdings count.

**Agnostic notes.** `treasuryOfficerField` and `walletSource` (nCino Treasury/Deposit authoritative vs FSC FinancialAccount) are CONFIG MAP entries; this persona is the clearest consumer of the `walletSource` knob. Treasury-service picklist labels, the household grouping key, and the credit-rich/deposit-poor NBA rule are config-driven definitions, not hardcoded.

**Security notes.** Sharing floor; this persona must NOT see credit relationships outside its shared book just because a wallet opportunity exists. FLS likely restricts deep credit/risk fields for a treasury profile; respect field-by-field, before aggregation, so a treasury profile that is FLS-denied on, say, NII does not receive an NII-inclusive profitability total. Wallet roll-ups server-side. Stateless. No write tools beyond opportunity/cross-sell notes.

### 4.7 Portfolio / Credit-Risk Executive

**Archetype.** Top-of-house oversight. Sees the portfolio in aggregate (total exposure, concentration, risk migration, profitability) across the subordinate book, not a single relationship. Roll-up first, drill to a single customer 360 on demand. Decision-support, never autonomous; concludes and surfaces, never commits a credit action.

**Primary questions.** What is total portfolio exposure and where is the concentration (by entity, industry/NAICS, risk grade)? How is risk migrating (grade drift, watch-list growth, covenant breaches, past-due trend)? What is portfolio profitability (NII, deposit/fee/treasury revenue) and where is it thin? Where is the book most exposed to stress?

**Data sources / tools.**
- Customer 360 SF-native MCP (book aggregation): `customer_360`, `relationship_exposure`, `relationship_risk`, `deposits_and_treasury`, `relationship_opportunities`. Aggregates exposure/risk/profitability across the subordinate book server-side from Package rollups (trust TCE/TBE/TOE, honor exclusion flags).
- experience-mcp (governance + audit oversight): `get_audit_trail`, `recall_decisions`, `deal_covenant_grade`. Examiner-facing audit trail and decision memory for governance; the deterministic covenant grade for book-level watch/breach counts.
- afs-mcp (book servicing signals): `payment_history`, `revolver_utilization`, `portfolio_by_officer`. Past-due/aging and utilization aggregated for portfolio early-warning.

**Book-scope logic.** Primarily (3) role-hierarchy roll-up, conditional on `sharingModelGrantsHierarchyRollup`: when true and the running identity is at/near the top of the UserRole tree (CEO / COO / credit-risk executive), SF sharing rolls the subordinate book up. Team/officer lookups are secondary. Aggregation is server-side across all SF-shared relationships. CRITICAL: the roll-up is exactly as wide as SF record sharing grants the running identity and no wider; even an executive never sees a record sharing denies. Degrades gracefully when officer/team data is sparse (it relies on hierarchy + sharing, which Piedmont-style empty officer fields do not break) and degrades to the executive's own officer/team book if the sharing model is not hierarchy-based.

**Agnostic notes.** Executive role-name strings (`userRoleNames`) and the portfolio grouping/segmentation keys (industry field, grade-band definition, household key) are CONFIG MAP entries. The roll-up engine reads UserRole + sharing generically; no bank-specific hierarchy hardcoded. Concentration-bucket definitions are config.

**Security notes.** SF record sharing is THE control; the executive's wide view is legitimate ONLY because sharing grants it, and the server never widens beyond sharing even for the top of the hierarchy. FLS field-by-field on profitability/risk, before aggregation. All roll-ups server-side, numbers never through the LLM (also a leakage control for large aggregate payloads). Stateless, read-only, minimal blast radius. NO per-deal write/approval (governance separation: oversight is not per-deal approval, which stays with the credit officer).

---

## 5. Per-tenant CONFIG MAP

The exact knobs a new bank populates to onboard. Managed-package field names (`LLC_BI__*`, `FinServ__*`) are NOT here; they are identical across orgs and live in code. Everything here is per-bank variance. Org-custom fields (`cm_*`, org-custom officer/approver lookups) are OPTIONAL: when absent, the named-officer layer they back is empty by design and book derivation falls to team membership then sharing.

| Config key | What it sets | Notes |
|---|---|---|
| `rmOfficerField` | API name of the RM officer lookup on Account (e.g. `Bank_Relationship_Manager__c`) | Org-custom, OPTIONAL. Absent → RM degrades to team-role + sharing floor. |
| `primaryOfficerField` / `secondaryOfficerField` | Commercial-lending and trust/treasury officer lookups | `LLC_BI__Primary_Officer__c` is managed; org-custom variants are config. |
| `portfolioManagerField` | Loan-level PM lookup (e.g. `cm_Portfolio_Manager__c`) | Org-custom, OPTIONAL (credit-memo-reinvented dependency). |
| `analystField` | Loan-level analyst/underwriter lookup (e.g. `cm_Credit_Analyst_Underwriter__c`) | Org-custom, OPTIONAL (credit-memo-reinvented dependency). |
| `loanOpsFields` | Loan-ops/closer/loan-assistant lookups (e.g. `cm_Loan_Ops__c`, `cm_Closer__c`, `cm_Loan_Assistant__c`) | Org-custom, OPTIONAL. Backs the Loan Operations named-officer layer. |
| `approverFields` | Package approver lookups (e.g. `Approver_1__c`, `Approver_2__c`) | Org-custom, OPTIONAL overlay. Agnostic primary is Loan Approver / Loan Approver Queue team roles + routed managed officer fields. |
| `treasuryOfficerField` | Which lookup designates the treasury/cash-management officer | OPTIONAL; may reuse `Secondary_Officer__c`, but Trust-vs-Treasury overload is a per-tenant decision, not a default. |
| `groupingKey` | Relationship/household roll-up key: Connection-graph traversal (default, managed) \| `cm_Household__c` \| `ACNPEX_Relationship__c` \| `FinServ__Household__c` | Connection graph is the agnostic default (works without a household key). The household keys are an enhancement that lights up only when populated. None populated for Piedmont. |
| `walletSource` | Authoritative deposit/treasury source: nCino Treasury/Deposit (lean for C&I) vs FSC FinancialAccount; plus cross-sell-signal source | |
| `teamRoleStrings` | Map of `LLC_BI__Role__c` TEAM_ROLES values to personas (Officer, Senior Loan Officer, Loan Officer, Credit, Credit Analyst, Underwriting, Loan Approver, Loan Approver Queue, Loan Ops, Compliance, Management, IT) | These are picklist LABELS, tenant-configurable; re-map per bank, never assume. Personas reference the persona→team-role-set mapping by config, not embedded literals. |
| `userRoleNames` | The org's UserRole dev-names per rung (CEO, Chief Credit Officer, Senior Credit Officer, Portfolio Manager, Credit Analyst / Underwriter, Commercial Banking Manager, Loan Officer, Relationship Manager, Chief Operating Officer, Loan Operations) | Read for hierarchy roll-up + approval ladder. |
| `recordTypeDevNames` | `{borrowerRT, householdRT, individualRT}` mapping; the anchor logic resolves the borrower record type via config, accepting EITHER `Business` OR `IndustriesBusiness` | Classic-vs-Industries RT split is a per-tenant variant the relationship anchor must tolerate (the org has both co-resident; FSC bulk set is on `IndustriesBusiness`). |
| `cmCustomFields` | The org's `cm_*` / denormalized rollup field API names (e.g. `cm_Exposure_Calculation__c`) | Never hardcoded in tool logic. |
| `exposureExclusionFields` | `Exclude_From_Account_Exposure__c` / `Exclude_From_Product_Package_Exposure__c` API names | Org-custom on `LLC_BI__Legal_Entities__c`, OPTIONAL. Absent → server trusts the nCino Package TCE/TBE/TOE rollups alone (which already net out limit/sublimit) and does NOT attempt loan-level exclusion. Fallback is graceful, not a silent miscalculation. |
| `watchThresholdPct` | The "within X% of trigger = watch" definition for covenant grading (e.g. 10%) | Mirrors the ratio-definition pattern. |
| `sharingModelGrantsHierarchyRollup` | `true` \| `false` \| `unknown` — whether the org's OWD + "Grant Access Using Hierarchies" actually rolls subordinate books up the UserRole tree | Manager personas (PM, Credit Officer, Executive) BRANCH on this. When false/unknown, they collapse to their own officer/team book. See Section 6. |
| `personaResolution` | Precedence-ordered list + union/precedence policy for a user holding MULTIPLE personas | Default: approval-capable write role wins for write-tool surfacing; union for read sections. Makes the persona→view→entitlement mapping deterministic and config-driven (resolves the Chief-Credit-Officer collision). |
| `entitlementTierMap` | Profile/Permission-Set names per persona (nCino Lite Seat \| Premium CRM \| Standard Platform + role permission sets) | |
| `cockpitSectionVisibilityMap` / `writeToolSurfaceMap` | The single authoritative binding of persona → {surfaced read tools, surfaced write tools, section visibility full/summary/read-only/hidden} | "No write tools for RM/treasury/executive/loan-ops-read" is a config assertion the server enforces, not prose. Verifiable and bank-portable. |
| `fieldVisibilityProfile` | Per-persona FLS expectations (which risk/profitability fields a profile is expected to see) as a config-checked overlay on top of SF FLS | |
| `brandConfig` | BANK identity, `brand-tokens.css`, classification banner (Accenture violet `#a100ff`) | Swappable per tenant. |
| `tenantId` / `orgCredential` | Immutable tenant id selecting the distinct, separately-credentialed SF org connection | A credential boundary, NOT a config value the caller/LLM can influence (Section 6). |

---

## 6. Cross-cutting security and scalability model

These are server-enforced invariants. Several are gated on decisions that must be locked before the persona security claims hold.

**6.1 BLOCKING precondition: the identity model.** Before any persona may claim "sharing is the floor," the runtime identity must be decided and locked. Either (a) the MCP runs AS the user (OAuth user context / per-user SF session) so sharing + FLS are enforced by the platform on every query, or (b) it runs as a service account with EXPLICIT scope re-implementation. If (b), the spec must implement: `WITH USER_MODE` / `WITH SECURITY_ENFORCED` (or equivalent) on every SOQL, a per-request `actingUser` sharing filter, and `stripInaccessible` FLS on every field, because none of that is automatic under a service account. The current most-likely runtime (service-account assembly, as `boomFinancials.js` already does) would silently bypass the stated floor. Hard gate: the server refuses to return records unless an `actingUserId` sharing context is established.

**6.2 OWD is the real boundary; persona narrowing is UX, not security, until verified.** The UserRole roll-up is only a control if OWD plus "Grant Access Using Hierarchies" is enabled per object (Account, `LLC_BI__Product_Package__c`, `LLC_BI__Loan__c`, `LLC_BI__Deposit__c`, `LLC_BI__Profitability__c`, `LLC_BI__Relationship_Risk_Review__c`). If OWD is Public Read/Write (common in demo sandboxes; the bankinggpt org runs under a sysadmin login that masks this), every persona already sees the whole book and the persona narrowing is cosmetic. Action: verify and document actual OWD per object and the hierarchy-grant flag (`sharingModelGrantsHierarchyRollup`). State explicitly that persona view-narrowing is a UX/entitlement convenience, not a security boundary; the real boundary is OWD + sharing. If OWD is permissive, either tighten OWD or add server-side enforced scope filters that do not rely on platform sharing, and do NOT present the cockpit as enforcing least privilege.

**6.3 FLS enforced at the field-read layer BEFORE aggregation, under the running user.** A server-side SUM under a service identity does not honor the running user's FLS. For each persona, derive the readable-field set from the running user's FLS and exclude FLS-denied fields from any returned rollup. Never compute an aggregate over fields the user cannot see and then hand them the total. Document per-persona which rollup components are suppressed when a constituent field is denied (for example, treasury sees deposit/fee revenue total but NOT NII-inclusive profitability if NII is FLS-denied).

**6.4 Sharing/FLS re-checked on EVERY traversed entity, not just the anchor.** The relationship roll-up walks Connection / AccountAccountRelation edges and sums exposure across all entities. Before including any connected account's name, existence, or exposure in a rollup, re-check the running user's access to THAT account. Unshared related entities are omitted entirely; the total reflects their omission and the cockpit shows a "partial view — N related entities not visible to you" marker rather than silently folding or silently dropping their numbers. The aggregate is computed only over entities the running user can independently see. This closes the exact leak where a server-side aggregate could include an unshared affiliate's existence and figures.

**6.5 PII / Person Account handling.** Individual guarantors and principals (Margaret Holloway is a 100% individual owner; the org has 123 PersonAccounts) are PII subjects, not just graph nodes. (1) The entity graph returns relationship STRUCTURE only (name, role, ownership %), never SSN/TIN/DOB/personal-address fields. (2) Person Account / Individual personal identifiers are hard-excluded from tool output and from the LLM context regardless of FLS. (3) KYC / Compliance-Check beneficial-ownership detail is gated to credit/compliance personas only and never surfaced to RM/treasury/executive. (4) Any unavoidable identifier in the widget is masked. GLBA exposure for individual guarantors is treated explicitly.

**6.6 Write-tool authorization enforced in Salesforce against the acting user, not in the agent.** Tool-menu shaping per persona bounds what the LLM is likely to call, but it is not the control. The service tier has no SF profile of its own; "gate the write tool by role" means: either run the write under the acting user's OAuth context so SF validation rules / permission sets reject unauthorized actors, or the service account verifies server-side that the `actingUserId` holds the required permission set (Loan Approver for `ncino_approve_package`; Loan Ops for `create_workpackage` / `reserve_obligation_number`) and is a named party for that package BEFORE writing, with SF-side validation rules independently enforcing it. A read-only persona is REJECTED by the server even if the LLM is induced to call a write tool. Hybrid attribution provides AUDIT, not AUTHORIZATION.

**6.7 Prompt injection: relationship free-text is untrusted data.** The cockpit ingests attacker-influenceable customer-supplied strings (Account names, opportunity names, notes, narrative fields). Per the constitutional rule, all such free-text is fenced as DATA, never allowed to carry instructions into tool selection. Combined with 6.6, a manipulated read-only persona cannot reach a write tool.

**6.8 Provenance-locked sourced values.** Exposure, balances, covenant actuals/thresholds, grades, collateral, guarantor figures are read-only for ALL personas; the system of record is nCino/Boom. Views are configurable, narratives are authored, values are locked. Analyst number changes are first-class ADJUSTMENT RECORDS with justification, never in-place edits, and the adjustment-to-grade dual-lineage rule of 4.3 applies.

**6.9 The LLM never computes a regulated number.** TCE/TBE/TOE roll-ups, share-of-wallet sums, the covenant grade (`deal_covenant_grade`), and risk roll-ups are deterministic server-side code (SR 11-7). Trust nCino Package rollups, honor exposure-exclusion flags where present (else fall back to Package rollups, 6.3 / Section 5), never naive-sum loans.

**6.10 Server-side aggregation, numbers never through the LLM.** All roll-ups/joins execute server-side, mirroring `boomFinancials.js`; only small decision-relevant results cross the model boundary. This is both a correctness/provenance control and a data-leakage control.

**6.11 Tamper-evident, identity-bound audit + decision ledger.** Audit/decision writes bind to the verified authenticated session identity, NOT an agent-supplied `actingUserId` (which an agent could spoof). The ledger is append-only and tamper-evident (immutable DocMan/Snowflake records with server-set actor + timestamp the agent cannot override). "Agent proposed" entries are distinct and non-agent-writable from "human confirmed" entries, so the examiner trail distinguishes a proposal from an attested human decision and cannot be forged. `log_audit_event` self-fires on attestation/approval/writeback transitions (the WHAT); `record_decision` captures the WHY. SR 11-7 fence: decision memory informs but is never a source for a figure and never enters the examiner-facing record.

**6.12 Separation of duties / effective challenge / decision-support only.** The analyst (development/drafting) is distinct from the credit officer (validation/approval): distinct personas, distinct gates. DRAFT-until-committee: section sign-off never promotes to a decision; the DRAFT banner persists. The cockpit concludes/recommends but never commits an autonomous credit action.

**6.13 Roles are view-config + write-scoping, not a server/agent partition.** One role-aware server. Write tools gated per 6.6. No per-role agents or servers. Short, role-scoped tool menus sharpen LLM selection and bound blast radius. `writeToolSurfaceMap` is the single config artifact binding persona → surfaced read/write tools.

**6.14 Persona resolution for multi-hat users.** `personaResolution` config makes the mapping deterministic: approval-capable write role wins for write-tool surfacing (so a Chief Credit Officer resolves to the Approver persona, never the read-only Executive); union of read sections otherwise. No undefined behavior for overlapping role membership.

**6.15 Multi-tenant isolation is a credential boundary, not a config value.** Each tenant is a distinct, separately-credentialed SF org connection. The request carries an immutable `tenantId` that selects the org credential and is validated against the authenticated session, never inferred from a config map the LLM or caller can influence. No shared cache across tenants. A test asserts Bank A credentials cannot be combined with Bank B's accountId. One `experience-mcp` deployment serving multiple banks requires per-tenant credential scoping, not just per-tenant brand/config.

**6.16 Compute-on-read, never store a derived regulated value.** Ratios/grades/exposure are computed on read so one implementation feeds all consumers and no cache can drift; the only persisted derived figure is the immutable memo/DocMan record. Stateless calls keep per-user sharing enforced on every request.

**6.17 Citation-as-UI / provenance in the widget.** Every cockpit section carries vendor data attribution (Boom → Snowflake → nCino lineage) plus the "Accelerator by Accenture" footer; real vendor identity appears only on click-through to the vendor app. Supports SR 11-7 full data lineage.

**Scalability.** Adding a persona is adding a config row (section-visibility map, write-tool surface, entitlement tier, book-scope knobs), not a new server or agent. Adding a bank is populating the config map plus provisioning a scoped org credential. The engine is one role-aware server; the variance is data.

---

## 7. The 360 client experience

**Two drill levels, per the handover.** Book/queue view → single-customer 360. Manager personas (PM, Credit Officer, Executive) open on a book/portfolio roll-up (conditional on the sharing model, Section 6). Leaf personas (RM own-book, Analyst, Loan Ops, Treasury) open on an assigned-work queue with no upward roll-up.

**Book/queue view.** The persona's relationships, ranked by what that persona cares about: RM by whitespace/attention; PM and Executive by deterioration/concentration/risk migration; Analyst by underwriting queue; Loan Ops by booking/documentation backlog; Treasury by credit-rich/deposit-poor cross-sell priority. The ranking dimension is per-persona config; the underlying records are exactly what sharing grants.

**Single-customer 360.** The full cockpit for one relationship: relationship header (total exposure + profitability) · entity & ownership graph · exposure across all nCino facilities · deposits / treasury share-of-wallet · Boom financial snapshot · risk & covenants · whitespace / next-best-action · alerts / EWS. Each section renders at the persona's configured visibility (full / summary / read-only / hidden). Numbers are aggregated server-side; sourced values are provenance-locked; the partial-view marker (6.4) shows when related entities are not visible to the running user.

**Which sections light up per persona** (from the table): RM leads on header + entities + deposits + whitespace; PM and Executive light the full risk/exposure/trend surface; Analyst lights the Boom spread + risk + entities; Credit Officer lights risk with the only approve/reject control; Loan Ops lights exposure (limit/sublimit) + documentation with whitespace hidden; Treasury lights the deposits/treasury wallet + whitespace with credit sections in summary/read-only.

**Multi-entity / household roll-up is DEGRADED-to-single-Account until `groupingKey` is chosen and seeded.** The Connection-graph traversal is the agnostic default (managed-package, works without a household key), with traversal-level sharing checks (6.4). The `cm_Household__c` / `FinServ__Household__c` / `ACNPEX_Relationship__c` groupings are an enhancement that lights up only when the config key is populated. For Piedmont (single entity, no household key set), the cockpit renders the single-Account view honestly: exposure + risk + ownership + whitespace are real; the $0 wallet is the headline next-best-action, not a defect.

**Cross-link to the deal-level credit memo (zoom out ↔ drill in).** From the single-customer 360, a specific Product Package cross-links into the deal-level credit memo (`deal_show_summary` + the memo). The RM/PM read the assembled deal and prior decisions; the Analyst drafts the memo; the Credit Officer reviews and approves; Loan Ops picks up the AFS servicing handoff post-approval. Zooming back out from a memo returns to the relationship 360. The cockpit (Customer 360 server, tools/data) and the memo (experience-mcp, cross-source joins + writes) are complementary surfaces over the same spine, the nCino Product Package id.

**Surface.** The cockpit is served today by experience-mcp as a `ui://` MCP-App (exact brand, server-side fetch of external sources); the Salesforce-native custom-hosted MCP serves tools/data only. AXL is the native-rendering roadmap track.

---

## 8. Open questions

1. **Identity model (BLOCKING, Section 6.1).** Run-as-user vs service-account-with-explicit-scope. Until locked, no persona's "sharing is the floor" claim is guaranteed. Decide before build; this gates every persona's book derivation and the entire security floor.
2. **OWD + hierarchy-grant per object (BLOCKING-adjacent, Section 6.2).** Verify actual OWD on Account, Product Package, Loan, Deposit, Profitability, Relationship Risk Review and the "Grant Access Using Hierarchies" flag; set `sharingModelGrantsHierarchyRollup`. If permissive, persona narrowing is UX-only, not a boundary.
3. **Grouping key for relationship roll-up.** Connection-graph (default) vs `cm_Household__c` vs `ACNPEX_Relationship__c` vs `FinServ__Household__c`. None populated for Piedmont. Multi-entity household 360 is degraded-to-single-Account until chosen and seeded.
4. **Authoritative wallet source per persona.** nCino Treasury/Deposit (lean for C&I, drives Treasury) vs FSC FinancialAccount. Two household groupings must be reconciled before `deposits_and_treasury` relies on either.
5. **Piedmont has no deal team, no officers, no deposits.** Officer/team-based book derivation is untested against real data. Either seed officer/team/deposit data or explicitly scope the demo to the single-entity, sharing-floor-only shape.
6. **Executive aggregation performance.** Book-wide server-side roll-ups (concentration, risk migration) need a defined segmentation model (NAICS / grade band / officer) and a performance budget; may need a materialized / Named-Query path rather than per-request aggregation.
7. **`cm_*` absence in a vanilla nCino+FSC bank.** `portfolioManagerField`, `analystField`, `loanOpsFields` are credit-memo-reinvented dependencies; confirm the documented degraded shape (named-officer layer empty by design → team membership → sharing) is acceptable as the baseline non-`cm_` behavior.
8. **Adjustment-to-grade (Section 4.3).** Confirm whether analyst adjustments feed `deal_covenant_grade`; if so, lock the dual-lineage (sourced vs adjusted) surfacing and the second-person review requirement before an analyst attests their own adjustment.
9. **Macro overlay (descoped from the fleet).** A macro/economic overlay (rates, GDP, unemployment for repricing and renewal timing) is a reasonable future capability for PM / Analyst / Credit Officer / Executive, but no such server or tool exists in the current fleet. It is an aspirational, not-yet-built source; do not anchor any verified persona tool surface to it.
10. **Treasury cross-sell data.** The credit-rich/deposit-poor NBA depends on profitability + deposit data unpopulated for Piedmont; the targeting logic is sound but unverifiable until wallet/profitability records are seeded.
