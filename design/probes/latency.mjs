#!/usr/bin/env node
/* Credit 360, THE RELAY BUDGET probe.
 *
 * FOUNDER, 2026-09-06: "let's make it award winning, sexy and latency free",
 * and earlier "fast loading also for the plugin when asking in Cowork as that
 * is the main interface".
 *
 * WHAT THIS MEASURES AND WHY IT IS NOT perf.mjs. perf.mjs measures FRAMES: what
 * the page costs the compositor once it is on screen. This measures ROUND
 * TRIPS: what the page costs the banker before there is anything true on it.
 * They are different bills and only one of them is paid over a network.
 *
 * THE RELAY BUDGET. Every read the page makes crosses the claude.ai
 * artifact-to-connector relay and then the org. Measured on 2026-09-06 from the
 * build box against the read backup's own MCP endpoint (no artifact relay in
 * front of it, so this is the FLOOR, not the whole hop): 243-542ms per call
 * serially, six issued in parallel answering in 534ms of wall clock TOTAL. The
 * org and the transport serve six concurrently for very close to the price of
 * one. The artifact relay adds its own 300-800ms on top, which is the range
 * this probe replays.
 *
 * So: `--latencies 300,500,800` injects L into every stub answer, refusal
 * included, and the three scenes below are timed against the real bundle.
 *
 *   1 firstLiveFigureMs   the account click, to the first figure on the glass
 *                         that came out of the org rather than out of the bake.
 *                         Read off the exposure cell, the same one drive-lanes
 *                         reads: $33.3M is live, $11.1M stored, $4.25M baked
 *   2 allSixSlicesMs      the same click, to the sixth detail read ANSWERING.
 *                         Read off the stub's own settle log, not off the DOM:
 *                         a slice can land behind a tab the banker is not on,
 *                         and it still cost its round trip
 *   3 reloadLiveMs        `--reload` only: the page reloaded onto the client
 *                         view it was standing on, timed from navigation start
 *                         to the first live figure. This is the scene the
 *                         pre-mount head start serves and the ONLY one it can:
 *                         a cold open from Cowork knows no relationship until
 *                         the banker clicks a row
 *   4 roomReadyMs         the same click, through opening the covenant review,
 *                         to the room's first question on the glass. This is
 *                         the honest "time to plan" number: the stage call
 *                         itself is ONE round trip and nothing in this pass
 *                         changes it, so what stands between a banker and a
 *                         staged plan is everything measured here in front of it
 *
 * PAIRED, ALTERNATING, THE WAY perf.mjs DOES IT. Both bundles are served side
 * by side and each take alternates A, B within the same minute, because a
 * neighbouring build or somebody else's test run must land on both sides.
 *
 *   node latency.mjs --against /tmp/cockpit-MAIN-0174e7b.html --runs 3
 *   node latency.mjs --latencies 500 --runs 1            (this bundle only)
 *
 * `--throttle N` runs every take with CDP CPU throttling at N times, which is
 * how perf.mjs stands in for a machine encoding a screen share. It matters here
 * for the same reason it matters there: a relay round trip costs the same on a
 * loaded laptop, but every millisecond of parsing and mounting that the page
 * spends BEFORE issuing the call costs four to six times more, and that is the
 * part a head start can overlap.
 *
 * `--template` defaults to app/dist/cockpit.html, so a run measures the working
 * tree. Both arguments take a RAW bundle; this assembles them, as perf does.
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
const STUB = fs.readFileSync(path.join(HERE, "lib", "stub-lanes.js"), "utf8");

const ACCOUNT = "001bb00001DLtRMAA1";
/* THE LIVE SNAPSHOT NEEDS A PACKAGE OR THE ROOM WILL NOT ASK ITS QUESTION. The
   baked bundle carries one; the stub's live snapshot deliberately does not, and
   a live read replaces the baked slice whole. Supplying it here rather than in
   the stub keeps every drive written before this probe byte-identical. */
const LIVE_PATCH = { Customer360Snapshot: { productPackageId: "a5Fbb000000HA1NEAW" } };

/** The six detail reads, in the order openRefresh issues them. */
const DETAIL_TOOLS = [
  "Customer360Snapshot",
  "Customer360RelationshipGraph",
  "Customer360Exposure",
  "Customer360Covenants",
  "Customer360Opportunities",
  "Customer360StructuralSignals",
];

const ARGS = ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"];

function args(argv) {
  const o = { runs: 3, latencies: "300,500,800", out: null, template: null, against: null, data: null, reload: false, throttle: 1 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { o[key] = next; i++; } else { o[key] = true; }
  }
  o.runs = Number(o.runs) || 1;
  o.throttle = Number(o.throttle) || 1;
  o.latencyList = String(o.latencies).split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  return o;
}

/** One take: one page, one bundle, one relay budget, all three numbers.
 *
 * ALL THREE MARKS COME OFF ONE CLOCK INSIDE THE PAGE, and the drive that
 * produces them runs in the same loop that reads them. Three sequential
 * `waitFor`s outside the page cannot do this: the second one starts when the
 * first has finished, so a mark that never arrives donates its whole budget to
 * the next one and every number after it reads as ~0ms. That is the shape of a
 * measurement bug that flatters a build, and it is the reason this is one
 * `evaluate` rather than three.
 *
 * `textContent`, never `innerText`, on every poll: innerText forces a layout,
 * and a probe that costs the page a reflow every 25ms is measuring itself.
 */
async function take(browser, url, relayMs, withReload, throttle) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  if (throttle > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.addInitScript(STUB);
  await page.addInitScript(
    `var __i = setInterval(function () {
       if (window.__LANES) {
         clearInterval(__i);
         window.__LANES.relayMs = ${relayMs};
         window.__LANES.livePatch = ${JSON.stringify(LIVE_PATCH)};
       }
     }, 0);`,
  );
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForSelector("#kpiband", { timeout: 30_000 });

    /* THE CLOCK STARTS ON THE GESTURE. Everything before it is the landing,
       which has its own two reads and is not what a banker calls opening a
       relationship. */
    const marks = await page.evaluate(
      async ({ account, tools, budgetMs }) => {
        const t0 = performance.now();
        const since = () => Math.round(performance.now() - t0);
        document.querySelector(`[data-open="${account}"]`)?.click();

        const out = { firstLiveFigureMs: null, allSixSlicesMs: null, roomReadyMs: null };
        const buttons = (re) => [...document.querySelectorAll("button")].find((b) => re.test(b.textContent || ""));
        let tabClicked = false;
        let roomClicked = false;
        const deadline = performance.now() + budgetMs;

        while (performance.now() < deadline) {
          /* THE DRIVE. Exposure first, because that is the tab carrying a
             figure the org just returned; then the covenant room, which is the
             door a plan is staged behind. Both are clicked the instant they
             exist, so the reads still in flight behind them are exactly the
             contention being measured. */
          if (!tabClicked) {
            const t = buttons(/Exposure/);
            if (t) { t.click(); tabClicked = true; }
          } else if (!roomClicked) {
            const b = buttons(/Covenant Review/i);
            if (b) { b.click(); roomClicked = true; }
          }

          if (out.firstLiveFigureMs === null) {
            const cell = document.querySelector('[data-delta="exposure.totalOutstanding"]');
            if (cell && /33\.3/.test(cell.textContent || "")) out.firstLiveFigureMs = since();
          }
          if (out.allSixSlicesMs === null) {
            const ok = new Set(window.__LANES.settled.filter((s) => s.ok).map((s) => s.tool.replace(/^gw_/, "")));
            if (tools.every((t) => ok.has(t))) out.allSixSlicesMs = since();
          }
          if (out.roomReadyMs === null && buttons(/Open the covenant review/i)) out.roomReadyMs = since();

          if (out.firstLiveFigureMs !== null && out.allSixSlicesMs !== null && out.roomReadyMs !== null) break;
          await new Promise((r) => setTimeout(r, 25));
        }
        return out;
      },
      { account: ACCOUNT, tools: DETAIL_TOOLS, budgetMs: 45_000 },
    );

    const calls = await page.evaluate(() => window.__LANES.calls.length);
    const maxInFlight = await page.evaluate((tools) => {
      /* THE PEAK CONCURRENCY THE PAGE ACTUALLY REACHED, reconstructed from the
         two logs: a call is in flight from its `calls` row to its `settled`
         row. This is the number the parallel-open change moves, and reporting
         it stops "it got faster" from being the only evidence. */
      const set = new Set(tools);
      const events = [];
      for (const c of window.__LANES.calls) if (set.has(c.tool.replace(/^gw_/, ""))) events.push({ at: c.at, d: 1 });
      for (const s of window.__LANES.settled) if (set.has(s.tool.replace(/^gw_/, ""))) events.push({ at: s.at, d: -1 });
      events.sort((a, b) => a.at - b.at || a.d - b.d);
      let n = 0;
      let peak = 0;
      for (const e of events) { n += e.d; if (n > peak) peak = n; }
      return peak;
    }, DETAIL_TOOLS);

    /* THE RELOAD LEG. sessionStorage survives a reload in the same tab, so the
       cockpit comes back on the client view it was standing on and the head
       start has an account to know before React mounts. Measured from the
       navigation itself, because everything after it, the parse of the baked
       book, the mount, the effect, is exactly what the head start overlaps. */
    let reloadLiveMs = null;
    if (withReload) {
      await page.reload({ waitUntil: "commit" });
      reloadLiveMs = await page.evaluate(async (budgetMs) => {
        const nav = () => performance.getEntriesByType("navigation")[0]?.startTime ?? 0;
        const deadline = performance.now() + budgetMs;
        while (performance.now() < deadline) {
          const cell = document.querySelector('[data-delta="exposure.totalOutstanding"]');
          if (cell && /33\.3/.test(cell.textContent || "")) return Math.round(performance.now() - nav());
          await new Promise((r) => setTimeout(r, 25));
        }
        return null;
      }, 45_000);
    }

    return { ...marks, reloadLiveMs, calls, maxInFlight, errors };
  } finally {
    await page.close();
  }
}

const median = (xs) => {
  const v = xs.filter((n) => typeof n === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};

const FIELDS = ["firstLiveFigureMs", "allSixSlicesMs", "roomReadyMs"];
const RELOAD_FIELD = "reloadLiveMs";

function summarise(takes) {
  const out = {};
  for (const f of FIELDS) out[f] = median(takes.map((t) => t[f]));
  out[RELOAD_FIELD] = median(takes.map((t) => t[RELOAD_FIELD]));
  out.calls = median(takes.map((t) => t.calls));
  out.maxInFlight = median(takes.map((t) => t.maxInFlight));
  out.lost = takes.filter((t) => FIELDS.some((f) => t[f] === null)).length;
  out.errors = [...new Set(takes.flatMap((t) => t.errors))];
  return out;
}

function table(rows, hasA, hasReload) {
  const head = [
    "L",
    ...(hasA ? ["side"] : []),
    "first live figure",
    "all six slices",
    ...(hasReload ? ["reload to live"] : []),
    "room ready",
    "calls",
    "peak in flight",
  ];
  const ms = (v) => (v === null || v === undefined ? "-" : `${v}ms`);
  const body = rows.map((r) => [
    `${r.relayMs}ms`,
    ...(hasA ? [r.side] : []),
    ms(r.firstLiveFigureMs),
    ms(r.allSixSlicesMs),
    ...(hasReload ? [ms(r.reloadLiveMs)] : []),
    ms(r.roomReadyMs),
    String(r.calls),
    String(r.maxInFlight),
  ]);
  const all = [head, ...body];
  const w = head.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(w[i])).join("  ");
  return [line(head), w.map((n) => "-".repeat(n)).join("  "), ...body.map(line)].join("\n");
}

async function main() {
  const o = args(process.argv);

  const template = o.template ? path.resolve(o.template) : path.join(ROOT, "app", "dist", "cockpit.html");
  if (!fs.existsSync(template)) {
    console.error(`FAIL: no bundle at ${template}, run \`npm run build\` in app/ first, or pass --template.`);
    process.exit(1);
  }
  const against = o.against ? path.resolve(o.against) : null;
  if (against && !fs.existsSync(against)) {
    console.error(`FAIL: no bundle at ${against}`);
    process.exit(1);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c360-latency-"));
  const data = o.data || path.join(ROOT, "artifact", "live-data.json");
  const assemble = (tpl, into) => {
    fs.mkdirSync(path.join(dir, into), { recursive: true });
    execFileSync(
      "node",
      [path.join(ROOT, "app", "scripts", "assemble-artifact.mjs"), data, path.join(dir, into, "index.html"), tpl],
      { stdio: "inherit" },
    );
  };
  assemble(template, "b");
  if (against) assemble(against, "a");

  const server = await serveDir(dir);
  const browser = await chromium.launch({ args: ARGS });

  const rows = [];
  try {
    for (const relayMs of o.latencyList) {
      const takesB = [];
      const takesA = [];
      /* ALTERNATING, NOT BLOCKED, for the same reason perf.mjs alternates: a
         minute of somebody else's load has to be shared between the two sides
         rather than donated to whichever went second. */
      for (let i = 0; i < o.runs; i++) {
        if (against) {
          try { takesA.push(await take(browser, server.url + "a/", relayMs, Boolean(o.reload), o.throttle)); }
          catch (e) { console.log(`[latency] L=${relayMs} a, take lost: ${e.message}`); }
        }
        try { takesB.push(await take(browser, server.url + "b/", relayMs, Boolean(o.reload), o.throttle)); }
        catch (e) { console.log(`[latency] L=${relayMs} b, take lost: ${e.message}`); }
      }
      if (against && takesA.length) rows.push({ relayMs, side: "main", ...summarise(takesA) });
      if (takesB.length) rows.push({ relayMs, side: "this tree", ...summarise(takesB) });
    }
  } finally {
    await browser.close();
    await server.close();
  }

  console.log(`\ntemplate  ${template}`);
  if (against) console.log(`against   ${against}`);
  console.log(`runs      ${o.runs} per side per L, cpu ${o.throttle}x, medians below\n`);
  console.log(table(rows, Boolean(against), Boolean(o.reload)));

  const errs = rows.flatMap((r) => r.errors);
  if (errs.length) {
    console.log(`\npage errors:`);
    for (const e of [...new Set(errs)]) console.log(`  ${e}`);
  }
  const lost = rows.reduce((n, r) => n + r.lost, 0);
  if (lost) console.log(`\n${lost} take(s) never reached one of the three marks.`);

  if (o.out) {
    fs.writeFileSync(o.out, JSON.stringify({ template, against, runs: o.runs, rows }, null, 2));
    console.log(`\nreport in ${o.out}`);
  }
}

await main();
