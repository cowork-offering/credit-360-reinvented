---
name: collateral-valuation
description: Guided workflow. File new valuations against the collateral pledged to a deal. Reads the collateral pool for the product package, stages a batch of dated valuations under one decision token, presents the org's plan and warnings verbatim, and reports per collateral what was filed and whether the collateral value moved. Use when a banker says "value the collateral", "the appraisal came in", "the field exam is back" or "re-value the pledged assets".
---

# Collateral valuation, package anchored

A banker values the **collateral pool of a deal**, not an asset in isolation. Every valuation batch is
anchored on one product package, and every collateral in the batch has to be provably part of it.

> **Filing a valuation does not move the collateral value.** nCino binds that rollup to its own Add
> Valuation button and it does not fire headlessly. The tool reports the fact per item and claims no
> coverage improvement. Neither do you.

---

## Handoff first

**When a cockpit is reachable, this ask becomes an INTENT, not a staged batch.** Compose the lines in
the room's grammar and hand them to the relationship workroom; the banker watches it stage there. The
routing table is in `agents/credit-360.md` and in the `credit-360-cockpit` skill, which also
carries the intent shape and the `write_db` protocol.

Valuing collateral that is **already pledged** is room `relationship`, route `valuation`. Two nearby
asks route elsewhere and are the ones most easily got wrong: pledging collateral **to a facility**,
new or already held, is room `facility` route `modify`, and registering a collateral **asset with
nothing pledged** is room `relationship` route `intake`.

Steps 1 and 2 below run either way. **Steps 3 to 6 are the explicit opt-in path** and run only when
the banker asks to act without the room ("do it here", "no cockpit") or no cockpit can be resolved.

---

## 1. Resolve the deal and the collateral pool

1. `Customer360Exposure` for the account returns `facilities[]`, each with `productPackageId` and its
   own `collateral[]`. Each collateral row carries `collateralId`, `collateralName`,
   `collateralType`, `collateralValue`, `currentLendableValue`, `advanceRate`, `advanceRateSource`,
   `lienPosition`, `isPrimary`, `pledgedStatus`, `amountPledged` and `collateralDescription`.
2. Pick the **product package**. If the relationship stages more than one, ask which deal. The
   collateral list is then filtered to that package, never to the whole relationship.

**Package membership has exactly two routes**, and there is no third:

- the collateral is **pledged to a loan** of that package, or
- it is **owned by the package's borrower** through `LLC_BI__Account_Collateral__c`, the object
  labelled Collateral Ownership.

`LLC_BI__Collateral__c` carries **no Account lookup of any kind**, which is why the ownership junction
is the only relationship anchor. A collateral that reaches the batch through neither route is refused
by name, and refused correctly.

---

## 2. Read the coverage before you file anything

Give the banker the current position from live figures only:

- per facility, `coverageRatio` and `coverageShortfall`. A `null` ratio renders "—", never 0 and never
  a computed guess;
- per collateral, `collateralValue` against `currentLendableValue`, the `advanceRate` and whether it
  came from the collateral type default or a pledge override (`advanceRateSource`);
- the lien position and whether the pledge is primary.

Then say what the new valuation would mean **if** the rollup were to move, and say plainly that it
will not move here.

---

## 3. Stage the batch (opt-in path)

Reachable cockpit, no confirmed opt-in: stop above and write the intent instead.

```json
{
  "idempotencyKey": "HARTWELL-VAL-20260904-01",
  "productPackageId": "a5Fbb000000IHFJEA4",
  "rationale": "August field exam and the Kokomo appraisal refresh.",
  "items": [
    { "collateralId": "a35…", "value": 1100000, "valuationDate": "2026-09-04",
      "type": "Net Orderly Liquidation Value", "source": "Third Party Source",
      "description": "NOLV per the August field exam.", "primary": true },
    { "collateralId": "a35…", "value": 275000, "valuationDate": "2026-09-04",
      "type": "As Is Value", "source": "Internal Valuation",
      "description": "Internal mark on the secondary asset.", "primary": false }
  ]
}
```

Shape rules, all enforced in Apex and all observed on the wire:

- **`productPackageId` is required.** It is the deal anchor. Without it a batch could span deals and
  nothing would say so.
- **`valuationDate` is required on every item** and is **never defaulted to today**. nCino uses it to
  decide which valuation record is the latest, so a null-dated row cannot be ordered against the ones
  already on file. Where the cockpit prefills it, it prefills from `meta.generatedAt`, the render
  clock, and the banker can edit it.
- **`items[]` is capped at 20.** The cap is a governor limit, not a style choice: the org runs
  per-record change-data-capture queueables against a ceiling of 50 per synchronous transaction. A
  larger set is more than one batch.
- `value` is the new valuation amount. `type`, `source`, `description` and `primary` are optional and
  should be filled when the evidence names them.
- **`rationale` is required** and feeds the audit ledger.

`stage_collateral_valuation` **writes nothing**. It returns `summary`, `warnings[]`, three typed steps
per item (`write_valuation_<n>` → `verify_valuation_<n>` → `verify_rollup_<n>`), `stagingId`,
`planHash`, `decisionToken` and `items[]` with each collateral's name, value and step ids.

---

## 4. The four refusals, verbatim

When the org refuses a batch it says why, precisely, and names the failing item by position and by
collateral name. Surface the message word for word and fix the input rather than arguing with it.

**Wrong package.**
> Collateral COL-000000 is not part of product package ZZ-WS05VAL Borrower - 8/22/2026 - PP (item 2
> of 2). It is pledged to no loan on this package, and it is not owned by the package's borrower. A
> valuation batch is anchored on one deal, so a collateral that reaches it through neither route is
> refused rather than filed against the wrong package.

**Missing valuation date.**
> valuationDate is required (item 1 of 1). nCino uses it to decide which valuation record is the
> latest, so a null-dated row cannot be ordered against the ones already on file. It is not defaulted
> to today: that would make two valuations of one asset on one date the normal case, which the
> platform has raised errors on.

**Missing package.**
> productPackageId is required. It is the deal anchor, and every collateral valued must be provably
> part of it: pledged to a loan of the package, or owned by the package's borrower. Without it a batch
> could span deals and nothing would say so.

**Same collateral, same date.**
> COL-000766 already carries valuation CV-0000000014 dated 2026-08-22 (item 1 of 1). Two valuations of
> one asset on one date leave nCino unable to decide which is the latest. Use a different date, or
> amend the existing record outside this tool.

---

## 5. Present the plan, verbatim

Show the org's `summary` and **every string in `warnings[]`, word for word**. The four observed on a
two-item batch:

> nCino binds the collateral auto-update to the Add Valuation button and it does not fire headlessly.
> Wave 3 probe 6 settled this on both arms: filing a valuation does NOT move the collateral value.
> Each item reports its own rollup answer and none of them claims a coverage improvement.

> Sub-collateral creation is not offered: it fires the parent validation rules even when nothing
> changed, and the documented workaround has no headless equivalent.

> This is one batch of 2 valuations under a single confirmation. Each is written and verified
> separately, so a failure on one is reported against that collateral and does not silently discard
> the others.

> Every collateral in this batch was proved to belong to the named product package, by pledge to one
> of its loans or by ownership through the borrower. The batch is anchored on one deal.

Then state what will be written: one new valuation per item, each marked **Active** and **not the
original valuation record**, with the type, source and primary flag as requested. **No status is
changed anywhere and no credit decision is made or implied.**

**If `executionHeld` is `true`, stop.** Report `heldReason` verbatim and do not call execute.

---

## 6. Confirm, execute, report

The banker confirms in words. Then:

```json
{ "idempotencyKey": "HARTWELL-VAL-20260904-01", "stagingId": "a8a…",
  "planHash": "…", "decisionToken": "…", "approverUserId": "005…" }
```

`execute_collateral_valuation` returns `terminalState`, the steps with their verification detail, a
batch `outcome`, and `items[]`. Per item report:

| Field | Say |
|---|---|
| `recordName` and `valuationId` | the valuation record that now exists |
| `anchorName` | the collateral it was filed against. The execute item names it here, not in `collateralName` |
| `collateralValueMoved` | whether the collateral value moved. Observed: always `false` |
| `outcome` | the org's own sentence, verbatim |

The batch outcome observed on the wire:

> 2 valuations filed. No collateral value moved: nCino binds that update to the Add Valuation button,
> so no coverage improvement is claimed for any of them.

Close by restating the coverage position **unchanged**, and by naming what a human would have to do
in nCino for the rollup to move.

---

## Fences

- **Never claim a coverage improvement.** The valuation is on file; the collateral value did not move.
- **Never default the valuation date.** Ask for it, or take it from the render clock and show the
  banker what it is.
- **Never split a batch to get past the cap of 20 without saying so.** Two batches are two plans, two
  confirmations and two tokens.
- **Never file a second valuation on the same asset and the same date.** Change the date or amend the
  existing record outside this tool.
- **Never offer sub-collateral creation.** It is not on this surface, for the reason the org states.
- **A refused item names the failing position and collateral.** Surface it and correct the input.
