# In-flight & post-booking package / exposure lifecycle — PRIORITY 1 (Fabian, weekend before Dreamforce)

Source: Fabian feedback (bug bucket, report `bug-1789108170578-nmunjd`, Hartwell modification,
2026-09-11). Priority: #1 this weekend, must land before Dreamforce. This is a correctness fix
about how the cockpit reflects the nCino modification lifecycle — not a cosmetic one.

## The behaviour, as it MUST work

A modification does not edit a package. nCino FORKS it: a new package **version** is created holding a
COPY of every member at an unbooked stage, with the changed facility carrying the new figure. There are
three states, and the cockpit must reflect all three:

### State 1 — modification in flight (version forked, still unbooked, pre-approval)
- The **original booked PP is LOCKED FROM SELECTION** — not a "disabled row with fine print", but a
  first-class **"Modification in Progress"** state. It must not be pickable as a *new* modification
  target, anywhere the modification flow offers packages.
- The **in-flight version stays editable** — the banker can keep changing it (add loans, adjust figures)
  **up until it enters the approval stage**. Once it is in approval, it locks too.

### State 2 — modification booked (approved)
- The **old loans and the old PP become ARCHIVED**: non-actionable, completely. No modification, no
  review, no covenant work, nothing offers them.
- The **new loans / PP REPLACE the old**. A booked modification supersedes what it replaced; the two
  never co-exist as live.

### State 3 — exposure (the deep one Fabian flagged — "do not underestimate")
- Exposure, and every roll-up over facilities, must reflect **only the live set** — the new loans/PP
  after a booking, never old + new. A booked revolver increase reads as **$20M**, never **$15M + $20M**.
- Same for anywhere the archived facilities would otherwise appear (worklist, KPIs, relationship graph,
  the Financials/AFS provenance).

## What ALREADY exists (so this is a hardening job, not a rewrite)

`app/src/book/packages.ts` (`packageRoster`, rule 2, dated 2026-09-03):
- **Fork detection** — an all-unbooked package that `mirrors()` a booked one member-for-member is the
  in-flight version. Sets `inFlightVersion: true` + `reason` ("Modification in flight · booking
  pending · …").
- **Source linkage** — the booked source gets `hasInFlightModification: true` and `inFlightVersionId`.
  The `Customer360ActionHistory` trail (`loan-modification`, terminal status) corrects the source link.
- `lockedSourcePackage(roster, packageId)` and `IN_FLIGHT_REFUSAL` ("A modification of this package is
  already in flight and unbooked. Book or discard it in Salesforce first; a second one would fork the
  version chain.").
- Exposure sums over `isActiveFacility` only.
- The **RelationshipRoom** picker renders disabled rows (`disabled`, `data-inflight`, blocks onClick).

## The GAPS to close this weekend

1. **"Modification in Progress" as a first-class lock on the ORIGINAL, in the MODIFICATION flow.**
   Verify/!wire the modify/renew picker (Workroom path, not just RelationshipRoom) to hard-block the
   booked source when `hasInFlightModification`, showing "Modification in Progress" — never a subtle
   disabled row. Confirm `lockedSourcePackage` is enforced on the modify entry, not only in review.

2. **"Editable until approval" for the in-flight version.**
   The in-flight version should be workable (add/change) until it reaches the approval stage, then lock.
   Needs the approval-stage read (which nCino stage = "in approval") to flip `inFlightVersion` from
   editable → locked. Today `inFlightVersion` is a single boolean; it likely needs an
   editable-vs-locked distinction keyed on stage.

3. **Post-booking archival + exposure replacement (the big one).**
   - Determine how nCino flags the old loans/PP once the modification BOOKS (archived status? inactive
     flag? the version becomes the live PP and the old one drops out of the active set?).
   - Confirm `isActiveFacility` (and `packageRecords`) DROP the archived-after-booking set, so exposure
     and every roll-up count the new only. If they don't, that is a **double-count bug** — fix it here,
     once, where the book is derived, so every surface inherits it.
   - Make the archived old loans/PP non-actionable everywhere (no room opens on them).

## Acceptance criteria

- In the modification flow, a booked PP that has an in-flight version shows **"Modification in
  Progress"** and CANNOT be selected. Verified on live-shaped data (not just the baked snapshot).
- The in-flight version is editable pre-approval, locked once in approval.
- After a booking, the old loans/PP are archived: no room offers them, and **exposure equals the new
  set only** (the revolver-increase case reads the new figure, not old+new).
- Full vitest suite green; a new packages.ts test covers the three states incl. the exposure
  replacement; the lane probe covers the "Modification in Progress" lock in the modify picker.

## Notes / open questions to resolve at build time

- The exact nCino stage name(s) for "in approval" and for "archived/superseded after booking" — read
  from the live org, do not assume.
- `mirrors()` requires an exact member-count match; a partial clone (fewer members than the booked
  source) slips through. Decide whether to loosen to a majority-name match without the size gate, or
  lean on the ActionHistory trail, so a real fork is never missed.
- Whether the modify picker and the RelationshipRoom picker share one component or two — unify the lock
  so it cannot be wired in one and missed in the other.
