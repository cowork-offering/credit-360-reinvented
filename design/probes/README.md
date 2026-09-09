# Acceptance probes — Credit 360 Electric Glass

Mechanised form of `design/HANDOVER.md` §3 (the acceptance numbers), §4 (the five
debugging traps) and the glass census. The suite runs against **any served URL**
and emits one machine-comparable JSON report, so every port surface can be gated
on "the numbers match the dummy".

**The dummy is ground truth. The prose is not.** Where a measurement disagrees
with HANDOVER's stated value, the probe reports what the dummy actually does and
the discrepancy is recorded in `reference/DISCREPANCIES.md` — never patched into
the probe.

---

> **The dummy itself is not in git.** `design/DIRECTION-LOCKED.json` and friends are
> gitignored in this repo and `design/dummy/` is untracked, so only `design/probes/`
> is committed. Copy `design/HANDOVER.md`, `design/DIRECTION-LOCKED.json` and
> `design/dummy/` in from wherever the design session keeps them before running the
> baseline. `reference/dummy-baseline.json` records
> `meta.sourceDigest` = `sha256:7aad211be877b93d` (first 16 hex of the sha256 of
> `design/dummy/index.html`) — if that digest changes, the dummy moved and the
> baseline must be re-locked.

## Install

Playwright is pinned locally in this folder (browsers come from the machine's
existing `~/.cache/ms-playwright`, nothing is installed globally):

```bash
cd design/probes
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
```

## Run against the frozen dummy

`probe.mjs` starts its own static server, so no separate terminal is needed:

```bash
node probe.mjs --runs 3 --out reference/dummy-baseline.json
```

Equivalent with an external server (matching HANDOVER §2):

```bash
python3 -m http.server 8899 -d design/dummy
node probe.mjs --url http://127.0.0.1:8899/ --runs 3 --out /tmp/dummy.json
```

## Run against the React port

1. Fill in `targets.port.json`. Only the **values** change; the **keys** are the
   contract the probes address the app through. Prefer stable hooks the port
   controls (`[data-probe="hero-name"]`, role+text) over class names.
2. Serve the port, then:

```bash
cd app && npm run dev              # or: npm run build && serve the bundle
cd ../design/probes
node probe.mjs --target port --url http://localhost:5173 --runs 3 --out /tmp/port.json
```

3. Gate the surface:

```bash
node compare.mjs reference/dummy-baseline.json /tmp/port.json
# exit 0 = the surface reproduces the mint; exit 1 = at least one FAIL
```

Machine-readable diff for CI:

```bash
node compare.mjs reference/dummy-baseline.json /tmp/port.json --json /tmp/diff.json
```

### Options

| flag | meaning |
|---|---|
| `--url <url>` | probe an already-served app (skips the built-in server) |
| `--serve <dir>` | directory to serve (default `../dummy`) |
| `--target <name>` | loads `targets.<name>.json` (default `dummy`) |
| `--targets <path>` | explicit target-map path |
| `--runs <n>` | repeats; numbers are merged as medians (default 3) |
| `--out <path>` | report destination |
| `--headed` | watch it drive the app |

## Comparison tolerances

`compare.mjs` classifies every leaf by the key's suffix — which is why every
numeric probe is named `…Px`, `…Ms`, `…Deg`, `…Pct`, `…Count` or `…Index`.

| suffix | tolerance |
|---|---|
| `…Px` | ±1px |
| `…Pct` | ±1 |
| `…Deg` | ±1 |
| `…Ms` | ±10%, minimum ±5ms |
| `…Count`, `…Index` | exact |
| booleans, strings, string arrays | exact |
| other numerics | ±1 |

Severity: **FAIL** gates the port. **WARN** is informational — markup- or
copy-shaped values (`SOFT` list at the top of `compare.mjs`) that a legitimate
port may render differently, e.g. raw keyframe text or the census element list.

## Stability

Timing-sensitive probes are sampled per animation frame in-page (never by
Playwright-side sleeps and screenshots), and the whole suite is repeated `--runs`
times. Numbers merge as **medians**; booleans/strings must agree across runs or
they merge to `{"__unstable": true, "runs": [...]}` — which is itself a signal
that the surface is nondeterministic.

## What is covered

| module | HANDOVER section |
|---|---|
| `probes/header.mjs` | Header/nav: capsule hidden on landing, 0px centre delta, 41/52px geometry, `animation`-delay cascade .14s→.32s, **trap 1** (clicked tab `transitionDelay` = 0s), active wash, `body.scrolled` threshold + shadow, pane switch = 3px settle |
| `probes/fab.mjs` | FAB right 44 / bottom 52, 7s sinusoid idle halo, arc: 5 satellites at r=118, neighbour spacing 46, mark 180°, narrator chip 0px delta + labels fit 1360w, whisper |
| `probes/continuity.mjs` | Name flight 14.5→25px over .52s, 0px landing offset, no opacity dip through the handoff window, **trap 2** (suppression outranks the show rule and clears only while hidden) |
| `probes/client.mjs` | Each of 3 rows opens ITS client, grade ring 119.4 → 41.8/74.6/14.9, 45ms anchor cascade, meter fill, graph metro routes, workroom gate on non-Hartwell |
| `probes/workroom.mjs` | 340px seedless-of-blur seed, thread gap 38 / step gap 32, identity chip −21px, 26ms word stagger, odometer (6 rolling digit columns, .6s / 45ms stagger), **trap 3** (halo box transform static while `--aang` animates), write-back through the glass, wash on close, value survives navigation |
| `probes/chat.mjs` | FAB yields entirely (opacity 0, scale .6), panel at the FAB's spot, minimize → "Assist" pill in that same spot, close returns the FAB; empty-state watermark breathes .04→.08 over 8s |
| `probes/cmdk.mjs` | Lens blur 14 / saturate .92 / scale .988 on topbar + view, FAB blur, backdrop dim, live filter + "Nothing matches.", Arrow traversal over visible rows, Enter fires, Escape restores |
| `probes/weave.mjs` | 12 `#hweaveG g` nodes, drift over time, rows clickable through it |
| `probes/glass.mjs` | The census in 4 page states: every backdrop-filter surface = 3 rims, sole exception `.arclbl` = 1; blur scale; no white borders on glass |

`report.traps` rolls the five traps up to one pass/fail line each, so a port
regression is visible without reading the whole report.

## Layout

```
probe.mjs                 runner + CLI + run merging + console summary
compare.mjs               tolerant diff of two reports (exit 1 on FAIL)
targets.dummy.json        selector/text/keyframe map for the frozen dummy
targets.port.json         stub for the React port — fill values, keep keys
lib/inject.js             in-page toolkit (injected before every load)
lib/helpers.mjs           node-side helpers
lib/serve.mjs             dependency-free static server
lib/merge.mjs             median merge across runs + leaf flattening
probes/*.mjs              one module per surface
reference/                the locked dummy baseline + recorded discrepancies
```
