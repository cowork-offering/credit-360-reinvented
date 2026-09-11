# Credit 360 — improvements & bugs backlog

Raw intake = the cockpit **Feedback bucket** (`bugs` collection in each cockpit's store, read with
`read_db`). This file is the **curated, triaged** list. Updated as reports come in.

## How Fabian reports (so the transcript is useful)
- Click **Feedback** *once the exchange is underway* (not on the opening screen) — the transcript
  captures the moment you click, so an early click grabs empty `[opening]/[packages]/[brief]`.
- Pick the closest category, one line of "expected vs happened", submit. One issue per report.

## Open — prioritised

| # | Pri | Area | Item | Status |
|---|-----|------|------|--------|
| 1 | **P1 (weekend, pre-Dreamforce)** | Modification | In-flight & post-booking package/exposure lifecycle — lock the original as "Modification in Progress", in-flight editable until approval, booked → old archived + exposure = new set only. Spec: `PACKAGE-LIFECYCLE-SPEC.md`. | Spec'd |
| 2 | P3 | Feedback | Transcript capture reflects click-time; early clicks capture empty. Consider capturing from room mount, or a hint. | Noted |
| 3 | P1 | Modification | **"Weird back-and-forth" / re-ask loop + "connect IDB Gateway" prompt** (bug `bug-1789112493629`). Root cause: the engines' `restate` assist called IDB Gateway DIRECTLY (not session-first); each parser miss waited up to 12s on the flaky bridge and often returned null → the room re-asked. | **FIXED 0.9.16** — restate now session-Claude-first, gateway fallback. Needs a FRESH publish from 0.9.16 to reach a viewer (artifact code is frozen at publish). Re-test: Fabian. |
| 4 | P2 | Modification | Filing reported "failed" (07:41 run) with Customer 360 connected: reached the cockpit's staging (plan + token) but the nCino EXECUTE write never landed (0 packages/loans created that day). NOT the version conflict (clone already removed). Exact cause unknown — the room's message was generic. Re-test on the now-clean state; if it fails again capture the room's verbatim reason. | Open — re-test |
| 5 | P3 | Modification | Brain-narrated option chips (e.g. "$15.0MM Line of Credit") arrive as free text and can miss the deterministic parser, forcing the restate assist at all. Chips the room offers should carry a canonical, deterministically-parseable `say`. Design improvement, adjacent to P1. | Noted |

## Stress-test script — run these, report each detail

### A. MODIFICATION (the primary path)
1. **Single-package borrower** — start a modification; does it bind the one package silently and *say
   it did*, or wrongly ask?
2. **Multi-package borrower** (Hartwell, Meridian) — does it ask which package? Are booked packages with
   an **in-flight version** shown as **"Modification in Progress"** and un-selectable? (this is P1)
3. **Forced rate** — at the rate ask: (a) type a new rate `7.25%`, (b) click the **Hold** chip, (c)
   *type* "hold" / "keep it" / "no change". All three should behave (set vs keep); none should loop.
4. **Amount** — increase and decrease a facility; use the **"Keep <current>"** chip; also *type* "keep".
5. **Term / maturity** — change amortised term and first payment date; keep-chips on each.
6. **Guidance quality** — every question should lead with the **current figure**, offer **options**, and
   **recommend** one. Flag any question that just asks blankly.
7. **Garbage input** — type gibberish, a negative, an absurd number, letters into the rate. It must
   re-ask gracefully, never loop or accept nonsense.
8. **The finale** — glass buttons; "Draft the credit memo" opens the memo (source reads **AFS**, never
   IRIS); "Back to <account>"; the **"Open the new package in nCino"** link resolves.
9. **Plan accuracy** — does the staged plan match EXACTLY what you asked (rate, amount, term, maturity)?
10. **Cross-flow lock (P1 repro)** — file/stage a modification on a package, then start ANOTHER
    modification on the SAME package → it must refuse ("Modification in Progress" / "book or discard in
    Salesforce first"), not fork a second version.
11. **Exposure after booking** — if you can get a modification to booked: does exposure show the **new**
    figure only, or old+new (double-count)? (this is the deep P1 case — gold if you can reproduce it)
12. **Feedback pill** present in the modify room header; transcript captures the exchange.

### B. RENEWAL
1. Pick a facility **near maturity** (Sterling has one) and start a renewal.
2. Change maturity, rate, commitment — same **current-figure + options + recommend** guidance + keep-chips.
3. Does it lead with the **current** commitment / rate / maturity before proposing?
4. Garbage-input + typed-hold behave.
5. Finale + new-package link.

### C. NEW FACILITY
1. Start a new facility — does it correctly **create a new package** (or add to an existing one), and is
   that choice clear?
2. Product type, amount, purpose, rate, term — each guided (options, recommend).
3. **US vs non-US / collateral** path — this is a known soft spot; watch for a loop or a vague ask
   ("please provide collateral information") instead of a specific one.
4. Finale + the new package resolves in nCino.

### D. COVENANT REVIEW / COLLATERAL VALUATION (relationship room)
1. **Covenant review** — the read card should be aligned (not stretched); package-scoped; the failing
   covenant pre-seeded with its current test vs threshold.
2. **Collateral valuation** — the ask should be **specific** ("needs a current valuation record for asset
   X; appraisal on file: $Y, date Z"), not vague; watch the US/non-US loop.
3. Feedback pill present (added 0.9.14).

### Cross-cutting — watch on EVERY flow
- **Looping / repeating** — any question asked twice, or a "hold" that re-asks.
- **Figures** — every number should trace to the book; flag any that looks invented or double-counted.
- **Voice** — sober banker tone, no marketing fluff, no exclamation points.
- **KPI/EWS popover** — clicking a tile opens the right room **pre-seeded** to the right account/ask.

## Done (recent)
- 0.9.9 stale-template fix · 0.9.10 KPI/EWS popover · 0.9.11 glass finale · 0.9.12 Feedback pill visible
  · 0.9.13 Feedback bucket · 0.9.14 Feedback in relationship room · 0.9.15 IRIS purged (→ AFS).
