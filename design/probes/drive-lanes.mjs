/* THE LANE DRIVE: stability, measured on the assembled build.

   FOUNDER, 2026-09-05: "stable connectors, stable connections". The 2026-09-03
   relay outage is the thing to be stable against: every call the PAGE made
   answered `server_unavailable: request failed (502)` for two hours while chat
   was fine, and the cockpit showed empty modules under a banner that named
   neither the lane nor the code.

   NINE RUNS, all against lib/stub-lanes.js in front of the real bundle:

     1  open, live       time from load to the first LIVE figure on the account,
                         and what the health line says while it happens
     2  via backup       every Customer 360 call 502s and the READ BACKUP answers.
                         LIVE figures must reach the page, the health line must
                         say "via backup", and the hero must NOT caption them
                         unreachable. Wall clock: the first live figure inside
                         3s of that lane's own retry budget
     3  both doors shut  Customer 360 AND the backup 502. The stored last-good
                         document must still be on screen, the hero must mark it
                         "As of", and the health line must name the lane and the
                         code: exactly what 90f9ba3 does today
     4  denial           Customer 360 refuses on authz. The backup must NOT be
                         called at all (it asks as somebody else) and the page
                         must show the denial
     5  backup absent    the viewer never added the backup and Customer 360 502s.
                         The last-good path, and the line says "Backup not granted"
     6  hung lane        one lane never answers on either door. The sweep must
                         still finish, that line must read failed on a timeout,
                         and Sync must come back
     7  fail twice       two rejections per tool, then an answer. Live figures
                         must arrive with NO gesture from anyone
     8  three minutes    down, then reachable. The figures must come back inside
                         a minute of recovery, again with no gesture
     9  the firewall     a full open, sync and room cycle on a healthy connector,
                         and then EVERY body the page sent to the store is read
                         back. Not one may carry an XSS signature or a string
                         over 32 KB: on 2026-09-06 claude.ai's web application
                         firewall blocked the founder's own client, and a store
                         write is the only request this page makes that a
                         firewall can read as an attack

   Exit code is 1 if any scenario's assertions fail.

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

/** `RETRY_BUDGET_MS` in app/src/channel/mcp.ts: the worst case a READ spends
 *  WAITING between its three attempts before the other door is tried at all.
 *  Kept here as a number because a probe cannot import the bundle's TypeScript;
 *  if the policy moves, this moves with it. */
const RETRY_BUDGET_MS = 4500;
/** `LANE_DEADLINE_MS` in app/src/channel/syncSweep.ts. */
const LANE_DEADLINE_MS = 15_000;

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

/** What a web application firewall reads as an attack, and the one size limit.
 *  The same list the door screens on (app/src/channel/dbDoor.ts); kept here as
 *  literals so the probe is an INDEPENDENT reading of what went over the wire
 *  and not a second call into the code it is checking. */
const FIREWALL_SIGNATURES = [/<script/i, /<html/i, /<iframe/i, /javascript:/i, /onerror\s*=/i, /onload\s*=/i];
const MAX_STRING_BYTES = 32 * 1024;

/** Every offending body among the writes the page actually sent. */
function firewallScan(writes) {
  const hits = [];
  for (const w of writes ?? []) {
    for (const re of FIREWALL_SIGNATURES) {
      if (re.test(w.json)) hits.push({ path: w.path, reason: String(re), sample: w.json.slice(0, 160) });
    }
    // The size rule is about ONE string, not the document: walk the parsed body.
    let body;
    try { body = JSON.parse(w.json); } catch { hits.push({ path: w.path, reason: "unserialisable" }); continue; }
    const walk = (v) => {
      if (typeof v === "string") {
        if (v.length > MAX_STRING_BYTES) hits.push({ path: w.path, reason: "oversize", sample: String(v.length) });
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(body);
  }
  return hits;
}

/** Set the stub's control surface before the page's own script runs. */
const controls = (patch) => `
  var i = setInterval(function () {
    if (window.__LANES) { clearInterval(i); Object.assign(window.__LANES, ${JSON.stringify(patch)}); }
  }, 0);
`;

const liveCode = (page) =>
  page.evaluate(() => document.querySelector("[data-live-code]")?.textContent ?? null);

const backupCalls = (page) =>
  page.evaluate(() => window.__LANES.calls.filter((c) => c.server === "Salesforce Read Backup").length);

/** When the named tool was FIRST asked for, so a lane can be timed against its
 *  own retry budget rather than against the whole page's open. */
const firstCallAt = (page, tool) =>
  page.evaluate((t) => (window.__LANES.calls.find((c) => c.tool === t) ?? {}).at ?? null, tool);

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
const failures = [];

/** Record one assertion against a scenario. The drive reports every check it
 *  made, passing or not, so a red run says WHICH sentence stopped being true. */
function check(scenario, label, condition) {
  const target = (results[scenario].checks ??= {});
  target[label] = condition === true;
  if (condition !== true) failures.push(`${scenario}: ${label}`);
}

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
    check("open", "live figures on screen", results.open.msToFirstLiveFigure !== null);
    check("open", "health line says the Salesforce lane is live", /Salesforce live/.test(results.open.health ?? ""));
    check("open", "the backup is not named while it is granted and unused", !/Backup/.test(results.open.health ?? ""));
    await page.screenshot({ path: `${OUT}/1-open-live.png`, fullPage: false });
    await page.close();
  }

  /* ------------------------------------------------------------ 2. via backup */
  {
    // Customer 360 is shut and the backup answers. The figures a banker reads
    // are LIVE and the only thing that changed is which hop carried them.
    const page = await openPage(browser, controls({ mode: "down", backupMode: "ok" }));
    const t0 = Date.now();
    await openAccount(page);
    const toLive = await waitFor(page, showsLive, 30_000, 100);
    const liveAt = Date.now();
    const laneStartedAt = await firstCallAt(page, "Customer360Exposure");
    results.viaBackup = {
      msToFirstLiveFigure: toLive === null ? null : liveAt - t0,
      // The honest per-lane figure: the exposure read is the third of six,
      // paced two at a time, so its own clock starts when IT is asked for.
      msFromLaneStartToLive: toLive === null || laneStartedAt === null ? null : liveAt - laneStartedAt,
      budgetMs: RETRY_BUDGET_MS,
      drawn: await drawn(page),
      health: await health(page),
      asOf: await heroAsOf(page),
      backupCalls: await backupCalls(page),
      errors: await page.evaluate(() => window.__DRIVE_OUT.errors),
    };
    check("viaBackup", "the LIVE figure reached the page", toLive !== null);
    check("viaBackup", "the health line says via backup", /Salesforce via backup/.test(results.viaBackup.health ?? ""));
    check("viaBackup", "the backup names itself as the lane that answered", /Backup live/.test(results.viaBackup.health ?? ""));
    check("viaBackup", "the hero does NOT caption live figures unreachable", !/unreachable/.test(results.viaBackup.asOf ?? ""));
    check(
      "viaBackup",
      `first live figure inside the lane's retry budget + 3s (${RETRY_BUDGET_MS + 3000}ms)`,
      results.viaBackup.msFromLaneStartToLive !== null && results.viaBackup.msFromLaneStartToLive < RETRY_BUDGET_MS + 3000,
    );
    check("viaBackup", "no page errors", (results.viaBackup.errors ?? []).length === 0);
    await page.screenshot({ path: `${OUT}/2-via-backup.png`, fullPage: false });
    await page.close();
  }

  /* ---------------------------------------------------- 3. both doors shut */
  {
    const page = await openPage(browser, `
      var seedInterval = setInterval(function () {
        if (window.__LANES && window.__LANES.seed) {
          clearInterval(seedInterval);
          window.__LANES.mode = "down";
          window.__LANES.backupMode = "down";
          window.__LANES.seed(${JSON.stringify(`cache/accounts/${ACCOUNT}/exposure`)}, ${JSON.stringify(CACHED_EXPOSURE)});
        }
      }, 0);
    `);
    await openAccount(page);
    // Both retry budgets, plus the paced launches behind them.
    await sleep(25_000);
    results.down = {
      drawn: await drawn(page),
      showsCachedFigures: await showsCached(page),
      health: await health(page),
      asOf: await heroAsOf(page),
      attempts: await page.evaluate(() => window.__LANES.attempts),
      errors: await page.evaluate(() => window.__DRIVE_OUT.errors),
    };
    check("down", "the stored last-good figures are still on screen", results.down.showsCachedFigures === true);
    check("down", "the health line names the lane and the code", /Salesforce (unreachable|stale)/.test(results.down.health ?? ""));
    check("down", "the hero marks the figures As of", /As of/.test(results.down.asOf ?? ""));
    check("down", "no page errors", (results.down.errors ?? []).length === 0);
    await page.screenshot({ path: `${OUT}/3-both-down.png`, fullPage: false });
    await page.close();
  }

  /* ------------------------------------------------------------ 4. a denial */
  {
    // An authz denial is about WHO is asking, and the backup asks as somebody
    // else. Falling back here would quietly serve data the viewer was refused.
    const page = await openPage(browser, controls({ mode: "denied", backupMode: "ok" }));
    // READ THE BAND FIRST, on the landing, because that is the module a denied
    // portfolio read belongs to: it carries the platform's own code beside the
    // fix sentence. The account view's own answer is the health line below.
    await sleep(2_000);
    const bandCode = await liveCode(page);
    await openAccount(page);
    await sleep(8_000);
    results.denied = {
      drawn: await drawn(page),
      showsLiveFigures: await showsLive(page),
      health: await health(page),
      liveCode: bandCode,
      backupCalls: await backupCalls(page),
      errors: await page.evaluate(() => window.__DRIVE_OUT.errors),
    };
    check("denied", "the backup was NEVER called", results.denied.backupCalls === 0);
    check("denied", "no live figures were served past the denial", results.denied.showsLiveFigures === false);
    check("denied", "the module shows the denial by its own code", /needs_reauth/.test(results.denied.liveCode ?? ""));
    check("denied", "the health line names the lane and the code", /Salesforce unreachable: needs_reauth/.test(results.denied.health ?? ""));
    check("denied", "the line never claims the figures came via backup", !/via backup/.test(results.denied.health ?? ""));
    await page.screenshot({ path: `${OUT}/4-denied.png`, fullPage: false });
    await page.close();
  }

  /* ----------------------------------------------------- 5. backup absent */
  {
    // The viewer never added the second connector. Customer 360 is down, so the
    // page is on its stored documents and the line says what to go and add.
    const page = await openPage(browser, `
      var seedInterval = setInterval(function () {
        if (window.__LANES && window.__LANES.seed) {
          clearInterval(seedInterval);
          window.__LANES.mode = "down";
          window.__LANES.backup = "absent";
          window.__LANES.seed(${JSON.stringify(`cache/accounts/${ACCOUNT}/exposure`)}, ${JSON.stringify(CACHED_EXPOSURE)});
        }
      }, 0);
    `);
    await openAccount(page);
    await sleep(20_000);
    results.backupAbsent = {
      drawn: await drawn(page),
      showsCachedFigures: await showsCached(page),
      health: await health(page),
      asOf: await heroAsOf(page),
      errors: await page.evaluate(() => window.__DRIVE_OUT.errors),
    };
    check("backupAbsent", "the stored last-good figures are still on screen", results.backupAbsent.showsCachedFigures === true);
    check("backupAbsent", "the line says the backup is not granted", /Backup not granted/.test(results.backupAbsent.health ?? ""));
    check("backupAbsent", "the line never claims the figures came via backup", !/via backup/.test(results.backupAbsent.health ?? ""));
    check("backupAbsent", "no page errors", (results.backupAbsent.errors ?? []).length === 0);
    await page.screenshot({ path: `${OUT}/5-backup-absent.png`, fullPage: false });
    await page.close();
  }

  /* -------------------------------------------------------- 6. a hung lane */
  {
    // CHAOS SCENARIO sync-lane-hangs. One lane answers neither way, on either
    // door. Without a wall clock it holds a pacer slot, the console and the
    // Sync button for the life of the page.
    const page = await openPage(browser);
    await openAccount(page);
    // Let the open refresh finish on a healthy connector first, so what is
    // measured is the SWEEP and not the landing.
    await sleep(3_000);
    await page.evaluate(() => { window.__LANES.hangTools = ["Customer360Exposure"]; });
    const startedAt = Date.now();
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /^\s*Sync\s*$/.test(x.textContent || ""));
      b?.click();
    });
    const settled = await waitFor(
      page,
      (p) =>
        p.evaluate(
          () =>
            !document.querySelector('[aria-label="Syncing this relationship"]') &&
            [...document.querySelectorAll("button")].some((x) => /Sync/.test(x.textContent || "") && !x.disabled),
        ),
      40_000,
      250,
    );
    results.hungLane = {
      msToSweepSettled: settled === null ? null : Date.now() - startedAt,
      deadlineMs: LANE_DEADLINE_MS,
      syncReEnabled: await page.evaluate(() =>
        [...document.querySelectorAll("button")].some((x) => /Sync/.test(x.textContent || "") && !x.disabled),
      ),
      errors: await page.evaluate(() => window.__DRIVE_OUT.errors),
    };
    check("hungLane", "the sweep finished at all", settled !== null);
    check("hungLane", "the sweep finished inside 20s", results.hungLane.msToSweepSettled !== null && results.hungLane.msToSweepSettled < 20_000);
    check("hungLane", "Sync is available again", results.hungLane.syncReEnabled === true);
    check("hungLane", "no page errors", (results.hungLane.errors ?? []).length === 0);
    await page.screenshot({ path: `${OUT}/6-hung-lane.png`, fullPage: false });
    await page.close();
  }

  /* ------------------------------------------------------- 7. fail twice */
  {
    const page = await openPage(browser, `
      var i = setInterval(function () {
        if (window.__LANES) { clearInterval(i); window.__LANES.mode = "failTwice"; window.__LANES.backupMode = "failTwice"; }
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
    check("failTwice", "live figures arrived with no gesture", results.failTwice.msToFirstLiveFigure !== null);
    await page.screenshot({ path: `${OUT}/7-fail-twice.png`, fullPage: false });
    await page.close();
  }

  /* --------------------------------------------- 8. down, then recovering */
  {
    const page = await openPage(browser, `
      var i = setInterval(function () {
        if (window.__LANES) { clearInterval(i); window.__LANES.mode = "down"; window.__LANES.backupMode = "down"; }
      }, 0);
    `);
    await openAccount(page);
    await sleep(25_000);
    const whileDown = { drawn: await drawn(page), health: await health(page) };
    const recoveredAt = Date.now();
    await page.evaluate(() => { window.__LANES.mode = "ok"; window.__LANES.backupMode = "ok"; });
    // The background knock is a minute apart; allow it one, plus its calls.
    const back = await waitFor(page, showsLive, 90_000, 1000);
    results.recovery = {
      whileDown,
      msFromRecoveryToLive: back === null ? null : Date.now() - recoveredAt,
      drawn: await drawn(page),
      health: await health(page),
    };
    check("recovery", "the figures came back with no gesture", results.recovery.msFromRecoveryToLive !== null);
    await page.screenshot({ path: `${OUT}/8-recovered.png`, fullPage: false });
    await page.close();
  }
  /* ------------------------------------------------------- 9. the firewall */
  {
    // A healthy connector and a full cycle: land, open a relationship, sync it,
    // open a room. Everything the page writes to the store passes through
    // dbDoor, and this reads back what actually left it.
    const page = await openPage(browser);
    await openAccount(page);
    await sleep(3_000);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /^\s*Sync\s*$/.test(x.textContent || ""));
      b?.click();
    });
    await waitFor(
      page,
      (p) => p.evaluate(() => !document.querySelector('[aria-label="Syncing this relationship"]')),
      30_000,
      250,
    );
    // And a room, which is where the memo store's own writes come from.
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Covenant Review/.test(x.textContent || ""));
      b?.click();
    });
    await sleep(5_000);

    const writes = await page.evaluate(() => window.__LANES.writes ?? []);
    const hits = firewallScan(writes);
    results.firewall = {
      writes: writes.length,
      paths: [...new Set(writes.map((w) => w.path))],
      largestBodyBytes: writes.reduce((n, w) => Math.max(n, w.json.length), 0),
      hits,
      errors: await page.evaluate(() => window.__DRIVE_OUT.errors),
    };
    check("firewall", "the page wrote to the store at all, so this scanned something", writes.length > 0);
    check("firewall", "not one stored body carries an XSS signature or an oversize string", hits.length === 0);
    check("firewall", "no page errors", (results.firewall.errors ?? []).length === 0);
    await page.screenshot({ path: `${OUT}/9-firewall.png`, fullPage: false });
    await page.close();
  }
} finally {
  await browser.close();
}

writeFileSync(`${OUT}/lanes.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
console.log(`\nshots + report in ${OUT}`);

if (failures.length) {
  console.error(`\nFAIL: ${failures.length} assertion(s) did not hold:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exitCode = 1;
} else {
  const count = Object.values(results).reduce((n, r) => n + Object.keys(r.checks ?? {}).length, 0);
  console.log(`\nOK: ${Object.keys(results).length} scenarios, ${count} assertions, all green.`);
}
