#!/usr/bin/env node
/* Customer 360, THE MORPH AS A FRAME STRIP.
 *
 * FOUNDER, 2026-09-06: "make the modification / renewal and loan creation at the
 * end a little bit more cinematic, I liked the rainbow card morphing into this
 * but I need a clean room at the end when it's done with a clean Summary screen."
 *
 * A STILL CANNOT SETTLE A MOTION ARGUMENT. `drive-finale.mjs` freezes the beats
 * and photographs them, which proves where each one stands; it cannot show that
 * the room's ending reads as ONE movement rather than four. This records the real
 * thing at real speed and lays 30 consecutive frames out as a contact sheet, so
 * the whole ending can be read across a page: the rails wiping, the thread
 * draining, the rainbow card landing, the card growing into the sheet, and the
 * sheet at rest in a clean room.
 *
 * REAL TIME, NOT STEPPED TIME. The take is a browser video of the actual run and
 * the frames are cut out of it at 24fps, so a frame that stutters in the video
 * stutters on the sheet. Nothing here pauses an animation or sets a currentTime.
 *
 *   node design/probes/strip-finale.mjs [outDir] [bundle.html]
 *
 * ffmpeg does the cutting and the tiling: playwright records webm and has no
 * frame API, and a contact sheet is one `tile` filter.
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

/** The founder's own strip: 30 frames at 24fps, which is 1.25s of screen time
 *  sampled across the whole ending. */
const FRAMES = 30;
const FPS = 24;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jsClick = (page, sel) => page.evaluate((s) => Boolean(document.querySelector(s)?.click() ?? document.querySelector(s)), sel);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c360-strip-"));
  fs.copyFileSync(BUNDLE, path.join(dir, "index.html"));
  const server = await serveDir(dir);
  const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), "c360-take-"));

  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"] });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 940 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 940 } },
  });
  await ctx.addInitScript({ content: `window.__CHAOS = { rules: [], sample: "ok" }; window.__CHAOS_TRAIL = "Completed";` });
  await ctx.addInitScript({ path: path.join(HERE, "lib", "chaos.js") });
  const page = await ctx.newPage();

  await page.goto(server.url, { waitUntil: "load" });
  await sleep(1600);
  await jsClick(page, '[data-open="001bb00001I7FPNAA3"]');
  await sleep(1400);
  await jsClick(page, "#fab");
  await sleep(600);
  await jsClick(page, "#actFacility");
  await page.waitForSelector('.wk-pkg[data-pkg="a5Fbb000000IHFJEA4"]', { state: "attached", timeout: 20_000 });
  await jsClick(page, '.wk-pkg[data-pkg="a5Fbb000000IHFJEA4"]');
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

  /* THE TAKE. Confirm, and then nothing but watching: the room's ending is the
     only thing moving from here, and the strip is cut out of exactly this. */
  const t0 = Date.now();
  await clickText(page, ".wk-approve", ".");
  await page.waitForSelector(".wk-sheet", { state: "attached", timeout: 30_000 });
  const sheetAt = Date.now() - t0;
  await sleep(1400);

  const video = page.video();
  await ctx.close();
  const take = await video.path();
  fs.copyFileSync(take, path.join(OUT, "finale.webm"));
  await browser.close();
  await server.close();
  fs.rmSync(dir, { recursive: true, force: true });

  /* WHERE THE MORPH IS INSIDE THE TAKE.
     The recording starts with the page load, so the approval is `total` minus
     everything watched after it. Thirty frames at 24fps is 1.25 seconds of screen
     time and the room's whole ending is nearer four, so the window is placed on
     the beat the founder asked to see: it opens a breath before the card finishes
     ascending and runs through the growth into the sheet at rest. */
  const total = Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", take], {
      encoding: "utf8",
    }).trim(),
  );
  const confirmAt = Math.max(0, total - (sheetAt + 1400) / 1000);
  const start = confirmAt + Math.max(0, sheetAt - 500) / 1000;

  const frames = path.join(OUT, "frames");
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-ss", start.toFixed(3),
    "-i", take,
    "-vf", `fps=${FPS},scale=480:-1`,
    "-frames:v", String(FRAMES),
    path.join(frames, "f-%02d.png"),
  ]);
  /* THE CONTACT SHEET. Six across, five down, in order, so the whole ending is
     one page a founder can read without a player. */
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-ss", start.toFixed(3),
    "-i", take,
    "-vf", `fps=${FPS},scale=480:-1,tile=6x5:margin=8:padding=6:color=white`,
    "-frames:v", "1",
    path.join(OUT, "finale-contact-sheet.png"),
  ]);

  const shot = fs.readdirSync(frames).length;
  console.log(
    `[strip] take ${total.toFixed(2)}s, confirm at ${confirmAt.toFixed(2)}s, strip opens at ${start.toFixed(2)}s ` +
      `(the sheet lands ${sheetAt}ms after confirm)`,
  );
  console.log(`[strip] ${shot} frames at ${FPS}fps and one contact sheet in ${OUT}`);
  fs.rmSync(videoDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
