# Modification — hardcore torture-test script

Goal: break it. Every entry point, every field, every input class, every state transition, every UI
control. For each case: do the **Action**, check the **Expect**, and if it deviates send a Feedback
report (click Feedback *mid-flow* so the transcript is full). Borrowers with multiple packages/facilities
give the richest coverage: **Hartwell Precision**, **Meridian Coastal Logistics**. Sterling has a
near-maturity facility.

Legend: ✅ expected behaviour · 🚩 report if you see this.

---

## Phase 0 — Entry points (the same modification, reached 5 ways)
| # | Action | Expect |
|---|--------|--------|
| 0.1 | Open from the **worklist** row (a client-request / modification reason) | ✅ opens the modify room on the right account, pre-scoped |
| 0.2 | Open from the **KPI/EWS popover** "Open the request" CTA | ✅ same room, pre-seeded with the ask |
| 0.3 | Open from **chat**: "modify Hartwell's revolver" | ✅ resolves the account + facility, no wrong match |
| 0.4 | Open from the **relationship room** action | ✅ consistent room |
| 0.5 | Open with a **typed prompt that's ambiguous**: "make a change to Hartwell" | ✅ asks what to change; 🚩 guesses silently |

## Phase 1 — Package selection + the in-flight LOCK (P1 focus)
| # | Action | Expect |
|---|--------|--------|
| 1.1 | Modify a **single-package** borrower | ✅ binds the one package silently and SAYS it did; 🚩 asks needlessly |
| 1.2 | Modify a **multi-package** borrower (Hartwell/Meridian) | ✅ asks which package, each with stage + facility count + committed |
| 1.3 | In the picker, a booked package that **already has an in-flight version** | 🚩 (P1) it should read **"Modification in Progress"** and be **un-selectable** — report whatever you CAN select |
| 1.4 | Select an **in-flight (Qualification/Proposal) version** itself | 🚩 must be disabled/refused, not a fresh target |
| 1.5 | Pick a package, then try to **switch package** mid-flow | ✅ lets you change anchor cleanly; 🚩 double-binds or loops |

## Phase 2 — Facility selection
| # | Action | Expect |
|---|--------|--------|
| 2.1 | Package with **one active facility** | ✅ binds it, says so |
| 2.2 | Package with **several** | ✅ asks which facility, with current terms |
| 2.3 | Ask to modify a **non-existent / booked-out** facility | ✅ honest "not on this package"; 🚩 invents one |

## Phase 3 — The change, per field × input matrix
Run this matrix for **each** field: **Amount / commitment**, **Rate**, **Amortised term**, **Maturity
date**, **Payment / first payment date**. For each field:

| # | Input class | Example | Expect |
|---|-------------|---------|--------|
| 3.a | Clean valid | rate `7.25%`, amount `20,000,000` | ✅ sets it; plan echoes it exactly |
| 3.b | Keep via **chip** | click "Keep <current>" | ✅ keeps; says "keeps X" |
| 3.c | Keep via **typed word** | "hold" / "keep it" / "no change" / "same" / "unchanged" / "as-is" / "stet" / "leave it" | ✅ every synonym keeps; 🚩 any that loops or re-asks |
| 3.d | **Relative** change | "increase by $5M", "add 50bps", "extend 24 months", "lower a quarter point" | ✅ computes from the CURRENT figure correctly; 🚩 treats it as absolute |
| 3.e | **Wrong unit** | "$7.25%", "6 million percent", a % into an amount field | ✅ re-asks / clarifies; 🚩 accepts nonsense |
| 3.f | **Ambiguous partial** | "7" (7% or $7?), "make it 5" | ✅ asks which; 🚩 guesses |
| 3.g | **Garbage** | "asdf", "!!!", emoji | ✅ re-asks gracefully; 🚩 loops or crashes |
| 3.h | **Out of range** | negative, `0`, `999999999999`, `0.0001%`, a maturity in the PAST | ✅ questions it / refuses; 🚩 stages an absurd plan |
| 3.i | **Multiple values one line** | "rate 6% and amount 15M" | ✅ handles both or asks; 🚩 drops one silently |
| 3.j | **Empty / whitespace / bare Enter** | just press Enter | ✅ re-prompts; 🚩 advances with a blank |
| 3.k | **Change your mind** | set 7%, then "actually 8%" | ✅ takes the latest; 🚩 keeps the first or stacks both |
| 3.l | **Contradiction** | "keep it but make it 8%" | ✅ asks which you mean; 🚩 does something silently |

## Phase 4 — The FORCED pricing gate (the known sharp edge)
When a facility figure changes, the room forces a sequence you **cannot skip**: amortised term → first
payment date → **rate (forced)**.
| # | Action | Expect |
|---|--------|--------|
| 4.1 | Reach the forced **rate** ask; click the **Hold 6.58%** chip | ✅ "keeps 6.58%" |
| 4.2 | At the forced rate ask, **type** "hold" / "keep it" / "no change" | ✅ holds the forced rate (matches the chip); 🚩 stuck/loops (the old bug) |
| 4.3 | At the forced rate, type a **value** `7.10%` | ✅ sets it |
| 4.4 | At the forced rate, type **garbage** | ✅ re-asks; 🚩 loops |
| 4.5 | Try to **skip** the amortised-term / first-payment step | ✅ it won't let you skip a forced step, but keep-current works; 🚩 dead-ends |
| 4.6 | Verify the **sequence order** is amort term → first payment → rate | 🚩 out of order or a step missing |

## Phase 5 — Mid-flow controls & session integrity
| # | Action | Expect |
|---|--------|--------|
| 5.1 | Click the **✕ close** mid-flow, then re-open the same modification | ✅ clean resume or clean restart, no ghost state; 🚩 half-staged mess |
| 5.2 | Start a modification, **abandon**, start a different one | ✅ no bleed-through of the first one's figures |
| 5.3 | **Feedback pill** mid-flow | ✅ present in header; transcript captures the exchange (not empty) |
| 5.4 | Modify **two facilities** in one session (if offered) | ✅ both tracked; plan lists both |
| 5.5 | Very **long conversation** (10+ turns of edits) | 🚩 slowdown, repeats, or lost context |

## Phase 6 — Stage / plan accuracy (the trust check)
| # | Action | Expect |
|---|--------|--------|
| 6.1 | Read the staged plan | ✅ matches EXACTLY what you asked — every field, no invented ones |
| 6.2 | Check the **current** figures shown | ✅ trace to the book (right starting rate/amount/maturity) |
| 6.3 | Check the **new** figures / deltas | ✅ math is right (relative changes computed from current) |
| 6.4 | Org **warnings** on stage | ✅ shown verbatim, not swallowed |
| 6.5 | The **decision token** line | ✅ single-use, bound to identity; 🚩 missing or reused |

## Phase 7 — The finale (FiledSheet)
| # | Action | Expect |
|---|--------|--------|
| 7.1 | Reach the finale | ✅ glass buttons (not dark), fitting the card |
| 7.2 | "**Draft the credit memo**" | ✅ opens the memo; rating/covenant source reads **AFS** (never IRIS) |
| 7.3 | "**Open the new package in nCino**" link | ✅ resolves to the created package |
| 7.4 | "**Back to <account>**" | ✅ returns to the relationship cleanly |
| 7.5 | Exposure/figures on the finale | ✅ reflect the change; 🚩 double-count or stale |

## Phase 8 — Lifecycle & cross-flow (P1 repro)
| # | Action | Expect |
|---|--------|--------|
| 8.1 | Stage/file a modification on a package, then start a **second** modification on the SAME package | 🚩 must refuse ("Modification in Progress" / "book or discard in Salesforce first") — report if it lets you |
| 8.2 | The **original booked PP** after a modification is in flight | 🚩 must not be an actionable modification target |
| 8.3 | If you reach **booked**: exposure = **new set only** | 🚩 old+new double-count is the P1 gold case |

## Cross-cutting — watch on every single case
- **Looping / repeating** — any question asked twice; any "hold" that re-asks.
- **Invented / double-counted figures** — every number must trace to the book.
- **Banker voice** — sober, specific, no marketing language, no exclamation points, no emoji.
- **Chips** — render, are clickable, and do what they say.
- **Latency / stall** — note where it feels slow or hangs.
