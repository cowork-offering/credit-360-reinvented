# Intent handoff, and the dynamic book

Addendum to the Credit 360 cockpit. Two features, one door: a conversation that
happened somewhere else becomes work already typed into the right room, and the
book is no longer the five relationships the snapshot baked.

Written for two readers: the Claude session that WRITES an intent, and the
integrator who publishes the artifact.

---

## Part A. Writing an intent

An intent is one document in the artifact's own store. Any Claude session with
the Artifact tool's `write_db` can author one against the published artifact.

**Which artifact.** An intent reaches exactly one published cockpit, and a
document written to any other one is a silent no-op: the store accepts it and no
room ever whispers. So the writer resolves the target before it writes.

| the writing session | the URL to write to |
|---|---|
| published a cockpit this run | the URL the Artifact tool RETURNED on that publish. That is the room the banker has open |
| did not publish | `canonicalArtifactUrl` in `client-360/assets/cockpit.json`, READ at write time |
| did not publish, and cannot read that file | nothing. Stop and say so; a guessed URL is worse than no intent |

The canonical URL lives in plugin config rather than in prose precisely because
prose copies of it went stale in five places at once. Republishing the canonical
cockpit to a new URL is a one-line change to that file.

**Collection:** `intents`
**Document id:** a ULID-ish string the writer chooses. Opaque to the cockpit;
make it sortable if you want, nothing reads it as a time.

### The document

| field | type | required | notes |
|---|---|---|---|
| `accountId` | string | yes | Salesforce Account Id, e.g. `001bb00001I7FPNAA3`. 15 to 18 alphanumerics after the `001` prefix. A document naming anything else is not an intent. |
| `accountName` | string | yes | As the org names the relationship. Rendered verbatim. |
| `room` | `"facility"` \| `"relationship"` | yes | Which of the two unified rooms. |
| `route` | see below | yes | Must belong to the named room. |
| `lines` | string[] | yes | Banker-language instructions in the room's own grammar, ONE PER CHANGE. At least one; at most 12; each clipped at 400 characters. |
| `context.summary` | string | yes | One or two sentences: what was said, and by whom. Clipped at 600. |
| `context.source.kind` | `"email"` \| `"chat"` \| `"meeting"` | yes | Anything else falls back to `chat`. |
| `context.source.id` | string | no | The message id, for the audit trail. |
| `context.source.subject` | string | no | |
| `context.source.from` | string | no | As the source names the sender. Never inferred from the relationship. |
| `context.source.received` | string | no | Display text, e.g. `26 Jul 2026`. The cockpit prints it, it never parses it. |
| `createdAt` | string | yes | ISO instant. The watch orders on this, newest first. |
| `status` | `"pending"` \| `"opened"` \| `"done"` | yes | Write `pending`. The cockpit moves it. |
| `openedAt` | string | no | Written by the cockpit. |
| `openedBy` | string | no | Written by the cockpit (display name). |

**Routes by room.**
`facility`: `modify`, `renew`, `create`.
`relationship`: `annual`, `covenant`, `valuation`, `rating`, `service`, `intake`.

`intake` is the sixth and the only one that AUTHORS: it puts a covenant or a
collateral asset onto the relationship, each with its account junction, neither
one touching a facility. Its lines carry the whole instruction because its first
question takes them whole, for example
`add a relationship covenant: minimum liquidity of 5M tested quarterly` and
`add collateral: two Haas VF-4SS machining centres`. The write arm behind it,
`stage_relationship_intake` / `execute_relationship_intake`, is built to a frozen
contract and is NOT deployed as this is written: an intent naming `intake` opens
the room and drives the elicitation, and the confirm gate reports the tool as
unavailable until the definition deploys.

A relationship route on a facility document (or the reverse) is refused. Silently:
a malformed document is not half-read and the cockpit behaves as though the
collection were empty.

### Worked example

```json
{
  "accountId": "001bb00001I7FPNAA3",
  "accountName": "Hartwell Precision Manufacturing LLC",
  "room": "facility",
  "route": "modify",
  "lines": [
    "increase the 15M line of credit to 20M",
    "add a Debt Service Coverage of Borrower covenant >= 1.30 tested quarterly on the 8M equipment loan",
    "add a 1% origination fee to LOC"
  ],
  "context": {
    "summary": "James Hartwell asked to take the revolver to $20M, add a DSCR test on the equipment loan and price a 1% origination fee.",
    "source": {
      "kind": "email",
      "id": "AAMkAGI2...",
      "subject": "Line increase and covenant",
      "from": "james@hartwellprecision.com",
      "received": "26 Jul 2026"
    }
  },
  "createdAt": "2026-09-02T18:04:00.000Z",
  "status": "pending"
}
```

Written with the Artifact tool:

```
action: "write_db", db_op: "set",
url: "<the URL resolved by the table above>",
collection: "intents",
doc_id: "01J8ZQ5K9T2M4XQ7YB3C1",
data: { ...the object above... }
```

### Writing lines the room can take

The lines go through the room's OWN composer. Everything the banker can type,
you can write; nothing else. Write ONE CHANGE PER LINE — the room takes one
decision at a time, and a three-part sentence is the case its own multi-clause
lane exists to catch. Name the facility the way the book does (`the 15M line of
credit`, `the 8M equipment loan`) so the qualifier filter can resolve it.

A line the room cannot parse is refused OUT LOUD in the thread and the feed
carries on. That is the correct outcome; do not compensate by writing looser
lines.

---

## Part B. What the cockpit does with it

1. **The watch.** `intents` where `status == "pending"`, ordered `createdAt`
   descending, limited to 20, over `onSnapshot`. An intent written while the
   banker is looking at the landing arrives on its own.
2. **The whisper.** A glass chip in the FAB's corner, in the room's own
   language: *"An intent for Hartwell from the mail of 26 Jul 2026: ... Open the
   modification?"* with **Open** and **Later**. It speaks on the landing and on
   the relationship it names, and nowhere else.
3. **Open.** The intent is stamped `opened` (with `openedAt`, `openedBy`); the
   cockpit navigates to the relationship by the same name flight the worklist
   row uses; the named room opens through its own opener with the route BOUND;
   the lines are staged on the feed.
4. **The feed.** Each line goes through the room's `say` — the same parser, the
   same brain lane, the same refusals. The queue only advances when the room is
   holding NOTHING: a staged card, an open check, a set of chips, a pricing
   question or a flow in flight all stop it where it stands until the banker
   settles it.
5. **The greeting.** `context.summary` and `context.source` ride the envelope in
   the same block the client's mail travels in, with `source: "intent"`, so the
   room's opening sentence names where the work came from. It is not a mailbox
   read and never claims to be one.
6. **Done.** Executing the plan sets `status: "done"`.
7. **No store, no lane.** With `claude.use("db")` resolving null — or with no
   pending intent — nothing subscribes, nothing renders, and every surface is
   byte-identical to the cockpit without this feature.

### Debugging

`window.c360Intent()` in the console prints the pending intents and the consumed
one. It prints; it opens nothing and writes nothing.

---

## Part B2. The dynamic book

The cockpit no longer holds only the relationships the snapshot baked.

**The search.** The command palette calls `Customer360SearchAccounts` as the
banker types, debounced at 280ms, past three characters, and only where there is
a connector. Matches render as `Open <name>` rows, kind **Org**, under the staged
clients; a relationship already in the book keeps its one row. The landing
carries one line on the worklist head, `Open any relationship by name`, which
opens the same palette.

**The reads.** Picking a match runs the eight reads the sync sweep runs, at the
sweep's own pacing (`createPacer`: two in flight, spaced) — `Customer360Snapshot`,
`Exposure`, `Covenants`, `Opportunities`, `StructuralSignals`, `Portfolio`,
`ActionHistory`, then `RelationshipGraph`. The graph is the slow one and it goes
LAST on purpose: the room opens on the seven that landed and the graph fills in
behind it. A read that does not come back leaves its slice ABSENT — never
guessed — and the relationship is named in `missing`.

**The bundle.** Exactly the shape `artifact/live-data.json` stores under
`borrowers.<accountId>`. `snapshot.productPackageId` is derived the way
`scripts/anchor-snapshot-packages.mjs` derives it: the distinct
`productPackageId` over the facilities, and only where there is precisely one.
Zero or several leaves the anchor absent and the rooms ask.

**The registration.** One merge point, in `AppProvider`: `mergeDynamicBook`
folds the live relationships into `borrowers`, `portfolio.accounts` and, where
the org staged its own worklist, the candidate list. It returns the SAME data
object when nothing has been read live, so `resolveBundle`, the worklist, the
palette, the workspace and both rooms pick a live relationship up without any of
them learning a second way to find a bundle, and a cockpit standing on the baked
five is byte-identical to the one before this feature.

The row is marked **`live read, HH:MM`** in the queue. It is not in the baked
snapshot and it does not pass itself off as one.

**The cache.** `books/<accountId>` in the artifact's own store, with `storedAt`.
A re-open is instant off the cache and refreshes behind itself; a document that
serialises over 200 KB is not cached (the store's own cap is 256 KiB) and is
simply re-read. Cached content is UNTRUSTED like everything else the store
returns: a document that is not a bundle is a cache miss, never a half-read one.

**Intents reach outside the book too.** An intent naming a relationship the
snapshot never baked reads it FIRST, with the progress line in the whisper's
corner: `reading Bright Horizon Health: 8 reads, 3 done`. The room opens on the
result. Where the org has nothing readable, nothing opens and the chip says so.

---

## Part C. Publishing the artifact

The capabilities declaration for the published cockpit. It is **generated**, not
maintained here: `client-360/assets/capabilities.json`, written by
`node client-360/render/capabilities.mjs` from the org's own `Customer360`
McpServerDefinition plus `app/src/channel/mcp.ts`, and gated against drift by
`node client-360/render/capabilities.mjs --check`.

**Read that file and pass it verbatim on every Artifact publish and every
replace.** The block below is a copy for the integrator to read; the file is the
one to pass.

```json
{
  "mcp": {
    "servers": [
      {
        "server": "Customer 360",
        "tools": [
          "Customer360Snapshot",
          "Customer360RelationshipGraph",
          "Customer360Exposure",
          "Customer360Covenants",
          "Customer360Opportunities",
          "Customer360StructuralSignals",
          "Customer360SearchAccounts",
          "Customer360Portfolio",
          "stage_collateral_valuation",
          "execute_collateral_valuation",
          "stage_service_request",
          "execute_service_request",
          "stage_annual_review",
          "execute_annual_review",
          "Customer360ActionHistory",
          "stage_new_facility",
          "execute_new_facility",
          "stage_risk_rating_review",
          "execute_risk_rating_review",
          "stage_covenant_review",
          "execute_covenant_review",
          "stage_loan_modification",
          "execute_loan_modification",
          "stage_renewal",
          "stage_relationship_intake",
          "execute_relationship_intake",
          "Customer360Catalog",
          "complete_new_facility_detail"
        ]
      },
      {
        "server": "IDB Gateway",
        "tools": [
          "boom-mcp-js___boom_get_ratios",
          "boom-mcp-js___boom_get_spread",
          "idb-bg-api-target-get-llm-response-staging___get_llm_response"
        ]
      },
      {
        "server": "Microsoft 365",
        "tools": [
          "outlook_email_search"
        ]
      }
    ]
  },
  "sample": {},
  "db": {}
}
```

Counts: **Customer 360 28 tools, IDB Gateway 3, Microsoft 365 1**, plus `sample`
and `db`.

The Customer 360 grant is the org manifest ENTIRE, in the org's own order.
Trimming it to the call paths the current bundle happens to reach is how it went
short before: the guided skills route the writes the cockpit itself never calls,
and a tool outside the published manifest is refused `not_in_manifest` at the
moment a banker confirms a plan. Passing a non-empty `capabilities` object is a
FULL-SET declaration, so anything stored and not restated is revoked.

`db` is what makes the artifact organization-internal: every reader and writer is
a signed-in member of the owner's organization. That is the correct posture for a
cockpit carrying a bank's book, and it is what makes the intent lane safe to
leave on.

Omit the manifest and the room opens **offline**: `claude.use("mcp")` resolves
null, the sync chip reads `offline · R1 no grant`, the intent lane never
subscribes so no whisper ever arrives, and every governed action is refused
before it reaches the org.
