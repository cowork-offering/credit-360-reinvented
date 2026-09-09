# Vendored: the credit memo renderer

**Source repo:** `cowork-offering/credit-memo-reinvented`
**Commit:** `d975605`
**Vendored:** 2026-09-04, re-recorded 2026-09-09
**Copied via:** the read-only mirror at
`/opt/connectry/projects/commercial-credit-reinvented/vendor-src/credit-memo-ro/`

**One deliberate local patch, otherwise no edits; upstream is read-only for us.** Every file in this
directory is byte-identical to the file it was copied from, with ONE exception recorded here:

- **2026-09-09, founder directive: the word IRIS never appears on a client-facing surface.** It is a
  Truist-specific system name. Every whole-word `IRIS` in the vendored files (labels, badges,
  narratives, notes, fixtures, references) reads `AFS` here. Lower-case identifiers (`iris`,
  `iris_placeholder.json`) are unchanged so the dossier contract is untouched. Upstream
  `cowork-offering/credit-memo-reinvented` is NOT edited, by the same directive; when a newer
  upstream commit is vendored, re-apply the rename (`sed -i 's/\bIRIS\b/AFS/g'`) before
  `--write`, and grep -w IRIS must come back empty. `vendor-manifest.json` records the sha256 of each one, and
`scripts/memo-vendor-check.mjs` (also run as `src/memo/vendorDrift.test.ts`) fails the suite the
moment any of them changes, goes missing, or is joined by a file nobody recorded.

Nothing here is imported for its own sake. The cockpit reaches this code through
`src/memo/renderMemo.ts`, which loads `references/module-manifest.json` and `assets/memo-shell.html`
as bundled strings and calls the plugin's own `renderMemo`. The room is a second seat on the
plugin's renderer, not a second renderer.

## What came from where

| Here | Upstream path |
|---|---|
| `render/render-memo.mjs` | `credit-memo-agent/skills/commercial-credit-memo/render/render-memo.mjs` |
| `render/assemble-memo.mjs` | `credit-memo-agent/skills/commercial-credit-memo/render/assemble-memo.mjs` |
| `assets/*` | `credit-memo-agent/skills/commercial-credit-memo/assets/*` |
| `references/*` | `credit-memo-agent/skills/commercial-credit-memo/references/*` |
| `plugin-assets/*` | `credit-memo-agent/assets/*` |
| `fixtures/*` | `test/fixtures/*` |

`render/assemble-memo.mjs` is vendored to be **read, not run**: it is the specification of the
dossier shape, and `src/memo/types.ts` is that shape written as TypeScript. It loads its inputs with
`node:fs`, so it never enters the browser bundle. `references/*.md` are documentation and are
likewise never imported by the app.

`fixtures/*` are the plugin's own harness fixtures (`test/fixtures/`), vendored so the golden parity
test can render the Piedmont deal from exactly the inputs the plugin's `test/build-memo.mjs` uses.

## The one derived file

`src/memo/renderMemo.vendor.mjs` is `render/render-memo.mjs` with two line ranges removed —
the `node:fs`/`node:path`/`node:url` imports at the top (lines 17-19) and the CLI entry at the
bottom (lines 748-771), neither of which `renderMemo` itself touches. It is **generated**, not
hand-written: `scripts/memo-vendor-check.mjs` re-derives it from the vendored original on every run
and fails on a single byte of difference. Its own header names the cuts and why.

## Refreshing from a newer upstream commit

1. Re-copy the files in the table above from the new commit.
2. Update the commit and date at the top of this file.
3. `node scripts/memo-vendor-check.mjs --write`
4. `npx vitest run src/memo` — the golden parity test is what proves the refresh did not change the
   memo. Regenerate the golden with `node scripts/memo-golden.mjs` only after reading the diff.
