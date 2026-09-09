# Credit 360 Cockpit — Experience Specification

*Accenture Commercial Credit Brain · Customer 360 MCP · the single-customer relationship cockpit.*
*Anchored to the verified bankinggpt sandbox sweep (2026-06-28): `SCHEMA-VERIFIED.md`, `DATA-MODEL-AND-ROLES.md`, `PERSONAS.md`, `VALIDATION-AND-DECISIONS.md`. Locked decisions: run-as-user + gated admin god-mode; ownership graph = nCino `LLC_BI__Connection__c`; wallet = both sources via config, nCino-commercial-first then FSC; covenants = modern `LLC_BI__Covenant2__c`; collateral = modern `LLC_BI__Loan_Collateral2__c`; per-tenant config must support both legacy and modern generations.*
*Single voice, no em dashes. Every regulated number is deterministic server-side code; the LLM never computes a regulated figure.*

---

## 1. What we are building

### 1.1 The thesis: conclude, do not display

The cockpit is a verdict, not a viewer. It opens a $12.5M manufacturing borrower and says, in one banker sentence, whether the relationship is healthy, how big it is, what the one thing to worry about is, and the single best move to make right now. It does not hand the banker a grid of `LLC_BI__TCE__c`, `LLC_BI__Risk_Rating__c`, and an empty Deposits tab and leave them to do the reading.

Every element on screen must earn its place against one rule: if you would render a table, render the **conclusion the table implies** plus the **drill to the detail** for anyone who wants to audit it. The table is the thing you drill *to*, never the thing you are handed and asked to interpret.

### 1.2 The useful test

Every element on the cockpit must pass three checks:

1. **It answers a question the persona walked in with.** Not a metric they might find interesting. The actual thing in their head when they opened the relationship.
2. **It surfaces what changed or what needs attention.** A snapshot that does not flag the watch item is a screensaver.
3. **It offers an action or a drill.** Conclusion plus next step, every time. A conclusion with no door is a dead end.

If an element fails any of the three, it is cut or demoted behind a drill.

### 1.3 What it is NOT

- **Not an autonomous decider.** It is decision-support under SR 11-7. It concludes, surfaces, drafts, and routes. A human commits every credit action. The two genuinely mutating credit verbs (advance the nCino stage, approve the package) are not cockpit buttons; they fire only on an explicit human committee action.
- **Not a place where regulated numbers are guessed.** Exposure roll-ups, covenant grades, and collateral coverage are deterministic server-side code reading verified fields, mirroring `experience-mcp/boomFinancials.js` where numbers never pass through the model. The LLM ranks and narrates these; it never produces them.
- **Not a sharing bypass.** It runs as the authenticated user, so Salesforce sharing and FLS are the floor on every query. The only floor-bypass is a gated, audited admin god-mode for internal and demo use.
- **Not a generic dashboard reskinned.** If a section reads like a header card with five metric tiles, it has failed the bar and is rebuilt.

---

## 2. Design pillars

1. **Concludes from the whole fleet.** The cockpit reads exposure, wallet, covenants, spread, ownership, and servicing signals across the fleet (nCino, FSC, Boom, Snowflake, AFS) and asserts one opinion. The conclusion is the product; the data is the proof.
2. **Drill-as-provenance.** Every headline is a door. Clicking it descends one provenance level, then the source-of-source, until you hit the system of record. The drill path is the audit trail walked forward by a banker. Lineage (Boom to Snowflake to nCino) is the navigation, not a footnote.
3. **Editable lens, judgment, and narrative; sources locked.** A banker may change how a number is framed, record what they conclude about it, and write the story around it. They may never change the number. The boundary is enforced server-side, not by hiding a button.
4. **Self-learning that ranks, never computes.** The cockpit gets sharper per relationship and across the book by tuning which conclusions surface, in what order, framed how. No learned signal is ever an input to a regulated figure.
5. **Memory: decision ledger plus audit plus recall.** The cockpit remembers why the bank did what it did (the editable decision ledger) and what was done (the append-only audit trail), and warms the next analyst who walks in. Memory informs judgment; it is never the source of a regulated figure.
6. **Policy and regulatory adherence wired into the surface.** SR 11-7 model-risk governance, credit-policy exception testing, KYC/OFAC/PII handling, and the security floor are concrete cockpit behaviors, not a disclaimer footer.
7. **Bank-agnostic via config.** Managed-package namespace plus a per-tenant config map. The same cockpit serves a bank with seeded nCino treasury and a bank running FSC wealth, by config priority, with no code change.
8. **Runs as the user, with a gated admin mode.** Per-user OAuth so the platform enforces sharing and FLS; a permissioned, audited god-mode is the single intentional exception.

---

## 3. The cockpit sections

The cockpit is **seven sections**: relationship header plus verdict, entity and ownership graph, exposure plus collateral, deposits/treasury plus share-of-wallet, financial spread (Boom snapshot), risk plus covenant compliance, and whitespace/next-best-action plus alerts/EWS. Early drafts enumerated eight by splitting whitespace from alerts; the contract fuses them, because a banker thinks "what do I do about this relationship" from the upside and downside at once. Seven sections, six read tools (`customer_360`, `relationship_entities`, `relationship_exposure`, `deposits_and_treasury`, `relationship_risk`, `relationship_opportunities`) plus the Boom spread surface.

Each section is one contract: **Question / Conclusion / Evidence and drill path / Actions / Per-persona variation / Data anchors.** The Data anchors block is a provenance appendix: each field entry carries a one-clause "what it concludes or why it is load-bearing." Fields cited inline in the evidence are not re-listed.

---

### 3.1 Relationship header plus verdict (including profitability)

**Question.** "In one breath: is this relationship healthy or not, how big is it, what is the one thing I should worry about, and what is the single best move I can make right now?"

**Conclusion.** The header asserts one banker-grade sentence with the watch item and the next-best-action baked in. For Piedmont:

> "Piedmont Precision Components, Pass/Watch (Grade 5), $12.5M committed / $4.25M drawn across 3 facilities. Holding, but margin is the story: EBITDA compressed to 8.1% from ~11% and the DSC covenant cushion is the thinnest in the package at 1.42x against a 1.25x floor. Biggest move on the table: this is a $12.5M credit with a $0 operating wallet, win the deposits and treasury."

The four things the persona walked in with, in one sentence: rating (Pass/Watch, Grade 5), exposure ($12.5M / $4.25M, trust the package rollup), the single watch item (margin compression, surfaced as the *why* behind the thinnest covenant cushion, not a list of all four covenants), and the headline next-best-action (the $12.5M-credit / $0-wallet gap).

The profitability lens is the second clause, and it is honest about absence: for Piedmont, profitability is empty (0 records), and **empty is not zero, it is "unmeasured."** The header asserts "relationship profitability is unmeasured, we earn spread on $4.25M of credit and capture none of the operating economics, because there is no deposit, treasury, or fee relationship to measure." The absence of a profitability record is itself the conclusion, and it points at the same lever as the exposure verdict.

For **Timothy Norton Household** the same header concludes differently, because the data supports it: "$910,800 in deposits across the household, linking Timothy Norton (owner) and Smart Snacks (operating business). Deposit-led relationship; the verdict and next-best-action live on the wallet side." Piedmont proves the credit verdict and the wallet gap; Timothy Norton proves the household and wallet verdict Piedmont structurally cannot.

The verdict sentence is generated from deterministic inputs, but the prose lens is editable. The numbers inside it (8.1%, 1.42x, $12.5M, Grade 5) are sourced and locked.

**Evidence and drill path.** Beneath the verdict sits a thin evidence rail, a row of claims each carrying its own drill (conclusion plus where it came from plus click to go deeper). Each drill carries the verdict's framing forward, so the banker lands on an answer, not a fresh table:

1. **Rating: Pass/Watch (Grade 5).** Click and you land on the conclusion "Grade 5 is supported by coverage, not margin, DSC 1.42x is the binding covenant, Snowflake PD lineage attached", not on a generic risk tab. Source: `LLC_BI__Product_Package__c.LLC_BI__Risk_Rating__c` ("5"). Source-of-source: Boom to Snowflake to nCino, the grade is the deterministic output of the covenant/risk engine.
2. **Exposure: $12.5M / $4.25M, 3 facilities.** Drill lands on the facility-by-facility view with the limit/sublimit structure explained. Source: package `LLC_BI__TCE__c` / `LLC_BI__Outstanding__c`, the nCino package rollup computed server-side. Lineage badge: "nCino Product Package rollup (limit/sublimit-netted)."
3. **The watch item: margin to cushion.** The smartest drill. The headline names margin (Boom) but ties it to covenant cushion (nCino). Drill forks: into the Boom spread for the 11% to 8.1% trend and leverage 3.85x / ~4.8x pro forma; and into the covenant detail showing DSC 1.42x vs 1.25x is the binding one. The covenant grade itself is `deal_covenant_grade`, deterministic threshold times actual.
4. **The wallet gap / profitability: $0.** Drill lands on the empty wallet so the banker sees the whitespace, framed as "unmeasured operating relationship", not a blank panel. Source: zero rows in `LLC_BI__Deposit__c`, `LLC_BI__Treasury_Service__c`, `LLC_BI__Profitability__c`. The "$0" is a conclusion the server reached by finding zero rows.

Provenance-as-UI: every anchor carries its vendor attribution chip (Boom / Snowflake / nCino); the real vendor identity appears only on click-through. Partial-view honesty: if the running user cannot see a connected entity, the rollup reflects the omission and the header shows "partial view, N related entities not visible to you", never a silently dropped number.

**Actions.**
- **Drill** each evidence anchor to its section, carrying the verdict framing.
- **Lens-change** the profitability/economics lens between credit view, wallet view, and net relationship view ("unmeasured" when no Profitability record). A selection choice; never edits a sourced figure.
- **Annotate** the prose verdict ("margin is the story") as editable narrative; sourced numbers stay locked.
- **Capture-decision** ("this verdict is correct / I disagree") writes a `record_decision`, proposed-not-committed, logged with server-set actor and timestamp the agent cannot override.
- **Draft-narrative** ("use this verdict as the credit-memo executive summary seed") hands the assertion with locked numbers and lineage to `ncino_deal_prep`.
- **Schedule / trigger** the headline NBA: **stage a draft cross-sell opportunity for human confirmation** (never auto-create the `Opportunity` record), or route to the Treasury queue, or set a watch-trigger on the DSC cushion. Decision-support only; the human commits.

**Per-persona variation.** Same spine; the verdict emphasis, the lens default, and write-capability change by config, not seven code paths.
- **RM / Loan Officer** (full, default). Verdict leads with relationship plus NBA. Profitability lens defaults to net relationship / wallet. Can annotate, capture relationship judgment, stage the wallet opportunity. Read-only on every sourced figure.
- **Portfolio Manager** (full). Verdict leads with the watch item and trend. Lens defaults to credit economics. May propose decisions, set the DSC watch-trigger; no grade write.
- **Credit Analyst / Underwriter** (full, feeds the memo). Verdict is the executive-summary seed; strongest drill into Boom. Number changes are first-class adjustment records, never in-place edits; an adjustment that moves the grade is flagged for officer challenge.
- **Credit Officer / Approver** (full, the only persona with approve/reject wired off this verdict). Verdict framed for effective challenge. Can approve/reject (`ncino_approve_package`) and record rationale, and only those writes. Authorization enforced in Salesforce against the acting user. A Chief Credit Officer resolves here, never to the read-only Executive.
- **Treasury / Cash-Management Officer** (full, deposit/treasury revenue lens). The wallet gap is the headline. FLS may deny NII; if so the profitability total is shown wallet-side only, never an NII-inclusive total the profile cannot see. For Timothy Norton Household this persona sees the populated $910,800 verdict.
- **Loan Operations / Servicing Officer** (full; whitespace/NBA hidden, exposure emphasized). Verdict strips to structure. Read-only on sourced figures; authors documentation notes only.
- **Portfolio / Credit-Risk Executive** (full, book-aggregate). Opens on the book roll-up where this header is one ranked line; read-only oversight, no per-deal write.

**Data anchors (provenance, with conclusions).**
- `LLC_BI__Product_Package__c.LLC_BI__Risk_Rating__c` ("5") and Stage — the rating of record; package `a5Fbb000000HA1NEAW`.
- `LLC_BI__Product_Package__c.LLC_BI__TCE__c` / `LLC_BI__Outstanding__c` — the $12.5M / $4.25M verdict numbers; trust these over any loan sum.
- `LLC_BI__Profitability__c` (0 rows for Piedmont) — empty is the evidence the relationship is unmeasured, not "$0".
- Denormalized rollups (`Committed_Direct_Exposure__c`, `Total_Deposits_at_Bank__c`, `FinServ__TotalBankDeposits__c`) — **unpopulated for Piedmont; header computes from children, never trusts these.** Exception: Timothy Norton Household `FinServ__TotalBankDeposits__c` = $910,800 *is* populated and drives that verdict.
- Watch item: EBITDA margin and leverage from **Boom** (`boom_get_spread`, not an SF field); covenant cushion from `LLC_BI__Covenant2__c.LLC_BI__Last_Evaluation_Value__c` vs `LLC_BI__Financial_Indicator_Value__c`; grade from `deal_covenant_grade`.
- Config knobs: `walletSource` (governs whether the wallet clause reads commercial or FSC; FSC lights up in this org); covenant generation (modern `Covenant2`, legacy empty, support both per tenant); `groupingKey` (Connection graph; Piedmont resolves to the 2-node Piedmont / Margaret Holloway scope); `recordTypeDevNames` (anchor tolerates `Business` OR `IndustriesBusiness`).

---

### 3.2 Entity and ownership graph

**Question.** "Who am I really lending to, and where is the structure thin?" Specifically: who carries the risk, who actually backs it, where the concentration sits, and what changed.

**Conclusion.** For Piedmont the section asserts:

> "Single operating company, 100% owned and fully guaranteed by one individual principal. The entire $12.5M credit rests on Margaret Holloway. No corporate co-obligors, no affiliate diversification, concentration risk is the structure itself, and it is mitigated only by her unlimited full-note personal guaranty."

Supporting clauses, each a sentence: sole operating-company borrower; 100% held by a single individual; personally and fully guaranteed (full-note, unlimited); and the structural verdict that owner = guarantor = single point of both control and recourse (a credit positive, the owner is fully on the hook, and a concentration negative, key-person risk is total). The section names that tension rather than burying it.

For **Timothy Norton Household** the conclusion inverts: "multi-node household, an individual principal tied to an operating business under one household roof, relationship value split across a person and a company." Same section, opposite conclusion: Piedmont concludes concentration, Timothy Norton concludes distribution.

**Evidence and drill path.** Three conclusions, each backed by a verified object and drillable to its system of record. **The diagram renders only when node count exceeds two; below that the sentence is the graph.** For the 2-node Piedmont case the section renders the concentration verdict plus the key-person flag, no two-box picture. The node-edge diagram is reserved for genuinely multi-entity structures (3+ nodes, holding-company layers) where the eye actually needs it.

1. **Single operating-company borrower.** Source: `LLC_BI__Legal_Entities__c` (`LLC_BI__Borrower_Type__c`, `LLC_BI__Entity_Type__c`). Source-of-source: nCino deal structuring.
2. **100% owned by one individual.** Source: `LLC_BI__Connection__c` (`LLC_BI__Total_Direct_Indirect_Ownership_Percent__c` = 100). Source-of-source: KYC / beneficial-ownership intake recorded onto the Connection edge (KYC detail gated to credit/compliance personas).
3. **Fully guaranteed, unlimited, full-note.** Source: `LLC_BI__Legal_Entities__c` (Borrower_Type Guarantor, Entity Type Individual, Guaranty "Amount of Note"). A guaranty is a distinct edge from ownership; the section never conflates the two.

Partial-view integrity: every related-entity node is re-checked against the running user's sharing before it is drawn; entities the user cannot see are omitted with a "partial view, N related entities not visible to you" marker. For Piedmont (2 visible nodes, both shared) the marker is absent. Provenance lock: ownership %, guaranty amount, entity type, and role are sourced and read-only.

**Actions.** Drill node to Account, edge to `LLC_BI__Connection__c` / `LLC_BI__Legal_Entities__c`, borrower to the Exposure section and the deal memo (`deal_show_summary`). Lens-change between ownership, guaranty, risk-concentration, and household lenses (the risk-concentration lens for Piedmont reads "100% key-person concentration on Margaret Holloway"). Annotate (key-person note). Capture-decision (`record_decision`: "accept 100% key-person concentration given the full-note guaranty plus collateral to ~$10M; require key-person life insurance as condition"). Draft-narrative (the Ownership and Guaranty Structure paragraph). Schedule/trigger (watch a new Connection edge, an ownership-% shift, or a guarantor add/remove/release, all material on a single-guarantor credit).

**Per-persona variation.** Entities is full for RM / PM / Analyst / Credit Officer, summary for Loan Ops / Treasury / Executive. RM reads the structure as meeting context; PM reads it as a concentration / early-warning lens across the book; Analyst writes the Ownership and Guaranty Structure narrative and sees beneficial-ownership detail (KYC-gated); Credit Officer performs effective challenge on the concentration and holds the only approve/reject; Loan Ops reads a condensed view for booking accuracy; Treasury reads it to find where the operating wallet should sit; Executive reads structure in aggregate. PII fence applies to every persona: name, role, ownership %, entity type, guaranty amount only; never SSN/TIN/DOB/personal-address.

**Data anchors (provenance, with conclusions).**
- `LLC_BI__Connection__c` (208 edges org-wide) — the authoritative, populated 100%-ownership edge; lead with the Connection-vs-FSC-AAR population distinction (208 vs 8 edges), it is the reason Connection is the default graph.
- `LLC_BI__Legal_Entities__c` — the full-note guaranty edge (Borrower vs Guarantor, Entity Type, `LLC_BI__Guaranty_Amount__c`); two different edges from Connection, never conflated.
- `FinServ__AccountAccountRelation__c` (FSC, 8 edges) — enriches household-member role semantics (Owner / Household Member / Business Owner) where present; enriches, never replaces, Connection.
- Config knobs: `groupingKey` (Connection default; `cm_Household__c` / `ACNPEX_Relationship__c` / `FinServ__Household__c` optional, none set for Piedmont so it honestly renders the 2-node graph); `recordTypeDevNames` (`Business` OR `IndustriesBusiness`); `exposureExclusionFields` (excluded entity shown in structure but flagged out-of-exposure; absent, defer to package rollups). The graph carries no LLM-computed regulated figure.

---

### 3.3 Exposure across facilities plus collateral coverage

**Question.** "How much of this customer's money is at risk, how much could be, and am I covered if it goes wrong?" Committed vs outstanding vs available, the one true number (not the sum of the loan tiles), where the risk concentrates, and whether the lendable collateral covers it.

**Conclusion.** For Piedmont:

> "$12.5M committed, only $4.25M drawn, a 34%-utilized revolver-led book, and it is fully covered: ~$10M of lendable collateral on a blanket UCC plus PMSI, 1st lien, behind credit that nets to a secured position. The exposure is real but well-structured and well-secured; the risk here is not loss-given-default, it is the margin compression eating the cushion."

Each clause is a conclusion with a drill:
- **Trust the rollup, not the tiles.** The three facilities ($5M, $5M, $7.5M) sum to $17.5M of limits, more than the $12.5M package commitment, because of the limit/sublimit structure. The section leads with the package truth (TCE/TBE/TOE $12.5M / $12.5M / $4.25M) and shows the per-facility amounts underneath, labelled as structure, never re-summed. **The verified files state the bare amounts and the label "limit/sublimit"; they do not specify which loan is the limit vs the sublimit. The section states the netting fact ("$17.5M of limits net to $12.5M TCE via limit/sublimit structure, trust the rollup") and drills the wiring to `LLC_BI__Is_Limit__c` / `LLC_BI__Is_Sublimit__c` rather than asserting a specific wiring.**
- **Committed is not outstanding.** $8.25M undrawn and available; a single revolver draw can move outstanding by millions overnight. The undrawn line is the live contingent risk.
- **Covered, with a caveat.** ~$10M lendable against $12.5M committed = ~80% coverage on the full commitment, but more than 100% coverage on the $4.25M actually outstanding.
- **Do not count the dress-up.** Pledges flagged `Abundance_of_Caution__c` or `Is_Excluded__c` are struck from the lendable total with the reason shown.

For **Timothy Norton Household** this section is quiet by design and says so: "No commercial facilities; this is a deposit plus wealth relationship ($910,800). Exposure 360 is the wrong lens here, see Share-of-Wallet." The honest "nothing to conclude here, go there" is the conclusion, the inverse of Piedmont's gap.

**Evidence and drill path.** Top line: committed / outstanding / available as a single deterministic rollup from `LLC_BI__Product_Package__c`, computed server-side, never by the LLM.

Per-facility: the section **face shows only the per-facility conclusion** ("Revolver, $5M, 0% drawn, the live contingent risk") plus the structure annotation ("sublimit, not additive"). The seven-field backing set (`LLC_BI__Total_Facility_Amount__c`, `LLC_BI__AmountOutstanding__c`, `LLC_BI__Principal_Balance__c`, `LLC_BI__Amount_Available__c`, `LLC_BI__UNGTD_Exposure__c`, `LLC_BI__Maturity_Date__c`, `LLC_BI__Risk_Grade__c`) lives strictly behind the click; it is the audit drill, never the rendered content.

Collateral: coverage shown as "~$10M lendable vs $12.5M committed, 80% coverage", backed by `LLC_BI__Loan_Collateral2__c` (modern; legacy `LLC_BI__Loan_Collateral__c` empty, never read). The summed field is `LLC_BI__Current_Lendable_Value__c` (value times advance rate), not raw value, excluding `Abundance_of_Caution__c` / `Is_Excluded__c`. Asset detail drills to `LLC_BI__Collateral__c`, valuation history to `LLC_BI__Collateral_Valuation__c` ("is this appraisal stale?"), ownership/lien to `LLC_BI__Account_Collateral__c` (where the blanket UCC plus PMSI on the 3 Mazak machines resolves, and the 20%-shared asset shows partial ownership).

Source-of-source: Boom to Snowflake to nCino on click-through; facility limits, outstanding, and rollups are nCino systems of record. Provenance lock: every number read-only; an analyst who disagrees files an adjustment record, never an in-place edit.

**Actions.** Drill facility to loan to pledge to asset to valuation to ownership; cross-link a Package into the deal memo (`deal_show_summary`). Lens-change committed/outstanding/available, gross/net (UNGTD), collapse/expand limit-sublimit, include/exclude participations, coverage-on-committed vs coverage-on-outstanding (the 80% vs >100% toggle). Annotate ("PMSI Mazak appraisal is 14 months old, order revaluation"). Capture-decision (`record_decision`, proposed-not-committed; read-only personas server-rejected). Draft-narrative (the exposure and collateral memo section). Schedule/trigger ("alert if outstanding crosses 70% of committed", feeds afs-mcp `revolver_utilization`; "flag any collateral valuation past 12 months stale").

**Per-persona variation.** RM (summary, conclusion only, read-only); PM (full, with utilization trend); Analyst (full, every pledge and advance rate, files adjustment records, no approval); Credit Officer (full, the only approve/reject control, `ncino_approve_package`, enforced against the acting user); **Loan Operations (full, limit/sublimit setup depth, the booking persona, see 4.5)**; Treasury (summary, exposure only as cross-sell context, FLS-restricted on deep credit fields); Executive (full, concentration lens, aggregated not per-facility, read-only oversight).

**Data anchors (provenance, with conclusions).**
- `LLC_BI__Product_Package__c` (`TCE__c` / `TBE__c` / `TOE__c` / `Outstanding__c` / `Total_Loan_Facilities_Amount__c`) — the spine; already nets limit/sublimit, trust it.
- `LLC_BI__Loan__c` (facility detail fields) — per-facility drill only, never naive-summed into the total.
- `LLC_BI__Loan_Collateral2__c` — modern, used; `LLC_BI__Current_Lendable_Value__c` is the field summed; exclude `Abundance_of_Caution__c` / `Is_Excluded__c`.
- `LLC_BI__Account_Collateral__c`, `LLC_BI__Collateral__c`, `LLC_BI__Collateral_Valuation__c` — ownership, asset type, valuation freshness (drill targets).
- `LLC_BI__Participation__c`, `LLC_BI__Excluded_Exposure__c` — exposure adjustments (verified).
- Config knobs: `exposureExclusionFields` (`Exclude_From_Account_Exposure__c` / `Exclude_From_Product_Package_Exposure__c`, optional; absent, trust the package rollups, no silent miscalc); collateral generation (modern `Loan_Collateral2`, support both per tenant); `groupingKey`; `recordTypeDevNames`. Any `cm_*` denormalized exposure rollup is config-mapped (not yet schema-verified), never hardcoded. **The one number to never get wrong: the package rollup $12.5M / $4.25M. If you render the three loans as a $17.5M sum, you have built the table the bar forbids.**

---

### 3.4 Deposits / treasury plus share-of-wallet

**Question.** "Do we own this customer's money, or just their risk?" For a credit-rich customer: where do their operating deposits sit and which treasury services run their cash, and if the answer is "not here", that is the biggest unmonetized opportunity in the relationship. For a deposit-rich customer: how much, how sticky, and what are we not yet capturing.

**Conclusion.** For Piedmont, color-coded by which side is hollow:

> "Credit-only relationship. $12.5M of committed credit, $0 of operating wallet. We carry all the risk and capture none of the cash. This is the number-one next-best-action in the book: win the operating deposits and the treasury suite before the renewal, while the LOC is the leverage."

Then the why and the what: a $64.5M-revenue manufacturer running three facilities through us is moving receivables and payroll somewhere, and zero `LLC_BI__Deposit__c`, zero `LLC_BI__Treasury_Service__c`, zero `LLC_BI__Profitability__c` means none of it is ours.

**Treasury-service gap, the concrete "what's missing".** Lead with the opinionated gap, not an 8-box grid. "Every treasury service is whitespace, but only three matter for an AR-heavy manufacturer: Lockbox plus ACH on the receivables, and Sweep against the $5M revolver so idle operating cash pays the line down instead of sitting at a competitor." The full 8-service checklist (ACH, Lockbox, Wire, Sweep, ZBA, RDC, Reconciliation, Online Banking) renders only on drill. The conclusion is which 3 of 8 to pursue and why, tied to Piedmont's facility structure, never the full checklist as the headline.

For the deposit-rich counter-example the verdict flips to deepen/retain: **Timothy Norton Household**, "$910,800 on deposit across the household, but a wallet we hold, not a fortress, concentrated in deposit/savings, thin on treasury and lending; retain first, then deepen, the business (Smart Snacks) is the cross-sell."

**Evidence and drill path.** Wallet total via `walletSource = both` (nCino-commercial-first then FSC, unioned): Piedmont $0 (both empty), Timothy Norton $910,800 (FSC lights up). Credit-vs-wallet gap bar is the headline visual: $12.5M against $0; the imbalance is the argument. Drill the wallet total to its holdings: nCino `LLC_BI__Deposit__c` plus `LLC_BI__Treasury_Service__c` (preferred for C&I), and FSC `FinServ__FinancialAccount__c` plus `FinServ__FinancialAccountRole__c` (the demonstrable side in this org). Drill a holding to its revenue contribution in `LLC_BI__Profitability__c`. Source-of-source: nCino attribution on balances; the credit side of the bar inherits the Boom to Snowflake to nCino lineage; the two-source `walletSource = both` resolution is shown ("wallet assembled from nCino commercial plus FSC retail/wealth"), so a reviewer sees why $910,800 came from FSC and why Piedmont's $0 is both-sources-empty.

**Actions.** Drill the gap bar into holdings and laterally into the matching `Opportunity`. Lens-change `walletSource` between commercial, retail/wealth, and unified, plus a revenue lens (Treasury default) re-keying to `Net_Treasury_Income__c` / `Deposit_Revenue__c`. Annotate (fenced as untrusted data). Capture-decision (`record_decision`: "pursue full TM suite plus operating deposits at renewal, Sweep against the $5M revolver as the anchor product"). Draft-narrative (the relationship-development paragraph). Schedule/trigger (a renewal-anchored task and add Piedmont to the credit-rich/deposit-poor cross-sell queue; schedules a human's outreach, never moves money).

**Per-persona variation.** RM (full, owns the headline); PM (full, reads wallet as stickiness / retention-risk); Analyst (summary, notes credit-only in the memo); Credit Officer (full read, tests relationship-profitability assumptions behind pricing); Treasury (full, revenue-lens default, opens on the cross-sell queue, FLS excludes any denied component such as NII *before* the roll-up); Executive (summary, book-aggregate deposit concentration and non-credit revenue mix).

**Data anchors (provenance, with conclusions).**
- `LLC_BI__Deposit__c` / `LLC_BI__Treasury_Service__c` — nCino commercial wallet, authoritative for C&I; the "N of 8 / which 3 matter" conclusion reads Treasury_Service; empty in this org.
- `FinServ__FinancialAccount__c` / `FinServ__FinancialAccountRole__c` — FSC wallet, the demonstrable side; Timothy Norton $910,800 rolls up here.
- `LLC_BI__Profitability__c` — **0 rows for Piedmont, which is the evidence the $0 wallet is real (a true zero, not an unread source), not a missing record.**
- `LLC_BI__Product_Package__c.LLC_BI__TCE__c` ($12.5M) — the credit half of the gap bar, supplied by Exposure, not re-summed here.
- `Opportunity` (`LLC_BI__Products_Interested_In__c`, `LLC_BI__Product_Line/Type__c`) — the cross-sell landing.
- Config knobs: `walletSource = both`, nCino-first then FSC (the clearest consumer of this knob in the cockpit; FSC lights up here, Piedmont stays a true $0); `groupingKey` (the household roll-up for Timothy Norton depends on it; Piedmont is a single-Account roll-up); `creditRichDepositPoorRule` (puts Piedmont at the top of the Treasury queue); FLS-before-aggregation (excludes denied Profitability components before the total). Not a covenant- or collateral-generation section; its only generation-style fork is `walletSource`.

---

### 3.5 Financial spread (Boom snapshot)

**Question.** "Do the financials hold up the grade I am about to rely on, and what is moving?" The analyst walks in asking whether revenue, margin, leverage, and coverage support a Grade 5 call, where the soft spot is, and what each ratio decomposes to at the line-item level. The RM and Officer walk in asking for the one-line health read that frames the rest of the cockpit.

**Conclusion.** For Piedmont the spread asserts:

> "Healthy top line, soft middle. Revenue $64.5M, up 7.6% year over year, but EBITDA margin compressed to 8.1% from ~11% in FY2023 and leverage sits at 3.85x, rising to ~4.8x pro forma. The grade is carried by coverage, not margin, and margin is the watch item the whole cockpit keeps pointing back to."

The spread is the *source* of the watch item every other section references. It does not re-grade; it shows the analyst the numbers that the deterministic grade was computed from, and concludes which line is the soft one (margin, not revenue, not coverage).

**Evidence and drill path.** The snapshot leads with the conclusion ratios (revenue, EBITDA margin, leverage, DSC), each drillable. Drill a ratio into the Boom spread: `boom_get_spread` returns `financialStatements[]` (income statement, balance sheet, cash flow) with `lineItems` keyed by `accountCode` and `periodValues`. The EBITDA margin 8.1% decomposes into its statement lines by `accountCode`; the leverage 3.85x / ~4.8x pro forma decomposes the same way. `boom_get_ratios` supplies the computed ratio set; `boom_show_spread` renders the interactive spread tile (the compression curve, not just the endpoint). Period lens flips FY2023 (~11%) against today (8.1%) so the trend is visible, not asserted. Source-of-source: the Boom spread is the system of record for every ratio; the SF mirror `Boom_*__c` carries the same figures inside Salesforce; the spread ties to covenants via `LLC_BI__Covenant2__c.LLC_BI__Linked_Spread_Statement_Record__c`, which is how a covenant actual drills back to the spread period that produced it. Provenance lock: every line item and ratio is Boom's, read-only; an add-back is an analyst adjustment record, never an in-place edit.

**Actions.** Drill any ratio to its line items; cross-link to the covenant that the ratio feeds (DSC to the covenant cushion) and to the Exposure rollup. Lens-change period (FY2023 vs current), dollars vs margin %, which ratios lead. Annotate (a judgment note on the compression). Capture-decision (`record_decision`: the spread thesis behind the rating). Adjustment record (adjusted EBITDA / add-backs as `{value, basis:'analyst-adjustment', rationale, by, asOf}`; if it feeds `deal_covenant_grade`, the grade is computed on both bases with dual lineage and a grade-boundary move is flagged for officer challenge). Draft-narrative (the financial-analysis memo section). Schedule/trigger (watch margin below a threshold or a new spread period landing).

**Per-persona variation.** Analyst (full, deepest of any persona, line-item depth, owns the spread); PM (full, the trend read, 11% to 8.1%, 3.85x to ~4.8x); Credit Officer (full, ratio actuals plus grade evidence for the rating call); RM (summary, "revenue $64.5M, +7.6%, margin compressing" as context, not the line items); Treasury (summary, "healthy enough to justify pursuing the wallet"); Loan Ops (summary or hidden, not their work); Executive (summary, book-aggregate financial health, drill to a single spread on demand).

**Data anchors (provenance, with conclusions).**
- `boom_get_spread` (`financialStatements[]` to `lineItems` by `accountCode` to `periodValues`) — the line-item source every ratio decomposes to; off-Salesforce, the system of record.
- `boom_get_ratios` — the computed ratio set (revenue +7.6%, EBITDA margin 8.1%, leverage 3.85x / ~4.8x pro forma, DSC).
- `boom_show_spread` — the interactive spread tile (the trend, not just the point).
- `Boom_*__c` (SF mirror) — the same figures inside Salesforce for join and lineage.
- `LLC_BI__Covenant2__c.LLC_BI__Linked_Spread_Statement_Record__c` — the tie that lets a covenant actual drill back to its spread period.
- Governance: every figure deterministic and provenance-locked; the LLM never computes a ratio; analyst changes are adjustment records, never in-place edits.

---

### 3.6 Risk plus covenant compliance

**Question.** "Is this credit holding or sliding? How much room before a covenant trips? Does the rating call still defend itself? And if a number looks wrong, where did it come from?" The persona is not asking to see covenants; they are asking the section to conclude whether the relationship is safe and whether the grade is honest.

**Conclusion.** One banker sentence, then the defense. For Piedmont:

> "Grade 5, Pass/Watch, holding, but the watch is real: DSC at 1.42x against a 1.25x floor is the thinnest cushion in the package, and it is thinning because EBITDA margin compressed from ~11% (FY2023) to 8.1% on $64.5M revenue. All four covenants are Compliant today; the question is the next two quarters, not this one."

**The cushion convention is fixed and applied everywhere: headroom relative to the threshold floor.** DSC cushion = (1.42 − 1.25) / 1.25 = 13.6%, shown as ≈14%. The absolute 0.17x is the primary figure; the percentage is secondary. This same convention is used in the header, the whitespace section, and persona 4.2 (no "~12%" variant).

**Evidence and drill path.** The section face renders **only the binding covenant as a conclusion**: "DSC 1.42x vs 1.25x, 0.17x of headroom (≈14%), the only covenant a soft EBITDA quarter trips; the other three are wide." The other three collapse into a single clause: "Debt-to-Worth (2.18 vs 3.0), Min Liquidity ($8.2M vs $5.0M), and Fixed-Asset Purchases ($1.25M vs $7.5M) are all wide, not close." **The four-row threshold/actual/status grid lives behind the drill, never on the face.** The "thinnest is computed, the rest are one line" rule actually holds.

The thinnest ranking is **deterministic and computed on normalized cushion (percent of threshold), not raw deltas** (which would mix ratio deltas and dollar deltas): DSC 13.6% < Debt-to-Worth 27% < Liquidity 64% < Fixed-Asset 83%. DSC is thinnest by the normalized math, surfaced as the conclusion.

The grade is `deal_covenant_grade` (threshold times actual, deterministic, never the LLM). Drill the DSC actual to `LLC_BI__Covenant2__c` (threshold `LLC_BI__Financial_Indicator_Value__c`, actual `LLC_BI__Last_Evaluation_Value__c`, status `LLC_BI__Last_Evaluation_Status__c`, type `LLC_BI__Covenant_Type__r.Name`); then to the spread period via `LLC_BI__Linked_Spread_Statement_Record__c`; then to the Boom line items (the load-bearing lineage, the actual leaves nCino and enters Boom). Per-period history is `LLC_BI__Covenant_Compliance2__c` ("compliant as of when, approved by whom"). Risk wrapper: `LLC_BI__Relationship_Risk_Review__c`. Legacy/modern guard: read `LLC_BI__Covenant2__c` (628 org-wide), never legacy `LLC_BI__Covenant__c` (0 records).

**Actions.** Drill the binding covenant to its definition, to the spread period, to the Boom line items, to the per-period history, and the grade to its `deal_covenant_grade` breakdown. Lens-change as-of period, absolute vs relative cushion, sourced-only vs sourced-plus-adjusted grade basis. Annotate / draft-narrative (the risk narrative; sourced numbers locked). Capture-decision (`record_decision`, the rating-call WHY). Analyst adjustment (an add-back as a first-class record; if it moves a Pass/Watch/Breach grade it is flagged for officer challenge and blocks same-analyst self-attestation). Approve/reject (Credit Officer only, `ncino_approve_package`, gated server-side against Loan Approver permission). Schedule/trigger (a watch flag and a next-evaluation reminder keyed to `LLC_BI__Frequency__c`; subscribe to early-warning when DSC drifts toward the watch band).

**Per-persona variation.** RM (read-only, the one-sentence verdict); PM (full, the four-covenant cushion with trend, may propose, no grade write); Analyst (full, the load-bearing drill to the spread period, files adjustments, no approval); Credit Officer (full, the only approve/reject, separation of duties enforced); Treasury (read-only, the verdict as cross-sell context, FLS-before-aggregation); Executive (full, read-only oversight, aggregated watch/breach counts from the same deterministic grade, never an LLM tally).

**Data anchors (provenance, with conclusions).**
- `LLC_BI__Covenant2__c` — modern, 628 org-wide and populated; legacy `LLC_BI__Covenant__c` = 0 rows, never read it. Threshold/actual/status/frequency/type fields cited inline.
- `LLC_BI__Covenant_Compliance2__c` — per-period history ("compliant as of when, by whom").
- `LLC_BI__Account_Covenant__c` / `LLC_BI__Loan_Covenant__c` — the Account and Loan junctions to Covenant2.
- `LLC_BI__Relationship_Risk_Review__c` — the relationship-grain risk wrapper.
- `LLC_BI__Product_Package__c.LLC_BI__Risk_Rating__c` ("5"), `LLC_BI__Loan__c.LLC_BI__Risk_Grade__c` — deal and loan grades.
- `deal_covenant_grade` (experience-mcp) — the deterministic grade; the LLM never computes it.
- Config knobs: `watchThresholdPct` (the most load-bearing knob, turns Compliant-but-thin into a Watch flag); covenant generation (support both per tenant); `personaResolution` (approval-capable role wins the approve/reject control); FLS-before-aggregation; `sharingModelGrantsHierarchyRollup` (gates the Executive/PM book-level roll-up; when false/unknown, collapses to own book). Note: the covenant operator threshold direction is read from `LLC_BI__Covenant2__c` evaluation fields; any explicit "operator >=" field name is illustrative, not schema-verified.

---

### 3.7 Whitespace / next-best-action plus alerts / EWS

**Question.** "Given everything else on this screen, what is the single most valuable, most time-sensitive thing I should do about this relationship, and what is about to go wrong if I do not?" Whitespace is the upside action; EWS is the downside action; the section ranks them against each other because a banker does not separate "grow this" from "protect this".

**Conclusion.** One asserted upside, one asserted downside, ranked, each a sentence and an action.

Upside (Piedmont):
> "Win Piedmont's operating deposits and treasury. We hold $12.5M of committed credit and $4.25M outstanding, and $0 of their operating wallet. This is the largest unclaimed wallet on a performing Grade 5 relationship in your book. Open the conversation against the revolver; their borrowing rhythm runs through an account they keep somewhere else."

Downside (the EWS conclusion):
> "Watch the margin, not the covenants, yet. All four covenants are Compliant, but DSC is the thin one at 1.42x against a 1.25x trigger, a 0.17x cushion (≈14%). EBITDA margin compressed from ~11% (FY2023) to 8.1%, and leverage is 3.85x heading to ~4.8x pro forma. Margin is the lever under DSC; if it slips another point, the thinnest covenant is the first to go. This is a watch, not a breach, schedule the conversation now."

The cushion ranking is **normalized to percent-of-threshold** (DSC 13.6% < Debt-to-Worth 27% < Liquidity 64% < Fixed-Asset 83%), the same convention as 3.6; no mixed-unit comparison.

Renewal / review clock, asserted only if real, tied to a dated action with leverage:
> "The 2027 revolver maturity is the wedge for the wallet play: open the treasury cross-sell now while they still need the renewal; the 2031 equipment term is out of scope."

The conclusion is the sequencing move (renewal timing into cross-sell leverage), not a restatement of maturity dates. No countdown is invented where the data does not support one.

For **Timothy Norton Household** the section inverts: "this household banks here ($910,800), but carries no credit; the whitespace is the other direction, the operating business (Smart Snacks) is a lending prospect sitting inside a deposit-rich household; lead with the relationship."

**Evidence and drill path.** The whitespace conclusion drills to the exposure side ($12.5M from `LLC_BI__Product_Package__c`, nCino lineage) and the wallet side (the zero, in both nCino `LLC_BI__Deposit__c` / `LLC_BI__Treasury_Service__c` and FSC `FinServ__FinancialAccount__c`, the drill *shows the absence as evidence*), and to the `Opportunity` (with `LLC_BI__Days_at_Current_Stage__c` driving an "aging, N days at stage" sub-conclusion). The EWS conclusion drills to the covenant cushion (deterministic `deal_covenant_grade` over `LLC_BI__Covenant2__c`), to the margin trend (Boom `boom_get_ratios` / `boom_get_spread`, rendered via `boom_show_spread`), and to servicing signals (afs-mcp `revolver_utilization`, `payment_history`) that corroborate or contradict the trend. Provenance-locked: lens, ranking dimension, and narrative are editable; sourced numbers are not. Memory may surface "last quarter we flagged margin too" via `recall_decisions`, but memory is never the source of the 8.1% (always re-read from Boom).

**Actions.** Drill any conclusion's evidence in place. Lens-change the ranking dimension (revenue-at-stake, risk-velocity, renewal-clock, fee-income upside), per-persona config. Annotate (fenced as untrusted data). Capture-decision (`record_decision`: accept/defer/dismiss an NBA, proposed-not-committed, the loop through which the cockpit learns which NBAs land). Draft-narrative (a treasury talking-track or a watch-memo paragraph). Schedule/trigger: stage a draft opportunity for human confirmation, set a covenant-watch reminder keyed to `LLC_BI__Frequency__c`, or kick the renewal package-prep. Within the SR 11-7 fence, these stage or route a human action; none commits a credit action autonomously, and the DRAFT-until-committee banner persists on anything touching the credit decision.

**Per-persona variation.** RM (full, home section, whitespace leads, ranked by revenue-at-stake, EWS as relationship context); PM (full, inverted, EWS leads ranked by risk-velocity, sets the watch-trigger); Analyst (summary, underwrites against the EWS, drafts the watch paragraph); Credit Officer (summary, reads the EWS to test the rating call); Treasury (full, the whitespace is their book, ranked by fee/net-treasury upside, drills the treasury-service-by-service gap, FLS-gated on NII); Executive (summary, aggregate-first, "$X of unclaimed wallet across N credit-only relationships" and "N relationships on margin-watch").

**Data anchors (provenance, with conclusions).**
- `Opportunity` (`LLC_BI__Products_Interested_In__c`, `LLC_BI__Days_at_Current_Stage__c`) — the whitespace landing and the aging signal.
- `LLC_BI__Product_Package__c` (`TCE__c` / `TOE__c` / `Outstanding__c`) — the credit half of the gap.
- `LLC_BI__Deposit__c` / `LLC_BI__Treasury_Service__c` / `FinServ__FinancialAccount__c` — the wallet half / the zero (the absence is the evidence).
- `LLC_BI__Profitability__c` — the revenue-at-stake on the cross-sell.
- `LLC_BI__Covenant2__c` (fed to `deal_covenant_grade`), `LLC_BI__Loan__c.LLC_BI__Maturity_Date__c` (renewal clock), `LLC_BI__Relationship_Risk_Review__c.Performing_Status__c` (watch-list status).
- Boom (`boom_get_ratios` / `boom_get_spread`) and afs-mcp (`revolver_utilization`, `payment_history`) — the driver and the corroborating servicing signals.
- Config knobs: `walletSource` (the second-clearest consumer; the whitespace conclusion only fires if both configured sources are empty/low, so it decides "win the wallet" vs "the wallet is won"); `creditRichDepositPoorRule`; `watchThresholdPct` (promotes DSC to the EWS headline); covenant and collateral generations (modern, support both); `cockpitSectionVisibilityMap` (per-persona visibility and default ranking dimension).

---

## 4. The personas

A persona is a question someone walks in with, a conclusion they are entitled to reach, and the action that unlocks. Two facts every persona inherits: sourced numbers are deterministic and provenance-locked for everyone (what differs is which conclusion the cockpit draws, not the numbers); and the book is exactly what Salesforce sharing grants the running identity. Visibility is config (`cockpitSectionVisibilityMap`, `writeToolSurfaceMap`), the consequence of the question/conclusion/action design, enforced server-side, never just hidden.

**Grounded in real practice (full role reference: `ROLE-REQUIREMENTS.md`).** These personas map to how the jobs actually work in a US commercial bank, not abstractions. The RM is now measured nearly as much on deposit and treasury revenue as on loan production, which is exactly why the $0-wallet conclusion is the headline and not a buried tab. The Credit Analyst loses on the order of 1,300 hours a year re-stitching one borrower across four-plus systems, which is the entire reason the cockpit assembles the relationship once. The Portfolio Manager, Credit Officer, and Executive are deliberately incentivized on quality and timeliness and NOT on production, which is why the same shared data leads with deterioration, cushion, and concentration for them and with whitespace for the producers. The cockpit holds the resulting role tensions (RM/TMO growth vs PM/Officer/Exec credit discipline; analyst development vs officer validation; PM-proposes vs officer-commits; ops execution-gate vs credit authority) with persona-scoped verdicts over one shared, provenance-locked dataset, never with separate tools.

**Seven personas, one server, one shared book, seven different first sentences:**

| Persona | The question | The conclusion the cockpit owes them | The action it unlocks |
|---|---|---|---|
| **RM / Loan Officer** | "What is this whole relationship, and what is the next move?" | "$12.5M of credit, $0 of wallet, the deposits are the move." | Stage the share-of-wallet opportunity; walk into the meeting with the gap |
| **Portfolio Manager** | "Which of my credits is quietly deteriorating?" | "Piedmont is Pass/Watch on a margin compression; DSC cushion is the thinnest at 1.42x/1.25x (≈14%)." | Flag for watch list; schedule the review before the cushion closes |
| **Credit Analyst** | "Does the spread support the grade I am about to write?" | "EBITDA margin 8.1% down from ~11%, leverage 3.85x (~4.8x pro forma), Grade 5 holds, carried by coverage." | Draft the narrative; log the adjustment plus decision; route for approval |
| **Credit Officer** | "Is this rating call defensible, and is everything attested?" | "Grade 5 is supported, DSC is the binding covenant, every section attested, approvable." | Approve or reject the package; record the rationale |
| **Loan Ops / Servicing** | "What do I stand up, and what is outstanding before I book?" | "3 facilities, limit/sublimit structure, 5 collateral pledges, 1st lien; N booking items open." | Reserve obligation numbers; create the servicing workpackage |
| **Treasury / Cash-Mgmt** | "Where is the operating wallet I am leaving on the table?" | "Credit-rich, deposit-poor: $12.5M exposure, $0 deposits, zero treasury services live." | Stage the treasury cross-sell; sequence Lockbox/ACH/Sweep against the line |
| **Portfolio / Risk Exec** | "Where is my book most exposed, and how is risk migrating?" | "Several of your watch-grade credits rest on a single key-person guaranty; Piedmont is one. Drill to the names." | Drill to the relationship; no per-deal write, oversight only |

**4.1 RM / Loan Officer.** Walks in with "what is the whole relationship and the one move." Cockpit concludes "$12.5M credit, $4.25M drawn, Grade 5, $0 wallet, win the deposits." Acts by staging the cross-sell opportunity (human confirms the create) and reading `deal_show_summary` plus `recall_decisions` to walk in knowing what was decided. Header full and leading; entities full (Holloway, PII-disciplined); deposits full (the absence is the headline); whitespace full; Boom summary; risk read-only.

**4.2 Portfolio Manager.** Walks in with "which credit is deteriorating before it breaches." Cockpit concludes "all four Compliant, but DSC is the binding constraint at 1.42x vs 1.25x (cushion ≈14%), the watch item is EBITDA margin 8.1% from ~11%." (Cushion ≈14% per the fixed convention; not "~12%".) Acts by proposing a watch-list flag and review date (`record_decision`), pulling `revolver_utilization` / `payment_history`. Risk full; Boom plus trend full; exposure full; header/entities/deposits full as context; whitespace full but secondary.

**4.3 Credit Analyst / Underwriter.** Walks in with "does the spread support the grade." Cockpit concludes "spread supports Grade 5, the soft spot is margin (8.1% from ~11%), leverage 3.85x to ~4.8x pro forma, revenue $64.5M (+7.6%) healthy, the rating is carried by coverage." Cannot edit a ratio in place; an add-back is an adjustment record `{value, basis:'analyst-adjustment', rationale, by, asOf}`; if it feeds `deal_covenant_grade` the grade is computed on both bases with dual lineage and a grade-boundary move is flagged for officer challenge; the analyst cannot author an adjustment and attest the same record without second-person review. Acts by drafting (`ncino_deal_prep`), capturing (`record_decision`), routing. Boom plus full spread deepest; risk full; exposure plus entities full; deposits/whitespace summary.

**4.4 Credit Officer / Approver.** Walks in with "is this defensible and attested." Cockpit concludes "Grade 5 supported, coverage carries it, margin compression disclosed and is the standing watch, exposure roll-up consistent, all sections attested, approvable." Reads `recall_decisions` plus `get_audit_trail` for effective challenge; any analyst adjustment that moved a grade boundary is flagged for them. Acts by `ncino_approve_package` plus `record_decision`, the only persona with approve/reject, **enforced server-side against the acting user** (the service tier verifies the Loan Approver permission and named-approver status before the write lands, with SF validation rules enforcing it independently; a read-only persona induced to call approve is rejected, not merely hidden). DRAFT-until-committee holds. The CCO resolves here, never to the read-only Executive (`personaResolution`).

**4.5 Loan Operations / Servicing Officer.** Walks in with "what do I stand up and what is outstanding." Cockpit concludes "3 facilities to stand up: $5M / $5M / $7.5M, limit/sublimit, book to the package not the loan sum; collateral 5 pledges, 80% advance, 1st lien, lendable to ~$10M; N documentation items open." The limit/sublimit warning is load-bearing here because Loan Ops is the persona most likely to mis-book by summing. Acts by `reserve_obligation_number` and `create_workpackage` (afs-mcp), gated to the Loan Ops permission set server-side; if a tenant descopes this persona, these tools are intentionally not surfaced (a deliberate omission). Exposure full with setup depth; collateral full; documentation/checklist full; header full, entities summary; risk read-only, whitespace hidden. **This persona appears in the per-persona blocks of every section where it has non-hidden visibility (Exposure, Header, Risk read-only), reconciled against `cockpitSectionVisibilityMap`.**

**4.6 Treasury / Cash-Management Officer.** A functional overlay on the RM (same UserRole line, differentiated by permission set, the wallet lens, and the credit-rich/deposit-poor filter; `Secondary_Officer__c` is the `treasuryOfficerField` config knob, never a distinct role rung). Walks in with "where is the operating wallet I am not capturing." Cockpit concludes "credit-rich, deposit-poor: $12.5M exposure, $0 deposits, $0 treasury services live, the entire operating wallet is the opportunity." For Piedmont the $0 is real, not a defect; **Timothy Norton Household** is the contrasting demo Treasury needs (the populated $910,800 household). Acts by staging the treasury cross-sell, sequencing services against the revolver (`revolver_utilization`). Deposits/treasury full and leading; whitespace full; header full through the revenue lens; Boom/exposure summary; risk read-only, with NII suppressed if FLS-denied.

**4.7 Portfolio / Credit-Risk Executive.** CEO/COO only, not the CCO. Walks in with "where is my book most exposed and how is risk migrating." Cockpit opens on the book aggregate and concludes at portfolio grain ("several watch-grade credits rest on a single key-person guaranty, Piedmont is one; concentration by entity/NAICS/grade; watch-list drift"). Piedmont appears as one contributor reached by drilling. Acts by drilling portfolio to segment to single-customer 360; no per-deal write or approval. The wide view is legitimate only because Salesforce sharing grants it, and only when the tenant's OWD plus "Grant Access Using Hierarchies" actually rolls subordinate books up (`sharingModelGrantsHierarchyRollup`); where false or unverified, the view collapses to their own book and the cockpit says so. Exposure full at concentration depth; risk full read-only oversight; header full book-aggregate; deposits/Boom/entities/whitespace summary.

---

## 5. Interaction model: drill-down plus editable

The cockpit is a verdict, not a viewer. The interaction model does two things: let a user fall through a conclusion to the evidence and source-of-source (drill-down), and let a user shape how the conclusion is framed and capture judgment (editable), while regulated numbers stay frozen by platform design. Drill-down walks down the provenance chain; editable operates only on the layer above the locked floor. Same wall, two sides.

### 5.1 Drill-down

Every headline is a door, and the door opens its own provenance. Three properties hold on every drill: the number never changes as you descend (the drill reveals the server-side computation already done, never recomputes client-side); the descent is sharing-checked at every level (a drill that would reach an unshared affiliate stops at a "partial view, N entities not visible" marker); and the bottom of every drill is a provenance card naming the system of record, vendor (Boom / Snowflake / nCino), field API name, as-of date, and a click-through to the vendor app.

**The exposure drill:** $12.5M headline to the package (`LLC_BI__Product_Package__c`, "trust this, not the loan sum") to the loans (where the drill preempts the objection: facilities exceed TCE because of the limit/sublimit structure, drill `LLC_BI__Is_Limit__c` / `Is_Sublimit__c` for the wiring) to the collateral (5 `LLC_BI__Loan_Collateral2__c` pledges) to the lendable math (`Current_Lendable_Value__c` = `Collateral_Value__c` times `Advance_Rate__c`, summed, struck where `Abundance_of_Caution__c` / `Is_Excluded__c`). The drill ends at the nCino record.

**The covenant drill:** DSC 1.42x headline (the binding one, the section did the triage) to `LLC_BI__Covenant2__c` (threshold/actual/status, the grade is computed code via `deal_covenant_grade`, never the model) to the spread period (via `LLC_BI__Linked_Spread_Statement_Record__c`) to the Boom line items (`boom_get_spread`, `lineItems` by `accountCode`, where 1.42x becomes "this cash flow over this debt service, these statement lines, this period"). The margin watch item and leverage drill the same way through the same Boom provenance.

**The wallet drill** confirms an absence honestly (`deposits_and_treasury` reads both sources per `walletSource`, returns zero, surfaces "no operating deposits, no treasury services, no relationship P&L, this is the whitespace" and hands off to `relationship_opportunities`). **The ownership drill** stops at structure only (name/role/ownership % from `LLC_BI__Connection__c` plus `LLC_BI__Legal_Entities__c`, never SSN/TIN/DOB/personal-address, even where FLS would permit). **The Timothy Norton wallet drill** demonstrates the populated path (header to FSC `FinServ__FinancialAccount__c` rows to the household grouping). **Cross-surface:** the Piedmont Package cross-links to the deal memo (`deal_show_summary`) keyed on the same Package id; the deal's covenant grade is the same `deal_covenant_grade` output. One number, one provenance, two surfaces.

### 5.2 Editable: three layers and one locked floor

Exactly three editable layers and one locked floor; the boundary is enforced server-side, so a user or a manipulated agent who reaches for a locked value is rejected, not merely un-buttoned.

**The LENS** (how the conclusion is framed, freely editable, per-user per-session, changes presentation never the source): period (DSC and margin at any spread period, FY2023 vs current), ratio selection, dollars vs margin %, committed vs outstanding, wallet source (nCino vs FSC vs union, which is how the same relationship reads "$0" or populated). Logged as a view event; writes nothing to the system of record.

**The JUDGMENT** (the human's call, editable as first-class records never in-place): annotate (free-text, fenced as data); flag watch (the live Piedmont case, the flag sits beside the deterministic Compliant grade, never replacing it); analyst adjustment record (the load-bearing one, `{value, basis:'analyst-adjustment', rationale, by, asOf}`, dual lineage if it touches a grade, second-person review if it moves a boundary, the source number never mutated); capture decision plus rationale (`record_decision` appends the WHY to the package ledger; per the SR 11-7 fence it informs future judgment but is never a source for a figure and never enters the examiner-facing record). Every judgment write is identity-bound to the authenticated session, append-only, with "agent proposed" entries distinct and non-agent-writable from "human confirmed".

**The NARRATIVE** (wholly the human's, fully editable text, DRAFT-until-committee): the analyst drafts and attests; the cockpit may pre-draft prose; section sign-off never promotes to a decision; separation of duties holds (analyst drafts = development, officer approves = validation via `ncino_approve_package`, the only authorized write transition, enforced in Salesforce against the acting user).

**The LOCKED floor** (read-only for everyone, no exceptions, not the analyst, not the CCO, not god-mode which widens visibility not write authority): exposure roll-ups (TCE/TBE/TOE/Outstanding), covenant actuals and thresholds, the covenant grade and risk rating, collateral figures (lendable, advance rate, lien), guarantor figures (100% ownership, full-note guaranty, with PII below structure not returned at all), and Boom line items.

| Layer | Example on Piedmont | Editable? | What an edit does |
|---|---|---|---|
| **Lens** | DSC period; dollars vs margin %; wallet source (nCino vs FSC) | Yes (per-user, per-session) | Reframes presentation; recomputes nothing of record |
| **Judgment** | Flag DSC/margin as watch; EBITDA add-back adjustment; `record_decision` rationale | Yes (as layered records, never in-place) | Adds an attributed sibling record beside the source; dual-lineage if it touches a grade |
| **Narrative** | The credit write-up prose | Yes (authored, attested, DRAFT-until-committee) | Authors text; never a number |
| **Sourced figure** | $12.5M TCE; DSC 1.42x/1.25x; Grade 5; ~$10M lendable; 100% ownership; Boom line items | No, locked for all | Rejected server-side; the only "change" is a layered adjustment record (judgment), never a mutation |

You may change how a number is framed, record what you conclude about it, and write the story around it. You may never change the number. The drill-down proves where every locked number came from; the editable layers add lens, judgment, and prose on top without reaching the floor. The same wall the examiner walks.

---

## 6. Self-learning

The cockpit gets sharper per relationship and across the book by tuning which conclusions surface, in what order, framed how. The one fence that governs everything: **learning moves ranking, surfacing, and framing; learning never moves a number.** The TCE is $12.5M because `LLC_BI__TCE__c` says so; no learning nudges it.

**6.1 Signals (interactions and labels, never financial inputs).** Analyst adjustments to lens/judgment/narrative (captured as a before/after diff, e.g. a pro-forma-leverage note teaches the cockpit to surface that lens earlier on similar deals); decisions plus rationale (an approval conditioned on margin recovery teaches the causal link between the margin-watch flag and the condition); watch flags raised/cleared (hand-labelled supervised signal); view/lens telemetry (a PM who jumps to whitespace on every credit-only relationship teaches "lead with whitespace for credit-only"); approve/reject outcomes (the strongest label, kept distinct between development and validation); which NBAs were acted on vs ignored (a repeatedly-ignored NBA is down-ranked); covenant outcomes vs predictions (a validated watch raises the detector's confidence). None of these is ever a financial input.

**6.2 What improves (ranks/surfaces/frames, never computes).** Sharper conclusions (the header verdict evolves from a generic template to a tuned one; the grade is still read deterministically). Better-targeted NBAs (re-ranked, never re-valued; Piedmont's "win the wallet" stays number one because it converts on credit-only C&I; Timothy Norton's learned NBA is different in kind). Watch-item detection (the detector elevates which true fact becomes a watch card and at what confidence; the card's content, the numbers, is computed). Peer/segment baselines and institutional-memory recall (below). 

**6.3 Peer / segment baselines, pinned and labeled.** The cockpit can frame Piedmont's 8.1% margin against a same-NAICS (332710) cohort. **This baseline is a NEW computed figure on a regulated surface, so it is governed exactly:** it is a deterministic server-side computation (same tier and discipline as `boomFinancials.js`, numbers never through the LLM), over records the running user is already entitled to see; it renders with an explicit, visually distinct label "derived context statistic, NOT a sourced figure, not an input to this borrower's grade/covenant/exposure math" plus its own lineage chip (which cohort, N borrowers, as-of); it is descriptive/ranking-only, never enters the examiner-facing record, and never feeds `deal_covenant_grade`. Any specific cohort range (for example "~10 to 12%") is illustrative pending a real populated 332710 cohort, not asserted as sourced; Piedmont's own 8.1% / ~11% are the only asserted-real figures.

**6.4 The loop and where it is stored.** OBSERVE (capture an interaction event) to APPEND (write to the decision/learning ledger, provenance-stamped) to AGGREGATE (server-side batch, deterministic, the LLM never sums) to INFORM (next render re-ranks/re-surfaces/re-frames, never recomputes) to CLOSE (outcome labels the earlier conclusion). Asynchronous: observe and append live, aggregate in batch, apply at render time as a ranking layer over deterministic data. Stored in the decision/learning ledger (the `record_decision` / `recall_decisions` surface plus a distinct interaction-event class), per fleet SR 11-7 doctrine backed by the auditable Snowflake ledger; memory INFORMS, the ledger RECORDS, and memory is never a source for a regulated figure. Every learned conclusion is DRAFT, editable, a suggestion a human accepts/edits/rejects. Bank-agnostic: keyed on namespace plus config, bucketed per tenant on `NAICS_Code__c` / `Industry` / grouping key; a bank's learned signals never cross into another bank's cockpit.

**6.5 The SR 11-7 fence and the input invariant.** Allowed: re-order sections, promote a converting NBA, surface a watch card first, frame in a prior analyst's words, build a peer baseline for context, suggest a likely committee condition **as a prompt for human consideration** (never a predicted condition pre-populating an approval field or rationale). Forbidden: change any exposure roll-up, adjust a covenant grade or threshold, recompute a margin or leverage, originate a financial input from memory or behavior, feed a peer baseline into a borrower's own math, make the credit decision. **The input invariant:** learning signals are read-only consumers of the deterministic outputs and may only affect ranking/surfacing/framing; no learned signal is ever an input to `deal_covenant_grade`, exposure roll-ups, collateral lendable math, or any sourced field. The only path to influence a grade is a human-authored adjustment record with second-person review, never a learned signal. Three guarantees backstop it: decision-support never autonomous; regulated numbers deterministic and provenance-locked; learning runs inside the sharing floor (as the running user, only records they can see; god-mode the single audited exception).

The hundredth open of Piedmont leads with the same true facts the first had ($12.5M, $0 wallet, Grade 5, 8.1%, 1.42x), ordered and framed by everything the book taught the cockpit about relationships shaped like this one. The numbers are constant; the judgment about which of them matters most, to this persona, right now, is what gets smarter.

---

## 7. Memory: decision ledger plus audit plus recall

The cockpit remembers why the bank did what it did to Piedmont, not just what it shows today. When a different officer opens Piedmont next cycle, the cockpit greets them with "last cycle the team held the rating at 5 because EBITDA-margin compression was judged cyclical, not structural, re-test that thesis" before they read a number. Continuity of judgment across people and time, with the regulated numbers kept rigorously outside the memory.

**7.1 The WHY / WHAT split, two ledgers, never merged.**

The **decision ledger** (the WHY), written by `record_decision`: one entry per judgment, capturing the call ("held risk rating at 5"), the rationale ("margin compressed to 8.1% from ~11% but DSC still cleared at 1.42x and the compression traces to a one-time Mazak retooling, cyclical, hold the grade, flag margin as the watch"), the alternatives rejected ("considered downgrading to 6 on the margin trend, rejected because leverage at 3.85x is inside the Debt-to-Worth covenant and liquidity cushion is wide"), the who/when/role, and the confidence plus revisit trigger ("re-open if EBITDA margin prints below 7% or DSC cushion thins below 1.30x"). Editable institutional opinion, meant to be revised next cycle.

The **audit trail** (the WHAT), written by `log_audit_event`, read by `get_audit_trail`: one append-only row per consequential action, framed around the conclusion it enables, the officer's effective-challenge drill ("who attested what version, when, under which identity, so a downgrade reversal is never silent"). The event taxonomy (attestations, writes to the system of record, state transitions, god-mode entries) lives behind the drill; the trail leads with what it concludes for the reader (examiner-defensibility), not the list of row types.

They cannot be one store: the ledger is mutable prose judgment (radioactive as evidence, perfect as a thinking aid); the trail is immutable structured identity-bound (perfect as evidence, useless for warming intuition). Separating them is what lets the cockpit be opinionated in the ledger and literal in the record an examiner reads.

**7.2 Persistence, tamper-evidence, identity binding.** The decision ledger persists per fleet SR 11-7 doctrine, backed by the auditable Snowflake decision ledger named in that doctrine (attributed there, not asserted as a verified Customer 360 implementation detail), keyed by the relationship anchor (Account `001bb00001DLtRMAA1`) and the package (`a5Fbb000000HA1NEAW`). The **published, examiner-facing memo artifact** is saved separately via `ncino_docman_save`. **The two stores are kept clean:** `record_decision` / `log_audit_event` is the live tamper-evident ledger (WHY/WHAT, decision-support context, NOT examiner-facing data); `ncino_docman_save` is the immutable published memo (the regulated record). Ledger rationale travels alongside the DocMan artifact as decision-support; it is never promoted into a DocMan field and never becomes examiner-facing data. Audit rows should be append-only and tamper-evident (a hash-chain is a recommended implementation, not an asserted property of the verified surface). The load-bearing, verified guarantee is that every entry is identity-bound to the authenticated Salesforce user from the run-as-user OAuth context (the `actorStamp()` discipline hardened, the actor is the authenticated principal, never an agent-supplied parameter); the gated admin god-mode records both the elevated identity and the View-All flag so a god-mode write is never mistaken for an ordinary one.

**7.3 `recall_decisions`, warming the next session.** On open, `recall_decisions(accountId)` runs first and primes the surface: a brand-new analyst sees the prior cycle's held-rating rationale, the rejected downgrade, the named watch item, and the revisit trigger. It surfaces drift, not just history, **and the drift conclusion is owned by the deterministic engine, not memory:** the live DSC cushion is re-read deterministically server-side, the proximity comparison against the stored revisit threshold (`watchThresholdPct` against today's sourced cushion) is the engine's output, and memory contributes only the previously-recorded threshold and rationale. The surfaced "the watch condition you set is now closer" is computed from today's sourced number, never recalled. Recall is cross-analyst by construction (keyed on the relationship, not the user) and obeys the sharing floor (an analyst only recalls decisions on relationships they can see).

**7.4 How memory surfaces inline.** Not a separate history tab; threaded into the section it explains, as a conclusion plus a drill. On the risk section, beside the live Grade 5 and the four Compliant covenants: "Held at 5 last cycle, margin compression judged cyclical (Mazak retooling), thinnest cushion DSC 1.42x vs 1.25x [why drill]" (the grade itself is rendered from the deterministic engine, memory only annotates it). On the exposure/wallet headline: "Treasury cross-sell raised last cycle, deferred pending the credit decision, now unblocked." On Timothy Norton Household: "last review, share-of-wallet judged healthy at $910.8K, hold, do not push." On every transition control, the audit trail is one drill away.

**7.5 The SR 11-7 standing.** Memory informs judgment; it is never the source of a figure (Piedmont's TCE, grade, DSC, lendable collateral are re-derived live from the verified objects on every open, never read back from the ledger; if last cycle's ledger and today's math disagree, the math wins and the discrepancy is a flag). Memory never enters the examiner-facing regulated record as data (per 7.2). Separation of duties is preserved in the memory: the analyst's drafting attestations and the officer's approval attestations are distinct, attributed entries, and the memory makes the effective challenge durable (next cycle's analyst sees not just that the grade held, but that the officer pushed back on the downgrade case and why it was overruled).

---

## 8. Policy plus regulatory adherence

Adherence is wired into what the cockpit renders, refuses to compute, locks, and forces a human to sign.

**8.1 SR 11-7, built into the surface.** Decision-support, never an autonomous credit action: conclusions are framed as findings, drills, and drafts; the two mutating credit verbs (`ncino_advance_stage`, `ncino_approve_package`) are not cockpit buttons, they fire on explicit human committee action; every action-proposing screen carries a "decision-support only, requires officer review" label wired to the human-in-the-loop gate. Effective challenge surfaced as the watch item: Piedmont is Grade 5 with four green covenants, but the cockpit leads with the margin compression and flags DSC 1.42x/1.25x as the thinnest cushion (≈14%), renders the pro-forma leverage delta (3.85x reported vs ~4.8x pro forma), and puts a "Challenge this" affordance on every concluded grade. Deterministic regulated numbers plus full lineage: exposure roll-ups sum verified package fields server-side (mirroring `boomFinancials.js`); the covenant grade is the deterministic threshold-times-actual function; collateral coverage uses `Current_Lendable_Value__c` excluding `Abundance_of_Caution__c` / `Is_Excluded__c`; the $17.5M-of-limits vs $12.5M-TCE trap is handled deterministically (trust the package rollup, the sublimit relationship is a drill, the LLM does not "reconcile" it in prose); lineage is a click on every number. Human-in-the-loop attestation plus DRAFT-until-committee: a persistent DRAFT watermark gates the write-back; attestation is recorded through the audit trail. Development vs validation separation: the analyst drafts (`credit-binder`), a different officer approves (`credit-review`, recall-don't-redraft); the cockpit does not let the same identity both draft and approve the same package.

**8.2 Credit-policy alignment, exceptions as conclusions.** The cockpit tests the deal against policy and renders the result, never a raw policy table. Where Piedmont's real values are known, it concludes against them: advance rate 80%, 1st lien, ~$10M lendable across 5 `Loan_Collateral2` pledges (blanket UCC plus PMSI on 3 Mazak machines), concluded as "$10M lendable supports $12.5M TCE only with the guaranty plus AR." **Where the policy threshold is not in ground truth, the cockpit says so rather than asserting a Piedmont conclusion:** the single-obligor hold limit and the pricing grid require the tenant's policy config (not in this sandbox), so the cockpit concludes pass-or-exception "once configured", not via a hypothetical "if X then it would flag." The covenant package concludes compliance but elevates DSC 1.42x as the policy watch and Fixed-Asset-Purchases ($1.25M used vs $7.5M) as "ample headroom, not a constraint." Pricing for Grade 5 leans on relationship profitability, which for Piedmont is the $0-wallet gap ("priced on credit alone, no deposit/treasury offset, the pricing exception has no relationship cushion to lean on"). Every check renders in-policy (quiet) or exception (loud, elevated-approval-routed, with its mitigant), sourced from the `policy-exceptions` workflow.

**8.3 Provenance lock.** Source numbers are read-only with a lock icon and a lineage link ($12.5M TCE, $4.25M outstanding, DSC 1.42x, EBITDA 8.1%, $910,800); a banker who disagrees disputes it at the source, not in the narrative. Lens, judgment, and narrative are editable and labeled as such, stored separately so an examiner sees where deterministic data ends and judgment begins. Memory informs judgment but is never a source for a regulated figure.

**8.4 Compliance, persona-gated, with empty-not-pass honesty.** KYC/OFAC/sanctions/beneficial-ownership/adverse-media read from `Compliance_Check__c` / `KYC__c` and surface as a clearance conclusion, gated to credit and compliance personas (an RM or sales persona sees that compliance cleared, not the screening detail). **The empty-not-zero discipline applies exactly as it does to the wallet: KYC/Compliance records are not verified present for Piedmont in this sandbox, so the cockpit does not assert "clear." If the objects are unpopulated, the conclusion is "compliance screening not on file, clearance unverified, blocks credit decisioning", not "clear." Clearance is asserted only on real rows.** Beneficial ownership is the real graph and can stay (Margaret Holloway, 100% owner via `LLC_BI__Connection__c`, full-note guarantor via `LLC_BI__Legal_Entities__c`, grounded in the verified 208-edge Connection graph, not a re-keyed attestation). PII/GLBA handling: Holloway and the Timothy Norton principals are PersonAccounts carrying consumer PII; person-level financial detail renders only to personas with consumer-data entitlement, and the run-as-user floor means a banker without sharing on the person record simply does not see it. Household share-of-wallet respects the consumer boundary (a commercial-only persona viewing the linked business does not traverse into the individual's personal accounts unless sharing and entitlement permit).

**8.5 Security floor plus citation-as-UI.** Run-as-user is the floor (per VALIDATION-AND-DECISIONS §1, per-user OAuth, sharing plus FLS platform-enforced on every query, the FLS-before-aggregation and traversal-level checks enforced by the platform not re-implemented; a deliberate upgrade over the memo's service-account-with-audit-stamp model). Admin god-mode is the only floor-bypass, behind an explicit switch plus permission, restricted from real users, every session audited, and visually unmistakable (a persistent elevated-context banner, so you always know whether the $12.5M is yours to see or seen under elevation). Citation-as-UI: every regulated figure is a citation (the number and its source are the same clickable object); the lock-plus-lineage chip is the same component everywhere; combined with the DRAFT watermark and the elevated-context banner, the cockpit's chrome is its compliance posture, adherence you can see at a glance, drill on demand, and audit after the fact.

---

## 9. Credit memo and spreading integration (zoom out and drill in)

The Credit 360 cockpit and the deal-level credit memo are two surfaces over one spine: the nCino Product Package id. The cockpit is the relationship zoom-out, the memo is the deal zoom-in, and Boom is the spreading system of record feeding both. They are deliberately one product, not two that happen to share data. This is the existing fleet architecture extended outward, on the roadmap by design (`docs/roadmap/data-analyst.md`, `risk-analyst.md`), the Customer 360 being the relationship-level twin that complements the memo, never replaces it.

**One spine, two surfaces, no recomputation across the boundary.** The cockpit Exposure and Risk sections key on `LLC_BI__Product_Package__c`; a package cross-links straight into the deal memo via `deal_show_summary` on that same id, and zooming back out from a memo returns to the relationship 360. The covenant grade the memo prints and the grade the cockpit concludes are the same `deal_covenant_grade` output; the exposure rollup is the same package TCE/TBE/TOE; the spread is the same Boom file. One number, one provenance, two views.

**Spreading is shared, not duplicated.** Boom owns the raw line items (`boom_get_spread`, `financialStatements[]` to `lineItems` by `accountCode`), Snowflake derives the ratios, nCino owns the covenant thresholds. The cockpit Financial-spread section (3.5) and the memo financial analysis read the identical Boom spread; the covenant actual on both ties back to the spread period via `LLC_BI__Covenant2__c.LLC_BI__Linked_Spread_Statement_Record__c`. Re-spreading in two places would create two sources of truth; there is one.

**The cockpit seeds the memo.** The header verdict is the executive-summary seed: the same locked numbers and lineage hand to `ncino_deal_prep` so the analyst starts the memo from the relationship conclusion, not a blank page. Analyst add-backs captured in the cockpit flow into the memo as adjustment records with dual lineage; a grade-boundary move flagged in the cockpit is the same flag the officer challenges in the memo.

**The lifecycle hand-off.** RM and PM read the assembled deal and prior rationale (`deal_show_summary`, `recall_decisions`); the Analyst drafts the memo from the 360; the Credit Officer reviews and approves on the package (`ncino_approve_package`); Loan Ops takes the AFS servicing handoff post-approval. The cockpit is where you decide what to do, the memo is where the deal-level work is documented, and both write to the same package and the same append-only audit trail. Decision-support throughout, DRAFT-until-committee, the human commits.

---

## 10. What we build first

**The vertical slice: RM on Piedmont, the sections with real data.** Piedmont's credit, exposure, collateral, covenants, risk, ownership, and the wallet *gap* all read real structured data (verified); only deposits, treasury, and profitability are empty, and that emptiness IS the headline NBA. So the first build is the RM-on-Piedmont path that concludes, drills, and lets you act, on exactly the sections that are populated.

**Slice scope:**
1. **Run-as-user identity** (per-user OAuth, the `sobject-sf` shape) plus the gated god-mode switch with its audit. This is the BLOCKING precondition; nothing renders honestly without it.
2. **Header verdict** ($12.5M / $4.25M / Grade 5 / margin watch / $0-wallet NBA), computed from children, deterministic, provenance-locked, with the four evidence anchors drilling to their conclusions.
3. **Exposure plus collateral** (the package rollup as the spine, the limit/sublimit explanation, the ~$10M lendable math excluding the dress-up).
4. **Risk plus covenants** (the binding-DSC conclusion on the face, the four-covenant grid behind the drill, `deal_covenant_grade` deterministic, the drill to the Boom spread period).
5. **Financial spread** (the Boom snapshot, the margin-compression watch item that every other section references, drilling to line items).
6. **Whitespace/NBA plus EWS** (the $0-wallet upside and the margin/DSC downside, ranked, each with a drill and a stage-a-draft action).
7. **The editable layer plus decision ledger** (`record_decision` / `recall_decisions` / `log_audit_event`), so the slice captures the WHY and warms the next session from day one.

**The sequence after the slice:**
1. **Timothy Norton Household** as the second demo account, lighting the entity/household graph and the populated share-of-wallet (FSC `FinServ__FinancialAccount__c`, $910,800) that Piedmont structurally cannot show. No seeding required.
2. **The remaining personas** (PM, Analyst, Credit Officer, Treasury, Loan Ops, Executive) as config layers over the same server (`cockpitSectionVisibilityMap`, `writeToolSurfaceMap`), each opening on its own first sentence.
3. **The write transitions** (`ncino_approve_package` for the officer, `reserve_obligation_number` / `create_workpackage` for Loan Ops), each gated server-side against the acting user.
4. **Self-learning** (the observe-append-aggregate-inform-close loop and the peer-baseline computation with its provenance label) once enough interaction signal accrues.
5. **The bank-agnostic config map** proven against a second tenant shape (a bank with seeded nCino treasury, so `walletSource` priority lights up the commercial wallet with no code change).

---

## 11. Open questions

1. **OWD plus "Grant Access Using Hierarchies" per object** still needs live verification to confirm the run-as-user sharing floor actually narrows manager vs leaf books (the sandbox sysadmin login masks it). Until verified, the cockpit presents the persona's configured view and lets the platform enforce what they can see; it must not *claim* it is enforcing least privilege.
2. **Admin god-mode gating:** which permission/permission-set gates it, and exactly how the switch is surfaced and audited.
3. **KYC/Compliance population:** confirm whether `Compliance_Check__c` / `KYC__c` carry real rows for Piedmont before the compliance section asserts any clearance; if empty, the section concludes "unverified, blocks decisioning."
4. **Peer/segment cohort:** whether the sandbox contains a populated NAICS 332710 cohort to compute a real margin baseline; until then the baseline is a labeled illustrative capability, not an asserted statistic.
5. **PERSONAS.md clause numbers:** the section §-references used across this spec (provenance lock, FLS-before-aggregation, traversal re-check, PII fence, server-side authz, citation-as-UI, adjustment records) should be reconciled against the live PERSONAS.md headings, or converted to named-principle references that survive renumbering.
6. **Decision-ledger backend:** Snowflake is attributed to the SR 11-7 fleet doctrine; the verified Customer 360 surface is the `record_decision` / `recall_decisions` / `get_audit_trail` / `log_audit_event` tool set. Confirm the concrete persistence backend for this cockpit, and the tamper-evidence mechanism (hash-chain recommended, not yet specified).
7. **Widget surface:** experience-mcp-served `ui://` (today) vs AXL (roadmap), unchanged from handover.
8. **Richer Piedmont seeding** (a second related entity, deposits, a treasury service, a Profitability record) vs scoping the demo to the real single-entity shape plus Timothy Norton Household for the multi-entity/wallet story. Current decision: no seeding required; the two accounts cover the full cockpit.

---

*Authoritative ground truth (all absolute):*
- `/opt/connectry/brain/knowledge/projects/company-brain/customer-360-mcp/SCHEMA-VERIFIED.md`
- `/opt/connectry/brain/knowledge/projects/company-brain/customer-360-mcp/DATA-MODEL-AND-ROLES.md`
- `/opt/connectry/brain/knowledge/projects/company-brain/customer-360-mcp/PERSONAS.md`
- `/opt/connectry/brain/knowledge/projects/company-brain/customer-360-mcp/VALIDATION-AND-DECISIONS.md`
