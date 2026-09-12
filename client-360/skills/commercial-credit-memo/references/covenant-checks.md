# Covenant Compliance Framework

How to test every financial covenant on a loan, classify compliance with cushion, and render the covenant table. Feeds Section 9 of the memo; amber and red flags also surface in the Executive Summary.

---

## Inputs

For each loan: list of covenants from `LLC_BI__Loan_Covenant__c`. Each has `Covenant_Type__c`, `Test_Frequency__c`, `Trigger__c`, `Direction__c` (Maximum or Minimum), `Currently_Active__c`. Plus the Boom spread (for actuals) and the credit agreement (for precise definitions that override defaults).

---

## Step 1 — Compute the actual

For each covenant, identify the ratio it tests and compute it using the credit agreement's definition (default to `ratio-definitions.md` if silent). Use **covenant EBITDA** per the credit agreement's add-back menu — not reported EBITDA. Note line-item sources.

---

## Step 2 — Compute the cushion

Distance between actual and trigger, as a percentage of trigger.

**Maximum-direction covenants** (lower is better, e.g., max leverage):
```
cushion = (trigger − actual) / trigger
```

**Minimum-direction covenants** (higher is better, e.g., min FCCR):
```
cushion = (actual − trigger) / trigger
```

Passing → cushion > 0. At the line → cushion = 0. Breach → cushion < 0.

---

## Step 3 — Classify

| Flag | Cushion |
|---|---|
| **Green** | cushion ≥ +10% |
| **Amber** | 0 ≤ cushion < +10% |
| **Red** | cushion < 0 (breach) |

10% is the standard threshold. Sponsor-backed leveraged loans sometimes use 5%; investment-grade sometimes 15%. Stick with 10% unless credit policy specifies otherwise.

For a covenant that has been waived or amended, apply the framework to the modified terms and note the waiver in the narrative.

---

## Step 4 — Build the covenant table

| Covenant | Test | Trigger | Q1 2026 Actual | Cushion | Flag |

Color the Flag column cell with the corresponding token (`#1F7A3A` green, `#B45309` amber, `#A8211B` red).

---

## Step 5 — Narrative for amber and red flags

**Green covenants**: no narrative needed; the table speaks for itself.

**Amber covenants**: one paragraph answering:
- What's the trigger and actual?
- Is the cushion eroding, stable, or improving?
- What has management said?
- Scheduled events that could move the actual?
- Contingency if the cushion erodes (covenant relief request, equity cure, etc.)?

**Red covenants**: amber narrative plus:
- Breach date
- Notice provisions (typical: 5-30 days)
- Default rate step-up (typical: +200bps)
- Cross-default implications
- Recommended action (waiver, amendment, repayment-to-cure)
- Escalation status (RM / credit officer / workout)

---

## Step 6 — Surface in Executive Summary

Paragraph 3 of the Exec Summary:
- All green: "All [N] covenants currently in compliance with cushion."
- Amber: "All covenants currently in compliance. [N] covenants within 10% of trigger; see Section 9." Name the covenants.
- Red: "Covenant [name] is in breach as of [date]. See Section 9; flagged for committee discussion." Name explicitly. Never bury red flags.

---

## Step 7 — Conditional and step-up covenants

**Conditional covenants** spring into effect when a precondition is met (e.g., liquidity covenant only tests when revolver utilization >75%). First test whether the condition is active; if inactive, render "n/a." If active, run Steps 1-3 normally.

**Step-up covenants** tighten when a trigger is met:
- *Acquisition basket*: borrower can do permitted acquisitions only if pro forma leverage stays below X. This is a condition, not a covenant.
- *Pricing grid*: spread step-ups by leverage tier. Note in Loan Request section, not Covenant Compliance.

Apply current-tier terms; document the step-up schedule in narrative.

---

## Failure modes

- **Reported EBITDA when covenant calls for covenant EBITDA.** Can flip a flag green → amber/red. Always use covenant EBITDA when testing.
- **Forgetting subordinated debt in Total Leverage.** Subordinated seller notes, mezz, sub debt all count toward Total. They don't count for Senior Secured.
- **Treating undrawn revolver as "available" when there's a borrowing base.** For ABL, available = `min(commitment, borrowing base) − outstandings`. Pull the most recent BBC.
- **Mismatching test periods.** Some test quarterly LTM, some annually FY, some point-in-time (liquidity). Match correctly.
- **Stale covenant terms.** Confirm the most recent credit agreement amendment in nCino before computing.
- **Cushion sign confusion.** Maximum-direction: cushion positive when actual < trigger. Minimum-direction: cushion positive when actual > trigger. Get direction right.
- **Reporting green when prior period was amber.** Trend matters; note prior-period amber even if current is green.
