# DESIGN 0.9.31: the Spreading stage, and the wait that follows the banker

Founder, 2026-09-16 (after the first live Boom drop): "it takes some time of course. Is there any option we
can minimize and get an elegant ping or something when its done, overall the workroom needs to be also
more show that is working on it not just reading or something ... more structured information but elegant
and sexy bit more cinematic but in our styling ... just do it, i trust your taste now - just important: so
i can leave the workroom of spreading and there is a progress indicator somewhere?"

Design pick delegated to the orchestrator; logged in `logs/intent-gate.jsonl`. The hard requirement is the
last sentence: the banker can leave the Spreading room and the cockpit shows, somewhere always visible,
that Boom is still reading, and brings the result to them when it lands.

## Facts the design stands on

- Boom takes five to seven minutes on a real statement set (three Hartwell files, 2026-09-15: two PDFs
  completed at about six minutes, the xlsx later). Boom reports only `processing`, `completed`,
  `verified`, `failed`; there are no sub-stages. The room must never invent one.
- 0.9.29 made the wait honest: a rejected wait is a miss, receipts are per file and survive an open wait,
  re-entry resumes from `boom_get_file` and `boom_list_files`. What is missing: the wait lives INSIDE the
  room. Leave the room and nothing on the cockpit says anything is happening; the result waits for a
  re-entry.
- The cockpit's one loading motif is the filling `>` at the 460 ms beat (tokens.css). The memo's working
  exchange (memo.css) is the timeline language: one lead line, one row per thing, only the row being
  written moves. The governed-action stage (0.9.29, `GovernedStage.tsx`) is the sibling: a centred glass
  sheet, three beats, rows that settle and dissolve, FLIP back into the relationship.

## The one option (built in 0.9.31)

The Spreading room becomes THE SPREADING STAGE, three beats on one sheet, and the wait moves UP to the
cockpit so it can follow the banker.

1. **Drop.** Files land as receipts in the timeline language, each arriving with the `>` beat: name and
   size; "known by" the sha prefix; "registered under <relationship> in Boom" (ensure_company, with the
   Account Id as Boom's externalUniqueId); "Boom acknowledged, file <id prefix>"; "processing since
   hh:mm:ss". Facts only, each from a real answer. No dropzone chrome after the first file; a quiet
   "drop another" affordance at the foot.
2. **Reading.** One calm timeline with an elapsed clock per file and the one honest expectation line:
   "Boom's last N sets this size took about 5 to 7 minutes" (N and the minutes come from the receipts the
   page has seen, never a constant; before any observation the line is absent). The `>` fills at the beat.
   One sentence under the timeline: "You can leave this room. I will keep checking and bring the spread
   to you." That sentence is backed by the machinery below. No sub-stages, no percentage.
3. **Arrival.** The brief types in three beats with the memo's pause (periods found; statements found and
   their validation status; revenue, EBITDA, leverage, coverage each with the spread line behind it), then
   the register unfolds beneath it. A `failed` file arrives as Boom's own words, standing, with the two
   doors. Reduced motion: same facts, no choreography.

**The wait follows the banker (the requirement).** The poll leaves the room's component and lives at page
level, keyed by the persisted receipts, so closing the room, changing relationship or reloading the page
does not stop it. Everywhere in the cockpit, while at least one file is `processing`, a compact glass
indicator sits in the header beside the health line: the filling `>` and one line, "Reading Hartwell's
statements · 02:14 · 2 of 3 files" (relationship, elapsed, count); clicking it opens that Spreading room.
When Boom finishes, the indicator settles into an arrival marker for one beat ("Boom has read Hartwell's
FY2025 statements") and then stays as a quiet pill until the banker looks; the relationship's worklist row
carries a single glow until then; the Financials tab of that relationship reads Boom live on next open.
No sounds, no browser notifications (the host does not grant them reliably; a promise that fails is worse
than none). If two relationships are reading at once, the indicator carries both, newest first.

## Doctrine to keep

Facts once (the receipts are the file-level truth; the register is the statement-level truth; the brief
quotes the register, never a second source). The room still ends in exactly two doors. Provenance stays
`boom`. Nothing named after a relationship in product code. No em dashes. Banker register.

## Proof

Vitest on the page-level poller (survives room close and route change; one poll per file; a miss re-arms;
completion raises the marker once; two relationships interleave), on the indicator (present only while a
file is processing; clears on look; opens the right room), on the stage beats (drop receipts from the live
fixtures under `app/src/__fixtures__/boom-live/`; arrival brief from `ratios-piedmont.json` and
`spread-piedmont.json`). Boom drive gains a scenario: drop, leave the room to the worklist, the indicator
shows and counts, the stub completes the file, the marker arrives, the register is there on return. Spread
e2e still passes. The release gate runs alone.
