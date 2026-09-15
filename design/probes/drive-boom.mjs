/* THE BOOM LANE: the ladder, measured against the stub connector.

   Boom is its own MCP server now (`boom-mcp`), and the cockpit reaches it by a
   four-call ladder and a bounded wait rather than by one upload tool. The stub
   connector in lib/stub-lanes.js answers that surface in the LIVE ENVELOPE,
   shape for shape with the answers read off the real server on 2026-09-15 and
   saved under app/src/__fixtures__/boom-live/. This file drives it, so the wire
   contract is exercised in a browser through the page's own connector door
   before anything is handed to a banker.

   FIVE RUNS, all through `window.claude.use("mcp")`:

     1  the envelope     every answer carries contractVersion, `_source` and
                         `_provenance`, and the two wrapped shapes put their body
                         under `file` and `spread` the way the live server does
     2  the ladder       ensure_company, list_files, create_upload, upload_bytes,
                         process_file, then await_file holds the processing rung
                         for the whole window and reports `done` when it turns;
                         get_spread then carries Boom-shaped financialStatements
     3  idempotent       the same sha256 sent twice is ONE file: list_files
                         reports the file already taken, the clock does not
                         restart and there is one set of periods, never two
     4  failed           a file Boom cannot read ends `failed` with the server's
                         own message, verbatim, and no spread at all
     5  never verified   nothing in the run returns `verified`, a validated
                         statement or a validation URL: verification is an
                         analyst's act inside Boom and no stub may claim one

   THE ARGUMENT NAMES ARE THE ASSERTION. Every call below carries the exact body
   the builders in app/src/channel/boomUpload.ts produce, so running this against
   the real connector is the check that the mapping is complete.

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

/** The connector the page addresses Boom at. `SERVERS.boom` in the cockpit is
 *  the FALLBACK name: the real one is discovered off `listTools()`, and the stub
 *  answers `boom_*` on whichever door it is asked at, which is the point. */
const BOOM_SERVER = "Boom";

const ACCOUNT = "001bb00001DLtRMAA1";
const COMPANY = "Piedmont Precision Components, Inc.";
const FILE_NAME = "Piedmont_FY2025.xlsx";
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

/** One connector call, by name, through the page's own door. */
const call = (page, tool, input) =>
  page.evaluate(
    async ({ server, tool, input }) => {
      const mcp = await window.claude.use("mcp");
      const res = await mcp.callTool(server, tool, input);
      return res.payload;
    },
    { server: BOOM_SERVER, tool, input },
  );

/* THE CALLS THE COCKPIT'S ADAPTER MAKES, argument for argument with
   `ensureCompanyArgs` / `listFilesArgs` / `createUploadArgs` /
   `uploadBytesArgs` / `fileArgs` / `awaitArgs` in
   app/src/channel/boomUpload.ts. */

const ensureCompany = (page) => call(page, "boom_ensure_company", { name: COMPANY, salesforceRecordId: ACCOUNT });
const listFiles = (page) => call(page, "boom_list_files", { salesforceRecordId: ACCOUNT });
const createUpload = (page, sha, fileName = FILE_NAME) =>
  call(page, "boom_create_upload", { fileName, salesforceRecordId: ACCOUNT, externalUniqueId: sha });
const uploadBytes = (page, fileId) =>
  call(page, "boom_upload_bytes", { fileId, contentBase64: "UEsDBA==", fileName: FILE_NAME });
const processFile = (page, fileId) => call(page, "boom_process_file", { fileId });
const awaitFile = (page, fileId, maxSeconds = 20) => call(page, "boom_await_file", { fileId, maxSeconds });
const getFile = (page, fileId) => call(page, "boom_get_file", { fileId });
const getSpread = (page, fileId) => call(page, "boom_get_spread", { fileId });

/** The whole ladder, in the adapter's own order. Returns every answer. */
async function ladder(page, sha, fileName) {
  const company = await ensureCompany(page);
  const listed = await listFiles(page);
  const reserved = await createUpload(page, sha, fileName);
  const fileId = reserved.file.id;
  const sent = await uploadBytes(page, fileId);
  const started = await processFile(page, fileId);
  return { company, listed, reserved, fileId, sent, started };
}

const filesTaken = (page) => page.evaluate(() => Object.keys(window.__LANES.boom.files).length);

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

const browser = await chromium.launch({ args: ARGS });
try {
  /* ----------------------------------------------------------- 1. envelope */
  {
    const page = await openPage(browser);
    const run = await ladder(page, SHA);
    await sleep(PROCESSING_MS + 200);
    const file = await getFile(page, run.fileId);
    const spread = await getSpread(page, run.fileId);
    const missing = await getFile(page, "no-such-file");
    results.envelope = { reserved: run.reserved, file, spreadKeys: Object.keys(spread.spread ?? {}), missing };
    for (const [what, answer] of Object.entries({ reserved: run.reserved, file, spread })) {
      check("envelope", `${what} states the contract version`, answer.contractVersion === "1.0");
      check("envelope", `${what} names the stub as its source`, answer._source === "BOOM-STUB");
      check("envelope", `${what} carries provenance`, answer._provenance?.system === "Boom");
    }
    check("envelope", "the file answer wraps its body under file", typeof file.file === "object");
    check("envelope", "the spread answer wraps its body under spread", typeof spread.spread === "object");
    check("envelope", "a file Boom never took answers NOT_FOUND, not an empty object", missing.code === "NOT_FOUND");
    await page.close();
  }

  /* ------------------------------------------------------------- 2. ladder */
  {
    const page = await openPage(browser);
    /* LONGER THAN ONE WAIT, ON PURPOSE. `boom_await_file` BLOCKS until the file
       settles or its seconds run out, so a file that finishes inside the first
       call never shows the "not done" answer the room's loop is built around.
       Boom's own files routinely outlast a single wait; this reproduces that. */
    await page.evaluate(() => {
      window.__LANES.boom.processingMs = 3000;
    });
    const t0 = Date.now();
    const run = await ladder(page, SHA);
    const early = await awaitFile(page, run.fileId, 1);
    const settled = await awaitFile(page, run.fileId);
    const spread = await getSpread(page, run.fileId);
    const statement = (spread.spread?.financialStatements ?? [])[0];
    results.ladder = {
      run,
      early,
      settled,
      msToCompleted: Date.now() - t0,
      statement: { id: statement?.id, validationStatus: statement?.validationStatus, periods: statement?.periods?.length },
    };
    check("ladder", "ensure_company hands back the borrower", UUID.test(run.company.company?.id ?? ""));
    check("ladder", "the reservation carries a Boom file id", UUID.test(run.fileId ?? ""));
    check("ladder", "the reservation carries no spread yet", run.reserved.spread === undefined);
    check("ladder", "the bytes are taken", run.sent.bytes > 0);
    check("ladder", "processing is asked for and reported", run.started.status === "processing");
    check("ladder", "the wait blocks while Boom is spreading, and says it is not done", early.done === false && early.status === "processing");
    check("ladder", "and then reports done on a terminal rung", settled.done === true && settled.status === "completed");
    check("ladder", "the spread carries one Boom-shaped statement", (spread.spread?.financialStatements ?? []).length === 1);
    check("ladder", "on three periods", (statement?.periods ?? []).length === 3);
    check("ladder", "carrying the file's own figures on Boom's period ids", statement?.lineItems?.[0]?.periodValues?.p2025 === 64486000);
    check(
      "ladder",
      "and the account-code roll-up in Boom's own pair shape",
      (statement?.aggregatedFinancials ?? []).some(
        (r) => r.accountCode === "net_sales_revenue" && r.periodValues?.p2025?.asGiven === 64486000,
      ),
    );
    await page.close();
  }

  /* -------------------------------------------------------- 3. idempotent */
  {
    const page = await openPage(browser);
    const first = await ladder(page, SHA);
    const again = await ladder(page, SHA);
    const different = await ladder(page, OTHER_SHA, "Piedmont_FY2024.xlsx");
    const taken = await filesTaken(page);
    // The list is what the adapter reads BEFORE it reserves anything, so a
    // re-drop resolving to the file already there is the assertion.
    const listed = (again.listed.files ?? []).filter((f) => f.fileName === FILE_NAME);
    await sleep(PROCESSING_MS + 200);
    const spread = await getSpread(page, first.fileId);
    const settled = await getFile(page, first.fileId);
    results.idempotent = { first: first.fileId, again: again.fileId, different: different.fileId, taken, listed };
    check("idempotent", "the same sha256 is the same Boom file", first.fileId === again.fileId);
    check("idempotent", "a different file is a different Boom file", different.fileId !== first.fileId);
    check("idempotent", "two files were taken, not three", taken === 2);
    check("idempotent", "list_files reports the file once, so the adapter reuses it", listed.length === 1);
    check("idempotent", "the re-drop did not restart the clock", settled.file?.status === "completed");
    check("idempotent", "and produced ONE set of periods", (spread.spread?.financialStatements?.[0]?.periods ?? []).length === 3);
    await page.close();
  }

  /* ------------------------------------------------------------ 4. failed */
  {
    const page = await openPage(browser);
    await page.evaluate(() => {
      window.__LANES.boom.mode = "failed";
    });
    const run = await ladder(page, SHA);
    await sleep(PROCESSING_MS + 200);
    const settled = await awaitFile(page, run.fileId);
    const file = await getFile(page, run.fileId);
    const spread = await getSpread(page, run.fileId);
    results.failed = { settled, file, spread };
    check("failed", "the wait ends on Boom's failed rung", settled.status === "failed" && settled.done === true);
    check("failed", "the file says so with the server's own words, verbatim", /could not read this file/.test(file.file?.message ?? ""));
    check("failed", "and there is no spread to read at all", spread.code === "NOT_FOUND");
    await page.close();
  }

  /* ---------------------------------------------------- 5. never verified */
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
