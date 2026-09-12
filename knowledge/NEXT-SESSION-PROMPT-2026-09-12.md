# Prompt for the fresh session (paste as the first message)

You are the Fable orchestrator on the Credit 360 cockpit plugin, picking up from a handover after
two context compactions. Read, in this order, before doing anything:

1. /opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented/knowledge/HANDOVER-2026-09-12.md
2. /opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented/knowledge/IMPROVEMENTS-AND-BUGS.md
3. /opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented/knowledge/BOOM-UPLOAD-SPEC.md (all of it, §3 especially)
4. /opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented/app/src/spread/types.ts
5. /opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented/knowledge/CHAT-GOLDEN-RULE.md

Do not re-ask anything the handover lists as decided. Do not recap the handover back to me.

Then, in this order:

A. State of the tree. From app/: run `npx tsc --noEmit` and `npx vitest run`. Report the two
   results in one line each. The working tree carries a half-finished "one context builder" refactor
   (channel/relationshipContext.ts and the files the handover §1 lists) from an agent that died with
   the old session. Do not revert it, do not commit it.

B. Spawn, in ONE message, four Opus agents in parallel, each with the hard rules below:

   P2 "Golden rule part 2": finish the one-context-builder refactor from the working tree and
      complete backlog items 9, 13, 14, 15 (specs in IMPROVEMENTS-AND-BUGS.md). Owns: app/src/channel/*
      (except boomUpload.ts and mcp.ts SERVERS/TOOLS additions), app/src/components/workroom/readBlocks*,
      app/src/components/relationship/*. Ends with tsc clean + vitest green + a written evidence report.

   S1 "Spreading room": components/workroom/SpreadingRoom.tsx + workroom/spreadEngine.ts + the FAB
      action (anchored-relationship gate), per BOOM-UPLOAD-SPEC.md §3 and the loading register there.
      Sibling of the Boom Financials widget in the glass register: drop zone → pre-read cards →
      one ask at a time with chips → governed plan → per-file Boom ladder → live financials panel
      (KPI tiles, trend, IS/BS/CF tabs, new period highlighted, verified badge, post-read prose).
      Consumes the contract in app/src/spread/types.ts; imports S2/S3 modules by the names below and
      may stub them locally until they land. New files only plus the FAB registration + CSS.

   S2 "Pre-read and post-read": app/src/spread/extract.ts (FileReader, sha256, lazy cdnjs pdf.js +
      SheetJS, scan detection, 5 MB cap), spread/preRead.ts (session Claude askSessionJson, strict
      schema, relationship context: on-file periods, covenant thresholds, obligor group,
      company-match check, statement quality proposal), spread/provisional.ts (deterministic deltas
      vs the on-file spread), spread/postRead.ts (what changed for this relationship, which covenant
      tests move). Real analysis, no mocks in the prose path. Tests for every deterministic piece.

   S3 "Boom adapter and stub": app/src/channel/boomUpload.ts implementing BoomAdapter as MCP tool
      calls through a new SERVERS.boom alias (defaults to the gateway name until the real connector
      exists; lane-health row "Boom (via gateway)"); the stub walks the real status ladder with 4-8 s
      processing and returns a Boom-shaped spread built from the pre-read (labelled provisional,
      validationStatus not_validated); probe stub-lane; tests. The real mapping is a commented block
      against the tool names we expect, so Noland's server is a one-file amendment. Nothing about
      presigned S3, process calls or polling mechanics enters the cockpit.

   Hard rules for every agent: never edit any path containing credit-memo-reinvented; the word IRIS
   never appears anywhere (the source is AFS); never edit renderMemo.vendor.mjs (derived); no build,
   no version bump, no commit, no push (the orchestrator gates and releases); no em dashes in
   user-facing sentences; sober banking voice, no marketing language; new files where possible,
   and each agent stays inside the file ownership above to avoid collisions; every agent ends with an
   evidence report (what changed, tests run with real output, what is not covered).

C. When all four return: gate them yourself (read the diffs, run tsc + vitest, run the build gate and
   report the JUSTIFY line if the soft tier prints), then release 0.9.19 with the exact chain in the
   handover §7 (STATUS.md changelog entry, plugin.json bump, commit message via a scratch file and
   `git commit -F`, push to cowork5). Tell me the version and the vitest counts, then stop and wait
   for me to pull the plugin and test.

D. Draft, do not send, the Boom contract message for Noland (GUI-level wording, from
   BOOM-UPLOAD-SPEC.md §2 + §3 and types.ts) and show it to me.

Keep the backlog current as work lands. Save decisions and corrections to the brain immediately.
Verify in code before asserting anything about how the cockpit behaves.
