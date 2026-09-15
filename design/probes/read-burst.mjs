/* THE READ BURST RECORDER (backlog row 73).

   WHAT IT MEASURES. Every connector call the built page makes, on three gestures, with no
   instrumentation whatsoever in product code: the recorder wraps the STUB's own `callTool`
   after `stub-lanes.js` has installed it, so what it counts is exactly what would have gone
   over the artifact-to-connector wire.

   THE THREE GESTURES, in the order a banker makes them:
     boot   goto -> the worklist paints -> quiet
     open   click the relationship row -> the account view paints -> quiet
     sync   click Sync -> the sweep runs -> quiet

   A gesture ENDS when no new call has been issued for QUIET_MS, or at its own ceiling. QUIET_MS is
   longer than the read seam's own coalescing window (SPEC-0.9.30), so the three gestures are three
   gestures and not one long one.

   WHAT IT REPORTS, per gesture: distinct reads, total calls, duplicates per read, peak calls per
   second, and PEAK CONCURRENT ON THE WIRE, which is the number a concurrency cap actually bounds.
   Four slots against a 200ms relay issue twenty calls a second and are still four.

   Usage:
     node read-burst.mjs [bundle.html] [out.json] [--book Hartwell] [--quiet 6000] [--relay 200]
     node read-burst.mjs app/dist/cockpit.html out.json --lanes '{"mode":"down"}'   # the 502 day */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "/opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented/design/probes/node_modules/playwright/index.mjs";
import { serveDir } from "/opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented/design/probes/lib/serve.mjs";
import { bookParams, resolveBook } from "/opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented/design/probes/lib/book.mjs";

const ROOT = "/opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented";

function takeFlag(name) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return null;
  const value = process.argv[at + 1] ?? null;
  process.argv.splice(at, value === null ? 1 : 2);
  return value;
}

const BOOK_ARG = takeFlag("book") || "Hartwell";
const QUIET_MS = Number(takeFlag("quiet") || 6000);
const RELAY_MS = Number(takeFlag("relay") || 200);
const LANES = JSON.parse(takeFlag("lanes") || "null");
const BUNDLE = process.argv[2] || path.join(ROOT, "app/dist/cockpit.html");
const OUT = process.argv[3] || path.join(ROOT, "read-burst-out.json");

const STUB = fs.readFileSync(path.join(ROOT, "design/probes/lib/stub-lanes.js"), "utf8");
const SAMPLE = fs.readFileSync(path.join(ROOT, "design/probes/lib/stub-sample.js"), "utf8");
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, "artifact/live-data.json"), "utf8"));
const ACCOUNT = resolveBook(LIVE, BOOK_ARG);
const BOOK = bookParams(LIVE, ACCOUNT);

/* THE RECORDER. Installed AFTER the stub, so `window.claude.use("mcp")` already exists and this
   wraps whatever it hands back. Every call is stamped with the phase the drive set, the tool, a
   canonical hash of the arguments and the JS stack at the moment of the call. */
const RECORDER = `(function () {
  Error.stackTraceLimit = 80;
  var rec = { phase: "pre", calls: [], t0: Date.now() };
  window.__REC = rec;
  window.__REC.phase = "boot";
  var canon = function (v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  };
  var use = window.claude.use;
  window.claude.use = function (name) {
    return use.call(window.claude, name).then(function (ns) {
      if (name !== "mcp" || !ns || ns.__wrapped) return ns;
      var callTool = ns.callTool.bind(ns);
      var watchTool = ns.watchTool ? ns.watchTool.bind(ns) : null;
      var listTools = ns.listTools ? ns.listTools.bind(ns) : null;
      var note = function (kind, server, tool, input) {
        var stack = "";
        try { throw new Error("rec"); } catch (e) { stack = String(e.stack || ""); }
        var id = rec.calls.length;
        rec.calls.push({
          i: id, kind: kind, phase: rec.phase, server: server, tool: tool,
          args: canon(input), at: Date.now() - rec.t0, stack: stack, ms: null, ok: null,
        });
        return id;
      };
      var settle = function (id, ok) { var c = rec.calls[id]; if (c) { c.ms = Date.now() - rec.t0 - c.at; c.ok = ok; } };
      ns.callTool = function (server, tool, input, options) {
        var id = note("call", server, tool, input);
        return callTool(server, tool, input, options).then(
          function (r) { settle(id, true); return r; },
          function (e) { settle(id, false); throw e; },
        );
      };
      if (watchTool) ns.watchTool = function (server, tool, input, handler, options) {
        note("watch", server, tool, input);
        return watchTool(server, tool, input, handler, options);
      };
      if (listTools) ns.listTools = function () { note("listTools", "-", "listTools", null); return listTools(); };
      ns.__wrapped = true;
      return ns;
    });
  };
})();`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rb-"));
fs.mkdirSync(path.join(dir, "b"), { recursive: true });
execFileSync(
  "node",
  [path.join(ROOT, "app/scripts/assemble-artifact.mjs"), path.join(ROOT, "artifact/live-data.json"), path.join(dir, "b/index.html"), BUNDLE],
  { stdio: "ignore" },
);
const server = await serveDir(dir);
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));

await page.addInitScript(STUB);
await page.addInitScript(SAMPLE);
await page.addInitScript(
  (cfg) => {
    var i = setInterval(function () {
      if (window.__LANES) {
        clearInterval(i);
        window.__LANES.relayMs = cfg.relayMs;
        window.__LANES.livePatch = Object.assign({}, window.__LANES.livePatch || {}, cfg.patch);
        window.__LANES.accounts = cfg.accounts || [];
        if (cfg.lanes) Object.assign(window.__LANES, cfg.lanes);
      }
    }, 0);
  },
  { patch: BOOK.patch, accounts: BOOK.orgAccounts, relayMs: RELAY_MS, lanes: LANES },
);
await page.addInitScript(RECORDER);

const setPhase = (p) => page.evaluate((v) => { window.__REC.phase = v; }, p);

/** Wait until no new call has been issued for QUIET_MS (or the ceiling). */
async function quiet(maxMs) {
  const deadline = Date.now() + maxMs;
  let last = -1;
  let lastChange = Date.now();
  while (Date.now() < deadline) {
    const n = await page.evaluate(() => window.__REC.calls.length);
    if (n !== last) { last = n; lastChange = Date.now(); }
    else if (Date.now() - lastChange >= QUIET_MS) return;
    await page.waitForTimeout(250);
  }
}

/* ---- boot ---- */
await page.goto(server.url + "b/", { waitUntil: "commit" });
await page.waitForSelector(`[data-open="${ACCOUNT}"]`, { timeout: 30000 });
await quiet(25000);

/* ---- open ---- */
await setPhase("open");
await page.click(`[data-open="${ACCOUNT}"]`);
await page.waitForSelector("#view-account .hero", { timeout: 15000 });
await quiet(45000);

/* ---- sync ---- */
await setPhase("sync");
await page.click('button:has-text("Sync")');
await page.waitForTimeout(1500);
await quiet(90000);

await setPhase("done");
const calls = await page.evaluate(() => window.__REC.calls);
await browser.close();
await server.close();

/* ------------------------------------------------------------------ tables */

const PHASES = ["boot", "open", "sync"];

/** The deepest frames that are not the recorder itself, as one signature line. */
function sig(stack) {
  const lines = String(stack || "").split("\n").slice(1).map((l) => l.trim());
  const useful = lines.filter((l) => !/rec|__REC|window\.claude\.use/.test(l));
  return useful.slice(0, 14).join(" <- ");
}

function peakPerSecond(rows) {
  if (!rows.length) return 0;
  let peak = 0;
  for (const r of rows) {
    const n = rows.filter((o) => o.at >= r.at && o.at < r.at + 1000).length;
    if (n > peak) peak = n;
  }
  return peak;
}

/** The most calls ON THE WIRE AT ONCE, which is what a concurrency cap bounds. A cap cannot bound
 *  calls per second: four slots against a 200ms relay issue twenty a second and are still four. */
function peakConcurrent(rows) {
  const edges = [];
  for (const r of rows) {
    edges.push({ t: r.at, d: 1 });
    edges.push({ t: r.at + (r.ms ?? 0), d: -1 });
  }
  edges.sort((a, b) => a.t - b.t || a.d - b.d);
  let now = 0;
  let peak = 0;
  for (const e of edges) {
    now += e.d;
    if (now > peak) peak = now;
  }
  return peak;
}

function peakPerTen(rows) {
  if (!rows.length) return 0;
  let peak = 0;
  for (const r of rows) {
    const n = rows.filter((o) => o.at >= r.at && o.at < r.at + 10000).length;
    if (n > peak) peak = n;
  }
  return peak;
}

const report = { bundle: BUNDLE, book: BOOK_ARG, relayMs: RELAY_MS, lanes: LANES, quietMs: QUIET_MS, pageErrors: errs, phases: {} };

for (const phase of PHASES) {
  const rows = calls.filter((c) => c.phase === phase && c.kind === "call");
  const byTool = new Map();
  for (const r of rows) {
    const key = r.tool;
    if (!byTool.has(key)) byTool.set(key, []);
    byTool.get(key).push(r);
  }
  const reads = [...byTool.entries()]
    .map(([tool, rs]) => {
      const byArgs = new Map();
      for (const r of rs) {
        if (!byArgs.has(r.args)) byArgs.set(r.args, []);
        byArgs.get(r.args).push(r);
      }
      const sigs = new Map();
      for (const r of rs) {
        const s = sig(r.stack);
        sigs.set(s, (sigs.get(s) || 0) + 1);
      }
      return {
        tool,
        total: rs.length,
        distinctArgs: byArgs.size,
        maxPerIdentity: Math.max(...[...byArgs.values()].map((a) => a.length)),
        servers: [...new Set(rs.map((r) => r.server))],
        firstAt: Math.min(...rs.map((r) => r.at)),
        lastAt: Math.max(...rs.map((r) => r.at)),
        callers: [...sigs.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => ({ n, sig: s })),
      };
    })
    .sort((a, b) => b.total - a.total);

  report.phases[phase] = {
    totalCalls: rows.length,
    distinctReads: byTool.size,
    peakPerSecond: peakPerSecond(rows),
    peakConcurrent: peakConcurrent(rows),
    peakPerTenSeconds: peakPerTen(rows),
    spanMs: rows.length ? Math.max(...rows.map((r) => r.at)) - Math.min(...rows.map((r) => r.at)) : 0,
    reads,
    raw: rows.map((r) => ({ i: r.i, at: r.at, server: r.server, tool: r.tool, args: r.args, ms: r.ms, ok: r.ok, sig: sig(r.stack) })),
  };
}

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

for (const phase of PHASES) {
  const p = report.phases[phase];
  console.log(`\n== ${phase.toUpperCase()}  ${p.totalCalls} calls / ${p.distinctReads} distinct  peak ${p.peakPerSecond}/s  ${p.peakPerTenSeconds}/10s  concurrent ${p.peakConcurrent}  span ${p.spanMs}ms`);
  for (const r of p.reads) console.log(`   ${String(r.total).padStart(3)}x  ${r.tool.padEnd(34)} identities ${r.distinctArgs}  worst ${r.maxPerIdentity}  ${r.firstAt}-${r.lastAt}ms`);
}
if (errs.length) console.log("\npage errors:\n" + errs.join("\n"));
console.log(`\nwrote ${OUT}`);
