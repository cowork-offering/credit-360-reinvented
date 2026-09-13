# 0.9.24 design-intent gate: the room's entry (backlog 43)

ARCHETYPE: a credit officer's desk note, not a chat. The banker opens a relationship to act on it;
the first thing on the glass is what there is to act on and the three doors, not a greeting bubble
with pills under it.

FOUNDER'S TASTE (from the record): route before package (2026-09-13); the governed action LAST,
glass register buttons, no fact said twice, explain and connect (2026-09-13, Spreading room); "a
little bit of space between the bubbles" (2026-09-04); "only the current action nicely shown"
(2026-09-13, condensed thread); the finale sheet ("glowing rainbow card") as the unifying end state
(0.9.20). The entry should be the finale sheet's mirror: one centred sheet at the start, one at the end.

THE ONE OPTION (build only on the founder's yes):
- The room opens on a centred ENTRY SHEET in the finale register (`.wk-sheet`, glass, the same
  radius and shadow as the finale): the relationship's name and one line of state at the top
  ("Booked at Grade 4, $54.0M committed, a modification in flight, editable until approval"), then
  the routes as three to five large glass doors in a row (Modify, Renew, New facility, Credit memo,
  and Shape this version where a version is editable), each door carrying one line of what it does
  ("Versions the package through nCino's credit action") and, where the book decides it, its state
  ("Locked: a version is in flight"). Under the doors, the read chips as they are today.
- Picking a door slides the sheet up into the thread as the first recap line ("Modify, chosen") and
  the package question (only where the route needs one) lands as the first bubble, scoped by the
  route. From there the room is exactly the condensed thread of 0.9.22.
- In the relationship room the same sheet carries the BRIEFING (row 50) above the doors: what is
  due and what it means, then the doors (the six reviews and the version routes).
- No bubble with pills at the opening; no second greeting; the identity chip appears with the first
  bubble, not on the sheet.
- Motion: the sheet fades in on open (the room's existing entry choreography, 450 ms settle); the
  doors are the only pressable things; the composer stays live for a typed route.

WHAT IT COSTS: `Workroom.tsx` and `RelationshipRoom.tsx` opening blocks (the route ask becomes the
sheet), one new `EntrySheet.tsx` shared by both rooms, `entry.css` in the finale register, the drives'
`routeThenPackage` helper reads the doors instead of chips, the render tests that count opening
chips are restated to count doors. No engine change.

DECISION NEEDED: yes / no / change, before any of it is built. Mechanical QA passing is not the bar;
the founder's eye is.
