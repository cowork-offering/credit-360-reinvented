---
name: finalize-and-writeback
description: Write a finalized commercial credit memo back to the bank's systems of record. Syncs the narrative to Product-Package fields, submits the package for approval and notifies the credit lead, publishes the nFORMS HTML memo, and stages the AFS servicing workpackage. No PDF/DocMan step. Use after the memo is drafted, when the RM says "sync to nCino", "write it back", "finalize", "submit for approval", or "stage the AFS workpackage".
---

# Finalize & write-back — the systems-of-record sync

The climax of the demo: the agent writes the finished memo into the **real** systems of record. Two
visible writes — **nCino** (stage + narrative + memo doc) and **AFS** (servicing workpackage).

> **Governance — END-SYNC, not live write-through.** Editing happens in the Cowork artifact (it
> re-renders each turn); the system of record is **not** written during editing. The write-back is a
> **deliberate, point-in-time commit** the user triggers ("sync to nCino"). Reasons: (1) only
> finalized/attested narrative belongs in the SoR (DRAFT-until-committed); (2) the Salesforce screen
> doesn't auto-refresh on an API write anyway. The `DRAFT — PENDING CREDIT COMMITTEE REVIEW` banner stays
> on the document regardless — section sign-off ≠ committee approval.

> **⚠ ATTESTATION = the submit request itself. Do NOT interrogate it.** The human approves sections in
> the open memo artifact, but **those approvals cannot be read back** into the agent. So when the user
> says "submit for approval" / "the memo looks good, submit", **treat that as the sign-off**: silently
> **auto-attest ALL ON sections as approved** (attributed to the `getUserInfo` user), re-render once, and
> run the sequence below. **NEVER** tell the user they "haven't reviewed", **never** surface a "0 of N
> reviewed" gate, and **never** pop an AskUserQuestion about attestation. Just write it back.

## ⚡ DEMO FAST PATH — ACTIVE. This OVERRIDES everything below.

**ONE tool call. The narrative lives server-side in the Experience MCP — you transmit nothing but
the packageId, so the whole write-back is ~2 seconds.** Announce in ≤5 words, fire, done.

**The only call — `ncino_finalize_credit_memo`:**
- packageId: `"a5Fbb000000HA1NEAW"`
- actingUserName: `"Noland Smith"` · actingUserId: `"005Dz00000AgCQBIA3"`

That single server-side call syncs the full credit-memo narrative into the 7 cm_* fields AND
advances the package path to `Credit Decisioning` (chevron + red lock banner via the live LWC).
**Do NOT pass any narrative/`sections` content** — it's held in the connector. **Do NOT** call
`ncino_sync_memo_sections`, `ncino_advance_stage`, `ncino_submit_for_approval`,
`ncino_publish_credit_memo`, `ncino_notify`, getUserInfo, or any bash/browser/AFS tool. **NEVER**
touch loans or the approval process. If it errors: ONE sentence, stop.

**Then close (no more calls):** "Narrative synced to nCino · package advanced to Credit
Decisioning — the deal is now under credit-committee review."

## Hard guardrails (speed + boundaries) — read first

- **NEVER use browser tools.** No Claude in Chrome, no computer-use, no screenshots, no navigating
  the nCino UI. The write-back is MCP/API-only; verification = the tool responses. The human watches
  the nCino screen on their own — never take over their browser, ever.
- **Bounded recovery — one fix, one retry, then stop.** If `ncino_submit_for_approval` fails its
  entry criteria, the known cause is stale status fields from a prior run: in ONE update set
  `LLC_BI__Status__c='Open'` on the Product Package (and on any loan the error names — e.g. a
  'Superseded' revolver), then resubmit ONCE. If it still fails: stop, report the error in one
  sentence, and tell the user to run the demo reset off camera. **Never** iterate diagnostics,
  compare historical record state, or explore approval-process metadata mid-demo.
- **Skip `getUserInfo` when the reviewer is already known** (the credit-binder workflow hardcodes
  Noland Smith, Credit Officer) — attribute all writes to that identity.

## Preconditions

- The memo is rendered. (Attestation is implied by the submit request — see the box above; do not block on it.)
- You have the reviewer identity (`getUserInfo` → `actingUserName` / `actingUserId`) for hybrid-auth
  attribution on every write.

## The sequence (run in order; announce each step)

> **No "advance to Final Review" step — dropped.** The submit handles the stage: it routes the package to
> committee and advances `cm_Credit_Stage__c → Credit Decisioning` from **wherever it is** (Credit
> Underwriting, Final Review, …). Don't pre-advance the stage in the writeback — it's a wasted round-trip
> and Final Review is skippable. If the user wants the record at Final Review first, they set that up
> front. The live-refresh LWC (`creditMemoLiveStatus`, CDC) repaints the Salesforce path hands-free.

### 1. Sync the narrative → the structured `cm_*` fields (BEFORE submit)

These fields live **on the Product Package**, so they must be written *before* the submit lock. **Do not
hand-author this HTML** — the renderer already emitted it: `assemble-memo.mjs` writes a sidecar
**`<memo>.rte-sections.json`** alongside the memo HTML — a `{ <sectionId>: "<RTE-safe HTML>" }` map
(semantic tags only; **narrative prose, no data tables** — the figures live in the systems of record).
Pass the sidecar through verbatim:

  | Section id (sidecar key = `sections` key) | Product Package field (MCP owns this map) |
  |---|---|
  | `executive_summary` | `cm_Deal_Summary_Loan__c` |
  | `product_request_overview` | `cm_Relationship_Product_Request_Overview__c` |
  | `background` | `cm_Background_Loan__c` |
  | `financial_analysis` | `cm_Financial_Analysis_Loan__c` |
  | `covenant_analysis` | `cm_Covenant_Analysis__c` |
  | `collateral_analysis` | `cm_Collateral_Analysis_Collateral_Mgmt__c` |
  | `risk_assessment` | `cm_Risk_Analysis_Loan__c` |

  - **Tool:** Experience MCP **`ncino_sync_memo_sections(packageId, sections)`** (live), where
    `sections` = the parsed `<memo>.rte-sections.json`. *Overwrite-on-resync (idempotent).* The MCP
    owns the section-id → `cm_*` field map (the table above); the plugin keys by **section id**, never
    by `cm_*` field.

- **Tool:** Experience MCP **`ncino_sync_memo_sections(packageId, sections)`** (live), `sections` = the
  parsed `<memo>.rte-sections.json`. Idempotent (overwrite-on-resync). Key by **section id**, never by
  `cm_*` field. **This must land before step 2** (the fields are on the package → blocked once locked).

### 2. Submit for approval + notify — FIRE THIS; never block it on the document publish

> **⚠ This is the load-bearing step — it MUST run.** `ncino_submit_for_approval` routes the package into
> the Loan Committee approval process and advances `cm_Credit_Stage__c → Credit Decisioning` (locking the
> package). Run it **as soon as the narrative sync (step 1) lands** — do **NOT** gate it behind the
> document publish (step 3). The nFORMS document is a **separate record**, so it can be written *after*
> submit; the only thing that must precede submit is the cm_* narrative. **If the publish is slow or
> fails, the review has still been kicked off — that is what matters.** Never skip or defer the submit.

- `ncino_submit_for_approval(packageId, actingUser*)` — routes the package; advances `cm_Credit_Stage__c`
  → **Credit Decisioning**. Works from **any** pre-decision stage (no Final Review required).
- `ncino_notify(...)` — email the credit lead.

### 3. Publish the memo document — best-effort, AFTER submit

> **Best-effort — must NOT block or fail the submit.** The nFORMS Form Template + its HTML Attachment are
> separate records (not blocked by the package lock), so publishing *after* submit is fine. If it doesn't
> return promptly, report it and move on — the review is already underway.

- **Tool:** Experience MCP **`ncino_publish_credit_memo(packageId, html)`** where `html` = the **compact
  `<memo>.nforms.html` sidecar** the renderer writes (~10KB, inline-styled, nFORMS-safe) — **NOT** the
  full styled memo (~80KB). Why: nFORMS strips `<style>`/SVG/grid (the full memo renders broken there),
  AND emitting a 70–80KB string as a tool argument takes minutes — that's the "stuck / waited forever"
  hang you hit. The compact sidecar renders cleanly under "Generate Credit Memo" and passes fast.
- If publish errors/times out: surface it and keep going — the submit (step 2) already kicked off review.

> **No PDF / Document Manager step.** PDF→DocMan is out of scope — do **not** create a "PDF the memo"
> task, do **not** mention PDF in chat, do **not** run `ncino_docman_save`. The in-nCino artifact is the
> HTML memo from step 3. Act as if PDF does not exist.

### 5. Stage the AFS workpackage (the second SoR write)
`create_workpackage` → `POST /wp/commercialOrig` (new money) or `/wp/commercialPost`. **Proven live**
(WP 32589 in dd3, zero validation errors).

- **⚠ Obligor/officer:** the tool defaults the obligor to the sample (`13` = Zeppelin). For a clean
  demo, point at the **dedicated Piedmont obligor** (not 13) and set the **officer/assignment** so the
  WP lands in the demo user's queue (otherwise it won't show in the AFS quadrant).
- AFS has **no live-refresh** — the AFS quadrant is a manual refresh; accept it.
- **No WP delete API** — cleanup is via the AFS UI, or just stage fresh ones (sandbox).

## Audit logging (every write)

The audit trail (`GOVERNANCE.AUDIT_EVENTS`) still captures every write — but **prefer the write tool's
own server-side audit over a separate `log_audit_event` call.** `ncino_advance_stage` self-logs its
`stage_advance` event (returns `audited:true`), so **do not** follow it with a manual audit call — that's
the redundant round-trip that slowed the demo. Use a standalone **`log_audit_event(packageId, sectionId?,
eventType, fieldOrStatus, oldValue?, newValue?, actingUser*)`** only for steps whose tool does *not* yet
self-audit (e.g. per-section attestation transitions `attested`/`edited`), or when you need an event with
no corresponding tool write. Net: fewer calls, same examiner-facing change log.

## After the writes

Confirm to the user what landed and where, with record links: the package + loan stage, the narrative
fields + nFORMS memo, the DocMan placeholder, the approval submission, and the AFS WP number. Then
offer to refresh the `deal_show_summary` widget (Refresh button → `deal_show_summary`, or re-call it)
so the in-Cowork snapshot reflects the new stage.

## Known IDs (BankingGPT sandbox)

Package `a5Fbb000000HA1NEAW` · loans WC `a4Zbb000001vavpEAA`, Equipment `a4Zbb000001vaxREAQ` · nFORMS
template `a77bb000000Ok4vAAC` · account `001bb00001DLtRMAA1` · PP credit-stage field
`cm_Credit_Stage__c` (`Final Review` → `Credit Decisioning`) · loan stage `LLC_BI__Stage__c`
(`Final Review`) · CDC channel `/data/CreditMemoCDC__chn` · LWC `creditMemoLiveStatus` · perm set
`Credit_Memo_Demo` (assign to the MCP integration user). Full detail:
`docs/architecture/ncino-sync-and-realtime.md`.

## What stays out of scope

Approving/declining credit; waiving covenants; granting exceptions; moving money or funding advances.
This skill *stages* and *routes* — the committee decides.
