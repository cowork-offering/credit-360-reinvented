# Credit 360, status and changelog

## Changelog

- **0.9.11 (2026-09-10)** FILED-FINALE BUTTONS, MADE GLASS. The two doors
  ("Draft the credit memo" / "Back to <account>") were still reading too dark:
  the primary sat on a near-black ink pill against the cream sheet. Both are now
  the sheet's OWN material — translucent white, hairline, the same backdrop blur
  as the card — so they belong to the finale instead of sitting on top of it.
  The primary is a touch more opaque and warms to the brand violet on hover; the
  secondary is lighter and quieter. Also fixed the button FONT: a bare <button>
  had fallen back to the browser's UI font, so the labels were off; both now
  inherit the card's --font-sans. CSS only.

- **0.9.10 (2026-09-10)** KPI FAST-ACTIONS POPOVER — the landing's actionable
  numbers now open. Clicking **Needs action**, **Reviews due** or **EWS active**
  (the totals stay plain — no action attaches to a sum) drops an anchored popover
  from the cell. Each row states the account's own "so what" (a breach reads
  "23d overdue, a real miss to record against threshold"; a maturity reads
  "matures in 18d") and offers two doors: a primary CTA that opens the workroom
  named for the concern (Start covenant review / Start renewal / Open the request)
  and a quiet "Copy prompt" that drops the account-specific instruction into the
  composer for the chat-native banker. Both the read and the prompt come from ONE
  ACTION REQUIREMENT declaration (`kpiActions.ts`), so they never drift. Reuses
  the queue's own rows and the proven open path (flyName / openAccountLive); the
  popover only routes. New `components/kpiActions.ts` + `KpiActionSheet.tsx`, 6
  derivation/routing tests; full suite 4170 green; register-clean (one --brand
  accent on the primary CTA, hairlines, rule-13 no meters).

- **0.9.9 (2026-09-10)** SHIPPED-TEMPLATE FIX, the reason 0.9.2 through 0.9.8
  "showed no change" for viewers. The release steps bumped `plugin.json` and
  promoted the fresh build to `artifact/customer-360-template.html`, but never ran
  `scripts/sync-plugin-assets.mjs`, so the plugin's OWN payload template
  (`client-360/assets/customer-360-template.html`, which the rebuild path and
  every fresh publish actually read) stayed frozen at the 0.9.1 build. The
  cinematic boot skeleton, the guidance chips, the finale restyle and the new-PP
  link were all in the repo but never reached a rebuilt cockpit. Synced the plugin
  payload to the 0.9.8 build (byte-identical, drift check clean) so a rebuild now
  serves the skeleton (no more raw five-relationship flash) and every shipped fix.
  DIRECTIVE: every release MUST run `node scripts/sync-plugin-assets.mjs` (or its
  `--check`) before commit — a version bump without the sync ships a stale plugin.

- **0.9.8 (2026-09-10)** The shared read card (covenant review, structure,
  collateral) no longer stretches in the wider relationship room: it was capped
  at 86% of the column, which ballooned it and opened a canyon between each label
  and its figure. Capped to min(86%, 560px) so the figure stays a glance from its
  label in either room. CSS only; full suite 4164 green.

- **0.9.7 (2026-09-10)** MODIFICATION, MADE GUIDING AND ROBUST FOR THE DEMO. (1) A
  one-click "Keep <current>" chip on every rate / amount / term / maturity
  question (modify + renew), so keep-current is a click, never a typed word you
  must know. (2) The FORCED rate ask now takes a typed "hold" / "keep it" too, not
  only its chip — a banker who types it at the ask they cannot skip is no longer
  stuck. (3) The filed finale speaks the room's own button language (ink pill,
  brand violet on hover; the dark-plus-purple-halo look is gone) and LINKS to the
  package the filing created ("Open the new package in nCino"). Full suite 4164
  green. Known next: collateral loop, new facility, covenant review + collateral
  valuation (relationship room).

- **0.9.6 (2026-09-10)** TWO WORKROOM IMPROVEMENTS, shipped together with the 0.9.5
  cold-open work. (1) A BUG / COPY-TRANSCRIPT BUTTON: a quiet ink glyph in every
  workroom header and in the chat copies the whole conversation to the clipboard
  as markdown (agent lines, typed answers, clicked chips, settled receipts), so a
  tester or banker can paste the exact end-to-end back for feedback. Read-only,
  reads each surface's own already-complete state. (2) "HOLD" NO LONGER LOOPS:
  answering a rate / amount / term / maturity question with "hold" / "keep it" /
  "no change" / "leave as is" / "unchanged" / "same" now holds the field at its
  current figure and moves on, instead of re-asking the same question forever
  (parseModify keep-current, shared by modification and renewal). Recognised only
  where the field's own reader found no value and the line carries no digit, so
  "keep it at 7%" still stages 7%. KNOWN, NOT YET FIXED: the pricing-gate rate
  CHIP ("Hold 7.60%") and the create/collateral asset-kind loop are separate
  paths and land next. Full suite 4161 green.
- **0.9.5 (2026-09-09)** THE COLD OPEN NO LONGER FLASHES THE BAKED TEST BOOK. On a fresh open with a
  connector the landing showed the five baked relationships (three of them samples) for the few
  seconds the live Customer360Portfolio read takes, then swapped abruptly to the org's real book.
  Two changes close it. (1) A BOOK CACHE: every good portfolio read is written to one `cache/book`
  document (channel/lastGood.ts, putBook/loadBook), and the next open seeds from it, so a returning
  viewer sees their own last book instantly, marked with its age, and the live read settles over it
  identically when nothing moved (same object reference, no reflow). (2) A CINEMATIC SKELETON: a
  truly fresh open with nothing cached shows a shimmer of the real band, briefing and queue geometry
  (components/HomeSkeleton.tsx, gated by a new `booting` flag on useLivePortfolio) instead of the
  samples, and the book reconciles in when it lands. Neutral wash sweep, rule-21 clean (no purple on
  the ground), reduced-motion stills to a flat wash. A share link with no connector never boots and
  renders the baked book exactly as before; a wedged read reveals the baked book at a backstop
  (~READ_DEADLINE + 2s) rather than shimmering forever. 17 new tests; probe re-run green except two
  pre-existing date-drift assertions (sc12 severity order, sc13 "in 153d" now 122d) unrelated to this
  change. The two probe helpers (`openPage`, `openAccount`) now wait for the settled home, and six
  navigation-test files open the home pre-settled via the `__skipBootForTests` seam.
- **0.9.4 (2026-09-09)** A FIRST OPEN ON A NEW SEAT NOW WORKS END TO END. Two defects sat on step 4
  of the open, the path a viewer with no cockpit takes. (1) The shipped five-borrower book,
  `assets/live-data.json`, could not be assembled at all: it was baked in two passes and the clock
  was left at the first, so five Hartwell activity rows postdated `meta.generatedAt` and the
  assembler's A10 assertion refused the file. The DATA is fixed, not the assertion: no repo script
  queries the org (a re-bake needs a session holding the Customer 360 connector), so
  `meta.generatedAt` moves to the LATEST OBSERVATION TIMESTAMP the file carries, computed over every
  historical instant in it (`activity[].ts`, `requests[].receivedAt`, boom `createdAt`):
  `2026-08-25T04:55:34Z`. Forward-looking scheduled dates run to 2036 and are excluded by design,
  since they are compared against the clock as a window. A new `meta.generatedAtNote` records the
  two-pass history and what the next re-bake must undo. The corrected clock changes three derived
  states on Hartwell and the tests move with it: the room's opener now leads on the DSC test 36 days
  out rather than the AR test 6 days out, the AR test reads 25 days overdue in the room's overdue
  tier, and the ticket quotes Aug 25 as the prepared-on date. The quiet-tier negative test now
  CONSTRUCTS its "nothing overdue" premise instead of inheriting it from whatever the last bake held.
  Challenge count (19) and data-quality findings (1) are identical on both clocks. (2) The favicon had
  no value anywhere in the repo, so a first publish had nothing to pass. It is 🏦, the icon the
  canonical cockpit carries, now fixed in `SKILL.md` step 4, `app/PUBLISH.md` §6.5 and
  `assets/cockpit.json`'s `_comment`: on the first publish, never changed. Step 4 also now names its
  DATA: it bakes the bundled `assets/live-data.json` with no fetch in front of it, because the page
  refreshes itself through the viewer's own connectors on landing, and `assets/sample-data.json` is
  test-only and never published to a banker. Step 4 carries one honest caveat: the bundled snapshot
  stages the baker's `meta.userId`, so the first governed WRITE from a fresh seat needs a rebuild from
  that viewer's own session.
- **0.9.3 (2026-09-09)** The cockpit resolves PER VIEWER, because a single canonical URL cannot serve
  more than one organization. An artifact declaring runtime capabilities is organization-internal and
  never opens by public link, so the pinned `canonicalArtifactUrl` (published 13:24 from an account in
  a different claude.ai organization) answered "artifact not found" for every other seat. The open now
  takes, in order: the URL this session's own publish returned; the most recently updated artifact
  titled "Credit 360 · Relationship Cockpit" (or the older "Customer 360 · Relationship Cockpit") the
  viewer owns or is shared, found with `list` over `scope: "all"` and verified with `read`; the
  canonical URL, only if `read` succeeds for it; otherwise a fresh publish on the rebuild path, with
  one line telling the viewer to share it to their organization from the page's Share control. Steps 1
  to 3 stay instant: one listing call and one read, no fetch and no assembler. "One URL for everyone"
  is retired everywhere in favour of "one cockpit per organization, resolved per viewer". Skill, agent,
  README, RUNBOOK, `cockpit.json` `_comment` and the plugin description. No code change.
- **0.9.2 (2026-09-09)** Marketplace `cowork-offering/credit-360-reinvented` (name `credit-360-reinvented`,
  owner Fabian Goetzens); the two same-day predecessors `credit-360` and `credit-360-cockpit` are deleted.
- **0.9.1 (2026-09-09)** The canonical cockpit is republished under a new claude.ai account and
  `client-360/assets/cockpit.json` points at it. No code change; the bundle is the 7f5b399 build.
  Cowork never refreshes a marketplace it has fetched, so a hand-over is always a fresh repo and a fresh name.
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
