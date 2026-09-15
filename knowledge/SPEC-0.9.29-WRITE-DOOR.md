# SPEC 0.9.29: the write door (a second hop for the two governed writes)

Founder, 2026-09-15, live during a presentation: "modifications are NOT WORKING ... this needs to be a
HOT FIX ... why was it working all the time before? ... lets work on this with pressure and surgical
precision." Status of this spec: decided by the orchestrator on the evidence below; open decision D-W1
for the founder.

## 1. Evidence

- 20:17 to 20:31 UTC, five attempts from a fresh artifact: `stage_loan_modification` through the
  "Customer 360" connector (Salesforce's hosted MCP dispatcher, api.salesforce.com/platform/mcp)
  answered `server_unavailable` (502) to the page within seconds, three same-key replays per attempt as
  the 0.9.24 ladder prescribes. The org staged every attempt: StageLoanModification Apex logs Success in
  451 to 735 ms; rows STG-0000000172 to 175 Staged, each modified 9 to 12 s after creation by the
  replays; plan JSON about 9 KB each. Reads on the same hop passed throughout.
- The org's answer carries the single-use decision token. It never reached the page, so the page could
  not execute; recovery from the trail gave the page the staging id but no token ("Staged as
  a8abb00001OjO9vAAF. The org records this as Staged").
- The same plan staged (2.4 s) and executed (20.7 s, relayPath self, 10 verified, 1 filed_unverified,
  version a5Fbb000000JKB7EAO) first try through the REST Actions API from the box
  (scratchpad/proof/api.sh) at 20:36 UTC.
- Same shape on 13 September (mcp.ts, "THREE ATTEMPTS, NOT TWO": a two-hour window in which every page
  call answered `server_unavailable: request failed (502)` while the same tools answered in chat).
  14 September: every founder run passed. 15 September 17:11: Blue Ridge modification passed on the same
  0.9.28 build. Nothing on the path changed between the passes and the failures.

Conclusion: the hop the page rents from claude.ai to Salesforce's dispatcher fails in windows we neither
see nor control. The fix is not a longer retry; it is a second door the page can take that we run.

## 2. Design

The gateway we already run (`/opt/connectry/projects/c360-gateway`, today "Salesforce Read Backup",
REST Actions API v62 with a refresh-token identity, ten read actions as `gw_<Action>`) gains a SEPARATE
MCP endpoint for writes, so the read URL alone can never write:

- `/<write-path-with-its-own-secret-segment>/mcp` serves ONLY `gw_<Action>` for the governed stage and
  execute pairs the cockpit calls (mapped from `app/src/channel/mcp.ts` TOOLS to the Apex invocable
  class names that exist in `knowledge/sf-build-v2/wp2/classes`), plus `gw_health`. Pass-through: the
  body is forwarded to `invokeAction` untouched and never interpreted.
- Audit line per call: tool, ip, stagingId when present, ms, status. Never the decisionToken, never the
  plan body.
- The org's gates remain the authority: plan hash, single-use token, `approverUserId` must equal the
  running identity, allowlisted transitions. The door adds no gate and removes none.
- Connector name for viewers: "Customer 360 Write Door" (optional connector; the cockpit runs without
  it exactly as today). The cockpit finds it by the tools it serves, "Customer 360 Write Door" is the
  fallback label, as the Boom lane does (0.9.28 D1).

Cockpit, inside `app/src/channel/`:

- The door ladder for any write flagged `idempotent: true` (the stage/execute pairs): Salesforce hop
  with the existing three same-key attempts; if the outcome is still `server_unavailable`,
  `upstream_error` or a lane timeout AND the write door is connected and serves `gw_<Action>`, re-send
  the SAME payload under the SAME idempotency key to `gw_<Action>`. Safe by the org's replay semantics:
  same key returns the plan the org already holds (`replayed: true`, token rotated), same token returns
  the run already made.
- Never fall to the door on an authz denial, a validation refusal, or any answer the org actually gave.
  Transport failure only.
- The result names the door that carried it (`door: "salesforce" | "backup"`) so the tracker can say
  "filed through the write door" without component changes.
- Deadlines: the ladder plus one door attempt must fit `WRITE_DEADLINE_MS`; the room's stage budget
  (`components/workroom/deadline.ts`, DEADLINES.stage = 25 s, the founder's "has not answered on staging
  this plan in 25 seconds") rises to hold the ladder plus one door attempt, arithmetic in the comment.
- Health row: the write door appears as an optional connector and says what it carries.
- Manifest: `client-360/assets/capabilities.json` grants the `gw_` write tools under the door's name;
  plugin.json lists the connector as optional with its setup sentence. The read connector's name and URL
  do not change.
- Stub lanes mirror the door's tools with the live envelope (row 52 rule) and gain an injection that
  makes the Salesforce hop answer `server_unavailable` for stage N times; a drive files a modification
  with the Salesforce hop dead and asserts the plan lands through the door, the door named on the glass.

## 3. Decision for the founder: D-W1, identity

The door runs as the connector's org identity (the refresh-token user). The org refuses an execute whose
`approverUserId` is not the running identity (A33.5.4). In the demo org the founder IS that identity, so
the door works end to end for him. For any other viewer the door would stage and then be refused on
execute by the org's own gate, which is the correct behaviour; a per-viewer door would need per-viewer
credentials on the gateway, which is a later design. State this to the founder; do not silently widen it.

## 4. Proof

Gateway: MCP initialize + tools/list on the write endpoint listing the `gw_` write tools; a live
`gw_StageDiscardVersion` against the BOOKED Hartwell package a5Fbb000000IHFJEA4 (refused NOT_A_VERSION,
writes nothing) proving the write path end to end; the read endpoint's tools/list unchanged (no write
tool on it). Cockpit: vitest for the ladder (falls to the door on 502 only; same key and payload on both
doors; no fallback on VALIDATION_FAILED or authz; door reported; deadline arithmetic); the drive scenario
above; the standard release gate. No live execute during the build.
