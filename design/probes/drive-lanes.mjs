/* THE LANE DRIVE: stability, measured on the assembled build.

   FOUNDER, 2026-09-05: "stable connectors, stable connections". The 2026-09-03
   relay outage is the thing to be stable against: every call the PAGE made
   answered `server_unavailable: request failed (502)` for two hours while chat
   was fine, and the cockpit showed empty modules under a banner that named
   neither the lane nor the code.

   FOUR RUNS, all against lib/stub-lanes.js in front of the real bundle:

     1  open, live       time from load to the first LIVE figure on the account,
                         and what the health line says while it happens
     2  the 502 lane     every Customer 360 call 502s. The stored last-good
                         document must still be on screen, the hero must mark it
                         "As of", and the health line must name the lane and the
                         code
     3  fail twice       two rejections per tool, then an answer. Live figures
                         must arrive with NO gesture from anyone
     4  three minutes    down, then reachable. The figures must come back inside
                         a minute of recovery, again with no gesture

   Usage:  node drive-lanes.mjs [file-or-url] [outDir]
*/
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const TARGET = process.argv[2] ?? "/tmp/c360-stable.html";
const OUT = process.argv[3] ?? "/tmp/lane-drive";
const HERE = fileURLToPath(new URL(".", import.meta.url));
const stub = readFileSync(`${HERE}lib/stub-lanes.js`, "utf8");

const URL_TARGET = /^https?:/.test(TARGET) ? TARGET : pathToFileURL(TARGET).href;
const ACCOUNT = "001bb00001DLtRMAA1";
const ARGS = ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"];

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The stored document the outage run has to find and paint. Its figures are
 *  unlike anything baked or live, so a screen read says which one is showing. */
const CACHED_EXPOSURE = {
  storedAt: Date.now() - 9 * 60 * 60 * 1000,
  tool: "Customer360Exposure",
  payload: {
    accountId: ACCOUNT,
    totalCommitted: 22200000,
    totalOutstanding: 11100000,
    totalAvailable: 11100000,
    facilities: [{ loanId: "a4Zbb0000CACHED1", name: "Revolving line of credit", status: "Active", amount: 22200000, outstanding: 11100000, collateral: [] }],
  },
};

async function openPage(browser, prepare) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(stub);
  if (prepare) await page.addInitScript(prepare);
  await page.goto(URL_TARGET, { waitUntil: "load" });
  await page.waitForSelector("#kpiband", { timeout: 20_000 });
  return page;
}

const health = (page) =>
  page.evaluate(() => {
    const el = document.querySelector(".health-line");
    if (!el) return null;
    // The dot separators are a CSS ::before, so rebuild the sentence by span.
    return [...el.querySelectorAll("span")].map((s) => s.textContent).join(" · ");
  });

const heroAsOf = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-asof]");
    return el ? el.textContent : null;
  });

const drawn = (page) =>
  page.evaluate(() => {
    const cell = document.querySelector('[data-delta="exposure.totalOutstanding"]');
    return cell ? cell.textContent.replace(/\s+/g, " ").trim() : null;
  });

const openAccount = async (page) => {
  await page.evaluate((id) => document.querySelector(`[data-open="${id}"]`)?.click(), ACCOUNT);
  await page.waitForSelector(".hero", { timeout: 10_000 });
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll("button")].find((b) => /Exposure/.test(b.textContent || ""));
    tab?.click();
  });
  await sleep(400);
};

/** Poll until the predicate holds or the budget is gone. Returns the wait. */
async function waitFor(page, fn, budgetMs, stepMs = 250) {
  const started = Date.now();
  while (Date.now() - started < budgetMs) {
    if (await fn(page)) return Date.now() - started;
    await sleep(stepMs);
  }
  return null;
}

/** The live figure and nothing else: $33.3M is the stub's, $11.1M the stored
 *  document's, $8.50M the baked bundle's. */
const showsLive = async (page) => /33\.3/.test((await drawn(page)) ?? "");
const showsCached = async (page) => /11\.1/.test((await drawn(page)) ?? "");

const results = {};

const browser = await chromium.launch({ args: ARGS });
try {
  /* ---------------------------------------------------- 1. open, reachable */
  {
    const page = await openPage(browser);
    const t0 = Date.now();
    await openAccount(page);
    const toLive = await waitFor(page, showsLive, 20_000);
    results.open = {
      msToFirstLiveFigure: toLive === null ? null : Date.now() - t0,
      drawn: await drawn(page),
      health: await health(page),
      asOf: await heroAsOf(page),
      calls: (await page.evaluate(() => window.__LANES.calls)).length,
    };
    await page.screenshot({ path: `${OUT}/1-open-live.png`, fullPage: false });
    await page.close();
  }

  /* --------------------------------------------------------- 2. the 502 lane */
  {
    const page = await openPage(browser, `
      window.addEventListener("DOMContentLoaded", function () {});
      var seedInterval = setInterval(function () {
        if (window.__LANES && window.__LANES.seed) {
          clearInterval(seedInterval);
          window.__LANES.mode = "down";
          window.__LANES.seed(${JSON.stringify(`cache/accounts/${ACCOUNT}/exposure`)}, ${JSON.stringify(CACHED_EXPOSURE)});
        }
      }, 0);
    `);
    await openAccount(page);
    // The whole retry budget, plus the paced launches behind it.
    await sleep(20_000);
    results.down = {
      drawn: await drawn(page),
      showsCachedFigures: await showsCached(page),
      health: await health(page),
      asOf: await heroAsOf(page),
      attempts: await page.evaluate(() => window.__LANES.attempts),
      errors: await page.evaluate(() => window.__DRIVE_OUT.errors),
    };
    await page.screenshot({ path: `${OUT}/2-down-cached.png`, fullPage: false });
    await page.close();
  }

  /* ------------------------------------------------------- 3. fail twice */
  {
    const page = await openPage(browser, `
      var i = setInterval(function () {
        if (window.__LANES) { clearInterval(i); window.__LANES.mode = "failTwice"; }
      }, 0);
    `);
    const t0 = Date.now();
    await openAccount(page);
    const toLive = await waitFor(page, showsLive, 30_000);
    results.failTwice = {
      msToFirstLiveFigure: toLive === null ? null : Date.now() - t0,
      drawn: await drawn(page),
      health: await health(page),
      attempts: await page.evaluate(() => window.__LANES.attempts),
    };
    await page.screenshot({ path: `${OUT}/3-fail-twice.png`, fullPage: false });
    await page.close();
  }

  /* --------------------------------------------- 4. down, then recovering */
  {
    const page = await openPage(browser, `
      var i = setInterval(function () {
        if (window.__LANES) { clearInterval(i); window.__LANES.mode = "down"; }
      }, 0);
    `);
    await openAccount(page);
    await sleep(20_000);
    const whileDown = { drawn: await drawn(page), health: await health(page) };
    const recoveredAt = Date.now();
    await page.evaluate(() => { window.__LANES.mode = "ok"; });
    // The background knock is a minute apart; allow it one, plus its calls.
    const back = await waitFor(page, showsLive, 90_000, 1000);
    results.recovery = {
      whileDown,
      msFromRecoveryToLive: back === null ? null : Date.now() - recoveredAt,
      drawn: await drawn(page),
      health: await health(page),
    };
    await page.screenshot({ path: `${OUT}/4-recovered.png`, fullPage: false });
    await page.close();
  }
} finally {
  await browser.close();
}

writeFileSync(`${OUT}/lanes.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
console.log(`\nshots + report in ${OUT}`);
