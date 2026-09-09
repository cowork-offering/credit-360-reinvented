# WS3 side findings: the Cowork natural-chat layer (2026-08-25, worktree `c360-ws3`, branch `ws3-natural-chat`)

Plugin v0.5.0. The `client-360` plugin gains the banker's counterpart agent and four guided skills, so
the 24 observed nCino tools can be driven conversationally at parity with the credit-memo plugin's
pattern. **Prose and one release gate only: no Apex was touched, no org was contacted, no artifact was
published, and the `app/` React source was not modified.** Every shape here is read out of the
archived observed envelopes and the deployed Apex sources already in this repo.

## 1. What was written

| Path | What |
|---|---|
| `client-360/agents/credit-360.md` | NEW. The orchestrator: identity, sources of truth, the 24-tool surface, the command routing table, the six-step write discipline, nine fences, voice, out of scope |
| `client-360/skills/client-request-to-action/SKILL.md` | NEW. Client ask to package-anchored `stage_loan_modification` to execution. The printed Dreamforce beat |
| `client-360/skills/covenant-review/SKILL.md` | NEW. Package-scoped bulk assessment, Pending rule, `allowNonPending` opt-in, Exception classifier, approval-trap warnings verbatim |
| `client-360/skills/collateral-valuation/SKILL.md` | NEW. Package-anchored `items[]`, cap 20, `valuationDate` required, all four refusal strings verbatim |
| `client-360/skills/relationship-actions/SKILL.md` | NEW. Service request, annual review, risk rating review, new facility (two execute invocations), renewal (stage only) |
| `client-360/skills/credit-360-cockpit/SKILL.md` | EDITED. 24 tools not 8, the write methodology as a pointer, the Exception/Waived semantics table, the ACTIONS section rewritten off its stale "no gated writes exist yet" claim. Fetch sequence, `C360_DATA` contract and assembler invocation untouched |
| `client-360/.claude-plugin/plugin.json` | 0.4.3 to **0.5.0**, description rewritten for reads plus governed writes plus guided workflows |
| `.claude-plugin/marketplace.json` | description matched to the plugin |
| `client-360/RUNBOOK.md` | guided-skill table, the not-yet-wired routes, the two release test suites |
| `client-360/render/tool-names.mjs` + `.test.mjs` | NEW. The release gate, section 3 |
| `client-360/render/contract-checks.test.mjs` | one-line path fix, section 4 |

## 2. The routing table, in summary

Every banker phrase maps to exactly one behavior. The three "not yet" rows are the ones that keep the
demo honest.

| Intent | Behavior |
|---|---|
| open the cockpit / pull up an account / what needs my attention | `credit-360-cockpit` |
| the client wants the line at 20M / increase the revolver / a forwarded email | `client-request-to-action` |
| review the covenants of the package | `covenant-review` |
| value the collateral | `collateral-valuation` |
| service request · annual review · risk rating review · new facility · renewal | `relationship-actions` |
| assess against policy | **NOT WIRED.** Named as WS2 (gateway, decision ledger, policy pack, gate G2). Offer the live alternatives; never cite a policy section |
| run the KYC checks | **NOT WIRED.** Named as WS1, pending gateway envelope observation |
| draft the credit memo / generate spreading | call-out to the credit-memo plugin, never rebuilt |
| pull up the spreads | `boom_get_spread` + `boom_get_ratios`, then prose |
| what happened on this relationship | `Customer360ActionHistory` |

The write discipline is one shape for all fifteen write tools: stage (writes nothing), present the
org's `summary` and **every** `warnings[]` string verbatim plus the refusal arithmetic, the human
confirms in words, execute with exactly
`{idempotencyKey, stagingId, planHash, decisionToken, approverUserId}` where the approver equals the
running identity, verify by re-query, name the handoff. `executionHeld: true` stops the flow before
execute, always.

## 3. The release gate: `tool-names.mjs`

Greps the agent and every SKILL.md for the Customer 360 tool-name shape (`Customer360*`, or
`stage_`/`execute_` plus snake_case) and diffs against the `<toolName>` elements of
`knowledge/sf-build-v2/wp2/mcpServerDefinitions/Customer360.mcpServerDefinition-meta.xml`.

Result on this branch: **manifest 24 tools · prose 6 files · 24 of 24 mentioned and declared · 0
unknown**. The test also asserts the reverse direction (nothing declared is left unnamed), so the
prose covers the whole manifest.

Two design notes worth keeping:

- **The regex is deliberately narrow.** A general snake_case match would flag plan step ids
  (`held_execution`, `write_assessment_0`, `filed_unverified`), org field names and host tools. The
  gate checks names that MUST be manifest tools, not every identifier in the prose.
- **`ASSERTED_ABSENT` rather than an exclusion list.** The prose has to be able to name
  `execute_renewal` in order to say it does not exist. That name is asserted **absent** from the
  manifest, so if the org ever ships it the gate fails and the stale promise gets corrected. This is
  the only entry.

The gate requires the repo checkout: the manifest sits outside the shipped plugin folder, and a
missing manifest throws rather than passing vacuously (there is a test for that).

## 4. One pre-existing defect found and fixed

`contract-checks.test.mjs` resolved its end-to-end fixture from `../artifact/sample-data.json`,
relative to `client-360/render/`. **That path has not existed since the WS0.5 plugin isolation moved
the plugin into `client-360/`**, so the single test that runs the whole contract against real sample
data had been failing on ENOENT, silently taking the strongest assertion in the suite out of the
release gate. Repointed to `../assets/sample-data.json`, the plugin's own copy, which
`scripts/sync-plugin-assets.mjs` keeps byte-identical to `artifact/sample-data.json` (verified with
`cmp`).

Suite before this branch: 45 pass, 1 fail. After: **46/46**.

## 5. Evidence

```
node client-360/render/tool-names.mjs          → 24/24, exit 0
node --test client-360/render/tool-names.test.mjs      → 7/7 pass
node --test client-360/render/contract-checks.test.mjs → 46/46 pass
node client-360/render/assemble-cockpit.mjs --data client-360/assets/sample-data.json --out /tmp/c360-ws3-smoke.html
  → OK, 729,348 bytes (code 660,302 + data 69,046), mode=v2, anchor 001bb00001DLtRMAA1,
    accounts staged 4/4, challenge 13 covenants, DQ 7 findings
```

The assembler smoke run confirms the assembler contract is unchanged by the prose edits.

## 6. UNVERIFIED

Stated plainly rather than implied away.

1. **No live Cowork session has exercised any of these skills.** The prose has never driven a real
   conversation, a real tool call or a real artifact. G3's pass condition ("a cold Cowork session with
   the plugin installed handles the demo conversation end-to-end") is **not met by this branch**; it
   is the next step, not a claim made here.
2. **Four of the five write families have no archived wire envelope.** Envelopes exist for loan
   modification (stage, execute, replay), covenant bulk (both arms), hardened valuation (happy path
   plus four refusals), the `facilityIds` shapes and the v2 exposure read. **Service request, annual
   review, risk rating review and new facility shapes in `relationship-actions` were read from the
   deployed Apex `@InvocableVariable` declarations** in `knowledge/sf-build-v2/wp2/classes/`, not from
   observed wire traffic. That is the best available source and it is the source the org compiles, but
   it is not an envelope. Probe them before Sep 4 if any of them appears in the demo path.
3. **`stage_renewal`'s response shape is observed** (in `observed-envelopes-facilityIds.json`) but
   only in its `executionHeld: true` form on Hartwell. There is no `execute_renewal` and the clone
   field set has not been re-probed.
4. **Multi-facility `execute_loan_modification` remains unobserved.** The live probe modified exactly
   one facility. The skill says so and tells the agent to flag a two-facility run as a first rather
   than as routine.
5. **Multi-covenant execution above N=1 remains unobserved**, and the covenant approval chain's
   positive branch has never been seen firing through these tools.
6. **The artifact capability manifest and the covenant execute hold disagree.**
   `knowledge/artifact-capabilities-manifest.json` declares 22 of the 24 tools and **excludes
   `execute_covenant_review`** on the founder gate, while the cockpit's client-side hold on that tool
   was removed on 2026-08-22 and the agent prose now routes to it. A covenant execute driven from
   **chat** calls the connector directly and is unaffected; one driven from the **artifact panel** has
   no grant. This needs a decision at the next republish: restate the manifest, or re-hold the tool.
   Flagged, not decided.
7. **The Hartwell rehearsal residue was not re-checked.** The 2026-08-22 demo-beat rehearsal left
   clone `a4Zbb000002BsK5EAK` and junction RL-00000200 standing for review. The skills cite only
   permanent ids from `DEMO-RELATIONSHIP.md`, so nothing here depends on whether that rollback ran,
   but the org state is unknown from this branch.
8. **SR 26-2 citation currency.** The agent cites "SR 26-2, successor to SR 11-7", per
   `DREAMFORCE-SPIN-CONTEXT.md`. The open action to diff SR 26-2 against SR 11-7 and confirm the
   claimed control set still maps is tracked Banksy-side and is **not closed**.
