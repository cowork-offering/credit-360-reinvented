# SPEC 0.9.30: the read seam

**One page, one in-flight read per question. A hosted hop is a shared resource.**

Backlog row 73. Evidence: `knowledge/proofs/0930-read-burst-before.md` and
`knowledge/proofs/0930-read-burst-after.md`. Code: `app/src/channel/mcp.ts`. Tests:
`app/src/channel/readCoalescing.test.ts`.

---

## Why there is a rule

The founder's live session on 2026-09-15, 19:00 to 20:20 UTC, put **653 `Customer360*` reads**
through the org from ONE banker on ONE page. Opening the cockpit cost 48 calls in a ten-second
window and 44 in the next, with Snapshot asked eight times and Covenants seven, all for one
relationship, all inside ten seconds. The Salesforce-hosted dispatcher was answering 502 and the
read backup carried 401 recovered reads against 3 to 34 on a normal day.

Whatever the dispatcher's own limits are, the burst was the page's. Nothing in it knew that two
callers, or the same caller twice, were asking one question, and the three-attempt retry ladder
multiplied every failed read by three.

---

## The rule

### 1. A question is `(server, tool, canonical args)`

Canonical means field order does not matter: `{a, b}` and `{b, a}` are one question.

### 2. Every concurrent caller of one question shares ONE promise

It carries the retry ladder **once**, takes the write door **once** where that applies, and marks
lane health **once**. Three callers of a failing read cost three attempts, not nine, and leave one
row on the health line, not three.

### 3. A caller arriving inside a short window after it settled is handed the same answer

**The window is five seconds.** It is the page's own number twice over:

- it is `SYNC_COOLDOWN_MS`, where the cockpit already tells the banker that a second ask this soon
  "can only return what the first just fetched";
- it is a third of the `staleTime: 15_000` every detail read already declares, so the window can
  never serve an answer older than the caller had already said it would take from the platform's
  own cache.

A **failure** is an answer for the window too. The ladder has been climbed once on that question;
a second caller a second later climbing it again is the amplifier. Five seconds sits well inside
the open refresh's own sixty-second background knock, so nothing that recovers on its own is held
back.

### 4. Three ways a caller says "go and look", and the window answers for none of them

| the caller passes | means |
|---|---|
| `cache: false` | do not serve me a stored answer. Shares a call still IN FLIGHT (that is the same live round trip) and is never served from the window. |
| `cache: { refresh: true }` | the same thing, said to the platform's store. Treated identically. |
| `fresh: true` | honour the platform's `staleTime`, but not the page's window. **The Sync sweep sets this and nothing else does**: `force` on that sweep means the banker asked and every lane goes and looks. |

An answer a forced read produces is a fresh one, and is shared with whoever asks next.

### 5. A write is never coalesced

Two stage calls under one key are the ORG's fence to hold, not the page's, and collapsing an
execute into another caller's execute would hand a banker somebody else's decision token.

### 6. A call that carries an abort signal is its own

`channel/boom.ts` passes one on the ratios read. One caller's abort must never cancel the read
another caller is waiting on, so a signalled call is not coalesced.

### 7. The Salesforce hop is shown at most FOUR reads at once

Customer 360 and the Salesforce Read Backup are counted **together**: they ride the same
claude.ai artifact-to-connector relay and the backup only ever carries the primary's overflow, so
what the dispatcher session sees is the sum.

Four, and why:

- the sweep has been paced at **two** in flight since the founder saw random lines reporting the
  customer briefly unreachable on a nine-call burst;
- the open goes **six** wide on the 2026-09-06 measurement that six reads answer together for
  nearly the price of one;
- both numbers were set for a page whose reads were each issued once, and neither was set for the
  ladder: a six-wide open becomes twenty-four calls the moment the dispatcher starts refusing
  (measured, before-proof, gesture 2).

Four is the widest that keeps one open's six DISTINCT reads inside two waves while never showing
the dispatcher more than four concurrent sessions, and it is twice the width the sweep has run at
happily since that burst was diagnosed. **Measured cost: 217 ms at a 200 ms relay**, paid by the
last two reads the pacer launches, never by the four the account view opens on.

The cap is spent **per attempt**, not per call: a read sleeping between rungs of the ladder holds
no slot. The queue is FIFO and a released slot is handed to the next waiter rather than reopened,
so a call arriving mid-release cannot jump the queue.

### 8. Reads only, and never a write

A governed write queued behind a wave of reads is a banker watching a spinner while the page
re-reads figures it already has. The two governed writes take no slot and go straight out.

### 9. Lanes that are their own hop are not rationed against the Salesforce one

Microsoft 365, Boom and the memo connectors (Experience / nCino, AFS) have their own hops. Nothing
about this cap reaches them.

---

## What this does not change

- The retry ladder itself: three attempts, `server_unavailable` retryable on its own code, the
  read backup as the second door. One caller's failing read still costs four calls, and should.
- Every deadline: `READ_DEADLINE_MS` still bounds one attempt and only the round trip. Queue time
  belongs to the caller's own lane deadline (`OPEN_LANE_DEADLINE_MS`, `LANE_DEADLINE_MS`), which is
  where a page that is waiting too long is supposed to say so.
- Lane-health semantics: what changes is only that a coalesced failure marks the lane once.
- The open's own width (`OPEN_MAX_IN_FLIGHT = 6`). The open still ASKS for six on the one gesture;
  the hop is shown four at a time.

## The test seam

`__resetReadSeamForTests()` puts the seam back the way a fresh page finds it. It is page-session
state and a suite is many page sessions, so `app/src/test-setup.ts` calls it before every test in
the suite rather than two hundred files doing it themselves.
