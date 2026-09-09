# Interactivity Capabilities — Claude Runtimes, 2026-07-25

**Scope:** what an interactive UI surface can actually DO across Claude's runtimes today, which
mechanism Noland's shipped work uses, where the Credit 360 cockpit diverged, and the ranked
options to restore full interactivity.

**Trigger:** the 2026-07-25 live Cowork test — `window.sendPrompt` is **absent** from the Cowork
artifact runtime; the cockpit's chat FAB rendered its no-channel state. Meanwhile the credit-memo
plugin fleet demonstrably has working interactivity. This document pins down why.

**Headline:** we built the cockpit against a bridge (`window.sendPrompt`) that appears in **no
official Anthropic documentation for any artifact runtime** and is not exposed by the artifact
frame. The mechanism that provably works across our fleet is `App.sendMessage()` (wire method
`ui/message`) from the **MCP Apps** standard — available only to `ui://` **widgets**, never to
artifacts. The two are different runtimes with different APIs. Everything below follows from that.

All web sources fetched **2026-07-25**. Local SDK/spec evidence is stronger than web docs and is
marked as such.

---

## 1. The three-way distinction (get this right or every conclusion is wrong)

| | **Artifact** | **MCP App / widget** | **Generated file preview** |
|---|---|---|---|
| What it is | Claude product feature. Claude emits a self-contained page; Claude's runtime renders it. | Open standard, SEP-1865 (`text/html;profile=mcp-app` + `ui://` resource + `ui/*` postMessage). Served by an MCP server. | A plain HTML file written to disk by a script; the host previews it in the panel. |
| Who serves it | Anthropic | your MCP server | your filesystem |
| Agent bridge | none | **full bidirectional JSON-RPC** | none |
| Portability | Claude only | Claude (web/desktop/mobile/**Cowork**), ChatGPT, VS Code Copilot, M365 Copilot, Cursor, Goose | anywhere |

`window.sendPrompt` belongs to **none** of these specifications. Independent doc sweep across
support.claude.com, code.claude.com, claude.com/blog, claude.com/docs, platform.claude.com, both
changelogs, and the bundled artifact-capabilities contract found **zero** occurrences in any
runtime. There is no deprecation notice because there was never a specification. Community
reverse-engineering places `sendPrompt()` in the **generative-UI / widget** context on the claude.ai
parent page, not the artifact frame — consistent with our own note
(`reference_cowork_artifact_runtime.md`: "sendPrompt = WIDGET runtime only") and with this session's
own `mcp__visualize__show_widget` tool description ("A global `sendPrompt(text)` function is
available"). **Treat `window.sendPrompt` in an artifact as dead.**

---

## 2. Capability matrix

### 2.1 Artifact runtimes

**There are TWO incompatible `window.claude` shapes.** This governs everything. From the
Anthropic-shipped type contract `artifact-capabilities` skill **v0.1.15** (bundled with Claude Code
2.1.217), `mcp.d.ts`, verbatim:

> (Chat artifacts use a different, flat `window.claude`; none of its members exist here —
> feature-detect as documented.)

| Shape | Where | Members |
|---|---|---|
| **Flat** `window.claude` | claude.ai / desktop **chat** artifacts | `complete()` + persistent storage (API name undocumented) |
| **Namespaced** `window.claude` | **published / Claude Code** artifact frames | `window.claude.mcp`, `.downloads`, `.permissions` |
| `window.cowork` / `CoworkArtifacts` | Cowork live artifacts | `callMcpTool()` — **bug reports only, never documented** |

| Capability | claude.ai chat | Desktop chat | **Cowork artifact** | Published / org-shared | Claude Code artifact |
|---|---|---|---|---|---|
| Renders HTML + React | yes | yes | yes | yes | yes |
| MCP tool call at view time | yes | yes | yes (`window.cowork.callMcpTool`, undocumented) | yes — `window.claude.mcp.callTool` | yes since **v2.1.209** |
| In-panel Claude completion | `window.claude.complete` | same | same | same, billed to viewer | no |
| **Send a prompt/message to the agent** | **NO API** | **NO** | **NO — `window.sendPrompt` absent (verified live 2026-07-25)** | **NO** | **NO** |
| Agent patches page in place | no — full replace | no | no — full replace | no | no |
| External `fetch` / CDN | blocked | blocked | **all outbound blocked** (fetch/XHR/WS/media) | blocked | **zero external hosts** |
| Publish publicly | Pro/Max | Pro/Max | no external/public links | **impossible if it declares connectors** | Pro/Max, same caveat |
| Size | 20 MB storage/artifact; publish fails ≥ ~1.38 MB (our empirical) | same | device-local | same | **16 MiB rendered** |

**The load-bearing row is "send a prompt to the agent": every artifact runtime is NO.** Anthropic's
own documented pattern for getting a result back out of an artifact is manual — from
code.claude.com/docs/en/artifacts, verbatim:

> Add a "Copy as prompt" button that gives me the final ordering to paste back here.

That is the official artifact-native answer, and it is exactly the fallback we already ship.

**The namespaced MCP surface, for completeness** (`mcp.d.ts` v0.1.15):

```ts
callTool(server: string, tool: string, input?: unknown, options?: CallToolOptions): Promise<CallToolResult>;
watchTool(server: string, tool: string, input: unknown, handler: (ev: WatchEvent) => void, options?): Unsubscribe;
invalidate(server?: string, tool?: string, input?: unknown): Promise<void>;
listTools(): Promise<ListToolsResult>;
```

Constraints that matter: `server` is the connector **display name**, permanently ("ids are
per-viewer-account facts; a published page runs for many viewers"). 64 watches per view.
`refetchInterval` clamped to a ~30 s floor. `watchTool` is **reads only** (rejects
`readOnlyHint: false`). Per-call approval "is not yet supported in artifacts". Two silent-breakage
changes are recorded in the contract: tool failures now **reject** with `code: "tool_error"` instead
of resolving with `isError`, and text blocks no longer carry a parsed `json` sibling (`payload` is
its home).

Our Customer360 server is a Salesforce Hosted MCP Server
(`https://api.salesforce.com/platform/mcp/v1/sandbox/custom/Customer360`, per-user OAuth), so this
path is real for reads — but it is a *direct tool call*, not an agent turn: no reasoning, no
narration, no multi-tool orchestration, no memo drafting.

### 2.2 MCP App (widget) runtime — the capable one

Authoritative: `@modelcontextprotocol/ext-apps@1.7.4` installed at
`/opt/connectry/projects/mcp-widget-kit/node_modules/@modelcontextprotocol/ext-apps/`, protocol
`2026-01-26`; official docs repo at `/home/fabian/.claude/plugins/marketplaces/mcp-apps/`; spec
`specification/2026-01-26/apps.mdx` (SEP-1865, extension id `io.modelcontextprotocol/ui`).

`App` class public surface — `dist/src/app.d.ts`:

| Method | Wire method | What it gives us |
|---|---|---|
| `sendMessage({role:"user", content:[{type:"text",text}]})` | `ui/message` | **Injects a user turn into the conversation.** The agent reasons and calls any tool. This is the real "sendPrompt". |
| `updateModelContext({content})` | `ui/update-model-context` | Push a large payload into model context without bloating the visible turn. Overwrites previous; does **not** trigger a turn. |
| `callServerTool({name, arguments})` | `tools/call` | Call a tool on the widget's **own** server directly, no agent hop. |
| `readServerResource` / `listServerResources` | `resources/read` / `list` | Server-side data. |
| `createSamplingMessage(params)` | `sampling/createMessage` | Draft spec only; host capability `sampling`. |
| `requestDisplayMode({mode})` | `ui/request-display-mode` | inline / fullscreen / pip (host may refuse). |
| `openLink` / `downloadFile` | `ui/open-link`, `ui/download-file` | Escape hatches. |
| `getHostContext()` | — | theme, `styles.variables`, locale, timezone, container dimensions, platform, `availableDisplayModes`, safe-area insets. |
| `ontoolresult` handler | `ui/notifications/tool-result` | **Live in-place patching, no reload.** |
| `oncalltool` / `onlisttools` | `tools/call` inbound | The widget can register **its own tools the model calls**. |

`ui/message` spec, `dist/src/spec.types.d.ts:100`:

```ts
export interface McpUiMessageRequest {
    method: "ui/message";
    params: {
        role: "user";                 // currently only "user" is supported
        content: ContentBlock[];
    };
}
```

Spec host behaviour: *"Host SHOULD add the message to the conversation context, preserving the
specified role. Host MAY request user consent."* Denial is error `-32000` ("Message sending
denied"). **Gate on the host capability** — `McpUiHostCapabilities.message` ("Host supports
receiving content messages (ui/message) from the view"), read via `app.getHostCapabilities()`.

Official migration table confirms the equivalence (`docs/migrate_from_openai_apps.md:254`):

> `await window.openai.sendFollowUpMessage({ prompt })` → `await app.sendMessage({ role: "user", content: [{ type: "text", text: prompt }] })`

**Widgets can make external network requests** — unlike artifacts. Per `docs/csp-cors.md:11`, the
server declares `_meta.ui.csp.connectDomains` (fetch/XHR/WebSocket) and `resourceDomains`
(scripts/styles/images/fonts) **on the `contents[]` objects returned by `resources/read`** — not on
the tool, not on the resource config object. Missing origins fail silently. Default CSP when omitted
allows `'unsafe-inline'` for `script-src`/`style-src`, which is exactly what makes a
`vite-plugin-singlefile` bundle work. Host support varies; portable widgets should not depend on
`connectDomains`, and `frameDomains` is "currently restricted in Claude pending security review".

**Host support** (modelcontextprotocol.io/extensions/client-matrix): Claude web, Claude Desktop,
Claude mobile, **Claude Cowork**, ChatGPT, VS Code Copilot, M365 Copilot, Cursor, Goose, Postman.
Anthropic's own announcement (claude.com/blog/interactive-tools-in-claude) states availability on
Free through Enterprise and "Also now available on Claude Cowork". **Claude Code is not in the
client matrix** — it consumes the tools, it does not render the UI.

⚠️ **Naming trap:** searching "Cowork MCP Apps" surfaces Microsoft 365 Copilot's *own* product also
called "Cowork" (learn.microsoft.com/…/copilot/cowork/mcp-apps-support). Its harsh limits (64 KiB
tool result, `ui/update-model-context` rejected, `ui/open-link` unsupported, `pip` rejected, only
`frameDomains` applied) are **not** Claude Cowork's. Useful only as a worst-case portability floor.

### 2.3 Generated file preview

No JS bridge at all. Interactivity is whatever the page does client-side. Useful precisely because
it has zero runtime dependencies.

---

## 3. Noland's mechanism — the crown jewel, with evidence

**In three sentences:** Noland's credit-memo binder is a plain HTML file written to disk by a Node
script and previewed in the panel, with **all interactivity client-side** (contenteditable
narratives, per-section attestation, local `window.RV_ATTESTATION` state) and **no agent bridge
whatsoever** — his skill explicitly forbids `create_artifact`. Where he needs a genuine
artifact→agent round trip, he does not use an artifact at all: he uses an **MCP App widget** and
calls **`app.sendMessage(...)`** to inject a user turn asking the model to run the write tools. That
`sendMessage` pattern is shipped in four widgets across the fleet and is annotated in-repo as
"reliable in Cowork + ChatGPT".

### 3.1 The memo is a file, not an artifact

`.../plugins/2ea973ee43939dbd/skills/credit-binder/SKILL.md:76-78`:

> **B. Open the memo:** the HTML file you wrote IS the deliverable — it appears in the working
> folder and opens in the panel. **NEVER call `create_artifact` or any live-artifact tool** (that
> pops a Create/Cancel permission dialog and stalls the demo).

The renderer just writes a file — `skills/commercial-credit-memo/render/assemble-memo.mjs:325-326`:

```js
const outPath = arg("--out") ?? join(here, "memo.html");
writeFileSync(outPath, outHtml);
```

### 3.2 Interactivity is client-side only

`skills/commercial-credit-memo/assets/review-shell.js` (162 lines) touches **no** host global. Its
only "channel" is a local variable — line 116:

```js
window.RV_ATTESTATION = out;
```

`skills/commercial-credit-memo/SKILL.md:193-196` describes it as "per-section **Approve / Edit**
controls, a sticky review bar, and a live-updating cover summary — all client-side, no round-trip."

### 3.3 Read-back is human-mediated, and he knows it

`SKILL.md:204-208`:

> Because an artifact is sandboxed, the **freeze + save** is a handoff: the agent reads the exported
> map → re-renders the canonical memo deterministically … (Read-back channel from a live Cowork
> artifact: verify empirically; fallback = the user hands the exported JSON back to the agent.)

He never solved artifact→agent. He designed around it — and that is the officially sanctioned
pattern (§2.1, "Copy as prompt").

### 3.4 Where he DID need a round trip, he used a widget + `sendMessage`

`/opt/connectry/projects/commercial-credit-reinvented/experience-mcp/widget/finalize.html:7-9`:

> ACTION WIRING = model-mediated (app.sendMessage): a button asks the model to run the
> step's tool(s) — **reliable in Cowork + ChatGPT** (the same pattern as the Boom widget's ask()).
> The widget never calls tools directly; the agent stays the source of truth and re-renders.

Line 52 — the whole mechanism, one line:

```js
function ask(text){ try{ app.sendMessage({role:"user",content:[{type:"text",text}]}); }catch{} }
```

Identical `ask()` in three more shipped widgets:

- `experience-mcp/widget/finalize.html:52`
- `boom-mcp/widget/financials.html:158` (header comment line 9: "ask Claude about it
  (app.sendMessage), open the live Boom UI (app.openLink)")
- `afs-mcp/widget/officer.html:42`
- `afs-mcp/widget/summary.html:70`

And the memo skill itself names widgets as the only live-patching surface —
`commercial-credit-memo/SKILL.md:236-241`:

> Live in-place updates exist only where the surface is a **live component** — the in-artifact "✎ Edit"
> control (client-side `contenteditable`), or the **MCP-App widgets** (deal-summary, Boom financials)
> which patch via `ontoolresult` with no reload.

### 3.5 One hard-won host fact, already paid for

`experience-mcp/app/api/[transport]/route.js:168-172`:

> CHANNEL FACTS (verified empirically in Cowork — do not re-trip on this):
> - The widget receives ONLY `content[0].text`. `structuredContent` is stripped. `_meta` is stripped
>   (a `_meta`-only payload renders "No deal data").
> - `content` is also model-visible, so full data isolation from the model is impossible in this host.

Any widget we build must put its payload in `content[0].text`. The `structuredContent` path our
widget-kit hook prefers is a portability nicety, not the Cowork reality.

---

## 4. Our implementation — what we got right, what we assumed wrong

Reviewed: `customer-360-reinvented/app/src/channel/adapter.ts`,
`skills/credit-360-cockpit/SKILL.md`, `MAPPING.md`, `README.md`.

### Wrong

1. **`window.sendPrompt` as the primary channel.** `adapter.ts:10` — "Primary channel is the direct
   child global `window.sendPrompt(text)`." Not documented in any runtime, absent from Cowork.
   `MAPPING.md:7,62-63,149,172` and `README.md:19-21` all build on it.

2. **All four speculative candidates are wrong, and two can never exist.** `adapter.ts:75-81` probes
   `claude.sendPrompt`, `claude.complete`, `claude.callTool`, `openai.callTool`.
   - `claude.sendPrompt` — invented, no such API.
   - `openai.callTool` — that is the **OpenAI Apps SDK** surface (`window.openai`), ChatGPT-only and
     superseded by MCP Apps. It will never appear in a Claude artifact.
   - `claude.callTool` — **wrong shape.** The real API is namespaced and takes a connector display
     name first: `window.claude.mcp.callTool(server, tool, input, options)`. Our candidate resolves
     `host().claude?.callTool`, which is `undefined` in both the flat and namespaced shapes.
   - `claude.complete` — exists on chat artifacts, but it is a text-completion bridge, not an agent
     channel. Invoking it as a `style: "text"` channel (line 78) would silently return a completion
     string that nothing consumes, and bill it to the viewer.

   The correct availability gate, per the shipped contract, is `window.claude.mcp !== undefined` —
   *"the only check valid on every runtime generation, and it cannot throw."* Detect the **member**,
   never the root. This whole candidate list is guesswork and should be deleted.

3. **`create_artifact` as the publish path.** `SKILL.md:295-296` — "Publish the assembled file with
   the artifact tool **BY FILE PATH** (`create_artifact`)". This is the exact call Noland's binder
   skill forbids (§3.1) for stalling the demo with a permission dialog.

4. **The widget option was ruled out on a false premise.** `README.md:23-25` argues there is "no
   server-to-server 'on behalf of' path — so a widget-hosting MCP could never fetch Customer360 data".
   True but irrelevant: **the widget does not need to fetch anything.** The agent already fetches
   from the Customer360 connector under the user's own OAuth, exactly as today, and passes
   `C360_DATA` to the widget in `content[0].text`. The agent is the data courier. The identity story
   is unchanged and still honest. This premise is the single reason we are in an artifact.

### Right

- **Isolating the bridge in one module** (`adapter.ts:2-6`). A runtime shift is a one-file fix —
  which is exactly what makes the recommended option cheap.
- **Re-detecting per request, not caching at mount** (`adapter.ts:8-9, 110-111`). Matches the
  contract's "availability is a per-view fact" rule.
- **Degrading honestly** — `ChatPanel.tsx:109`, `ActionsPanel.tsx:23`, `CopyPromptDialog.tsx`: no
  channel means a copy-prompt dialog, never a dead spinner. Commit `9482685` shipped "graceful
  no-sendPrompt fallbacks" before the live test. **This is now known to be Anthropic's own
  recommended artifact pattern** ("Add a 'Copy as prompt' button…"). We accidentally built the
  officially correct fallback.
- **The diagnostics probe** (`adapter.ts:233-271`) — read-only, individually try/caught. Correct
  instinct; it is what turned "it's broken" into evidence.
- **Never model-generating the HTML** (`SKILL.md:375-377`). Keep this under every option.
- **Client-side staging of the whole book** so navigation survives with no channel.

---

## 5. Ranked options

Bundle context: the compiled cockpit is **369 KB** (`app/dist/cockpit.html`, one self-contained
React file). Existing widgets already inline a 337 KB ext-apps bundle each and ship a 1.07 MB base64
blob (`experience-mcp/app/_widgets.js`), so a ~700 KB widget is within the proven envelope. **There
is no documented size cap on a `ui://` HTML resource** — the limits people hit are on *tool results*
(~150,000 characters on Claude.ai/Desktop, beyond which the payload is spilled to the sandbox
filesystem and the widget never hydrates).

### #1 — Render the cockpit as an MCP App widget (`app.sendMessage`) — RECOMMENDED

Serve `cockpit.html` as a `ui://` resource from an MCP server we control; replace the channel
adapter's body with `app.sendMessage(...)`.

- **Chat:** yes — real turns into the conversation, agent reasons and narrates.
- **Actions:** yes — model-mediated, the proven `ask()` pattern.
- **Tool calls:** yes, two ways — via the agent (`sendMessage`) or direct (`callServerTool`).
- **Live patching:** yes — `ontoolresult` updates in place, no reload, no full replace. Strictly
  better than what we designed for.
- **Bonus:** external fetch possible via `_meta.ui.csp`; host theme tokens via `getHostContext()`;
  fullscreen via `requestDisplayMode`; portable to ChatGPT, VS Code, M365 Copilot.
- **Breaks:** no public share link (widgets are in-conversation). Payload rides `content[0].text` and
  is model-visible (§3.5). Cross-server tool calls are blocked — a widget's `callServerTool` reaches
  **only its own server**; anything else must go through `sendMessage` → agent.
- **Server:** `experience-mcp` (Vercel, ours) already registers `ui://` resources and widgets — add
  one tool `customer360_show_cockpit(data)` that echoes `C360_DATA` back with
  `_meta.ui.resourceUri`. No new infrastructure, no new auth, no IDB Gateway.
- **Effort:** ~1–1.5 days. Adapter rewrite ~30 lines. Build step mirrors `scripts/build-widget.mjs`.
- **Demo risk:** LOW. Same runtime as four widgets already demoed in Cowork.

**Four gotchas to design in from the start:**
1. **Instance supersession.** Claude mounts a **separate iframe per tool call** with no API to unmount
   older ones — several live cockpits will coexist. Anthropic's documented fix is a `BroadcastChannel`
   election using a server-minted `{createdAt, seq}` key, gating `sendMessage`/`updateModelContext`
   on `!superseded`. Non-optional for a stateful app.
2. **Version the `ui://` URI** on every bundle change (`ui://c360/cockpit-v2.html`). Hosts prefetch
   and cache by URI with unspecified invalidation; Cowork additionally caches at the connector level,
   so a redeploy needs a connector reconnect (widget-kit rule #11).
3. **Payload size.** `C360_DATA` is ~71 KB today (sample). Keep the tool result well under the
   ~150 k-character threshold; if the real book pushes past it, move bulk to an app-initiated
   `callServerTool` (the chunked app-only-tool pattern, `docs/patterns.md:107`) and keep the initial
   result lean.
4. **Capability-gate `sendMessage`** on `app.getHostCapabilities()?.message`, and check the returned
   `isError` — then fall back to the existing copy-prompt dialog. That keeps every degradation path
   we already built.

### #2 — Noland's file-preview pattern, interactivity fully client-side

Drop `create_artifact`; write the HTML and let the panel preview it. Keep every interaction local
(staging, filtering, drill-down, editing), export requests as copyable text.

- **Chat:** no. **Actions:** local only. **Tool calls:** no.
- **Breaks:** the "click → agent does it" story — the cockpit's whole point.
- **Effort:** ~2 hours (delete the create_artifact step, promote the copy-prompt dialog to primary).
- **Demo risk:** LOW, but the demo becomes a static tour. Note Noland's own hedge
  (`commercial-credit-memo/SKILL.md:129-131`): if a host's panel does not execute embedded script,
  even client-side controls do not appear, and the fallback is "Open in Chrome".
- **Use as:** the safe fallback to keep in the bundle, not the destination.

### #3 — Hybrid: file/artifact canvas + widget for interactions

Big cockpit as the canvas, a compact widget beside it for the action surface.

- **Chat/actions:** yes, in the widget. **Canvas:** stays rich and shareable.
- **Breaks:** two surfaces, two data copies, split state, double the sync bugs. The canvas cannot
  reflect what the widget did without a full re-render.
- **Effort:** ~2–3 days.
- **Demo risk:** MEDIUM — the seam is visible and bankers will click the wrong panel.
- **Only worth it if** a shareable public canvas is a hard demo requirement.

### #4 — Artifact + direct MCP tool calls (`window.claude.mcp.callTool`)

Skip the agent; have the artifact call Customer360 tools itself.

- **Chat:** no. **Actions:** only those expressible as a single tool call. **Tool calls:** yes, and
  this is now a *formally versioned* contract (v0.1.15) — better documented than when we last looked.
- **Breaks:** no reasoning, no narration, no drafting, no orchestration. Per-viewer connector auth
  with viewer approval before the first call. **A connector-declaring artifact can never be shared to
  a public link on any plan** — live data and public sharing are mutually exclusive. Requires Claude
  Code ≥ v2.1.209; blocked entirely under CMEK/HIPAA/ZDR and on Bedrock/Vertex/Foundry sessions.
  Per-call approval "not yet supported in artifacts". `watchTool` is read-only, so no write-backs on
  the watch path.
- **Effort:** ~1 day, plus live verification we have never completed.
- **Demo risk:** MEDIUM-HIGH — approval dialog mid-demo, and the demo loses the agent narration that
  is most of the "wow".
- **Worth revisiting** as a *supplement* to #1 later (live refresh without an agent turn), not as the
  primary channel.

### #5 — Live Artifact refresh-on-reopen as partial mitigation

Lean on Live Artifacts pulling fresh data when reopened.

- **Chat:** no. **Actions:** no. **Freshness:** yes, on reopen (short cache + manual refresh button).
- **Constraint:** Cowork live artifacts are **desktop-only** (macOS/Windows/Linux beta), device-local
  ("If you switch devices, they don't come with you"), Team/Enterprise sharing only, no public links.
- **Effort:** near zero. **Demo risk:** LOW, value LOW. Mitigates staleness, not interactivity.
- Pair with #2 at most.

---

## 6. Recommendation

**Go with #1 — port the cockpit to an MCP App widget served by `experience-mcp`, and rewrite
`channel/adapter.ts` around `app.sendMessage`.**

It is the only option that restores everything the cockpit was designed to do; it is the mechanism
Noland already proved in this exact host across four shipped widgets; it needs no new infrastructure
or auth story; and it upgrades us from "full artifact replace" to true in-place patching via
`ontoolresult`. The one architectural objection on record — that a widget-hosting MCP could not
reach Customer360 data — does not apply, because the agent carries the data in, exactly as today.

Keep #2 in the repo as the degraded fallback: if a host ever refuses the widget, the same compiled
bundle still renders as a file with client-side staging intact.

**Delete on sight:** the speculative candidate list in `adapter.ts:75-81`, and the `create_artifact`
instruction in `SKILL.md:295-296`.

**Before building, verify live (one Cowork session, ~15 min):**
1. Trivial `ui://` widget from `experience-mcp` calling `app.sendMessage` — confirm the turn lands,
   and log `getHostCapabilities()?.message`.
2. Resource read of a ~700 KB `ui://` HTML — confirm no size rejection.
3. `getHostContext().availableDisplayModes` — confirm `fullscreen` for the big canvas.
4. Two consecutive tool calls — observe the duplicate-iframe behaviour before writing supersession.

---

## 7. Sources

**Local, authoritative (strongest — SDK source, shipped contracts, shipped code):**
- `@modelcontextprotocol/ext-apps@1.7.4`, protocol `2026-01-26` —
  `/opt/connectry/projects/mcp-widget-kit/node_modules/@modelcontextprotocol/ext-apps/dist/src/{app,spec.types}.d.ts`
- Official MCP Apps docs repo — `/home/fabian/.claude/plugins/marketplaces/mcp-apps/docs/{overview,csp-cors,patterns,migrate_from_openai_apps}.md`
- **Anthropic-shipped artifact contract** — `artifact-capabilities` skill v0.1.15 (`mcp.d.ts`,
  `downloads.d.ts`), bundled with Claude Code 2.1.217
- Shipped widgets — `experience-mcp/widget/finalize.html`, `boom-mcp/widget/financials.html`,
  `afs-mcp/widget/{officer,summary}.html`
- Empirical Cowork channel facts — `experience-mcp/app/api/[transport]/route.js:168-172`
- Noland's skills — `.../plugins/2ea973ee43939dbd/skills/{credit-binder,commercial-credit-memo}/SKILL.md`
- Widget-kit canon — `/opt/connectry/projects/mcp-widget-kit/docs/MCP-BEST-PRACTICES.md`

**Official web (all fetched 2026-07-25):**
- Artifacts overview — https://support.claude.com/en/articles/9487310
- Publish and share artifacts — https://support.claude.com/en/articles/9547008
- Claude Code artifacts (CSP, 16 MiB, connector manifest, "Copy as prompt") — https://code.claude.com/docs/en/artifacts
- Cowork live artifacts — https://support.claude.com/en/articles/14729249
- Week 29 (artifacts call MCP connectors, v2.1.207→212) — https://code.claude.com/docs/en/whats-new/2026-w29.md
- Claude release notes — https://support.claude.com/en/articles/12138966-release-notes
- Claude Desktop changelog — https://claude.com/docs/cowork/changelog
- AI-powered artifacts — https://claude.com/blog/claude-powered-artifacts
- MCP Apps: getting started / design guidelines / troubleshooting / instance supersession /
  transparent theming / cross-compatibility — https://claude.com/docs/connectors/building/mcp-apps/*
- Interactive connectors + MCP Apps announcement — https://claude.com/blog/interactive-tools-in-claude
- Use interactive connectors — https://support.claude.com/en/articles/13454812
- SEP-1865 — https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp
- Extension client matrix — https://modelcontextprotocol.io/extensions/client-matrix
- OpenAI Apps SDK custom UX — https://developers.openai.com/apps-sdk/build/custom-ux

**Anthropic-adjacent (GitHub issues — real error strings, not specifications):**
- `CoworkArtifacts.callMcpTool` relay path + stdio-server failure — anthropics/claude-code#55788 (open)
- `window.cowork.callMcpTool` — #57398 · Cowork sandbox blocks all outbound network — #49182 (closed,
  not planned) · postMessage origin faults — #42064, #58623

**Brain references (prior research — corrections below):**
- `memory/auto/reference_claude_artifacts_vs_widgets.md` — largely holds; §10's `window.claude.callMcpTool`
  guess is **superseded** by the namespaced `window.claude.mcp.callTool(server, tool, input)` contract.
- `memory/auto/reference_cowork_artifact_runtime.md` — **"Agent → Artifact" / "Artifact → Agent"
  sections are superseded**: `window.sendPrompt` is absent from the July runtime and was never a
  documented API.
- `memory/auto/reference_mcp_protocol_and_apps.md` — holds; display modes in Cowork
  (`["inline","fullscreen"]`, no pip) and the host-side widget caching gotcha both confirmed.
