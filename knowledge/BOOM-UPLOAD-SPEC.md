# Boom revamp: the gateway question + "Spread financials" upload — spec & contract (Fabian, 2026-09-12)

Context: Noland is revamping the Boom MCP server; Boom moves OUT of the IDB Gateway into its own
connector, and the new server can INGEST statements (upload → Boom spreads them). The cockpit is and
stays a Boom READER: Boom owns the spreading math (tools compute, never the model).

## 1. Do we still need the IDB Gateway once Boom leaves it?

What `SERVERS.gateway` serves today (grep, 2026-09-12):
| Caller | Purpose | After Boom moves out |
|---|---|---|
| `cockpitTools.ts:38-39`, `brainTools.ts:118` | Boom reads (`boom_get_ratios`, `boom_get_spread`) | → the new **Boom** connector |
| `brainLane.ts:929` (`sendThroughBridge`) | Bedrock LLM — the brain's FALLBACK rung (session Claude is first) | fallback only |
| `gatewayRestate.ts:55` | Bedrock LLM — restate assist FALLBACK (session-first since 0.9.16) | fallback only |
| `cockpitTools.ts:28` (`askCopilot`) | Bedrock LLM — the cockpit chat's FALLBACK (`askDesk` = session is first, `deskAvailable = sampleAvailable`) | fallback only |
| `HealthLine.tsx:51`, `cockpitState.ts:116` | lane-health label "Gateway" | rename/remove |

**Answer: no — once Boom has its own connector, the gateway carries nothing but a Bedrock fallback
that session Claude already supersedes everywhere.** The workrooms, the restate assist AND the cockpit
chat are all session-door-first today; the gateway is only reached when the session door is absent
(a share link, an older runtime) — and `sampleDoor` already degrades honestly there ("Working from the
file only").

**Decision proposed:** demote "IDB Gateway" from REQUIRED to OPTIONAL (keep the fallback code path,
one connector fewer for every banker to add); re-point the Boom lane to the new Boom connector; rename
the lane-health row. Remove the gateway entirely later if nobody ever needs the fallback. (Founder
2026-09-06 said gateway consolidation only after team discussion — Noland's revamp IS that discussion.)
→ run past Clawdy before the connector list changes (architectural, locks direction).

## 2. "Spread financials" — the upload flow

### The banker's experience
- A **"Spread financials"** action on the FAB / Client Actions (icon: a statement sheet with an
  up-arrow), on the relationship.
- It opens the **Spreading room** (a workroom in the cockpit register: glass, hairlines, one accent):
  a **file-drop zone** — drag PDFs / XLSX / CSV / images of financial statements, or browse.
- Each dropped file is read client-side and listed with what the room could tell: file, size, and a
  best read of **statement type** (income statement / balance sheet / cash flow / tax return / other)
  and **fiscal period** — from the text where it is extractable (XLSX/CSV/text PDF), asked of the
  banker where it is not (scanned images). The company is the anchored relationship; the room says so.
- The room **stages a spread plan** in the governed discipline: "3 statements → Boom, Hartwell
  Precision: FY2025 income statement, balance sheet, cash flow. Boom will spread them and the
  Financials here refresh from Boom when it has." Banker confirms.
- Confirm → the adapter sends each file to Boom → Boom spreads → the cockpit **re-reads**
  `boom_get_spread` / `boom_get_ratios` (the existing read path) → the Financials lane refreshes → the
  new period shows in the Boom widget, in every workroom's `spread` block, and in the memo's Boom graph.
- The dropped files are kept in the artifact's **asset store** (audit trail; re-openable), and the
  action lands in the relationship's activity trail like every governed write.

### Architecture (built NOW against a stub, so Noland's server is a mapping, not a build)
- `channel/boomUpload.ts` — ONE adapter behind an interface:
  `uploadToBoom({ company, accountId, statementType, fiscalPeriod, file: { name, mime, base64 } })
   → { documentId, spreadId?, status: "spread" | "queued" | "failed", message? }`
  Today it calls a **stub tool** (probe stub-lanes + tests) with exactly that shape; when the real
  tool lands we change the tool name + arg mapping in this one file.
- `workroom/spreadEngine.ts` + `components/workroom/SpreadingRoom.tsx` — the room (drop zone, file
  read, detection, the staged plan, confirm, progress per file, the "Boom has it / Boom is still
  spreading" states, the re-read).
- Envelope: a compact **`spread` block** in every workroom (latest 3 periods: revenue, EBITDA,
  margin, leverage, coverage, one trend word each; ~600 bytes of the ~1.9 KB headroom) so every room
  reasons on financials without a tool call; `currentBoomRatios` stays the on-demand full set.
- FAB/Client Actions: register the action with a data gate (needs an anchored relationship).
- Golden rule applies: the room knows the relationship, leads with what it detected, offers the real
  options (statement type / period chips), recommends only what is grounded (the detected period),
  one thing at a time, no loops.

### The contract to hand Noland (the only real dependency)
1. **Tool name + connector name** (e.g. connector "Boom", tool `boom_upload_statement`).
2. **Input**: `base64` content in the tool args (proposed, with a per-file cap — say 5 MB — the
   artifact-to-connector bridge is fragile on very large machine-shaped payloads) vs a URL (the
   artifact cannot host a public URL; its asset-store URLs are auth-gated). Recommend base64 + cap,
   chunking only if the cap is too low.
3. **Sync vs async**: does the call return when Boom has spread it, or a job id to poll? If async,
   a `boom_upload_status(jobId)` tool, and the cockpit polls with a bounded wait (the settle
   discipline already exists for nCino filings).
4. **How the new spread surfaces**: the period key / document id under which `boom_get_spread`
   returns it, so the re-read can confirm it landed (verification by re-query, as every write here).
5. **Idempotency**: re-uploading the same file (hash) must not duplicate a period.
6. **Errors, verbatim**: unreadable file, unsupported type, company mismatch — the room shows the
   org's own words.
7. **Identity**: per-viewer credential on the Boom connector (the banker, not a service account).

### What is already there
- Boom reads (`boom_get_spread`, `boom_get_ratios`) feed the Financials widget, the memo dossier's
  `boom` block and the `currentBoomRatios` rung-3 tool. The memo already renders the Boom graph.
- The staged-plan / confirm / verify-by-re-query discipline, the settle wait, the activity trail.
- The artifact `assets` capability for keeping the uploaded files.

### Sequence
After 0.9.18 lands (keeps file conflicts out of the current fixers): build the room + adapter + stub +
`spread` envelope block + FAB action, gated by tests and a probe scenario; hand Noland the contract in
parallel so the server is built to it. When his tools arrive: map the adapter, run the probe, ship.

## 3. The bar (founder GO, 2026-09-12) and the ONE design

Founder: "the files and information literally need to get analysed: detailed extraction and
understanding and context"; "live financials super sexy and visible"; "super super easy to use and
guided". And: **there is no Boom connector yet** (the two gateway tools today are read-only and say
nothing about what Noland is building); everything ships against the stub.

### What Boom actually does (so we do not duplicate it)
Founder, 2026-09-12: the May LWC/Apex POC was Noland's **old Salesforce-side proposal; it is not the
target and nothing is concluded from it.** The target is Noland's **read + write Boom MCP server**,
called from the cockpit as tools through the viewer's "Boom" connector like every other lane. What we
take from Boom's API is only its OUTPUT shape and status ladder, because that is what the server will
hand back. Boom's API (OpenAPI 2026-09-09, `/opt/connectry/projects/boom-spreading/docs/`) runs
files through `waiting_for_upload → processing → failed | completed → verified` and returns
`financialStatements[]` with `statementType`, `periods[] {endDate, periodType}`, `lineItems[]`
`{name, hierarchy, accountCode, flipSign, periodValues, adjustedPeriodValues {asGiven, asAllowed}}`
and account-code roll-ups; an analyst **verifies** in Boom's own page
(`POST /auth/file-validation-session/{fileId}` → URL + 60-min token). Files can be **consolidated**
into a file group with aggregated financials. `statementQuality` (cpa_audited / cpa_reviewed /
cpa_compiled / internal) is an input. Boom has no structured failure reason (tracker #14).
**Boom classifies, extracts and maps. We do not re-implement that.** The shared contract
(`app/src/spread/types.ts`) uses Boom's own enums and output shapes; the transport is OUR side of the
line: `BoomAdapter.upload(bytes + relationship + quality)` and `BoomAdapter.status(fileId)` as MCP
tool calls. Company upsert, presigned upload, process trigger and polling mechanics live inside
Noland's server and never appear in the cockpit. When his tools land, `channel/boomUpload.ts` maps
tool names + argument names, nothing else moves.

### What THIS layer does that Boom does not: the two reads around the spread
1. **PRE-READ, before anything is sent** (client-side extraction + session Claude, strict JSON):
   - what each file is (text PDF / scan / XLSX / CSV / image), how many pages, whether it has a text
     layer (a scan goes to Boom for OCR and the room asks the banker the three facts instead);
   - **whose** it is: the company name as printed vs the anchored relationship; a mismatch is an
     explicit ask ("This reads as Hartwell Holdings LLC, the parent, not Hartwell Precision. Spread
     it under the parent, or under Hartwell Precision?"), never silent;
   - **which statements** (a single annual report carries IS + BS + CF) and **which periods**
     (`FY2025`, `Q2 2026`, `TTM`), in Boom's period types;
   - **what quality**: an auditor's report → `cpa_audited`; a review report → `cpa_reviewed`;
     "prepared by management" → `internal`; proposed as the recommended chip, confirmable;
   - **what it says**, provisionally: the lines it can place on Boom's account codes, a balance-sheet
     foot check, the subtotals that do not add, units (thousands vs dollars), and the deltas against
     the period on file ("Revenue $71.2M vs $64.5M FY2024 on file, +10%"; "provisional coverage 1.18x
     against the 1.25x floor nCino carries on the term loan"). Labelled PROVISIONAL everywhere.
   The pre-read is what makes the plan a confirmation instead of a form. Golden rule: lead with what
   it found, chips for the real options, recommend only the grounded one, one ask at a time.
2. **PLAN → BOOM → POST-READ.** The banker confirms one governed plan ("3 statements → Boom, Hartwell
   Precision, FY2025 audited"). The adapter sends each file (stub today), the room shows Boom's own
   ladder per file (sending → processing → completed → verified), and when Boom has spread it the
   room re-reads and shows **the live financials panel**: the same register as the Boom Financials
   widget (KPI tiles, the trend across the on-file periods plus the new one, the IS / BS / CF tabs),
   the new period highlighted, `not_validated` vs `validated` badge, a "Verify in Boom" link, and a
   post-read in prose: what changed for this relationship, which covenant tests move, what the
   committee will ask. The Financials lane, every workroom's `spread` block and the memo's Boom
   graph refresh from the same read.

### The stub (until Noland's connector)
`channel/boomUpload.ts` exposes the `BoomAdapter` interface; the stub implementation (probe
stub-lanes) walks the real ladder with realistic timing (processing 4-8 s) and returns
Boom-shaped `financialStatements` **built from the pre-read lines** (so a real Hartwell PDF
genuinely shows its own numbers on stage) with `validationStatus: "not_validated"` and no
validation URL. `SERVERS.boom` is a new alias that defaults to the gateway name until the connector
exists; the lane-health row reads "Boom (via gateway)" until then. When the real tools arrive:
change the tool names + arg mapping in `boomUpload.ts`, run the probe, ship.

### Loading and latency (founder, 2026-09-12: "same as in our workrooms, no latency, elegant cinematic loading")
- The room opens **instantly** from the FAB: the drop zone paints on the first frame, no spinner-first
  state, no blank panel. Everything the room needs at open (the relationship, the on-file periods, the
  covenant thresholds) is already in the cockpit's book; nothing is fetched to open.
- A dropped file becomes a card immediately (name, size, kind) and the pre-read fills that card in
  place as it lands: kind → pages → statements → periods → quality → provisional read, each line
  settling in with the workrooms' paced reveal (`streamPacer` register), never all at once, never a
  modal. Lazy libraries (pdf.js, SheetJS) load on the first drop, behind the card, with a quiet
  "reading" state, not a blocking loader.
- The Boom ladder per file (sending → processing → completed → verified) is the same cinematic
  progression the filing finale uses: one row per file, the current rung lit, timing paced so the eye
  can follow (the stub processes in 4-8 s; the real server sets its own pace and the room settles on
  it with the bounded wait, showing "Boom is still spreading" honestly rather than freezing).
- The live financials panel **reveals in place** when the spread lands: tiles count up to the new
  period, the trend line extends by one point, the new column slides into the statement tabs, and
  the post-read prose streams. Last-good figures stay visible throughout; nothing flashes empty.
- Same deadline discipline as every room (`roomDeadline`): a stalled step surfaces its state and the
  next real option; it never spins forever.

### File handling
Files are read client-side (FileReader → base64 + sha256). PDF text via pdf.js and XLSX/CSV via
SheetJS, both lazy-loaded from cdnjs (the artifact CSP allows scripts from cdnjs/jsdelivr only;
nothing is fetched at build time and neither library enters the bundle). Per-file cap 5 MB, ten
files per plan. Dropped files go to the artifact asset store (audit trail); the action lands in the
relationship's activity trail like every governed write.
