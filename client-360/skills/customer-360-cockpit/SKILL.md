---
name: customer-360-cockpit
description: Open the Customer 360 relationship cockpit, a worklist-first commercial-credit control center. The DEFAULT open is INSTANT: hand the banker the canonical published cockpit named in assets/cockpit.json and let the page refresh itself through the viewer's own connectors. No fetch, no assembler, no publish. The fetch-and-publish path (the 10 read tools of the 28-tool Customer360 MCP server plus Boom-spread financials, composed into C360_DATA and assembled into a prebuilt interactive Cowork artifact: needs-action queue, activity/audit trail, exposure, covenants, relationship graph, whitespace, structural signals, a chat FAB and a Client Actions panel) is the REBUILD path, taken only when a banker asks to rebuild or republish or when no canonical URL can be resolved. This is the read and render skill; the 18 governed write tools run through the guided skills. Trigger on "customer 360", "open the cockpit", "pull up the relationship view", "what needs my attention", "relationship overview for <account>", "rebuild the cockpit", "republish the cockpit", or any account-level portfolio question.
---

# Customer 360 Cockpit (v3)

**Cowork chat is the main interface, so the open has to be instant.** There are TWO paths in this
skill and the fast one is the default:

| Path | When | What it costs |
|---|---|---|
| **OPEN** (default) | "open the cockpit", "pull up <account>", "what needs my attention" | one file read. No connector calls, no assembler run, no publish, nothing uploaded |
| **REBUILD** | "rebuild the cockpit", "republish", or no canonical URL can be resolved | the whole fetch sequence, the assembler, and a ~1.9 MB publish |

**Demo anchor:** Piedmont Precision Components, Inc. · Account `001bb00001DLtRMAA1` · org `bankinggpt`.

**You never write UI.** The artifact HTML is a compiled React app (`app/`, built to
`<pluginRoot>/assets/customer-360-template.html`). On the rebuild path your only job is the data plus
one assembler command.

---

## THE OPEN: the default, and it is one file read

1. **Read `<pluginRoot>/assets/cockpit.json`** and take `canonicalArtifactUrl`.
2. **Hand the banker that URL in one line.** That is the whole open.

**Do NOT fetch, do NOT compose `C360_DATA`, do NOT run the assembler, do NOT publish, and do NOT
pass a capabilities manifest.** The pinned cockpit already carries the grant from its last publish,
and the connector prompts the viewer answered on it are still answered. Publishing a fresh 1.9 MB
artifact to answer "open the cockpit" is the slow open the founder feels, and it buys nothing the
page cannot get for itself in seconds.

**Why this is not a stale page.** The cockpit REFRESHES ITSELF. The moment a banker lands on a
relationship the page reads that relationship live through the viewer's own Customer 360 connector,
one lane per module, and each figure replaces its baked value as its own read lands. Until it does
the page shows the last figures it holds, marked `As of <time>`; the footer's connector line says
which lanes are live, stale or unreachable and with which error code; and a lane that cannot reach
the org retries on its own, three times inside twelve seconds and then quietly once a minute, so
recovery needs no click. The banker sees live figures within seconds of opening, and never sees a
stale figure claiming to be current. Behaviour lives in `app/src/channel/openRefresh.ts`,
`app/src/channel/lastGood.ts` and `app/src/channel/laneHealth.ts`.

**A relationship the baked snapshot does not carry.** Name it in your reply and tell the banker to
open it from the cockpit's own search (cmd-K): the page resolves it through
`Customer360SearchAccounts` and reads it live before opening it. Do NOT rebuild the artifact to add
one relationship.

**An actionable ask is not an open.** "The client wants the line at 20M" is an INTENT written to the
canonical cockpit, never a republish. See "Intent handoff" at the foot of this page.

**Verify before you promise.** If `assets/cockpit.json` is missing, unreadable, or carries no
`canonicalArtifactUrl`, say so and take the REBUILD path. Never type a cockpit URL from memory and
never carry one forward from an older transcript.

---

## THE REBUILD: the explicit path

Take this path ONLY when one of these is true:

- the banker asked for it: "rebuild the cockpit", "republish", "publish a fresh cockpit", "the baked
  snapshot is too old, rebuild it";
- `assets/cockpit.json` carries no usable `canonicalArtifactUrl`;
- a founder has said the canonical cockpit is to be replaced.

Everything from STEP 0 to the end of the RENDER section describes THAT path, and none of its rules
may be relaxed to make a rebuild faster: no fallback data sources, the capabilities manifest whole on
every publish, and the read-only execute path warning whenever `meta.userId` cannot be read.

**A rebuild does not move the canonical cockpit.** `assets/cockpit.json` is hand-edited, once, when a
founder blesses a new canonical URL; until then the fast open still points at the pinned page. Say
which one you published and whether it is the canonical one.

---

## PREREQUISITE, before STEP 0 (REBUILD path): the viewer's connectors, by exact name

The rendered page calls the viewer's own claude.ai connectors by display name: `Customer 360`,
`IDB Gateway`, `Microsoft 365`, and, for the memo room's writeback, `Experience / nCino` and `AFS`.
If the viewer's Customer 360 connector carries any other name,
the page reports offline and every sync line fails even though this session's tools work. When
the badge says offline or the sync reports every line unreachable, ask the viewer to check the
connector's name under claude.ai Settings > Connectors before anything else.

## STEP 0 (REBUILD path): WAIT for the Customer360 server before anything else

**Not on the open path.** The fast open touches no tool at all, so there is no server to wait for
and no reason to make the banker wait for one.

MCP servers connect lazily; at session start `customer360` often shows "still connecting". You MUST:

1. Call **ToolSearch** with query `"Customer360Snapshot"` — ToolSearch WAITS for connecting servers.
2. If no match, wait and retry ToolSearch up to 3 more times (a Salesforce OAuth token refresh can
   take ~10–30s).
3. Only if the server is terminally failed/unauthenticated after retries: **STOP** and tell the user
   to authenticate (`/mcp` → customer360 → Authenticate) or check the README config. Do NOT proceed.

## HARD RULE — no fallback data sources (this overrides being helpful)

If the Customer360 MCP tools are NOT available (disconnected, still connecting, or shadowed by a
stale plugin-bundled duplicate), **STOP and tell the user to fix the connection** — an error message
IS the correct deliverable. Do NOT render from `ncino_deal_prep`, sObject SOQL, or any other source.

Reason: those paths sum loan amounts, which double-counts nCino limit/sublimit structures (Piedmont:
3 loans sum to $17.5M vs true package-level TCE $12.5M). **Package-level rollups exist ONLY in the
Customer360 tools.** A wrong committed-exposure figure in front of a banker is worse than an error.

---

## The MCP surfaces

**Customer360**: Salesforce-hosted, per-user OAuth, **28 tools: 10 reads plus 18 governed write
tools**. Tool names derive from the Apex class (`aa:apex-{ClassName}`), so match by the **class-name
suffix**, since the host may namespace it (`customer360__Customer360Snapshot`). Never hardcode a prefix.

### Reads (10): everything this skill fetches

| Tool | Returns |
|---|---|
| `Customer360Portfolio` | whole book in ONE call: `accounts[]`, `bookTotals`, `signals` |
| `Customer360SearchAccounts` | name-based lookup only (open-by-name) |
| `Customer360Snapshot` | per-account rollup (rating, stage, revenue, TCE/TBE/TOE, outstanding, packageCount) |
| `Customer360RelationshipGraph` | `connections[]`, `legalEntities[]`, `note` |
| `Customer360Exposure` | totals + `facilities[]` each with `collateral[]` |
| `Customer360Covenants` | `covenants[]`, `note`, plus `latestComplianceStatus` and `reasonForException` per covenant |
| `Customer360Opportunities` | `opportunities[]`, `note` |
| `Customer360StructuralSignals` | `modifications[]`, `modificationClusterFlag`, `renewals[]`, `maturityWatch[]`, `guarantorSignals[]`, `note` |
| `Customer360ActionHistory` | governed actions already run against the account (`accountId` required, `maxResults` default 50, max 200, newest first) |
| `Customer360Catalog` | the org's own chip sets: every picklist and both lookup catalogs the create grammar draws from. No input |

### Governed writes (18): never called by this skill

Eight `stage_*` / `execute_*` pairs, one stage-only tool, and one second-hop completion tool:

`stage_loan_modification` · `execute_loan_modification` · `stage_covenant_review` ·
`execute_covenant_review` · `stage_collateral_valuation` · `execute_collateral_valuation` ·
`stage_service_request` · `execute_service_request` · `stage_annual_review` ·
`execute_annual_review` · `stage_risk_rating_review` · `execute_risk_rating_review` ·
`stage_new_facility` · `execute_new_facility` · `complete_new_facility_detail` ·
`stage_relationship_intake` · `execute_relationship_intake` · `stage_renewal`

**This skill renders. It does not write.** Every write runs through a guided skill, under the write
discipline in `agents/customer-360.md`: stage, present the org's plan and warnings verbatim, the
banker confirms in words, execute with the five-field payload, verify by re-query. See the ACTIONS
section below for the routing.

**Boom** — `boom_get_ratios` + `boom_get_spread` for the Financials tab.

**Doors, not connectors (fleet rule).** Bind to TOOL NAMES found via ToolSearch, never to a specific
MCP server. The fleet is migrating onto the **IDB Gateway** (AgentCore): Boom already arrives through
it (`boom-mcp-js` / `boom-mcp-py` targets — same `boom_get_spread`/`boom_get_ratios` tools, gateway
prefix), and Credit Memo and the Customer360 Salesforce server will follow. Whichever door exposes the
tool in this session is the right door; if BOTH a direct connector and the gateway expose the same
tool, prefer the gateway. Never hardcode a server id.

**Every tool takes `List<Request>` and returns `List<Response>`.** For a single request read
`response[0]`, never a bare object — `Customer360Portfolio` included.

---

## FETCH SEQUENCE (REBUILD path only, worklist-first)

Everything below runs ONLY on the rebuild path. On the default open none of it runs: zero tool
calls, zero bytes uploaded.

### (a) One `Customer360Portfolio` call
Request (all optional): `industry`, `maxAccounts` (default 25, cap 100), `signalWindowDays` (default 90).
Returns `accounts[]` (TCE desc, truncated to `maxAccounts`), `bookTotals` (`totalCommitted`,
`totalOutstanding`, `accountCount`, `utilizationPct`), and `signals` (`covenantsDueSoon[]` cap 25,
`breachedCount`, `maturitiesSoon[]` cap 25).

`bookTotals.accountCount` spans **ALL** packaged accounts, not the truncated list — never infer book
size from `accounts.length`.

### (b) Determine the worklist scope
The worklist is the **needs-action queue**: accounts carrying covenant tests due or breached,
maturities in window, modification clustering, or guarantor signals. Build the id set from
`signals.covenantsDueSoon[].accountId` ∪ `signals.maturitiesSoon[].accountId` ∪ any account you have
reason to believe carries structural signals.

- **Cap at ~30 accounts** — beyond that the queue stops being a queue.
- **If the book is smaller than the cap, stage everything.** Always include the anchor.

### (c) Stage details for ALL worklist accounts — BATCHED
The six detail tools each accept an **inputs array**: `inputs: [{ accountId }, { accountId }, …]`.

**Six calls total. Never a per-account loop.** One batched call each to `Customer360Snapshot`,
`Customer360RelationshipGraph`, `Customer360Exposure`, `Customer360Covenants`,
`Customer360Opportunities`, `Customer360StructuralSignals` (pass `maturityWindowDays: 270`).

Responses come back positionally — zip each response array back to the accountId you sent at that index.

### (d) Boom
`boom_get_ratios` + `boom_get_spread` (direct connector or IDB Gateway `boom-mcp-*` target — see the
doors rule above) for the anchor, and for worklist accounts where the file exists
and the call is cheap. If either fails or no file exists, set that bundle's `boom` to `null` — **never
fabricate**. The Financials tab renders an honest gap state.

**Stage BOTH results as the connector returned them**, `"boom": { "ratios": <boom_get_ratios
result>, "spread": <boom_get_spread result> }`, and let the assembler shape them. Do NOT hand-write
the display fields: the assembler derives them and would overwrite yours anyway. See "The Boom
payload" below for what it derives and why.

**Drop `spread.file.downloadUrl` before staging.** It is a presigned S3 URL that expires in minutes,
and a published artifact is not a place to put a credential.

### (e) OPTIONAL — M365 client-request intake

**Opportunistic by design: if M365 is not connected, SKIP THIS ENTIRE STEP SILENTLY.** No error, no
warning, no gap chip, no mention in the render. A missing channel is **not** a data gap — the cockpit
renders exactly as it would have without this step. Never block, never wait, never fail on mail.

1. **Detect.** ToolSearch for a Microsoft 365 / Outlook mail-search tool (names vary by connector —
   try `outlook email search`, `mail search`). **Not found ⇒ skip the step and proceed to (f).**
2. **Search.** Recent inbound mail only (last ~30 days, cap ~25 results), querying **per staged
   worklist account name**. Entity resolution is **conservative**: attach a message to an account only
   when the account name clearly appears. Ambiguous matches are **ignored** — you may mention them in
   your chat narration as unmatched, but they never reach the render.
3. **Ingest genuine requests.** For each clear match that reads as a client *ask* — increase, renewal,
   new facility, payoff, service change — judge **intent, not keywords**. Populate `requests[]` plus a
   `REQUEST_RECEIVED` entry in that bundle's `activity[]`:
   - `reference: { kind: "m365-message", id: <real message id>, webLink: <real link> }` — both real,
     both from the message. This is the one place a `webLink` is permitted.
   - `receivedAt` / `ts` = the message's **actual** timestamp. It must predate `meta.generatedAt`; if
     clock skew puts it later, clamp to `generatedAt` and say so in your narration.
   - `summary` = a faithful one-sentence restatement. `ask` amounts parsed from the email text
     (DERIVED — the message is the citation).
   - **No matching mail ⇒ no `requests[]`.** That is correct output, not a failure.
4. **Conclude on it.** For each ingested request add an `ANALYSIS_CONCLUDED` entry computed from the
   **staged** data — verdict and headroom measured against the ask (AGENT provenance) — with
   `detail.nextSteps` referencing real registry action ids. Same shape as the bundled sample scenario,
   but every figure from live data.
5. **Failure = skip.** Any M365 error or timeout ⇒ abandon the step, render anyway, and note in your
   chat reply that mail intake was unavailable this run. The render never waits on mail.

**In a live run the bundled sample scenarios are irrelevant** — you are rendering the real book, and
this intake is the **only** source of `requests[]`.

### (f) Compose `C360_DATA`
Shape source of truth: **`app/src/data/contract.ts`**. Read it if unsure — it is authoritative and
carries the provenance map.

---

## The C360_DATA contract

```jsonc
{
  "meta": {
    "anchorAccountId": "001…",        // REQUIRED
    "generatedAt": "2026-07-25T14:03:00Z", // REQUIRED: current UTC ISO instant, must parse
    "userId": "005bb00000ftouDAAQ",   // REQUIRED: the 005 Salesforce user id of the signed-in identity
    "user": "Fabian Goetzens",        // DISPLAY name. Rendered, never sent to a tool
    "orgAlias": "bankinggpt"
  },
  "portfolio": {                      // VERBATIM from Customer360Portfolio response[0]
    "accounts":   [ /* … */ ],
    "bookTotals": { /* … */ },
    "signals":    { /* … */ }
  },
  "borrowers": {                      // REQUIRED — one bundle per worklist account, INCLUDING the anchor
    "<accountId>": {
      "snapshot": {}, "graph": {}, "exposure": {}, "covenants": {},
      "opportunities": {}, "signals": {},          // raw tool responses, VERBATIM
      "boom": { "ratios": {}, "spread": {} },      // the two Boom results VERBATIM, or null
      "verdict": "…",                              // agent-composed, live figures only
      "anchors": [ { "label": "…", "value": "…", "sub": "…", "dir": null } ],
      "activity": [ /* only from REAL sources — see below */ ],
      "requests": [ /* only from REAL sources — see below */ ]
    }
  },
  "worklist": {                       // optional — omit and let the client derive
    "accountIds": [ "…" ],
    "reasons": { "<accountId>": [ "COVENANT_DUE" ] }
  },
  "aiPanel": { "threads": [] }
}
```

### Rules that will fail the build if broken

- **`meta.generatedAt` is REQUIRED** and must be a valid ISO-8601 instant. It is the deterministic
  clock for every time-based worklist reason. Use the **current** UTC instant at compose time.
- **`meta.userId` is REQUIRED** and must be a 15 or 18 character Salesforce user id starting `005`.
  It is the only value the `execute_*` tools accept as `approverUserId`: the Apex compares it to the
  running identity before it will redeem a decision token, so a display name or an email is refused
  and nothing is written. The assembler exits 1 on a missing or malformed one, exactly as it does on
  `generatedAt`. See "Obtaining `meta.userId`" below.
- **`borrowers` must be a plain object** with an own entry for `meta.anchorAccountId`, and each
  bundle's `snapshot.accountId` must equal its own map key.
- **Do NOT hand-write top-level `borrower`.** The assembler derives it from
  `borrowers[meta.anchorAccountId]`; anything you supply is overwritten.
- **Do NOT hand-write `covenantChallenge`, `dataQuality`, or `meta.validation`.** The assembler
  computes them deterministically (see Validation stage).
- **`worklist.reasons` codes are restricted** to the generated set below. Any other value exits 1.
  **If unsure of the reasons, omit `worklist` entirely**: the client derives them from the staged
  bundles, which is the safer default.
- **Client requests are derived, not declared.** Do not put a client-request code in
  `worklist.reasons`; stage `requests[]` / a `REQUEST_RECEIVED` activity entry and the client raises
  the chip itself, ranked above every risk signal.

**Permitted `worklist.reasons` codes.** Generated from `render/contract-checks.mjs`. Do not edit by
hand; run `node client-360/render/skill-blocks.mjs` and the release gate checks it.

<!-- BEGIN GENERATED permitted-reason-codes (node client-360/render/skill-blocks.mjs) -->
`COVENANT_BREACH` · `COVENANT_DUE` · `MATURITY_NEAR` · `MODIFICATION_CLUSTER` · `GUARANTOR_SIGNAL` · `RECENTLY_MODIFIED`
<!-- END GENERATED permitted-reason-codes -->

### The Boom payload (ONE shape, normalised by the assembler)

Two consumers read `bundle.boom`: the Financials tab and the covenant challenge. They used to
disagree about its shape, so whichever one you staged, the other silently rendered nothing. The
assembler now normalises once (`client-360/render/boom-normalise.mjs`) and both read the result.
The types are in `app/src/data/contract.ts`.

**You stage the raw results. The assembler adds the display fields:**

```jsonc
"boom": {
  "ratios": {
    "revenue": 64486000, "ebitda": 5234000,   // DERIVED by the assembler from ratios.raw
    "ebitdaMargin": 8.12,                     // PERCENT here; Boom's raw is the FRACTION 0.0812
    "totalLeverage": 3.85, "interestCoverage": 2.64,
    "asOf": "2025-12-31",                     // boom_get_ratios asOf, the period those ratios are for
    "raw": { /* boom_get_ratios `raw`, VERBATIM */ }
  },
  "spread": {
    "sourceFile": "…xlsx",                    // DERIVED from file.fileName
    "periods":   [ { "period": "FY2025", "revenue": 64486000, "ebitda": 5234000, "margin": 8.1 } ],
    "lineItems": [ { "line": "Revenue", "ltm": 64486000, "priorFy": 59915000 } ],
    "file": { /* boom_get_spread `file`, VERBATIM, minus downloadUrl */ }
  },
  "note": "Source: Boom spreading …"
}
```

- **The raw payloads are the source of truth.** The covenant challenge recomputes from
  `spread.file.financialStatements[]` and never from the display fields.
- **Periods key on `periods[].endDate`, not on the period id.** Boom keys `periodValues` by a period
  UUID; the statement's own `periods[]` is the only place that id is tied to a date.
- **PRIOR-YEAR EBITDA IS NULL, NEVER DERIVED.** Boom's accountCode chart carries no depreciation and
  amortisation line at all, so an EBITDA exists for exactly one period, the one `ratios.asOf` names.
  A prior year computed from operating profit alone would print an understated figure as though the
  spread contained it. The tab renders the gap.
- **Expense lines arrive negative** (`interest_expense: -1076000`). The challenge takes them
  absolute; anything you read by hand should too.
- **A covenant Boom cannot support stays `not-computable`,** and the note names every accountCode
  that was tried. Piedmont's DSC and Fixed Asset Purchases sit there today: Boom emits no CPLTD line
  (`st_loans_payable_bank` is "Line of Credit AND Current Portion of Long-Term Debt", not CPLTD) and
  no capex accountCode. Never substitute a lookalike code to make a number appear.

### Obtaining `meta.userId`

The Customer 360 connector has **no whoami tool today**, so the id has to come from elsewhere:

1. **The sObject / Salesforce connector's `getUserInfo`** returns the running user's `005` id
   against the same org. This is the route. Take the id verbatim; never reshape it.
2. **Already staged.** If you are re-assembling data that already carries `meta.userId`, carry it
   forward unchanged rather than re-reading it.
3. **Ask.** A banker can read their own id off their Salesforce user record (`/005…` in the URL).

**If it is genuinely unavailable, say so and still render.** Assemble with `--no-approver`, tell the
banker in your chat reply that the cockpit is publishing **read-only on the execute path**, and say
why: every plan can be staged and read, and the confirm gesture will refuse to file because the view
carries no Salesforce user id for the signed-in identity. Never invent an id, never pass the display
name, and never claim a write is available when it is not.

### `activity[]` and `requests[]` — real sources only

`activity[]` is the account's audit trail (first tab). Entry shape:
`{ id, ts, kind, title, summary?, reference?, detail? }`. Permitted `kind` values, generated from
`render/contract-checks.mjs` (do not edit by hand). A kind outside this set exits 1:

<!-- BEGIN GENERATED permitted-activity-kinds (node client-360/render/skill-blocks.mjs) -->
`REQUEST_RECEIVED` · `ANALYSIS_CONCLUDED` · `COVENANT_EVALUATED` · `FACILITY_MODIFIED` · `ACTION_TRIGGERED` · `ACTION_EXECUTED` · `ACTION_EXECUTION_FAILED` · `ACTION_STAGED` · `RENDER_AUDIT`
<!-- END GENERATED permitted-activity-kinds -->

- Emit entries **only** where a real record backs them (a covenant evaluation date, a recorded
  modification, a genuine inbound request). **Never synthesise history** to fill the timeline — the
  empty state ("No recorded activity in this view") is the correct output for an account with none.
- `detail.nextSteps[]` is `{ actionId, note? }` where `actionId` **must** match an id in
  `app/src/actions/registry.ts`, generated below. An id outside that set exits 1.
- `reference.webLink` is **omitted unless a real link exists**. A real M365 message link from step (e)
  is exactly that case and belongs here; anything else stays absent and the UI renders the id as plain
  text. Never show a fabricated link.

**Permitted `detail.nextSteps[].actionId` values.** Generated from `render/contract-checks.mjs`, which
mirrors the registry. Do not edit by hand:

<!-- BEGIN GENERATED permitted-action-ids (node client-360/render/skill-blocks.mjs) -->
`generate-spreading` · `draft-credit-memo` · `loan-modification` · `renewal` · `covenant-review` · `collateral-valuation` · `annual-review` · `risk-rating-review` · `new-facility-request` · `create-service-request`
<!-- END GENERATED permitted-action-ids -->

### Composition rules
- Embed tool responses **verbatim** — field names unchanged, figures un-reshaped.
- You compose **only** `verdict`, `anchors`, `activity[].detail` narrative fields, and chat replies —
  always from live figures, citing nothing invented.

---

## ASSEMBLER INVOCATION (REBUILD path only)

```
node <pluginRoot>/render/assemble-cockpit.mjs --data /tmp/c360-data.json --out /tmp/customer-360.html
```

Resolve `<pluginRoot>` as the directory containing `.claude-plugin/` (also holds `assets/`,
`render/`, `skills/`; in the source repo this is the `client-360/` folder). `--template` defaults to the committed template — do not pass it.

1. **Write the composed object to a temp JSON file.** ONLY the `C360_DATA` object — no
   `window.C360_DATA =` wrapper, no `<script>` tag.
2. **Run the command above.** Pass no other flags in a normal run.
3. On success it prints one line: bytes written (code + data split), anchor, and accounts staged.

### What the assembler enforces (all fail-closed, exit 1)

- **Staging coverage.** Every account required by the worklist (or by `portfolio.accounts` when
  `worklist` is absent) must have a bundle in `borrowers`. Missing coverage exits 1 and **names the
  missing ids** — go back and fetch them. **Do not reach for `--allow-partial` in normal runs**; it
  exists only for a deliberate single-account render and produces a degraded artifact.
- **`meta.generatedAt`** present and a valid ISO instant.
- **`meta.userId`** present and shaped like a Salesforce user id (`005` plus 12 or 15 alphanumerics).
  Missing or misshapen exits 1 and names the field. `--no-approver` downgrades it to a warning and
  publishes a cockpit whose execute path is read-only: use it only when the id is genuinely
  unreadable, and tell the banker in the same reply.
- **Structural integrity** — `borrowers` shape, anchor entry, key/`snapshot.accountId` match, worklist
  ids a subset of `borrowers`, no duplicate/malformed ids.
- **Validation stage runs automatically** and is mandatory (below).
- **Byte budget** — output is measured **before writing** and fails over 8 MiB (conservative vs the
  ~16 MiB host cap). An oversized artifact never touches disk. Write is atomic.
- **Data marker** — the injection point inside the prebuilt bundle is asserted to occur exactly once.
  You never touch it; the assembler owns injection end to end.

There is a validation-skip flag reserved for test fixtures; it is hard-restricted to `/tmp` outputs
and **must never be used for anything a banker will see**.

**On exit 1: read the error.** Every failure names exactly what is missing or malformed. Fix the data
and re-run — never work around the check.

### Validation stage (SR 11-7 effective challenge)

Runs on the composed data **before injection**, across **every** bundle. Deterministic and LLM-free —
the model never touches these numbers. It adds:

- **`covenantChallenge[]`** (per bundle) — each nCino covenant recomputed from that borrower's Boom
  spread over the latest period, beside the nCino actual. `status`: **corroborated** (within 15% and
  same compliance side), **diverges** (>15% off or opposite side → also sets `breachRiskFlag`), or
  **not-computable**.
- **`dataQuality[]`** (top-level) + `meta.validation` — deterministic integrity findings across the
  staged book, sorted critical → warn → info.

**Standard vs contractual definitions — load-bearing caveat.** The Boom-implied value uses *standard*
ratio definitions; the bank's *contractual* ones are nCino-owned and can differ (add-backs, rolling
averages, pro-forma adjustments). A `diverges` result is a **review flag for effective challenge,
never a breach determination.** Never present divergence as a covenant breach.

### Compliance status semantics: Exception is not a breach

`Customer360Covenants` returns `latestComplianceStatus` and `reasonForException` per covenant. Read
both. The org's compliance status picklist offers exactly `Compliant`, `Exception`, `In Progress`,
`Pending`, `Waived`, and carries **no separate non-compliant value**. `Reason for Exception` offers
exactly `Breached` and `Overdue`.

| Data | Meaning | Render and narrate as |
|---|---|---|
| `Exception` + reason `Breached` | measured, and the test failed | "Exception, reason Breached". Ranks with the `Breached` flag |
| `Exception` + reason `Overdue` | the document or statement was not delivered by the due date | "Exception, reason Overdue". Administrative, explicitly |
| `Exception`, no reason | nCino's own batch forces Exception onto any row past its due date, measured or not | "Exception, reason not recorded". **Never** a breach |
| `Waived` | its own neutral state; it **outranks the arithmetic** | "Waived" |
| `Pending` / `In Progress` | arrival states, not verdicts | neither compliant nor in breach |

In this org 101 of 140 Exception rows carry no measured value at all, so a bare "in breach" on
`Exception` is wrong on the facts. An unmapped status renders verbatim. The covenant-level status,
not the compliance-row status, still drives the classification kind.

---

## RENDER (REBUILD path only)

### FIRST, THE ONE THAT IS NOT A RENDER

A banker asking to open the cockpit gets the canonical URL and nothing is rendered at all. This whole
section is the rebuild path. Do not reach for it to answer an open.

### TWO-PHASE REBUILD

A rebuild is slow by nature, so it is still split: do not make the banker watch the whole staging
pipeline before anything appears.

**Phase 1 (publish within the first ~15-20s):** after step (a) plus ONE batched detail call for the
anchor account only, compose a minimal C360_DATA — `portfolio` verbatim, `borrowers` containing just
the anchor bundle, `worklist` omitted — and assemble with `--allow-partial` (this is the ONE sanctioned
use of that flag: a deliberate degraded first paint). Publish it immediately. Unstaged rows render
with their honest "not staged" state; the KPI band and anchor are fully live.

**Phase 2:** continue the fetch sequence — (b) worklist scope, (c) full batched staging, (d) Boom,
(e) M365 intake — then compose the FULL C360_DATA, assemble WITHOUT `--allow-partial`, and
`update_artifact` (full replace). Tell the user in your chat narration that the full book is loading
between the phases. The artifact preserves their place across the replace.

Skip phase 1 only when the user asked for a single account you can stage in one shot anyway.

Publish the assembled file with the artifact tool **BY FILE PATH** (`create_artifact`) — never paste
HTML inline. Do NOT open a Chrome tab or call any other widget/HTML builder.

### CAPABILITIES: pass the manifest on EVERY publish (rebuild path)

A publish is the ONLY thing that needs this. The fast open publishes nothing, so it passes nothing,
and the pinned cockpit keeps the grant its own last publish gave it. Passing a manifest is not a way
to "refresh" a grant on a page you did not publish, and there is no publish-free way to change one.


The cockpit is a compiled page that calls the **banker's own** connectors. That only works if the
artifact is published with a capabilities manifest, so every publish and every replace passes one:

1. **Read `<pluginRoot>/assets/capabilities.json`.**
2. **Pass its contents verbatim** as the Artifact tool's `capabilities` input. Do not retype it from
   this page, do not trim it to the tools you think this run will reach, do not reorder it.

That file is generated from the org's own `Customer360` McpServerDefinition plus
`app/src/channel/mcp.ts`, and a release gate fails the build when it drifts
(`node client-360/render/capabilities.mjs --check`). It declares five connectors by **display
name** (`Customer 360` with 28 tools, `IDB Gateway` with 3, `Microsoft 365` with 1,
`Experience / nCino` with 9 and `AFS` with 4), plus `sample`
(the room's Ask lane) and `db` (the intent store, which is also what makes the published page
organization-internal).

**Passing a non-empty `capabilities` object is a FULL-SET declaration:** anything previously stored
and not restated is revoked. That is why it goes whole, every time, rather than assembled per run.
Trimming the Customer 360 grant to the tools this skill calls is the specific way it has gone short
before: the guided skills route the `stage_*` / `execute_*` writes, and a tool outside the published
manifest is refused `not_in_manifest` at the moment a banker confirms a plan.

**Symptom of omitting it.** The room opens **offline**. `claude.use("mcp")` resolves null, the
account header's sync chip reads `offline · R1 no grant`, no whisper ever arrives because the intent
lane never subscribes, and every governed action is refused before it reaches the org. Nothing on
the page says "the publisher forgot the manifest", so a missing grant looks exactly like a broken
cockpit. If a banker reports the cockpit is offline, check the publish call's `capabilities` first.

**What the manifest asks of the banker.** Opening a cockpit published with it raises **two consent
prompts, once each**: one for the connectors (Customer 360, IDB Gateway, Microsoft 365,
Experience / nCino and AFS, listed together) and one for the database that holds the intent store. Answer both and the room is online;
answer neither and it reads offline exactly as it does with no manifest at all.

**The grant is PER VIEWER.** Your consent is not the next banker's. Whoever opens the URL is asked
themselves, and the page then calls the org as **them**, with their permissions and their Salesforce
identity, which is the point: nothing in the page holds a shared credential.

**A page carrying an mcp grant cannot be shared publicly.** It stays organization-internal, by the
host's rule and not by ours. Never offer a public link to a cockpit, and never promise a client or
anyone outside the org a look at one: the link will simply not open for them.

**Updates are full-replace only:** rebuild the whole `C360_DATA`, re-run the assembler to a fresh
`--out`, and `update_artifact` by file path. Never edit rendered HTML or inject JSON by hand.

The artifact detects `window.sendPrompt` **per request**, so a channel appearing after first paint
still works. With no channel (hosted artifact pages) it degrades honestly: staged data stays
navigable and actions open a copy-prompt dialog, never a dead spinner. Never assume the live loop
exists; never leave an interaction silent.

---

## HANDLING INBOUND sendPrompt REQUESTS

Every prompt the artifact sends ends with a context frame:

```
<the ask> [account: Sterling Fabrication Co. · id: 001… · tab: Covenants · requestId: req-abc123]
```

1. **Parse the frame** — account name, accountId, active tab, requestId.
2. **Do the work** — re-fetch what changed (Customer360/Boom), answer, or run the action flow.
3. **Re-assemble and replace** — rebuild `C360_DATA` with updated data *and* the extended thread.

### Chat thread schema

```jsonc
"aiPanel": {
  "threads": [{
    "id": "t1",
    "title": "Covenant questions",
    "messages": [
      { "id": "req-abc123", "role": "user",  "text": "Explain the cushion", "ts": "…",
        "context": { "accountId": "001…", "tab": "Covenants" } },
      { "id": "reply-abc123", "role": "agent", "text": "…", "ts": "…" }
    ]
  }]
}
```

- `role` is **`user` | `agent`** (never "assistant").
- **Echo the incoming `requestId` back as the user message's `id`.** The client shows the user's
  message locally the moment they send it and de-duplicates by id on the next replace — a different
  id renders the message twice.
- Text is **plain text only**. It is never parsed as HTML or Markdown.
- Carry the whole thread forward on every replace; a re-render must never lose the conversation.

**State preservation:** the artifact persists the active account, tab, panel and draft itself, so a
full replace keeps the user's place. Your job is only to carry `aiPanel.threads` forward intact.

---

## ACTIONS

Prompts arriving from the Client Actions panel, activity next-step buttons, or chat suggestion chips
are well-formed instructions naming the account and id:

| Prompt | Route to |
|---|---|
| `Draft the credit memo for <name> (<id>).` | the credit-memo plugin, as a call-out. Never rebuilt here |
| `Generate the spreading for <name> (<id>).` | the credit-memo plugin, as a call-out |
| `Pull up the Boom spreads for <name> (<id>).` | `boom_get_spread` + `boom_get_ratios`, then a short prose read |
| `Run a covenant review for <name> (<id>) — …` | the **`covenant-review`** skill |
| `Re-value the pledged collateral for <name> (<id>) …` | the **`collateral-valuation`** skill |
| `Start a loan modification for <name> (<id>) — …` | the **`client-request-to-action`** skill |
| `Begin the renewal workflow for <name> (<id>) — …` | the **`relationship-actions`** skill, renewal workflow. **Stages only** |
| `Run the annual credit review for <name> (<id>).` | the **`relationship-actions`** skill, annual review workflow |
| `Review the risk rating for <name> (<id>) …` | the **`relationship-actions`** skill, risk rating workflow |
| `Structure a new facility request for <name> (<id>).` | the **`relationship-actions`** skill, new facility workflow |
| `Create a service request for <name> (<id>).` | the **`relationship-actions`** skill, service request workflow |

**The write-shaped rows go through the room.** A prompt that names a modification, renewal, new
facility, review, valuation, covenant assessment or service request is an actionable ask like any
other, so it becomes an intent on the room and route the routing table gives it, not a staged plan in
chat. The guided skill named in the row composes the lines; it stages directly only on the explicit
opt-in path.

**Governed writes exist, and they are governed.** Every one of them stages first, shows the org's plan
and every warning verbatim, waits for the banker's confirmation in words, executes behind a single-use
decision token bound to the running identity, and verifies by re-query. The guided skills carry that
methodology; this skill never calls a `stage_*` or `execute_*` tool itself.

**What a completed write does and does not mean:**

- a modification produces a **clone facility at Qualification**. It is not booked, approved or funded.
  Booking is nCino's own Submit for Approval run, which `Loan_Validation_06` enforces with no
  permission bypass;
- a new facility advances **one step, to Proposal**, across two execute invocations;
- a **renewal stages and stops**. No `execute_renewal` exists;
- a valuation is filed and the **collateral value does not move**;
- a covenant assessment updates an existing compliance row and **creates none**.

**Never claim a write that did not happen.** If a plan was staged and not executed, say "staged, not
filed". If the org held it, report `heldReason` verbatim. Claiming a write that did not happen is the
single worst failure mode in this skill.

---

## STALE-INSTRUCTION GUARDS

- **NEVER publish an artifact to answer "open the cockpit".** The default open is the canonical URL
  from `assets/cockpit.json` and nothing else. Fetching the book, running the assembler and uploading
  ~1.9 MB to answer an open is the slow open the founder named on 2026-09-05; the page refreshes
  itself, so the work buys the banker nothing and costs them the wait.
- **Never pass `capabilities` on the open path.** There is nothing being published to carry it.
- **Never hand-author or model-generate the artifact HTML.** It is a compiled React bundle; emitting
  a document token-by-token is the slow path bankers feel as "the artifact takes ages to load".
- **Never inject the JSON yourself.** The assembler owns the data slot and asserts it exactly once.
- **Never rebuild the app** during a render run. The template is committed and current; `npm run
  build` in `app/` is a development step, not a render step.
- **Never per-account loops** for the six detail tools — batch the inputs array (six calls total).
- **Never invent figures.** A number renders only if it traces to a tool-response field.
- **Gap ≠ blank.** Missing data renders its provenance ("not in source system" / "not wired v1 —
  lives in X"). Each tool's `note` renders as a provenance caption.
- **Never render PD, a composite health index, or a KYC "cleared" pill** — no source exists.
- Where the org's truth IS the story, show the **real zero with provenance** — Piedmont: "$0 — no
  deposit relationship on file" (0 Deposit records), never an invented wallet size.
- Keep the Accenture engagement theme. No Connectry branding anywhere.

---

## Gotchas

- **`overdue` semantics** — `overdue: true` means **past due but still active**
  (`daysUntilNextEvaluation` negative). Render escalated, not "upcoming".
- **`utilizationPct` can be `null`** (Σtce = 0) → "—", never 0.
- **`coverageRatio` can be `null`** (≠ 0) → "—", never 0 or a computed guess.
- **Package-level rollups never sum loan amounts** — TCE/TBE/TOE/Outstanding come from rollup fields.
- **Modern objects** — use the `Covenant2` / `Loan_Collateral2` generation field shapes.
- **`Customer360SearchAccounts` has no `note` field** — no provenance caption for it.
- **`Customer360StructuralSignals`** defaults `maturityWindowDays` to **270**; the renewal clock uses
  that window.
- **Dates are ISO strings** (`YYYY-MM-DD`). All formatting is client-side.
- **A closed facility is not booked exposure** — the client treats a facility as active only when
  `status` is absent or "Active"; closed/paid-off ones are excluded from maturity signals and coverage
  math. Pass `status` through verbatim when the org carries it.

## Intent handoff: open a workroom from this chat

**Handoff first.** Anything actionable a banker says in this chat goes to the room that owns it, as
an INTENT, whenever a cockpit is reachable: this session published one, or `assets/cockpit.json`
names the canonical one. Do NOT describe the steps back, and do NOT call a `stage_*` or `execute_*`
tool from chat to get ahead of the room. Write the intent and the open cockpit reacts live (a
whisper, then Open flies to the account, binds the route and feeds the lines through the room's own
staging, pausing only where a decision is the banker's). Direct staging from chat is the explicit
opt-in path: the banker says "do it here" or "no cockpit", or no cockpit can be resolved at all, and
then the guided skills run their governed pattern unchanged.

### The routing table

<!-- BEGIN GENERATED handoff-routing (node client-360/render/handoff-routing.mjs) -->
| What the ask changes | Room | Route |
|---|---|---|
| A facility that already exists changes: amount, rate, maturity, term, a fee, a party on the loan, a covenant on the loan, or collateral pledged to it, whether the collateral is new or already held. A pledge to a facility rightly versions the package, and that is a modification, not a mistake. | `facility` | `modify` |
| An existing facility is renewed. | `facility` | `renew` |
| A facility that does not exist yet is structured. It rides inside a `modify` document instead when other changes travel with it. | `facility` | `create` |
| A collateral ASSET is registered with nothing pledged, a new party joins the relationship, or a covenant is written at relationship level. | `relationship` | `intake` |
| Collateral that is already pledged is valued. | `relationship` | `valuation` |
| Covenants are assessed against the evidence. | `relationship` | `covenant` |
| An annual or ad-hoc credit review is opened. | `relationship` | `annual` |
| A risk rating is reviewed. | `relationship` | `rating` |
| A servicing ask is raised. | `relationship` | `service` |

**Facility, worked.**

- "James attached an appraisal for the Kokomo plant expansion, $6.5M, real estate; he wants it as security on the construction loan" is `facility` / `modify`, one line: `pledge new collateral on the construction loan: Kokomo plant expansion, real estate, valued at 6,500,000`.
- "March is coming and the 15M line needs to roll" is `facility` / `renew`, one line: `renew the 15M line of credit`.

**Relationship, worked.**

- "register the Kokomo plant as an asset of the relationship, nothing pledged yet" is `relationship` / `intake`, one line: `add collateral: Kokomo plant expansion, real estate`.
- "the field exam on the receivables came back at 4.2M" is `relationship` / `valuation`, one line: `value the pledged accounts receivable at 4,200,000, field exam dated 12 September 2026`.

The two collateral rows are the pair most easily confused. Collateral pledged TO a facility is a facility modification. A collateral asset registered ON the relationship, with no pledge, is a relationship intake.
<!-- END GENERATED handoff-routing -->

### Writing the intent

1. Resolve the account. Baked borrowers: Hartwell Precision Manufacturing LLC 001bb00001I7FPNAA3,
   Piedmont Precision Components 001bb00001DLtRMAA1, Brightwater Foods Group 001SAMPLE0000BRWT,
   Sterling Fabrication Co. 001SAMPLE0000STRL, Kingsley Precision Works 001SAMPLE0000KGSL.
   Any other org relationship: call Customer360SearchAccounts (input `name`, partial) and take the
   accountId; the cockpit reads that relationship live before opening it.
2. Compose the lines in the room's own grammar, one per change, in the banker's words, e.g.
   "increase the 15M line of credit to 20M", "give the 8M equipment loan a 84 month term",
   "add a Debt Service Coverage of Borrower covenant >= 1.30 tested quarterly on the 8M equipment loan",
   "remove the Accounts Receivable covenant from the 15M line of credit",
   "add Elena Hartwell as limited guarantor on the 8M equipment loan", "add a 1% origination fee to LOC".
   Never invent a figure the source did not state; leave it out and the room will ask.
3. Pick the room and the route from the routing table above, by what the ask CHANGES. A route the
   room does not bind refuses the whole document.
4. **Resolve the target artifact FIRST.** An intent is written to one specific published cockpit,
   and writing it to the wrong one is a silent no-op: the banker's room never whispers.
   - **If this session published a cockpit**, the target is the URL **the Artifact tool returned on
     that publish**. Always. That is the room the banker is looking at.
   - **If this session did not publish one**, read `canonicalArtifactUrl` from
     `<pluginRoot>/assets/cockpit.json` and use that. Read the file; never type a URL from memory
     and never carry one forward from an older transcript.
   - If the file is unreadable and you did not publish, **stop and say so**. Do not guess a URL.
5. Write the document with the Artifact tool: action write_db, db_op set,
   url = the URL resolved in step 4, collection `intents`,
   doc_id `int-<yyyymmdd>-<slug>-<nn>`, data:
   {"accountId","accountName","room","route","lines":[...],
    "context":{"summary":"who asked for what, in one or two sentences",
               "source":{"kind":"email"|"chat"|"meeting","id"?,"subject"?,"from"?,"received"?}},
    "createdAt":"<ISO instant>","status":"pending"}
   The source is named as the source names it (never inferred from the relationship).
6. Tell the banker in ONE line what was written and that the cockpit is whispering it. Do not restate
   the figures, do not summarise the plan, and never say "I have staged": in handoff mode you staged
   nothing. `Written to the cockpit: the modification is waiting on Hartwell, open it from the
   whisper.` The cockpit moves status to opened, then done after Execute; read it back with read_db
   when asked.
Contract and worked example: design/proposals/intent-handoff-addendum.md.

### The intent shape, as the page validates it

Verified against `app/src/intent/contract.ts` (`readIntentDoc`). **Collection `intents`**, document
id free-form and treated as opaque (the convention above is ours, not a rule).

| Field | Rule the page enforces |
|---|---|
| `accountId` | REQUIRED, `^001` plus alphanumerics, 15 to 18 characters total |
| `accountName` | REQUIRED, non-empty, clipped to 200 characters |
| `room` | REQUIRED, `facility` or `relationship` |
| `route` | REQUIRED, and it must belong to the room: facility binds `modify` / `renew` / `create`, relationship binds `annual` / `covenant` / `valuation` / `rating` / `service` / `intake` |
| `lines[]` | REQUIRED, at least one usable string. At most **12** are kept, each clipped to **400** characters; a non-string entry is dropped |
| `context.summary` | optional, clipped to **600** characters |
| `context.source.kind` | `email`, `chat` or `meeting`. Anything else, or absent, reads as `chat` |
| `context.source.id` / `.subject` / `.from` / `.received` | optional, each clipped to 200 characters |
| `createdAt` | ISO instant, clipped to 200 characters |
| `status` | `pending`, `opened` or `done`. Anything else reads as `pending` |
| `productPackageId` | OPTIONAL, 15 to 18 alphanumerics. It answers the "which package?" question the room would otherwise ask; a value of another shape is ignored, and an id naming no package on the relationship binds nothing |

**Clipping never refuses; a missing or malformed REQUIRED field refuses the whole document, silently
and totally.** There is no half-read intent and no error surfaced to the banker: the cockpit simply
behaves as though the collection were empty. So an intent that never whispers is usually an
`accountId`, a `room`/`route` pairing or an empty `lines[]`, not a broken page.

**The page writes back**, to the same document: `status` (`pending` to `opened` when the room opens
it, to `done` after Execute), `openedAt` (an ISO instant) and `openedBy` (the viewer's display name,
or "the signed-in banker" when the page has no name for them). Never author those three yourself.
