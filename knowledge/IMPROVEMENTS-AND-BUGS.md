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
| 4 | P2 | Modification | Filing "failed" (07:40 + 12:57 runs, Customer 360 connected). **ROOT CAUSE FOUND** in `cm_Action_Staging__c.cm_Tracker_JSON__c`: step `roll_package` → *"nCino refused the credit action: The request contains invalid facilities."* Cause: yesterday's test roll wrote `LLC_BI__LoanRenewal__c` chain rows (parent→clone, `HasActiveRenewalLoan=true`); deleting the clone package + loans left those rows behind, so the parents' `hasRenewal` (FORMULA) / `Number_Of_Renewals` (ROLLUP) still read true/1 → nCino refused to roll them again. **FIXED (org data):** deleted the 12 Hartwell + 4 Meridian orphaned chain rows; both sets now `hasRenewal=false`, `0`. Lesson saved to memory: a clone cleanup must also remove its `LoanRenewal` rows. "Approval closed" on the finale = the cockpit's governance closing after a failed filing (consequence, not cause). | **Fixed — re-test** |
| 6 | P3 | Data hygiene | 19 other loans in the org read `hasRenewal=true` from PRE-test chain rows: mostly 2025 legacy demo accounts (BlueSky*, Bright*, Cy LTD, Summit, Horizon, Ironclad, Global, Doc Prep — outside the confined demo book) plus EverPetal / Flowers For Dreams (Feb 2026) and **Piedmont Precision — LOC $5,000,000 (chain row 2026-06-04, a June-era test)**. NOT touched — legacy rows aren't ours to clean, and the Piedmont one may be an intentional demo state. If a modification on Piedmont's $5M LOC is planned, its chain row must be cleared first or it hits the same "invalid facilities". **Founder decision 2026-09-12: leave the legacy accounts alone; only residue from OUR test-account fleet (Hartwell, Meridian, …) gets cleaned.** | **Decided — leave legacy** |
| 5 | P3 | Modification | Brain-narrated option chips (e.g. "$15.0MM Line of Credit") arrive as free text and can miss the deterministic parser, forcing the restate assist at all. Chips the room offers should carry a canonical, deterministically-parseable `say`. Design improvement, adjacent to P1. | Noted |

## Rule 1 ("knows the full relationship + everything around it") — status and completion

Audit truth (2026-09-12, 0.9.17): NOT yet. Three context builders over one bundle DISAGREE (workroom
envelope carries covenant thresholds/collateral/parties but drops maturities/stages; cockpit chat the
reverse, and drops `notCarried`); the OBLIGOR GROUP (`graph.connections`: guarantors, principals with
ownership %, affiliates) never reached any model; the in-flight version was dropped; the chat could
not state a covenant threshold. On demand (rung 3) the model can pull only `currentBoomRatios` and
`liveInvolvements` (the relationship graph) — never a CONNECTED party's own book.

| # | Pri | Item | Status |
|---|-----|------|--------|
| 7 | P1 (0.9.18, in flight) | Obligor group into the envelope + `notCarried`; covenant threshold + operator + current value into the chat; in-flight version into the envelope; scope stated when quoting totals. | Fixer running |
| 8 | P1 (next, after 0.9.18) | **Connected-party book on demand**: a rung-3 tool that reads the exposure/covenants of an account the anchored relationship's graph names (guarantor's own exposure, affiliate's breach) — bounded to the graph, never a free wander. Makes "what is the guarantor's own exposure?" answerable. | Spec'd here |
| 9 | P1 (next, after 0.9.18) | **One context builder**: unify the workroom envelope, the cockpit chat context and the relationship-room context into one builder so no two surfaces ever disagree on the same relationship, and every surface gets the full picture (budget-aware). | Spec'd here |
| 10 | P2 | Recommendation doctrine = **C (founder 2026-09-12)**: recommend only when grounded (on file / doctrine band), never invented. Follow-up pass after 0.9.18 adds the grounded chip/sentence (valuation on-file appraisal, covenant current value, rating bands, renewal tenor). | Decided — follow-up pass |
| 11 | P3 (later) | Salesforce platform + FSC (households, relationship groups, financial accounts) awareness in the envelope/doctrine. | Founder: "not dramatic right now" |

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
