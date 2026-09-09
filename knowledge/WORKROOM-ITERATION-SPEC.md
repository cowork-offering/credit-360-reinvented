# Workroom iteration — scope + order (Fabian, 2026-09-10)

Captured from a live testing session. Four connected pieces; build in this order.
Nothing here is on `main` yet; work continues on a branch, founder tests the build.

## 1. Bug / copy-transcript button (BUILD FIRST — unblocks feedback quality)
Every workroom AND the chat get one sleek, elegantly-aligned bug icon. Click =
copy the FULL end-to-end conversation to the clipboard, so testers/bankers can
paste it as feedback and we can see the exact flow (improves accuracy of every
other fix below). Must capture, in order, with timestamps:
- Which surface (relationship + workroom mode, or chat), opened when.
- Every AGENT message/question shown.
- Every BANKER input: typed lines AND chip clicks (the chip's `say`).
- Plan events: staged / confirmed / filed, and the manifest/entries state.
Design: a session transcript RECORDER (`channel/transcript.ts`, module singleton,
bounded ring buffer, guarded/no-op-safe) that the choke points append to
(composer submit, chip confirm, agent-line add, room open, plan stage/confirm/file).
A reusable `<BugCopyButton/>` reads it, `navigator.clipboard.writeText(markdown)`,
shows a "Conversation copied" toast. The workroom already holds its whole thread
in `items: ThreadItem[]` (folds, never deletes — Workroom.tsx:1221), so that state
is a good secondary source. Placement: workroom chrome + chat chrome, same spot,
quiet ink icon, hover reveals "Copy conversation for feedback".

## 2. The elicit loop fix (his exact reproduced bug)
Saying "hold" (keep current) on a rate/payment question re-asks forever.
- LOCATION: modifyEngine.ts:1445-1454 (awaiting branch keeps `awaiting` on a
  non-answer) → parseModify.ts:1543-1546 (parseAnswer→readValue) → bare questions
  at parseModify.ts:1240/1258/1284/1307 re-emit unchanged. Shared verbatim by
  renew (renewEngine.ts:731-736). "hold/keep/no change/unchanged/same/leave it/
  as is" handled NOWHERE (only rateGate.readRateHold:228 matches the exact chip
  sentence, not a typed word).
- FIX: recognize keep-words as "hold this field at its current value" → withdraw
  that field's change, clear `awaiting`, ADVANCE. Reply: "Holding {field} at
  {current}. {next / nothing else staged}." Shared fix in parseModify covers
  modify + renew. On the pricing-gate rate, typed "hold" maps to the existing
  keep-current-rate decision.
- COLLATERAL/CREATE loop (the "US vs non-US" report) is a SEPARATE machine:
  elicit.ts readInto/nextAsk (collateralAsk asset-kind elicit.ts:2003-2039, lien
  :2077-2088). Principle: an UNRECOGNIZED answer must not re-emit the identical
  question — show the options/chips (terminate), and accept keep/skip on optional
  slots. Fix in elicit.readInto/nextAsk.

## 3. Guidance layer — the ActionRequirement (needs one data decision)
Every elicit should ADVISE, not just collect: lead with the account's current
figure, offer the real options as chips, RECOMMEND one with a one-line reason,
accept "keep" as first-class.
- Today: the current figure is already shown on the direct path (withCurrent,
  modifyEngine.ts:1307) for amount/rate/maturity — but NOT term/spread; options
  exist ONLY behind the pricing gate (rateGate.rateAsk); a RECOMMENDATION exists
  nowhere.
- DATA GAP (the one decision): the `Facility` read (contract.ts:511-557) carries
  NO spread and NO payment amount, so a real "keep SOFR+300 vs the grade-5 spread"
  recommendation needs a small data add (surface spread + payment on the exposure
  read / Facility shape). DEFAULT PLAN: add them; recommend from grade + coverage.
- Build the `ActionRequirement` declaration once in the domain layer:
  `{ willFile, needsFromBanker, currentValue, options[], recommendation }`.
  Both the in-workroom elicit AND the KPI popup handoff read from it.

## 4. KPI fast-actions popup (spec: KPI-FAST-ACTIONS-SPEC.md)
Clickable Needs action / Reviews due / EWS -> insightful anchored popover (a READ
per relationship, not a list) whose CTA opens the right workroom pre-seeded to the
SPECIFIC ask (the ActionRequirement), never a vague "provide info". Shares #3's
declaration, so build together.

## Order + rationale
1 first (tiny, standalone, makes all feedback precise). Then 2 (his reproduced
bug, safe parse fix + tests). Then 3+4 together (share ActionRequirement; the one
data decision gates recommendation quality — default is to add spread/payment to
the read unless founder says otherwise).
