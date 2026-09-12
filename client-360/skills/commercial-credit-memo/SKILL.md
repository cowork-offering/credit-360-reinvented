---
name: commercial-credit-memo
description: Commercial credit memo methodology. Section structure, ratio definitions, NAICS-aggregated peer analysis, covenant compliance framework, bank-branded HTML/PDF output. Use whenever drafting, refreshing, or auditing a commercial credit memo for a C&I borrower — covers C&I working capital lines, term loans, revolvers, and middle-market deals up to roughly $250M facility size. Trigger on phrases like "draft a credit memo", "refresh the memo", "covenant compliance", "risk rating writeup", or any request to produce or update a commercial loan underwriting document.
---

# Commercial Credit Memo — Methodology

How to structure, populate, and render a commercial credit memo. The memo is **modular and
conditionally rendered**: one declarative manifest expands or contracts to cover what used to be 80+
legacy templates. Deep mechanics are split across references — load only what you need:

| Reference | When to load |
|---|---|
| `references/module-manifest.json` | The module library + per-module/component `renderWhen` predicates. The spine. |
| `references/conditionality.md` | How to derive the deal-context flag set and resolve the render plan. |
| `references/data-contracts.md` | Module → data-source → field map + the deal-dossier handoff schema. |
| `references/visual-specs.md` | The Visual Inventory charts (inline SVG / HTML, no CDN). |
| `references/ncino-data-inventory.md` | When querying Salesforce/nCino — every object + field the agent reads |
| `references/ratio-definitions.md` | Ratio definitions (the AFS layer derives these from Boom spreads) |
| `references/covenant-checks.md` | Covenant cushion / flag math (10% rule, within-10%-of-breach, breach) |
| `references/peer-aggregation.md` | Peer comp methodology (CapIQ/IBIS MCP; replaces EDGAR) |
| `references/memo-sections.md` | Legacy flat section descriptions — superseded by the manifest; per-section narrative guidance only |

> Data sources are **MCP servers**, not curl/WebFetch: nCino (Salesforce Hosted MCP, system of
> record), Boom (`boom_*` — spreading engine), AFS (`revolver_utilization`/`payment_history`/`loan_summary`), AFS
> (risk/covenant/ratios — placeholder until the AFS MCP lands), CapIQ/IBIS (peers/industry —
> placeholder until the OOTB MCP lands). See `data-contracts.md`.

## When this skill applies

- Drafting a commercial credit memo for a C&I borrower (any credit-event tier)
- Refreshing a memo with new quarter financials
- Auditing an existing memo for methodology / conditionality consistency
- Producing a covenant compliance report or peer comparison (subsets of the full memo)

**Related**: the **Experience MCP**'s `deal_show_summary` tool is the lightweight precursor — it renders an inline one-screen widget summarizing the same borrower (nCino facts × Boom KPIs × covenant grade). Use that widget for a "quick look"; use this skill for the full underwriting workspace.

## Workflow — fast path (BUNDLED DEFAULT, ONE command; do NOT hand-build a dossier)

The whole memo is **one assembler script** that renders from **bundled data by default** — the nCino
stub, a captured **Boom snapshot** (spread + ratios), and the written narratives all ship in
`assets/`. So the standard draft needs **NO live MCP calls** (no cold-start, instant) and the numbers
**match the Boom / deal-summary widgets** because the snapshot is real Boom output. You do NOT read
`data-contracts.md`, the renderer source, or hand-assemble a dossier.

**Default (instant) — do this unless the user asks to refresh from Boom:**
```bash
# Resolve the renderer robustly: $CLAUDE_PLUGIN_ROOT if it's exported, else locate it once.
# (In Cowork the plugin lives under ~/Library/Application Support/Claude/…; the env var is not always
# set in the Bash tool — this one-liner avoids the "locate the skill dir" detour.)
ASM="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills/commercial-credit-memo/render/assemble-memo.mjs}"
[ -f "$ASM" ] || ASM="$(find "$HOME/Library/Application Support/Claude" -path '*commercial-credit-memo/render/assemble-memo.mjs' 2>/dev/null | head -1)"
node "$ASM" \
  --out /tmp/piedmont-credit-memo.html \
  --reviewer '{"name":"<from getUserInfo>","role":"<title>","date":"<Mon D, YYYY>","iso":"<YYYY-MM-DD>"}'
```
That is the ENTIRE memo body — one command (plus the one-time path resolve), no fetch. Resolve the reviewer with **one** `getUserInfo`
call (skip it and a generic reviewer is used). It prints the RENDER PLAN + SUPPRESSED list (surface
them for SR 11-7 auditability). Then **present** the interactive artifact. **No PDF step** — the
deliverable is the HTML memo (and the nFORMS HTML on write-back); never run a `pdf` skill or DocMan.

> **Speed discipline:** for the standard draft, do NOT create a task list, do NOT explore for the
> assembler path (it is the command above), and do NOT call Boom/AFS — the bundled snapshot
> already has everything. Fewer turns = faster memo. Run the **`warmup`** skill only when you DO need
> live MCP calls (the refresh path below or the write-back).

**Live refresh (only when the user says "refresh from Boom" / "pull the latest"):**
1. `boom_get_ratios` **and** `boom_get_spread` for the borrower's latest completed file (resolve via
   `boom_lookup_company` from the Account Id). Save each to a temp file.
2. Pass them as overrides — they replace the bundled snapshot:
   ```bash
   node "…/assemble-memo.mjs" --ratios /tmp/ratios.json --boom /tmp/spread.json --out <memo.html> --reviewer '…'
   ```
   `--ratios` drives the headline KPIs (revenue/YoY/EBITDA/margin/leverage) so they stay identical to
   the widgets; `--boom` drives the per-period trend charts.

- **nCino** comes from the bundled stub (`assets/ncino-demo-data.json`) — DEMO STUB MODE. When the nCino
  MCP lands, pass `--ncino <its output>`; nothing else changes.
- **Financials.** Headline KPIs come from the Boom **ratios** payload (bundled `assets/boom-ratios.json`
  or live `--ratios`) — never re-derived in the memo, so they always match Boom. Trend charts read the
  spread. Ratios that can't compute render **NS**; missing data renders `—`. Never fabricate.
- **Narratives** are bundled (`assets/piedmont-narratives.json`) so sections are pre-populated, not
  blank placeholders. Override with `--narratives <json>` when real prose is available.
- The conditionality engine still runs (inside the renderer); flip flags for what-ifs by editing the stub
  or passing overrides. Deep reference docs (`module-manifest.json`, `conditionality.md`, `data-contracts.md`)
  are for *understanding/auditing* the engine — not required for a normal run.

> **One renderer, no drift.** `render/render-memo.mjs` is the single source of rendering truth —
> predicate evaluator + render-plan resolver + inline-SVG chart builders + module bodies. The
> orchestrator runs it directly (the former `memo-writer` agent is folded in — same discipline, no
> delegation hop); the verification harness `test/build-memo.mjs` *imports the same `renderMemo`
> function*, so the live memo and the tested memo are byte-identical. The model never authors memo HTML. Run `node test/build-memo.mjs` to see the resolved Piedmont memo, or
> `node test/build-memo.mjs --flags has_deposits=true,is_syndicated=true` to watch the engine react.

## Demo stub mode (nCino) — default until the nCino MCP lands

**Do NOT fire the live nCino SOQL barrage to gather deal facts.** Those queries are moving into a
dedicated **nCino MCP** (next build phase; see `ncino-mcp/docs/query-spec.md`). For now, read all
nCino-sourced facts — borrower, Product Package, loans, covenants, collateral, guarantor — from the
bundled fixture:

```
${CLAUDE_PLUGIN_ROOT}/assets/ncino-demo-data.json
```

It holds the **real** Piedmont values (pulled live once) and mirrors exactly what the nCino MCP will
return, so the memo/widget renders fast without a tool barrage. Only run live nCino SOQL if the user
explicitly asks, or once the nCino MCP is connected (then call `ncino_*` tools instead). Boom (spread)
and AFS still come from their MCPs/fixtures as usual.

## The ratio set

Compute the full set every memo. Display leverage / coverage / liquidity / growth on the Executive Summary; full set in the Financial Analysis ratio dashboard.

| Category | Ratios |
|---|---|
| Leverage | Total Leverage, Funded Debt/EBITDA, Net Leverage, Senior Secured Leverage |
| Coverage | DSCR, FCCR, Interest Coverage |
| Liquidity | Current Ratio, Quick Ratio, Liquidity ($) |
| Profitability | Gross Margin, Operating Margin, EBITDA Margin, Net Margin, ROA, ROE |
| Efficiency | DSO, DPO, DIO, Cash Conversion Cycle |
| Growth | Revenue YoY, Revenue 3-Yr CAGR, EBITDA YoY |

## Output

The deliverable is the live **interactive HTML artifact** in Cowork's right panel (from
`assemble-memo.mjs` — the assembler injects the review shell by default). **There is NO PDF step** — do
not run a `pdf` skill, do not save to DocMan, do not mention PDF. The in-nCino artifact is the published
nFORMS HTML (write-back). **Open the artifact in a real browser (the "Open in Chrome" action) for full
interactivity** — if a host's artifact panel doesn't execute the embedded script, the controls won't
appear there; the chat-driven attestation walk is the fallback.

> **One command, not two. `assemble-memo.mjs` IS the interactive renderer** — without `--static` it
> injects the review shell; with `--static` it's the print/PDF version. The older
> `render/render-interactive.mjs` (which needs a hand-built `--dossier`) is **legacy — do NOT use it**;
> it is the cause of the "locate the skill / wrong renderer / needs a dossier" detour. Run
> `assemble-memo.mjs` for everything.

## Per-section attestation (human-in-the-loop sign-off)

The memo is **AI-drafted, human-attested**. After the memo artifact renders, the orchestrator walks
the reviewer through each ON section so a human confirms or edits it. This is the SR 11-7 control
made visible — and it is **distinct from credit-committee approval** (a separate downstream gate; the
`DRAFT — PENDING CREDIT COMMITTEE REVIEW` banner never comes off here).

Flow (the orchestrator owns the loop + identity, and runs the renderer directly with whatever `attestation` it has built):

1. **Resolve the reviewer once.** Pull name + role/title from the Salesforce connector's `getUserInfo`
   and cache for the session. Never free-type the approver — the attestation must trace to the
   authenticated user.
2. **Render the working artifact** with the same `assemble-memo.mjs` from the fast path (it injects the
   review shell by default — no extra step, no dossier) — every section shows "AI-drafted · Pending
   reviewer verification", the cover shows "0 of N reviewed", and each section carries in-artifact
   **Approve / Edit** controls. The reviewer can sign off — and **edit the prose in place** (the "✎ Edit
   narrative" button makes ONLY the narrative paragraphs editable, no reload; data tables, KPI tiles and
   charts stay locked — they trace to a system of record and are changed only by the agent re-rendering
   from source) — directly in the artifact (then Export sign-offs), OR via the chat walk below — both
   produce the same `attestation` map. Pure-data sections (e.g. Financial Model / Sensitivity) show no
   Edit button at all.
3. **Walk the sections in order.** For each ON module, present it and ask: **approve as drafted**,
   **edit**, or **skip**. Offer an "approve all remaining" shortcut.
   - approve → `attestation[moduleId] = { status:"approved", approvedBy, approvedRole, approvedDate:<today> }`
   - edit → apply the change to the dossier, then `{ status:"edited", …, editNote:"<reason>" }`
   - skip → leave it pending
   - On each approve/edit, also append an audit event: `log_audit_event(packageId, sectionId:<moduleId>,
     eventType:"attested"|"edited", fieldOrStatus:"status", newValue:<status>, actingUser*)`.
4. **Re-render after each decision** so the artifact updates live — the badge flips to green and the
   cover summary increments. (Live-updating artifact + chat approvals; the agent is the source of
   truth, so no in-widget round-trip is needed.)
5. **Write back** on request via the **`finalize-and-writeback` skill** (sync narrative → submit → publish
   nFORMS HTML). **No PDF / DocMan** — the HTML memo is the deliverable.

`attestation` is keyed by module id and travels in the renderer bundle — see `data-contracts.md` →
"Attestation contract". Module ids are the manifest `id` values (e.g. `executive_summary`,
`request_details`, `trend_reporting`).

> **Sign-offs persist across re-renders — the agent carries the map forward.** The checklist is
> client-side state; a re-render builds a fresh artifact, so **any re-render that does not replay the
> prior sign-offs wipes them.** The agent is the source of truth and MUST prevent that:
> 1. **Before** re-rendering for *any* reason (chart swap, narrative edit, data refresh), capture the
>    current sign-offs — read `window.RV_ATTESTATION` from the artifact (it is republished live after
>    every approve/edit/reset, no "Export" click required), or use the attestation map you've been
>    tracking in this session.
> 2. **On** the re-render, pass that map straight back: `--attestation '<json>'` (or
>    `--attestation-file <path>`). The assembler injects it as `RV_ATTESTATION_IN`; the shell rehydrates
>    each section's badge + Undo control so signed-off sections stay green.
> Never re-render from a blank attestation once the reviewer has started signing off. The map shape is
> identical to the export shape (`{ modId: { status, approvedBy?, approvedRole?, approvedDate?,
> editNote? } }`), so it round-trips verbatim.

### Interactive review shell (the default workspace render)

The workspace render (`assemble-memo.mjs` without `--static`) injects `assets/review-shell.css` +
`assets/review-shell.js`: per-section **Approve / Edit** controls, a sticky review bar, and a
live-updating cover summary — all client-side, no round-trip. The **"✎ Edit narrative" control makes only
the narrative paragraphs `contenteditable`** (the renderer marks prose with `[data-editable]`; tables,
KPI tiles, charts and figures stay locked) — the reviewer edits the narrative prose **in place, in real
time, with no re-render** (Save edit marks the section "edited"). **Data is never hand-edited in the
artifact** — it traces to a system of record and changes only when the agent re-renders from source
(the System/Experience tiers own the figures; the narrative tier is the human-attested layer). Pure-data
sections show no Edit button. This is the real-time editing surface; an agent-driven (chat) edit instead
re-renders the whole document (see "Editing a narrative section" below).
On **Export sign-offs** it emits the attestation map (`window.RV_ATTESTATION` / a `#rv-export` JSON
block) in the exact shape above. Because an artifact is sandboxed, the **freeze + save** is a handoff:
the agent reads the exported map → re-renders the canonical memo deterministically → PDF → DocMan
(`ncino_docman_save`). The artifact is the interactive *review* surface; the agent stays the
system-of-record writer. (Read-back channel from a live Cowork artifact: verify empirically;
fallback = the user hands the exported JSON back to the agent.)

## Editing a narrative section (from chat)

When the user asks to change a section's prose ("split the Executive Summary into two paragraphs",
"tighten the risk write-up", "add a sentence about the backlog"), there are **two surfaces** — pick by
what they want:

- **Real-time, in the artifact (no reload):** tell them to click the section's **"✎ Edit"** button and
  type — the prose becomes editable in place, "Save edit" marks it edited. Best for quick wording tweaks
  the reviewer makes themselves. Nothing re-renders.
- **Agent-driven (you make the change):** edit the narrative **source** and re-render. This re-renders the
  whole document (the artifact reloads) — it is NOT live-patched, because the memo is a generated
  document, not a live widget (see note below). Workflow:
  1. Copy the bundled narratives to a temp file **once** (don't mutate the plugin asset):
     `cp "$(dirname "$ASM")/../../../assets/piedmont-narratives.json" /tmp/narr.json` (or read the asset
     and write your edited copy to `/tmp/narr.json`).
  2. Edit the relevant **key** (HTML string, may contain multiple `<p>…</p>`). Section → key map:
     `execSummary` · `requestDetails` · `borrowerDescription` · `strengthsRisks` · `managementOwnership`
     · `industryChanges` (Industry Analysis) · `financialCommentary` · `recommendation` (Forward-Looking)
     · `guarantorProfile` · `globalCashFlow` · `collateralBlanket` / `collateralEquipment` · the
     leading-indicator keys (`ews_summary`, `entity_verification`, `internet_search`, `credit_bureau`,
     `sbfe`, `leading_indicators_commentary`) · `spreadingReadDollars` / `spreadingReadMargin` (the read
     under the spreading chart).
  3. Re-run the assembler with `--narratives /tmp/narr.json` (keep `--out` + `--reviewer` the same) and
     re-present. Carry forward any `--chart` directive already in effect **and the current sign-offs via
     `--attestation` so the checklist survives the re-render.**

> **Why agent edits reload but the Edit button doesn't:** the memo is a **generated document artifact**
> (a Node script writes the HTML file), so any source change = re-run the renderer = fresh file = the
> panel reloads. Live in-place updates exist only where the surface is a **live component** — the
> in-artifact "✎ Edit" control (client-side `contenteditable`), or the **MCP-App widgets** (deal-summary,
> Boom financials) which patch via `ontoolresult` with no reload. The memo is deliberately a document
> (print/PDF fidelity, multi-page, deterministic Boom→AFS→nCino lineage), so chat-driven edits re-render.

## Chart views — the configurable-view + memory moment

A chart can render in more than one **view** without changing the data — this is a *view/selection*
choice (configurable), never a data edit. The renderer takes a `chartVariants` directive; today the
**Spreading** chart swaps absolute $ ↔ margin % (`assemble-memo.mjs --chart spreading:margin`). When
the user asks to change a chart view:
1. Re-run the assembler with the `--chart` directive and re-render the artifact — **and replay the
   current sign-offs via `--attestation` (see "Sign-offs persist across re-renders" above) so the
   checklist is not wiped.** Carry forward any `--narratives` already in effect, too.
2. **Realign the narrative.** A view swap changes the deal's story, so update the prose tied to that
   chart to match what it now shows (margin % → talk margin compression, not dollar growth). Chart and
   narrative ship as one consistent picture — never a margin-% chart over dollar-growth text.
3. **Record *why* automatically — do not ask.** Capturing rationale is bookkeeping, not a credit
   decision, so it carries no permission gate. Call `record_decision(packageId, sectionId, decision,
   rationale, alternatives, actingUser*)` (Experience MCP → Snowflake) as part of executing the swap:
   infer the rationale from the user's stated reason and the view they moved away from, attribute it to
   the `getUserInfo` user, then report it ("Recorded to the decision ledger — …"). e.g. *"switched the
   spreading view to margin % because it surfaces the EBITDA-margin compression the $-view hides;
   realigned the spreading narrative to match."* That rationale is what the next analyst's agent
   recalls. The values never change — only the lens does.

## Branding

Tokens live in `../../assets/brand-tokens.css`. The classification banner `INTERNAL — DRAFT, PENDING CREDIT COMMITTEE REVIEW` appears on every page in Accenture purple (#A100FF). The cover carries the "CREDIT MEMO REIN›ENTED · an Accenture accelerator" lockup (no bank logo) — the default skin is client-agnostic; a client brand is a config override.

## No intake form — derive everything from the data

**Do NOT render a pre-workspace intake form.** Everything the form used to ask for is derivable from
the data already pulled, so go straight to the workspace:
- **Credit action** — infer from the Product Package + loans (new money present → "renewal + new
  money"; all expiring, no new money → "annual review"; new facility only → "new money"; pricing/
  covenant change only → "modification").
- **Financials** — use the Boom spread **as-is** (the most recent usable file for the borrower); no
  picker. The user updates Boom directly when they want fresher financials.
- **Peer NAICS** — use the borrower's nCino NAICS (`NAICS_Code__c`); only broaden if the peer set is thin.

Only stop to ask when something is genuinely ambiguous (see "When to ask vs. proceed"). The point of
the agent is that the data drives the memo — the user shouldn't start with a form.

## When to ask vs. proceed

**Ask** when: multiple Account candidates match the borrower; multiple loans on the Account; Boom spread fails or hangs; a covenant computes to a breach (confirm whether to flag in Executive Summary or escalate to RM first); peer set has fewer than 3 clean public peers (broaden NAICS or accept smaller).

**Proceed** when: data is unambiguous; the methodology specifies a single answer; the user has already disambiguated; the user said "use defaults" or "skip the form".

## Failure modes

These are the mistakes that make memos fail committee review. Avoid each:

- **Estimating without sourcing.** If a figure isn't in the source, write `[not in source system; flagged for RM]` — don't guess.
- **Industry "average" without naming the peer set.** Always name the peers when citing a median.
- **Treating Total Leverage and Senior Secured Leverage as interchangeable.** Compute both, test the right one against each covenant.
- **Covenant EBITDA vs. reported EBITDA.** Use *covenant EBITDA* per the credit agreement when testing covenants; the difference can flip a flag.
- **Acquisition contribution rolled forward as organic.** Decompose growth into acquisition vs. same-store when M&A occurred mid-period.
- **LTM EBITDA from fewer than 4 quarters without flagging.** Don't silently extrapolate.
- **Silent risk-rating change.** If the proposed rating differs from the rating on file in nCino, surface the change explicitly.
