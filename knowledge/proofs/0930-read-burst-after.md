# The read burst, measured: AFTER (0.9.30 read coalescing + the hosted hop's cap)

Backlog row 73. Same probe, same harness, same book, same relay, same two lane conditions as
`knowledge/proofs/0930-read-burst-before.md`. Only the bundle changed.

- probe: `design/probes/read-burst.mjs` (unchanged between runs)
- bundle: `app/dist/cockpit.html`, 2,172,403 bytes
- book: Hartwell Precision Manufacturing LLC · relay `__LANES.relayMs = 200`
- lane conditions: **answering** (`mode: "ok"`) and **502** (`mode: "down"`, backup granted)
- zero page errors in every run

## Gesture 1: cold open of the cockpit

| | answering (before → after) | 502 (before → after) |
|---|---|---|
| distinct reads | 2 → **2** | 2 → **2** |
| total calls | 2 → **2** | 8 → **8** |
| duplicates per read (worst) | 1 → **1** | 4 → **4** |
| peak calls / second | 2 → 2 | 3 → 4 |
| peak concurrent on the wire | 2 → **2** | 2 → **2** |
| span | 1 ms → 1 ms | 4,431 ms → 3,582 ms |

`Customer360Catalog` once, `Customer360Portfolio` once. Under 502 each still costs its ladder plus
one backup attempt: the ladder is the retry policy doing its job for the one caller that asked, and
coalescing has nothing to collapse because nothing else asked.

## Gesture 2: opening one relationship (Hartwell)

| | answering (before → after) | 502 (before → after) |
|---|---|---|
| distinct reads | 6 → **6** | 6 → **6** |
| total calls | 6 → **6** | 24 → **24** |
| duplicates per read (worst) | 1 → **1** | 4 → **4** |
| peak calls / second | 6 → 6 | 10 → 9 |
| **peak concurrent on the wire** | **6 → 4** | **6 → 4** |
| span | 0 ms → 217 ms | 4,140 ms → 4,284 ms |

The six are still ASKED FOR on the one gesture; the Salesforce hop is now shown four of them at a
time. The measured cost of that is **217 ms at a 200 ms relay**: one extra round trip, paid by the
last two reads the pacer launches (Opportunities and StructuralSignals), never by the four the
account view opens on.

## Gesture 3: pressing Sync

| | answering (before → after) | 502 (before → after) |
|---|---|---|
| distinct reads | 9 → **9** | 9 → **9** |
| total calls | 9 → **9** | 35 → **35** |
| duplicates per read (worst) | 1 → **1** | 4 → **4** |
| peak calls / second | 5 → 5 | 4 → 6 |
| peak concurrent on the wire | 2 → **2** | 2 → **2** |
| span | 1,601 ms → 1,601 ms | 18,622 ms → 18,980 ms |

The sweep is unchanged, deliberately. It passes `fresh: true`: the banker pressed Sync, and an
answer taken out of the page's own five-second window is not what they asked for.

## The target, line by line

| target | result |
|---|---|
| a cold open issues each distinct read once | **yes**, Catalog 1, Portfolio 1 |
| a relationship open issues each distinct read once | **yes**, 6 reads, 6 calls |
| Sync issues each distinct read once | **yes**, 9 reads, 9 calls |
| peak at or under the cap | **peak concurrent 4 on every gesture and in both lane conditions**, which is what a concurrency cap bounds. It cannot bound calls per second: four slots against a 200 ms relay issue up to twenty a second and are still four on the wire. The per-second figures are reported above as measured. |

## What this run does NOT prove, and where the proof is instead

Nothing in this harness puts two callers on one question at the same instant: the stub's Portfolio
answers with an empty account list, so every worklist row is staged and the
`aggregateBorrower` + `startOpenRefresh` overlap (named in the before-proof) cannot be reached from
the browser. The coalescing properties are pinned by `app/src/channel/readCoalescing.test.ts`
instead, against the real `callTool`:

- one promise and one wire call across concurrent callers of one question
- the same fields in a different key order are one question; different arguments are two
- a caller inside the post-resolution window costs no call; the window expires
- an uncached read (`cache: false`) shares a call in flight but is never served from the window
- the banker's own gesture (`fresh`) is never served from the window
- the ladder is climbed **once** per question: three attempts for three callers, not nine
- a coalesced failure puts **one** row on lane health and **one** unreachable verdict
- writes are never coalesced, and never queue behind the read cap
- the cap shows the hop four reads, queues the fifth and sixth, and releases them in FIFO order
- lanes that are their own hop (Microsoft 365, Boom, the memo connectors) are not rationed

## Drives

- `node design/probes/drive-boom.mjs`: OK, 6 scenarios, 43 assertions, all green.
- `node design/probes/gate.mjs --books Hartwell --scenario relationshipReviews`: see report.
- `node design/probes/gate.mjs --books Hartwell --scenario doorsOpen`: see report.
