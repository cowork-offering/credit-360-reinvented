# Vendored: the credit memo AGENTS

**Source plugin:** `credit-memo-reinvented` (Credit Memo Reinvented), version **0.53.2**
**Installed from:** `~/.claude/remote/plugins/2ea973ee43939dbd/`
**Repo commit:** `cd28ad7e509716c932f1f7b61983ce0249728974` (2026-06-23) of
`cowork-offering/credit-memo-reinvented`, checked out read-only at
`/opt/connectry/projects/commercial-credit-reinvented/credit-memo-reinvented/`. Every file listed
below was verified byte-identical between the installed plugin and that checkout before copying.
**Vendored:** 2026-09-12

This is the sibling of `app/src/memo/vendor/`, which vendors the memo renderer CODE. That one is
what the cockpit's memo room imports. This one is what the **agents** need: the two personas and the
four skills their prompts name, so a banker can draft and review a memo from inside Credit 360
without a second plugin installed. The plugin auto-discovers `agents/*.md` and `skills/*/SKILL.md`;
nothing was added to `.claude-plugin/plugin.json` and its version was not touched.

Upstream is READ-ONLY for us. Nothing under the installed plugin or under any
`credit-memo-reinvented` path was edited.

## What came from where

| Here | Upstream path (relative to the plugin root) |
|---|---|
| `agents/credit-memo.md` | `agents/credit-memo.md` |
| `agents/credit-reviewer.md` | `agents/credit-reviewer.md` |
| `skills/commercial-credit-memo/SKILL.md` | `skills/commercial-credit-memo/SKILL.md` |
| `skills/commercial-credit-memo/references/*` (9 files) | `skills/commercial-credit-memo/references/*` |
| `skills/commercial-credit-memo/render/assemble-memo.mjs` | same |
| `skills/commercial-credit-memo/render/render-memo.mjs` | same |
| `skills/commercial-credit-memo/assets/memo-shell.html` | same |
| `skills/commercial-credit-memo/assets/review-shell.css` · `review-shell.js` | same |
| `skills/commercial-credit-memo/assets/lockup-cmr-black.svg` · `lockup-cmr-white.svg` | same |
| `skills/credit-review/SKILL.md` | same |
| `skills/finalize-and-writeback/SKILL.md` | same |
| `skills/sr-11-7-model-risk/SKILL.md` | same |
| `assets/ncino-demo-data.json` · `piedmont-narratives.json` · `boom-spread.json` · `boom-ratios.json` | `assets/*` |
| `assets/brand-tokens.css` · `brand-notes.md` · `brand-mark.svg` · `brand-horizontal.svg` · `accenture-logo.svg` | `assets/*` |
| `assets/ic_placeholder.json` | repo `seed/<old>_placeholder.json` (renamed, see below) |
| `assets/peers_placeholder.json` | repo `seed/peers_placeholder.json` |

The plugin-root assets sit flat in `assets/` because `render/assemble-memo.mjs` resolves them as
`<skill>/../../assets` — that is, `<pluginRoot>/assets`. Keeping them there means the assembler is
byte-identical to upstream apart from the rename, and the prose in both agent prompts (`assets/
ncino-demo-data.json`, `assets/boom-ratios.json`, …) stays literally true. No name collides with
Credit 360's own cockpit assets.

## Skills deliberately NOT vendored

Only the skills the two agent prompts actually name were taken. Excluded, with the reason:

| Excluded skill | Why |
|---|---|
| `collateral-valuation` | **NAME COLLISION.** Credit 360 owns `skills/collateral-valuation` (the package-anchored cockpit flow). Neither agent prompt names the memo-flavoured one, so it is skipped entirely rather than renamed. Credit 360's own skill is untouched. |
| `pricing`, `spreads`, `risk-rating-analysis`, `loan-setup`, `policy-exceptions`, `terms-and-covenants`, `compliance-due-diligence`, `credit-binder`, `decision-notice` | Not named or required by `credit-memo.md` or `credit-reviewer.md`. The drafting agent's methodology is carried by `commercial-credit-memo` + `finalize-and-writeback`; the reviewer's by `credit-review` + `sr-11-7-model-risk`. |
| `commercial-credit-memo/render/render-interactive.mjs` | Deprecated upstream and explicitly banned by both the agent prompt and the skill ("legacy — do NOT use it"). Vendoring it would only reintroduce the wrong-renderer detour. |
| `commercial-credit-memo/assets/_generate-lockup.py` | A one-off authoring tool for the two SVG lockups, not a runtime input. It also carries the only hardcoded absolute path upstream has (`/Users/…`), which is another reason not to carry it. |

Collision check was run over every skill name in both plugins. `collateral-valuation` is the only
one; `commercial-credit-memo`, `credit-review`, `finalize-and-writeback` and `sr-11-7-model-risk` are
all new names here (Credit 360's `covenant-review` is a different skill from `credit-review`).

## The ONE deliberate divergence: AFS, not the Truist name

**Founder directive: the Truist-specific name for the rating / PD / covenant-grade source never
appears on a Credit 360 surface. That source is called AFS here.** This matches what
`app/src/memo/vendor/` already did, so the two vendored copies agree:

- **Prose** — the old system name reads `AFS`. Where the upstream sentence listed both (e.g.
  "Boom/AFS/<old>"), the duplicate was collapsed to `Boom/AFS` so the sentence still parses.
- **Code identifiers** — the lower-case identifier → `ic`. The renderer's dossier key is `ic`, the assembler builds
  `const ic = {…}` with `_source: "AFS-PLACEHOLDER"`, and the provenance chip is
  `ic: { label: "AFS", color: "#0B6BCB", i: "AF" }` — badge `IR` → `AF`.
- **The seed file** is `assets/ic_placeholder.json`.

Nothing else was reworded. The gate is mechanical: `scripts/memo-agents-vendor-check.mjs` fails if a
single case-insensitive match for the old name reappears anywhere in the vendored tree.

## Paths repointed at this plugin root

Upstream (0.53.2) has **no** hardcoded `/home/fabian` or installed-plugin-hash paths in the files
vendored here — an earlier version did, and the DEMO STUB MODE line already reads
`${CLAUDE_PLUGIN_ROOT}/assets/ncino-demo-data.json`. What did need repointing were repo-relative
`seed/` paths, which do not exist inside a plugin:

| File | Was | Now |
|---|---|---|
| `agents/credit-memo.md` (sources table) | `seed/<old>_placeholder.json` | `${CLAUDE_PLUGIN_ROOT}/assets/ic_placeholder.json` |
| `agents/credit-memo.md` (sources table) | `seed/peers_placeholder.json` | `${CLAUDE_PLUGIN_ROOT}/assets/peers_placeholder.json` |
| `skills/commercial-credit-memo/references/data-contracts.md` | both of the above | both of the above |
| `skills/commercial-credit-memo/references/peer-aggregation.md` | `seed/peers_placeholder.json` | `${CLAUDE_PLUGIN_ROOT}/assets/peers_placeholder.json` |

**Known dangling references, left as upstream wrote them** (they describe the memo plugin's own repo,
are documentation rather than runtime paths, and rewriting them would be inventing): `test/build-memo.mjs`,
`seed/generate.mjs`, `seed/atlas.json`, `ncino-mcp/docs/query-spec.md`, `docs/roadmap/`,
`docs/architecture/decomposition-doctrine.md`, `docs/architecture/ncino-sync-and-realtime.md`.

## Verified

The fast path runs from this plugin root:

```
CLAUDE_PLUGIN_ROOT=<this plugin> \
  node $CLAUDE_PLUGIN_ROOT/skills/commercial-credit-memo/render/assemble-memo.mjs \
  --out /tmp/memo.html --reviewer '{"name":"…","role":"…","date":"…","iso":"…"}'
```

renders 84 KB of memo, RENDER PLAN 15 ON / 16 SUPPRESSED, spread periods FY2023-FY2025, plus the
`.rte-sections.json` and `.nforms.html` sidecars. `--review` renders the reviewer's read-only copy.
The rendered HTML carries 8 AFS provenance chips and zero matches for the replaced name.

## Refreshing from a newer upstream version

1. Re-copy the files in the table above from the new plugin version.
2. Re-apply the rename: `sed -i 's/<old>/AFS/g; s/<old lower>/ic/g'` over everything copied, then fix
   the provenance-chip badge back to `i: "AF"` and collapse any `Boom/AFS/AFS`.
3. Re-point the `seed/` paths in the table above.
4. Update the version, commit and date at the top of this file.
5. `node scripts/memo-agents-vendor-check.mjs --write` (it refuses to record while the rename gate
   fails), then re-run the assembler command above.
