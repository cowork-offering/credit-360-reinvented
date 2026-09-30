# DESIGN 0.9.33: the stage while Salesforce works

Founder, 2026-09-29, on a Hartwell rollback: "when i am performing a rollback it basically looks like its
stuck ... it stayed static".

Option (one, rendered): `preview-site/builds/stage-wait-option/index.html`, shared at
https://bot.connectry.io/s/a6e12f23e394/ . It is built from the real plan and tracker of STG-0000000183.
Source: `_src/stage-wait.template.html` plus `_src/assemble.py`, which inlines the 0.9.29 option's stylesheet
verbatim so the glass register is the same one.

## What was measured

- `execute_discard_version` is one call. The org commits the whole discard in one transaction, so nothing
  can be seen part way through. The staging row still reads Staged from outside until the commit.
- STG-0000000183: token consumed 10:21:13Z, row Completed 10:23:04Z, which is 111 s inside the org. The
  relay journal says 112 s wall clock. Earlier discards took about 11 s.
- Today's sheet during that wait: the heading "Working through the plan", every row still, and at 45 s a
  warning notice (`UNSETTLED_*`). Then the reveal played about a minute later.

## The rule the option keeps

The wait may not show progress for any row. No row lights, no ">" fills and no count moves until the answer
lands, because the org has reported nothing. What the wait can honestly show is (a) the sheet is listening
and (b) how long it has been. Nothing turns amber until either the org says it stopped, or the wait passes
a ceiling that the evidence says is abnormal.

## What moves

**The lens pass.** It belongs to the list, not to any row. A soft band in the brand's own wash
(`rgba(117,0,192,.095)` core, multiply) crosses the whole visible list from top to bottom in about 3.5 s,
rests, then crosses again, on a 4.8 s cycle. It uses `background-position` on one absolutely positioned
layer over `.gs-rows` (paint only, no layout). Every pass is the same: it never slows on a row, never stops
on one, and never changes with the count or the elapsed time, so it cannot be read as position. The queued
rows sit a touch quieter (opacity .66, against .78 in the plan beat) because they are read-only while the
org has the plan.

- It starts at the press, after the pill's 380 ms press hold.
- It stops the moment the answer lands: the layer fades out over 240 ms, and the existing reveal starts
  `T.toFirst` (560 ms) later. The two never overlap.
- It keeps running past the ceiling, because the call is still open.

No other motion is added. The aura stays still, as in 0.9.29.

## What the copy says, and when

One line sits under the lede, inside the header, with a quiet clock (m:ss, tabular, `--ink-faint`) at its
right. Because it lives in the header, it goes quiet with the header when the close arrives. When the line
changes it cross-fades over 320 ms, in the same ink and the same size.

| Elapsed | Line | Clock | Notice |
|---|---|---|---|
| 0:00 to 0:44 | Salesforce is removing this version in one pass. The rows settle when it answers. | counts | none |
| 0:45 to 2:29 | Still with Salesforce. Rollbacks through the relay have taken close to two minutes. | counts | none |
| RUN_IN_FLIGHT (any time) | Salesforce reports this run still going. The rows settle when it answers. | counts | none |
| 2:30 onward (ceiling) | Still with Salesforce. | counts | warning: **Longer than any rollback the relay has shown.** Nothing has said it failed, and the rows stay as they are until it answers. Check the version in Salesforce before staging this again: filing it twice cannot be undone from here. |
| Answer lands | Salesforce answered after 1:52. | stops (the time moves into the line) | none |

Wording decisions:

- The line says "Still with Salesforce", not "Still working". The page knows that the call is open. It does
  not know the org is working, because the trail reads Staged until the one transaction commits. Saying
  "working" would claim a state the org has not reported.
- The line says "have taken close to two minutes", not "can take up to two minutes". It is evidence (112 s),
  not a promise, and it stays true while the clock reads 2:05.
- RUN_IN_FLIGHT is the one case where the org itself reports the run is still going, so only that line may
  say so. It uses the same register as the plain wait: no notice and no amber.
- At the ceiling the line shortens, so the notice is the only place the news appears (no fact twice). The
  notice does not repeat the elapsed time, because the clock already shows it.
- Warning ink before the ceiling appears only when the org's own trail says the run stopped. That is the
  existing stop scene (a `recovered` outcome with a Failed or Partial trail), so the wait adds nothing for
  it.

## The ceiling: 150 s

The ceiling is 112 s (the longest observed rollback, STG-0000000183) plus about a third for margin, rounded
to 2:30. It is the first point where the wait is longer than anything the relay has been seen to do. Before
that, a long wait is not news. Revisit it as the relay journal builds up samples: use the p99 of discard
wall clock plus 30 s.

## Reduced motion

It reaches the same ending. There is no lens pass and no swap fade. The clock still counts, because it is
content and not motion. When the answer lands, the list empties, the closing sentences are shown whole and
the doors appear, all in one commit. That is the existing reduced branch at `GovernedStage.tsx:334-352`.
The option has a toggle for this and also honours `prefers-reduced-motion`.

## The reveal heading

The column heading during the reveal changes from "Working through the plan" to "As Salesforce reports it".
By the time the reveal plays the work is already done, and the rows are reading the org's answer.

## Build changes (no app source edited in this pass)

### `app/src/components/governedConfirm.ts`

1. **Keep "in flight" separate from "executing".** At 45 s the `finally` (lines 292-295) sets
   `executing=false`, but `work.then(settle, fail)` (line 284) is still pending. Add `sentAt: number | null`,
   set it next to `setExecuting(true)` (line 209), and clear it in `settle` and `fail` (lines 232-267). The
   stage reads `waiting = sentAt !== null && !outcome && !toolError` instead of `executing`.
2. **Add the ceiling.** Export `STAGE_CEILING_MS = 150_000` next to the hook. The stage computes `overdue`
   from `sentAt`. The hook does not need a second timer.
3. **Surface RUN_IN_FLIGHT.** `grep -rn RUN_IN_FLIGHT` across `/opt/connectry/projects` finds nothing today.
   The code has to come from the executor or relay. Or it can be mapped in `writeTools.ts executeAction`
   (around lines 1525-1560) from an `UNABLE_TO_LOCK_ROW` on the claim of `cm_Action_Staging__c`, which is
   the org's own signal that another transaction holds the row. Either way, add `inFlight: boolean` to the
   hook's return (lines 303-318), set it when a retry answers RUN_IN_FLIGHT, and do NOT turn it into
   `toolError`. The call is re-asked under the same key until the ceiling.
4. **Unchanged:** `EXECUTE_CLOCK_MS` (`writeTools.ts:1465`) stays 45 s. `ConfirmGate` (the other actions)
   and `settleFromTrail`'s budget (`writeTools.ts:1577`) still use it. On the stage, `unsettled` becomes the
   line swap at 45 s instead of a notice.

### `app/src/components/GovernedStage.tsx`

1. **The clock `T` (lines 64-86):** add `swap: 320` and `lensOut: 240`. Import `STAGE_CEILING_MS`.
2. **`press()` (lines 413-418):** no change to the gesture. The wait starts from `gate.sentAt`, not from
   the press, so a blocked or drifted press never shows a clock.
3. **A 1 s ticker, only while `waiting`:** `useEffect` with `setInterval(1000)`, cleared on the answer. It
   stores `elapsed` and picks the line by these rules: `overdue` gives "Still with Salesforce.";
   `gate.inFlight` gives the RUN_IN_FLIGHT line; `elapsed >= EXECUTE_CLOCK_MS` gives the "Still with" line;
   otherwise the plain line. Put the copy constants in `ConfirmGate.tsx` next to `UNSETTLED_*` (lines 54-58)
   as `STAGE_WAIT`, `STAGE_STILL`, `STAGE_IN_FLIGHT`, `STAGE_LATE_TITLE`, `STAGE_LATE_BODY` and
   `stageAnswered(mss)`.
4. **Header (lines 454-459):** after the lede, render `<div className="gs-wait" data-on>` with
   `<p className="gs-wait-line" aria-live="polite">` and `<span className="gs-wait-clock tnum">`. When the
   answer lands the clock empties and the line becomes `stageAnswered(mss(elapsed))`.
5. **Sheet (line 448):** add `data-wait={waiting ? "" : undefined}`. In the inventory (lines 468-482), wrap
   `<ul className="gs-rows">` in `<div className="gs-rows-wrap">` with a sibling
   `<div className="gs-sweep" aria-hidden="true" />`.
6. **Column heading (line 465):** `running ? "As Salesforce reports it" : ...`. Only the reveal sets `run`
   now: set `phase` to a new `"wait"` value in `press()` and to `"run"` in the effect at line 353.
7. **Run effect (lines 327-357):** unchanged. It is armed by `outcome` and plays after `T.toFirst`. The
   `data-wait` attribute is removed in the same commit that sets `outcome`, so the sweep's 240 ms fade sits
   inside the 560 ms `toFirst` lead.
8. **Unsettled notice (lines 621-626):** replace `gate.unsettled` with `overdue && waiting`, and the title
   and body with `STAGE_LATE_TITLE` and `STAGE_LATE_BODY`. Keep warning tone.
9. **Asking again (lines 583-587):** while `waiting`, do not render the warning notice. Instead, show
   `ASKING_AGAIN` (`writeTools.ts:1117`) as the wait line for one cycle, in the same register. It is a fact
   about the wire, not a warning.

### `app/src/styles/stage.css`

Port from the option: `.gs-wait*`, `.gs-rows-wrap`, `.gs-sweep` with `@keyframes gs-lens-pass`,
`.gs-sheet[data-wait] .gs-row[data-state="queued"] .gs-row-b{opacity:.66}`. Add `.gs-sweep{display:none}`
and `.gs-wait,.gs-wait-line{transition:none}` to the reduced-motion block (lines 687-713).

### Tests

- In jsdom (reduced motion), no line is ever rendered in warning tone before `STAGE_CEILING_MS`.
- RUN_IN_FLIGHT never produces a `gs-notice`.
- The answer clears `data-wait` in the same commit as the ending.
- No row changes `data-state` before `outcome`.

## Two things found while reading (not part of this option)

- `GovernedStage.tsx:431` takes `plan.warnings[0]` as the count line. For STG-0000000183 that warning is
  the self-anchor RL-00000831 sentence. The count line ("This action DELETES 17 records ...") is
  `warnings[2]`. The option shows the count line. The build should pick the warning that carries the count,
  not index 0.
- The executor's `verify_version_gone` detail carries a record id ("Version package a5Fbb... no longer
  resolves."), and `closingSentences` (`actions/stageModel.ts:228`) puts it on the glass verbatim. The
  option shows the package name instead. The fix belongs in `ExecuteDiscardVersion.cls` (name the package),
  or in the stage's closing mapping.
