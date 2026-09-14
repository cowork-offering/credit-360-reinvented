# SPEC 0.9.28: the Boom lane (new Boom MCP server in, IDB Gateway out)

Founder, 2026-09-14: "later today we will include the new boom server and exclude the idb gateway
completely but lets do it step by step." Inventory taken read-only on 2026-09-15 after 0.9.27; every
claim below carries a file:line. Nothing here is built yet.

## 1. Where "IDB Gateway" lives today

Connector name: `app/src/channel/mcp.ts:96` (`gateway`) and `:121` (`boom`), deliberately the same
string (doctrine `mcp.ts:112-120`); `HealthLine.tsx:43,51,62,63` folds the two into one row "Boom (via
gateway)" and only splits once the strings differ; `design/probes/drive-boom.mjs:53`. Call sites already
on `SERVERS.boom` (no change): `cockpitTools.ts:38,39`, `brainTools.ts:118`, `grantWarmup.ts:126`,
`boomUpload.ts:166-240`.

Tool contract: `mcp.ts:234-237` names four stub tools (`boom_upload_statement`, `boom_upload_status`,
`boom_create_file_group`, `boom_validation_session`); `mcp.ts:158,159` carry the two live reads under
the gateway prefix `boom-mcp-js___boom_get_ratios` / `___boom_get_spread`, declared again in
`client-360/assets/capabilities.json:56,57`. The mapping Noland's server amends is written at
`boomUpload.ts:42-95`, arg builders `:105-121`, lane flag `BOOM_UPLOAD_LANE` `:133`.

Operator text: `ActionsPanel.tsx:204`, `KpiBand.tsx:288`, `ChatPanel.tsx:182,188,630`,
`modifyEngine.ts:940`; tests `cockpitChat.render.test.tsx:196`, `unreachableBanner.render.test.tsx:78`,
`chatFallback.audit.test.ts:82`, `boomUpload.test.ts:563,586`. Provisional wording:
`SpreadingRoom.tsx:107,122,347` (`provenance: lane === "live" ? "boom" : "stub-provisional"`).

Stub: `design/probes/lib/stub-lanes.js:76-87, 97, 254-269, 812-881`; cockpit-side stub adapter
`boomUpload.ts:143` (`SPREAD_STUB_PROCESSING_MS [4000, 8000]`), `:408` (synthesised
`aggregatedFinancials`); `drive-boom.mjs:44-53, 90, 106` (not in the gate matrix; standalone assertion).

Docs that ship: `client-360/.claude-plugin/plugin.json:5,49,53`, `client-360/README.md:70`,
`RUNBOOK.md:9,37`, `skills/workroom-brain/SKILL.md:3,171`, `skills/credit-360-cockpit/SKILL.md:237,314,
400,730,748`, `agents/credit-memo.md:51,78,131,180`, `app/src/data/contract.ts:31,107-113,625`.

## 2. What the Boom MCP server serves (`boom-mcp/src/tools.js`, 16 data tools + 3 widgets)

`boom_lookup_company`, `boom_list_companies`, `boom_find_company`, `boom_ensure_company`,
`boom_list_files`, `boom_get_file`, `boom_get_spread {fileId, adjusted?}`, `boom_get_ratios {fileId? |
salesforceRecordId? | externalUniqueId? | companyName?, adjusted?}`, `boom_open_verification {fileId}`,
`boom_create_upload`, `boom_upload_bytes` (3 MB base64 cap), `boom_upload_from_url`, `boom_process_file`,
`boom_await_file {fileId, maxSeconds<=25}`, `boom_create_file_group {}`, `boom_get_file_group`; widgets
`boom_show_workspace`, `boom_show_spread`, `boom_show_upload`. Server identity `boom-mcp`; the connector
DISPLAY NAME is not fixed in source (the viewer adds it by name in claude.ai; the cockpit must match it).

Against the cockpit's four names: `boom_upload_statement` MISSING (server path is ensure_company ->
create_upload -> upload_bytes | upload_from_url -> process_file, four calls); `boom_upload_status` split
into `boom_get_file` (status) + `boom_get_spread` (statements), `boom_await_file` blocking; bodies come
inside `envelope(mode, {file:{}} | {spread:{}})` so `readResult` (`boomUpload.ts:163-193`) needs the
unwrap; `boom_create_file_group` exists but takes `{}` (cockpit sends `companyExternalUniqueId`);
`boom_validation_session` is `boom_open_verification`, same in/out.

Ratios: the server DERIVES them on read (`boom-mcp/src/ratios.js:61 deriveRatios`, `raw` +
`support.lines/method`), so the cockpit's `raw`-verbatim contract (`contract.ts:107-113`) and the one
coverage definition (`spread/coverage.ts:1-36`, operating profit over interest expense) hold; the public
Boom API itself has no ratio surface (Boom's Financial Analysis tab is not exposed; ask Boom).

## 3. The long poll

Room: `spreadEngine.ts:80` polls every 1.2 s with `SETTLE_BUDGET_MS = DEADLINES.execute` = 45 s
(`deadline.ts:44,49`), stall copy names "45 seconds" (`:1076`), re-arms (`:1081`). Server:
`boom_await_file` blocks at most 25 s by design (`tools.js:20-22`). Real Boom took over six minutes on
an 8 KB xlsx (e2e loops await to 6 min, `scripts/mcp-e2e.mjs:58-62`). To wait across turns: repeated
bounded `boom_await_file` calls; a total-wait clock separate from the per-call deadline; the file handle
`{fileId, companyId, fileGroupId, startedAt}` persisted in `spreadSession.ts` and resumed from
`boom_get_file`; new stall copy; a stub `boom_await_file` branch honouring `__LANES.boom.processingMs`.

## 4. Ordered steps, each gate-able (gate + `node design/probes/drive-boom.mjs`)

1. Rename constants only, lane still stub: `boomValidationSession -> boom_open_verification`,
   `boomUploadStatus -> boom_get_file`; mirror stub router `:268` and `:855,858,875`, `drive-boom.mjs:106`.
2. `createGroupArgs` sends `{}`; stub branch ignores the old arg.
3. Envelope unwrap in `readResult`, stub answers gain the envelope shape.
4. Replace the single upload call with the four-call ladder behind `BoomAdapter` (room and
   `spread/types.ts` untouched); stub mirrors all four incl. the sha256 file-id idempotency (`:847`)
   and the processing clock (`:881`); `drive-boom.mjs:90` sends the new bodies (its run-2 assertion
   proves a re-drop still collapses).
5. Status rung = `boom_get_file` + `boom_get_spread`; stub `:875-881`, `boomStatements` `:823`.
6. Long poll as in section 3.
7. Flip the connector name `mcp.ts:121` to the exact viewer-list spelling (proposed "Boom"); health row
   splits by itself; `drive-boom.mjs:53`, stub lane doc `:84-86`.
8. The two reads drop the `boom-mcp-js___` prefix (`mcp.ts:158,159`, `capabilities.json:56,57`).
9. `BOOM_UPLOAD_LANE = "live"`; `SpreadingRoom.tsx:347` emits `provenance: "boom"`; `:107,122` copy goes.
10. Docs last, after a green gate: plugin.json (connector list, drop the stub-adapter sentence), README,
    RUNBOOK, both SKILL.md, credit-memo.md, the operator sentences and their three tests.

## 5. Decisions for the founder before step 1

D1 connector display name the viewers will add (proposed "Boom"; must match exactly).
D2 upload transport: `boom_upload_bytes` (3 MB cap, from the page) or `boom_upload_from_url`.
D3 the wait: cap the in-room wait (e.g. 2 minutes with a "still processing, I will keep checking"
   line and resume on re-entry) or hold the room open until Boom finishes.
D4 file groups: Boom returned "File groups require files-only mode" on this org; keep the group step
   optional until Boom enables it, or drop it.

## 6. Decisions taken (orchestrator, 2026-09-15 00:05 UTC, founder: "wire it in based on the code, surgical")

Live read from https://boom-mcp.vercel.app/headless/mcp first: `_source: BOOM-LIVE`, Piedmont linked by
Salesforce Id, files cf677dcc (verified) and 8b941a16 (completed), d6a2ecc3 still `processing` since
19:13 UTC; `boom_get_ratios.raw` equals the cockpit's bundled Piedmont ratios to the digit (leverage
3.8460068781047, coverage 2.637546468401487). Fixture: `proofs/boom-live-2026-09-15-ratios.json`.

D1 The connector is DISCOVERED by the tools it serves (`boom_get_ratios` + `boom_get_spread`), not by a
   hard-wired display name; "Boom" is only the fallback label and the operator sentence. IDB Gateway goes.
D2 Upload = `boom_upload_bytes` from the page, 3 MB cap refused in one sentence; ladder ensure_company ->
   create_upload -> upload_bytes -> process_file behind `BoomAdapter`; a re-drop reuses the existing file.
D3 Wait = repeated `boom_await_file` (20 s) inside a 2 minute in-room budget, one re-arm with "Boom is
   still processing; I will keep checking", handle persisted in spreadSession, resume from `boom_get_file`.
   `verified` and `completed` are ready; `failed` ends with Boom's own reason.
D4 File groups skipped (Boom refuses them on this org); adapter seam kept.
Build: agent C1 (0.9.28); the stub mirrors the live envelope exactly (row 52 rule); docs last.
