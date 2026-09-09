---
name: covenant-review
description: Guided workflow. Assess the covenant package of a deal and record the results in nCino. Reads every covenant on the product package with its current compliance status and reason, the banker assesses each one against the evidence, and the whole set is staged as ONE plan under ONE decision token, then executed per covenant. Use when a banker says "review the covenants", "run the covenant review", "record the quarterly covenant results" or asks whether a borrower is in compliance.
---

# Covenant review, package scoped

A banker reviews the **covenant package of a deal**, not a compliance row in isolation. This workflow
matches that: one product package, N covenants, one plan, one confirmation, one decision token, N
assessments written and verified individually.

> **The tool records an assessment a human reached. It does not judge compliance.** The status, the
> observed value and the reason are the banker's, or yours drawn from evidence and shown to them
> before staging. Nothing here approves, waives or excuses anything.

---

## Handoff first

**When a cockpit is reachable, this ask becomes an INTENT, not a staged plan.** Compose the lines in
the room's grammar and hand them to the relationship workroom; the banker watches it stage there. The
routing table is in `agents/credit-360.md` and in the `credit-360-cockpit` skill, which also
carries the intent shape and the `write_db` protocol.

**Assessing** covenants is room `relationship`, route `covenant`. Adding or removing a covenant is a
different ask and routes by where it attaches: a covenant **on a loan** is room `facility` route
`modify`, and a covenant **at relationship level** is room `relationship` route `intake`.

Steps 1 to 3 below run either way: they are how you read the package and reach an assessment.
**Steps 4 to 7 are the explicit opt-in path** and run only when the banker asks to act without the
room ("do it here", "no cockpit") or no cockpit can be resolved.

---

## 1. Read the covenant package

`Customer360Covenants` for the account returns `covenants[]` and a `note`. Each covenant carries, in
addition to its threshold and frequency, the two fields that make the reading honest:

- **`latestComplianceStatus`**, the status of the latest compliance row. The org's picklist offers
  exactly `Compliant`, `Exception`, `In Progress`, `Pending`, `Waived`, and there is **no separate
  non-compliant value**.
- **`reasonForException`**, which offers exactly `Breached` and `Overdue` and is the only field that
  separates a failed test from an undelivered document.

Resolve the **product package** the same way as everywhere else: from `Customer360Exposure`,
`facilities[].productPackageId`. If the relationship stages more than one package, ask which deal.
Members always resolve against the package the banker picked.

**The scope is a union.** The staging tool traverses package to loans to `LLC_BI__Loan_Covenant__c`,
unions package borrower accounts to `LLC_BI__Account_Covenant__c`, dedupes by covenant id and excludes
templates. So a covenant reaches the package by **loan attachment, relationship attachment or both**,
and the plan reports which in each covenant's `attachment` field. Do not assume a covenant is missing
because it does not hang off a loan.

---

## 2. Read Exception correctly, every time

This is the fence that matters most on this surface.

| The org says | It means | You say |
|---|---|---|
| `Exception` with `reasonForException: Breached` | the test was measured and failed | "Exception, reason Breached" and treat it as a failed test |
| `Exception` with `reasonForException: Overdue` | the document or statement was not delivered by the due date | "Exception, reason Overdue" and treat it as administrative |
| `Exception` with no reason | nCino's own batch forces Exception onto any row whose due date has passed, measured or not | "Exception, reason not recorded". **Never** a breach |
| `Waived` | its own neutral state, and it outranks the arithmetic | "Waived" |
| `Pending` / `In Progress` | states a row arrives in, not verdicts | neither compliant nor in breach |

**`Exception` alone is never a breach.** In this org 101 of 140 Exception rows carry no measured
value at all. Saying "in breach" on that data is wrong on the facts and indefensible in front of a
credit officer.

---

## 3. Assess each covenant, and show the work

For each covenant in scope, form a view:

- the threshold from nCino and the actual you can evidence. Where a Boom spread exists, the cockpit's
  deterministic validation stage already computes the Boom-implied value beside the nCino actual and
  labels it `corroborated`, `diverges` or `not-computable`. Use it as a **review flag for effective
  challenge, never a breach determination**: the Boom value uses standard ratio definitions and the
  bank's contractual ones are nCino-owned and can differ through add-backs, rolling averages and
  pro-forma adjustments;
- the status you would record: **`Compliant`, `Waived` or `Exception`**. Those three are the tool's
  complete statuses. `Pending` and `In Progress` are refused: they are arrival states, not verdicts;
- the **`observedValue`** as a **number**, not a string. The invocable declares `Decimal`;
- the **`reasonForException`** whenever the status is `Exception`. `Breached` or `Overdue`. Omitting it
  throws away the only distinction that matters;
- a short **`narrative`** and, where useful, **`comments`**.

Show the banker the whole set before staging, one line per covenant: covenant, threshold, observed,
current compliance status, proposed status, reason. Let them correct it. Their corrections are the
assessment.

---

## 4. Stage the whole package as one plan (opt-in path)

Reachable cockpit, no confirmed opt-in: stop above and write the intent instead.

```json
{
  "idempotencyKey": "HARTWELL-COV-2026Q3-01",
  "productPackageId": "a5Fbb000000IHFJEA4",
  "rationale": "Q3 2026 covenant review of the Hartwell C&I package against the June quarter spread.",
  "covenantIds": ["a3B…", "a3B…"],
  "allowNonPending": true,
  "assessments": [
    { "covenantId": "a3B…", "status": "Compliant", "observedValue": 1.42,
      "narrative": "DSC 1.42x against a 1.30x floor. Cushion holds.",
      "comments": "Tested against the Q2 spread." },
    { "covenantId": "a3B…", "status": "Exception", "observedValue": 1.05,
      "reasonForException": "Breached",
      "narrative": "DSC 1.05x against a 1.30x floor.",
      "comments": "Q2 miss." }
  ]
}
```

Shape rules, all observed on the wire:

- **`productPackageId` is required.** The old `accountId` plus `covenantComplianceId` plus `result`
  shape is **gone from the org**. Those fields carried `required=true`, so sending any of them makes
  the new shape unreachable. Do not send them.
- **`covenantIds` is an optional member selection** inside the package. Omit it to scope the plan to
  every covenant the traversal reaches. Send it to narrow to the ones the banker picked.
- **`allowNonPending` is sent only when the banker asked for it.** A `false` value claims a decision
  nobody made, so the key is **omitted** instead. See step 5.
- **`observedValue` is a number.** `1.42`, never `"1.42"`.
- **`rationale` is required** and feeds the audit ledger.

`stage_covenant_review` **writes nothing**. It returns `summary`, `warnings[]`, five typed steps per
planned covenant namespaced `_<n>` (`find_compliance` → `write_assessment` → `write_status` →
`verify` → `observe_generation`), `stagingId`, `planHash`, `decisionToken`, `covenants[]`,
`scopeCount`, `assessedCount` and `refusedCount`.

---

## 5. The Pending rule, and the opt-in

**Only a `Pending` compliance row advances the schedule** when it moves to a complete status. Any
other row is refused **per covenant** at stage time, and the plan reports it rather than dropping it.
The observed refusal reads:

> The compliance row is at In Progress, not Pending. Only a Pending row advances the schedule when it
> moves to a complete status, so a write here would succeed and change nothing. Set allowNonPending to
> record the assessment on the row anyway, knowing the schedule will not move.

`allowNonPending: true` is the **only** override, it must be carried in the staged plan, and it is the
banker's call, made in words, never yours. Wherever you offer it, state the consequence in the org's
own terms:

> allowNonPending was set. An assessment recorded on a row that is not Pending is stored, and the
> covenant schedule does NOT advance: nCino pushes the next evaluation date only on a Pending to
> complete transition.

A refused covenant is **reported, not fixed**. Nothing about it is repaired, retried or worked around.

---

## 6. Present the plan, verbatim

Show the org's `summary` and **every string in `warnings[]`, word for word**. The four the org sends on
a two-covenant plan with one refusal:

> No covenant in this plan carries the Active plus Frequency Template plus Effective Date combination
> nCino needs to mint the next compliance row, so completing these rows is not expected to create a
> successor row or raise a covenant approval. Execution measures this rather than asserting it.

> This action updates existing compliance records and creates none. The parent covenant's Effective
> Date is never written: changing it in the same transaction as a status transition corrupts the
> compliance schedule, and that defect is open at the vendor.

> Exception in nCino is not a synonym for a breach. The platform's own batch forces Exception onto any
> row whose due date has passed, measured or not. What separates a failed test from an undelivered
> document is Reason for Exception, which this plan writes explicitly.

> 1 of the 2 covenants assessed will NOT be written. Each carries its own reason in the covenants
> list. They are reported rather than skipped, and nothing about them is fixed.

The **approval-trap warning** is the first one and it inverts when the covenants do carry Active plus
a Frequency Template plus an Effective Date. In that case the org warns that completing the row is
expected to mint a successor compliance row and raise a covenant approval at a named human, and it
names `One-Time` templates separately because a Compliant verdict on one deactivates the covenant
permanently. Never summarise that warning away. It is the difference between a quiet write and an
approval landing in somebody's queue.

Then state the arithmetic plainly: `scopeCount` covenants in the package, `assessedCount` will be
written, `refusedCount` will not, each with its own reason. A partial write is never a surprise.

Per covenant, show `currentComplianceStatus` → `assessedStatus`, the `attachment`, the `state`
(`planned` or a refusal state such as `not_assessable_row_not_pending`) and `generatesNextRow`.

**If `executionHeld` is `true`, stop.** Report `heldReason` verbatim and do not call execute.

---

## 7. Confirm, execute, report

The banker confirms in words. Then:

```json
{ "idempotencyKey": "HARTWELL-COV-2026Q3-01", "stagingId": "a8a…",
  "planHash": "…", "decisionToken": "…", "approverUserId": "005…" }
```

`execute_covenant_review` returns `terminalState`, `writtenCount`, the steps with their verification
detail, per-covenant `items[]` and the batch-level `approvalChainStarted`.

Report:

- per covenant: whether it was `written`, the status transition it made, the compliance record name,
  and **`nextComplianceRowCreated`** as the **measurement it is**. Execute snapshots the covenant's
  compliance row ids before the write and re-queries after. It measures; it does not assert;
- `approvalChainStarted` is **tri-state**. `true` means an approval was raised, `false` means none was
  observed, and **`null` on a replay means this run observed nothing**, never "no approval was
  raised";
- the org's own outcome sentence, which states when the schedule did not advance and why. Observed:
  *"Assessment recorded as Exception on COV-000653. No successor compliance record was observed in
  this transaction, and the schedule did not advance because the row was not Pending."*

The write lands on `LLC_BI__Historic_Financial_Indicator__c`, which is where nCino sources the
covenant's Last Evaluation Value from, and is mirrored to the packaged audit field. Evaluation date
and evaluated-by are set to today and the approver.

---

## Fences

- **No compliance row games.** You never move a row to a complete status to make a package look
  clean. You never create a compliance record: this tool updates existing rows and creates none. You
  never write the covenant's Effective Date in a status transaction, because it corrupts the schedule
  and the vendor defect is open.
- **Exception is not a breach.** Carry the reason in the data and in the prose, every time.
- **`Waived` is a status a human reached**, recorded here. It is never a waiver you granted.
- **Never fix a refusal.** Report it with the org's reason and move on.
- **The Boom-implied value is a challenge flag, not a verdict.** A `diverges` result never becomes a
  breach determination.
- **Never claim an approval was raised** unless `approvalChainStarted` came back `true` in that run.

---

## What has not been observed

State these plainly if they come up rather than implying more certainty than exists.

- **The approval chain has never been observed firing through these tools.** Both probe covenants
  lacked a Frequency Template, so `approvalChainStarted` measured `false`. The positive branch is unit
  tested only. The chain materialises as `FlowOrchestrationInstance` and `FlowOrchestrationWorkItem`,
  not `ProcessInstance`.
- **Multi-covenant execution above one has not run on the wire.** Staging was probed at two covenants
  with one refusal; both execute arms wrote a single covenant.
- **The per-item failure path is unit tested only.** The tool uses a partial-success update so one row
  the org refuses does not discard its siblings, but no live run has produced a partial failure.
- **The cockpit artifact's capability grant excludes `execute_covenant_review`.** Executing a covenant
  review from chat calls the connector directly and is unaffected; an execute driven from the artifact
  panel is not granted until that manifest is restated.
