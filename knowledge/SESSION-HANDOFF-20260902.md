# Session handoff, Customer 360, 2026-09-02 evening

Fresh session reads this first. Supersedes nothing (SESSION-HANDOFF-20260901.md still holds for
the shape of the working agreements below), adds today's landing on top. Founder demos the
Credit 360 cockpit tomorrow evening, 2026-09-03. See knowledge/DEMO-RUNBOOK-20260903.md for the
phone-readable arc; this file is the state, not the script.

## 1. Where main stands

HEAD: **2c98896**, "Release products for the third publish of 2026-09-02, and the v3 drive
script." Tests: **2938/2938 vitest green**, tsc clean, build green, probe gate rim 0, no new
fails. Artifact 91b5e835-5536-4f23-950e-4cde7941cf7f published at label **third-publish**,
capabilities (mcp) carried forward. Org (bankinggpt-at): Hartwell reverted to baseline after the
founder's own execute this evening, nothing else deployed since the morning's org-arms push.

## 2. What landed today, in order

1. **greeting-v2** (merge ec8f8af, released 91332e7). Narration grammar v2: a hyphen bullet
   opening on a bold name and colon renders as a line item, the entity's own figure in a
   right-hand rail, the model never writes the number. The client's one mailbox message rides the
   greeting envelope as `BrainMail`, top level, never inside `reads`. Route-neutral until a route
   binds: the envelope carries `route: "unbound"` and the three options rather than the
   provisional modify mode leaking into the model's sentence.
2. **book22** (merge 807d38c). The relationship graph read is aggregated one row per party per
   role, with facility counts, on every surface: the greeting's structure card, `GraphTab.tsx`,
   `graphAggregate.ts`. Fixes the 6-row / 22-row mismatch the founder hit live. Seven prior test
   failures closed with it.
3. **wire-arms + the review fixes** (merge 8009cc0, second publish ba95035). The three org arms
   deployed that morning (covenant/pledge carry exclusion, associate-existing covenant,
   `Customer360Catalog`) wired into the shell through a sentinel field (`__c360OrgArm`) so the
   byte-untouchable engine fence never has to know an arm exists. Two independent review passes
   found and closed: the manifest address matching on prose instead of the record id (E1, three
   times), the missing-arm-step sentence becoming a hard approval gate, the trail counting the
   org's own returned steps rather than the manifest, a truncation bug in the confirm sentence,
   and Customer360Catalog no longer caching a failed read for the life of the view.
4. **drive-fixes, the pricing gate** (merge 5a7fb75, third publish 2c98896). From the founder's
   own 15-line drive: a commitment or term change now asks the two blank pricing fields (nCino
   needs amount, term, amortised term and first payment date before it will price a loan) and
   stages them on the same version; collateral type chips are the org's own names; a policy
   exception create stages with the reason as its name and the facility plus status asked first;
   "what is on the plan" reads back as rows grouped by facility, not a paragraph; a remark figure
   not backed by the card is shown unemphasised and marked; titles shorten on a word boundary; a
   remove now addresses the manifest before the book so a second identical create is one entry,
   not two.

## 3. Deferred, not built

- **Relationship room port.** The catalog-chip and carry-exclusion grammar wire-arms shipped
  landed in the Facility room only, by founder direction (facility room first, relationship room
  adapts later). `Case.Type` / `Case.Origin` are read off the org now but not yet offered as chips
  there.
- **Multi-package fix, per `design/proposals/package-anchor-addendum.md`.** Status PROPOSAL, not
  contract. Answers the founder's "why does it know this package" question
  (`knowledge/PACKAGE-ANCHOR-FINDINGS-20260902.md`): on one package the room auto-anchors from the
  book with no banker gesture, correctly, but never says so; on several packages the greeting
  opens on a name that is a count over the whole relationship's figures, not the chosen package's,
  which is the actual defect. Rule 69 text is drafted, not minted. Do not demo multi-package;
  Hartwell has exactly one.
- **Mail route offer as a chip.** greeting-v2 offers the mail-matched route as a closing line
  naming an existing chip, not as its own chip. The stronger version touches `route.ts` and
  collides with wire-arms' hunks in `Workroom.tsx`; flagged to the founder, not started.
- **New-facility pricing fields.** `stage_new_facility` takes product, amount, purpose and term
  only, no rate or pricing stream. The room says so rather than pretending; adding the fields is
  an org-side tool change, not scoped.
- **Fee-type chips, founder decision open.** The org's `Fee_Type__c` is 37 residential/TRID
  values with no C&I entry. Three options written up in `wire-arms-addendum.md` (leave it, curate
  a commercial subset in the shell, add C&I values to the org). Room behaviour is unchanged either
  way: an origination fee still resolves to Loan Origination.
- **The mirror's other collateral families.** The catalog chips only offer collateral types whose
  own advance rate is not null; the org's rateless collateral types are filtered out entirely, not
  offered by another route. Untested edge, named in the morning brief, not decided.
- **Figures written in words.** The ungrounded-figure check catches a digit not on the card; it
  does not catch a number spelled out in words. Known gap, not closed.

## 4. Org state

Hartwell (001bb00001I7FPNAA3) reverted to baseline after the founder's own execute this evening:
1 package (a5Fbb000000IHFJEA4), 6 booked facilities, 7 loans total (the 7th is the $3M Equipment
proposal, disabled in the room, not debris). Revert tooling:
`knowledge/sf-build-v2/tools/revert-hartwell.py` then `revert-finish.py`, package id via `NEW_PKG`
env; collateral runs additionally delete the created `LLC_BI__Collateral__c` and
`LLC_BI__Account_Collateral__c` rows by COL number. Key junctions, for anyone reading org data
directly: pledge = `LLC_BI__Loan_Collateral2__c`; covenant = `LLC_BI__Loan_Covenant__c` linking to
`LLC_BI__Covenant2__c`; party/involvement = `LLC_BI__Legal_Entities__c`, role on
`LLC_BI__Borrower_Type__c`; rate = `LLC_BI__InterestRate__c` (spread populated on the three
floating loans only, index name is not stored anywhere, never say "SOFR+").

## 5. Process rules, still in force

- Work happens as checkpoint commits, small and named for what they close, not one large diff at
  the end of a stream.
- **One integrator owns main, the release chain and the pinned artifact.** Every other stream
  hands back a branch that is mechanically green (tests, tsc, build, fence SHA attested) plus a
  report; the integrator verifies the evidence itself before merging, publishing, or pushing.
- **The engine fence:** `app/src/workroom/` is byte-untouchable. SHA-attest it on every merge:
  `git rev-parse HEAD:app/src/workroom` must read **91c751e427232bf2b62c14b9cf92921e497496c9**.
  A build that cannot touch it routes new behaviour through the shell and the channel instead
  (see the sentinel-field pattern in section 2, item 3).
- No em dashes anywhere, in UI copy or in comms.
- **Never `git add -A`.** Stage named files. Two sessions merging or publishing at once corrupts
  the artifact or breaks main; only the integrator does either.
- Playwright headless-shell binary version drifted from what the installed browser expects; the
  fix living in `~/.cache/ms-playwright` is a symlink from the 1217 build directory to the 1234
  one the driver actually asks for. If a headless drive suddenly can't find its browser, check
  that symlink before reinstalling anything.
- Box memory rules apply as usual: save learnings to the brain in real time, not at session end;
  emit cross-session events via `brain-write.sh` rather than editing shared-context.md directly;
  keep memory files short and prune as you go. This project's own knowledge/ docs are the
  project-specific memory; the brain's memory/ files are for anything a future SESSION (not just
  a future reader of this repo) needs.

## 6. The freeze for tomorrow

Fixes drawn from the founder's own drive land in the morning ONLY. Nothing new starts, and
nothing already in flight ships, after midday 2026-09-03. The afternoon is for the runbook, a
final reload-and-drive rehearsal, and standing by. If the founder finds something broken during
his morning drive, fix it, verify it, republish once, and stop. Anything found after midday goes
on the list for after the booth, not into tonight's build.
