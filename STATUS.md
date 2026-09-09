# Credit 360, status and changelog

## Changelog

- **0.9.0 (2026-09-09)** The product is named Credit 360 everywhere (plugin `credit-360`, skill
  `credit-360-cockpit`, page title, docs); the Salesforce connector keeps its name `Customer 360`.
  Marketplace repo `cowork-offering/credit-360`. Polished README with connector setup.
- **0.8.x (2026-09-08 to 09)** The book's read is a poll, not a watch (the runtime refuses a watch on
  this connector's tools). The hero summary and chips are derived live for every relationship. The
  vendored memo copy names the rating source AFS. Live worklist derived from Customer360Portfolio;
  the book rule (exposure or a grade); a new facility always creates a new Product Package.
- **0.7.0 (2026-09-06)** Stability build: instant open, last-good cache, per-lane retry and knock, wall
  clocks, the Salesforce Read Backup lane, room deadlines and resume, chaos harness, memo store lean.

**Read this first.** This repo is the single source for Credit 360: code, plugin packaging,
and the full knowledge tree (`knowledge/`). New sessions start here, then
`knowledge/HANDOFF-2026-07-27.md` for deep context.

## Why this matters

Credit 360 is a **component of the Commercial Credit Brain** (alongside the Commercial Credit
Memo) and **the showcase for Dreamforce**. The story it carries: a governed, write-capable MCP
server built entirely Salesforce-native (Apex invocables + McpServerDefinition, no middleware),
with a product-grade cockpit on top. Deliverable quality bar: spot-on.

## What exists, all live-verified

| Layer | State |
|---|---|
| **Salesforce MCP server** | 24 Apex tools in org `bankinggpt`, `Customer360` McpServerDefinition (23 in artifact manifest). 9 reads + stage/execute write pairs (bulk collateral valuation hardened to a required package anchor + required per-item date + 20 cap, service request, annual + risk-rating reviews, new facility w/ package-first + borrowing structure, package-scoped BULK covenant review) + modification stage/execute pair + stage-only renewal. WS0.5 items 2+3 (2026-08-22) changed those two tool SHAPES; no tool name changed and the McpServerDefinition was not touched. Engine: plan/planHash/single-use decisionToken, write-guard transition allowlist, idempotency, verification re-queries. Apex suite 170/170. Rebuild mirror: `knowledge/sf-build-v2/wp2/`. |
| **Cockpit (React)** | `app/` — worklist-first client overview (KYC & Onboarding removed from scope 2026-08-27), deal-grammar tickets (package-anchored mod/renewal, bulk collateral picker, review fork), email→action suggestions, sync tiers + persistent overlay, ~1,200 tests. Compiled to `artifact/customer-360-template.html`. |
| **Published artifact** | claude.ai artifact URLs (main `f7a6006f-…`, copy `95cf2a8d-…`), verified byte-identical to repo HEAD bundle + data. Page calls connectors live via `window.claude.mcp` with viewer credentials. |
| **Cowork plugin** | `.claude-plugin/` + `skills/credit-360-cockpit` + bundled template + `render/assemble-cockpit.mjs` (agent fetches data → assembler bakes JSON → Cowork artifact). ⚠️ Plugin bundle STALE at commit `6eda1b6` (Jul 26) — pre-deal-grammar. Sync = outstanding item 1. |
| **Demo data** | Hartwell Industrial Group (91 records, $46MM, 6 booked loans, ids in `knowledge/DEMO-RELATIONSHIP.md`) + Piedmont anchor. Live-observed envelope datasets baked in `artifact/live-data.json`. |

## Wiring map

- **Org:** `bankinggpt` (shared Accenture sandbox — refresh risk acknowledged; mirror in
  `knowledge/sf-build-v2/` is the rebuild path). sf CLI auth on the Archy box.
- **Connectors (claude.ai):** Customer 360 (org MCP), IDB Gateway (LLM, 3 tools),
  Microsoft 365 (`outlook_email_search`).
- **Publish pipeline:** `app/npm run build` → `scripts/release-artifact.mjs` →
  `app/scripts/assemble-artifact.mjs` (full-tag marker injection, slot-verified — NEVER ad-hoc
  replace, see HANDOFF hard lesson) → Artifact republish to both URLs.
- **Sibling product:** Commercial Credit Memo (plugin `credit-memo-reinvented`, Experience MCP at
  `experience-mcp.vercel.app`). Shared doctrine: skills carry methodology, servers carry facts and
  writes, plugins ship the parts.
- **Dev seats:** Archy box (original) + **Banksy** (`ubuntu@98.87.86.133`) — migration COMPLETE and
  verified 2026-08-14: repo cloned at `/home/ubuntu/projects/customer-360` with working GitHub push
  auth (Credit Brain Dev app token), all 39 knowledge docs indexed in hybrid recall (probes 0.99-1.00),
  ontology nodes linked (repo -> project -> product, server -> project). Banksy rule: everything
  ubuntu-owned, never sudo git.
- **Functionality status: COMPLETE and live.** Everything in the "What exists" table works today on
  the published artifact URLs against the real org. The outstanding list below is packaging, sign-off
  and gated-by-design items — not missing functionality.

## Outstanding (priority order)

1. **Plugin sync** — refresh bundled template/data/skill to repo HEAD (`20bf17a`), skill prose
   still says 8 read tools (24 exist), version bump 0.4.1 → 0.5.0.
2. **Fabian's 100%-certain click-through** — incl. staging a real modification on a Hartwell
   booked loan (task open since July campaign).
3. **Codex adversarial review** of the full campaign delta (planned closer, never run).
4. **⚠️ ARMED WARNING:** renewal clone field set does not exclude `Loan_Collateral_Aggregate` —
   re-probe before `execute_renewal` is ever unblocked (HANDOFF §2).
5. ~~**Covenant execute** — founder-gated.~~ CLEARED 2026-08-22 (WS0.5): run live on both arms on
   throwaway data, now in the manifest and called by the cockpit behind the confirm gate. What still
   holds it is the ORG — `executionHeld` on the staged plan, and a per-covenant refusal on any
   compliance row that is not Pending unless the banker opts in.
6. **Renewal execute** — stage-only by design (clone collateral-aggregate re-probe outstanding). Modification execute shipped 2026-08-22 (WS0.5); the cockpit calls it on both surfaces.
7. Housekeeping: Piedmont test rows (CV-0000000002/3, R-4) deletion decision; Credit Memo 0.54.0
   connector swap (sibling, tracked there).
8. Dreamforce is now CONCRETE: SPIN booth (690 Folsom St, SF), Sept 15-16 2026, C360/Cowork =
   **Demo 2, COMMERCIAL banking** (Wealth = Demo 1, the web app — the "steer C360 to Wealth" idea
   is superseded for the demo; Wealth stays roadmap). The print-approved journey panel names our
   email-to-action moment; the demo must deliver it, and has NO voice. Full context:
   `knowledge/DREAMFORCE-SPIN-CONTEXT.md`. Demo script still on Fabian's hold.
9. **Regulatory currency:** SR 11-7 superseded by **SR 26-2** (Fed, Apr 2026) — update citations
   after the control-set diff (see DREAMFORCE-SPIN-CONTEXT.md).

## Key doctrine (short form; full: knowledge/HANDOFF + LESSONS-NCINO-APEX)

- Stage = zero domain DML; execute = exactly `{idempotencyKey, stagingId, planHash, decisionToken,
  approverUserId}`; approver == running identity.
- Observe wire envelopes before pinning shapes (invocable `required=true` is REST-enforced,
  test-invisible).
- Aggregate-by-identity on every per-involvement list; honest empties; display correctness is a
  contract for ALL relationships.
- Never touch pre-existing bankinggpt build; additive deploys with receipts.
