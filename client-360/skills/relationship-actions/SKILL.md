---
name: relationship-actions
description: Guided workflow. The four relationship-level nCino actions plus renewal. Raise a service request from a client ask, open an annual or ad-hoc credit review, stage a risk rating review, structure a new facility on a package, or stage a renewal. Each follows the same governed pattern: stage, present the org's plan and warnings verbatim, the banker confirms, execute behind the decision token, verify by re-query. Use when a banker says "raise a service request", "run the annual review", "review the risk rating", "structure a new facility" or "start the renewal".
---

# Relationship actions

Five workflows on one governed pattern. Read the **write discipline** in `agents/credit-360.md`
first: stage, present verbatim, the human confirms, execute with the five-field payload, verify by
re-query, name the handoff. Everything below is what each action adds on top of it.

Every execute call is the same five fields taken verbatim from the staged plan:
`{ idempotencyKey, stagingId, planHash, decisionToken, approverUserId }`, with `approverUserId` equal
to the running identity. The one exception is the second invocation of `execute_new_facility`, which
runs without a token by design. See that section.

---

## Handoff first

**When a cockpit is reachable, every one of these asks becomes an INTENT, not a staged plan.**
Compose the lines in the room's grammar and hand them to the room; the banker watches it stage there.
The routing table is in `agents/credit-360.md` and in the `credit-360-cockpit` skill, which also
carries the intent shape and the `write_db` protocol. These five workflows route:

| Workflow | Room | Route |
|---|---|---|
| Service request | `relationship` | `service` |
| Annual review | `relationship` | `annual` |
| Risk rating review | `relationship` | `rating` |
| New facility | `facility` | `create`, or a `modify` document when other changes ride along |
| Renewal | `facility` | `renew` |

Reading the relationship, resolving the package and restating the ask run either way. **Every
`stage_*` and `execute_*` step below is the explicit opt-in path** and runs only when the banker asks
to act without the room ("do it here", "no cockpit") or no cockpit can be resolved. Then the governed
pattern applies unchanged.

---

## Service request

The servicing ask that is not a credit action: a wire template change, a statement re-issue, an
authorised-signer update, a rate reset question. It files a Case against the relationship.

**Stage** with `stage_service_request`:

```json
{
  "idempotencyKey": "HARTWELL-SR-20260904-01",
  "accountId": "001bb00001I7FPNAA3",
  "rationale": "Client request of 4 September, routed to servicing.",
  "requestType": "Authorised signer update",
  "summary": "Elena Hartwell asks that the two new plant controllers be added as authorised signers on the operating account, effective 1 October.",
  "referenceKind": "m365-message",
  "referenceId": "<the real message id>",
  "referenceWebLink": "<the real message link>"
}
```

- `accountId`, `rationale`, `requestType` and `summary` are all **required**. `requestType` is banker
  language and becomes the case subject. `summary` is the request in full, as the servicing team needs
  to read it.
- The three `reference*` fields are the **citation** behind a client-request prefill. Supply them
  **only when a real source exists**, and supply the real id and the real link, never a constructed
  one. Omit all three when the ask was spoken.
- The plan reports `productPackageId` where the relationship has one, and it reports
  **`degradedTypeMode`**. That flag is `true` when the org does not offer the honest Type and Origin
  picklist values and the tool has substituted the probe-proven pair. If it comes back `true`, say so:
  the case is filed under a substituted type, and that is a data-model gap in the org, not a choice
  anyone made here.

**Report** the case the execute call names. Never invent a case number, and never state one before
execute returns it.

---

## Annual review

The periodic credit review. It opens a review record against the relationship, optionally scoped to
one package, and carries the narrative sections the reviewer writes.

**Stage** with `stage_annual_review`:

```json
{
  "idempotencyKey": "HARTWELL-AR-2026-01",
  "accountId": "001bb00001I7FPNAA3",
  "rationale": "FY2026 annual credit review, due on the September anniversary.",
  "reviewType": "Annual",
  "productPackageId": "a5Fbb000000IHFJEA4",
  "relationshipSummary": "…", "strengthsNarrative": "…", "weaknessNarrative": "…",
  "recommendationNarrative": "…", "collateralAnalysisNarrative": "…",
  "financialAnalystNarrative": "…", "guarantorNarrative": "…",
  "riskRatingComments": "…", "narrative": "…",
  "editedNarrativeFields": ["weaknessNarrative"]
}
```

- **`reviewType` is required and nothing defaults it.** The values are `Annual`, `AdHoc` and
  `Problem Loan`. An omitted type files a review of no type, which is why the org refuses it. Ask which
  one rather than guessing.
- `productPackageId` is optional. Supply it for a package-scoped review; it is also the deep-link
  anchor.
- The narrative fields are yours to **draft** from live figures and the banker's to **own**. Draft
  them, show them, take the corrections, then stage.
- **`editedNarrativeFields` is ledger only.** List the field keys the banker revised on your drafted
  prose. Nothing from that list is injected into the nCino field text; it records who changed what, so
  a reviewer can tell agent-drafted prose from banker-revised prose.

Every figure in every narrative traces to a tool response. A review section that reads well and cites
nothing is the failure mode here.

---

## Risk rating review

Stages a review of the relationship's risk rating. It does **not** change a rating. A rating is a
credit decision and stays a human's.

**Stage** with `stage_risk_rating_review`:

```json
{
  "idempotencyKey": "HARTWELL-RR-2026Q3-01",
  "accountId": "001bb00001I7FPNAA3",
  "rationale": "Q3 review triggered by the construction facility coverage shortfall.",
  "loanId": "a4Zbb0000027Mp3EAE",
  "computedRiskGradeValue": 5,
  "overriddenRiskGradeValue": 0,
  "comments": "…",
  "cashFlowCoverageActual": 1.42,
  "creditScoreActual": 680,
  "managementExperienceActual": 4,
  "revenueGrowthActual": 0.08
}
```

- **`accountId` is the object's one hard-required field.** A risk rating review hangs off the account,
  not the loan. `loanId` is optional and nillable; supply it when the review is driven by one facility.
- `computedRiskGradeValue` is the model output on the **1 to 12 review scale**.
- **`overriddenRiskGradeValue` above zero makes `comments` mandatory.** The org's `Mandatory_comment`
  validation rule tests `LLC_BI__Comments__c` directly, so an override with no comment is refused. If
  the banker wants an override, get the reason in their words first.
- The four `*Actual` fields are the factor actuals. Supply only what you can evidence.

Present the computed grade as **an input to a review**, never as a decision. Say what changed since
the last rating and what a credit officer would weigh.

---

## New facility

Structures a brand new facility on the package. This is the one action that runs in **two execute
invocations**, and the shape exists for a reason that cannot be engineered around.

**Stage** with `stage_new_facility`:

```json
{
  "idempotencyKey": "HARTWELL-NF-20260904-01",
  "productPackageId": "a5Fbb000000IHFJEA4",
  "rationale": "New $6.0MM equipment facility for the Kokomo line, per the client's 4 September ask.",
  "product": "Equipment",
  "amount": 6000000,
  "primaryLoanPurpose": "Equipment Purchase",
  "termMonths": 84
}
```

- **`product` is required.** The org self-populates `Construction` when it is blank and then builds
  the loan name from it, so an omitted product ships a mislabelled facility.
- **`amount` is required.** It gates LV11 on the Qualification to Proposal hop.
- **`primaryLoanPurpose` is required.** It gates LV12. The org leaves it null on the Loan Detail it
  creates.
- **`productPackageId` is optional, and omitting it is a decision.** Omit it and the plan creates a
  **new credit package** for the relationship first, which is the package-first flow nCino treats as
  canonical. In that case `accountId` becomes required, because there is no package to derive the
  borrower from. The plan reports `createsPackage` and `plannedPackageName`; show both and let the
  banker confirm the package is meant to be new.

### The two invocations

**Invocation 1** inserts the Loan at Qualification/Open, writes the Borrower involvement row, commits
and **returns immediately**. `write_loan` and `verify_loan` land `verified`; `wait_loan_detail` lands
`waiting` with `resumable: true`; the purpose write and the stage hop stay `pending`. `terminalState`
is **`partial`**, and that is the honest answer, not a failure. The decision token is consumed here,
because the banker's confirm authorised the whole plan.

Report it as progress and quote the org's own resume descriptor:

> Continue this action to verify the Loan Detail and complete the move to Proposal. No new
> confirmation is needed: the same plan is still running.

**Invocation 2** is a resume on the same `stagingId`. It runs **without a token**: it authenticates on
`stagingId` plus `planHash` plus `idempotencyKey` plus the same approver identity, and it is gated on
the staging row actually being in the partial state. It cannot start a fresh action, it cannot run
against a different plan, and it cannot be driven by a different human than the one who confirmed.

It re-reads the Loan's Loan Detail lookup **once**. If the child is there it writes the purpose,
performs the single allowlisted hop to Proposal, verifies and finishes `success`. If it is not there
yet it returns still-waiting and resumable again. **An absent child is never a failure**: the Loan
Detail is created by an after-commit async flow, so it is structurally invisible to the transaction
that inserted the loan, and no amount of waiting inside that transaction can ever see it. Wait a
moment and invoke again.

Booked stays unreachable. `Loan_Validation_06` carries no bypass and nCino requires a human Submit for
Approval. This tool advances the facility exactly one step, to Proposal, and stops.

---

## Renewal

**Stages only. There is no `execute_renewal`.**

`stage_renewal` takes the same package-anchored shape as a modification:

```json
{
  "idempotencyKey": "HARTWELL-REN-20260904-01",
  "productPackageId": "a5Fbb000000IHFJEA4",
  "facilityIds": ["a4Zbb0000027MaYEAU"],
  "rationale": "2027 maturity renewal of the operating line.",
  "newMaturityDate": "2028-03-15",
  "requestedRate": 7.35
}
```

- **`newMaturityDate` is required.** A renewal is maturity driven.
- `requestedRate` is an optional repricing.
- Supply `facilityIds` **or** `loanId`, never both.

Stage it, present the org's `summary` and every warning verbatim, and **stop there**. The plan is
persisted and can be executed once an execute path exists. Two of the org's warnings on this action
are the ones a banker most needs to hear:

> A renewal auto-creates a new Opportunity and is effectively irreversible once run.

> LLC_BI__Renewal_Number__c must be set explicitly or left to the invocable. A blank number yields a
> facility named _Rnull and breaks core sync.

Say plainly: the renewal is planned, nothing is filed, and filing it is not available from this
surface. Do not go looking for another route.

---

## Fences across all five

- **Never claim a record before execute names it.** No case number, no review id, no facility name,
  no package name, until the org returns it.
- **Never treat `partial` on a new facility as a failure**, and never treat a `waiting` Loan Detail as
  one either.
- **Never change a risk rating.** You stage a review of it.
- **Never file an annual review of no type.**
- **Never execute a renewal.** The tool does not exist.
- **Every narrative figure traces to a tool response.** Draft, cite, show, then stage.
