#!/usr/bin/env node
/* Customer 360, THE ROOM'S ENDING AS A FRAME STRIP.
 *
 * FOUNDER, 2026-09-06: "make the modification / renewal and loan creation at the
 * end a little bit more cinematic, I liked the rainbow card morphing into this
 * but I need a clean room at the end when it's done with a clean Summary screen."
 *
 * A STILL CANNOT SETTLE A MOTION ARGUMENT, and neither can a video whose frames
 * are mapped onto wall time by arithmetic. The first version of this file cut its
 * strip out of a playwright `recordVideo` webm by guessing where the ending sat
 * inside the container's duration, and the guess was wrong: every tile showed the
 * sheet already at rest, which read as a morph that never ran.
 *
 * SO THE FRAMES COME FROM THE PAGE ITSELF, WITH THEIR OWN TIMESTAMPS. CDP's
 * screencast hands over each frame the renderer actually painted, stamped, so the
 * strip is the real ending in the real order. Nothing is resampled and nothing is
 * interpolated: every tile is a frame that was on the glass.
 *
 * WHAT IT CANNOT DO IS INVENT FRAMES THE BOX NEVER PAINTED. This machine is
 * headless with no GPU and rasterises the liquid glass on the CPU at nine to
 * twelve frames a second, so the strip's rate is the box's rate and it is
 * PRINTED rather than claimed. A stepped virtual clock was tried for exactly this
 * reason and does not work: `Page.captureScreenshot` waits for a frame the
 * compositor cannot produce while the clock is paused, and the capture deadlocks
 * on the first frame carrying an animation.
 *
 * IT ALSO MEASURES WHAT IT PHOTOGRAPHS. An in-page sampler reads the sheet's own
 * box on every animation frame, so the strip comes with the series that proves
 * the morph TRAVELS from the card's box to the sheet's rather than jumping
 * between them.
 *
 *   node design/probes/strip-finale.mjs [outDir] [bundle.html]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { serveDir } from "./lib/serve.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] ?? "/tmp/c360-finale-strip");
const BUNDLE = process.argv.find((a) => a.endsWith(".html")) ?? "/tmp/c360-finale.html";

/** How long the strip watches, from the approval. Confirm to the sheet at rest is
 *  a little under four seconds on this book. */
const WATCH_MS = 5400;

const HARTWELL = "001bb00001I7FPNAA3";
const CNI = "a5Fbb000000IHFJEA4";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jsClick = (page, sel) =>
  page.evaluate((s) => Boolean(document.querySelector(s)?.click() ?? document.querySelector(s)), sel);
const clickText = (page, sel, rx) =>
  page.evaluate(([s, r]) => {
    const el = [...document.querySelectorAll(s)].find((b) => new RegExp(r, "i").test(b.textContent || ""));
    if (el) el.click();
    return Boolean(el);
  }, [sel, rx]);

async function main() {
  if (!fs.existsSync(BUNDLE)) {
    console.error(`FAIL: no bundle at ${BUNDLE}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const frames = path.join(OUT, "frames");
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c360-strip-"));
  fs.copyFileSync(BUNDLE, path.join(dir, "index.html"));
  const server = await serveDir(dir);

  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 940 }, reducedMotion: "no-preference" });
  await ctx.addInitScript({ content: `window.__CHAOS = { rules: [], sample: "ok" }; window.__CHAOS_TRAIL = "Completed";` });
  await ctx.addInitScript({ path: path.join(HERE, "lib", "chaos.js") });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);

  /* ---- to the approval. None of this is the strip. */
  await page.goto(server.url, { waitUntil: "load" });
  await sleep(1600);
  await jsClick(page, `[data-open="${HARTWELL}"]`);
  await sleep(1400);
  await jsClick(page, "#fab");
  await sleep(600);
  await jsClick(page, "#actFacility");
  await page.waitForSelector(`.wk-pkg[data-pkg="${CNI}"]`, { state: "attached", timeout: 20_000 });
  await jsClick(page, `.wk-pkg[data-pkg="${CNI}"]`);
  await sleep(1800);
  await page.evaluate(() => {
    const box = document.querySelector(".wk-txt");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(box, "increase the revolving line of credit to 18 million");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".wk-send")?.click();
  });
  await sleep(2800);
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
  await jsClick(page, ".wk-propose");
  await sleep(1600);
  await page.waitForSelector(".wk-approve", { state: "attached", timeout: 15_000 });

  /* ---- the sampler, armed inside the page.

     One read per animation frame of the two boxes the morph is an argument
     about, on the page's own rAF, so the series is the browser's account of what
     it painted rather than the harness's account of what it asked for. */
  await page.evaluate(() => {
    window.__SERIES = [];
    window.__T0 = performance.now();
    const tick = () => {
      const sheet = document.querySelector(".wk-sheet");
      const card = document.querySelector("[data-finale-card]");
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      };
      /* THE ANIMATION'S OWN CLOCK, NOT THE LAST PAINT.

         A transform/opacity animation runs on the compositor, and
         `getBoundingClientRect` returns the value the MAIN thread last committed
         - which on a box painting six times a second is a staircase whatever the
         animation is doing. The animation object knows better: `currentTime` and
         the effect's eased `progress` are clock arithmetic, readable at any rate,
         and they are what the compositor is interpolating between. Read both:
         the progress is the curve, the box is what was painted. */
      const growth = sheet ? sheet.getAnimations().find((a) => a.effect && a.playState !== "idle") : null;
      const timing = growth ? growth.effect.getComputedTiming() : null;
      window.__SERIES.push({
        t: Math.round(performance.now() - window.__T0),
        morph: sheet?.getAttribute("data-morph") ?? null,
        cardState: card?.getAttribute("data-morph") ?? null,
        finale: document.querySelector(".wk-thread")?.getAttribute("data-finale") ?? null,
        sheet: box(sheet),
        opacity: sheet ? Number(getComputedStyle(sheet).opacity).toFixed(2) : null,
        card: box(card),
        clock: growth && typeof growth.currentTime === "number" ? Math.round(growth.currentTime) : null,
        progress: timing && timing.progress != null ? Number(timing.progress.toFixed(4)) : null,
      });
      if (performance.now() - window.__T0 < 9000) window.setTimeout(tick, 8);
    };
    /* SAMPLED ON A TIMER, NOT ON rAF. `requestAnimationFrame` fires once per
       PAINT, and this box paints the glass eight times a second, so a rAF
       sampler reports six readings across a 600ms transition and reads like a
       jump whatever the transition is doing. `getBoundingClientRect` returns the
       transition's current interpolated value whether or not that value has been
       painted yet, so an 8ms timer is a true account of the curve and the frame
       rate stays a separate fact. */
    window.setTimeout(tick, 8);
  });

  /* ---- and the frames, as the renderer paints them. */
  const shots = [];
  let base = null;
  cdp.on("Page.screencastFrame", async (f) => {
    if (base === null) base = f.metadata.timestamp;
    shots.push({ at: Math.round((f.metadata.timestamp - base) * 1000), data: f.data });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });

  await clickText(page, ".wk-approve", ".");
  await sleep(WATCH_MS);
  await cdp.send("Page.stopScreencast").catch(() => {});

  const series = await page.evaluate(() => window.__SERIES);
  await ctx.close();
  await browser.close();
  await server.close();
  fs.rmSync(dir, { recursive: true, force: true });

  /* ---- what was caught, and how fast the box was going. */
  for (const [i, s] of shots.entries()) {
    fs.writeFileSync(path.join(frames, `f-${String(i).padStart(3, "0")}.jpg`), Buffer.from(s.data, "base64"));
  }
  const span = shots.length > 1 ? shots[shots.length - 1].at - shots[0].at : 0;
  const rate = span ? ((shots.length - 1) / (span / 1000)).toFixed(1) : "0";

  const tile = (from, count, cols, file) =>
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error",
      "-start_number", String(from),
      "-i", path.join(frames, "f-%03d.jpg"),
      "-frames:v", "1",
      "-vf", `scale=420:-1,tile=${cols}x${Math.ceil(count / cols)}:nb_frames=${count}:margin=8:padding=6:color=white`,
      path.join(OUT, file),
    ]);

  tile(0, shots.length, 6, "finale-contact-sheet.png");

  /* THE GROWTH ON ITS OWN. The sampler says when the sheet carried `data-morph`,
     and the frames are stamped on the same clock, so the morph's own tiles are
     the frames inside that window. */
  const morph = series.filter((s) => s.morph === "from");
  if (morph.length) {
    const from = morph[0].t;
    const to = morph[morph.length - 1].t;
    const inWindow = shots.map((s, i) => ({ ...s, i })).filter((s) => s.at >= from - 120 && s.at <= to + 260);
    if (inWindow.length) tile(inWindow[0].i, inWindow.length, 4, "finale-morph.png");
    console.log(`[strip] the morph ran ${from}ms to ${to}ms after the approval (${to - from}ms), ` +
      `${inWindow.length} painted frames inside it`);
  }

  fs.writeFileSync(path.join(OUT, "series.json"), JSON.stringify({ rate, shots: shots.map((s) => s.at), series }, null, 1));

  console.log(`[strip] ${shots.length} painted frames over ${span}ms = ${rate} fps, the box's own rate`);
  /* THE CURVE, THINNED TO 24 PER SECOND. Every 41.7ms of the transition, which is
     the rate the strip is read at and the rate a founder's machine will paint it
     at. The full 8ms series is in series.json. */
  const step = 1000 / 24;
  const at24 = [];
  let next = morph.length ? morph[0].t : 0;
  for (const s of morph) {
    if (s.t + 1 >= next) {
      at24.push(s);
      next = s.t + step;
    }
  }
  /* WHAT THE GROWTH IS DOING, at 24 readings a second: the animation's eased
     progress, the width that progress puts the sheet at, and the box the main
     thread had last committed when the reading was taken. The first two are the
     motion; the third is this box's frame rate. */
  const first = at24.find((s) => s.sheet)?.sheet?.w ?? 0;
  const last = at24[at24.length - 1]?.sheet?.w ?? 0;
  console.log(`[strip] the growth, every ${step.toFixed(1)}ms (${at24.length} readings, ${first}px to ${last}px):`);
  for (const s of at24) {
    const at = s.progress != null && last > first ? Math.round(first + s.progress * (last - first)) : null;
    console.log(
      `   ${String(s.t).padStart(4)}ms  clock ${String(s.clock ?? "-").padStart(4)}ms  progress ${
        s.progress != null ? s.progress.toFixed(3) : "  -  "
      }  interpolated ${at != null ? `${at}px` : "-"}  painted ${
        s.sheet ? `${s.sheet.w}x${s.sheet.h} at ${s.sheet.x},${s.sheet.y}` : "-"
      }  opacity ${s.opacity}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
