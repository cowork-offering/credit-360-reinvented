# The read burst, measured: BEFORE (0.9.29 as shipped)

Backlog row 73. What the built page actually asks the connector for, on three gestures, with
nothing instrumented in product code.

## The finding this was written to explain

From the org's own Apex logs of the founder's live session, 2026-09-15 19:00 to 20:20 UTC, one
banker, one artifact page: **653 `Customer360*` read calls in about eighty minutes.** Opening the
cockpit at 19:17 produced **48 calls in one ten-second window and 44 in the next**, with the same
read repeated inside those ten seconds: Snapshot 8, Covenants 7, Opportunities 7,
RelationshipGraph 6, StructuralSignals 6, Exposure 6, Portfolio 5, Catalog 3. Every later
relationship open or Sync shows the same shape: 20 to 29 calls per ten seconds, each read 2 to 5
times. The Salesforce-hosted MCP dispatcher answered many of them `502 server_unavailable` from
19:00 onward, and the read backup carried **401 recovered reads** against 3 to 34 on a normal day.

## How this was measured

`design/probes/read-burst.mjs`, new for this row. It boots **the built bundle** in headless
Chromium against the stub lanes (`design/probes/lib/stub-lanes.js`), exactly as `workroom-e2e.mjs`
and `gate.mjs` do (same `serveDir`, same `assemble-artifact.mjs`, same `--book` resolution), and
then wraps the STUB's own `callTool` after it is installed. Nothing in `app/src` was touched to
take these numbers.

Each call is recorded with its phase, tool, a canonicalised hash of its arguments, its start
offset, its wall time and the JS stack at the moment of the call. A gesture ends when no new call
has been issued for 6 s.

- bundle: the 0.9.29 tree at HEAD, built to a scratch `outDir` (2,171,199 bytes, byte-identical
  build settings to `app/dist/cockpit.html`)
- book: Hartwell Precision Manufacturing LLC
- relay: `__LANES.relayMs = 200`, one artifact-to-connector round trip costs 200 ms, the same knob
  the latency probe uses (the real hop was measured at 236 to 560 ms on 2026-09-06)
- two lane conditions: **answering** (`mode: "ok"`) and **502** (`mode: "down"`, the read backup
  still granted and healthy: the founder's 19:00-onward condition)
- zero page errors in every run

**Caller attribution** comes from the same probe run against an unminified build of the same
source (`vite build --minify false`), which issues call-for-call the identical set; minification
only costs the stack its names. Where the stack is cut by the pacer's own `.then` the caller is
named from the source, and both are given below.

## Gesture 1: cold open of the cockpit (goto, worklist paints)

| | dispatcher answering | dispatcher 502 |
|---|---|---|
| distinct reads | 2 | 2 (plus their 2 backup twins) |
| total calls | **2** | **8** |
| duplicates per read (worst) | 1 | **4** (3 up the ladder + 1 backup) |
| peak calls / second | 2 | 3 |
| peak concurrent on the wire | 2 | 2 |
| span | 1 ms | 4,431 ms |

Per read, 502 condition: `Customer360Catalog` ×3 + `gw_Customer360Catalog` ×1;
`Customer360Portfolio` ×3 + `gw_Customer360Portfolio` ×1.

## Gesture 2: opening one relationship (Hartwell)

| | dispatcher answering | dispatcher 502 |
|---|---|---|
| distinct reads | 6 | 6 (plus 6 backup twins) |
| total calls | **6** | **24** |
| duplicates per read (worst) | 1 | **4** |
| peak calls / second | 6 | **10** |
| peak concurrent on the wire | **6** | **6** |
| span | 0 ms | 4,140 ms |

Twenty-four calls in 4.1 s at a peak of ten a second, for one relationship, from one banker's
single click. That is the founder's ten-second window, reproduced.

## Gesture 3: pressing Sync

| | dispatcher answering | dispatcher 502 |
|---|---|---|
| distinct reads | 9 | 9 (plus 8 backup twins; the mailbox has no backup) |
| total calls | **9** | **35** |
| duplicates per read (worst) | 1 | **4** |
| peak calls / second | 5 | 4 |
| peak concurrent on the wire | 2 | 2 |
| span | 1,601 ms | 18,622 ms |

## Who the callers are

| read | gesture | caller |
|---|---|---|
| `Customer360Catalog` | boot | `readCatalog()` (`channel/catalog.ts`) from `RelationshipRoomHost`'s mount effect (`components/relationship/RelationshipRoom.tsx`). `Workroom.tsx` has the same effect and takes `readCatalog`'s own promise cache when a room opens later. |
| `Customer360Portfolio` | boot, Sync | `read()` inside `useLivePortfolio` (`channel/useLivePortfolio.ts`) on mount and on its two-minute poll; `runSyncSweep`'s portfolio lane on Sync. |
| the six detail reads | open | `runLane` inside `startOpenRefresh` (`channel/openRefresh.ts`) through `readThroughEitherLane`. |
| the six detail reads | Sync | `runSyncSweep`'s lanes (`channel/syncSweep.ts`). |
| `outlook_email_search` | Sync | `searchMailboxRaw` ← `searchMailbox` (`channel/cockpitTools.ts`). |
| `Customer360ActionHistory` | Sync | `fetchActionHistory` (`channel/cockpitTools.ts`). |

### Which duplicates are which

- **The retry ladder, and it is every duplicate measured here.** `callTool`'s `RETRY_ATTEMPTS = 3`, and
  `server_unavailable` is retryable on its own code (`SELF_RETRYABLE`), so a 502-ing dispatcher
  turns every read into three calls. The fourth is `readWithFallback`'s second door
  (`channel/gateway/lane.ts`), one attempt through the read backup. **4 calls per read, exactly,
  and it accounts for the whole of the 8 / 24 / 35 above.**
- **React StrictMode double effects: none.** `main.tsx` renders under `<StrictMode>`, but React
  double-invokes effects only in a development build. The measured production bundle issues each
  mount effect once: one Catalog and one Portfolio at boot, one call per lane on open.
- **Keep-alive: none, in any gesture.** `startKeepAlive` first ticks at `KEEPALIVE_INTERVAL_MS`
  (4 minutes) and skips while `connectorBusy()` or while a real call warmed the session inside the
  window. No gesture here is long enough to see one.
- **Grant probes: none on this wire.** `probeConnectorGrants` uses `listTools()`, not `callTool`,
  and never issues a `Customer360*` read. `warmConnectorGrants` is off
  (`GRANT_WARMUP_ENABLED = false`).
- **Several components fetching the same thing: NOT reproduced in this harness, but real in the
  source.** Two pairs, both of which would double a gesture on the live page and neither of which
  the stub book can reach:
  - `aggregateBorrower` (`book/aggregate.ts`, via `openAccountLive` in `book/dynamicBook.ts`) reads
    eight of the same questions when the banker opens a worklist row the page has **no baked bundle
    for**, and the account view then mounts and `startOpenRefresh` reads six of them again. On the
    founder's page the live `Customer360Portfolio` read returns the org's book (up to 60 accounts)
    while the artifact bakes five, so nearly every row is one of those. The stub's Portfolio answers
    with an empty account list, so every row in this harness is staged and the path is unreachable.
    **This is the most likely source of the founder's ×8 where the ladder alone gives ×4.**
  - `readCatalog` is called from two room hosts. It memoises its promise, but a `null` answer
    (no connector, unpublished tool, a refusal) is deliberately not cached, so under the 502
    condition the second room re-reads.

## What the numbers say

The retry ladder is the measured amplifier: **one relationship open costs 6 calls when the
dispatcher answers and 24 when it does not**, and nothing in the page notices that two callers, or
the same caller twice, are asking one question. The open shows the hop **six concurrent calls**,
which is the burst the sweep's own two-in-flight pacing was written to stop on a different path.

After: `knowledge/proofs/0930-read-burst-after.md`. Rule:
`knowledge/SPEC-0.9.30-READ-COALESCING.md`.
