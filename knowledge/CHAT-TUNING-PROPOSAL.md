# Chat tuning proposal — every conversational surface against the golden rule

Audit date 2026-09-12. Judged against `knowledge/CHAT-GOLDEN-RULE.md` (Fabian, 2026-09-12).

**FINDINGS ONLY. No production code was changed.** What was added: repro tests at
`app/src/chatGolden.repro.test.ts` and this document. Every claim below was verified by reading
the source or by running the layer against the baked Piedmont/Hartwell book
(`artifact/live-data.json`); nothing is inferred from grep alone.

## What was audited

| Surface | Entry | Context builder | Model |
|---|---|---|---|
| Cockpit chat | `components/ChatPanel.tsx:232` | `channel/deskAsk.ts:48` `deskContext` | session door, no tools, no thread |
| Cockpit chat (fallback) | `ChatPanel.tsx:286` | `data/grounding.ts:349` `buildGroundedPrompt` | gateway, 600-byte cap |
| Facility rooms (modify / renew / new facility) | `components/workroom/Workroom.tsx:2451` | `components/workroom/brainRoute.ts:100` `buildEnvelope` | `channel/brainLane.ts:915` `askBrain` |
| Relationship room (6 reviews) | `components/relationship/RelationshipRoom.tsx:1235` | `components/relationship/relBrain.ts:93` `buildRelEnvelope` | same |
| Deterministic engines | `workroom/modifyEngine.ts`, `renewEngine.ts`, `createEngine.ts`, `components/relationship/reviewFlows.ts`, `intakeFlows.ts` | n/a — these compose the asks themselves | n/a |
| Doctrine (the model's standing instruction) | `channel/doctrine.ts` (27 blocks, 18 KB budget) | — | — |

Two things to hold on to before the findings.

**There is no one conversational layer.** There are three context builders over one bundle, and
they disagree. The workroom envelope carries covenant thresholds, collateral and parties and
drops maturities and stages; the cockpit chat carries maturities and stages and drops thresholds,
collateral and parties. On Hartwell the two even report different committed totals for the same
relationship: the desk says **$57M** across 9 facilities (`deskAsk.ts:63-67`, every active
facility on the relationship), the room says **$49M** across 7 (`readBlocks.ts:48-52`, the
anchored package). Both are honest about their own scope and neither states it.

**The envelope is not full.** On the deepest relationship in the book the whole facility envelope
serialises to **7,408 bytes against a 10,000-byte cap** (`ENVELOPE_CAP_BYTES`, `brainLane.ts:247`);
the read blocks alone are 6,119. There is roughly 2.5 KB of headroom for the rule-1 additions
below, which is enough for all of them if they are shaped tightly. This is measured, not assumed.

---

## 1. The context table (rule 1)

Rule 1 demands the full relationship as nCino models it, **including the downstream obligor
group**. This is what each surface actually hands the model.

Legend: **Y** present · **partial** present but incomplete · **N** absent · **N!** absent AND not
named in `notCarried`, so the model cannot even refuse it by name.

| Rule-1 element | Workroom envelope | Cockpit chat | In the bundle? | Evidence |
|---|---|---|---|---|
| Facilities (identity, commitment) | Y | Y | Y | `brainRoute.ts:148`; `deskAsk.ts:68` |
| Facility maturity date | **N!** | Y | Y | `brainLane.ts:39-44` carries `loanId`/`label`/`commitment` only; `deskAsk.ts:40` |
| Facility drawn / available | **N!** | Y (drawn) | Y | `readBlocks.ts:168-179` sums the package only |
| Facility stage / status | **N!** | Y | Y | `deskAsk.ts:41` |
| Facility own coverage ratio | **N!** | **N!** | Y (`coverageRatio` 1.30 on the $15M line) | neither builder reads it |
| Relationship coverage ratio / shortfall | **N!** | **N!** | Y (1.09, `coverageShortfall`) | `exposure.coverageRatio` unread by both |
| Covenants: name, scope, frequency, status | Y | partial | Y | `readBlocks.ts:83-105`; `deskAsk.ts:72-82` |
| **Covenant threshold** | Y (`≥ 1.25×`) | **N!** | Y | `readBlocks.ts:93-96` vs `deskAsk.ts:77` — reads `actualValue`, never `thresholdValue` |
| Covenant cushion / headroom | **N** (model must derive) | **N** | derivable | doctrine `cushion` block gives the formula; no figure travels |
| Collateral, advance rate, lendable, valuation clock | Y | **N!** | Y | `readBlocks.ts:147-166` |
| Parties and roles | Y | **N!** | Y | `readBlocks.ts:119-145` |
| **Owners and their ownership %** | **N!** | **N!** | Y (James 60%, Elena 40%) | `readBlocks.ts:136-139` suppresses `ownershipPercent` when a guaranty type is present |
| **Parent / holding company, as a parent** | **N!** | **N!** | Y (`graph.connections`, role `Parent`, 100%) | `readBlocks.ts:120` reads `graph.legalEntities` and never `graph.connections` |
| **Affiliates / subsidiaries** | **N!** | **N!** | Y (`Hartwell Logistics LLC`, role `Affiliated Company`) | same line; the affiliate reaches the desk only as a `Related Entity` involvement on one loan |
| **Household** | **N!** | **N!** | N | nothing in the artifact models one |
| **A guarantor's own exposure** | **N!** | **N!** | N (guarantors are not in `portfolio.accounts` or `borrowers`) | must be refused by name, or read live |
| **A guarantor's own grade** | **N!** | **N!** | Y (`signals.guarantorSignals[].highestRiskGrade` = "4" on the holdco) | unread by both |
| **nCino obligor exposure** | **N!** | **N!** | Y (`totalObligorExposure` $38.7M vs `totalBorrowerExposure` $54.0M) | `snapshot` unread by both |
| **Cross-collateral / cross-default** | **N!** | **N!** | partial (one asset is pledged to two facilities) | derivable from `collateralId` repeats; nothing derives it |
| **Dependent facilities** | **N!** | **N!** | N | must be refused by name |
| **Package versions in flight** | **N!** | **N!** | **Y, and already computed** | `book/packages.ts:51-68` `inFlightVersion`, `inFlightVersionId`, `hasInFlightModification`; the room is LOCKED by it (`Workroom.tsx:1146,1238,6774`) |
| Package stage / approvals | **N!** | partial (facility stage) | Y | — |
| **Action history** | **N!** | partial (6 activity titles) | **Y, and already handed to the builder** | `ReadSource.history` (`readCard.ts:88-94`) is passed at `WorkroomHost.tsx:151` and `RelationshipRoom.tsx:3137`; `buildReadBlocks` never reads it |
| Open pipeline / opportunities | **N!** | Y (4) | Y (incl. the $12M renewal at Loan Committee) | `deskAsk.ts:94-98` |
| Relationship flags (the worklist's own reason chips) | **N!** | **N!** | **Y, one call away** | `data/worklist.ts:117` `deriveReasonsForBundle(bundle, generatedAt)`; `ReadSource` already carries both arguments |
| Risk grade on file | relationship room only | Y | Y | `relBook.ts:182-189` → `entities`; absent in the facility room |
| The staged plan | Y (title/target/after) | **N** | — | `brainRoute.ts:149` |
| **The plan's pro-forma package total** | **N** | **N** | computed | `workroom/manifest.ts:168` `figuresFor` produces it; the rail prints it; the envelope does not |
| The client's request / mail | Y | **N!** | Y | `brainLane.ts:126-152` |
| The conversation so far | Y (6 turns) | **N** | — | `readBlocks.ts:234`; `deskAsk.ts:118` sends one question, no thread |
| `notCarried` honesty list | Y (3 entries) | **N** | — | `readBlocks.ts:40-44`; the desk truncates silently at 7,000 chars (`deskAsk.ts:101`) |

### What the envelope needs (rule 1), smallest first

Each of these is read-only, derived from data the cockpit already holds, and costed against the
~2.5 KB of headroom measured above. Every one must also be added to `ENVELOPE_BLOCK_DROP_ORDER`
(`brainLane.ts:251`), or it will be the one block the cap can never give up.

| # | Addition | Shape | Source, already in hand | Est. bytes |
|---|---|---|---|---|
| E1 | `reads.group` — the obligor group | `[{name, relation: "parent"\|"affiliate"\|"owner"\|"subsidiary", ownership?, grade?}]` | `bundle.graph.connections` + `signals.guarantorSignals` | ~420 |
| E2 | `reads.obligor` — nCino's own two exposure figures | `{borrowerExposure, obligorExposure, grade, stage, lastReview, nextReview}` | `bundle.snapshot` | ~180 |
| E3 | `facilities[]` gains `maturity`, `drawn`, `available`, `stage`, `coverage` | 5 short strings per member | `bundle.exposure.facilities[]` | ~630 (7 members) |
| E4 | `inFlight` — the version chain | `{version: bool, versionId, hasInFlightModification, reason}` | `book/packages.ts:51-68`, already computed | ~150 |
| E5 | `reads.history` — the last 3 filed actions | `[{what, when, record}]` | `ReadSource.history`, already passed in | ~260 |
| E6 | `plan` — the manifest's own figures | `{committed, committedBefore, membersChanged, newMembers}` | `workroom/manifest.ts:168` `figuresFor` | ~120 |
| E7 | `reads.flags` — the glass's own reason chips | `string[]` of `REASON_META[].label` | `data/worklist.ts:117` + `components/reasons.ts:11` | ~120 |
| E8 | `reads.crossPledged` — assets pledged to more than one facility | `[{asset, facilities: string[]}]` | dedupe `collateralId` across `facilities[].collateral[]` | ~160 |
| E9 | `notCarried` gains the honest refusals | 3 strings: a guarantor's own book, cross-default, dependent facilities | — | ~260 |
| | **total** | | | **~2,300** |

Two tool additions follow from E1/E9, and only these two:

- `brainTools.ts` — a third read door, `counterpartyExposure`, bound to a counterparty id already
  named in `reads.group`, calling `Customer360Snapshot`. This is the only way a guarantor's own
  exposure can ever be answered: it is not in the artifact. Cost is a rung-3 round trip, so it must
  be gated the way the other two are (`heldAlready`), and `READ_DOORS` (`brainTools.ts:37`) must be
  re-argued in the same commit.
- `ladder.ts` — `RUNG3_COVERAGE` (`ladder.ts:71-81`) matches no downstream word at all. Verified:
  `toolsCovering("what is Hartwell Industrial Holdings' own exposure")` returns `[]`, as do the
  affiliate, cross-default and in-flight phrasings. Add one entry matching
  `affiliate|parent|holding|subsidiar|obligor group|cross-?default|counterparty`.

---

## 2. Rule 3, simulated against the Hartwell book

Five explanatory asks, run against the envelope the layer actually builds (dumped and measured,
not imagined). "Could say" means every figure in the answer is in the model's context; "could not"
means the figure is nowhere and the model must refuse, derive, or invent.

**(a) "What is this covenant doing?" (Debt Service Coverage of Borrower)** — the golden rule asks
for four things.

| Part of the answer | Verdict |
|---|---|
| what it measures | **could say** — `doctrine.ts:217` gives the formula, and `covenant-families` fires on the word "covenant" |
| current value vs threshold | **could say** — `1.38×` against `≥ 1.25×`, `frequency: Quarterly`, `nextTest: Sep 30, 2026`, all on the envelope |
| why it matters | **could say** — `doctrine.ts:221` reference bands, `doctrine.ts:232-238` the cushion states |
| what a breach would trigger | **could NOT say for this relationship.** The downgrade triggers are in the `risk-rating` block, which is `rooms: ["relationship"]` (`doctrine.ts:471`) and only fires on a rating word — verified: `composeDoctrine("what happens if this covenant is breached", {room:"relationship"}).included` does **not** contain `risk-rating`. And what a breach triggers *here* — which facilities cross-default, which guaranty is called — is not in the envelope at all. |

**On the cockpit chat this question is unanswerable outright.** `deskContext` emits
`"Debt Service Coverage of Borrower, Pending, last 1.38, next test Sep 30, 2026."` — a figure with
nothing to measure it against. No threshold, no cushion, no frequency, no severity.

There is also a **shape** problem, independent of the data. The three reply shapes
(`brainLane.ts:322-429`) have no room for an explanation. A `read-card` carries `title` (one line,
no question mark) and `rows` of `label`/`value`/`sub`; `ReadCardView.tsx:41-68` renders exactly
those and nothing else. An explanation is prose. Verified: extra prose on a read-card survives the
validator and reaches no renderer.

**(b) "What does this facility do?"** — **partial**. The model could name the product, the rate
(`pricing` block) and what secures it (`collateral` block, scoped by facility name). It could NOT
say the maturity, the drawn balance, the available headroom, the stage or the facility's own
coverage — all five are on `bundle.exposure.facilities[]` and none is on the envelope
(`brainLane.ts:39-44`). On the cockpit chat the reverse holds: maturity, drawn and stage travel;
what secures it does not.

**(c) "Why is this flagged?"** — **could not say reliably.** The envelope carries a covenant
`severity` and a collateral valuation line reading `"overdue since Jul 31, 2026"`. It does not
carry the flag the glass is actually showing: `deriveReasonsForBundle` (`data/worklist.ts:117`)
produces `COVENANT_DUE`, `MATURITY_NEAR`, `GUARANTOR_SIGNAL` and the rest, rendered as chips from
`components/reasons.ts:11`. The chat and the worklist would be answering about different things.

**(d) "What would this change do to exposure?"** — **could not say without deriving.** The
envelope carries the exposure totals and `staged` (title/target/after) and no pro-forma figure.
The room computes one (`manifest.ts:168-208`, `committedLabel` / `committedNote`
`"pro forma · was $46.0MM"`) and prints it on the rail. The model would have to add it up itself —
which the narrate-mode doctrine forbids outright (`doctrine.ts:376`, *"no total you added up
yourself"*) — so the sentence under the card and the rail beside it can legitimately disagree.

**(e) "Who guarantees this and what is their own exposure?"** — **half an answer.** Who: yes —
James Hartwell (unlimited, 6 facilities), Hartwell Industrial Holdings LLC (unlimited, 6), Elena
Hartwell (limited, 2). Their own exposure: **nothing**, and worse, the model cannot refuse it by
name either, because `notCarried` (`readBlocks.ts:40-44`) names only fees, the index name and the
spread. The holdco's own grade ("4") *is* in the bundle and unread. Nor can the model escalate:
the ladder routes this to rung 2 and no tool covers it.

---

## 3. Ranked findings

### Showcase-blocking

**B1 — The renewal room offers a chip that guarantees the plan cannot be filed.**
Rule 2, rule 4, rule 5. `renewEngine.ts:252` puts `"date"` in `SCALAR_TERM_TYPES`, so
`clarifyChips` (`:259-270`) renders **`Keep <maturity>`** under the maturity question.
`toResult`'s hold branch (`:718-726`) accepts it and answers
`"Holding maturity date at Mar 15, 2027. Nothing changes on it."` — `kind: "unparsed"`, **no
options**, and `settle()` (`:745`) then sets `asked = true`, which makes `suggest()` (`:1153`)
return `null`. The chip goes, the suggestion pill goes dark, and nothing says what to do next. The
refusal arrives only at Confirm, from `wirePayload` (`:996-1001`): *"A renewal is maturity-driven:
stage_renewal refuses a plan that carries no new maturity date."*
*Minimal change:* drop `"date"` from `SCALAR_TERM_TYPES` in the **renewal** engine only, and have
the hold branch on `MATURITY_FIELD` answer with the renewal's own options instead of a full stop.

**B2 — The renewal's central ask has three figures and zero options.**
Rule 2. `renewEngine.ts:684-698` `askMaturity` returns `kind: "unparsed"` with no `options` key:
*"…$15,000,000 committed, 6.5%, matures Mar 15, 2027. What maturity does the renewal run to?"* The
current figure is there; the options and the recommendation are not, on the one question the whole
room exists to ask. The room is holding the current maturity and the client's own asked date.
*Minimal change:* three chips — `+12 months (Mar 15, 2028)`, `+24 months`, and the client's asked
date where `mail.asked` carries one — plus a named recommendation.

**B3 — The cockpit chat states a covenant's current value and never its threshold.**
Rule 1, rule 3. `deskAsk.ts:72-82` reads `actualValue` and never `thresholdValue`. This is the
surface a founder demo opens on, and "what is this covenant doing" cannot be answered on it.
*Minimal change:* one line in `facilityLine`'s covenant sibling — emit `thresholdValue` through
`fmtCovThreshold`, exactly as `readBlocks.ts:93-96` does.

**B4 — The obligor group never reaches any model, and is not refusable by name.**
Rule 1, the headline. `readBlocks.ts:120` reads `graph.legalEntities` and never
`graph.connections`, so the parent reads as "Guarantor", the affiliate as a "Related Entity" on one
loan, and the two natural-person owners lose their 60/40 ownership entirely
(`readBlocks.ts:136-139` suppresses `ownershipPercent` when a guaranty type is present). Neither
`notCarried` nor `omitted` names any of it. The design's own rule — *"an absent block must never be
reported as an empty fact"* (`brainLane.ts:56`) — is broken in the one place it matters most.
*Minimal change:* E1, E2 and E9 from the table in §1.

**B5 — The room is locked by an in-flight version the chat knows nothing about.**
Rule 1. `book/packages.ts:51-68` already computes `inFlightVersion`, `inFlightVersionId`,
`hasInFlightModification` and a `reason`, and the room enforces it (`Workroom.tsx:1146`,
`:1238` `sayInFlightRefusal`, `:6774` disables the entry). The envelope carries none of it, so a
banker who asks "why can't I modify this" gets an answer composed with no knowledge of the fact
that stopped them. Rule 1 names in-flight versions explicitly.
*Minimal change:* E4.

**B6 — The relationship room's fallback next step offers the one thing the room refuses.**
Rule 4. `brainRoute.ts:273` defaults a brain read-card's `followUp` to
`"What should change on this package?"`, and `toReadCardModel` is shared by both rooms
(`Workroom.tsx:2652`, `RelationshipRoom.tsx:1362`). In the relationship room that points straight
at `FACILITY_HANDOFF` (`relRoute.ts:382`): *"That is facility work… This room takes the five
reviews."*
*Minimal change:* take the fallback as an argument, and pass the relationship room's own
("Which of the six reviews should we run?").

**B7 — The valuation route asks for a figure cold, one turn after printing it.**
Rule 2. `reviewFlows.ts:702-709` puts the asset's value and its lendable figure on the picker chip;
`reviewFlows.ts:721-728` then asks *"What value are we filing for <asset>?"* with
`kind: "number"`, `options` undefined, `optional` unset, placeholder *"The figure, in dollars."*
No figure, no chip, no escape. The covenant route solved exactly this at `reviewFlows.ts:546-554`
(*"The read carries 1.38× on the Debt Service Coverage. File that figure, or give me the
certificate's own."* with the proposed figure as a chip) — the valuation route did not.
*Minimal change:* copy the covenant route's own pattern onto `recordValues`.

**B8 — "Keep / hold / no change" is not an answer anywhere in the relationship room.**
Rule 5, stated by the founder in those words. The only accepted no-change tokens are the literal
`"Not assessed"` and `"skip"` (`RelationshipRoom.tsx:1090`, `:2571`), and only where
`step.optional === true`. `stepAccepts` reads a number step as
`Number.isFinite(Number(line.replace(/[$,\s]/g, "")))` — so `keep`, `hold`, `no change`,
`leave it as it stands` and `unchanged` all fail, the line falls to the brain lane, and the degrade
path re-asks with `unreadable()` (`RelationshipRoom.tsx:1178-1182`): *"I need a figure for that
one. A number, or skip it."* The banker answered; the room re-asks.
*Minimal change:* one keep-word predicate in `stepAccepts`, mirroring
`components/workroom/rateGate.ts:241-247`, which already does exactly this for the facility room.

### Important

**I1 — The doctrine never asks for a recommendation.** Rule 2. Across the four always-on blocks
there is no instruction to lead with the figure on file or to recommend one option; the one rule
that exists is about the wire (`doctrine.ts:107`). Verified: no always-on line matches
`/lead with the figure/`, `/state the current figure/` or `/recommend one/`. And a clarify with no
options at all passes the validator (`brainLane.ts:569-578`).
*Minimal change:* two lines in the `SHAPES` block — *"Every question you ask leads with the figure
on file. Where the answer set is closed, offer it, and say which one you would take and why, in one
clause."*

**I2 — Rule 3 has no doctrine at all.** There is no block telling the model what an explanation is.
`SHAPES` pushes every answer into rows; `HARD_RULES` says *"One or two sentences, then the card"*
and *"Never a capability lecture"*.
*Minimal change (zero code):* one line in `SHAPES` — *"Asked what something is or does, answer in
this order: what it measures, the figure on file against its threshold, why it matters here, and
what a breach or a miss triggers. Put that in the title and the rows; then the next step."*
*Better change (small code):* a `note` field on `BrainReadCard`, 2-3 sentences, rendered under the
lede in `ReadCardView.tsx`.

**I3 — No engine recommends anything, by design, and the design predates the rule.** Rule 2. Of the
61 asks across the three facility engines, exactly one family carries current figure + options +
a keep chip (`modifyEngine.ts:1349-1358` `withCurrent` + `:312-324` `clarifyChips`), and **none**
recommends. The refusals are explicit and repeated: `parseModify.ts:746` *"I will not pick the kind
for you"*, `:963` *"I will not invent a type"*, `:974` *"there is no default here"*, `:1174` *"I
will not take that default for you"*, `elicit.ts:1823` *"I will not set a threshold myself"*. The
reference standard is `components/workroom/elicit.ts:1852-1853` — *"This relationship carries it at
1.25x today"* with a `Keep it at 1.25x` chip.
This is a **founder decision to take, not a bug to fix**: the golden rule says "recommends one", the
code says a governance record must not be filed under a default nobody chose (`relBook.ts:19-22`).
*Proposed reconciliation:* recommend where the recommendation is a **band from doctrine or a figure
already on file** (`"I would hold 7.60%"`), never where it is a threshold, a grade, a valuation or
a status — those stay refused, and say why in one clause.

**I4 — The relationship room's step counter runs away on the valuation route.** Rule 6.
`plannedStepCount` (`RelationshipRoom.tsx:449-462`) walks the machine on a copy, writing the
`SKIPPED` sentinel — a **string** (`relStep.ts:56`) — into each step it passes. `recordValues` gates
on `typeof values[id] === "number"` (`reviewFlows.ts:718`). Verified by running the walk: all 64
probe steps are the same question, so `planned` inflates by 64 and the kicker
(`RelationshipRoom.tsx:920`) reads something like **"Step 1 of 66"** on a seven-step review, for the
rest of the flow. Every sibling predicate uses `answered`/string checks and is safe.
*Minimal change:* `if (answered-or-number)` on `reviewFlows.ts:718`, matching its siblings.

**I5 — Three bundled asks.** Rule 6.
- `modifyEngine.ts:1591` — *"What should change on it? Commitment, rate, maturity, term, covenants,
  entities, fees, collateral and policy exceptions all file on the clone; pricing I stage and hand
  off with the reason."* Nine answer domains in one prose sentence, no chips.
- `intakeFlows.ts:814-816` — *"What does the <test> test have to hold? On the bank's own families
  that runs as a '<op>' test, so I will file <op> unless you say otherwise."* Asks the threshold
  **and** the direction; the chips answer only the direction. (Its fallback branch says so out
  loud: *"…have to hold, **and** which way does it run?"*.) This is also the **only** ask in the
  whole layer that names a default — worth keeping as the pattern for I1/I3.
- `createEngine.ts:598` — *"Tell me the product and the amount."* Two required values in one
  sentence, in the room's opening line, in a file that asserts "One question per value (law 4)" at
  `:645`.

**I6 — Four blank numeric asks in a row on the rating route.** Rule 2, rule 6. Verified by walking
the machine: `cashFlowCoverage`, `revenueGrowth`, `managementExperience`, `creditScore`
(`reviewFlows.ts:800-803`), each `kind: "number"`, each with no options and no figure in the ask,
while `SCORED_VS_STORED` (`:976`) says only one of them is weighed at all.
*Minimal change:* ask the one that is weighed, state what the others are used for, and offer
"record none of these" as a single answer.

**I7 — The create room's amount ask cannot be escaped.** Rule 4, rule 5. `parseCreate.ts:312-320`
returns the same clarify with `awaiting: field` for anything without a money token, and
`parseCreate.ts` carries no keep/hold/skip/cancel token at all (`KEEP_CURRENT`,
`parseModify.ts:1441`, is modify/renew only). "never mind" loops forever. And the amount ask
(`createEngine.ts:441`) does not carry the client's own asked figure even though the room is
holding it and pins it one function away (`createEngine.ts:469`).

**I8 — The cockpit chat is stateless and has no hygiene.** Rules 5 and 6. `askDesk`
(`deskAsk.ts:110-120`) takes one question and no thread; `ChatPanel.send` passes none. Every
follow-up is answered as if it were the first. `mergeMessages` (`ChatPanel.tsx:88-97`) dedupes on
id only, so a local echo and a server-written copy of the same exchange both render; "Ask again"
(`:379`) re-posts the question as a second user bubble. None of the workroom's guarantees — one
bubble, the figure guard, the claim guard, the word budget, markdown stripping — exist here:
`Narration` is imported only by `Workroom.tsx` and `RelationshipRoom.tsx`, and `ChatPanel.tsx:349`
renders the model's text raw.

**I9 — Refusals with no route out.** Rule 4.
- `NOT_CONNECTED_CLARIFY` (`brainLane.ts:473-477`) — *"…I can still change this package once a
  connector is added."* No next step. Its two siblings (`timeoutClarify`, `UNREADABLE_CLARIFY`)
  both end with *"ask again, or say the change you want and I will put it up"*.
- `NO_COMPLIANCE_ROW` (`relBook.ts:205`) — offers *"I can read them out"* with nothing to click,
  and names none of the five reviews that could run instead. Pushed with no options
  (`RelationshipRoom.tsx:893-895`).
- `NO_PACKAGE_ANCHOR` (`reviewFlows.ts:1285`) — names no alternative at all.
- `CREATE_GAPS` (`reviewFlows.ts:1551-1564`) — refuses *"a standalone covenant on the Account"* and
  *"an owned but unpledged collateral record"*, which is **stale**: the `intake` route now files
  exactly those two, and its chip ("Add a covenant or an asset") sits on the router one screen back.
- `modifyEngine.ts:1395` / `explain.ts:199-206` — the route out ("Open the covenant review on this
  package") is real and is prose only; `IntentResult` `kind: "refusal"` has no `options` field.
- `modifyEngine.ts:1671` / `renewEngine.ts:943` — *"Anything else on this facility, or shall I
  stage it?"* is a binary question with no chips, and neither "yes" nor "stage it" is a line either
  parser reads. `WorkroomAcknowledgement.options` exists (`types.ts:271`) and is used by
  `createEngine.ts:821`; modify and renew never populate it.

### Polish

**P1 — The room breaks the voice rule it imposes on the model.** Rule 7. `HARD_RULES`
(`doctrine.ts:139`) says *"No em dashes"*, and `narrate.ts:451` strips them from model output. The
deterministic sentences use them freely: `explain.ts:105-108` (`whyChecked`), `:130`, `:132`,
`:134`, `:136`, `:140`, `:142`, `:144`; `advisory.ts:159`, `:206`, `:340`, `:390`;
`parseCreate.ts:316`; `ChatPanel.tsx:404` and `:408` (`"Cockpit chat — <name>"`, which reaches the
glass via `BugReportSheet.tsx:112`); `RelationshipRoom.tsx:2190`, `:2194`.

**P2 — The doctrine does not carry the golden rule's voice line in full.** Rule 7. It bans em
dashes and marketing ("Never a capability lecture") and names neither exclamation points nor emoji.
Otherwise the voice is clean: a full scan of user-facing strings across the conversational modules
found **no** exclamation points, **no** emoji and **no** marketing vocabulary. The only non-ASCII
glyphs are UI chrome (`✓`, `→`, `↑`, `·`).

**P3 — `FACILITY_HANDOFF` says five reviews and the room takes six.** `relRoute.ts:383` vs
`relRoute.ts:33` and `RelationshipRoom.tsx:1463` (*"name which of the six this is"*). It is the most
frequently fired handoff string in the room (three push sites).

**P4 — The composer catalog offers no way to ask anything.** Rule 3. All ~23 leaves of
`components/composer/catalog.ts` are mutations ("increase the…", "pledge…", "log a policy
exception…"); the file explicitly bans reading words from templates (`:36-38`). The cockpit chat's
own chips (`actions/suggest.ts`, `actions/registry.ts`) are imperatives too. There is nowhere in
the product that offers "what is this covenant doing" — the exact ask the golden rule names first.

**P5 — The refusal is checked after the questions in the modify room.** Rule 6.
`modifyEngine.ts:1390` runs `refusalFor` on `outcome.amendments`, which only exist once
`readValue` has succeeded — so for a refused field the room asks *"Which member should this land
on?"*, takes the answer, and only then says *"That one is not mine to file."* `elicit.ts:1703-1707`
gets this right for the catalog gap and says why in its own comment.

**P6 — `colExistingHandoff` re-fires and its only chip is nonsense.** `intakeFlows.ts:1036-1044`:
the guard checks `existingPick && existingPick !== "new"`, which never stops being true, and because
the step is `optional` the room appends the one chip `"Not assessed"` to a handoff. Its real next
step is in the placeholder, which is only visible in the composer.

---

## 4. Proposed question order per flow (rule 6)

Only the flows where the current order bundles or misorders. Everything not listed stands.

**Modification.** Today: member → value → *then* refusal check → *then* duplicate check. Proposed:
1. Is this field fileable at all? (`refusalFor` on the FIELD, before any member question)
2. Is it already on the deal? (`duplicateQuestion`, same beat)
3. Which member — with a chip per booked member, not a prose list (`parseModify.ts:584`)
4. What should it become — current figure, `Keep <current>`, org values, and a recommendation
5. The pricing gate (unchanged; `pricingGate.ts:177-204` is already right)
6. "Anything else, or shall I stage it?" — with two chips

**Renewal.** Today: `parseAnswer` before the renew verb, so a clear renewal instruction typed at an
open maturity question is answered as a date. Proposed:
1. Test `RENEW_VERB` **before** `parseAnswer` (`renewEngine.ts:780` above `:765`)
2. Which facility — chips carrying each maturity date, not the prose list at `:785`
3. Maturity — current maturity, `+12 months`, `+24 months`, the client's asked date where one
   exists, and a recommendation. **No `Keep` chip** (B1)
4. Anything else — with chips

**New facility.** Today: "Tell me the product and the amount", then product → amount → purpose.
Proposed: one question per turn, and purpose before amount, because purpose is what the banker
settles first and it is what gates the Proposal hop (`createEngine.ts:444`):
1. Product (chips already exist)
2. Purpose
3. Amount — carrying the client's own asked figure where `request.ask.to` holds one, as a chip
4. A hold/cancel token on every one of them (I7)

**Covenant review.** Today: pick covenants (multi, 6 options) → status → figure → reason → opt-in →
narrative. The picker silently commits the banker to up to three further turns per covenant picked.
Proposed: keep the order, and say the cost on the picker ("Each one takes a verdict and a figure"),
and offer the covenants the room would assess as a named default set (the ones with an open test
period).

**Collateral valuation.** Today: pick assets → figure (blank) → date (blank) → basis → source →
primary → description. Proposed: 1. pick assets; 2. figure, **led by the value on file with it as a
chip** (B7); 3. date, with the `dateChips` the intake route already has
(`intakeFlows.ts:921-930`); 4-7 unchanged.

**Risk-rating review.** Today: four blank numbers → computed grade → override → comment. Proposed:
1. the one weighed figure, with what is on file beside it; 2. "record the other three?" as one
optional ask; 3. grade, unchanged (this ask is already good — `reviewFlows.ts:835-837` leads with
the grade on file and chips the computed one); 4-5 unchanged.

**Relationship intake, covenant lane.** Split `covTerms` (`intakeFlows.ts:814-816`) into two turns:
direction (chips, with the family default named, as it already does) then threshold. One ask, one
answer.

---

## 5. Repro tests

Added: **`app/src/chatGolden.repro.test.ts`** — 33 passing, 23 `it.todo`. No other file under
`app/src` was touched.

The passing tests are the gaps, demonstrated: they assert that today's tree drops a fact the
bundle holds and does not name it in `notCarried` either. They go **red** when a gap is closed,
which is the signal wanted. The `it.todo`s name the behaviour the golden rule asks for.

**`npx vitest run` totals.**

| Run | Files | Tests |
|---|---|---|
| Baseline, this file removed | 169 passed | **4177 passed**, 0 failed |
| With this file | 171 passed | **4223 passed**, 0 failed, 23 todo |

The suite is green. The delta is +2 files / +46 tests rather than +1 / +33 because a second
session added `app/src/book/packages.test.ts` (13 tests) to this worktree while the run was in
flight; it is not part of this work. This audit's own contribution is exactly
`app/src/chatGolden.repro.test.ts`: **+33 passing, +23 todo**.

## What was checked and found sound

Worth stating, so the fixes do not undo them:

- The rate gate (`components/workroom/rateGate.ts:163-183`) is the reference implementation of
  rule 2's first two thirds: current figure on the question, `Hold 7.60%` as the first chip, an
  example of the answer wanted, and the "no index name" aside said once per facility. Its suite is
  in `threadHygiene.render.test.tsx:798-899`.
- The pricing gate (`components/workroom/pricingGate.ts:177-311`) asks one thing at a time, in the
  order a banker settles them, and every ask can be left.
- `elicit.ts:1852-1853` is the single ask in the codebase that leads with the figure on file, offers
  the org's own values and ships a `Keep it at 1.25x` chip.
- `threadHygiene.render.test.tsx` already pins one bubble per focus click, the settle choreography,
  "say it once" for the version paragraph, the per-act word budget, guard-before-reveal, and the
  runtime-failure hush. The version paragraph **is** guarded once per plan, at the room layer
  (`Workroom.tsx:1434`, `:2360`), not in the engine.
- The doctrine's block selection, budget and drop order are sound, and the facility/relationship
  room gate on the slices is real and tested (`doctrine.test.ts`).
