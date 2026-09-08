#!/usr/bin/env node
/* Customer 360, the LOOK GATE for the liquid pass.
 *
 * FOUNDER, 2026-09-04 (through the coordinator): the liquid glass itself has to
 * run smooth. Every cheaper filter is a claim that the material is unchanged,
 * and a claim about a material is settled by looking at it, not by reasoning
 * about primitives. So: the same six surfaces, at 2x, before and after, and a
 * per-pixel difference with a number on it.
 *
 *   node liquid-shots.mjs --out reference/liquid-shots/before --template /tmp/cockpit-BEFORE.html
 *   node liquid-shots.mjs --out reference/liquid-shots/after
 *   node liquid-shots.mjs --diff reference/liquid-shots/before --against reference/liquid-shots/after
 *   node liquid-shots.mjs --out .../calm --mode calm      (what calm actually looks like)
 *
 * `--mode` is the value the cockpit's own `?refract=` takes: 3 for liquid (the
 * default here), 0 for frost, `calm` for the quiet material. Shooting calm
 * against liquid is how "calm changes exactly this much" stops being a claim.
 *
 * THE DIFF RUNS IN CHROMIUM, on purpose: the probe harness has playwright and
 * nothing else, and a PNG decoder is exactly the kind of dependency a
 * self-contained artifact's toolchain should not grow. Both images go onto a
 * canvas in a blank page and the comparison is eleven lines of JS.
 *
 * 2x IS THE POINT. A displacement field, a rim mask and a blur radius are all
 * things that survive a 1x screenshot and show at 2x, which is also the density
 * every machine this is demoed on actually has.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { serveDir } from "./lib/serve.mjs";
import { LIVE_PORTFOLIO } from "./lib/live-book.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/* THE STATED THRESHOLD. Under these the material is the same material.
   A mean absolute difference of one part in 255 is below what a display can
   show and well below what an eye can find; the tail matters more than the
   mean, so the share of pixels off by more than 8/255 is capped too. */
export const LOOK_GATE = { meanAbs: 1.0, pctOver8: 0.5 };


/* -------------------------------------------------------------- the finale

   THE ONE SURFACE THAT ONLY EXISTS ON THE FAR SIDE OF A WRITE. The stand-in
   connector supplies the org (the app itself refuses to invent a plan), and the
   room is driven the way a banker drives it: one line, whatever gates it trips
   answered in the room's own words, the plan, the approval.

   REDUCED MOTION IS ON FOR EVERY SHOT IN THIS FILE, which is what makes this
   surface shootable at all: the morph lands in one commit, so what is captured
   is the sheet at rest rather than a frame of its growth. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clickText = (page, sel, rx) =>
  page.evaluate(([s, r]) => {
    const el = [...document.querySelectorAll(s)].find((b) => new RegExp(r, "i").test(b.textContent || ""));
    if (el) el.click();
    return Boolean(el);
  }, [sel, rx]);

async function fileAModification(page, sel) {
  await page.click(sel.rowHartwell);
  await page.waitForTimeout(1400);
  await page.click("#fab");
  await page.waitForTimeout(500);
  await page.click("#actFacility");
  /* THE PACKAGE, WAITED FOR RATHER THAN GUESSED AT. Hartwell stages two, so the
     room asks before anything binds, and the ask arrives when the read lands. */
  await page.waitForSelector('.wk-pkg[data-pkg="a5Fbb000000IHFJEA4"]', { state: "attached", timeout: 20_000 });
  await page.evaluate(() => document.querySelector('.wk-pkg[data-pkg="a5Fbb000000IHFJEA4"]')?.click());
  await sleep(1800);
  await page.evaluate(() => {
    const box = document.querySelector(".wk-txt");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(box, "increase the revolving line of credit to 18 million");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".wk-send")?.click();
  });
  await sleep(2800);
  // WHATEVER THE ROOM RAISES, ANSWERED IN ITS OWN WORDS, until the plan is open.
  for (let round = 0; round < 12; round++) {
    if (await page.evaluate(() => document.querySelectorAll(".wk-propose").length > 0)) break;
    const moved =
      (await clickText(page, "button", "^Confirm$")) ||
      (await clickText(page, "button", "^Acknowledge$")) ||
      (await clickText(page, ".wk-opt", "^Leave pricing for later$")) ||
      (await clickText(page, ".wk-opt", "^240 months$"));
    if (!moved) await sleep(900);
    await sleep(1500);
  }
  await page.evaluate(() => document.querySelector(".wk-propose")?.click());
  await sleep(1600);
  await clickText(page, ".wk-approve", ".");
  await page.waitForSelector(".wk-sheet", { state: "attached", timeout: 30_000 });
  await sleep(2400);
}

/* ------------------------------------------------- the new-package surfaces

   FOUNDER, 2026-09-06: "a new package needs to be created for a new facility."
   So the create room no longer stands in a package: it opens on the account,
   the package line reads "New package", and the strip is empty because the
   package it is building has no members. Both surfaces below are new, and both
   are checked in as references, because a new surface has no baseline to diff
   against and would otherwise never be gated at all. */

/** The create room, at rest, on its default path. */
async function openTheCreateRoom(page, sel) {
  await page.click(sel.rowHartwell);
  await page.waitForTimeout(1400);
  await page.click("#fab");
  await page.waitForTimeout(500);
  await page.click("#actFacility");
  /* THE PACKAGE QUESTION STILL RUNS, because the unbound room stands on the
     modify engine to read the relationship at all. Binding "New facility"
     rebuilds the room on the create engine, and that engine drops the package. */
  await page.waitForSelector('.wk-pkg[data-pkg="a5Fbb000000IHFJEA4"]', { state: "attached", timeout: 20_000 });
  await page.evaluate(() => document.querySelector('.wk-pkg[data-pkg="a5Fbb000000IHFJEA4"]')?.click());
  await sleep(1800);
  await clickText(page, ".wk-opt", "^New facility$");
  await sleep(2600);
  /* THE ROOM'S OWN READ, BACK ON THE STAGE. The entry tiers leave a beat after
     they land, so a shot taken here catches a room that has said everything and
     is showing none of it. The summon is the banker's own gesture for "show me
     what you read", and it is what makes this surface a picture of the rule
     rather than a picture of an empty pane. */
  await page.evaluate(() => document.querySelector(".wk-summon")?.click());
  await sleep(1400);
}

async function fileANewFacility(page, sel) {
  await openTheCreateRoom(page, sel);
  await page.evaluate(() => {
    const box = document.querySelector(".wk-txt");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(box, "add a Line of Credit facility of $3,000,000 for working capital");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".wk-send")?.click();
  });
  await sleep(2800);
  /* ALL THREE THE TOOL REFUSES WITHOUT, before the plan is taken: the review
     chip opens on the first confirm and the plan needs product, amount AND
     purpose, so the chip alone is not the signal to take it. */
  for (let round = 0; round < 14; round++) {
    const ready = await page.evaluate(
      () => document.querySelectorAll(".wk-propose").length > 0 && document.querySelectorAll(".wk-ent").length >= 3,
    );
    if (ready) break;
    const moved =
      (await clickText(page, "button", "^Confirm$")) ||
      (await clickText(page, "button", "^Acknowledge$")) ||
      (await clickText(page, ".wk-opt", "^Leave pricing for later$"));
    if (!moved) await sleep(900);
    await sleep(1500);
  }
  await page.evaluate(() => document.querySelector(".wk-propose")?.click());
  await sleep(1600);
  await clickText(page, ".wk-approve", ".");
  await page.waitForSelector(".wk-sheet", { state: "attached", timeout: 30_000 });
  await sleep(2400);
}

/* THE LANDING WITH A LIVE BOOK BEHIND IT (2026-09-08).

   The stand-in connector's `watchTool` answers nobody, which is why every other
   surface here shoots the baked five. This one hands the Portfolio watch the
   org's own twelve, so the frame is the queue the PAGE decided: the samples
   gone, the order breach-then-overdue-then-due-then-maturity, the rule sentence
   under the head and the rest of the book folded away under its divider. A new
   surface has no baseline to diff against, so its reference is checked in. */
const LIVE_WATCH = `(function () {
  var PF = ${JSON.stringify(LIVE_PORTFOLIO)};
  var t = setInterval(function () {
    if (!window.claude || !window.claude.mcp) return;
    clearInterval(t);
    window.claude.mcp.watchTool = function (server, tool, input, handler) {
      if (/Portfolio/.test(tool)) {
        setTimeout(function () {
          handler({ type: "data", result: { payload: { content: [{ isSuccess: true, outputValues: PF }] } } });
        }, 60);
      }
      return function () {};
    };
  }, 0);
})();`;

const SURFACES = [
  {
    id: "landing",
    what: "the worklist, the weave and the bar over it",
    go: async () => {}
  },
  {
    id: "landing-live",
    what: "the queue the page decided off a live book of twelve, with the rest folded away",
    prepare: LIVE_WATCH,
    go: async (page) => { await page.waitForTimeout(1600); }
  },
  {
    id: "landing-bar",
    what: "the top bar's lens with the headline sliding under it",
    clip: ".topbar",
    go: async (page) => { await page.evaluate(() => window.scrollTo(0, 220)); await page.waitForTimeout(500); }
  },
  {
    id: "client",
    what: "the client hero, its weave and its anchors",
    go: async (page, sel) => { await page.click(sel.rowHartwell); await page.waitForTimeout(2200); }
  },
  {
    id: "client-arc",
    what: "the arc open: four satellites on the small lens",
    go: async (page, sel) => {
      await page.click(sel.rowHartwell);
      await page.waitForTimeout(1600);
      await page.click("#fab");
      await page.waitForTimeout(900);
    }
  },
  {
    id: "room",
    what: "the workroom pane, the biggest lens in the app",
    go: async (page, sel) => {
      await page.click(sel.rowHartwell);
      await page.waitForTimeout(1400);
      await page.click("#fab");
      await page.waitForTimeout(500);
      await page.click("#actFacility");
      await page.waitForTimeout(2600);
    }
  },
  {
    id: "room-rail",
    what: "a rail chip, where the small lens reads as thickness",
    clip: ".wk-ent",
    go: async (page, sel) => {
      await page.click(sel.rowHartwell);
      await page.waitForTimeout(1400);
      await page.click("#fab");
      await page.waitForTimeout(500);
      await page.click("#actFacility");
      await page.waitForTimeout(2000);
      await page.evaluate(async (S) => {
        const P = window.__P;
        const pkg = await P.until(() => P.el(S.workroomPackageButton), 6000, 60);
        if (pkg) pkg.click();
        const fac = await P.until(() => P.el(S.workroomFacility), 6000, 60);
        if (fac) fac.click();
        await P.sleep(1400);
      }, sel);
      await page.waitForTimeout(600);
    }
  },
  {
    /* THE OTHER TWO ROOMS. They were not on this list, which is why a rooms
       pass could change them without the gate noticing. */
    id: "relationship-room",
    what: "the relationship room, its pane and its first question",
    go: async (page, sel) => {
      await page.click(sel.rowHartwell);
      await page.waitForTimeout(1400);
      await page.click("#fab");
      await page.waitForTimeout(500);
      await page.click("#actRelationship");
      await page.waitForTimeout(2800);
    }
  },
  {
    id: "memo-draft",
    what: "the memo room mid-draft, prose landing in the reading pane",
    go: async (page, sel) => {
      await page.click(sel.rowHartwell);
      await page.waitForTimeout(1400);
      await page.click("#fab");
      await page.waitForTimeout(500);
      await page.click("#actMemo");
      await page.waitForTimeout(2000);
      await page.evaluate(async () => {
        const P = window.__P;
        const draft = await P.until(() => document.querySelector('[data-chip="draft"]'), 8000, 80);
        if (draft) draft.click();
        await P.sleep(4000);
      });
    }
  },
  {
    /* THE CLEAN SUMMARY THE ROOM ENDS ON (founder, 2026-09-06). New surface: the
       sheet the rainbow card grows into, at rest, with the room empty behind it. */
    id: "finale-sheet",
    what: "the filed sheet, alone in a cleared room",
    go: async (page, sel) => {
      await fileAModification(page, sel);
    }
  },
  {
    /* AND THE ROOM IT HANDS TO. The sheet slides off a memo room that mounted
       underneath it and becomes that room's first timeline row. */
    id: "memo-after-handoff",
    what: "the memo room the sheet handed to, with the filing as its first row",
    go: async (page, sel) => {
      await fileAModification(page, sel);
      await clickText(page, ".wk-sheet-go", "Draft the credit memo");
      await page.waitForSelector(".mm-filed", { state: "attached", timeout: 20_000 });
      /* PAST THE HANDOVER AND INTO THE DRAFT. The room starts writing on its
         own once the glass has settled, so this waits for the timeline to be
         doing something rather than for a chip nobody is going to press. */
      await sleep(6000);
    }
  },
  {
    id: "create-room",
    what: "the new facility room on its default path: package line New package, empty strip",
    go: openTheCreateRoom
  },
  {
    id: "create-sheet",
    what: "the filed sheet after a create, naming the package the org made",
    go: fileANewFacility
  },
  {
    id: "memo-done",
    what: "the memo room with the draft finished on the glass",
    go: async (page, sel) => {
      await page.click(sel.rowHartwell);
      await page.waitForTimeout(1400);
      await page.click("#fab");
      await page.waitForTimeout(500);
      await page.click("#actMemo");
      await page.waitForTimeout(2000);
      await page.evaluate(async () => {
        const P = window.__P;
        const draft = await P.until(() => document.querySelector('[data-chip="draft"]'), 8000, 80);
        if (draft) draft.click();
        await P.sleep(14000);
      });
    }
  }
];

function args(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) o[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return o;
}

async function shoot(o) {
  const template = o.template ? path.resolve(o.template) : path.join(ROOT, "app", "dist", "cockpit.html");
  if (!fs.existsSync(template)) { console.error(`FAIL: no bundle at ${template}`); process.exit(1); }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c360-shots-"));
  execFileSync("node", [
    path.join(ROOT, "app", "scripts", "assemble-artifact.mjs"),
    path.join(ROOT, "artifact", "live-data.json"),
    path.join(dir, "index.html"),
    template
  ], { stdio: "inherit" });

  const T = JSON.parse(fs.readFileSync(path.join(HERE, "targets.port.json"), "utf8"));
  const out = path.resolve(o.out);
  fs.mkdirSync(out, { recursive: true });

  /* ONE SURFACE, WHERE ONLY ONE MOVED. A full pass is eleven browsers' worth of
     driving; re-shooting the two the finale added should not cost the other nine.
     The reference dir keeps whatever is already in it. */
  const only = o.surfaces ? new Set(String(o.surfaces).split(",").map((x) => x.trim())) : null;

  const server = await serveDir(dir);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const surface of SURFACES) {
      if (only && !only.has(surface.id)) continue;
      const ctx = await browser.newContext({
        viewport: T.viewport,
        deviceScaleFactor: 2,
        /* THE MOTION IS OFF FOR THE SHOT, and only for the shot. Every arrival
           in this app is a real animation, so a screenshot taken while one is
           running is a comparison of two different moments rather than of two
           materials. What is being judged here is the still material: the tint,
           the frost, the rim, the bend. */
        reducedMotion: "reduce",
        colorScheme: "light"
      });
      await ctx.addInitScript({ path: path.join(HERE, "lib", "inject.js") });
      await ctx.addInitScript({ path: path.join(HERE, "lib", "stub-connector.js") });
      // A surface that needs the stand-in to behave differently says so itself,
      // rather than every surface inheriting one shot's special case.
      if (surface.prepare) await ctx.addInitScript({ content: surface.prepare });
      const page = await ctx.newPage();
      await page.goto(server.url + `?refract=${o.mode ?? "3"}`, { waitUntil: "load" });
      await page.waitForFunction(() => !!window.__P);
      await page.waitForTimeout(1800);

      await surface.go(page, T.sel).catch((e) => console.log(`[shots] ${surface.id}, setup: ${e.message}`));

      const target = surface.clip ? await page.$(surface.clip) : null;
      const file = path.join(out, `${surface.id}.png`);
      if (surface.clip && !target) {
        console.log(`[shots] ${surface.id}: SKIPPED, ${surface.clip} not on the page`);
      } else if (target) {
        await target.screenshot({ path: file });
        console.log(`[shots] ${surface.id}, ${surface.what}`);
      } else {
        await page.screenshot({ path: file });
        console.log(`[shots] ${surface.id}, ${surface.what}`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`[shots] wrote ${out}`);
}

async function diff(o) {
  const a = path.resolve(o.diff);
  const b = path.resolve(o.against);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("about:blank");

  const rows = [];
  try {
    for (const surface of SURFACES) {
      const fa = path.join(a, `${surface.id}.png`);
      const fb = path.join(b, `${surface.id}.png`);
      if (!fs.existsSync(fa) || !fs.existsSync(fb)) {
        rows.push({ id: surface.id, note: "missing on one side" });
        continue;
      }
      const one = "data:image/png;base64," + fs.readFileSync(fa).toString("base64");
      const two = "data:image/png;base64," + fs.readFileSync(fb).toString("base64");
      const r = await page.evaluate(async ([srcA, srcB]) => {
        const load = (src) => new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = src;
        });
        const [ia, ib] = await Promise.all([load(srcA), load(srcB)]);
        if (ia.width !== ib.width || ia.height !== ib.height) {
          return { note: `size ${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
        }
        const draw = (img) => {
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          c.getContext("2d").drawImage(img, 0, 0);
          return c.getContext("2d").getImageData(0, 0, img.width, img.height).data;
        };
        const da = draw(ia);
        const db = draw(ib);
        let sum = 0, max = 0, over2 = 0, over8 = 0;
        /* WHERE the difference is, not just how much of it there is. A mean
           inside the gate can still hide one patch that is completely wrong, and
           a bounding box is the cheapest way to be told which part of the page
           to go and look at. */
        let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
        const pixels = ia.width * ia.height;
        for (let i = 0; i < da.length; i += 4) {
          const d = Math.max(
            Math.abs(da[i] - db[i]),
            Math.abs(da[i + 1] - db[i + 1]),
            Math.abs(da[i + 2] - db[i + 2]),
          );
          sum += d;
          if (d > max) max = d;
          if (d > 2) over2 += 1;
          if (d > 8) {
            over8 += 1;
            const px = (i / 4) % ia.width;
            const py = Math.floor((i / 4) / ia.width);
            if (px < x0) x0 = px;
            if (py < y0) y0 = py;
            if (px > x1) x1 = px;
            if (py > y1) y1 = py;
          }
        }
        return {
          width: ia.width,
          height: ia.height,
          meanAbs: Math.round((sum / pixels) * 1000) / 1000,
          maxAbs: max,
          pctOver2: Math.round((over2 / pixels) * 100000) / 1000,
          pctOver8: Math.round((over8 / pixels) * 100000) / 1000,
          box: x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
        };
      }, [one, two]);
      rows.push({ id: surface.id, ...r });
    }
  } finally {
    await browser.close();
  }

  const head = ["surface", "size", "mean", "max", "% >2", "% >8", "where >8/255 is", "verdict"];
  const cells = rows.map((r) => [
    r.id,
    r.note ? "-" : `${r.width}x${r.height}`,
    r.note ? "-" : r.meanAbs.toFixed(3),
    r.note ? "-" : String(r.maxAbs),
    r.note ? "-" : r.pctOver2.toFixed(3),
    r.note ? "-" : r.pctOver8.toFixed(3),
    r.note || !r.box ? "-" : `${r.box.w}x${r.box.h} at ${r.box.x},${r.box.y}`,
    r.note ? r.note : (r.meanAbs <= LOOK_GATE.meanAbs && r.pctOver8 <= LOOK_GATE.pctOver8 ? "held" : "CHANGED")
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) => c.map((v, i) => (i === 0 ? v.padEnd(w[i]) : v.padStart(w[i]))).join("  ");
  console.log("\n" + [line(head), w.map((n) => "-".repeat(n)).join("  "), ...cells.map(line)].join("\n"));
  console.log(`\ngate: mean <= ${LOOK_GATE.meanAbs}/255 and pixels off by more than 8/255 <= ${LOOK_GATE.pctOver8}%\n`);

  if (o.out) fs.writeFileSync(o.out, JSON.stringify({ gate: LOOK_GATE, rows }, null, 2));

  const changed = rows.filter((r) => !r.note && !(r.meanAbs <= LOOK_GATE.meanAbs && r.pctOver8 <= LOOK_GATE.pctOver8));
  if (o.check && changed.length) process.exit(1);
}

const o = args(process.argv);
if (o.diff) await diff(o);
else if (o.out) await shoot(o);
else {
  console.error("usage: liquid-shots.mjs --out <dir> [--template <bundle>] [--surfaces id,id]\n       liquid-shots.mjs --diff <dirA> --against <dirB> [--check] [--out report.json]");
  process.exit(1);
}
