---
name: client-request-to-action
description: Guided workflow. Turn a client's ask into a governed nCino action. Takes a request that arrived by email or was spoken in chat ("they want the line at 20 million"), resolves the product package and the facilities it touches, stages a package-anchored loan modification, presents the org's plan and warnings verbatim, waits for the banker's confirmation, executes behind the decision token, and reports the per-facility result. Use for an increase, a decrease, a repricing, a maturity extension or any other change to facilities that already exist.
---

# Client request to action

A client asks for something. The bank's answer is a **staged plan a named human approves**, not a
sentence in a chat window. This skill is the path between the two.

It is also the printed Dreamforce beat: *a client email "increase our line from 15 to 20M" arrives
via the M365 connector and becomes a governed action a banker approves.* The promise is in print, so
the workflow has to deliver it exactly.

> **Scope.** This skill modifies facilities that **already exist**. A brand new facility is
> `relationship-actions`, new facility workflow. A renewal is `relationship-actions`, renewal
> workflow, and it stages only.

---

## Handoff first

**When a cockpit is reachable, this ask becomes an INTENT, not a staged plan.** Compose the lines in
the room's grammar and hand them to the facility workroom; the banker watches it stage there. The
routing table is in `agents/credit-360.md` and in the `credit-360-cockpit` skill, which also
carries the intent shape and the `write_db` protocol. This ask is room `facility`, route `modify`,
and collateral pledged to one of these facilities belongs on that same route: a pledge versions the
package, which is a modification.

Steps 1 to 3 below run either way: they are how you understand the ask and read the relationship.
**Steps 4 to 8 are the explicit opt-in path** and run only when the banker asks to act without the
room ("do it here", "no cockpit") or no cockpit can be resolved. Then nothing about them is relaxed.

---

## 1. Take the request

The request reaches you one of three ways.

- **From the cockpit.** A `REQUEST_RECEIVED` entry already sits in the account's activity trail, with
  a real M365 message id and web link behind it. The parsed ask is on the entry. Use it.
- **From mail, on the spot.** The banker says "look at what Elena sent". Search Microsoft 365 for
  recent inbound mail naming the account. Entity resolution is conservative: attach a message to an
  account only when the account name clearly appears. Ambiguous matches are ignored.
- **Spoken in chat.** "James wants the revolver at 20." That is a complete request. Do not go hunting
  for an email to justify it.

**Restate the ask in one sentence before you touch a tool**, and name the citation behind it: a
message id, or the banker's own instruction. Judge **intent, not keywords**: "we are going to need
more room on the line before the Kokomo draw" is an increase request.

If the amount, the facility or the direction is genuinely ambiguous, ask **one** question. Do not
stage a plan against a guess.

---

## 2. Resolve the deal: package first, then facilities

Every plan is anchored on the **Product Package**. Resolve it before anything else.

1. `Customer360Snapshot` for the account gives the rollup and `packageCount`.
2. `Customer360Exposure` gives `facilities[]`, each carrying `loanId`, `name`, `productPackageId`,
   `committed`, `outstanding`, `available`, `stage`, `status`, `maturityDate`, `riskGrade` and its
   `collateral[]`.
3. Pick the package from `facilities[].productPackageId`. If the relationship stages more than one,
   **ask the banker which deal**, naming them. Never resolve members against one package and send
   another: the tool refuses it by name, and it refuses correctly.
4. Pick the facilities the request touches. Match on product and on the figure the client used. A
   client who says "the line" on a relationship with two lines of credit is naming one of them, so
   confirm which.

**A facility must be Booked and Open** for a credit action. `Customer360Exposure` reports `stage` and
`status` for each. A facility that is not there will come back refused or held at stage time, with
the org's reason. Read it before staging so you can say it first.

Worked example, the flagship relationship: Hartwell Precision Manufacturing LLC
(`001bb00001I7FPNAA3`) carries package `a5Fbb000000IHFJEA4` with six booked facilities, $46.0MM
committed against $31.03MM outstanding. "The line" is the $15,000,000 Line of Credit
(`a4Zbb0000027MaYEAU`, $9,200,000 outstanding, maturing 2027-03-15). An ask for "20" against that
facility is a $5MM increase, and the increase is what the plan carries as `requestedAmount`.

---

## 3. Read the relationship before you stage

The banker is going to be asked whether this is a good idea. Give them the read, from live figures
only, in three or four sentences:

- **headroom**: `committed` against `outstanding` and `available` on the named facility, and the
  package rollup;
- **coverage**: `coverageRatio` and `coverageShortfall` on that facility and at the relationship
  level, plus the pledged collateral behind it. `coverageRatio` can be `null`, which renders "—",
  never 0;
- **covenants**: `Customer360Covenants` for anything due, overdue or already at Exception, with the
  reason. A thin cushion is the number that will be argued about;
- **structure**: `Customer360StructuralSignals` for modification clustering, maturities in window and
  guarantor signals.

State the ask against those numbers. Do not recommend an approval, and do not decline one. Name what
a credit officer would want to see.

---

## 4. Stage the modification (opt-in path)

One call, package anchored, over the facilities the request touches. Reachable cockpit, no confirmed
opt-in: stop above and write the intent instead.

```json
{
  "idempotencyKey": "HARTWELL-MOD-20260904-01",
  "productPackageId": "a5Fbb000000IHFJEA4",
  "facilityIds": ["a4Zbb0000027MaYEAU"],
  "rationale": "Client request of 4 September: increase the revolver from $15.0MM to $20.0MM ahead of the Kokomo draw.",
  "requestedAmount": 20000000
}
```

Shape rules, all observed on the wire:

- **`facilityIds` is the package-anchored shape.** A flat `loanId` still works for a single facility
  and is back-compatible, and an empty `facilityIds` alongside a `loanId` resolves to that one
  facility. **Sending both a `loanId` and a non-empty `facilityIds` is refused**: *"Supply either the
  single loanId or facilityIds, but not both. Two shapes in one request is two intentions, and
  guessing which one wins would stage a modification against facilities the banker did not choose."*
  Send `facilityIds`.
- **`idempotencyKey` is yours to choose and must be stable for this intent.** Re-staging under the
  same key returns the same plan; re-executing under it returns `replayed: true` and writes nothing.
- **`rationale` is required** and it lands in the audit ledger. Write it in banker language and cite
  the request.
- **`productPackageId` is required.** Every selected facility must be a member of it.
- **Four requested changes are available**, all optional and all applied to the clone:
  `requestedAmount`, `requestedMaturityDate`, `requestedRate` and `requestedTermMonths`. Send only what
  the client actually asked for. The plan's apply step names the nCino fields behind them
  (`LLC_BI__Amount__c`, `LLC_BI__Maturity_Date__c`, `LLC_BI__InterestRate__c`,
  `LLC_BI__Term_Months__c`).
- **The requested changes apply to every selected facility.** Two facilities needing different terms
  are two plans, and the org says so in its own warning.

`stage_loan_modification` **writes nothing**. It returns `summary`, `warnings[]`, five typed steps per
facility, `stagingId`, `planHash`, `decisionToken`, `facilities[]` (each with `facilityName`,
`covenantCarryoverCount` and its three step ids), `facilityCount`, `executionHeld` and `heldReason`.

---

## 5. Present the plan, verbatim

Show the org's `summary` and **every string in `warnings[]`, word for word**. On a single booked
facility with no loan-level covenants the org sends five, and the load-bearing one reads:

> This plans a modification, NOT an approval. Executing it produces a clone facility at
> Qualification; BOOKING that clone requires nCino's Submit for Approval button, which
> Loan_Validation_06 enforces with no permission bypass.

Where the facilities carry loan-level covenants the org adds a sixth, naming the carryover count and
stating that nCino clones the junction rather than the covenant, so a business process has to decide
what happens to each one. Where the plan spans more than one facility it adds the per-facility
isolation warning and the "requested changes apply to every selected facility" warning. Do not merge
them, do not shorten them, do not drop the one that reads like boilerplate.

Then state, in your own words, what the plan will do and what it will not:

- nCino clones the named facility, creates the `LLC_BI__LoanRenewal__c` chain junction row, and
  applies the requested changes **to the clone**;
- the parent facility is not touched;
- the clone lands at **Qualification**. Nothing is booked, approved or funded.

**If `executionHeld` is `true`, stop here.** Report `heldReason` verbatim and do not call execute. The
observed held reason is the LV06 wall: *"A credit action requires a Booked, core-keyed facility, and
Loan_Validation_06 makes Booked unreachable through the API with no bypass."* The plan is persisted
and can be executed once that path exists.

---

## 6. The banker confirms

In words. No confirmation, no execute call. If they want a change to the plan, re-stage under a new
`idempotencyKey`; never edit a staged plan.

---

## 7. Execute

```json
{ "idempotencyKey": "HARTWELL-MOD-20260904-01", "stagingId": "a8a…",
  "planHash": "…", "decisionToken": "…", "approverUserId": "005…" }
```

All five taken verbatim from the staged plan. `approverUserId` must equal the running identity, or
the org refuses the call.

---

## 8. Report the per-facility result

`execute_loan_modification` returns `terminalState`, the five steps with their verification detail,
and `facilities[]`. Per facility, report exactly what came back:

| Field | Say |
|---|---|
| `cloneName` and `cloneLoanId` | the modification that now exists, by name and id |
| `cloneStage` | the stage it landed at. Observed: `Qualification` |
| `junctionName` and `revisionNumber` | the chain row and which revision this is |
| `appliedChanges` | the org's own read-back sentence, for example "Amount reads back at 20000000.00" |
| `parentUnchanged` | that the parent facility re-reads unchanged at Booked / Open |
| `bookingHandoff` | verbatim. It is the sentence that keeps the claim honest |

The `observe_side_effects` step ends `filed_unverified`. That is the design: stage-driven email
alerts and memo status changes run in their own transactions and report nothing back. When the
executor's own `terminalState` reads `success`, the run succeeded. Do not offer to resume it.

A replay returns `replayed: true`, names the facility the first run created and carries no
per-facility detail. Say that nothing was written twice.

Close on the handoff, in the banker's language:

> The modification exists as a facility at Qualification, at $20,000,000, with the parent revolver
> untouched at $15,000,000 and still Booked. Booking it is nCino's own run: Submit for Approval with
> real approvers. Nothing here has been approved.

---

## Fences

- **Never say increased, approved, booked or funded.** A clone at Qualification is what happened.
- **Never touch the parent.** The tool does not, and neither do you by any other route.
- **Never invent the ask.** The client's figure comes from the message or from the banker. If neither
  carries it, ask.
- **Never re-run execute to "make sure".** Idempotency is enforced by the tool because the platform is
  known to produce duplicate modification loans on failed background Apex. A second call is a replay,
  and a replay reported as a fresh write is a lie.
- **Multi-facility execution is unproven on the wire.** The live probe modified exactly one facility.
  Staging two is observed and supported; if you execute two, report what comes back and flag that this
  is the first live multi-facility run rather than presenting it as routine.
