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
