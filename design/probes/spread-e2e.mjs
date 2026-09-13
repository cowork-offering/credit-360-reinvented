/* SPREAD FINANCIALS BROWSER E2E (orchestrator gate, 2026-09-12; --book 2026-09-13).
   Loads a scratch assembly of the CURRENT bundle with the probe's stub lanes
   and stub sample door, opens the chosen relationship, opens the FAB, clicks
   "Spread financials", drops a real statement file, answers each ask with its
   first chip, confirms the plan, waits for the stub ladder to complete, then
   checks the room panel and the Financials tab for the provisional period.
   Read-only on the repo.

   THE BOOK IS AN ARGUMENT (backlog row 51). `--book <accountId|name>` opens that
   relationship and patches its own reads onto the lane, exactly as
   `workroom-e2e.mjs` does and through the same `lib/book.mjs`. The CSV is
   REWRITTEN under the chosen borrower's own name so the drop and the account
   agree; the xlsx and pdf fixtures are fixed artefacts and still carry
   Piedmont's letterhead, which is the honest shape of a banker dropping a file
   from another matter and is what the room's own period asks are for.
   Usage: node spread-e2e.mjs [bundle.html] [csv|xlsx|pdf] [--book <id|name>] */
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
const BUNDLE = process.argv[2] || path.join(ROOT, "app/dist/cockpit.html");
const KIND = process.argv[3] || "csv";
const SCRATCH = path.join(ROOT, "design/probes/fixtures");
const STUB = fs.readFileSync(path.join(ROOT, "design/probes/lib/stub-lanes.js"), "utf8");
const SAMPLE = fs.readFileSync(path.join(ROOT, "design/probes/lib/stub-sample.js"), "utf8");
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, "artifact/live-data.json"), "utf8"));
const ACCOUNT = resolveBook(LIVE, BOOK_ARG);
const BOOK = bookParams(LIVE, ACCOUNT);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spread-e2e-"));
fs.mkdirSync(path.join(dir, "b"), { recursive: true });
execFileSync("node", [path.join(ROOT, "app/scripts/assemble-artifact.mjs"), path.join(ROOT, "artifact/live-data.json"), path.join(dir, "b/index.html"), BUNDLE], { stdio: "ignore" });

const csv = [
  BOOK.relationship,
  "Income Statement (in thousands)",
  "Fiscal year ended December 31,2025,2024",
  "Net sales revenue,71200,64486",
  "Cost of sales,49840,45140",
  "Gross profit,21360,19346",
  "Operating expenses,15960,14100",
  "Operating profit,5400,5246",
  "Interest expense,1750,1989",
  "Net income,2700,2400",
  "",
  "Balance Sheet (in thousands)",
  "As of December 31,2025,2024",
  "Total assets,52000,50000",
  "Total liabilities,32000,31500",
  "Total equity,20000,18500",
].join("\n");
let csvPath = path.join(dir, "statements-fy2025.csv");
fs.writeFileSync(csvPath, csv);
if (KIND === "xlsx") csvPath = path.join(SCRATCH, "piedmont-fy2025.xlsx");
if (KIND === "pdf") csvPath = path.join(SCRATCH, "piedmont-fy2025.pdf");
console.log("BOOK:", ACCOUNT, BOOK.relationship);
console.log("DROPPING:", KIND, csvPath);

const server = await serveDir(dir);
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
await page.addInitScript(STUB);
await page.addInitScript(SAMPLE);
/* THE CHOSEN BOOK'S OWN READS BEHIND THE LANE, the same patch `workroom-e2e.mjs` applies, so the
   coverage ratio the panel and the Financials tab print is computed over THIS relationship's
   facilities rather than over the lane's single stand-in loan. */
await page.addInitScript((cfg) => {
  var i = setInterval(function () {
    if (!window.__LANES) return;
    clearInterval(i);
    window.__LANES.relayMs = 300;
    window.__LANES.boom.processingMs = 1500;
    window.__LANES.livePatch = Object.assign({}, window.__LANES.livePatch || {}, cfg.patch);
  }, 0);
}, { patch: BOOK.patch });

const t = {};
const mark = (k, t0) => { t[k] = Math.round(performance.now() - t0); };
const now = () => performance.now();

let t0 = now();
await page.goto(server.url + "b/", { waitUntil: "commit" });
await page.waitForSelector(`[data-open="${ACCOUNT}"]`, { timeout: 30000 }); mark("landing", t0);
t0 = now(); await page.click(`[data-open="${ACCOUNT}"]`); await page.waitForSelector("#view-account .hero", { timeout: 15000 }); mark("accountOpen", t0);
await page.waitForTimeout(2500);
t0 = now(); await page.click("#fab"); await page.waitForSelector("#actSpread", { state: "visible", timeout: 6000 }); mark("fabOpen", t0);
await page.waitForTimeout(500);
t0 = now(); await page.click("#actSpread"); await page.waitForSelector(".sp-body", { timeout: 6000 }); mark("roomFirstPaint", t0);
const dropVisible = await page.isVisible(".sp-drop-h").catch(() => false);
const roomText0 = await page.textContent("[aria-label='Spread financials']").catch(() => "");
t0 = now(); await page.setInputFiles("input.sp-file", csvPath);
await page.waitForSelector(".sp-cards", { timeout: 10000 }); mark("cardAppears", t0);
// answer asks with the recommended (first) chip until the plan shows
let asks = [];
for (let i = 0; i < 8; i++) {
  const plan = await page.$(".sp-go");
  if (plan) break;
  const ask = await page.waitForSelector(".sp-ask, .sp-go", { timeout: 15000 });
  if (await page.$(".sp-go")) break;
  const lead = (await page.textContent(".sp-ask-lead")) || "";
  const chips = await page.$$eval(".sp-ask .sp-chip", (ns) => ns.map((n) => n.textContent.trim()));
  asks.push({ lead, chips });
  await page.click(".sp-ask .sp-chip");
  await page.waitForTimeout(400);
}
await page.waitForSelector(".sp-go", { timeout: 15000 });
const planSummary = await page.textContent(".sp-plan-s");
const cardText = await page.textContent(".sp-cards");
t0 = now(); await page.click(".sp-go");
let ladderState = "completed";
try {
  await page.waitForFunction(() => /Completed|Failed/.test(document.querySelector(".sp-ladder")?.textContent || ""), null, { timeout: 30000 }); mark("ladderSettled", t0);
} catch (e) { ladderState = "timeout"; }
const ladderText = (await page.textContent(".sp-ladder").catch(() => "")) || "";
if (/Failed/.test(ladderText)) ladderState = "failed";
console.log("LADDER:", ladderState, JSON.stringify(ladderText.slice(0, 500)));
console.log("REFUSALS:", JSON.stringify(((await page.textContent(".sp-refusals").catch(() => "")) || "").slice(0, 300)));
console.log("ROOM:", JSON.stringify(((await page.textContent("[aria-label='Spread financials']").catch(() => "")) || "").slice(0, 1500)));
if (ladderState !== "completed") { console.log(JSON.stringify({ timings: t, asks, planSummary, cardText: cardText.slice(0, 600), pageErrors: errors }, null, 2)); await browser.close(); process.exit(2); }
await page.waitForSelector(".sp-fin", { timeout: 10000 });
await page.waitForTimeout(9000);
const finText = await page.textContent(".sp-fin");
const roomText = await page.textContent("[aria-label='Spread financials']");
const proseText = (await page.textContent(".sp-prose").catch(() => "")) || "";
// activity + Financials tab
await page.click("[aria-label='Close the spreading room']").catch(() => {});
await page.waitForTimeout(500);
const clickTab = async (lbl) => page.evaluate((l) => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === l); if (b) b.click(); return !!b; }, lbl);
const hadFin = await clickTab("Financials");
await page.waitForTimeout(800);
const finTab = (await page.textContent("#view-account").catch(() => "")) || "";
const anyBadge = await page.evaluate(() => ({ badges: document.querySelectorAll("[data-provisional-period]").length, provisionalText: (document.body.textContent || "").split("Provisional, Boom verification pending").length - 1, finTabHead: (document.querySelector("#view-account")?.textContent || "").slice(0, 700) }));
console.log("FIN_TAB_DEBUG:", JSON.stringify(anyBadge));
const badge = await page.$("[data-provisional-period]");
const badgePeriod = badge ? await badge.getAttribute("data-provisional-period") : null;
const hadAct = await clickTab("Activity");
await page.waitForTimeout(800);
const actTab = (await page.textContent("#view-account").catch(() => "")) || "";
const calls = await page.evaluate(() => (window.__LANES?.calls || []).map((c) => c.tool || c));
const boomCalls = calls.filter((c) => /boom_upload|boom_create|boom_validation/.test(String(c)));

const out = {
  timings: t, dropVisibleOnOpen: dropVisible, asks, planSummary, cardText: cardText.slice(0, 400),
  panel: { hasProvisional: /Provisional/.test(finText), saysVerified: /\bVerified\b|Validated in Boom/.test(finText), tiles: finText.slice(0, 300) },
  postRead: proseText.slice(0, 1800),
  financialsTab: { found: hadFin, badgePeriod, hasProvisional: /Provisional, Boom verification pending/.test(finTab), periods: (finTab.match(/FY20\d\d/g) || []).filter((v, i, a) => a.indexOf(v) === i) },
  activity: { found: hadAct, mentionsStub: /Boom \(stub, provisional\)/.test(actTab) },
  boomStubCalls: boomCalls.length, boomToolsSeen: [...new Set(boomCalls)],
  iris: /iris/i.test(roomText + finTab + actTab + finText), emDash: /—/.test(roomText0 + roomText + finText + proseText),
  pageErrors: errors,
};
console.log(JSON.stringify(out, null, 2));
await browser.close(); server.close?.();
