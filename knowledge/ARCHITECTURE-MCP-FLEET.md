# Customer 360 — MCP Fleet Technical Topology

**SSoT for the HLSI "MCP fleet" diagram page.**
Status date: 2026-06-29. Grounding: TDX 2026 (Salesforce hosted MCP GA Apr 2026; Apex-`@InvocableMethod`-as-MCP-tool May 2026; Agentforce MCP client Beta Jan 2026; MCP → Linux Foundation/AAIF Dec 9 2025); nCino Analyst Digital Partner on AOS (announced Apr 16 2026, **agent, not an MCP server**).

This document defines the node inventory, the call graph, the trust seams (run-as-user OAuth, admin god-mode), the Product Package + Account spine, and the SR 11-7 deterministic-vs-narrated edge classification. A machine-readable `DIAGRAM_SPEC` JSON block at the end lets a renderer draw the SVG.

---

## 0. Reading the topology in one breath

A reasoning client (Claude / Agentforce) talks to a small number of MCP servers. Inside **one Salesforce org**, a single SF-native **Customer 360 MCP** reads both nCino (`LLC_BI__*`) and FSC (`FinServ__*`) under the *caller's own* OAuth identity — native sharing + FLS, no service account. Outside Salesforce, four source MCPs (Boom, AFS, Snowflake/Snowflake, CapIQ/IBIS) hold the heavy financial and market data. The piece that makes it safe and regulator-defensible is **experience-mcp**: it performs the cross-source **fetch + join server-side** (the regulated number is computed in code and never round-trips through the LLM), and it owns the **decision ledger + audit trail** in Snowflake. Everything keys on one spine: the **Product Package + Account**. Three surfaces render off the joined result — the Live Portfolio Dashboard, the Credit 360 cockpit, and the Credit Memo.

The single most important architectural line: **SR 11-7 deterministic compute happens in experience-mcp / source servers; the LLM only ranks and narrates. No regulated number is produced by the model.**

---

## 1. Node inventory (bands)

### Band A — Reasoning clients
| id | label | status | note |
|----|-------|--------|------|
| `client` | Claude / Agentforce (MCP client) | SHIPPED | Agentforce as native MCP client is Beta (Jan 2026); Claude clients GA. The model ranks and narrates; it never computes a regulated number. |

### Band B — Salesforce org (one auth boundary)
*One org = one trust boundary. Everything in this band authenticates through the same External Client App OAuth (scopes `mcp_api` + `refresh_token`, PKCE mandatory) and enforces CRUD/FLS/sharing via `WITH USER_MODE`. Identity is run-as-user — there is no anonymous service account, and the calling user lands in the audit trail.*

| id | label | status | note |
|----|-------|--------|------|
| `c360_mcp` | Customer 360 SF-native MCP | SHIPPED | Reads nCino + FSC in ONE org, run-as-user, native sharing + FLS. Admin god-mode gated. |
| `ncino` | nCino objects (`LLC_BI__*` managed pkg) | SHIPPED | Co-resident managed package; data reachable via the SF-native surface, NOT via an nCino-published MCP. |
| `fsc` | Financial Services Cloud (`FinServ__*`) | SHIPPED | Co-resident managed package in the same org. |
| `apex_mcp` | Apex-invoke MCP (`@InvocableMethod` → MCP tool) | FUTURE | Documented Salesforce pattern (May 2026). Drawn dotted: planned exposure of our own invocable Apex as governed MCP tools, same OAuth + `USER_MODE`. |
| `flow_mcp` | Flow-invoke MCP (autolaunched/invocable Flow → MCP tool) | FUTURE | Supported-but-thinner: listed by Salesforce, lightly documented. Dotted/speculative. |
| `ncino_mcp` | nCino-published MCP server | FUTURE | **Not announced.** nCino's Analyst Digital Partner is an AOS *agent*, not an MCP endpoint. Draw dashed/speculative only. |

### Band C — Aggregation + governance
| id | label | status | note |
|----|-------|--------|------|
| `experience_mcp` | experience-mcp (server-side join + governance tier) | SHIPPED | Does the cross-source fetch+join in code (`boomFinancials.js` calls the BOOM MCP server-side — the number never passes through the LLM). Holds the decision ledger + audit trail (Snowflake). |

### Band D — Off-Salesforce sources
| id | label | status | note |
|----|-------|--------|------|
| `boom` | Boom (financial spreading) | SHIPPED | Raw IS/BS/CF + ratios on read. Deterministic compute. |
| `afs` | AFS (servicing) | SHIPPED | `revolver_utilization`, `payment_history`, `loan_summary`, `create_workpackage`. |
| `iris` | Snowflake on Snowflake | SHIPPED | Rating, PD, covenant grades, sensitivity. Zero-copy on Snowflake. |
| `capiq` | CapIQ / IBIS | SHIPPED | Peer medians + industry benchmarks. |

### Band E — Surfaces
| id | label | status | note |
|----|-------|--------|------|
| `dashboard` | Live Portfolio Dashboard | SHIPPED | Officer/portfolio rollups. |
| `cockpit` | Credit 360 cockpit | SHIPPED | Account-spine single pane. |
| `credit_memo` | Credit Memo (credit-memo-reinvented) | SHIPPED | Deal-level surface AND a co-resident source: `cm_*` fields, `LLC_BI__Credit_Memo__c`. |

---

## 2. The spine — what everything keys on

**Product Package + Account.** Every node joins on this pair. The Account is the relationship anchor (FSC `FinServ__*` + nCino `LLC_BI__Account` view); the Product Package is the deal anchor that nCino, the credit memo (`LLC_BI__Credit_Memo__c`), AFS servicing, and Snowflake grades all hang off. experience-mcp's joins are valid only because both sides resolve to the same Product Package + Account keys. In the diagram, render the spine as a horizontal rail beneath Bands B–D that `c360_mcp`, `experience_mcp`, `credit_memo`, `afs`, and `iris` all touch.

---

## 3. Edges (call graph)

Edge `kind` legend:
- **`oauth-identity`** — run-as-user OAuth boundary crossing (PKCE, `mcp_api`+`refresh_token`, `USER_MODE` FLS/sharing). The identity seam.
- **`deterministic`** — SR 11-7 server-side compute/join. Number is produced in code, never by the LLM.
- **`narrate`** — LLM consumes already-computed values to rank/narrate. No regulated number originates here.
- **`render`** — joined/governed result drives a surface.
- **`audit`** — write to decision ledger / audit trail.
- **`god-mode`** — admin-gated elevated path that bypasses run-as-user scoping (the privileged seam; must be explicitly enabled + logged).
- **`future`** — planned/speculative edge (dotted).

| from | to | label | kind |
|------|----|-------|------|
| `client` → `c360_mcp` | reads nCino+FSC as the calling user | `oauth-identity` |
| `client` → `experience_mcp` | requests joined 360 / memo inputs | `narrate` |
| `c360_mcp` → `ncino` | `LLC_BI__*` via `WITH USER_MODE` | `oauth-identity` |
| `c360_mcp` → `fsc` | `FinServ__*` via `WITH USER_MODE` | `oauth-identity` |
| `c360_mcp` → `credit_memo` | reads `cm_*` / `LLC_BI__Credit_Memo__c` | `oauth-identity` |
| `experience_mcp` → `boom` | server-side fetch of IS/BS/CF + ratios (`boomFinancials.js`) | `deterministic` |
| `experience_mcp` → `afs` | server-side fetch of servicing facts | `deterministic` |
| `experience_mcp` → `iris` | server-side fetch of rating/PD/covenant grade | `deterministic` |
| `experience_mcp` → `capiq` | server-side fetch of peer medians | `deterministic` |
| `experience_mcp` → `c360_mcp` | pulls SF spine (Product Package + Account) for the join | `oauth-identity` |
| `experience_mcp` → `experience_mcp` | joins sources on Product Package + Account (number stays in code) | `deterministic` |
| `experience_mcp` → `ledger` (self) | writes decision + lineage to Snowflake | `audit` |
| `client` → `experience_mcp` | ranks/narrates the joined result | `narrate` |
| `experience_mcp` → `dashboard` | governed rollup drives portfolio view | `render` |
| `experience_mcp` → `cockpit` | joined 360 drives cockpit | `render` |
| `experience_mcp` → `credit_memo` | joined inputs drive the memo, write-back staged | `render` |
| `admin` → `c360_mcp` | god-mode: cross-user read, gated + logged | `god-mode` |
| `client` → `apex_mcp` | invoke `@InvocableMethod` as MCP tool (`USER_MODE`) | `future` |
| `client` → `flow_mcp` | invoke Flow as MCP tool | `future` |
| `client` → `ncino_mcp` | first-party nCino MCP (not announced) | `future` |

**Key reading of the graph:** the only edges that *produce* a regulated number are `deterministic` (Boom/AFS/Snowflake/CapIQ fetches + the experience-mcp join). Every `client →` edge into the reasoning layer is `narrate` — the LLM is downstream of the math. The `oauth-identity` edges are where the run-as-user boundary is enforced; the single `god-mode` edge is the one place that boundary is deliberately bypassed, and it is admin-gated + audited.

---

## 4. Trust seams to render explicitly

1. **Run-as-user OAuth boundary** (Band B perimeter): one External Client App, PKCE, `mcp_api`+`refresh_token`, JWT access tokens; queries run `WITH USER_MODE` so CRUD/FLS/record-sharing auto-apply to the caller. Draw as the box around Band B with the lock glyph on every `oauth-identity` edge crossing it.
2. **Admin god-mode seam**: a separate, explicitly-enabled, fully-logged path (`admin → c360_mcp`, kind `god-mode`) that reads across users. Render in a warning color, dashed-bold, with an audit tag.
3. **SR 11-7 deterministic wall**: visually separate the `deterministic` edges (into experience-mcp / sources) from the `narrate` edges (into the client). The wall is the claim "the regulated number is computed in code, the LLM never computes it."
4. **Decision ledger / audit**: experience-mcp's Snowflake ledger is the system of record for *why* a decision was made; render the `audit` self-edge prominently.

---

## 5. Status discipline (what NOT to overstate)

- **SHIPPED**: Customer 360 SF-native MCP, nCino + FSC co-residence, experience-mcp join+ledger, Boom/AFS/Snowflake/CapIQ source MCPs, all three surfaces, Salesforce hosted MCP (GA), Apex-`@InvocableMethod`-as-MCP pattern (the *pattern* is shipped; our `apex_mcp` *node* is future), Agentforce MCP client (Beta), MCP under Linux Foundation/AAIF.
- **FUTURE (dotted)**: `apex_mcp`, `flow_mcp` (thinner), `ncino_mcp` (dashed/speculative — **not announced**; nCino's offering is an AOS agent, not an MCP server).
- Do **not** draw a solid "nCino MCP server" box. Do not imply nCino publishes MCP.

---

```json DIAGRAM_SPEC
{
  "bands": [
    { "id": "clients", "label": "Reasoning clients" },
    { "id": "sf_org", "label": "Salesforce org (one auth boundary)" },
    { "id": "governance", "label": "Aggregation + governance" },
    { "id": "off_sf", "label": "Off-Salesforce sources" },
    { "id": "surfaces", "label": "Surfaces" }
  ],
  "nodes": [
    { "id": "client", "label": "Claude / Agentforce (MCP client)", "band": "clients", "status": "SHIPPED" },
    { "id": "admin", "label": "Admin (god-mode)", "band": "clients", "status": "SHIPPED" },

    { "id": "c360_mcp", "label": "Customer 360 SF-native MCP", "band": "sf_org", "status": "SHIPPED" },
    { "id": "ncino", "label": "nCino (LLC_BI__* managed pkg)", "band": "sf_org", "status": "SHIPPED" },
    { "id": "fsc", "label": "FSC (FinServ__*)", "band": "sf_org", "status": "SHIPPED" },
    { "id": "apex_mcp", "label": "Apex-invoke MCP (@InvocableMethod)", "band": "sf_org", "status": "FUTURE" },
    { "id": "flow_mcp", "label": "Flow-invoke MCP", "band": "sf_org", "status": "FUTURE" },
    { "id": "ncino_mcp", "label": "nCino-published MCP (not announced)", "band": "sf_org", "status": "FUTURE" },

    { "id": "experience_mcp", "label": "experience-mcp (server-side join + ledger/audit)", "band": "governance", "status": "SHIPPED" },

    { "id": "boom", "label": "Boom (financial spreading)", "band": "off_sf", "status": "SHIPPED" },
    { "id": "afs", "label": "AFS (servicing)", "band": "off_sf", "status": "SHIPPED" },
    { "id": "iris", "label": "Snowflake on Snowflake (rating/PD/covenant)", "band": "off_sf", "status": "SHIPPED" },
    { "id": "capiq", "label": "CapIQ / IBIS (peer medians)", "band": "off_sf", "status": "SHIPPED" },

    { "id": "dashboard", "label": "Live Portfolio Dashboard", "band": "surfaces", "status": "SHIPPED" },
    { "id": "cockpit", "label": "Credit 360 cockpit", "band": "surfaces", "status": "SHIPPED" },
    { "id": "credit_memo", "label": "Credit Memo (cm_* / LLC_BI__Credit_Memo__c)", "band": "surfaces", "status": "SHIPPED" }
  ],
  "edges": [
    { "from": "client", "to": "c360_mcp", "label": "reads nCino+FSC as calling user", "kind": "oauth-identity" },
    { "from": "client", "to": "experience_mcp", "label": "request joined 360 / memo inputs", "kind": "narrate" },

    { "from": "c360_mcp", "to": "ncino", "label": "LLC_BI__* (WITH USER_MODE)", "kind": "oauth-identity" },
    { "from": "c360_mcp", "to": "fsc", "label": "FinServ__* (WITH USER_MODE)", "kind": "oauth-identity" },
    { "from": "c360_mcp", "to": "credit_memo", "label": "cm_* / LLC_BI__Credit_Memo__c", "kind": "oauth-identity" },

    { "from": "experience_mcp", "to": "boom", "label": "server-side fetch IS/BS/CF + ratios", "kind": "deterministic" },
    { "from": "experience_mcp", "to": "afs", "label": "server-side fetch servicing facts", "kind": "deterministic" },
    { "from": "experience_mcp", "to": "iris", "label": "server-side fetch rating/PD/grade", "kind": "deterministic" },
    { "from": "experience_mcp", "to": "capiq", "label": "server-side fetch peer medians", "kind": "deterministic" },
    { "from": "experience_mcp", "to": "c360_mcp", "label": "pull SF spine (Product Package + Account)", "kind": "oauth-identity" },
    { "from": "experience_mcp", "to": "experience_mcp", "label": "join on Product Package + Account (number stays in code)", "kind": "deterministic" },
    { "from": "experience_mcp", "to": "experience_mcp", "label": "write decision + lineage to Snowflake", "kind": "audit" },

    { "from": "experience_mcp", "to": "dashboard", "label": "governed rollup", "kind": "render" },
    { "from": "experience_mcp", "to": "cockpit", "label": "joined 360", "kind": "render" },
    { "from": "experience_mcp", "to": "credit_memo", "label": "joined inputs + write-back", "kind": "render" },

    { "from": "admin", "to": "c360_mcp", "label": "god-mode: cross-user read, gated + logged", "kind": "god-mode" },

    { "from": "client", "to": "apex_mcp", "label": "invoke @InvocableMethod as tool (USER_MODE)", "kind": "future" },
    { "from": "client", "to": "flow_mcp", "label": "invoke Flow as tool", "kind": "future" },
    { "from": "client", "to": "ncino_mcp", "label": "first-party nCino MCP (not announced)", "kind": "future" }
  ],
  "spine": {
    "label": "Product Package + Account spine",
    "keys_on": ["c360_mcp", "experience_mcp", "credit_memo", "afs", "iris"]
  },
  "seams": [
    { "id": "oauth", "label": "Run-as-user OAuth (PKCE, mcp_api+refresh_token, WITH USER_MODE FLS/sharing)", "applies_to_band": "sf_org" },
    { "id": "godmode", "label": "Admin god-mode (explicitly enabled + audited)", "applies_to_edge_kind": "god-mode" },
    { "id": "sr_11_7", "label": "SR 11-7 deterministic wall: number computed in code, LLM never computes", "separates": ["deterministic", "narrate"] },
    { "id": "audit", "label": "Decision ledger + audit trail (Snowflake)", "owner": "experience_mcp" }
  ]
}
```
