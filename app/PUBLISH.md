# Publishing the cockpit as a capability-declared Live Artifact

The bundle at `app/dist/cockpit.html` (promoted to `artifact/customer-360-template.html`, data injected
by `render/assemble-cockpit.mjs`) calls the viewer's claude.ai connectors through `window.claude.mcp`.
That only works if the artifact is published **with an `mcp` capability manifest**. This file is the
exact manifest to pass and the envelope notes behind it.

Written against runtime contract **0.1.15** (`window.claude.mcp` type definitions).

---

## 1. The capabilities manifest

Pass this as the `capabilities` input to the Artifact tool, on **every** publish and every replace.
It is GENERATED, never hand-typed:

**`client-360/assets/capabilities.json`**, written by `node client-360/render/capabilities.mjs` from
the org's own `Customer360.mcpServerDefinition` (the Customer 360 names, in the org's own order) plus
`app/src/channel/mcp.ts` (the gateway and mail names). `node client-360/render/capabilities.mjs
--check` fails the release when the committed file drifts from either source, and
`client-360/render/capabilities.test.mjs` runs the same comparison as a test.

Read that file and pass its contents verbatim. Do not retype it here, do not trim it, do not reorder
it. Counts today: **Customer 360 28 tools, IDB Gateway 3, Microsoft 365 1**, plus `sample` and `db`.

The Customer 360 grant is the org manifest ENTIRE. An earlier revision of this file trimmed it to the
call paths the bundle itself reaches and left `Customer360SearchAccounts` out; the guided skills route
writes the cockpit never calls, and a tool outside the published manifest is refused
`not_in_manifest` at the moment a banker confirms a plan. Minimality at that boundary buys nothing
and costs a filed record.

Omit the manifest and the page opens offline: `claude.use("mcp")` resolves null, the sync chip reads
`offline · R1 no grant`, and no connector call in the page can run.

### Manifest rules that bite

- `server` is the connector **display name**, never an id. Ids are per-viewer-account facts; a
  published page runs for many viewers.
- `tools` are the **upstream** tool names as `listTools()` returns them — not the normalized
  `mcp__…__<tool>` segment.
- **Colons are invalid in tool names** — a manifest containing one is rejected **422 at publish**.
  None of the names above contain a colon; keep it that way.
- The manifest is a **viewer-consented grant**. It stays scoped to the three connectors this product
  uses, and within Customer 360 it is the org's own manifest whole: the guided skills call tools the
  bundle does not, so "declare only what the bundle calls" was the wrong minimality and produced a
  grant that failed at confirm time. A page declaring capabilities **cannot be shared publicly**, so
  this artifact is private-link only by construction.
- Omitting `capabilities` on a redeploy **carries the stored declaration forward** (and keeps the
  contract pin). Passing a non-empty object is a **full-set declaration**: anything stored but not
  restated is revoked. `{}` clears everything.
- Moving the runtime version is deliberate: pass `contract: "latest"` to upgrade or a specific
  version to pin/roll back. Never change it as a side effect of editing.

---

## 2. Observed vs inferred — read before publishing

The capability contract is explicit: never publish a page that calls a connector tool without having
observed one real request/response pair for it. Status of each tool in this manifest:

| Tool | Names confirmed via `listTools()` | Request/response envelope **observed live** |
|---|---|---|
| `Customer360Snapshot` | yes | **yes** (founder session 2026-07-25) |
| `Customer360Portfolio` | yes | **yes** |
| `boom-mcp-js___boom_get_ratios` | yes | **yes** |
| `…get_llm_response` | yes | **yes** |
| `outlook_email_search` | yes | **yes** |
| `Customer360RelationshipGraph` | yes | **no — pattern-inferred** |
| `Customer360Exposure` | yes | **no — pattern-inferred** |
| `Customer360Covenants` | yes | **no — pattern-inferred** |
| `Customer360Opportunities` | yes | **no — pattern-inferred** |
| `Customer360StructuralSignals` | yes | **no — pattern-inferred** |
| `boom-mcp-js___boom_get_spread` | yes | **no — pattern-inferred** |
| `stage_collateral_valuation` | yes | **yes** (WP2 live 2026-07-26, incl. a VALIDATION_FAILED domain failure) |
| `execute_collateral_valuation` | yes | **no — same envelope family, not yet exercised end to end** |
| `stage_service_request` | yes | **no — same envelope family** |
| `execute_service_request` | yes | **no — same envelope family** |
| `stage_annual_review` | yes | **no — same envelope family** |
| `execute_annual_review` | yes | **no — same envelope family** |

The remaining inferred tools are assumed to share the envelope of their observed siblings (the Salesforce
invocable envelope for the `Customer360*` family, the clean-JSON gateway payload for `boom_get_spread`).
That assumption is **reasonable but unverified**.

**State this at publish time, in the reply to the founder — not as a note inside the page.** The
unwrappers fail closed (a mismatched envelope reports a per-section failure rather than yielding
undefined figures), so a wrong guess degrades honestly instead of printing a wrong number. The first
live run should exercise a detail refresh and a spread refresh to convert these to observed.

Do not embed any observed response values in the published page as sample data — they are the
viewer's real data.

---

## 3. Observed envelopes

### 3.1 `Customer 360` family — Salesforce invocable envelope

`result.payload` is:

```jsonc
{ "content": [
  { "actionName": "…", "isSuccess": true, "errors": null,
    "outputValues": { /* the actual data */ }, "sortOrder": 0, "version": 1 }
] }
```

- **One element per request in the `inputs` array, POSITIONAL** — element *i* belongs to input *i*.
- Read `content[i].outputValues`.
- `isSuccess: false` or a non-null `errors` is a **per-element** failure and must not contaminate its
  siblings.
- Input shape: `{ inputs: [{ accountId }, …] }`.

Implemented in `src/channel/mcp.ts` → `unwrapInvocable(payload, expectedCount)`, which also detects
short envelopes so a truncated response can never silently misalign accounts.

### 3.2 `IDB Gateway` boom tools — clean JSON

`result.payload` carries `_source` / `_provenance`, `company`, `raw{…}`, `ratios[…]` — already the
shape the cockpit's `boom` field expects. No unwrapping beyond reading `payload`.

### 3.3 `…get_llm_response` — body is a JSON **string**

`result.payload` is `{ statusCode, headers, body: "<JSON STRING>" }`. `JSON.parse(body)`, then read:

- `.response` — markdown **text**, rendered as **plain text** (A13: never HTML/Markdown),
- `.model`, `.cost_usd` — surfaced as a subtle footer under the answer.

Input: `{ prompt: string }`. The cockpit **grounds** every prompt (`src/data/grounding.ts`): a context
block of the staged figures for the account/tab in view (capped at 2,000 chars), the question, and an
instruction to cite only those figures and to say so plainly when unsupported. The tool has no access
to cockpit data, so an ungrounded prompt would be answered from general knowledge — unacceptable for a
credit figure.

### 3.4 `outlook_email_search`

Input `{ query: string }`. Returns a list; `[]` is an honest "no matches" and renders as
"No client requests found in your mailbox for this relationship." Entity resolution is conservative —
a message attaches to an account only when the account name clearly appears.

---

## 4. What the page does with the capability

| Surface | Call | Mode |
|---|---|---|
| Home KPI band | `Customer360Portfolio` | **`watchTool`**, `staleTime: 30s`, `refetchInterval: 60s` |
| Chat | `get_llm_response` with a grounded prompt | `callTool`, read |
| "Sync" (account header) | `Customer360Portfolio` + the six `Customer360*` detail tools + `outlook_email_search` | `callTool`, read, `staleTime: 15s` (mail 60s), one user gesture |
| Generate Spreading action | `boom_get_ratios` + `boom_get_spread` | `callTool`, read, `staleTime: 30s` |
| Other registry actions | `get_llm_response`, framed as **preparation** | `callTool`, read |
| Action Panel "Review the plan" | `stage_<action>` | `callTool`, **uncached, no retry**, user gesture |
| Confirm gate "Confirm and file" | `execute_<action>` | `callTool`, **uncached, never auto-retried** |

### The durable action trail

`Customer360ActionHistory` (input `accountId` + `limit`; entries newest first, org default cap 50) is
fetched as one more line in the sync sweep and merged into the Activity tab.

**Observed envelope, 2026-07-26.** It is a READ tool, so `outputValues` carries `accountId` / `count`
/ `entries` DIRECTLY — no `ok`/`result` wrapper, which belongs to the write tools whose outcome is a
thing that either happened or did not. Datetimes come back space-separated (`2026-07-25 20:18:36`) and
are normalised to ISO instants at the seam, stamped Z; anything unparseable drops the row rather than
placing a real event at a wrong point in the trail.

**Status vocabulary: `Staged` and `Completed`.** A Staged row is real history — a plan built and
confirmed by nobody — and renders as `ACTION_STAGED` ("staged, never filed"), which claims neither a
write nor a failure. Any status the cockpit does not recognise is carried verbatim ("recorded as
Superseded") rather than mapped onto a claim it cannot support.

**A null `resultRecordName` means two different things, told apart by status.** On a `Completed` row
it is the read-back failure the null-means-unverified doctrine covers, and the entry says "filed, name
not confirmed". On a `Staged` row nothing was created, so no name is expected and none is claimed. Session echo and org row are keyed
IDENTICALLY (`exec-<stagingId>`), so they dedupe with no second matching rule and the org row wins:
same event, stronger evidence. The echo still renders instantly at execute time, which is what keeps
the tab feeling live, and the durable rows render for a fresh session with no echoes at all.

The two are visually distinct, because they are different claims: "This session" versus "On record in
nCino".

**Seamed like WP5.** Built against the declared shape while the Apex lane deploys. Until the tool
exists the call fails with a not-in-manifest code, the sweep treats it as not part of this view, and
the line removes itself silently — the cockpit shows the session echo alone, exactly as before. The
sweep is now up to 9 read calls on one gesture.

### The sync sweep (WP7)

One button in the account header replaced the separate "Refresh from org" and "Check my inbox"
controls. It is a single user gesture firing **up to 8 read calls**: the portfolio read, the six
detail tools, and one mailbox search. The button is disabled for the duration, so a sweep cannot
overlap itself. There is **no auto-sync and no polling** on this surface.

Each console line is bound to its own call and cannot tick before that call has returned; the
display pacing is a floor, never a substitute for the work. A failed read leaves its section on the
previous value and says so on its line, and the workspace is never blanked. When Microsoft 365 is
not part of the view the mailbox line is removed silently, per the A29 opportunistic-skip rule.

### The deal ticket (WP8)

The action panel opens on a ticket, not a form and not a paragraph: subject card (what this is and
what it acts on) → hero input (the one value carrying the decision) → live delta readout → property
pills, each opening a slide-up sheet of option cards → drafted narratives as collapsed cards → the
unchanged footer.

It is a PRESENTATION over the same `PanelSchema` and the same briefing declaration every earlier
surface read: which fields the banker owns, in what order, is declared once. A pill writes the
identical `values` entry the classic "All fields" row writes, and a test pins that.

The delta readout runs the Exposure tab's own coverage math (lendable over drawn) on the hero value
and renders NOTHING when any input is missing — a missing lendable value is not a zero, and a ratio
computed from a guess is worse than silence. Only collateral valuation has one, because it is the only
action whose input moves a figure the cockpit renders elsewhere.

Option sheets offer the org's value set and nothing else; absent, the sheet says where the values come
from rather than inventing any.

**Modal stacking fix.** Every layer listens for Escape on `window` in the capture phase, and capture
listeners on one target fire in REGISTRATION order — so the outermost panel heard Escape first and one
press collapsed two layers at once. `stopPropagation` cannot fix this (it stops other targets, not
other listeners on the same target). Layers now register in a modal stack and act only when topmost:
Escape closes the option sheet, then the action panel, then the Client Actions sheet, one press each.

### Picklists read from the org

`LLC_BI__Review__c.LLC_BI__Review_Type__c` (Annual, AdHoc, Problem Loan) and
`LLC_BI__Loan__c.LLC_BI__Product__c` (Construction, Equipment, Line of Credit, HELOC, Purchase,
Deposit, Term) come from a live describe on bankinggpt (2026-07-26, active values). Collateral valuation `Type` (16) and `Source` (14) come from the tools' own
`VALIDATION_FAILED` replies. All are `complete: true` and cited. The cache is MINIMAL and a test enforces it: an entry no schema
field asks for is dead weight that outlives the reason it was added, so it is removed rather than kept
"just in case". Everything else still renders
honestly disabled: the panel never invents a value set, and never blocks on one the org has answered.

### The compile sequence (WP7)

"Review the plan" runs a four-line build sequence, and each line wraps a real operation: gathering the
prefills, recomputing the suggestions and checking for drift, the `stage_*` call in flight, and
validating the plan that came back against the transition allowlist. A line cannot tick before its own
operation has returned; the ~450ms pacing floor can delay a fast line and can never advance a slow one.

A failure **stops the sequence on its own line** and renders the typed error (plus the org error string)
there — the sequence is the error surface. A domain refusal (`VALIDATION_FAILED`, `PRECONDITION`,
`NOT_STAGEABLE`, `blocked_by_policy`, `bad_request`) offers no retry, because re-sending the identical
request would be refused identically. A transport or transient failure offers one user-gesture retry.
Lines below the failure stay dim: they never ran.

The execution reveal on the tracker is **presentation only**. The executor has already returned every
step's final state and the eight-state machine still owns every transition; the reveal only paces how
those settled states are shown. No row ever displays a state the executor did not return, and the
"Filed" stamp appears only on a `success` terminal state.

`prefers-reduced-motion` collapses the pacing floor to zero and disables every sweep, slide, reveal and
pulse animation outright, rather than running them at 0.001s.

### `meta.userId` is REQUIRED to file anything (live defect, 2026-07-26)

`execute_*` checks four preconditions in order: staging row by `stagingId` → `planHash` equality →
**`approverUserId` equals the running identity** → decision-token hash, single use. The panel was
sending `meta.user`, which is the DISPLAY NAME. Every confirm therefore failed the third check before
the token was ever redeemed: org forensics showed all staging rows at `Status=Staged` with
`cm_Token_Consumed_At__c` NULL, and the banker saw only the platform's generic "ran the tool but
reported a failure".

The assembler MUST stage `meta.userId` as the Salesforce user id (`005…`) of the connector identity.
The panel now refuses anything that is not shaped like a user id and **fails closed with a named
reason** rather than sending a value the org will reject. `meta.user` is still accepted if the
assembler happens to stage the id there; a name in either field is refused.

The execute payload is pinned by test to exactly five fields, taken from the stage result verbatim:
`idempotencyKey` (the STAGE key, reused), `stagingId`, `planHash`, `decisionToken` (the SERVER token —
the client-minted record is bookkeeping and never reaches the wire), `approverUserId`. Nothing about a
staged plan is persisted, so no republish can resurrect a stale `stagingId` against a newer `planHash`.

### After a successful write (2026-07-26)

The terminal state's HERO link opens the record that was just filed
(`/lightning/r/<object>/<id>/view`, mapped per action: `LLC_BI__Collateral_Valuation__c` / `Case` /
`LLC_BI__Review__c`). The Product Package link stays as a secondary "View deal in nCino". Absent
`meta.instanceUrl`, both fall back to the disabled chip with the id as selectable text — no host is
ever guessed.

Every execution also lands in the Activity tab as a session-local, user-originated entry
(`ACTION_EXECUTED` / `ACTION_EXECUTION_FAILED`), attributed to the acting user, carrying the record
deep link and retaining the `stagingId` in the detail for audit. It renders immediately; no Sync is
needed, because the event happened in this session rather than being read from the org.

**`recordName` / `anchorName`, and what a null means.** The execute tools return the created record's
name and the name of what it was filed against, and both the Filed stamp and the trail entry use them:
"Filed CV-0000000002 against COL-000758". `recordName` is canonical; the per-action aliases
(`caseNumber`, `reviewName`) carry the same fact on tools that predate it.

A **null `recordName` is not a missing nicety — it means the verification read-back FAILED**, the
`filed_unverified` case. The UI therefore renders "Filed, name not confirmed" with the real record id
and a line telling the banker to verify it in nCino, and the trail entry says the same. It NEVER falls
back to a generic label: that would hide a real verification failure behind copy that reads like
success. The deep link is still offered in that state, because the record does exist.

### Corrections from PROBE-LEDGER wave 3

Read after the wave-2 build; each of these overturned something the panel had assumed.

- **A filed valuation does NOT move the collateral value.** Probe 6 settled it negative in both arms:
  the rollup is bound to nCino's Add Valuation button, and `Auto_Update_Collateral_Value` does not
  substitute. The valuation readout is therefore headed "What this valuation implies", not "What this
  changes", and carries the org's actual behaviour as a caveat. The ledger's rule — "any future claim
  of coverage improvement from a filed valuation is false" — is pinned by test.
- **Risk Rating Review writes to `LLC_BI__Annual_Review__c`.** There is no `LLC_BI__Risk_Rating_Review__c`
  in this org; the label/API mismatch is A33.4.7. The object has no `RecordTypeId` and no `OwnerId`, and
  `LLC_BI__Status__c` defaults to `Not Approved` — an omitted status reads as a DECISION, so the ticket
  sets `In Review` explicitly and says why in the field help.
- **The covenant compliance object is `LLC_BI__Covenant_Compliance2__c`.**
- **The org rewrites the Loan `Name` and self-populates `LLC_BI__Product__c` to `Construction`.** The
  ticket proposes no name, says so, and makes Product required (7 values incl. Deposit).
- **`LLC_BI__Application_Method__c` is org-defaulted (`Online`); `LLC_BI__Primary_Loan_Purpose__c` is
  not.** Of the two fields LV12/LV13 gate, only the purpose is collected — and it lives on the Loan
  Detail, which the org creates asynchronously about four seconds later via a FLOW, with no
  `AsyncApexJob` row to poll.
- **`LLC_BI__RootLoanId__c` does not exist here**; no chain-walking references any.

### Cross-vendor review fixes (Codex, 2026-07-26)

Twelve findings, all accepted. The ones that change what the cockpit will and will not do:

- **A rating override cannot be filed yet, and the ticket says so.** The staged plan writes
  `LLC_BI__Overridden_Risk_Grade_Value__c`, but no observed request has ever carried an override and
  its wire name would be a guess. The input stays, staging is BLOCKED with a named reason, and nothing
  invented goes on the wire. Silently dropping a number the banker typed was the one option not
  available.
- **`execute_covenant_review` was founder-gated in the client, and no longer is (WS0.5).** The gate
  stood on one fact — the tool had never been run live. It has now, on both arms, on throwaway data,
  and both envelopes are archived. The ORG is still the authority on holding: a staged plan carrying
  `executionHeld: true` blocks the gesture whatever the client map says, and the plan refuses a
  non-Pending compliance row per covenant unless the banker opts in.
- **Every stage payload carries a non-blank `rationale`.** The Apex Request declares it required and
  JSON drops an undefined key; `stageRationale()` uses the accepted findings, else the banker's own
  words, else a deterministic sentence naming the action and the anchor.
- **A resume runs as the identity that CONFIRMED the plan**, captured at confirm and refused on
  mismatch. The Apex resume branch dispatches on staging status without re-checking the token, so
  without this a different signed-in user could finish someone else's write.
- **A rebuild mints a new idempotency key.** Editing and rebuilding is a new intent with a new hash;
  reusing the key invites the org to replay the staging row the banker just edited away from. Stepping
  back and forward without editing keeps the key, because that is one intent looked at twice.
- **Every control maps one-for-one to an observed wire field.** Modification and renewal lost the
  controls the wire cannot carry (`effectiveDate`, renewal `newCommitment`) and gained the ones it
  does (`requestedTermMonths`, `requestedRate`). The reason field targets staging rather than claiming
  an org field, and folds into `rationale`.
- **The covenant observed value is per COVENANT, not per ticket** (WS0.5): the review is a batch, and one figure shared across N covenants would record a number against covenants it was never measured on.
- Service request `origin` is sent; execute `status` and plan `waitBudgetMs` are parsed; a failed
  resume renders through the full error doctrine, on the screen the banker is actually looking at.

### Wave 2.1 — modification and renewal require a BOOKED facility

nCino accepts a credit action only against a facility at stage `Booked` (Probe 9: every real renewal
chain in the org has that shape; anything else is refused with "The request contains invalid
facilities"). Both actions are now gated on it and render per A27.3 — visible, unavailable, with the
real reason — and no ticket opens. Inside the ticket the facility selector offers only booked
facilities; the others are LISTED with their stage rather than hidden, so a banker hunting for a
facility learns why it is not on offer.

**The stage field now flows** on the live read, alongside the facility's own package id.
`Facility.stage` (`LLC_BI__Stage__c`) is new on the contract and additive on the `Customer360Exposure`
read; until the Apex lane emits it, the predicate FAILS CLOSED with "Facility stages are not staged in
this view, so a booked facility cannot be confirmed". That is deliberate: absent is not the same as
not-booked, and neither may be read as permission. Three outcomes stay three distinct messages —
cannot tell, can tell and the answer is no, and yes.

The facility selector is a RECORD chooser, not an org picklist: it declares `optionsAreRecords` and is
excluded from the A33.1.6 value-set rule, which stays strict for everything that is a picklist.

### Live vocabulary: a real facility's status is `Open`

`isActiveFacility` accepted only `""` and `active` — the sample-era words. Every real facility in the
org carries **`Open`**, so every one of them read as inactive: modification and renewal greyed out on a
relationship with six booked loans, coverage math dropped them, maturity alerts went silent and the
exposure tab rendered them as closed. One word, and the whole live surface behaved as if the
relationship had no facilities.

The check now accepts `""` (absent, per F6), `active` (sample-era bundles) and **`open`** (the org).
Everything else stays inactive on purpose: `Paid Off`, `Closed`, `Withdrawn` and `Hold` are all real
states and none is a facility you can act on. One function serves every consumer — availability, the
facility selector, coverage math, maturity derivation, the drafts and the grounding prompt.

**The regression that bit had no test looking at it**, because every fixture in the suite used the
sample vocabulary. The suite now asserts against the REAL bundles: Hartwell's six Booked + Open
facilities make modification and renewal AVAILABLE, and Piedmont's Open-but-Final-Review facilities
still withhold them with the right reason. `Booked + Open` is the credit-action-valid combination, and
the status was never the thing standing in Piedmont's way.

### STANDING RULE — aggregate by identity, never render row multiplicity

**A real org read WILL carry bidirectional and per-child duplication.** Two shapes of it, both observed
on live Hartwell data:

- **Connections are MIRRORED.** The org stores each relationship from both sides and the read returns
  both: 8 rows for 4 relationships. The pair is one fact written twice, and the halves are NOT equally
  informative — "Parent, 100 percent" and "Child, null" are the same holding-company edge seen from
  opposite ends.
- **Involvements repeat PER FACILITY.** One Borrower row per loan: 6 identical rows at 100 percent for
  a borrower with six facilities.

Every list surface therefore aggregates by IDENTITY before rendering. Connections collapse by
counterparty, keeping the NAMED role over the mirror's generic one (`Child`, `Company`) and taking the
ownership percent from whichever side recorded it; ties break on original order, so the same payload
always renders the same way. Involvements aggregate by (entity, role) with a facility count —
"Borrower, 100 percent, 6 facilities" instead of six identical lines.

This is a PRESENTATION decision, not a data correction: the tool returns true org rows, and the tab is
what owes the banker one line per real thing. Fixtures for these tests are the real payloads, and
Piedmont's unduplicated graph is pinned alongside to prove aggregation does not distort data that was
never duplicated.

### Live crash: a real bundle in a shape no sample used (2026-07-26)

A relationship merged from real Customer360 responses rendered a BLANK profile. Root cause:
`anchors` arrived as an OBJECT (`{accountId, productPackageId}`) where every staged bundle had carried
an ARRAY of chips, so `(bundle.anchors ?? []).map(...)` threw and React unmounted the whole workspace.

The producer has since corrected that bundle's shape, which is exactly why the guard stays: the
cockpit cannot depend on a producer never regressing. `readAnchors()` filters to well-formed chips and
returns `[]` for anything else: the producer's
shape is not the cockpit's to police, but rendering what it can and showing an honest gap for the rest
is. Malformed entries are dropped individually; the strip renders the chips that are real.

**The permanent guard is `liveData.smoke.test.tsx`:** it mounts EVERY account in EVERY staged data file
and walks EVERY tab, asserting the workspace still names the relationship. A gap state passes; a blank
screen does not. Unit tests over helpers could not have caught this — only mounting the real data did.

The other four suspects on the same bundle were checked and are each already handled honestly, now
with tests naming them: no Boom workbook (the Financials tab states its gap), no `verdict`, no
`requests`, a covenant with null actual and threshold, and a facility that matured in the past.

### Delta review fixes (Codex, second pass)

Eight fixed, one refuted with proof.

- **Facility stages: partial data is CANNOT TELL.** The check was `some`, so one staged facility out of
  four let the cockpit confidently report "none of these are booked". Now `every`. This is the whole
  point of failing closed and it was half-broken.
- **The facility chooser is keyed on the record id**, with labels for display. Two facilities can share
  a name; keyed on the label they collapsed into one option and the payload resolved to whichever came
  first.
- **The package anchor comes from the CHOSEN facility, not the relationship snapshot.** A facility from
  another package staged against this one is a write aimed at the wrong deal. `Facility.productPackageId`
  is new on the contract and additive on the `Customer360Exposure` read; **until it flows, modification
  and renewal refuse to stage** rather than guess the correspondence.
- **A blank `accountId` is not an anchor** on the package-first variant; staging is refused.
- **The staging gap is built from the availability rule**, so the three outcomes stay three sentences
  even when the panel is reached outside the gate.
- **Covenant `observedValue` and `comments` are sent** — the observed envelope carries both, and the
  envelope is the authority. The field is editable again with an honest note; its target stays staging
  because the WIRE contract is known and the org column is not.
- **The borrowing-structure claim is made only where a plan proves it.** The package-first plan carries
  `write_involvement`; the existing-package plan, as observed, does not. Copy follows the observed plan.
- **`packageCreated` is TRI-STATE.** The resume returns `null`, and coercing that to `false` made a
  created package vanish from the terminal state on Continue. The package name is carried forward from
  the first invocation, which is the only one that asserts it.

**REFUTED — `Term` cannot reach the Product sheet.** The cache holds six, the schema offers exactly the
cache, and the `VALIDATION_FAILED` supersede path writes only `LLC_BI__Collateral_Valuation__c` keys, so
no legal list can land on the Product field. Four tests prove the chain. Documented deliberately: if the
org itself ever returned `Term` for that field, the org would be the authority and the panel would show
it — the cockpit does not second-guess an org list. That cannot happen while the Apex validates the
record-type-scoped six.

### Wave 2.1 — package-first new facility (VERIFIED live, seams closed)

`stage_new_facility` takes **exactly one anchor**, and both variants are observed: a relationship WITH
a package sends `productPackageId`; one WITHOUT sends `accountId`, and the returned plan opens with a
`create_package` step named to the org's own convention (`<Account> - <date> - PP`). Sending both, or
neither, is not a shape the tool has accepted. The purpose field is `primaryLoanPurpose`; omitting it
is `REQUIRED_FIELD_MISSING`.

The plan is NINE steps: `create_package`, `write_loan`, `write_involvement`, `verify_loan`,
`wait_loan_detail`, `write_loan_purpose`, `hop_to_proposal`, `verify_hop`, `observe_loan_officer`.

**The borrowing structure is stated in the ticket, in both variants:** the relationship is added to
the facility's borrowing structure as Borrower at 100 percent ownership, because a facility insert
creates no such row on its own. Filed under `LLC_BI__Legal_Entities__c`.

The terminal state surfaces the **created package** with its org-assigned name and id, and a secondary
"Open the new package" link beside the facility's own. Two records were filed; the banker sees both.
Execute results carry `productPackageId` (not `packageId`), `packageCreated` and `involvementId`.

**Products are RECORD-TYPE SCOPED.** The field holds seven values; the Apex validates against the
Commercial record type's six, which exclude `Term`. The panel offers exactly those six: offering a
value the tool will refuse sends a banker into a `VALIDATION_FAILED` the ticket could have prevented.

Nothing on new-facility is marked PROVISIONAL any more.

### Wave 2.1 — a package-less relationship is not a dead end

`stage_new_facility`'s `productPackageId` is OPTIONAL. The cockpit sends it when the relationship has
a package and **omits the key entirely** when it does not — an omitted key asks the org to create the
package first; a null would be a claim about a package that does not exist. The returned plan then
opens with the org's own `create_package` step and the facility is filed under it, which is what
nCino's own wizard does. The ticket says so, blocks nothing, and the action is offered at relationship
level with or without a package.

### Roadmap — dependent picklists (awaiting org-observed combination tables)

Several of the org's picklists are DEPENDENT: a controlling value narrows the valid set of the field
below it. The first case is the new facility's Product Line to Product Type to Product chain;
involvement roles may gain one.

**Nothing is built for this yet, deliberately.** The combination tables are org data, and this
campaign has twice paid for guessing at org data. They will arrive observed and cited, cached the same
way `observedPicklists` is, in their own combinations module, minimality-tested the same way — an
entry no schema field asks for is dead weight.

Two decisions already made, so the implementer does not have to re-derive them:

- The dependent sheet is filtered to the org-valid subset for the controlling value currently
  selected. An unfiltered sheet that accepts an invalid pair is worse than no filter, because the org
  refuses it after the banker has committed to it.
- When a controlling value changes and the selected dependent value becomes invalid, **clear it and
  say so inline**. Never silently keep an invalid pair, and never silently drop a value the banker
  chose without telling them it went.

Until the tables land the sheets behave exactly as documented above: every value the org has given us,
and an honest empty state where it has not.

### Roadmap — limit and sub-limit structures (wave 3 research)

nCino models facilities under a master limit, with loans hanging off it as sub-limits. **The cockpit
does not model this anywhere:** exposure, the new-facility ticket, the modification and renewal
tickets and the coverage math all treat facilities as a flat list. A relationship whose real structure
is a master limit with sub-limits will render as separate facilities with no parent, and any total
computed across them may double-count committed amounts. Named here as a wave-3 research item; it is
deliberately absent from the UI, which claims nothing about limit structure either way.

### Wave 2 seam swap (observed 2026-07-26)

Every wave-2 payload now carries field names copied verbatim from request bodies the org accepted.
Two shapes were wrong in the contract build and are fixed: a new facility is anchored on
`productPackageId` with NO `accountId`, and its product field is `product`; the risk rating factor
scores are four NAMED fields (`cashFlowCoverageActual`, `revenueGrowthActual`,
`managementExperienceActual`, `creditScoreActual`), not a map. The covenant assessment sends
`productPackageId` plus `assessments[]` of `{covenantId, status, observedValue, reasonForException,
narrative, comments}`, with `observedValue` a NUMBER; the old `accountId` + `covenantComplianceId` +
`result` shape was deleted from the org in WS0.5 and its fields carried `required=true`, so sending
one makes the new shape unreachable on the wire.

`executionHeld` and `heldReason` come back on the modification and renewal stage responses, and the
gate now renders the ORG's reason verbatim rather than restating our own copy. `covenantCarryoverCount`
is surfaced per A33.2.4(c).

**Two-phase execute for new facility — VERIFIED live.** The in-transaction wait was architecturally
impossible: the Loan Detail is created by an AFTER-COMMIT flow, so no synchronous poll can see it, and
the busy-spin hit the Apex CPU ceiling before its own timeout could fire (the superseded defect run
rolled back atomically and created nothing). Execution is two invocations. The first returns `partial`
with `write_loan` and `verify_loan` verified, `wait_loan_detail` **waiting**, and the org's own
sentence: *"nCino creates the Loan Detail moments after this filing, in a separate transaction. It
cannot be seen from here."* The banker's **Continue** gesture makes the second, which re-queries once
and completes: purpose written, stage hopped to Proposal, hop re-verified, and `observe_loan_officer`
honestly `filed_unverified` because org automation assigned it. Still-waiting keeps the affordance and
is never rendered as a failure — nothing has gone wrong, the org simply has not finished.

**The resume resends the stage `decisionToken`, and that is deliberate.** The token is single-use
SEMANTICALLY — invocation 1 consumes it and stamps `cm_Token_Consumed_At` exactly once — but the wire
requires its PRESENCE on the resume as a transport formality: `decisionToken` is declared
`required=true` on the invocable variable, so a null or omitted token is rejected at the platform
boundary with `REQUIRED_FIELD_MISSING`, before Apex runs. The Apex resume path never reads it (it
dispatches on staging status). So the Continue gesture sends the identical five-field payload,
original token included, pinned by test at both the channel and panel layers. A third identical call
replays: same `loanId`, no duplicate.

**One field name in the whole wave-2 surface is still inferred:** `overriddenRiskGradeValue`. The
staged plan writes `LLC_BI__Overridden_Risk_Grade_Value__c`, so the tool accepts an override, but the
observed probe never sent one; the name follows its observed sibling `computedRiskGradeValue`. It is
marked as inferred in the type.

The org-assigned facility name is reported from `recordName`, never echoed back from anything the
panel sent — the org rewrites `Name` as `Account - Product - Amount`.

**`execute_covenant_review` has now been run live (WS0.5, 2026-08-22).** The throwaway substitute
that did not exist was built for the probe: a disposable account, package, loan, covenant pair and
compliance rows, all tree-deleted afterwards. Creating those fixture rows did fire the
Create-triggered approval flow exactly as predicted, and the two `FlowOrchestrationInstance` rows it
raised could not be deleted — recorded in the envelope's `residue` block rather than papered over.
Both the stage and the execute path are now wire-observed.

### Wave 2 — five more tickets (contracts frozen, tools not yet observed)

New Facility, Risk Rating Review, Covenant Review, Loan Modification and Renewal have full tickets,
schemas and registry wiring. Manifest constants cover 14 write-tool names: 6 stage/execute pairs plus
`stage_loan_modification` and `stage_renewal`.

**Execution is HELD for RENEWAL only.**
`WRITE_TOOLS.renewal.execute` is `null`, not a plausible name we hope exists: no `execute_renewal`
was built. Staging is real — the plan and the ledger row are genuine — and the confirm gate renders
the held state with that sentence, gesture disabled. `executeAction` refuses a held action before
calling anything.

**The modification pair is complete (WS0.5, 2026-08-22).** `execute_loan_modification` is deployed
and was exercised live over the REST Actions API, so the cockpit's own hold is gone and the confirm
gate offers the ordinary "Confirm and file". What LV06 still governs is BOOKING: executing produces a
clone facility at Qualification, and moving that clone past approval is nCino's own Submit for
Approval run. The banker learns that from the plan's `warnings[]` and the `held_execution` handoff
step, rendered verbatim, rather than from a gate. The ORG remains the authority on holding: a staged
plan carrying `executionHeld: true` still blocks the gesture, whatever the client map says.

**Built against the contract, not observed wire.** The Apex Request classes for these five are not
deployed, so `StagePayloads` carries PROVISIONAL field names, declared in one place so the seam swap
is a single edit per action. Option sets relayed from the frozen contract (loan products, assessment
results) are cited as relayed, not as described by this session.

Other probe-settled specifics: the org names the loan on creation and the cockpit proposes no name;
Loan Detail arrives asynchronously; the loan officer is org-assigned and displayed readonly because
the ACNPEX routine overwrites it; a covenant assessment is UPDATE-only and, since WS0.5, is
anchored on the PRODUCT PACKAGE rather than on a compliance row, so it blocks without a staged
package id (the collateral-anchor doctrine, moved up one level); the approval-trap warning is back and
comes from the ORG, which reads Active + Frequency Template + Effective Date per covenant and measures
at execute whether a successor row appeared rather than asserting it did not; and a rating override
with no reason is refused in the ticket rather than by a rejected write.

### Write tools (WP5)

`stage_*` performs **zero domain-object DML** — it validates, computes and returns an immutable plan
(`stagingId`, `planHash`, `decisionToken`, `steps[]`, `warnings[]`). Verified live: after a staging call
the target object still held zero rows. Every org write happens behind `execute_*`, which requires the
server-minted single-use `decisionToken` bound to that exact `planHash`.

Client discipline for these two:
- **User gesture only.** Staging is the "Review the plan" button; executing is the confirm gesture.
- **Never cached, never auto-retried.** An ambiguous transport outcome is not proof the tool did not
  run, so a write is re-issued only behind a fresh gesture (A33.3.3 resume preconditions).
- **`idempotencyKey` is ours**, stable across the stage/execute pair and across resume. The platform is
  known to duplicate on failed background Apex, so idempotency is never assumed from nCino.
- **Domain failure is not transport failure.** `isSuccess:true` with `outputValues.ok === false` is a
  successful invocation reporting a rejected value; it renders the org's own message, and when the tool
  returns the legal picklist set the panel adopts it.
- `provenanceJson` arrives as a **string** and is parsed defensively.

**The other actions still perform no writes.** The remaining write-shaped actions (modification, renewal, new facility, service request) produce
a grounded analysis plus an explicit statement of what a credit officer would need to approve, and are
instructed never to imply a record was created. Their `apexAction` seam names the future callTool
target and stays unwired until v2 gated writes exist.

Freshness indicators are driven from `result.cache.storedAt`, never `Date.now()`.

The KPI band is the only DISPLAY-arm surface: `watchTool` replays cache, refreshes when stale and
delivers every newer result. Its poll sits at 60s — comfortably above the platform's ~30s floor, since
a credit book does not move second to second and a tighter loop only burns the viewer's budget. A
transient failure keeps the last good figures with a staleness note; only an authz denial retracts
them.

---

## 5. Degraded states

`window.claude.mcp === undefined` (standalone preview, older runtime) ⇒ the cockpit renders exactly as
it does today: all staged data navigable, chat disabled with the "Connection details" probe, actions
falling back to the copy-prompt dialog. **The copy-prompt dialog exists only for that case** — it is
never shown when the capability is live.

Every failure branches on the error **code**, never on message text, and each affected section shows
the one action that fixes it:

- `needs_reauth` → "Reconnect {server} in claude.ai Settings → Connectors."
- `server_not_connected` → "Add {server} in claude.ai Settings → Connectors."
- `selection_required` → choose one connector when prompted.
- `not_in_manifest` / `blocked_by_policy` / `approval_required` / `tool_error` / `rate_limited` /
  `bad_request` — each its own copy.
- `not_granted` / `capability_disabled` / `capability_removed` → the no-MCP experience.

Retries: **only** when the platform stamps `retryable: true`, at most **once**, honoring
`retryAfterMs` — and **reads only**. `server_unavailable` / `upstream_error` / `cancelled` are
outcome-ambiguous for writes, so a write is never auto-retried.

---

## 6. Publish checklist

1. `npm run build` in `app/` → `dist/cockpit.html`, then `npm run release:artifact`.
2. Assemble with data: `node render/assemble-cockpit.mjs --data <data.json> --out <out.html>`.
3. Publish the assembled file **by path** with `capabilities` from §1.
4. State in the reply which tools are pattern-inferred (§2) — not inside the page.
5. Keep `favicon` and `title` stable across redeploys. The favicon is **🏦 on the first publish,
   never changed**. It is the icon the canonical `Credit 360 · Relationship Cockpit` carries, so
   every cockpit published from this plugin carries it too. A redeploy passes no `favicon` at all
   and keeps the icon the artifact already has: a changed icon reads as a different page to the
   banker hunting for their tab. The title is `Credit 360 · Relationship Cockpit`, exactly, because
   the skill's open resolves a viewer's cockpit by matching that title in an artifact listing.
