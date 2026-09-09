# Credit 360 — Electric Glass Handover (Design → Wiring/Port)

**Date:** 2026-08-31 · **From:** design dummy session · **To:** main wiring session
**Status:** Design contract FROZEN. The wired version must EXACTLY reflect the dummy.

---

## 1. What is ground truth (in order of authority)

1. **`design/dummy/dummy.template.html`** — THE reference implementation. Every pixel, easing, and
   state machine, hand-tuned and founder-approved through ~30 feedback rounds. Fonts via
   `__FONT_REG__/__FONT_MED__/__FONT_SEMI__` placeholders (base64 from
   `brain/preview-site/boom-workbench/ds/fonts/Graphik-*.woff2`).
2. **`design/dummy/index.html`** — built copy (fonts injected). Serve it locally next to the port
   and compare side-by-side. Also the template backup (regex fonts → placeholders to reconstruct).
3. **`design/DIRECTION-LOCKED.json`** — 65 polish rules, 4 rejected patterns, nextPhase items.
   Every rule is founder-adjudicated. Rules marked SUPERSEDED/REJECTED must NOT reappear.
4. Live artifact (visual reference): https://claude.ai/code/artifact/83b33fdf-19a6-40a3-83a4-e34cbad20744

**Rule of engagement: when the port and the dummy disagree, the dummy wins. No "improvements"
during the port. New ideas go to a new design round, never into the mint.**

## 2. Port process (how to guarantee fidelity)

- Port **surface by surface** (landing → client hero → panes → FAB/chat → workroom → cmdk),
  and after EACH surface run the acceptance probes below against BOTH the dummy (served at
  `python3 -m http.server` on the design/dummy folder) and the port. Numbers must match.
- The dummy is vanilla; the port is React. Translate mechanics, not markup. The locked rules
  name the mechanism where it matters (e.g. "animation-delays, never transition-delays").
- Keep `prefers-reduced-motion` kill-switches everywhere the dummy has them.

## 3. ACCEPTANCE NUMBERS (measured from the frozen dummy, 1360×900)

### Header / nav
- Nav capsule: hidden on landing (`display:none` equivalent), visible on client; center delta
  from viewport center = **0px**; capsule height **41px** inside the **52px** bar.
- Entrance: capsule fades/settles with **.12s** delay; 7 tabs cascade via **animation**-delays
  .14s→.32s. Clicked tab `transitionDelay` must compute **0s** (the transition-delay poison trap).
- Wash on click interpolates from first frame: rgba(161,0,255) alpha 0 → .06.
- Header: `body.scrolled` (scrollY>8) adds drop shadow, .4s both ways.

### FAB / arc / whisper / chat
- FAB at right **44px** bottom **52px**; idle = 7s ease-in-out sinusoid halo (opacity 0→.55→0,
  14px/2px rgba(161,0,255,.13)) — never a blink.
- Arc: 5 satellites, radius **118px**, neighbor center distance **46px**; mark rotates **180°** open.
- Narrator chip: centered under FAB (0px delta), reads "Client actions" at rest, hovered action
  otherwise; all labels fit viewport at 1360w.
- Whisper: once per session, ~3.2s idle on landing, FAB breathes 2× (scale 1.02 max); click rides
  the name flight to Hartwell.
- Chat: FAB yields entirely (opacity 0, scale .6); panel at FAB position; minimize → "Assist"
  glass pill same spot; close → FAB returns. Full state machine as in dummy.

### Continuity
- Name flight: ghost 14.5px → 25px over .52s cubic-bezier(.22,1,.36,1); landing offset **0px/0px**;
  view holds perfectly still during flight (entry animation suppressed via a class ON THE VIEW that
  outranks the show rule and clears only when the view hides); handoff = real name revealed UNDER
  the ghost, ghost dissolves .16s. NO opacity dip anywhere in the handoff window.
- Workroom seed: 340px white circle (no backdrop-filter) ripples from the exact arc button.
- Pane switch: fade + 3px settle (.34s), never 8px jumps.

### Client view (×3 clients)
- Every worklist row opens ITS client (Hartwell authored / Piedmont grade 3 clean $18.4M /
  Meridian grade 7 past-due with 3 breach chips + empty opportunities). All 7 panes rebuild.
- Grade ring draws on every entry: reset to offset 119.4 → 1s settle to 41.8 / 74.6 / 14.9.
- Anchors cascade 45ms; meters fill from width 0 (+.15s delay); graph = metro routes, 4px corners,
  drift current into borrower; empty-state watermark breathes .04→.08 over 8s.
- Workroom gated off non-Hartwell with toast (dummy scope).

### Workroom
- Thread gap **38px**, step gap **32px**; identity chips at -21px never touch the bubble above.
- Agent messages STREAM word-by-word (26ms stagger, 4px blur → clear), layout pre-settled.
- Proposed value ROLLS in the right lane (odometer) with "was" note.
- Execute: liquid goo + status rotation → dossier card CONSTRUCTS itself (header → hairline draws
  scaleX 0→1 → real manifest rows ~300ms apart → hairline → "✓ Written to nCino…" check pops).
- The halo (execute's ONLY light): conic pastel spectrum ~.3 alpha, blur 14, opacity .38, gradient
  ANGLE rotates via @property (9s) — the box NEVER rotates. Fades 1.4s, ~5s after card lands.
- Write-back through the glass: commitment delta computed from manifest; hero exposure anchor,
  worklist amount, exposure-table total ALL odo-roll while the room is open (e.g. $15→$19M commit:
  $46.2M→$50.2M, exactly 6 rolling digit columns); violet wash (1.7s, once) on the changed anchor
  when the room closes. Executed value survives navigation away/back.

### Odometer
- Same-length figures roll per-digit (changed columns only), .6s cubic-bezier(.65,0,.35,1),
  45ms column stagger, 1.3px mid-roll blur; different lengths swap plain; tabular-nums required.

### cmdk
- Lens: body.lensed → topbar + active view blur **14px** saturate .92 scale .988; FAB blurs;
  backdrop dim only rgba(16,4,30,.10); Escape snaps back.
- Live filter + "Nothing matches." row; ArrowUp/Down over VISIBLE rows; Enter fires.

### Glass census (the material regression test)
Run on any page state: for every element with backdrop-filter blur, count `inset` occurrences in
computed box-shadow. **Expected: every surface = 3 rims, sole exception `.arclbl` (1 rim).**
Dark outer hairline rgba(0,0,0,.05–.06) everywhere — NEVER white borders on glass.
Blur scale: micro-chips 28 / satellites 28–30 / workroom 30 / bars 36 / floating panels 38.

```js
[...document.querySelectorAll('*')]
  .filter(el => (getComputedStyle(el).backdropFilter||'').includes('blur'))
  .map(el => [el.className, (getComputedStyle(el).boxShadow.match(/inset/g)||[]).length])
```

## 4. The five debugging traps (cost real time; do not rediscover)
1. **transition-delay poisons interaction** — entrance cascades = animation-delays only.
2. **Suppressed entry animations restart on class removal** — suppress on the element, outrank the
   show rule, clear only when hidden (`.view.noanim.show`; `.view.noanim` alone silently loses).
3. **A rotating blurred rectangle paints a giant circle** — rotate gradient angles, never boxes.
4. **Shared-element morphs end as crossfade-in-place** — real element under ghost, ghost dissolves.
5. **No second direct listener may bypass a shared handler's gate** (actModify/openRoom bug).

## 5. Rejected (never reintroduce)
Border beams ("gamer RGB") · large-title header condensation · third-party design systems
(astryx/StyleX for this) · spines/sparklines/decorative hairlines · violet action triggers · em dashes in UI copy.

## 6. Parked for the port (nextPhase in DIRECTION-LOCKED.json)
- Walkthrough autopilot (`design/walkthrough-autopilot-draft.js`) — rebuild on await-selector.
- Indexed agent as the workroom brain (seam: parseModify/parseAnswer + connector relay).
- Odometer on landing KPIs when values actually change.
- `:focus-visible` rings everywhere (a11y + automation backlog).

## 7. Definition of done for the port
1. All acceptance numbers above reproduced (Playwright, same probes).
2. Glass census passes.
3. Side-by-side eyeball at 1360×900: landing, client (each of 3), workroom full ritual, cmdk —
   founder sign-off per surface.
4. Zero occurrences of rejected patterns.

---
## Addendum (2026-08-31, post-freeze, founder-requested): the landing weave
12 seeded filament threads (truist-brain hero technique, tuned for light ground) in a 380px
double-fade-masked band behind the briefing headline, reaching past the KPI band top. Violet family,
lead .20 opacity / others .06–.14, widths .5–1.2px, per-thread sine drift via rAF. Landing only,
z0 behind content, pointer-events none, reduced-motion kill. Acceptance: 12 `#hweaveG g` nodes,
transforms changing over time, worklist rows clickable through it. Rule 66 in DIRECTION-LOCKED.json.

---
## Addendum 2 (2026-08-31): the auto-demo + richer Hartwell data
The dummy now demos itself: started and stopped with Cmd/Ctrl+S (no autostart, no on-screen chip), an incoming CFO
email card opens Hartwell and the director walks tabs → chat conversation → full workroom ritual →
write-back → hand-back toast (~70s). Every beat is element-readiness-driven (duntil polling); any
trusted click/keydown stops it. Beat trail on `window.__demoBeat`. Chat gained a conversational
engine (chatExchange + canned routes). New Hartwell data: maturity-profile bars (financials),
deposit signal, rate-hedge opportunity. parseLine fix: commit-with-amount outranks pricing mention.
Acceptance: full trail mail→…→done in ~70s hands-off; one real click stops it; demo leaves exposure
at $50.2M with wash. Rule 67. PORT NOTE: this supersedes the parked walkthrough draft — the
readiness-driven director IS the pattern to port.
