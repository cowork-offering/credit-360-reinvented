# Credit 360 Cockpit — Early Warning System (EWS)

**Status:** framework, first-class credit-risk discipline. Sits alongside the use-case catalog, not under it. The EWS use cases (section 4) fold into `USE-CASE-CATALOG.md`; the taxonomy and playbook (sections 1–3) are the standing reference the cockpit's monitoring surface is built against.

EWS is not a screen. It is the cockpit's protect-the-book reflex: the deterministic detection layer that watches every relationship between reviews, grades how bad a signal is, places a name on a watch list, raises the monitoring cadence, and routes the name to the human who owns the next call. It is the book-level twin of the single-customer EWS fire in `MAINTENANCE-AND-MONITORING.md` §3.7 / §3.8 and the aggregated deterioration feed in §4.x — promoted here to a discipline with its own taxonomy, severity rubric, and escalation ladder.

## The fence (SR 11-7, non-negotiable)

EWS **detects, grades, ranks, and routes. A human classifies and decides.** Every trigger fires off a deterministic server-side computation over verified data — a Boom ratio, a `deal_covenant_grade` over `LLC_BI__Covenant2__c`, an AFS utilization read, an Snowflake PD. The number never passes through the LLM. The LLM ranks the fired signals against each other and narrates the watch story; it never computes the regulated figure that fired the signal, and it never makes the classification call (Pass / Watch / Special Mention / Substandard / Doubtful / Loss). Severity grading by the EWS is a **decision-support score**, captured as proposed-not-committed; the regulatory classification is the credit officer's act, recorded via `record_decision` + `log_audit_event`, written to the Snowflake decision ledger. Crossing a threshold raises a flag; it never moves a grade.

Two invariants carry over from the catalog: the cockpit **concludes and routes, a human commits**; every regulated number is **deterministic server-side, never LLM-computed**.

---

## 1. Trigger taxonomy

Triggers are grouped by **signal class**. Each trigger names its **source in the fleet** (which MCP / object computes it) and the **deterministic read** behind it. A trigger fires when its computed value crosses a configured threshold; thresholds are tenant-config, not model judgment (see the TOMORROW seams). All signals key on the one Product Package + Account spine, so a fired trigger rolls up to the obligor / relationship group, never an isolated loan tile.

<!-- TOMORROW: bank-specific trigger thresholds + escalation SLAs + EWS scorecard weights plug into every threshold/weight referenced below. Until then thresholds are illustrative defaults. -->

### 1.1 Financial deterioration — source: Boom (financial spreading)

The number is computed server-side by `boomFinancials.js` calling the BOOM_MCP server-side; ratios come from `boom_get_ratios` / `boom_get_spread` over the latest spread period. The LLM sees the ratio and the trend, never the raw line items it computed from.

| Trigger | Deterministic read | Fires when |
|---|---|---|
| Leverage up | Debt/EBITDA, Debt/TNW from `boom_get_ratios` | Leverage rises ≥ X turns vs prior spread or crosses a covenant-implied ceiling |
| DSCR / ICR down | DSC, interest coverage from `boom_get_ratios` | Coverage falls below watch band or drops ≥ X% period-over-period |
| Margin compression | EBITDA margin, gross margin trend from `boom_get_spread` | Margin contracts ≥ X points across consecutive spreads |
| Negative trend | Multi-period revenue / EBITDA / equity trajectory | Two-or-more-period sustained decline (not single-period noise) |
| Liquidity erosion | Current ratio, working capital, quick ratio | Drops below floor or trends adverse with revolver reliance rising |

The discipline: a single soft spread is **noise**; the trigger demands a sustained trend or a band crossing, so the cockpit flags the slide, not the wobble (the §3.8 "real or noise I can let ride" question).

### 1.2 Covenant — source: nCino `LLC_BI__Covenant2__c` via `deal_covenant_grade`

| Trigger | Deterministic read | Fires when |
|---|---|---|
| Covenant breach | `deal_covenant_grade` over `LLC_BI__Covenant2__c`, threshold vs actual | Actual crosses the covenant threshold (hard breach) |
| Thin headroom | `deal_covenant_grade` cushion %, tied to the spread period via `LLC_BI__Linked_Spread_Statement_Record__c` | Cushion compresses below `watchThresholdPct` (drift toward the band, pre-breach) |
| Trending toward breach | Cushion trajectory across test dates | Cushion narrowing across consecutive tests even if still compliant |
| Missing / stale certificate | Covenant certificate status on the package | Latest required compliance certificate open / overdue |

The cushion grade is computed; the LLM ranks the thinnest cushion against the other fired signals (the §3.7 "DSC-on-a-thinning-cushion" headline).

### 1.3 Behavioral / servicing — source: AFS (servicing)

Off-Salesforce AFS MCP. Reads `revolver_utilization`, `payment_history`, `loan_summary`. These corroborate or contradict the financial signal — the banker's tell that the numbers haven't caught up to yet.

| Trigger | Deterministic read | Fires when |
|---|---|---|
| Revolver utilization spike | `revolver_utilization` | Utilization crosses high-water band (e.g. > 90%) or steps up sharply |
| Evergreening / no clean-down | `revolver_utilization` time series | A revolver never rests below a clean-down floor across the period (structural reliance) |
| Past-dues / delinquency | `payment_history` | Any payment past due; severity scales with DPD bucket (30 / 60 / 90+) |
| Overdrafts | servicing / deposit behavior | Recurring overdraft pattern on the operating account |
| Payment slippage | `payment_history` trend | Pattern of late-but-cured payments drifting later (pre-delinquency tell) |

### 1.4 Risk migration — source: Snowflake on Snowflake (zero-copy)

`rating`, `PD`, covenant grades, sensitivity. Zero-copy on Snowflake; the EWS reads the migration, never re-derives the rating.

| Trigger | Deterministic read | Fires when |
|---|---|---|
| Rating downgrade | Snowflake `rating` vs prior | Grade migrates adverse (any notch down) |
| PD jump | Snowflake `PD` | Probability of default rises ≥ X bps or crosses a band |
| Sensitivity / stress flag | Snowflake sensitivity output | Modeled stress scenario pushes the credit below an acceptable threshold |

### 1.5 Deposit / wallet — source: FSC (`FinServ__*`)

Native in-org FSC household + deposit balances, read run-as-user via the Customer 360 MCP.

| Trigger | Deterministic read | Fires when |
|---|---|---|
| Deposit runoff | FSC deposit / balance trend across the household | Operating balances decline ≥ X% — a relationship pulling money out ahead of trouble (or ahead of leaving) |
| Balance decline / volatility | FSC balance time series | Sustained decline or abnormal volatility in the operating wallet |
| Wallet-to-credit divergence | FSC wallet vs Product Package exposure | Wallet shrinking while credit exposure holds / grows — the relationship thinning under the loan |

### 1.6 External — source: CapIQ / IBIS

Peer medians + industry outlook. Names the macro the single relationship sits inside.

| Trigger | Deterministic read | Fires when |
|---|---|---|
| Industry stress | CapIQ / IBIS peer medians vs the borrower | Borrower deteriorating *and* its NAICS cohort deteriorating (correlated, not idiosyncratic) |
| Sector outlook downgrade | IBIS sector outlook | Forward sector outlook turns adverse for the borrower's industry |

An external trigger rarely fires alone; it **raises the severity** of a co-firing internal trigger (idiosyncratic stress inside a stressed sector is worse than either alone).

### 1.7 Structural — source: nCino structure objects + lifecycle

| Trigger | Deterministic read | Fires when |
|---|---|---|
| Guarantor distress | Connection graph / guarantor entity signals; key-person guaranty concentration | A guarantor carrying the credit shows its own deterioration, or single-key-person-guaranty exposure is flagged |
| Collateral shortfall | `LLC_BI__Loan_Collateral2__c`, `Current_Lendable_Value__c` vs outstanding | Lendable value falls below outstanding (coverage < 100%) or advance-rate headroom erodes |
| Modification frequency | `LLC_BI__Loan_Modification__c` count / recency (Mod_Type, Modification_Type) | Repeated modifications (rate reductions, payment deferrals, amortization extensions, interest-only) cluster — accommodation as a deterioration tell |
| Renewal / maturity stress | `LLC_BI__LoanRenewal__c`, `LLC_BI__Loan__c.LLC_BI__Maturity_Date__c` | A maturity clock approaches on a credit already showing other signals (refinance risk) |

Modification frequency is the quiet one: a single `Payment Deferral` or `Interest Only` mod is servicing; a *pattern* of them is the bank papering over stress, and the EWS treats the cluster as a structural signal.

---

## 2. Handling / escalation playbook

The lifecycle of a fired signal — **detect → grade → watch-list → heightened monitoring → action plan → credit officer review → workout**. Each step names the **owning persona** and holds the SR 11-7 line: every step the cockpit performs is detect / grade / rank / route / draft; every step a human performs is the decision.

| Step | What happens | Cockpit concludes (decision-support) | Human decides | Owner (persona) |
|---|---|---|---|---|
| 1. Detect | A trigger crosses threshold; deterministic compute fires the signal | "Signal fired: DSC cushion thinned to 0.17x, < watch band" | — (machine detection only) | — (automatic) |
| 2. Grade severity | EWS scores the fired signal(s) on the severity rubric (§2.1) | "Severity: Medium — single sustained financial signal, covenants still compliant" | Confirm / override the severity (proposed-not-committed) | Portfolio Manager |
| 3. Watch-list placement | Name proposed for the watch list with the firing rationale | "Recommend Watch placement; rationale = margin-led DSC drift" | Place / decline placement; this is the regulatory-adjacent call | Portfolio Manager → Credit Officer for grade-moving cases |
| 4. Heightened monitoring | Monitoring cadence raised (§2.2); watch-triggers set on the firing signals | "Cadence raised to monthly; utilization + covenant re-watch set" | Confirm cadence; subscribe to the event class | Portfolio Manager / RM |
| 5. Action plan | Cockpit drafts the action-plan skeleton (gather updated financials, contact borrower, re-spread, re-test covenants) | "Draft plan: refresh spread, confirm clean-down, schedule borrower call" | Author / approve the plan; commit the actions | RM / Loan Officer (relationship), PM (portfolio) |
| 6. Credit officer review | Package routed for effective challenge once a signal is grade-moving or classification-relevant | "Routed for review; the soft line is margin, lineage attached" | Effective challenge; classification call; conditions | Credit Officer / Approver |
| 7. Classification | Regulatory grade migration recorded if warranted | "Proposes the migration as decision-support only" | Pass / Watch / Special Mention / Substandard / Doubtful / Loss | Credit Officer / Approver |
| 8. Workout handoff | If classified adverse, route to Special Assets with the assembled history | "Recovery posture surfaced; mod/renewal/collateral history assembled" | Workout strategy; recovery / loss-content judgment | Special Assets / Workout |

Servicing signals (utilization, delinquency, overdraft) enter at step 1 owned by **Loan Ops / Servicing**, who corroborates and routes to PM. Deposit-runoff signals route to **Treasury / Cash-Mgmt** in parallel (a relationship pulling deposits is both a credit tell and a wallet event). External / industry signals are read by the **Portfolio / Credit-Risk Executive** at the book level as the deterioration feed, and drilled down to the contributing name.

### 2.1 Severity rubric (decision-support grade, never the regulatory grade)

Scored deterministically from the firing set; the LLM ranks, the human confirms. Maps to, but never replaces, regulatory classification.

- **Low (Monitor).** One soft signal, single-period or shallow, covenants compliant, no servicing corroboration. Cadence: keep standard; note in the file. Owner: PM glance.
- **Medium (Watch candidate).** A sustained financial trend **or** thinning covenant headroom **or** a single servicing tell, no breach. Cadence: raise to monthly; set watch-triggers. Owner: PM proposes Watch.
- **High (Watch / Special Mention candidate).** Multiple co-firing signals (financial + covenant, or financial + servicing), or a covenant breach, or a rating downgrade with corroboration. Cadence: heightened, action plan required. Owner: Credit Officer review.
- **Critical (Adverse classification candidate).** Hard breach + delinquency, or collateral shortfall + guarantor distress, or a PD jump confirmed by servicing and external stress. Cadence: immediate review, workout pre-positioning. Owner: Credit Officer → Special Assets.

Severity **escalates** when an external/industry signal co-fires (idiosyncratic-in-stressed-sector), when modifications cluster, or when signals from independent sources corroborate (Boom margin + AFS utilization + Snowflake PD all pointing the same way is worth more than three of the same source).

<!-- TOMORROW: bank-specific severity-band cutoffs, the EWS scorecard weights that turn the firing set into Low/Medium/High/Critical, and the mapping table from EWS severity to the bank's own watch grades. -->

### 2.2 Monitoring cadence ladder

- **Standard** — review-cycle driven (annual review + scheduled covenant tests). The §3.7 work queue surfaces it.
- **Heightened (Watch)** — monthly check-in: re-pull `revolver_utilization` / `payment_history`, re-grade covenants, watch the Boom margin trend. Watch-triggers fire pushes, not pulls.
- **Intensive (Special Mention / Substandard)** — bi-weekly or tighter, action-plan milestones tracked, borrower-contact log maintained.
- **Workout** — Special Assets cadence; recovery posture, collateral re-valuation, modification/renewal history under continuous review.

<!-- TOMORROW: escalation SLAs — the clock on each step (e.g. High severity → credit officer review within N business days; breach → action plan within N days). These convert the cadence ladder into time-bound obligations. -->

---

## 3. What the cockpit concludes vs what a human decides (the EWS fence, restated)

| The cockpit (detect / grade / rank / route / draft) | The human (decide / commit) |
|---|---|
| Fires triggers from deterministic compute (Boom / nCino / AFS / Snowflake / FSC / CapIQ) | Confirms the signal is real and not a data artifact |
| Scores severity (Low/Med/High/Critical) as decision-support | Sets the watch grade; makes the regulatory classification |
| Proposes watch-list placement with rationale | Places the name on the watch list |
| Raises the monitoring cadence and sets watch-triggers | Confirms the cadence; owns the action plan |
| Drafts the action-plan skeleton and the watch narrative | Authors, approves, and executes the plan |
| Ranks fired signals across the book; routes to the owning persona | Performs effective challenge; decides workout vs hold |
| Assembles lineage, mod/renewal/collateral history for review | Makes the recovery / loss-content judgment |

No EWS output writes a grade, a classification, or a regulated number. Every severity score and placement recommendation is captured proposed-not-committed, logged to the Snowflake decision ledger via `log_audit_event`, and only becomes real when the authorized human commits it via `record_decision` (classification authority enforced server-side against the acting user).

---

## 4. EWS use cases (catalog row schema)

Schema: **Trigger / The question / What the cockpit concludes / Action it unlocks / Persona / Cadence.** These fold into `USE-CASE-CATALOG.md`. Piedmont figures (DSC 1.42x vs 1.25x; EBITDA ~11%→8.1%; $12.5M committed / $4.25M drawn; ~$10M lendable; leverage 3.85x→~4.8x pro forma) recur as a single labeled illustration — evidence anchors, never the subject.

| # | Trigger | The question | What the cockpit concludes | Action it unlocks | Persona | Cadence |
|---|---|---|---|---|---|---|
| E1 | New Boom spread lands; margin down another point, DSC drifting toward its watch band before the test date | Is this credit holding or sliding, and is the slide real or noise I can let ride to the review? | Watch the margin, not the covenants yet. All compliant, but DSC 1.42x vs 1.25x is the thinnest cushion (0.17x, ~14%) and thinning because EBITDA fell ~11%→8.1% while leverage runs toward ~4.8x. Severity **Medium**: one sustained financial signal, pre-breach. Margin is the lever under DSC | Place on watch (proposed); raise cadence to monthly; set a covenant-watch trigger keyed to the test date; draft the watch paragraph; route to the PM who owns the watch-list call | Portfolio Manager | Event-driven (new spread / cushion drift) → monthly once Watch |
| E2 | `deal_covenant_grade` shows a hard breach on `LLC_BI__Covenant2__c` at the test date | A covenant just broke — how bad, and what has to happen now? | Breach confirmed, not drift. Severity **High** (breach alone) or **Critical** if a servicing tell co-fires. This crosses from monitoring into action-plan-required; routes for effective challenge with the lineage attached | Route to credit officer review; draft the action-plan skeleton (waiver vs amendment vs reservation-of-rights); capture the first-flag decision; log the breach to the audit trail | Credit Officer / Approver | Event-driven (covenant test); intensive cadence once breached |
| E3 | AFS `revolver_utilization` spikes past 90% (or a revolver never cleans down across the period) | Is this a working-capital blip or is the line becoming permanent debt the spread doesn't show? | Utilization-led tell: outstanding crept toward the line, the undrawn cushion (live contingent risk) is shrinking, and the revolver isn't resting. Severity **Medium**, escalating to **High** if margin (E1) co-fires — servicing corroborating the financial slide. Coverage still ~$10M lendable, but the structure is the signal | Set a utilization watch-trigger; corroborate against the Boom margin trend; route to PM if it reads as deterioration; draft the exposure note + pull the affiliate/guarantor structure | Loan Ops / Servicing → Portfolio Manager | Event-driven (utilization spike) + daily servicing glance |
| E4 | AFS `payment_history` shows a past-due, or late-but-cured payments drifting later | Is this an administrative slip or the first crack in the borrower's cash position? | Behavioral signal ahead of the financials. A 30-DPD on an otherwise-compliant credit is **Medium**; 60/90+ or a slippage pattern is **High**. The tell is timing drift even where every payment ultimately cures — pre-delinquency, not yet delinquency | Flag the slippage; raise cadence; cross-check deposit/wallet (E7) and utilization (E3); route to Servicing for borrower contact; capture the watch decision | Loan Ops / Servicing | Event-driven (payment event) → bi-weekly if pattern |
| E5 | Snowflake pushes a rating downgrade or a PD jump on the obligor | Did the model just tell me something the file hasn't caught up to, and does it hold up? | Risk migrated. The downgrade/PD jump is decision-support, not the grade — but corroborated by Boom (E1) or servicing (E3/E4) it is **High**, and uncorroborated it is a **Medium** prompt to go look. The cockpit ranks it, the officer owns the grade | Route for effective challenge; assemble the Boom→Snowflake→nCino lineage behind the migration; capture the rating call as proposed-not-committed; never auto-migrate the regulatory grade | Credit Officer / Approver | Event-driven (Snowflake refresh) |
| E6 | Repeated `LLC_BI__Loan_Modification__c` events cluster (rate reductions, payment deferrals, interest-only, amortization extensions) | Are we accommodating this borrower into a problem we're not naming? | Structural tell: a single mod is servicing, but a *cluster* is the bank papering over stress. Severity **High** when mods cluster alongside any financial or servicing signal. The modification frequency is itself the EWS signal, independent of each mod's own merit | Surface the mod history as a deterioration narrative; route to credit officer with the pattern flagged; recommend the cluster be examined at the next review; capture the structural-change decision | Credit Officer / Approver | Event-driven (each mod; pattern detection) |
| E7 | FSC deposit balances run off across the household while credit exposure holds | Is the relationship pulling its money out ahead of trouble — or ahead of leaving? | Wallet-to-credit divergence: operating balances declining while the $12.5M credit holds. A deposit runoff is both a credit tell (cash leaving the business) and a relationship tell (about to leave the bank). Severity **Medium**, escalating if it co-fires with utilization (E3) — drawing the line while draining deposits is a sharp signal | Flag to PM as a credit signal and to Treasury as a wallet/retention signal in parallel; set a balance watch-trigger; draft the relationship note; capture the watch decision | Treasury / Cash-Mgmt + Portfolio Manager | Event-driven (balance trend) + daily wallet glance |
| E8 | `LLC_BI__Loan_Collateral2__c` re-valuation drops `Current_Lendable_Value__c` below outstanding, or a guarantor shows distress | If this went sideways tomorrow, am I actually covered — and is the guaranty still good? | Structural shortfall: coverage fell under 100% of outstanding, or a key-person guaranty carrying the credit is itself deteriorating. Severity **High** → **Critical** if paired with a breach (E2) or delinquency (E4). Single-key-person-guaranty concentration is the named book-level risk Piedmont contributes to | Route to credit officer; pre-position Special Assets if classification looks adverse; assemble collateral + guaranty + mod history; capture the coverage call (recovery estimate is the human's, never the model's) | Credit Officer / Approver → Special Assets / Workout | Event-driven (re-valuation / guarantor event); intensive once flagged |
| E9 | CapIQ/IBIS shows the borrower's NAICS cohort deteriorating while the borrower itself shows a signal | Is this just this borrower, or is the whole sector turning under my book? | Correlated stress: idiosyncratic deterioration *inside* a stressed sector is worse than either alone. The external signal raises the severity of the co-firing internal signal by one band. At the book level this is a concentration question, drilled down to the name | Raise severity on the paired internal signal; surface to the Executive as a sector-concentration deterioration contributor; drill from the cohort to the single-customer 360; capture the concentration-watch decision | Portfolio / Credit-Risk Executive | Monthly book scan + event-driven (sector outlook change) |
| E10 | Book-level deterioration feed: net downgrades up, watch-list growing, breaches/utilization/slippage trending across names | Across my whole book, where is risk migrating, and which one name drives it so I can drill straight in? | One deterioration view: net downgrades, watch-list growth, new classifieds, covenant breaches and utilization spikes trending — each contributor drillable to the name. Piedmont appears as one contributor reached by drilling, never the center. Counted deterministically server-side, never an LLM tally | Drill any contributor into the single-customer 360 then the deal memo; rank the book by risk-velocity; route the sharpest names to their PMs; read-only oversight, no per-deal write | Portfolio / Credit-Risk Executive | Daily aggregate glance + monthly migration review |

**Use-case count: 10.**

---

## 5. Fleet source map (EWS reads only deterministic compute)

| Signal class | Fleet source | Tool / object |
|---|---|---|
| Financial deterioration | Boom (server-side via experience-mcp `boomFinancials.js`) | `boom_get_ratios`, `boom_get_spread` |
| Covenant | nCino (in-org) | `deal_covenant_grade` over `LLC_BI__Covenant2__c`, `LLC_BI__Linked_Spread_Statement_Record__c` |
| Behavioral / servicing | AFS | `revolver_utilization`, `payment_history`, `loan_summary` |
| Risk migration | Snowflake on Snowflake (zero-copy) | `rating`, `PD`, sensitivity |
| Deposit / wallet | FSC (in-org, run-as-user) | `FinServ__*` household + deposit balances |
| External | CapIQ / IBIS | peer medians, sector outlook |
| Structural | nCino (in-org) | `LLC_BI__Loan_Collateral2__c` / `Current_Lendable_Value__c`, `LLC_BI__Loan_Modification__c`, `LLC_BI__LoanRenewal__c`, Connection graph (guaranty) |
| Decision ledger / audit | experience-mcp (Snowflake) | `record_decision`, `log_audit_event`, `recall_decisions` |

Every fired signal is a deterministic server-side computation over verified fields; no severity score, watch placement, or regulated number passes through the LLM. The LLM ranks the firing set and narrates the watch story.

<!-- TOMORROW: bank-specific trigger thresholds + escalation SLAs + EWS scorecard weights. Each plugs into: §1 firing thresholds (the "Fires when" column), §2.1 severity-band cutoffs + scorecard weights, §2.2 cadence SLAs, and the EWS-severity→bank-watch-grade mapping. The framework absorbs them by config, not by rework — every threshold above is a named, replaceable default. -->

<!-- TOMORROW: additional trigger classes if the bank runs them (e.g. ESG/climate transition risk, fraud-pattern signals, syndication/participation exposure shifts) slot in as new §1 subsections with the same source-named row schema. -->
