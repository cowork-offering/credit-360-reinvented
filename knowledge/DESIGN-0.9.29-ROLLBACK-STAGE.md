# DESIGN 0.9.29: the governed-action stage (rollback first)

Founder, 2026-09-15, on the discard dialog: "kind of like this old school looking pop up, i would like to
have it way more sleeker, and ideally the execution on a different page after where its working bit more
cinematic you know, not a workroom but just sleek and elegant not so cluttered though." And on the run
itself: "sleek loading of when the system is deleting each step ... ideally like the loading in credit memo
but all on this page, what i would love: when this action its done they gently and elegantly dissolve you
know what i mean? like its magic?"

## What this replaces

`ConfirmGate` as a modal over the Activity tab for discard-version, and the `StepTracker` list that
follows it in the same modal. The stopped run at `delete_chain` (STG-0000000169) also showed the second
defect: no resume control on the glass (backlog 64).

## Intent (to be gated, one real option, before build)

Archetype: a stage, not a room. The relationship stays behind the glass; the action takes the page.
Three beats on one surface: the plan (what goes, in banker words, the 32 items grouped as the org groups
them), the confirmation (one line, one name, one press), the run (each group appears as it starts with the
memo's loading language, resolves with the org's own verification count, and then dissolves, so the page
empties as the version leaves the org; what remains at the end is the one sentence that matters: every
booked parent reads hasRenewal false, the version id no longer resolves). A stop leaves the failed group
standing with the org's words and a resume control under it, same key, same token, frozen plan (A6).

Not a workroom: no thread, no composer, no chips. Not cluttered: no side rails, no KPI band, nothing the
action does not need. The dissolve is the memo's, not a new effect language.

## Order

1. Backlog 64 (resume control) ships with or before the stage; the stage without resume repeats today.
2. Design-intent gate: one real option rendered from the live Sunbelt plan (32 items), founder confirms.
3. Build on discard-version first; the same stage then hosts every stage/execute pair.
