# DESIGN 0.9.28: the statement register in the Spreading workroom

Founder, 2026-09-15: "Noland has a ton of exciting spreading stuff in there, check the MCP UIs for the
workroom, with surgical precision; cool, sexy and working; but please in the workroom." Design pick
delegated to the orchestrator ("work away, let me know when it all done in 9.28"); logged in
`logs/intent-gate.jsonl` 2026-09-15T00:40Z.

## What Noland's widget is (boom-mcp/widget/workspace.html, one bundle behind three tools)

One widget, three entry documents, two compositions (inline card, fullscreen workspace). Book view
(KPI tiles, borrower table), Borrower view (Overview, Source files, Financials, Financial analysis),
Upload view (dropzone, per-file lifecycle, an explicit "Start Boom reading?" gate). Rendered frame:
`scratchpad/boom-ui/workspace-financials.png` (Piedmont, Financials tab).

The insight is the Financials register: a real statement dropdown, a period picker, units Full/K/M,
"Use adjusted data" as a SERVER re-read (adjusted flag on `boom_get_spread`), Variance and Variance %
columns with `n/m` where the prior is not meaningful, account-code chips in eleven colour families with
a mis-mapping flag, a per-period coverage tick against the statement-level "Validated in Boom", a
provenance footer that cites file, period, source and method with "Open in Boom", and a governed action
bar last. Type is Graphik on the Electric Glass ground, spreadsheet density (108 px period columns).

## The cockpit today

Spreading room: steps spine, dropzone that collapses to a bar, one growing `.sp-act.wk-sheet` (plan,
ladder, spread), KPI tiles, trend SVG, `SpreadStatements` (statement tabs, line + values only), the
provisional / validated badge with the Verify link, `SpreadProse`, two doors. Financials tab: trend card,
key ratios, a four-column "LTM vs prior year" income table, a Note line.

## The one option (built in 0.9.28)

The register goes INTO THE SPREADING WORKROOM'S SHEET, replacing `SpreadStatements`: `SpreadRegister`
with the statement `select`, the period picker, Full/K/M, the Adjusted / As given switch (re-reads
`boom_get_spread(adjusted)` through the lane, never filters locally), the Variance toggle (Variance and
Variance %, `n/m`), account-code chips (`--cat-*` families, the only new tokens), the mis-map flag, the
per-period coverage tick, the "Validated in Boom · N of M lines carry a Boom account code · $ in
thousands" line, and the provenance footer with Open in Boom. The room still ends in exactly two doors.

The Financials tab receives the SAME component in `compact` mode (statement select, Variance on, three
newest periods, no footer) in place of the four-column table, so there is one register language.

Not ported, by doctrine: the KPI band and sparkline cards (the room's tiles and trend already carry
revenue, EBITDA, leverage, coverage; a fact twice is a fact wrong), the read rail (`SpreadProse` is the
prose), the upload dropzone, lifecycle strip and confirm gate (the room's own steps own that arc), the
fullscreen and inline switch (a host concern), the book view and search (the cockpit's own relationship
surfaces), the widget's action bar (a third pill under the sheet would put the model's panel under the
artifact).

Components: `app/src/components/workroom/register/SpreadRegister.tsx`, `registerModel.ts` (pure, tested
on the live Piedmont fixture `app/src/__fixtures__/boom-live/spread-piedmont.json`), `register.css`.
