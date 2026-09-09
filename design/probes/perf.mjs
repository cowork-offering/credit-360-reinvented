#!/usr/bin/env node
/* Credit 360, the FLUIDITY probe.
 *
 * FOUNDER, 2026-09-04: "when I share via video there is latency, stuff gets
 * delayed, the system seems to overload; stabilise it so it runs super smooth,
 * in all instances."
 *
 * A screen share is a CPU tax: the encoder takes a core, the compositor loses
 * headroom, and everything the cockpit does on the main thread costs more than
 * it did on the founder's desk. There is no headless way to run a real share,
 * so this stands in for one with CDP CPU throttling at 4x and 6x, which is the
 * range a 2019-to-2023 laptop lands in while it is encoding a call.
 *
 * WHAT IT MEASURES, per scene and per glass mode: frame time p50 / p95 / max,
 * frames the page owed the compositor and did not deliver, long tasks (the
 * things that swallow a click), and the compositor layer count from CDP.
 *
 *   node perf.mjs --out /tmp/perf-after.json --label after --modes liquid,frost,calm
 *   node perf.mjs --check                    (gate: calm, 4x, landing + client)
 *   node perf.mjs --against /tmp/cockpit-BEFORE.html --runs 5   (paired A/B)
 *
 * MEASURE TWO BUNDLES IN ONE PASS, INTERLEAVED. `--against` is the honest way to
 * compare a change on a machine you do not own: both bundles are served side by
 * side and each scene alternates A, B, A, B within the same minute, so a
 * neighbouring build, a video encode or somebody else's test run lands on BOTH
 * sides rather than on whichever one happened to go second. Sequential runs on
 * a loaded box have been observed to disagree by 7x on identical bundles; paired
 * runs on the same box agree.
 *
 * THE BUNDLE IT MEASURES IS THE ONE JUST BUILT. `--template` defaults to
 * app/dist/cockpit.html so a run measures the working tree rather than the
 * promoted artifact; pass artifact/customer-360-template.html to measure what
 * is published.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { serveDir } from "./lib/serve.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/* THE GATE. Calm mode exists to make a shared screen survivable, so the number
   it has to hit is the one a viewer feels: a 95th-percentile frame inside 20ms
   on the two surfaces a demo spends its time on, with a laptop's worth of CPU
   taken away.

   IT READS THE STEADY NUMBER, NOT THE SCENE NUMBER, and the difference matters.
   The scene p95 covers the gestures too, a tab switch is a React mount of a
   whole pane, and at 4x throttle that commit is tens of milliseconds by
   arithmetic, not by waste. The steady p95 is the same page four seconds later
   with nobody touching it, which is where "the system seems to overload" lives:
   a cockpit that costs nothing to sit in front of. Both are reported; this is
   the one that can be held to a number. */
const CHECK = { mode: "calm", throttle: 4, maxP95Ms: 20, scenes: ["landing-idle", "landing-hover", "client-tabs"] };

const MODE_QUERY = { liquid: "?refract=3", subtle: "?refract=1", frost: "?refract=0", calm: "?refract=calm" };

/* ---------------------------------------------------------------- ablations

   FOUNDER, 2026-09-04 (through the coordinator): calm and frost are the safety
   net, not the answer, the LIQUID glass itself has to run smooth.

   Which means the first question is not "how do we make liquid cheaper" but
   "which part of liquid is expensive". Each ablation below takes ONE piece of
   the material away and nothing else, so the difference between the run and the
   baseline is that piece's bill. They are diagnostic only: none of them is a
   mode, none of them ships, and a run without --ablate is the real page. */
const ABLATIONS = {
  /* The reference filter, off the backdrop; the plain blur underneath it stays.
     This is the one number that says whether the bend is the problem. */
  "no-lens": `html.eg-liquid .eg-glass, html.eg-liquid .topbar, html.eg-liquid .whisper,
    html.eg-liquid .wk-notice, html.eg-liquid .wk-ent, html.eg-liquid .wk-rescard,
    html.eg-liquid .wk-toast, html.eg-liquid .eg-glass-chip, html.eg-liquid .eg-glass-satellite,
    html.eg-liquid .wk-hist, html.eg-liquid .wk-propose,
    html.eg-liquid.eg-refract-pane .eg-glass-workroom .wk-glass-sheet {
      -webkit-backdrop-filter: blur(var(--eg-rblur)) saturate(var(--eg-rsat)) !important;
      backdrop-filter: blur(var(--eg-rblur)) saturate(var(--eg-rsat)) !important; }`,

  /* THE ROOM'S OWN PANE, off the lens; every other liquid surface keeps it.
     The pane is the biggest piece of glass in the app and the only one whose
     backdrop is the whole viewport. */
  "no-pane-lens": `html.eg-liquid.eg-refract-pane .eg-glass-workroom .wk-glass-sheet {
    -webkit-backdrop-filter: blur(var(--eg-rblur)) saturate(var(--eg-rsat)) !important;
    backdrop-filter: blur(var(--eg-rblur)) saturate(var(--eg-rsat)) !important; }`,

  /* The 1px blur the whole page takes while a room is open. It is a SECOND
     full-viewport filter, and it is the image the pane's own backdrop filter
     then reads, so a backdrop that ought to be static and cacheable is the
     output of another filter on a layer whose opacity was also changed. */
  "no-page-blur": `html.eg-refract body.wk-open #root { filter: none !important; }`,

  /* The pane's blur AND the page blur behind it. */
  "no-pane-glass": `html.eg-liquid.eg-refract-pane .eg-glass-workroom .wk-glass-sheet {
    -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
    html.eg-refract body.wk-open #root { filter: none !important; }`,

  /* Every backdrop blur, off. The ceiling on what the glass can ever cost. */
  "no-backdrop": `* { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }`,

  /* The metaball filter behind the marks and the compile card's orbit. */
  "no-goo": `.goo, .wk-orbit { filter: none !important; }`,

  /* The rotating conic halo: an animated paint under a 14px blur. */
  "no-aura": `.aura { animation: none !important; filter: none !important; }`,

  /* The same halo, turning in 10-degree steps instead of continuously. The
     angle still animates and the box still never rotates, so trap 3 is
     untouched; what changes is that the conic gradient is repainted and
     re-blurred four times a second instead of sixty. */
  "steps-aura": `.wk-lit > .aura { animation-timing-function: steps(36) !important; }`,

  /* The one-shot specular streak on mount and hover. */
  "no-sweep": `html.eg-liquid .wk-room::before, html.eg-liquid .hero::before,
    html.eg-liquid .topbar::before, html.eg-liquid .arcbtn::before,
    html.eg-liquid .wk-ent::before, html.eg-liquid .whisper::before { display: none !important; }`,

  /* The landing band's rAF loop has its own parking rule in liquid; this takes
     the threads out of the document altogether. */
  "no-weave": `.weave, .hero-weave { display: none !important; }`,

  /* Every word the agent speaks arrives through an animated `filter: blur()`.
     A filter is not a compositor property the way opacity and transform are:
     each frame is a fresh rasterisation of that span at a new radius, and a
     sentence is twenty-five of them overlapping on a 26ms stagger. */
  "no-word-blur": `.wk-w { opacity: 1 !important; filter: none !important; animation: none !important; }
    .wk-narr-live .wk-narr-line span, .wk-narr-live .wk-narr-list li, .wk-narr-live .wk-narr-row {
      opacity: 1 !important; filter: none !important; animation: none !important; }`,

  /* THE SAME BEAT, WITHOUT WHAT IT LEAVES BEHIND. `wkw` ends on `filter: none`,
     but it is a `forwards` fill, and a forwards fill keeps applying the
     INTERPOLATED end value: interpolating a blur toward `none` lands on
     `blur(0px)`, which is not `none`. So every word the agent has ever spoken
     goes on carrying a filter that does nothing and holds a render surface
     open, for the life of the room. The census reads them: 32 spans in the
     facility room, 52 in the memo room, 64 in the relationship room, and a
     compositor layer count that tracks the number.

     This ablation keeps the 380ms blur-in exactly as designed and removes only
     the residue, by moving the identical from-state into the keyframe and
     filling BACKWARDS so the element reverts to its own (unfiltered) style when
     the beat is over. Pixel-identical by construction; the difference it
     measures is purely what the leftovers cost. */
  "word-blur-rest": `@keyframes wkw-rest { from { opacity: 0; filter: blur(4px); } }
    .wk-w { opacity: 1; filter: none; animation-name: wkw-rest; animation-fill-mode: backwards; }`,

  /* THE MEMO DOCUMENT ITSELF, out of the room. Diagnostic only: it answers
     whether the frame is what keeps the pane's lens dirty, or whether the lens
     is simply expensive in a room this size regardless of what is in it. */
  "no-memo-frame": `.mm-doc { display: none !important; }`,

  /* THE FRAME ON ITS OWN COMPOSITED LAYER. If the frame is the invalidator,
     promoting it should stop its repaints reaching the sheet's backdrop root,
     at the price of one layer and no pixels at all. */
  "memo-frame-layer": `.mm-doc { will-change: transform; }`,

  /* THE LENS OFF THE MEMO ROOM ONLY, every other room keeping it. The memo
     room is the one the founder asked to make denser three times, ending at a
     0.40 veil over the whole sheet, and its right-hand lane is covered by an
     opaque document. It is the room with the least bend to lose. */
  "no-memo-lens": `html.eg-liquid.eg-refract-pane .wk-room.mm-room .wk-glass-sheet {
    -webkit-backdrop-filter: blur(var(--eg-rblur)) saturate(var(--eg-rsat)) !important;
    backdrop-filter: blur(var(--eg-rblur)) saturate(var(--eg-rsat)) !important; }`
};

/* HOW LONG THE PAGE IS WATCHED DOING NOTHING, after each scene's gestures are
   over. Two statistics come out of every run and they answer different
   questions: the SCENE p95 is what the whole interaction cost, transitions
   included, and a transition is allowed to be expensive; the STEADY p95 is what
   the page costs once it has arrived and the banker is reading it, which is
   where "the system seems to overload" lives. A room that opens in three
   expensive frames and then holds 60fps is a room that feels fine. */
const STEADY_MS = 4000;

function args(argv) {
  const o = { modes: "liquid,frost", throttle: "4,6", runs: 1, label: "run", check: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") o.check = true;
    else if (a === "--headed") o.headed = true;
    else if (a.startsWith("--")) o[a.slice(2)] = argv[++i];
  }
  o.runs = Number(o.runs) || 1;
  o.modeList = String(o.modes).split(",").map((s) => s.trim()).filter(Boolean);
  o.throttleList = String(o.throttle).split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
  if (o.check && !o.modeList.includes(CHECK.mode)) o.modeList.push(CHECK.mode);
  if (o.check && !o.throttleList.includes(CHECK.throttle)) o.throttleList.push(CHECK.throttle);
  for (const key of ["ablate", "ablate-b"]) {
    if (o[key] && !(o[key] in ABLATIONS)) {
      console.error(`FAIL: unknown --${key} "${o[key]}". Known: ${Object.keys(ABLATIONS).join(", ")}`);
      process.exit(1);
    }
  }
  return o;
}

/* ---------------------------------------------------------------- the scenes

   Each one is what a banker does, driven from inside the page so the timing is
   the page's own and not the round trip's. A scene returns nothing: the runner
   marks the tape before it and reads the tape after it. */

const SCENES = [
  {
    id: "landing-idle",
    what: "the worklist, open, untouched, for five seconds",
    ms: 5000,
    run: async (page) => { await page.waitForTimeout(5000); }
  },
  {
    id: "landing-hover",
    what: "the pointer crossing every worklist row",
    run: async (page) => {
      const rows = await page.$$("#view-home .wlrow");
      for (let pass = 0; pass < 2; pass++) {
        for (const row of rows) {
          await row.hover({ force: true }).catch(() => {});
          await page.waitForTimeout(120);
        }
      }
    }
  },
  {
    id: "client-tabs",
    what: "Hartwell open, every pane switched in turn",
    run: async (page, sel) => {
      await page.click(sel.rowHartwell);
      await page.waitForTimeout(1400);
      const tabs = await page.$$(".topnav .itab");
      for (let pass = 0; pass < 2; pass++) {
        for (const tab of tabs) {
          await tab.click({ force: true }).catch(() => {});
          await page.waitForTimeout(320);
        }
      }
    }
  },
  {
    id: "facility-room",
    what: "the facility room open, a line typed, a card landing",
    run: async (page, sel) => {
      await page.click(sel.rowHartwell);
      await page.waitForTimeout(1200);
      await page.click("#fab");
      await page.waitForTimeout(500);
      await page.click("#actFacility");
      await page.waitForTimeout(1800);
      // The package, then a facility: the room's own first two questions.
      await page.evaluate(async (S) => {
        const P = window.__P;
        const pkg = await P.until(() => P.el(S.workroomPackageButton), 6000, 60);
        if (pkg) { pkg.click(); }
        const fac = await P.until(() => P.el(S.workroomFacility), 6000, 60);
        if (fac) { fac.click(); }
        await P.sleep(600);
      }, sel);
      // A line, typed the way a keyboard types it, and the card it lands.
      await page.evaluate(async (S) => {
        const P = window.__P;
        const box = P.el(S.workroomInput);
        if (!box) return;
        P.type(box, "Increase the Line of Credit to $19M");
        const send = P.el(S.workroomSend);
        if (send) send.click();
        await P.until(() => P.el(S.workroomDelta), 8000, 80);
        await P.sleep(1200);
      }, sel);
    },
    /* THE SCENE HAS TO HAVE HAPPENED. A room that never opened measures a
       still landing page and reports it as a win. */
    witness: (page, sel) => page.evaluate((S) => ({
      roomOpen: !!document.querySelector(".wk-root"),
      cardLanded: !!document.querySelector(S.workroomDelta),
      /* WHAT IS STILL ALIGHT WHEN THE GESTURES ARE OVER. A room parked with a
         lit halo is a room repainting a blurred rainbow forever, and that is a
         different diagnosis from a room that is simply slow. */
      litHalos: document.querySelectorAll(".wk-lit").length,
      running: (() => { try { return document.getAnimations().filter((a) => a.playState === "running").length; } catch { return null; } })()
    }), sel)
  },
  {
    id: "memo-room",
    what: "the memo room drafting, then one steer",
    run: async (page, sel) => {
      await page.click(sel.rowHartwell);
      await page.waitForTimeout(1200);
      await page.click("#fab");
      await page.waitForTimeout(500);
      await page.click("#actMemo");
      await page.waitForTimeout(1600);
      await page.evaluate(async () => {
        const P = window.__P;
        const draft = await P.until(() => document.querySelector('[data-chip="draft"]'), 8000, 80);
        if (draft) draft.click();
        // Let the desk answer several sections: this is the beat the founder
        // watches, and it is where two documents used to be composited at once.
        await P.sleep(9000);
      });
      await page.evaluate(async (S) => {
        const P = window.__P;
        const box = P.el(S.workroomInput);
        if (!box) return;
        P.type(box, "Tighten the collateral section.");
        const send = P.el(S.workroomSend);
        if (send) send.click();
        await P.sleep(6000);
      }, sel);
    },
    witness: (page) => page.evaluate(() => ({
      roomOpen: !!document.querySelector(".mm-frame"),
      timelineRows: document.querySelectorAll(".mm-tl-row").length,
      framesLoaded: Array.prototype.slice.call(document.querySelectorAll(".mm-doc"))
        .filter((f) => (f.getAttribute("srcdoc") || "").length > 0).length
    }))
  },
  {
    /* JUST THE KEYSTROKES. The room is already open and settled when the tape
       starts (see `pre`), so this p95 is the one thing a banker judges the
       cockpit on before anything else: whether the letters keep up with the
       fingers. One `input` event per character, which is what a keyboard does
       and what React re-renders on. */
    id: "room-typing",
    what: "a sentence typed into an open facility room, one key at a time",
    pre: async (page, sel) => {
      await page.click(sel.rowHartwell);
      await page.waitForTimeout(1200);
      await page.click("#fab");
      await page.waitForTimeout(500);
      await page.click("#actFacility");
      await page.waitForTimeout(1800);
      await page.evaluate(async (S) => {
        const P = window.__P;
        const pkg = await P.until(() => P.el(S.workroomPackageButton), 6000, 60);
        if (pkg) pkg.click();
        const fac = await P.until(() => P.el(S.workroomFacility), 6000, 60);
        if (fac) fac.click();
        await P.sleep(1400);
      }, sel);
    },
    run: async (page, sel) => {
      await page.evaluate(async (S) => {
        const P = window.__P;
        const box = P.el(S.workroomInput);
        if (!box) return;
        const line = "Increase the Line of Credit to $19M and hold the covenant";
        for (let i = 1; i <= line.length; i++) {
          P.type(box, line.slice(0, i));
          await P.sleep(45);
        }
      }, sel);
    },
    witness: (page, sel) => page.evaluate((S) => ({
      roomOpen: !!document.querySelector(".wk-root"),
      typed: (P => { const b = P.el(S.workroomInput); return b ? b.value.length : 0; })(window.__P)
    }), sel)
  },
  {
    /* THE FINALE (founder, 2026-09-06). Confirm, watch the rainbow card grow
       into the sheet, press the memo door, land in the memo room.

       THE MORPH IS MEASURED ON ITS OWN, INSIDE THE SCENE. The scene's own p95
       covers the org's eight-second wait and the room's whole ending, and an
       idle second of that would flatter any number taken over it. So the page
       marks its own tape the moment the card starts ascending and reads it back
       once the sheet has landed: `witness.morph` is the growth and nothing
       else, and it is the row the gate is about. */
    id: "finale",
    what: "a filing confirmed, the card growing into the sheet, and the hand to the memo",
    pre: async (page, sel) => {
      await page.click(sel.rowHartwell);
      await page.waitForTimeout(1200);
      await page.click("#fab");
      await page.waitForTimeout(500);
      await page.click("#actFacility");
      await page.waitForTimeout(2600);
      await page.evaluate(async () => {
        const P = window.__P;
        const pkg = await P.until(() => document.querySelector('.wk-pkg[data-pkg="a5Fbb000000IHFJEA4"]'), 8000, 60);
        if (pkg) pkg.click();
        await P.sleep(1800);
      });
      // The line, and whatever the room raises on the way to a plan.
      await page.evaluate(async (S) => {
        const P = window.__P;
        const box = P.el(S.workroomInput);
        if (!box) return;
        P.type(box, "increase the revolving line of credit to 18 million");
        P.el(S.workroomSend)?.click();
        await P.sleep(2800);
        const hit = (rx, sel) => {
          const el = [...document.querySelectorAll(sel)].find((b) => rx.test((b.textContent || "").trim()));
          if (el) el.click();
          return Boolean(el);
        };
        for (let i = 0; i < 12 && !document.querySelector(".wk-propose"); i++) {
          hit(/^Confirm$/, "button") ||
            hit(/^Acknowledge$/, "button") ||
            hit(/^Leave pricing for later$/, ".wk-opt") ||
            hit(/^240 months$/, ".wk-opt");
          await P.sleep(1500);
        }
        document.querySelector(".wk-propose")?.click();
        await P.sleep(1600);
      }, sel);
    },
    run: async (page) => {
      await page.evaluate(async () => {
        const P = window.__P;
        const approve = await P.until(() => document.querySelector(".wk-approve"), 8000, 60);
        if (!approve) return;
        approve.click();
        /* TWO TAPES, BECAUSE THEY ANSWER DIFFERENT QUESTIONS.

           THE ENDING is everything from the drain onward, and most of it is the
           finale's own pre-existing choreography: a wave of items animating
           `filter: blur()` and a collapsing grid track, which is a relayout and
           a re-rasterisation per item per frame by construction.

           THE MORPH is the beat this wave added, and it starts exactly when the
           sheet appears. It is the one that has to be compositor-only, and
           measuring it inside the drain's window would be reporting somebody
           else's bill as this one's. */
        await P.until(() => document.querySelector(".wk-thread[data-finale]"), 40000, 40);
        const ending = window.__PERF.mark();
        await P.until(() => document.querySelector(".wk-sheet"), 10000, 20);
        const token = window.__PERF.mark();
        await P.sleep(700);
        window.__MORPH = window.__PERF.since(token);
        await P.sleep(300);
        window.__ENDING = window.__PERF.since(ending);
        document.querySelector(".wk-sheet-go")?.click();
        await P.sleep(2600);
      });
    },
    witness: (page) =>
      page.evaluate(() => ({
        sheet: !!document.querySelector(".wk-sheet"),
        memoRoom: !!document.querySelector(".mm-room"),
        handedOff: !!document.querySelector(".mm-filed"),
        /* THE MORPH'S OWN NUMBERS. p95 under 24ms at 4x and no long task over
           100ms inside it is the claim; anything else in the scene is context. */
        morph: window.__MORPH ?? null,
        ending: window.__ENDING ?? null
      }))
  },
  {
    /* THE THIRD ROOM. It was missing from this list and it is the one the
       census finds heaviest: it is the talkiest of the three, and every
       sentence it speaks leaves its words behind. */
    id: "relationship-room",
    what: "the relationship room open, a question asked and answered",
    run: async (page, sel) => {
      await page.click(sel.rowHartwell);
      await page.waitForTimeout(1200);
      await page.click("#fab");
      await page.waitForTimeout(500);
      await page.click("#actRelationship");
      await page.waitForTimeout(2200);
      await page.evaluate(async (S) => {
        const P = window.__P;
        const box = await P.until(() => P.el(S.workroomInput), 6000, 60);
        if (!box) return;
        P.type(box, "Who signs for Hartwell?");
        const send = P.el(S.workroomSend);
        if (send) send.click();
        await P.sleep(4000);
      }, sel);
    },
    witness: (page) => page.evaluate(() => ({
      roomOpen: !!document.querySelector(".rl-room"),
      /* THE POPULATION THAT GROWS. Every one of these is a span the agent
         spoke, and until the residue was fixed every one held a filter. */
      spokenWords: document.querySelectorAll(".wk-w").length,
      running: (() => { try { return document.getAnimations().filter((a) => a.playState === "running").length; } catch { return null; } })()
    }))
  }
];

/* THE HARNESS HAS TO PROVE IT CAN MEASURE BEFORE IT IS ALLOWED TO JUDGE.
 *
 * A gate on an absolute frame time is only meaningful on a machine that can
 * deliver frames. This box has been observed at a load average of 11 on four
 * cores, with a neighbouring video encode taking a core outright, and in that
 * state an EMPTY PAGE misses vsyncs. Reporting that as a regression in the
 * cockpit would be a lie in the direction that wastes the most time.
 *
 * So --check measures a blank page first, at the same throttle. If the floor
 * cannot hold 60fps the gate refuses to return a verdict rather than returning
 * a wrong one; a refusal is still a non-zero exit, because a gate nobody can
 * run is not a gate that passed.
 */
async function floorFor(browser, rate, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript({ path: path.join(HERE, "lib", "perf-record.js") });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await page.setContent("<style>body{background:#fff;font:14px sans-serif}</style><h1>floor</h1>");
  await page.waitForFunction(() => !!window.__PERF);
  await page.waitForTimeout(1200);
  const token = await page.evaluate(() => window.__PERF.mark());
  await page.waitForTimeout(4000);
  const r = await page.evaluate((t) => window.__PERF.since(t), token);
  await ctx.close();
  return r;
}

/** Past this on an empty page, the box is the thing being measured. */
const FLOOR_CEILING_MS = 18;

/* ------------------------------------------------------------------ the run */

async function measure(browser, url, mode, rate, scene, sel, viewport, ablate) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
    colorScheme: "light"
  });
  await ctx.addInitScript({ path: path.join(HERE, "lib", "inject.js") });
  await ctx.addInitScript({ path: path.join(HERE, "lib", "perf-record.js") });
  await ctx.addInitScript({ path: path.join(HERE, "lib", "stub-connector.js") });
  await ctx.addInitScript({ path: path.join(HERE, "lib", "stub-sample.js") });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));

  const cdp = await ctx.newCDPSession(page);
  let layers = null;
  await cdp.send("LayerTree.enable").catch(() => {});
  cdp.on("LayerTree.layerTreeDidChange", (e) => { if (e.layers) layers = e.layers.length; });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });

  await page.goto(url + MODE_QUERY[mode], { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__P && !!window.__PERF);
  if (ablate) await page.addStyleTag({ content: ABLATIONS[ablate] });
  // Boot, KPI count-up and the entry choreography are a scene of their own and
  // are not this one: every measurement starts from a settled page.
  await page.waitForTimeout(2500);

  /* WHAT THE SCENE NEEDS TO EXIST, MEASURED BY NOBODY. A room has to be open
     before a banker can type into it, and opening one is a React mount of a
     whole pane: at 4x throttle that commit is tens of milliseconds by
     arithmetic. Rolling it into the same p95 as the keystrokes hides the one
     number the founder actually feels. A scene with a `pre` gets it done, and
     settled, before the tape starts. */
  if (scene.pre) {
    await scene.pre(page, sel).catch((e) => errors.push("pre: " + String(e && e.message ? e.message : e)));
    await page.waitForTimeout(1200);
  }

  const glass = await page.evaluate(() => window.__PERF.glass());
  const token = await page.evaluate(() => window.__PERF.mark());
  await scene.run(page, sel).catch((e) => errors.push("scene: " + String(e && e.message ? e.message : e)));
  const row = await page.evaluate((t) => window.__PERF.since(t), token);

  /* AND THEN NOBODY TOUCHES IT. Same page, same state the scene left it in, no
     input: what it costs to simply sit there. */
  const holdToken = await page.evaluate(() => window.__PERF.mark());
  await page.waitForTimeout(STEADY_MS);
  const hold = await page.evaluate((t) => window.__PERF.since(t), holdToken);

  const witness = scene.witness ? await scene.witness(page, sel).catch(() => null) : null;
  const after = await page.evaluate(() => ({
    glassSurfaces: window.__PERF.glassSurfaces(),
    animations: window.__PERF.animations()
  }));

  await cdp.detach().catch(() => {});
  await ctx.close();

  return {
    scene: scene.id,
    what: scene.what,
    mode,
    ablate: ablate || null,
    modeApplied: glass.mode,
    htmlClass: glass.htmlClass,
    throttle: rate,
    ...row,
    steadyP50: hold.frameMsP50,
    steadyP95: hold.frameMsP95,
    steadyMax: hold.frameMsMax,
    steadyDropped: hold.droppedFrames,
    steadyFps: hold.fps,
    compositorLayers: layers,
    glassSurfaces: after.glassSurfaces,
    animationsRunning: after.animations.running,
    animationsInfinite: after.animations.infinite,
    witness,
    pageErrors: errors
  };
}

/* THE MIDDLE TAKE, NOT THE BEST ONE.
 *
 * A headless browser on a shared box is noisy enough that a single take can
 * miss by a third either way, which is more than most of the changes this probe
 * exists to judge. Repeating the scene and reporting the MEDIAN take (by p95,
 * the number the gate reads) is the cheapest way to make a before/after
 * comparison mean something. The median TAKE is kept whole rather than a
 * per-field median across takes, so every number in a row came from one real
 * run of the scene and they still add up.
 */
function median(takes) {
  if (takes.length === 1) return takes[0];
  const ranked = [...takes].sort((a, b) => (a.frameMsP95 ?? Infinity) - (b.frameMsP95 ?? Infinity));
  const row = ranked[Math.floor((ranked.length - 1) / 2)];
  return { ...row, takes: takes.length, p95Takes: takes.map((t) => t.frameMsP95) };
}

/* ---------------------------------------------------------------- the table */

function table(rows) {
  const head = ["scene", "mode", "cpu", "p50", "p95", "max", "drop", "fps", "steady p95", "steady fps", "long", "layers", "glass", "loops"];
  const cells = rows.map((r) => [
    r.ablate ? `${r.scene} [${r.ablate}]` : r.scene,
    r.modeApplied === r.mode ? r.mode : `${r.mode}!=${r.modeApplied}`,
    `${r.throttle}x`,
    r.frameMsP50 == null ? "-" : r.frameMsP50.toFixed(1),
    r.frameMsP95 == null ? "-" : r.frameMsP95.toFixed(1),
    r.frameMsMax == null ? "-" : r.frameMsMax.toFixed(0),
    String(r.droppedFrames),
    String(r.fps),
    r.steadyP95 == null ? "-" : r.steadyP95.toFixed(1),
    r.steadyFps == null ? "-" : String(r.steadyFps),
    `${r.longTasks}/${r.longTaskMsMax}`,
    r.compositorLayers == null ? "-" : String(r.compositorLayers),
    String(r.glassSurfaces),
    String(r.animationsInfinite)
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) => c.map((v, i) => (i === 0 ? v.padEnd(w[i]) : v.padStart(w[i]))).join("  ");
  return [line(head), w.map((n) => "-".repeat(n)).join("  "), ...cells.map(line)].join("\n");
}

/* THE PAIRED TABLE. Both sides measured in the same minute, on the same box,
   through the same browser: the DELTA is the number that means something, and
   the absolutes are there so nobody mistakes a loaded box for a slow page. */
function pairedTable(paired) {
  const head = ["scene", "mode", "cpu", "p95 A", "p95 B", "delta", "steady A", "steady B", "drop A", "drop B", "layers A", "layers B"];
  const cells = paired.map((p) => {
    const d = p.before.frameMsP95 != null && p.after.frameMsP95 != null
      ? ((p.after.frameMsP95 - p.before.frameMsP95) / p.before.frameMsP95) * 100
      : null;
    const n = (v, dp = 1) => (v == null ? "-" : v.toFixed(dp));
    return [
      p.scene, p.mode, `${p.throttle}x`,
      n(p.before.frameMsP95), n(p.after.frameMsP95),
      d == null ? "-" : `${d >= 0 ? "+" : ""}${d.toFixed(0)}%`,
      n(p.before.steadyP95), n(p.after.steadyP95),
      String(p.before.droppedFrames), String(p.after.droppedFrames),
      String(p.before.compositorLayers ?? "-"), String(p.after.compositorLayers ?? "-")
    ];
  });
  const w = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) => c.map((v, i) => (i === 0 ? v.padEnd(w[i]) : v.padStart(w[i]))).join("  ");
  const what = paired[0]?.against && paired[0].against !== "baseline bundle"
    ? `A = ${paired[0].against}, B = the mode named in the row, same bundle, measured alternately`
    : "A = baseline, B = this tree, measured alternately";
  return [what,
    line(head), w.map((n2) => "-".repeat(n2)).join("  "), ...cells.map(line)].join("\n");
}

function compareTable(before, after) {
  const key = (r) => `${r.scene}|${r.mode}|${r.throttle}`;
  const was = new Map(before.rows.map((r) => [key(r), r]));
  const head = ["scene", "mode", "cpu", "p95 before", "p95 after", "delta", "drop before", "drop after"];
  const cells = after.rows.filter((r) => was.has(key(r))).map((r) => {
    const b = was.get(key(r));
    const d = b.frameMsP95 != null && r.frameMsP95 != null ? r.frameMsP95 - b.frameMsP95 : null;
    return [
      r.scene, r.mode, `${r.throttle}x`,
      b.frameMsP95 == null ? "-" : b.frameMsP95.toFixed(1),
      r.frameMsP95 == null ? "-" : r.frameMsP95.toFixed(1),
      d == null ? "-" : `${d >= 0 ? "+" : ""}${d.toFixed(1)}`,
      String(b.droppedFrames), String(r.droppedFrames)
    ];
  });
  if (!cells.length) return "(no comparable rows)";
  const w = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) => c.map((v, i) => (i === 0 ? v.padEnd(w[i]) : v.padStart(w[i]))).join("  ");
  return [line(head), w.map((n) => "-".repeat(n)).join("  "), ...cells.map(line)].join("\n");
}

async function main() {
  const o = args(process.argv);

  const template = o.template
    ? path.resolve(o.template)
    : path.join(ROOT, "app", "dist", "cockpit.html");
  if (!fs.existsSync(template)) {
    console.error(`FAIL: no bundle at ${template}, run \`npm run build\` in app/ first, or pass --template.`);
    process.exit(1);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c360-perf-"));
  const data = o.data || path.join(ROOT, "artifact", "live-data.json");
  const assemble = (tpl, into) => {
    fs.mkdirSync(path.join(dir, into), { recursive: true });
    execFileSync("node", [
      path.join(ROOT, "app", "scripts", "assemble-artifact.mjs"),
      data,
      path.join(dir, into, "index.html"),
      tpl
    ], { stdio: "inherit" });
  };
  assemble(template, "b");

  /* THE OTHER SIDE, WHERE THERE IS ONE. "a" is the baseline being compared
     against and "b" is always the bundle under test, so a run with no --against
     is just a run of b. */
  /* `--ablate-b` against the SAME bundle is a paired ablation: identical code on
     both sides, one piece of the material taken off B, both measured in the same
     minute. It is the only ablation worth reading on a box somebody else is
     also using. */
  const against = o.against ? path.resolve(o.against) : (o["ablate-b"] ? template : null);

  /* PAIR TWO MATERIALS, NOT TWO BUNDLES. "calm is cheaper than liquid" is a
     claim about the same code, and measuring the modes one after another is the
     exact mistake `--against` exists to prevent: on this box a mode measured ten
     minutes later reads worse purely because somebody else started a render.
     With `--against-mode` both sides are this bundle and only the query string
     differs, alternating within the same minute. */
  const againstMode = o["against-mode"] || null;
  if (againstMode && !(againstMode in MODE_QUERY)) {
    console.error(`FAIL: unknown --against-mode "${againstMode}". Known: ${Object.keys(MODE_QUERY).join(", ")}`);
    process.exit(1);
  }
  if (against && !fs.existsSync(against)) {
    console.error(`FAIL: no bundle at ${against}`);
    process.exit(1);
  }
  if (against) assemble(against, "a");

  const T = JSON.parse(fs.readFileSync(path.join(HERE, "targets.port.json"), "utf8"));
  const viewport = T.viewport || { width: 1360, height: 900 };
  const server = await serveDir(dir);
  /* /dev/shm IS SMALL IN A CONTAINER, and a scene that holds two full credit
     memos in two frames is exactly the thing that runs a shared-memory segment
     out and takes the whole browser with it. The flag moves that allocation to
     /tmp, which costs a little speed on both sides of a paired run and costs
     nothing to a comparison. */
  const browser = await chromium.launch({
    headless: !o.headed,
    args: ["--disable-dev-shm-usage"]
  });

  let floor = null;
  if (o.check) {
    floor = await floorFor(browser, CHECK.throttle, viewport);
    console.log(`[perf] harness floor at ${CHECK.throttle}x, blank page p95 ${floor.frameMsP95}ms, ${floor.fps} fps`);
  }

  const only = o.scenes ? new Set(String(o.scenes).split(",").map((s) => s.trim())) : null;
  const scenes = SCENES.filter((s) => !only || only.has(s.id));

  const rows = [];
  const paired = [];
  try {
    for (const mode of o.modeList) {
      for (const rate of o.throttleList) {
        for (const scene of scenes) {
          const t0 = Date.now();
          const takesB = [];
          const takesA = [];
          /* ALTERNATING, NOT BLOCKED. A minute of somebody else's video encode
             has to be shared between the two sides, not donated to one. */
          for (let i = 0; i < o.runs; i++) {
            /* A TAKE THAT DIED IS DROPPED, NOT COUNTED. On a box somebody else
               is also using, a context can be killed mid-scene; a run that
               swallowed that as "zero frames" would report the crash as a win. */
            const takeMode = async (side, asMode, ab) => {
              try {
                return await measure(browser, server.url + side, asMode, rate, scene, T.sel, viewport, ab);
              } catch (e) {
                console.log(`[perf] ${scene.id} ${asMode} ${rate}x ${side}, take lost: ${e.message}`);
                return null;
              }
            };
            const take = (side, ab) => takeMode(side, mode, ab);
            if (againstMode) {
              const r = await takeMode("b/", againstMode, o.ablate);
              if (r) takesA.push(r);
            } else if (against) { const r = await take("a/", o.ablate); if (r) takesA.push(r); }
            const r = await take("b/", o["ablate-b"] || o.ablate);
            if (r) takesB.push(r);
          }
          if (!takesB.length || ((against || againstMode) && !takesA.length)) {
            console.log(`[perf] ${scene.id} ${mode} ${rate}x: NO SURVIVING TAKE, skipped`);
            continue;
          }
          const row = median(takesB);
          rows.push(row);
          if (against || againstMode) {
            const before = median(takesA);
            paired.push({ scene: scene.id, mode, against: againstMode || "baseline bundle", throttle: rate, before, after: row });
            console.log(`[perf] ${scene.id} ${mode} ${rate}x, p95 ${before.frameMsP95} -> ${row.frameMsP95}ms, dropped ${before.droppedFrames} -> ${row.droppedFrames}, ${o.runs} pair(s) (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
          } else {
            console.log(`[perf] ${scene.id} ${mode} ${rate}x, p95 ${row.frameMsP95}ms, ${row.droppedFrames} dropped, ${o.runs} run(s) (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
          }
        }
      }
    }
  } finally {
    await browser.close();
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const report = {
    meta: {
      suite: "customer-360-fluidity",
      label: o.label,
      ablate: o.ablate || null,
      againstMode: o["against-mode"] || null,
      template,
      viewport,
      generatedAt: new Date().toISOString(),
      note: "CPU throttling stands in for a laptop encoding a screen share."
    },
    rows,
    floor,
    paired: paired.length ? paired : undefined
  };

  console.log("\n" + table(rows) + "\n");
  if (paired.length) console.log(pairedTable(paired) + "\n");

  if (o.out) {
    fs.writeFileSync(o.out, JSON.stringify(report, null, 2));
    console.log(`[perf] wrote ${o.out}`);
  }

  if (o.compare) {
    const before = JSON.parse(fs.readFileSync(o.compare, "utf8"));
    console.log(`\nBEFORE (${before.meta.label}) vs AFTER (${o.label})\n`);
    console.log(compareTable(before, report) + "\n");
  }

  if (o.check) {
    if (floor && (floor.frameMsP95 == null || floor.frameMsP95 > FLOOR_CEILING_MS)) {
      console.error(`FAIL: this machine cannot be measured, a BLANK page at ${CHECK.throttle}x holds only p95 ${floor.frameMsP95}ms (${floor.fps} fps).`);
      console.error("Nothing below would be a statement about the cockpit. Re-run where the box is not oversubscribed.");
      process.exit(1);
    }
    const wanted = rows.filter((r) => r.mode === CHECK.mode && r.throttle === CHECK.throttle && CHECK.scenes.includes(r.scene));
    if (wanted.length !== CHECK.scenes.length) {
      console.error(`FAIL: --check needs ${CHECK.scenes.join(", ")} in ${CHECK.mode} at ${CHECK.throttle}x; measured ${wanted.length} of ${CHECK.scenes.length}.`);
      process.exit(1);
    }
    const failures = wanted.filter((r) => r.modeApplied !== CHECK.mode || r.steadyP95 == null || r.steadyP95 > CHECK.maxP95Ms);
    for (const f of failures) {
      console.error(`FAIL: ${f.scene} in ${f.modeApplied} at ${f.throttle}x, steady p95 ${f.steadyP95}ms exceeds ${CHECK.maxP95Ms}ms`);
    }
    if (failures.length) process.exit(1);
    console.log(`OK, calm mode at ${CHECK.throttle}x holds a steady p95 under ${CHECK.maxP95Ms}ms on ${CHECK.scenes.join(", ")}.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
