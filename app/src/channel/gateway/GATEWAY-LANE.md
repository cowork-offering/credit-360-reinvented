# The backup lane: what to wrap, and where

Backlog item 9, `knowledge/projects/customer-360/COWORK-FEEDBACK-20260903.md`.

> **APPLIED 2026-09-06, on `gateway-wire`.** Everything below is the plan as it was written
> against `87c5942`, kept for the reasoning. THE LINE NUMBERS IN IT ARE DEAD: `90f9ba3` rewrote
> the files they pointed at. Where each point actually landed:
>
> | Plan | Landed in |
> | --- | --- |
> | 1. `refreshAccountDetail`, the six detail reads | `channel/openRefresh.ts` `runLane()`. `90f9ba3` DELETED `refreshAccountDetail` (it had no caller) and the open refresh is where the six reads live now. |
> | 2. `fetchActionHistory` | `channel/cockpitTools.ts`, unchanged in shape. `readActionState` is still unwrapped, for the reason the plan gives. |
> | 3. the portfolio watch | `channel/useLivePortfolio.ts`, the `ev.failure` branch, as a one-shot `callGateway` gated on `shouldFallBack`. |
> | 4. the sync sweep and the book aggregate | `channel/syncSweep.ts` (portfolio + the six details) and `book/aggregate.ts`. `pace()` stayed outside the fallback. |
> | 5. search and catalog | `book/search.ts` and `channel/catalog.ts`. |
> | the constant | `SERVERS.readBackup` in `channel/mcp.ts`; `GATEWAY_SERVER` now points at it. |
>
> TWO THINGS THE PLAN DID NOT ANTICIPATE, both from `90f9ba3`:
>
> - **The primary spends its WHOLE retry budget before the other door is tried.** `server_unavailable`
>   became self-retryable on its own code, so a wrapped read makes three attempts on Customer 360
>   and only then falls through. That is the right contract and not an accident: the common failure
>   is an idle Salesforce MCP session that re-handshakes on the second knock, and the door the
>   banker owns is the one to come back to. The backup reads as a service identity.
> - **The health line needed a state, not a flag.** `LaneState` gained `backup`, so the Salesforce
>   lane reads "Salesforce via backup 22:34 UTC" rather than "unreachable" over figures the org just
>   returned. The `via` flag the plan wanted on `LivePortfolio` was NOT added: the health line reads
>   the lane store, and a second copy of the same fact is a second thing to drift.

On 2026-09-03, 22:15 to 00:10 local, the claude.ai artifact-to-connector relay dropped its
upstream session to `api.salesforce.com/platform/mcp`. Every page call returned
`server_unavailable: request failed (502)` on four builds and both contracts. Chat sessions were
fine. The org's login log was all Success. It cleared on its own with no new login. The cockpit
had nothing to show for two hours because every read it makes goes through that one hop.

This branch adds the second hop. It does NOT wire it in: `app/src/channel/*` is owned by another
agent on `stable-open` right now, so everything here is a new file and this document is the
line-level change list for whoever merges.

## What already exists on this branch

`app/src/channel/gateway/lane.ts`, with tests in `lane.test.ts` (23 passing, `tsc --noEmit` clean):

| Export | What it does |
| --- | --- |
| `GATEWAY_SERVER` | `"Salesforce Read Backup"`, the connector's display name |
| `MIRRORED_READS` | the ten Customer 360 reads, and nothing else |
| `gatewayToolName(tool)` | `Customer360Snapshot` to `gw_Customer360Snapshot` |
| `callGateway(tool, inputs, options)` | one read through the backup; rejects `bad_request` for anything not on the mirror list |
| `shouldFallBack(failure)` | true for `server_unavailable` / `upstream_error` / `cancelled`, or a 502 / timeout in the message; false for every authz denial and for `noCapability` |
| `readWithFallback(primary, gateway, hooks)` | Customer 360 first, backup on a hop failure, result stamped `via: "gateway"` |
| `readThroughEitherLane(tool, inputs, options, hooks)` | the whole thing for one mirrored read, one line at a call site |
| `gatewayHealth()` | `gw_health`, for the health line in backlog item 10 |

The envelope is identical on both lanes. Verified live 2026-09-05 against the real Customer 360
connector: `gw_Customer360Snapshot` and `gw_Customer360Covenants` for Hartwell return
`{ content: [ { actionName, errors, expectedError, invocationId, isSuccess, outcome, outputValues,
sortOrder, version } ] }` byte for byte, key order included. All ten mirrors are byte-compatible
with the raw Apex REST answer. So `unwrapInvocable`, `unwrapInvocableOne` and every reader
downstream of them work unchanged on a backup answer.

**The connector was renamed on 2026-09-06** and now runs on the founder's own box, off any company
infrastructure and under a name that says what it is rather than who built it. `GATEWAY_SERVER` is
the one string that moved. The ELEVEN TOOL NAMES DID NOT: `gw_Customer360Snapshot` and its ten
siblings are unchanged, so `gatewayToolName`, `MIRRORED_READS` and the generated manifest below all
stand as written. The exported symbols in `lane.ts` keep their `gateway` spelling too: they name a
lane, not a host, and churning them would put a rename into every wrap site below for nothing.

## The five integration points

Line numbers are against `main` at `87c5942`. Each is a wrap, not a rewrite: the existing call
becomes the `primary` thunk.

### 1. `app/src/channel/cockpitTools.ts:71-75` — `refreshAccountDetail`, the six detail tools

```ts
  const results = await Promise.allSettled(
    DETAIL_TOOLS.map((tool) =>
      callTool(SERVERS.customer360, tool, { inputs: [{ accountId }] }, { read: true, cache: { staleTime: 15_000 } }),
    ),
  );
```

Becomes `readThroughEitherLane(tool, [{ accountId }], { cache: { staleTime: 15_000 } })`. The
settled result at line 89 then reads `r.value.value` rather than `r.value`, and `r.value.via`
is the lane to record. This is the single highest-value wrap: it is the six reads a banker opens
a relationship on.

### 2. `app/src/channel/cockpitTools.ts:234-240` — `fetchActionHistory`

```ts
  const res = await callTool(
    SERVERS.customer360,
    TOOLS.actionHistory,
    { inputs: [inputs] },
    { read: true, cache: { staleTime: 15_000 } },
  );
```

Wrap it. Keep the `inputs` object construction above it exactly as it is: the `maxResults` vs
`limit` defect (2026-09-03) is in that object, not in the call, and the backup passes the inputs
array through untouched, so an unknown invocable variable fails identically on both lanes.

Do NOT wrap `readActionState` at line 276-281. It is the poller a room waits on after an execute,
it is deliberately uncached, and it reads the trail of a write the backup did not make. A row the
banker's own session filed is Private to that banker; the backup's service identity would read a
different trail and the poller would wait forever on a row it cannot see.

### 3. `app/src/channel/useLivePortfolio.ts:79-82` — the home view's portfolio watch

```ts
    const stop = watchTool(
      SERVERS.customer360,
      TOOLS.portfolio,
      { inputs: [{}] },
```

This is the one that STUCK on 2026-09-03 (backlog item 8): a watch with no polling holds its
failure until the view remounts. `watchTool` has no fallback arm, so the wrap here is different:
in the `ev.failure` branch (line 84), when `shouldFallBack(ev.failure)` is true, fire a one-shot
`callGateway(TOOLS.portfolio, [{}])` and feed its payload through the same
`unwrapInvocableOne<Portfolio>` at line 92. Set a `via: "gateway"` flag on `LivePortfolio` so the
health line can say which door the band is showing. Leave the retract branch alone.

### 4. `app/src/channel/syncSweep.ts:203-205` and `:225-227` — the sync sweep

```ts
  const portfolio = settled(
    pace(() => callTool(SERVERS.customer360, TOOLS.portfolio, { inputs: [{}] }, { read: true, cache: { staleTime: 15_000 } })),
  );
  ...
      pace(() => callTool(SERVERS.customer360, tool, { inputs: [{ accountId }] }, { read: true, cache: { staleTime: 15_000 } })),
```

Both wrap. These are the seven reads behind the covenant-sync flake. `pace()` stays OUTSIDE the
fallback so a backup retry still costs a pacer slot: the point of the pacer is the connector
budget, and the backup rides the same relay.

`app/src/book/aggregate.ts:147-156` is the same shape (the eight-read open) and takes the same
wrap. Counting it with the sweep because the edit is character-for-character the same.

### 5. `app/src/book/search.ts:68-74` and `app/src/channel/catalog.ts:115` — search and catalog

```ts
  const res = await callTool(SERVERS.customer360, TOOLS.searchAccounts, { inputs: [input] }, {...});
  const res = await callTool(SERVERS.customer360, TOOLS.catalog, { inputs: [{}] }, { read: true });
```

Both wrap directly. `readCatalog` already returns `null` on any failure, so its wrap is pure
upside: the chip sets fall back to the shell's mirror today and would fall back to the backup
first instead.

### The constant, in `app/src/channel/mcp.ts:92-104`

Add one line to `SERVERS`:

```ts
  /** The relay-independent READ lane. Reads only: writes stay on Customer 360,
   *  where the acting identity is the banker's own. */
  readBackup: "Salesforce Read Backup",
```

`lane.ts` currently declares `GATEWAY_SERVER` itself so this branch touches no existing file. On
merge, point `GATEWAY_SERVER` at `SERVERS.readBackup` and delete the local constant. Note that
`SERVERS.gateway` is already taken by "IDB Gateway"; the key must not collide.

Do NOT add the eleven `gw_*` names to `TOOLS`. They are derived from the Customer 360 names by
`gatewayToolName`, and a second hand-maintained list is a second thing to drift.

## The capabilities entry

`client-360/assets/capabilities.json` is GENERATED. Do not hand-edit it. The source change is in
`client-360/render/capabilities.mjs`:

1. Add to the `SERVERS` map at line 39: `readBackup: "Salesforce Read Backup",`.
2. Add a key list beside `GATEWAY_KEYS` at line 48:

```js
/** The relay-independent read lane: the ten Customer 360 reads with a gw_ prefix,
 *  plus the backup's own health tool. Derived from the Customer 360 grant so the
 *  two lanes cannot drift apart. */
const READ_BACKUP_TOOLS = (manifestPath) =>
  manifestToolNames(manifestPath)
    .filter((n) => n.startsWith("Customer360"))
    .map((n) => `gw_${n}`)
    .concat("gw_health");
```

3. Add the server to `buildCapabilities()` at line 113, after the Customer 360 entry:

```js
        { server: SERVERS.readBackup, tools: READ_BACKUP_TOOLS(manifestPath) },
```

4. Regenerate and gate: `node client-360/render/capabilities.mjs` then
   `node client-360/render/capabilities.mjs --check`, and `node --test
   client-360/render/capabilities.test.mjs`.

A page published without the backup connector in `capabilities` gets `not_in_manifest` on the
first fallback call, which is exactly the failure the fallback exists to avoid. The manifest entry
is not optional.

## What must never be wrapped

The eighteen `stage_*` and `execute_*` tools, `complete_new_facility_detail`, and every memo
writeback on "Experience / nCino" and "AFS". The backup holds ONE service credential. A filing
made through it would carry the service's identity, not the banker's, and the staged-plan pattern
rests on `approverUserId` being the running human. `callGateway` refuses these by name at runtime;
`MIRRORED_READS` refuses them at the type level. Both guards are tested.
