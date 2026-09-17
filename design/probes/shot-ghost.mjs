/* THE FOUR BEATS OF THE SPREADING ROOM (0.9.32), OFF THE BUILT BUNDLE.

   Ghost, confirm, reading, arrival, plus the failed file and the balance sheet
   the banker switches to. Shot against the assembled artifact so what is looked
   at is the thing that ships, not a dev server.

   Usage: node shot-ghost.mjs [outDir]
*/
import puppeteer from "/opt/connectry/projects/uk-companies-house/repo/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = `${HERE}../..`;
const OUT = process.argv[2] ?? `${ROOT}/knowledge/proofs/0932-build`;
const CHROME = "/home/fabian/.cache/puppeteer/chrome/linux-151.0.7922.47/chrome-linux64/chrome";
const SCRATCH = "/dev/shm/shot-ghost";
const ACCOUNT = "001bb00001DLtRMAA1";
const COMPANY = "Piedmont Precision Components, Inc.";

mkdirSync(OUT, { recursive: true });
mkdirSync(SCRATCH, { recursive: true });

const CSV = `${SCRATCH}/statements-fy2025.csv`;
writeFileSync(
  CSV,
  [
    COMPANY,
    "Income Statement (in thousands)",
    "Fiscal year ended December 31,2025,2024,2023",
    "Net Sales,64486,59915,56266",
    "Cost of Sales,50422,45371,40829",
    "Gross Profit,14064,14544,15437",
    '"Selling, General and Administrative",8830,8800,8743',
    "Depreciation and Amortization,2396,2189,2009",
    "Income from Operations,2838,3555,4685",
    "Interest Expense,(1076),(1019),(947)",
    '"Other Income (Expense), Net",55,(45),71',
    "Income before Income Taxes,1817,2491,3809",
    "Provision for Income Taxes,427,623,936",
    "Net Income,1390,1868,2873",
    "",
    "Balance Sheet (in thousands)",
    "As of December 31,2025,2024,2023",
    "Total assets,46761,40117,36062",
    "Total liabilities,27891,22343,20396",
    "Total equity,18870,17774,15666",
  ].join("\n"),
);

execFileSync("node", [`${ROOT}/app/scripts/assemble-artifact.mjs`, `${ROOT}/artifact/live-data.json`, `${SCRATCH}/index.html`, `${ROOT}/app/dist/cockpit.html`], { stdio: "ignore" });
const page_html = readFileSync(`${SCRATCH}/index.html`);
const server = createServer((_, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page_html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const stub = readFileSync(`${HERE}lib/stub-lanes.js`, "utf8");
const sample = readFileSync(`${HERE}lib/stub-sample.js`, "utf8");

const browser = await puppeteer.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--force-color-profile=srgb"],
  defaultViewport: { width: 1600, height: 1200, deviceScaleFactor: 2 },
});

const shots = [];
async function shoot(page, name) {
  const at = `${OUT}/${name}.png`;
  await page.screenshot({ path: at });
  shots.push(at);
  console.log("shot", at);
}

/** Open the room on a fresh page, with Boom slow enough to watch. */
async function room(processingMs, failed) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(stub);
  await page.evaluateOnNewDocument(sample);
  await page.evaluateOnNewDocument(
    (ms, fail) => {
      const t = setInterval(() => {
        if (!window.__LANES) return;
        clearInterval(t);
        window.__LANES.boom.processingMs = ms;
        if (fail) window.__LANES.boom.mode = "failed";
      }, 0);
    },
    processingMs,
    Boolean(failed),
  );
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector(`[data-open="${ACCOUNT}"]`, { timeout: 30000 });
  await page.click(`[data-open="${ACCOUNT}"]`);
  await page.waitForSelector("#view-account .hero", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 2500));
  await page.click("#fab");
  await page.waitForSelector("#actSpread", { visible: true, timeout: 8000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => document.querySelector("#actSpread").click());
  await page.waitForSelector(".sp-body", { timeout: 15000 });
  const input = await page.$("input.sp-file");
  await input.uploadFile(CSV);
  await page.waitForSelector(".sp-cards", { timeout: 15000 });
  return page;
}

/** Answer whatever the room asks, until the plan stands. */
async function toPlan(page) {
  for (let i = 0; i < 8; i += 1) {
    if (await page.$(".sp-go")) return;
    await page.waitForSelector(".sp-ask, .sp-go", { timeout: 20000 });
    if (await page.$(".sp-go")) return;
    await page.evaluate(() => document.querySelector(".sp-ask .sp-chip").click());
    await new Promise((r) => setTimeout(r, 400));
  }
}

try {
  /* 1 + 2: the ghost types in, then the confirm beat. */
  {
    const page = await room(5000);
    await page.waitForSelector(".rg-t tbody tr", { timeout: 25000 });
    await new Promise((r) => setTimeout(r, 2000));
    await shoot(page, "1-ghost");
    await toPlan(page);
    await new Promise((r) => setTimeout(r, 1500));
    await shoot(page, "2-confirm");

    /* 3: the reading beat, with the rail and the ghost standing under it. */
    await page.evaluate(() => document.querySelector(".sp-go").click());
    await page.waitForSelector(".sp-rail", { timeout: 25000 });
    await new Promise((r) => setTimeout(r, 2500));
    await shoot(page, "3-reading");

    /* 4: the arrival, once the fold has settled and the brief has typed. */
    await page.waitForSelector(".rg-recon", { timeout: 60000 });
    await page.waitForFunction(
      () => /You pinned|both off the lines|The spread carries/.test(document.querySelector(".sp-arrive")?.textContent || ""),
      { timeout: 40000 },
    );
    await new Promise((r) => setTimeout(r, 2500));
    await shoot(page, "4-arrival");

    /* 5: the statement the banker switches to, which Boom did not read. */
    await page.select(".rg-sel", "1");
    await new Promise((r) => setTimeout(r, 800));
    await shoot(page, "5-not-read");
    await page.close();
  }

  /* 6: a file Boom could not read at all. */
  {
    const page = await room(3000, true);
    await toPlan(page);
    await page.evaluate(() => document.querySelector(".sp-go").click());
    await page.waitForFunction(() => /Failed/.test(document.querySelector(".sp-ladder")?.textContent || ""), {
      timeout: 60000,
    });
    await new Promise((r) => setTimeout(r, 3000));
    await shoot(page, "6-failed");
    await page.close();
  }

  /* 7: reduced motion reaches the same facts. */
  {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.evaluateOnNewDocument(stub);
    await page.evaluateOnNewDocument(sample);
    await page.evaluateOnNewDocument(() => {
      const t = setInterval(() => {
        if (!window.__LANES) return;
        clearInterval(t);
        window.__LANES.boom.processingMs = 1200;
      }, 0);
    });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForSelector(`[data-open="${ACCOUNT}"]`, { timeout: 30000 });
    await page.click(`[data-open="${ACCOUNT}"]`);
    await page.waitForSelector("#view-account .hero", { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.click("#fab");
    await page.waitForSelector("#actSpread", { visible: true, timeout: 8000 });
    await new Promise((r) => setTimeout(r, 600));
    await page.evaluate(() => document.querySelector("#actSpread").click());
    await page.waitForSelector(".sp-body", { timeout: 15000 });
    await (await page.$("input.sp-file")).uploadFile(CSV);
    await page.waitForSelector(".sp-cards", { timeout: 15000 });
    await toPlan(page);
    await page.evaluate(() => document.querySelector(".sp-go").click());
    await page.waitForSelector(".rg-recon", { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2000));
    await shoot(page, "7-arrival-reduced-motion");
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${shots.length} shots in ${OUT}`);
