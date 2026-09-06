# Look-gate references: the filed finale

Two surfaces `liquid-shots.mjs` did not have until 2026-09-06, because neither
existed: the sheet the rainbow card grows into when a filing lands, and the memo
room it hands to. Both are shot the way every other surface here is: 2x,
reduced motion, light scheme, against the built bundle with the stand-in org.

    node liquid-shots.mjs --out /tmp/shots-after --surfaces finale-sheet,memo-after-handoff
    node liquid-shots.mjs --diff design/probes/reference/liquid-shots --against /tmp/shots-after

`finale-sheet` and `memo-after-handoff` are the only files here; every other
surface's reference lives wherever the pass that shot it put it, and the gate
those nine hold to is the `--diff` against the baseline bundle, not a file in
git. These two are checked in because a NEW surface has no baseline to diff
against and would otherwise never be gated at all.

WHAT WILL MOVE THEM LEGITIMATELY. The clock in the sheet's stamp is the room's
own at the moment of filing, so the two digits under the title differ run to
run. That is roughly 0.05% of the frame, an order of magnitude inside the gate's
0.5% tail, and it is the only part of either image that is not deterministic.
