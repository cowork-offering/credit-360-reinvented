# Credit 360
Cowork plugin: commercial-credit relationship cockpit over the Salesforce-native Customer 360
MCP server. See RUNBOOK.md for prerequisites and install. Source repo: cowork-offering/credit-360-reinvented.

## How the cockpit opens

**One cockpit per organization, resolved per viewer.** The cockpit declares runtime capabilities
(the connectors and its store), and a page that declares them is organization-internal by the host's
rule: it can be shared inside its own claude.ai organization and never by public link. A URL
published from one organization therefore answers "artifact not found" for every seat outside it, so
no single URL can serve every viewer. `assets/cockpit.json` names one such page, as a fallback.

**The default open resolves that per viewer, and it stays instant.** "Open the cockpit", "pull up
<account>", "what needs my attention": the skill takes (1) the URL this session's own publish
returned, else (2) the most recently updated artifact titled `Credit 360 · Relationship Cockpit`
(the older `Customer 360 · Relationship Cockpit` counts too) that the viewer owns or is shared,
found with one `list` call over `scope: "all"` and verified with one `read`, else (3) the
`canonicalArtifactUrl` from `assets/cockpit.json`, and only if that reads. Steps 1 to 3 cost one
listing call and one read: no connector fetch, no assembler run, no publish, nothing uploaded. If
none of them resolves, the viewer has no cockpit yet, so the skill publishes one on the rebuild path
and tells them they can share it to their organization from the page's own Share control.

The page then refreshes ITSELF. Landing on a relationship reads it live through the viewer's own
Customer 360 connector, one lane per module. Until a lane answers, the figures on screen are the
last good ones the artifact store holds for that relationship, marked `As of <time>`; a lane that
cannot reach the org retries three times inside twelve seconds and then quietly once a minute, and
the footer's connector line names every lane's grant, its last good call and whether it is live,
stale or unreachable with which error code.

All six detail reads leave AT ONCE rather than two at a time, so a slow relay is paid once instead
of three times: measured against a 500ms relay, the sixth slice lands at 0.6s instead of 2.0s. One
`rate_limited` from the platform narrows that page session back to two in flight.

## What the page says about itself

**The connector line carries the clock.** Each lane's last round trip is on the footer in the same
faint ink, `Salesforce live 22:34 UTC · 420 ms`, and clicking a lane opens its last ten calls
with the tool each one asked for. The artifact-to-connector relay is invisible to every instrument
except the page, so this is the only place a founder can check "is it slow today" with a number.

**The page keeps a cockpit state document current** at `state/cockpit` in the artifact's own store:
the open relationship and tab, the open room, a read-only mirror of the staged plan (a count and a
stamp, never a token), the last thing filed this session, per-lane health with durations, the glass
mode and the build. A Cowork session reads it before answering anything about "this" or "here", so
"what am I looking at?" gets a real answer instead of a request to describe the screen. Written
debounced, under 8 KB, through the same guarded door every other store write passes. See the
"READ THE COCKPIT STATE FIRST" section of the cockpit skill.

**Fetching, assembling and publishing is the REBUILD path**, taken only when a banker asks for it or
when no cockpit resolves for this viewer. A rebuild does not move the canonical cockpit:
`assets/cockpit.json` is hand-edited once, when a founder blesses a new URL. What it does give the
viewer is a cockpit in their own organization, which is the only kind that opens for them. Every
publish passes `assets/capabilities.json` whole and keeps the page's favicon and title stable; no
passcode, token or secret is ever written into the page.

## Connectors this plugin needs (names must match exactly)

The cockpit page reaches Salesforce, Boom, the inbox and the memo room's two writeback systems
through the VIEWER's own claude.ai connectors, resolved by display name. Add them under claude.ai
Settings > Connectors before the first render, named exactly:

| Connector | What it is | Tools the page calls |
|---|---|---|
| `Customer 360` | The Salesforce-hosted Customer360 MCP server (custom connector, the org's External Client App consumer key AND secret, per viewer) | 28 |
| `Salesforce Read Backup` | **Optional but recommended.** A second hop serving the same ten Customer 360 READS, so the cockpit still shows live figures when the artifact-to-connector relay drops its Salesforce session; reads only, every write stays on `Customer 360` | 11 |
| `IDB Gateway` | Boom spreads and ratios | 3 |
| `Microsoft 365` | Inbox sweep | 1 |
| `Experience / nCino` | The credit-memo writeback and ledger: narrative sections, the nFORMS memo document, the approval submit, the notice, the decision and audit trail, and the deterministic covenant grade | 9 |
| `AFS` | Servicing: loan summary, payment history, revolver utilisation, and the workpackage the memo room stages at the end of a publish | 4 |

Only the read backup is optional: without it a Customer 360 outage leaves the page on its stored
last-good documents, and the footer's connector line reads "Backup not granted". With it the same
outage leaves live figures on screen and the line reads "Salesforce via backup".

A connector under any other name is invisible to the page: the badge reads offline and every
sync line fails. The plugin cannot auto-connect these, because the Customer 360 OAuth client
requires each viewer's own secret. The exact tool grant lives in `assets/capabilities.json`.
