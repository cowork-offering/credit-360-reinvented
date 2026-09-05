# Client 360 (Customer 360 Reinvented)
Cowork plugin: commercial-credit relationship cockpit over the Salesforce-native Customer 360
MCP server. See RUNBOOK.md for prerequisites and install. Source repo: cowork-offering/customer-360.

## How the cockpit opens

**The default open is one file read.** "Open the cockpit", "pull up <account>", "what needs my
attention": the skill reads `canonicalArtifactUrl` from `assets/cockpit.json` and hands the banker
that URL. No connector fetch, no assembler run, no publish, nothing uploaded.

The page then refreshes ITSELF. Landing on a relationship reads it live through the viewer's own
Customer 360 connector, one lane per module. Until a lane answers, the figures on screen are the
last good ones the artifact store holds for that relationship, marked `As of <time>`; a lane that
cannot reach the org retries three times inside twelve seconds and then quietly once a minute, and
the footer's connector line names every lane's grant, its last good call and whether it is live,
stale or unreachable with which error code.

**Fetching, assembling and publishing is the REBUILD path**, taken only when a banker asks for it or
when no canonical URL can be resolved. A rebuild does not move the canonical cockpit:
`assets/cockpit.json` is hand-edited once, when a founder blesses a new URL.

## Connectors this plugin needs (names must match exactly)

The cockpit page reaches Salesforce, Boom, the inbox and the memo room's two writeback systems
through the VIEWER's own claude.ai connectors, resolved by display name. Add them under claude.ai
Settings > Connectors before the first render, named exactly:

| Connector | What it is | Tools the page calls |
|---|---|---|
| `Customer 360` | The Salesforce-hosted Customer360 MCP server (custom connector, the org's External Client App consumer key AND secret, per viewer) | 28 |
| `IDB Gateway` | Boom spreads and ratios | 3 |
| `Microsoft 365` | Inbox sweep | 1 |
| `Experience / nCino` | The credit-memo writeback and ledger: narrative sections, the nFORMS memo document, the approval submit, the notice, the decision and audit trail, and the deterministic covenant grade | 9 |
| `AFS` | Servicing: loan summary, payment history, revolver utilisation, and the workpackage the memo room stages at the end of a publish | 4 |

A connector under any other name is invisible to the page: the badge reads offline and every
sync line fails. The plugin cannot auto-connect these, because the Customer 360 OAuth client
requires each viewer's own secret. The exact tool grant lives in `assets/capabilities.json`.
