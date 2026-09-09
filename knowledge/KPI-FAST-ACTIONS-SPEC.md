# KPI fast-actions — next-iteration spec (Fabian, 2026-09-10)

## The ask
The landing's KPI numbers (Needs action, Reviews due, EWS active) should be
CLICKABLE. Clicking opens a sleek popup that shows the actual relationships
behind the number and DIRECTLY guides the banker: "this needs doing, here is
what I need from you", with the correct workroom opened and its inputs
pre-selected. A fast-action triage launcher, not just a filter.

## Which cells are actionable
- **Managed exposure / Drawn balance / Utilization** — informational, NOT
  clickable (or a soft "view the book" at most). No action attaches to a total.
- **Needs action** — the whole queue. Each row deep-links to its reason's flow.
- **Reviews due** — covenant tests + annual reviews due. Row -> covenant review
  or annual review workroom, pre-scoped to that package.
- **EWS active** — breaches + maturities in window. Row -> covenant review (breach)
  or renewal/maturity action.

The buckets already exist: KpiBand derives them from the confined portfolio
(`data.portfolio.signals` + `worklist`). The popup is an action-oriented,
per-relationship view of the SAME sets, so no new read is needed.

## Reason -> workroom mapping (the "pre-selected" part)
Reuse the existing reason codes (data/contract ReasonCode) and workroom flows:
- COVENANT_BREACH / COVENANT_DUE / COVENANT_EXCEPTION -> `stage_covenant_review`
  (package-scoped bulk covenant review), pre-seed the package + the failing covenant.
- CLIENT_REQUEST -> loan modification flow, package-anchored, pre-seed the request.
- MATURITY_NEAR -> renewal / new-facility flow, pre-seed the maturing loan.
- Reviews due (annual) -> `stage_annual_review`, pre-seed the relationship.
- GUARANTOR_SIGNAL / RECENTLY_MODIFIED -> open the relationship on the right tab.

Each row carries a one-line WHAT + a primary CTA that opens the workroom with
those inputs already chosen, so the banker lands mid-flow, not at step one.

## Surface (the sleek popup) — proposed, confirm before building
- **Anchored popover** dropping from the clicked KPI cell (not a full modal):
  keeps context, feels fast. FLIP/scale-in from the cell, ~180ms, ease-settle.
  Falls back to a centered sheet on narrow widths.
- Register: the existing cockpit system — cream `--surface-raised`, hairlines,
  ink type, ONE accent `#A100FF` on the primary CTA only (rule 21/13: no purple
  bloom, no pill soup, status = a coloured word + dot).
- Header: the bucket name + count ("3 need action"). Then a stack of rows,
  each: avatar + name + the specific reason (with its own clock, "test 25d
  overdue") + exposure + a right-aligned primary CTA ("Start covenant review").
  Row hover = lift + shadow (rule 20), never an inset spine.
- A quiet secondary on each row: "Copy prompt" (the cockpit is chat-native) that
  drops a pre-typed instruction into the composer, since some bankers drive by
  chat. So each row offers BOTH: open the workroom, or hand the agent the prompt.
- Keyboard: arrow to move, Enter opens the CTA, Esc closes. ⌘K still the global.

## Reuse, don't reinvent
- The row markup and reason chips already live in `components/Worklist.tsx`
  (statusesFor, REASON_META, the wl-info popover). The popup rows should share
  that vocabulary so the queue and the popup read identically.
- Opening a workroom pre-seeded is the same path the FAB / palette already use
  (`openWorkroom`, the staged-plan intents). The popup is a new ENTRY into
  existing flows, so the build is a component + wiring, not new domain logic.
- Deterministic math stays in the tools; the popup only routes.

## Build sketch (0.9.6)
1. Make actionable KpiCell clickable (role=button, aria), emit a bucket id.
2. New `components/KpiActionSheet.tsx` (anchored popover) that takes a bucket +
   the relationships in it (from the same derived sets KpiBand already has).
3. Per-row CTA -> the reason->flow map above, opening the workroom pre-seeded;
   secondary -> pre-typed composer prompt.
4. Motion + a11y per the register; tests (render + a click routing each bucket
   to the right flow); probe: a scenario clicking each KPI and asserting the
   popup lists the right set and the CTA opens the right workroom.

## Status
Parked to the next iteration at Fabian's call (2026-09-10). This is additive to
0.9.5 (cold-open skeleton); no dependency between them.
