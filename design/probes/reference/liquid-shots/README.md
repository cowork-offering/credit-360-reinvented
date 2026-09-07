# Look-gate references: the filed finale, and the new package

Four surfaces `liquid-shots.mjs` did not have until 2026-09-06, because none of
them existed. Two came with the finale: the sheet the rainbow card grows into
when a filing lands, and the memo room it hands to. Two came with the
new-package rule on 2026-09-07: the create room on its default path, and the
sheet a create ends on.

    node liquid-shots.mjs --out /tmp/shots-after --surfaces finale-sheet,memo-after-handoff,create-room,create-sheet
    node liquid-shots.mjs --diff design/probes/reference/liquid-shots --against /tmp/shots-after --check

All four are shot the way every other surface here is: 2x, reduced motion, light
scheme, against the built bundle with the stand-in org. They are the only files
here; every other surface's reference lives wherever the pass that shot it put
it, and the gate those nine hold to is the `--diff` against the baseline bundle,
not a file in git. These four are checked in because a NEW surface has no
baseline to diff against and would otherwise never be gated at all.

WHAT THE TWO CREATE SHOTS ARE FOR. `create-room` is the whole rule in one frame:
the package line reads "New package", the opening says "This plan creates a new
credit package", and the strip is empty because the package being built has no
members. `create-sheet` is the other half: the title names the package the ORG
made and the version it gave it, which is the fact that would silently go
missing if the engine ever stopped carrying `outputPackageId`. `create-room`
summons the room's own read back onto the stage before it shoots, because the
entry tiers leave a beat after they land.

WHAT WILL MOVE THEM LEGITIMATELY. The clock in the sheet's stamp is the room's
own at the moment of filing, so the two digits under the title differ run to
run. That is roughly 0.05% of the frame on `finale-sheet` and 0.11% on
`create-sheet`, both an order of magnitude inside the gate's 0.5% tail, and it
is the only part of any of these images that is not deterministic.
