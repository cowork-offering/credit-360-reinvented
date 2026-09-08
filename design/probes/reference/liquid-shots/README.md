# Look-gate references: the filed finale, the new package, and the live queue

Four surfaces `liquid-shots.mjs` did not have until 2026-09-06, because none of
them existed. Two came with the finale: the sheet the rainbow card grows into
when a filing lands, and the memo room it hands to. Two came with the
new-package rule on 2026-09-07: the create room on its default path, and the
sheet a create ends on.

    node liquid-shots.mjs --out /tmp/shots-after --surfaces finale-sheet,memo-after-handoff,create-room,create-sheet,landing-live
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

## landing-live (2026-09-08)

A fifth reference, and the first one on the LANDING. Every other surface here
shoots the baked five, because the stand-in connector's `watchTool` answers
nobody; `landing-live` hands the Portfolio watch the org's own twelve
(`lib/live-book.mjs`, shared with the lane drive's scenario 10) and shoots what
the PAGE then decides.

What the frame has to carry: the three SAMPLE relationships gone, the queue in
severity order (overdue test, then test due by exposure, then maturity), the
rule sentence under the head counting itself, and the rest of the book folded
away under its divider rather than listed. The KPI band reads off the same
result, so `12 relationships` and `7 on the queue` have to agree with the rows.

The kicker carries the reader's own date (rule 68.6), so the first line of the
eyebrow moves day to day. That is roughly 0.2% of the frame, inside the gate's
0.5% tail, and it is the only part of this image that is not deterministic.

RE-SHOT 2026-09-08, for the book rule. Two things about this frame changed and
nothing else did. The rule sentence now says "maturities inside 180 days",
because the page asks the Portfolio read for a 180-day window rather than
taking the tool's 90-day default: at 90 days Prairie Ag's seasonal revolver,
153 days out, was invisible. And the KPI band's four book figures are now summed
from the rows on the page rather than read off the org's `bookTotals`, which
spans every packaged account including the 105 in this org that carry no
exposure at all. On this fixture the figures are unchanged, because the stand-in
book's totals already agreed with its rows; against the real org they are the
difference between 57.5 percent utilisation and 354. The paired diff against the
previous reference was mean 0.055, 0.055% of pixels past 8/255, all of it in the
one line of the sentence. The other five surfaces re-shot beside it (client,
room, relationship-room, memo-draft, memo-done) came back byte-identical.
