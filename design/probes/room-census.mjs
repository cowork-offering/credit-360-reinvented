#!/usr/bin/env node
/* Credit 360, the ROOM CENSUS.
 *
 * perf.mjs says a room is slow. This says what is in it.
 *
 * FOUNDER, 2026-09-05: "we need to ensure the rooms are smooth without
 * rendering issues without loosing the current look and feel; there must be
 * some things we can do."
 *
 * There are, and the first of them is to stop guessing from the stylesheet.
 * A grep for `backdrop-filter` finds declarations; it does not find which of
 * them are LIVE in an open room, how many instances of each there are, or
 * which ones sit INSIDE another backdrop surface, which is the thing that
 * actually costs. Same for filters, for standing `will-change`, and for
 * infinite animations: the question is never "does the stylesheet have one",
 * it is "how many are running in this room, right now, on what property".
 *
 * WHAT IT REPORTS, per room, after the room has settled:
 *   NESTED BACKDROPS  every element with a live backdrop-filter, its depth
 *                     inside other backdrop surfaces, and whether it carries
 *                     the url() lens. Depth > 0 is a readback of a readback.
 *   FILTERS           every element with a live `filter`, animating or not.
 *   WILL-CHANGE       standing promotions, which are compositor layers held
 *                     open for a hover that may never come.
 *   INFINITE LOOPS    every animation with an infinite iteration count, the
 *                     properties it animates, and whether those properties are
 *                     compositor-only (transform/opacity) or paint.
 *   OFF-SCREEN        how many thread bubbles, timeline rows and rail chips
 *                     are laid out but outside their scroller, which is the
 *                     population `content-visibility: auto` is for.
 *   LAYERS            the CDP compositor layer count and total layer area.
 *
 *   node room-census.mjs                          (all rooms, liquid)
 *   node room-census.mjs --rooms memo --mode calm
 *   node room-census.mjs --out /tmp/census.json
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
const MODE_QUERY = { liquid: "?refract=3", subtle: "?refract=1", frost: "?refract=0", calm: "?refract=calm" };

/* The three rooms, opened the way a banker opens them. Each one is driven far
   enough in that the surfaces the founder is looking at actually exist: an
   empty room is not the room that is slow. */
const ROOMS = {
  facility: async (page, sel) => {
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
      await P.sleep(600);
      const box = P.el(S.workroomInput);
      if (box) {
        P.type(box, "Increase the Line of Credit to $19M");
        const send = P.el(S.workroomSend);
        if (send) send.click();
        await P.until(() => P.el(S.workroomDelta), 8000, 80);
      }
      await P.sleep(1500);
    }, sel);
  },
  memo: async (page) => {
    await page.click('[data-open="001bb00001I7FPNAA3"]');
    await page.waitForTimeout(1200);
    await page.click("#fab");
    await page.waitForTimeout(500);
    await page.click("#actMemo");
    await page.waitForTimeout(1600);
    await page.evaluate(async () => {
      const P = window.__P;
      const draft = await P.until(() => document.querySelector('[data-chip="draft"]'), 8000, 80);
      if (draft) draft.click();
      await P.sleep(9000);
    });
  },
  relationship: async (page, sel) => {
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
      await P.sleep(3500);
    }, sel);
  }
};

/* THE CENSUS ITSELF, run inside the page: every element in the document read
   once, so the walk costs one style recalc rather than one per query. */
const CENSUS = () => {
  const label = (el) => {
    const cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || "";
    const first = String(cls).trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".");
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (first ? "." + first : "");
  };
  const count = (map, key, extra) => {
    const row = map.get(key) || { key, n: 0, ...extra };
    row.n++;
    map.set(key, row);
  };

  const all = Array.prototype.slice.call(document.querySelectorAll("*"));
  const backdrops = new Map();
  const filters = new Map();
  const willChange = new Map();
  const backdropEls = new Set();

  for (const el of all) {
    const cs = getComputedStyle(el);
    const bd = cs.backdropFilter || cs.webkitBackdropFilter || "none";
    if (bd && bd !== "none") backdropEls.add(el);
  }
  for (const el of all) {
    const cs = getComputedStyle(el);
    const bd = cs.backdropFilter || cs.webkitBackdropFilter || "none";
    if (bd && bd !== "none") {
      /* HOW DEEP INSIDE OTHER BACKDROPS. Each level is one more full readback
         of a region that is itself the output of a filter. */
      let depth = 0;
      for (let p = el.parentElement; p; p = p.parentElement) if (backdropEls.has(p)) depth++;
      const r = el.getBoundingClientRect();
      count(backdrops, label(el), {
        lens: bd.indexOf("url(") >= 0,
        depth,
        value: bd.slice(0, 70),
        px: Math.round(r.width * r.height)
      });
    }
    const f = cs.filter;
    if (f && f !== "none") count(filters, label(el), { value: f.slice(0, 60) });
    const wc = cs.willChange;
    if (wc && wc !== "auto") count(willChange, label(el), { value: wc });
  }

  /* THE LOOPS. An infinite animation on transform or opacity is a compositor
     job; on anything else it is a paint, every frame, forever. */
  const COMPOSITED = new Set(["transform", "opacity", "translate", "rotate", "scale"]);
  let loops = [];
  try {
    loops = document.getAnimations()
      .filter((a) => {
        const it = a.effect && a.effect.getTiming ? a.effect.getTiming().iterations : 1;
        return it === Infinity || it === null;
      })
      .map((a) => {
        const props = new Set();
        try { for (const k of a.effect.getKeyframes()) for (const p of Object.keys(k)) if (p !== "offset" && p !== "computedOffset" && p !== "easing" && p !== "composite") props.add(p); } catch { /* CSS animation with no readable keyframes */ }
        const el = a.effect && a.effect.target;
        return {
          name: a.animationName || (a.effect && a.effect.getTiming().id) || "(anon)",
          el: el ? label(el) : "(none)",
          state: a.playState,
          props: Array.prototype.slice.call(props),
          composited: Array.prototype.slice.call(props).every((p) => COMPOSITED.has(p))
        };
      });
  } catch { /* nothing to report */ }
  const loopBy = new Map();
  for (const l of loops) {
    const key = l.name + " on " + l.el + " [" + (l.props.join(",") || "?") + "]";
    const row = loopBy.get(key) || { key, n: 0, state: l.state, composited: l.composited };
    row.n++;
    loopBy.set(key, row);
  }

  /* WHAT IS LAID OUT AND NOT LOOKED AT. A bubble scrolled off the top of the
     thread still gets styled, laid out and painted. */
  const offScreen = (sel, scrollerSel) => {
    const scroller = document.querySelector(scrollerSel);
    const els = Array.prototype.slice.call(document.querySelectorAll(sel));
    if (!els.length) return { sel, total: 0, off: 0 };
    const box = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    let off = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.bottom < box.top - 1 || r.top > box.bottom + 1) off++;
    }
    return { sel, total: els.length, off };
  };

  const rank = (m) => Array.from(m.values()).sort((a, b) => b.n - a.n);
  return {
    room: document.querySelector(".wk-root, .wk-room") ? (document.querySelector("[data-room]") || {}).getAttribute?.("data-room") || "open" : "none",
    backdrops: rank(backdrops),
    backdropTotal: Array.from(backdrops.values()).reduce((s, r) => s + r.n, 0),
    backdropNested: Array.from(backdrops.values()).filter((r) => r.depth > 0).reduce((s, r) => s + r.n, 0),
    filters: rank(filters),
    willChange: rank(willChange),
    loops: rank(loopBy),
    loopsPainting: Array.from(loopBy.values()).filter((r) => !r.composited).reduce((s, r) => s + r.n, 0),
    offScreen: [
      offScreen(".wk-msg", ".wk-thread"),
      offScreen(".wk-ent", ".wk-rail-scroll, .wk-rail"),
      offScreen(".mm-tl-row", ".mm-tl")
    ],
    frames: document.querySelectorAll("iframe.mm-doc, iframe").length,
    elements: all.length
  };
};

function args(argv) {
  const o = { mode: "liquid", rooms: "facility,memo,relationship" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--headed") o.headed = true;
    else if (a.startsWith("--")) o[a.slice(2)] = argv[++i];
  }
  return o;
}

function report(name, c) {
  const out = [];
  out.push(`\n=============== ${name} room, ${c.elements} elements, ${c.frames} frame(s)`);
  out.push(`BACKDROPS ${c.backdropTotal} live, ${c.backdropNested} of them nested inside another`);
  for (const r of c.backdrops) {
    out.push(`  ${String(r.n).padStart(3)}x depth ${r.depth}${r.lens ? " LENS" : "     "}  ${r.key.padEnd(34)} ${r.px}px2  ${r.value}`);
  }
  out.push(`FILTERS ${c.filters.reduce((s, r) => s + r.n, 0)}`);
  for (const r of c.filters) out.push(`  ${String(r.n).padStart(3)}x ${r.key.padEnd(34)} ${r.value}`);
  out.push(`WILL-CHANGE ${c.willChange.reduce((s, r) => s + r.n, 0)}`);
  for (const r of c.willChange) out.push(`  ${String(r.n).padStart(3)}x ${r.key.padEnd(34)} ${r.value}`);
  out.push(`INFINITE LOOPS ${c.loops.reduce((s, r) => s + r.n, 0)}, ${c.loopsPainting} of them painting (not compositor-only)`);
  for (const r of c.loops) out.push(`  ${String(r.n).padStart(3)}x ${r.composited ? "compositor" : "PAINT     "} ${r.state.padEnd(8)} ${r.key}`);
  out.push("OFF-SCREEN");
  for (const r of c.offScreen) out.push(`  ${r.sel.padEnd(12)} ${r.off}/${r.total} outside their scroller`);
  out.push(`LAYERS ${c.compositorLayers}`);
  return out.join("\n");
}

async function main() {
  const o = args(process.argv);
  const template = o.template ? path.resolve(o.template) : path.join(ROOT, "app", "dist", "cockpit.html");
  if (!fs.existsSync(template)) {
    console.error(`FAIL: no bundle at ${template}, run \`npm run build\` in app/ first.`);
    process.exit(1);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c360-census-"));
  fs.mkdirSync(path.join(dir, "b"), { recursive: true });
  execFileSync("node", [
    path.join(ROOT, "app", "scripts", "assemble-artifact.mjs"),
    o.data || path.join(ROOT, "artifact", "live-data.json"),
    path.join(dir, "b", "index.html"),
    template
  ], { stdio: "inherit" });

  const T = JSON.parse(fs.readFileSync(path.join(HERE, "targets.port.json"), "utf8"));
  const viewport = T.viewport || { width: 1360, height: 900 };
  const server = await serveDir(dir);
  const browser = await chromium.launch({ headless: !o.headed, args: ["--disable-dev-shm-usage"] });

  const results = {};
  try {
    for (const name of String(o.rooms).split(",").map((s) => s.trim()).filter(Boolean)) {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "no-preference", colorScheme: "light" });
      for (const f of ["inject.js", "perf-record.js", "stub-connector.js", "stub-sample.js"]) {
        await ctx.addInitScript({ path: path.join(HERE, "lib", f) });
      }
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      let layers = null;
      await cdp.send("LayerTree.enable").catch(() => {});
      cdp.on("LayerTree.layerTreeDidChange", (e) => { if (e.layers) layers = e.layers.length; });
      await page.goto(server.url + "b/" + MODE_QUERY[o.mode], { waitUntil: "load" });
      await page.waitForFunction(() => !!window.__P);
      await page.waitForTimeout(2500);
      await ROOMS[name](page, T.sel).catch((e) => console.error(`${name}: ${e.message}`));
      await page.waitForTimeout(800);
      const c = await page.evaluate(CENSUS);
      c.compositorLayers = layers;
      results[name] = c;
      console.log(report(name, c));
      await cdp.detach().catch(() => {});
      await ctx.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  if (o.out) {
    fs.writeFileSync(o.out, JSON.stringify({ mode: o.mode, at: new Date().toISOString(), rooms: results }, null, 2));
    console.log(`\n[census] ${o.out}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
