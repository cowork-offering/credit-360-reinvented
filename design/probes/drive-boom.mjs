/* THE BOOM UPLOAD LANE: the ladder, measured against the stub connector.

   There is no Boom connector yet. The cockpit's adapter
   (app/src/channel/boomUpload.ts) is written against four tool names and four
   argument shapes we EXPECT Noland's read + write Boom MCP server to publish,
   and the only way to exercise that contract before the server exists is to put
   a connector in front of the page that answers it. That connector is the boom
   block in lib/stub-lanes.js, the same stand-in every other lane drive uses;
   this file drives it.

   FOUR RUNS, all through the page's own connector door:

     1  the ladder      upload answers `processing` at once, status holds that
                        rung for the whole processing window, and then answers
                        `completed` with Boom-shaped `financialStatements`
                        carrying the file's own figures
     2  idempotent      the same sha256 sent twice is ONE file: the same file
                        id, the same clock (the re-drop does not put it back at
                        the start) and one set of periods, never two
     3  failed          a file Boom cannot read ends `failed` with the server's
                        own message, verbatim, and no statements
     4  never verified  nothing in the run returns `verified`, a validated
                        statement or a validation URL: verification is an
                        analyst's act inside Boom and no stub may claim one

   THE ARGUMENT NAMES ARE THE ASSERTION. Every call below carries the exact body
   `uploadArgs` / `statusArgs` in boomUpload.ts build, so when the real tool
   names land, running this against them is the check that the mapping is
   complete.

   Exit code is 1 if any assertion fails.

   Usage:  node drive-boom.mjs [file-or-url] [outDir]
*/
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TARGET = process.argv[2] ?? `${HERE}../../artifact/customer-360-template.html`;
const OUT = process.argv[3] ?? "/tmp/boom-drive";
const stub = readFileSync(`${HERE}lib/stub-lanes.js`, "utf8");

const URL_TARGET = /^https?:/.test(TARGET) ? TARGET : pathToFileURL(TARGET).href;
const ARGS = ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"];

/** Short, so the drive is a drive and not a wait. The room's own stub sits at
 *  4-8s (`SPREAD_STUB_PROCESSING_MS`); what is checked here is that the rungs
 *  come in the right order and hold, not how long Boom takes. */
const PROCESSING_MS = 900;

/** The connector the page addresses Boom at. `SERVERS.boom` in the cockpit,
 *  which is the gateway's own display name until Boom has a connector. */
const BOOM_SERVER = "IDB Gateway";

const ACCOUNT = "001bb00001DLtRMAA1";
const SHA = "a3f1".repeat(16);
const OTHER_SHA = "b7c2".repeat(16);

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = {};
const failures = [];

/** Record one assertion against a scenario, passing or not, so a red run says
 *  WHICH sentence stopped being true. */
function check(scenario, label, condition) {
  const target = (results[scenario].checks ??= {});
  target[label] = condition === true;
  if (condition !== true) failures.push(`${scenario}: ${label}`);
}

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(stub);
  await page.goto(URL_TARGET, { waitUntil: "load" });
  await page.evaluate((ms) => {
    window.__LANES.boom.processingMs = ms;
  }, PROCESSING_MS);
  return page;
}

/* THE TWO CALLS THE COCKPIT'S ADAPTER MAKES, argument for argument. */

const upload = (page, sha, fileGroupId) =>
  page.evaluate(
    async ({ server, account, sha, fileGroupId }) => {
      const mcp = await window.claude.use("mcp");
      const res = await mcp.callTool(server, "boom_upload_statement", {
        company: { externalUniqueId: account, name: "Piedmont Precision Components, Inc." },
        file: { name: "Piedmont_FY2025.xlsx", mime: "application/vnd.ms-excel", base64: "UEsDBA==", sha256: sha },
        externalUniqueId: sha,
        statementQuality: "cpa_audited",
        ...(fileGroupId ? { fileGroupId } : {}),
      });
      return res.payload;
    },
    { server: BOOM_SERVER, account: ACCOUNT, sha, fileGroupId: fileGroupId ?? null },
  );

const status = (page, fileId) =>
  page.evaluate(
    async ({ server, fileId }) => {
      const mcp = await window.claude.use("mcp");
      const res = await mcp.callTool(server, "boom_upload_status", { fileId });
      return res.payload;
    },
    { server: BOOM_SERVER, fileId },
  );

const filesTaken = (page) => page.evaluate(() => Object.keys(window.__LANES.boom.files).length);

const browser = await chromium.launch({ args: ARGS });
try {
  /* ------------------------------------------------------------- 1. ladder */
  {
    const page = await openPage(browser);
    const t0 = Date.now();
    const sent = await upload(page, SHA);
    const early = await status(page, sent.fileId);
    await sleep(PROCESSING_MS + 200);
    const done = await status(page, sent.fileId);
    const statement = (done.financialStatements ?? [])[0];
    results.ladder = { sent, early, done, msToCompleted: Date.now() - t0 };
    check("ladder", "upload answers at once, on the processing rung", sent.status === "processing");
    check("ladder", "upload carries a Boom file id", /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(sent.fileId ?? ""));
    check("ladder", "upload carries no spread yet", sent.financialStatements === undefined);
    check("ladder", "the file holds that rung while Boom is spreading", early.status === "processing");
    check("ladder", "and then completes", done.status === "completed");
    check("ladder", "with one Boom-shaped statement", (done.financialStatements ?? []).length === 1);
    check("ladder", "on three periods", (statement?.periods ?? []).length === 3);
    check("ladder", "carrying the file's own figures on Boom's period ids", statement?.lineItems?.[0]?.periodValues?.p2025 === 64486000);
    check(
      "ladder",
      "and the account-code roll-up the ratios read from",
      (statement?.aggregatedFinancials ?? []).some((r) => r.accountCode === "net_sales_revenue"),
    );
    await page.close();
  }

  /* -------------------------------------------------------- 2. idempotent */
  {
    const page = await openPage(browser);
    const first = await upload(page, SHA);
    const again = await upload(page, SHA);
    const different = await upload(page, OTHER_SHA);
    const taken = await filesTaken(page);
    await sleep(PROCESSING_MS + 200);
    const done = await status(page, first.fileId);
    results.idempotent = { first, again, different, taken, done };
    check("idempotent", "the same sha256 is the same Boom file", first.fileId === again.fileId);
    check("idempotent", "a different file is a different Boom file", different.fileId !== first.fileId);
    check("idempotent", "two files were taken, not three", taken === 2);
    check("idempotent", "the re-drop did not restart the clock", done.status === "completed");
    check("idempotent", "and produced ONE set of periods", (done.financialStatements?.[0]?.periods ?? []).length === 3);
    await page.close();
  }

  /* ------------------------------------------------------------ 3. failed */
  {
    const page = await openPage(browser);
    await page.evaluate(() => {
      window.__LANES.boom.mode = "failed";
    });
    const sent = await upload(page, SHA);
    await sleep(PROCESSING_MS + 200);
    const done = await status(page, sent.fileId);
    const unknown = await status(page, "no-such-file");
    results.failed = { done, unknown };
    check("failed", "the file ends on Boom's failed rung", done.status === "failed");
    check("failed", "with the server's own words, verbatim", /could not read this file/.test(done.message ?? ""));
    check("failed", "and no spread at all", done.financialStatements === undefined);
    check("failed", "a file Boom never took says so plainly", unknown.status === "failed");
    await page.close();
  }

  /* ---------------------------------------------------- 4. never verified */
  {
    const every = JSON.stringify(results);
    results.neverVerified = { scannedChars: every.length };
    check("neverVerified", "nothing in the run claims a verified file", !/"status":"verified"/.test(every));
    check(
      "neverVerified",
      "every statement is not_validated",
      !/"validationStatus":"validated"/.test(every) && /"validationStatus":"not_validated"/.test(every),
    );
    check("neverVerified", "no validation URL is offered", !/file-validation/.test(every));
  }
} finally {
  await browser.close();
}

writeFileSync(`${OUT}/boom.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
console.log(`\nreport in ${OUT}`);

if (failures.length) {
  console.error(`\nFAIL: ${failures.length} assertion(s) did not hold:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exitCode = 1;
} else {
  const count = Object.values(results).reduce((n, r) => n + Object.keys(r.checks ?? {}).length, 0);
  console.log(`\nOK: ${Object.keys(results).length} scenarios, ${count} assertions, all green.`);
}
