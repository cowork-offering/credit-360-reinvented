---
name: credit-review
description: Credit-officer review methodology for a drafted, attested commercial credit memo. The recall-don't-redraft discipline (read the published memo + decision/audit trail rather than re-render it), a per-section review checklist, a High/Medium/Low risk rubric for C&I credit, bank credit-policy alignment checks, and the approve→loop-approve→AFS-workpackage sequence (plus the reject path). Use when a credit officer reviews, performs effective challenge on, approves, or rejects a commercial credit memo the drafting agent has already produced.
---

# Credit Review — Methodology

How a credit officer reviews, challenges, and decides on a commercial credit memo that the drafting
agent (`credit-memo`) has already drafted, attested, and published. This is the **validation** half of
the SR 11-7 development/validation split — load the **`sr-11-7-model-risk`** skill for the governing
principles. The reviewer is **read-only on the work product**: it recalls the deal, challenges it, and
records a decision. Its only system-of-record write is the approval/rejection decision and the AFS
workpackage that approval triggers.

## When this skill applies

- Reviewing a drafted, attested commercial credit memo for a C&I borrower
- Performing SR 11-7 effective challenge on decision-support material
- Producing per-section feedback + risk ratings + a credit-policy alignment read
- Recording a committee approval or rejection decision

**Precondition:** the memo must already be **drafted and per-section attested** (the drafting agent's
`commercial-credit-memo` → "Per-section attestation" loop is complete). An un-attested draft is not
ready for committee — say so and stop.

## 1. Recall the deal — don't redraft it

You retrieve the **finished work product** and the trail behind it — you do not author NEW analysis,
edit the narrative, re-attest, or sync/publish. (Rendering a **read-only VIEW** of the committed memo so
you can read it is fine — see 1b; that is recall-for-reading, not redrafting. What's forbidden is
changing the work product or generating fresh analysis that could silently diverge from what was
committed.)

1. **Prior rationale + change log.** `recall_decisions(packageId)` (the "why") and
   `get_audit_trail(packageId)` (the "what" — how the memo was built and attested). Summarize the prior
   rationale inline before reviewing, so your challenge is informed by history, not naïve.
2. **The published narrative.** `ncino_deal_prep(packageId)` plus Salesforce reads (`soqlQuery`,
   `getRelatedRecords`) for the Product-Package `cm_*` rich-text fields and the published nFORMS memo —
   this is the memo as it now lives in the system of record. Read it; don't regenerate it.
3. **Orientation (optional).** `deal_show_summary` once for a one-screen cross-source snapshot.

### 1b. Present the memo for review (the read-only artifact)

The credit officer needs to **read the actual memo in Cowork**, not just your summary. Open it as a
**read-only review copy** — a deterministic render of the committed memo with **no edit controls** (those
are the preparer's) and a `Credit Review · READ-ONLY — recall of the committed memo` banner:

```bash
node "$ASM" --review --reviewer '{"name":"<from getUserInfo>","role":"<title>"}' \
  --out /tmp/<slug>-credit-review.html      # $ASM resolved as in commercial-credit-memo SKILL.md
```

Present that HTML artifact, then do the effective challenge against it. This is **recall-for-reading**,
not a redraft: it's read-only, the reviewer cannot edit it, and the figures still trace to source
(step 2). *(Production: recall the published nFORMS HTML so the view is byte-identical to what was
committed — incl. the preparer's in-artifact edits. For this demo the deterministic `--review` render of
the same snapshot is the faithful stand-in.)*

> **SR 11-7 fence:** the decision ledger informs your judgment but is **never** a source for a figure.
> Every number you rely on must trace to Boom / AFS / nCino.

### 1c. Offer the top-down read-through — don't auto-dump it

After presenting the read-only memo (1b), **stop and ask** before launching into the analysis — the
officer may want to read it themselves first, or jump straight to the decision. Ask plainly, e.g.
*"Want me to walk you top-down through the memo — a section-by-section effective challenge with a
High/Medium/Low risk rating on each?"* (AskUserQuestion, or a direct question).

- **Yes** → proceed to the figure trace + section review + risk rubric (steps 2–5), then the decision.
- **No / "I'll read it first"** → hold. Let them read the artifact; resume when they ask, or go straight
  to the decision (step 6) if they're ready.

Do not run the full effective challenge before the officer asks for it — the memo artifact comes first,
the walk-through is on request.

## 2. Verify the figures trace

Re-read the sources to confirm the memo's load-bearing numbers reconcile — this is challenge, not
re-authoring:

- **Boom** — `boom_get_spread`, `boom_get_ratios` for the spread line items and standard ratios.
- **AFS** — risk rating / PD / sensitivity (Snowflake / placeholder).
- **Covenant grade** — `deal_covenant_grade` (the deterministic Boom-ratio × nCino-threshold join).

Confirm the **Boom → AFS → nCino** chain holds: a ratio in the memo equals the Boom ratio; a covenant
grade equals the deterministic join; a risk rating equals the AFS event. Any figure that does not
trace is a review finding — flag it; do not repair it.

## 3. Per-section review checklist

For each ON section of the memo, give **concise feedback** (2–4 sentences) plus a **risk rating** and an
explicit **policy-alignment** verdict. Check, at minimum:

- **Sourced & traceable** — every material figure cites a source of truth; nothing is estimated.
  Unsourced numbers are an automatic finding.
- **Internally consistent** — Executive Summary figures match the detailed sections; the same ratio is
  the same number everywhere.
- **Reconciles to source** — the section's numbers match what you re-read from Boom / AFS / the
  covenant grade.
- **Right metric, right test** — Total vs. Senior Secured Leverage used correctly; *covenant* EBITDA
  (not reported) used when testing covenants; growth decomposed (organic vs. acquisition) where M&A
  occurred.
- **Gaps surfaced, not filled** — missing data reads `[not in source system; flagged for RM]`; a
  flag-suppressed module is not a gap, a data-missing one is.
- **Policy alignment** — the section conforms to bank credit policy (see §5); misalignment is flagged.
- **Narrative supports the recommendation** — the credit story, mitigants, and structure justify the
  proposed action and risk rating; no silent risk-rating change versus the rating on file.

Map each section to its risk rating using the rubric below, then roll the section ratings into the
overall recommendation in §6.

## 4. Risk rating rubric (High / Medium / Low) for C&I credit

Rate the **review risk of each section** — the likelihood and severity of a problem the committee would
need to act on — not the borrower's obligor rating (that is AFS's job).

> **Calibration — this is a well-formed, attested memo; review it as a credit officer, not a proofreader.**
> - **Verify your reading against `ncino_deal_prep` / the deal summary BEFORE asserting any discrepancy.**
>   Do **not** infer facilities or new-money line items the data doesn't show. The deal is exactly **two
>   facilities**: a $5.0M working-capital revolver increased $2.5M → $7.5M, and a new $5.0M equipment term
>   loan → **$7.5M new money, $12.5M total exposure**. The figures reconcile to Boom (Rev $64.5M, EBITDA
>   $5.2M / 8.1%, leverage 3.85x, DSC 1.42x) — confirm, don't re-derive a different number.
> - **Reserve High for genuine credit concerns** — covenant breach, an unsupported/mis-grade rating,
>   missing required analysis, or a figure that materially contradicts source. **Minor rounding or wording
>   differences are NOT High** (and are not findings worth blocking on).
> - **Default to concise, constructive feedback** and — where the credit holds and covenants pass — a
>   **Pass-leaning disposition**. The goal is a credit officer's effective challenge, not an audit of
>   cosmetics. Give a short per-section note + rating, then move to the decision.

- **Low** — Section is well-sourced, internally consistent, reconciles to source, and aligns with credit
  policy. Figures trace cleanly; covenants compliant with adequate cushion; structure and mitigants are
  conventional. No action needed; accept as drafted.
- **Medium** — Section is materially sound but carries an item the committee should weigh: a covenant
  within ~10% of trigger (watch), a softening trend (e.g., margin compression, rising revolver
  utilization), a thin or stale data point, a peer-set caveat, or a mitigant that needs a condition.
  Approvable, typically **with conditions / monitoring**; note the condition.
- **High** — Section has a defect that blocks committee comfort: an unsourced or non-reconciling
  load-bearing figure, a covenant breach (or a grade that contradicts the narrative), a material
  policy misalignment, a wrong-metric error that flips a conclusion, or a recommendation the evidence
  does not support. Must be resolved before approval; a High finding routes the memo **back to the
  drafting agent** or drives a **Reject**.

A single un-mitigated **High** section is sufficient grounds to withhold approval. Multiple **Medium**
sections may aggregate into a conditioned approval.

## 5. Credit-policy alignment checks

Test the memo against bank credit policy and flag any misalignment explicitly (policy text is the
fictional-but-realistic demo version — cite the principle, not a paragraph number):

- **Risk rating** — the proposed obligor rating is consistent with the financial profile and the AFS
  rating on file; any change from the rating on file is surfaced, not silent.
- **Covenant package** — covenants are present, defined, and tested against the *correct* metric; any
  breach or within-trigger condition is disclosed and addressed; no covenant is waived in the memo.
- **Collateral / structure** — secured position, advance rates, and guaranty support are adequate for
  the exposure and risk rating.
- **Concentration / exposure** — the facility size and aggregate relationship exposure are within
  single-obligor and portfolio limits; NAICS/industry concentration is considered.
- **Pricing** — pricing is commensurate with the risk rating and structure (note an outlier, don't set
  the rate).
- **Authority** — the requested action is within the committee's approval authority; if not, route it
  up rather than approve.

State an alignment verdict per check: **Aligned**, **Aligned with condition**, or **Misaligned (flag)**.

## 6. The decision — approve or reject

Roll the per-section ratings and policy verdicts into one recommendation, state the basis in one or two
sentences, then record it. **Resolve the reviewer identity from `getUserInfo` first** — the decision
must trace to the authenticated credit officer, never a free-typed name.

### Approve

1. **`ncino_approve_package(packageId, action: "Approve", actingUser*)`** (Experience MCP) —
   **loop-approves the multi-step Loan Committee approval process**, advances the Product Package to
   **Approved**, and moves the loans to their next stage in one governed action.
   > **⚠ Reach "Approved" ONLY through this tool — never `ncino_advance_stage`.** `ncino_approve_package`
   > approves the pending **approval work item**, which is what releases the Salesforce approval lock (the
   > record un-locks on final approval) and **clears the red "RECORD LOCKED" banner** (it shows only while
   > the package is in Credit Decisioning). A raw `advance_stage` to "Approved" would set the path field
   > while leaving the work item **pending** and the record **locked** — the red banner would persist.
   > Approving the decision = approving the process, in one call.
2. **`create_workpackage`** (AFS MCP) — stage the servicing workpackage (`/wp/commercialOrig` for new
   money). This is the **downstream, second write** that approval triggers. Point the obligor/officer at
   the demo Piedmont obligor and the demo user's queue (the default sample obligor `13` won't surface in
   the AFS quadrant).
3. **Record + audit.** `record_decision(packageId, sectionId, decision: "Approve", rationale,
   alternatives, actingUser*)` so the rationale persists for the next cycle, and `log_audit_event(...)`
   the approval and the workpackage.

### Reject (material concern)

1. **`ncino_approve_package(packageId, action: "Reject", actingUser*)`**. State the material concern
   plainly and, where useful, what would change the decision.
2. **Do not** create the AFS workpackage — there is nothing to service.
3. **Record + audit.** `record_decision(... decision: "Reject" ...)` + `log_audit_event(...)`.

> A **High** finding that the drafting agent should fix is a route-back, not necessarily a Reject:
> return it to `credit-memo` for correction and re-attestation, then re-review. Reject is for a
> material credit concern, not a correctable drafting defect.

## After the decision

Confirm to the user what landed and where, with record links: the package approval/rejection and new
stage, the loan stage moves, and (on approval) the AFS WP number. The `DRAFT — PENDING CREDIT COMMITTEE
REVIEW` banner is governed by this decision — note that the committee gate is now satisfied (or not),
even though the document watermark itself is not your write.

## What stays out of scope

You do not draft, edit, re-render, sync, or publish the memo; you do not call `ncino_sync_memo_sections`,
`ncino_publish_credit_memo`, `ncino_advance_stage`, `ncino_docman_save`, or `ncino_submit_for_approval`
(those are the drafting agent's `finalize-and-writeback`). You do not waive covenants, grant exceptions,
or move money. You review, challenge, and record the decision — the committee, through you, decides.
