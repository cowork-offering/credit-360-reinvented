#!/usr/bin/env node
/* Credit 360 — Electric Glass acceptance probe harness.
 *
 * Runs the HANDOVER §3 acceptance numbers against ANY served URL and emits a
 * machine-comparable JSON report. The dummy is ground truth; the port is gated
 * on reproducing these numbers (see compare.mjs).
 *
 *   node probe.mjs --serve ../dummy --runs 3 --out reference/dummy-baseline.json
 *   node probe.mjs --target port --url http://localhost:5173 --out /tmp/port.json
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { serveDir } from "./lib/serve.mjs";
import { mergeRuns } from "./lib/merge.mjs";
import { coldStart, safe, VIEWPORT } from "./lib/helpers.mjs";

import * as header from "./probes/header.mjs";
import * as fab from "./probes/fab.mjs";
import * as continuity from "./probes/continuity.mjs";
import * as client from "./probes/client.mjs";
import * as workroom from "./probes/workroom.mjs";
import * as cmdk from "./probes/cmdk.mjs";
import * as weave from "./probes/weave.mjs";
import * as glass from "./probes/glass.mjs";
import * as chat from "./probes/chat.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function args(argv) {
  const o = { target: "dummy", runs: 3, headed: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--headed") o.headed = true;
    // A STAND-IN CONNECTOR, for the port only. The room's execute-side
    // choreography lives on the far side of a successful write, and the app
    // itself will never invent one — so the harness supplies an org-shaped
    // window.claude.mcp from OUTSIDE the app. Off by default; the dummy run
    // never sees it.
    else if (a === "--stub-connector") o.stubConnector = true;
    else if (a.startsWith("--")) o[a.slice(2)] = argv[++i];
  }
  o.runs = Number(o.runs) || 1;
  return o;
}

/** One full pass over every surface. Order matters: the suite walks the app the
 *  way a banker does, so each probe inherits the state the previous one left. */
async function runOnce(page, T, url) {
  const r = {};

  // ---- landing -------------------------------------------------------------
  await coldStart(page, url);
  r.weave = await safe("weave", () => weave.weave(page, T));
  r.header = { landing: await safe("header.landing", () => header.landing(page, T)) };
  r.fab = { position: await safe("fab.position", () => fab.position(page, T)) };
  r.glass = { landing: await safe("glass.landing", () => glass.census(page, T, "landing")) };
  r.fab.whisper = await safe("fab.whisper", () => fab.whisper(page, T));

  // ---- continuity: the name flight carries us to the client ----------------
  r.continuity = { nameFlight: await safe("continuity.nameFlight", () => continuity.nameFlight(page, T, T.sel.rowHartwell)) };

  // ---- header / nav on a client -------------------------------------------
  r.header.client = await safe("header.client", () => header.client(page, T));
  r.header.paneSettle = await safe("header.paneSettle", () => header.paneSettle(page, T));
  r.header.scrollShadow = await safe("header.scrollShadow", () => header.scrollShadow(page, T));

  // ---- FAB arc -------------------------------------------------------------
  r.fab.arc = await safe("fab.arc", () => fab.arc(page, T));
  r.glass.client = await safe("glass.client", () => glass.census(page, T, "client"));
  r.glass.hairlines = await safe("glass.hairlines", () => glass.hairlines(page, T));

  // ---- chat: the FAB yields, the panel takes its spot, the pill holds it ----
  r.chat = await safe("chat", () => chat.chat(page, T));

  // ---- cmdk ----------------------------------------------------------------
  r.cmdk = { lens: await safe("cmdk.lens", () => cmdk.lens(page, T)) };
  r.glass.cmdk = await safe("glass.cmdk", () => censusWithCmdkOpen(page, T));
  r.cmdk.enterFires = await safe("cmdk.enterFires", () => cmdk.enterFires(page, T));

  // ---- the book: every row opens ITS client -------------------------------
  r.client = { perClient: await safe("client.clients", () => client.clients(page, T)) };
  r.client.graphPane = await safe("client.graphPane", () => client.graphPane(page, T));
  r.client.workroomGate = await safe("client.workroomGate", () => client.workroomGate(page, T));
  r.client.emptyStateWatermark = await safe("chat.emptyStateWatermark", () => chat.emptyStateWatermark(page, T));

  // ---- the workroom ritual (Hartwell only) ---------------------------------
  await page.evaluate(async (S) => {
    const P = window.__P;
    const back = P.el(S.goHome);
    if (back) back.click();
    await P.sleep(700);
    P.el(S.rowHartwell).click();
    await P.sleep(1000);
  }, T.sel);
  r.workroom = { open: await safe("workroom.openRoom", () => workroom.openRoom(page, T)) };
  r.glass.workroom = await safe("glass.workroom", () => glass.census(page, T, "workroom"));
  r.workroom.ritual = await safe("workroom.ritual", () => workroom.ritual(page, T));
  r.workroom.execute = await safe("workroom.execute", () => workroom.execute(page, T));
  r.workroom.numerals = await safe("workroom.numerals", () => workroom.numerals(page, T));
  r.workroom.closeAndWash = await safe("workroom.closeAndWash", () => workroom.closeAndWash(page, T));

  // ---- §4 trap 2 (leaves the client view, so it goes last) -----------------
  r.continuity.entrySuppression = await safe("continuity.entrySuppression", () => continuity.entrySuppression(page, T));

  r.traps = trapSummary(r);
  return r;
}

async function censusWithCmdkOpen(page, T) {
  await page.evaluate(async (S) => {
    window.__P.el(S.cmdkOpenButton).click();
    await window.__P.sleep(600);
  }, T.sel);
  const out = await glass.census(page, T, "cmdk-open");
  await page.evaluate(async (S) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await window.__P.sleep(600);
  }, T.sel);
  return out;
}

/* HANDOVER §4 — the three traps a port can silently reintroduce. */
function trapSummary(r) {
  const g = (o, k) => (o && typeof o === "object" ? o[k] : undefined);
  return {
    trap1_transitionDelayPoison_clickedTabDelayMs: g(r.header?.client, "clickedTabTransitionDelayMs"),
    trap1_pass: g(r.header?.client, "clickedTabTransitionDelayMs") === 0 &&
      g(r.header?.client, "tabTransitionDelaysAllZero") === true,
    trap2_entryAnimationRestart_suppressOutranksShow: g(r.continuity?.entrySuppression, "suppressOutranksShow"),
    trap2_pass: g(r.continuity?.entrySuppression, "suppressOutranksShow") === true &&
      g(r.continuity?.entrySuppression, "viewHiddenWhenSuppressCleared") === true &&
      g(r.continuity?.entrySuppression, "noEntryAnimationLeftRunning") === true,
    trap3_rotatingBoxHalo_boxTransformStatic: g(r.workroom?.execute, "haloBoxTransformIsStatic"),
    trap3_pass: g(r.workroom?.execute, "haloBoxTransformIsStatic") === true &&
      g(r.workroom?.execute, "haloAngleAnimates") === true,
    trap4_sharedElementMorph_noOpacityDip: g(r.continuity?.nameFlight, "handoffNoOpacityDip"),
    trap4_pass: g(r.continuity?.nameFlight, "handoffNoOpacityDip") === true,
    glassCensus_pass: ["landing", "client", "cmdk", "workroom"]
      .every((s) => g(r.glass?.[s], "glassRimViolationCount") === 0)
  };
}

async function main() {
  const o = args(process.argv);
  const targetFile = o.targets || path.join(HERE, `targets.${o.target}.json`);
  const T = JSON.parse(fs.readFileSync(targetFile, "utf8"));

  let server = null;
  let url = o.url;
  if (!url) {
    const dir = o.serve || path.join(HERE, "..", "dummy");
    server = await serveDir(dir);
    url = server.url;
    console.log(`[probe] serving ${path.resolve(dir)} at ${url}`);
  }

  const viewport = T.viewport || VIEWPORT;
  const browser = await chromium.launch({ headless: !o.headed });
  const browserVersion = browser.version();
  const runs = [];
  try {
    for (let i = 0; i < o.runs; i++) {
      const ctx = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        reducedMotion: "no-preference",
        colorScheme: "light"
      });
      await ctx.addInitScript({ path: path.join(HERE, "lib", "inject.js") });
      if (o.stubConnector) await ctx.addInitScript({ path: path.join(HERE, "lib", "stub-connector.js") });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message || e)));
      const t0 = Date.now();
      const r = await runOnce(page, T, url);
      r.pageErrors = errors;
      runs.push(r);
      console.log(`[probe] run ${i + 1}/${o.runs} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    if (server) await server.close();
  }

  const merged = mergeRuns(runs);
  const report = {
    meta: {
      suite: "customer-360-electric-glass-acceptance-probes",
      suiteVersion: 1,
      target: T.target,
      url: o.url || "(local static server)",
      viewport,
      runs: o.runs,
      generatedAt: new Date().toISOString(),
      chromium: browserVersion,
      sourceDigest: digestOf(o)
    },
    ...merged
  };

  const out = o.out || path.join(HERE, "reference", `${T.target}-baseline.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log(`[probe] wrote ${out}`);
  printSummary(report);
}

function digestOf(o) {
  if (o.url) return null;
  const f = path.join(o.serve || path.join(HERE, "..", "dummy"), "index.html");
  if (!fs.existsSync(f)) return null;
  return "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16);
}

function printSummary(r) {
  const t = r.traps || {};
  console.log("\n--- traps -------------------------------------------------");
  for (const k of Object.keys(t).filter((k) => k.endsWith("_pass"))) {
    console.log(`  ${t[k] ? "PASS" : "FAIL"}  ${k.replace(/_pass$/, "")}`);
  }
  console.log("--- key numbers -------------------------------------------");
  const rows = [
    ["nav capsule centre delta", r.header?.client?.capsuleCenterDeltaPx, "px"],
    ["nav capsule height", r.header?.client?.capsuleHeightPx, "px"],
    ["top bar height", r.header?.client?.barHeightPx, "px"],
    ["clicked tab transition-delay", r.header?.client?.clickedTabTransitionDelayMs, "ms"],
    ["FAB right / bottom", `${r.fab?.position?.fabRightPx} / ${r.fab?.position?.fabBottomPx}`, "px"],
    ["arc radius", r.fab?.arc?.arcRadiusPx, "px"],
    ["arc neighbour spacing", r.fab?.arc?.arcNeighbourSpacingMeanPx, "px"],
    ["mark rotation open", r.fab?.arc?.markRotationOpenDeg, "deg"],
    ["narrator chip centre delta", r.fab?.arc?.narratorChipCenterDeltaPx, "px"],
    ["name flight font", `${r.continuity?.nameFlight?.ghostStartFontPx} -> ${r.continuity?.nameFlight?.ghostEndFontPx}`, "px"],
    ["name flight duration", r.continuity?.nameFlight?.ghostTransitionMs, "ms"],
    ["landing offset x/y", `${r.continuity?.nameFlight?.landingOffsetXPx} / ${r.continuity?.nameFlight?.landingOffsetYPx}`, "px"],
    ["workroom seed", `${r.workroom?.open?.seedWidthPx}`, "px"],
    ["thread gap / step gap", `${r.workroom?.open?.threadGapPx} / ${r.workroom?.ritual?.stepGapPx}`, "px"],
    ["identity chip offset", r.workroom?.ritual?.identityChipOffsetPx, "px"],
    ["agent word stagger", r.workroom?.ritual?.agentWordStaggerMs, "ms"],
    ["write-back odo columns", r.workroom?.execute?.writeBackOdoColumnCount, "cols"],
    ["pane settle travel", r.header?.paneSettle?.paneSettleTravelPx, "px"],
    ["lens blur / saturate / scale", `${r.cmdk?.lens?.lensTopbarBlurPx} / ${r.cmdk?.lens?.lensTopbarSaturate} / ${r.cmdk?.lens?.lensTopbarScale}`, ""],
    ["backdrop dim", r.cmdk?.lens?.backdropDimColor, ""],
    ["chat: FAB opacity / scale", `${r.chat?.fabOpacityOnChatPct}% / ${r.chat?.fabScaleOnChat}`, ""],
    ["weave nodes", r.weave?.weaveNodeCount, ""],
    ["glass surfaces / rim violations", `${r.glass?.client?.glassSurfaceCount} / ${r.glass?.client?.glassRimViolationCount}`, ""]
  ];
  for (const [k, v, u] of rows) console.log(`  ${k.padEnd(34)} ${String(v)}${u ? " " + u : ""}`);
  console.log("-----------------------------------------------------------\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
