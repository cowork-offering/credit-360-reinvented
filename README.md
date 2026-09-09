# Credit 360

Credit 360 is a relationship-level commercial-credit cockpit for C&I bankers, drivable from Cowork
chat. It opens on a worklist rather than a search box: the handful of relationships that need
something today, each with the reason it is there. From a relationship you get three workrooms, the
facility room, the relationship room and the credit memo room, and every write they produce is
staged first and confirmed by a named human before it reaches the bank's systems. Nothing on the
page is simulated: it reads live from Salesforce (nCino and FSC), Boom, AFS and the banker's inbox
through the viewer's own connectors, and says on the footer which lane is live, which is stale and
which is unreachable.

## Install in Cowork

1. Add the marketplace: `https://github.com/cowork-offering/credit-360-reinvented`.
2. Install the plugin **Credit 360** from it.
3. Add the connectors below before the first open. The page resolves them by display name, so it
   cannot see them until they exist under the viewer's own account.

Cowork does not refresh a marketplace it has already added. A new version therefore arrives as a
new repository URL from the engagement team, added as a new marketplace, rather than as an update to
the one already installed.

## Connectors you must add first

Added in claude.ai under Settings > Connectors, by each viewer, under their own identity.

| Display name | Required | What it serves | Endpoint | Auth |
|---|---|---|---|---|
| `Customer 360` | required | Every relationship read and every governed nCino write, run as the signed-in banker. 28 tools | `https://api.salesforce.com/platform/mcp/v1/sandbox/custom/Customer360` | OAuth, the org's External Client App consumer key and secret, per viewer |
| `Salesforce Read Backup` | optional | A second hop serving the same ten Customer 360 reads, so live figures survive a dropped relay session. Reads only. 11 tools | `https://banksy.claudeeshannon.com/sf-read-backup-c70d4163d3/mcp` | none, demo-grade |
| `IDB Gateway` | required | Boom spreads and ratios behind the Financials tab, plus the gateway's own LLM call. 3 tools | provided by the engagement team | provided by the engagement team |
| `Microsoft 365` | required | The banker's inbox, where a client request enters the cockpit. 1 tool | first-party claude.ai connector, no URL to enter | the viewer's own Microsoft work account |
| `Experience / nCino` | required | The credit memo writeback and ledger: narrative sections, the nFORMS memo document, the approval submit, the notice, the decision and audit trail. 9 tools | provided by the engagement team | provided by the engagement team |
| `AFS` | required | Servicing reads (loan summary, payment history, revolver utilisation), the servicing workpackage, and the rating and PD source. 4 tools | provided by the engagement team | provided by the engagement team |

The names have to match exactly, slashes and spaces included. A connector added under any other name
is invisible to the page: its badge reads offline and every sync line for it fails. Only the read
backup is optional. Without it, a Customer 360 outage leaves the page on its stored last-good
figures and the connector line reads "Backup not granted"; with it, the same outage leaves live
figures on screen and the line reads "Salesforce via backup".

## First run

Type:

```
Open the Credit 360 cockpit
```

The open is one file read. The session hands over the canonical published cockpit and nothing is
fetched, assembled or published to answer it. The page then refreshes itself: landing on a
relationship reads it live through the viewer's own connectors, one lane per module, and each baked
figure is replaced as its own read lands. Until a lane answers, the figures on screen are the last
good ones the artifact store holds, marked `As of <time>`. The health line at the foot of the page
carries the clock, one entry per lane with its last round trip and its state, and clicking a lane
opens its last ten calls with the tool each one asked for.

## What you can do

**The worklist.** The landing is the needs-action queue under the heading `Needs action`, one row per
relationship with the reason code that put it there. It is not the whole book: "Open any relationship
by name" beside the heading searches the org for the rest.

**The client page.** Seven tabs: Activity, Exposure & Collateral, Covenants, Relationship Graph,
Opportunities, Structural Signals, Financials. Activity is first and carries the audit trail of what
was staged, executed and filed against that relationship.

**The facility room.** Modification, renewal, and new facility. A new facility always creates a new
Product Package: the plan makes one before it files the facility, named the way nCino's own wizard
names it. The one exception is a package that is still before approval and carries nothing booked,
which the banker may choose instead. A booked package never takes new money.

**The relationship room.** Annual review, covenant review, collateral valuation, risk rating review,
service request, and relationship intake. The covenant review is package-scoped and bulk: N
covenants, one plan, one confirmation, one decision token, N assessments written and verified
individually.

**The credit memo room.** Draft, steer, attest, publish. The draft renders section by section, a
steer queues behind the work already running, each section is attested by the banker, and the publish
writes back through `Experience / nCino` and stages the servicing workpackage in AFS.

**Chat whisper.** An email, or a sentence typed in the main chat, becomes an intent the cockpit picks
up in the room that owns it, rather than a write staged out of the conversation. The room stages it
where the banker can watch it happen.

## How writes are governed

Every write follows one discipline, with no exceptions and no fast path:

1. **Stage.** The org computes a plan. Staging performs zero domain DML.
2. **Present.** The plan and the org's own warnings are shown verbatim, never paraphrased and never
   softened.
3. **Confirm.** A named human confirms. Nothing executes without that confirmation.
4. **Execute.** Exactly five fields go back: `idempotencyKey`, `stagingId`, `planHash`,
   `decisionToken`, `approverUserId`. The decision token is single-use and bound to the running
   identity, and the approver must equal that identity.
5. **Verify.** The result is re-queried from the org and reported per record.

## Data and systems

- **Salesforce, nCino and FSC** through the `Customer 360` connector: the org-hosted Customer360 MCP
  server, per-user OAuth, 28 tools (10 reads, 8 stage/execute write pairs, a second-hop completion
  tool and one stage-only renewal). Package-level rollups exist only in these tools and are never
  derived by summing loans.
- **Boom** through `IDB Gateway`: spreads and ratios, the spreading system of record behind the
  Financials tab.
- **AFS** for servicing (loan summary, payment history, revolver utilisation, the workpackage), and
  as the rating and PD source.
- **Microsoft 365** for the inbox.
- **Experience / nCino** for the credit memo writeback and the decision and audit trail.

The credit memo methodology is vendored from the Credit Memo plugin rather than reimplemented here.
Provenance, the manifest check and the rules for re-vendoring are in `app/src/memo/vendor/VENDOR.md`.

## The test book

The engagement team publishes a test book as its own artifact. Results save per test and per
relationship, so a run can be picked up where it was left and compared against the previous one.

## Versioning

The plugin carries a semantic version in `client-360/.claude-plugin/plugin.json`. Current version:
**0.9.2**. What changed, what is outstanding and what is gated by design is in
[STATUS.md](STATUS.md).

## For engineers

Monorepo layout:

| Path | What it holds |
|---|---|
| `app/` | The React cockpit, built to one self-contained `cockpit.html` |
| `client-360/` | The plugin: agent, skills, render scripts, and the shipped assets |
| `design/probes/` | The acceptance gates: rim, chaos, lane and look probes |
| `seed/` | The relationship seeding recipe and its manifests |
| `knowledge/` | Specs, handovers and the Salesforce rebuild mirror |

Release chain, in order, from the repo root. Never hand-copy a build:

```
cd app && npm run build && node scripts/release-artifact.mjs   # promote, marker-verified
cd .. && node scripts/sync-plugin-assets.mjs                   # guards client-360/ copies
node app/scripts/assemble-artifact.mjs artifact/live-data.json /tmp/c360-publish.html
# Artifact tool on /tmp/c360-publish.html WITH url: pinned to the canonical id
```

Release gates:

```
node scripts/sync-plugin-assets.mjs --check
node client-360/render/capabilities.mjs --check
node client-360/render/skill-blocks.mjs --check
node client-360/render/handoff-routing.mjs --check
node --test client-360/render/contract-checks.test.mjs
node --test client-360/render/tool-names.test.mjs
node --test client-360/render/capabilities.test.mjs
node --test client-360/render/skill-blocks.test.mjs
node --test client-360/render/handoff-routing.test.mjs
node design/probes/probe.mjs /tmp/c360-publish.html         # 0 rim violations
node design/probes/chaos.mjs /tmp/c360-publish.html         # 19 scenarios green
node design/probes/drive-lanes.mjs /tmp/c360-publish.html   # 13 scenarios, 64 assertions
```

The three probes take the assembled build path as their argument. Run bare, they gate a stale
file and report false failures.

`client-360/assets/customer-360-template.html` is generated. `scripts/sync-plugin-assets.mjs` keeps
it byte-identical to `artifact/customer-360-template.html`, and `--check` fails the release when it
drifts. Never hand-edit it.

The demo anchors are Piedmont Precision Components, Inc. (Account `001bb00001DLtRMAA1`, org
`bankinggpt`) and Hartwell Precision Manufacturing LLC (Account `001bb00001I7FPNAA3`).

## Support

The engagement team: Fabian Goetzens (Accenture), who owns the plugin, the connectors and the
marketplace hand-overs. Open an issue on this repository for anything reproducible; include the
build stamp from the cockpit footer and the connector line as shown.
