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
     5  wait rejected    the transport swallows a `boom_await_file` (502) while
                         Boom carries on spreading: the next wait answers
                         `processing`, then `done`, and the spread lands. A
                         rejected WAIT is never a failed FILE (founder,
                         2026-09-15 19:37 UTC, Hartwell)
     6  never verified   nothing in the run returns `verified`, a validated
                         statement or a validation URL: verification is an
                         analyst's act inside Boom and no stub may claim one
     8  the ghost      THE 0.9.32 BEATS, on the built page, with the banker
                         STAYING in the room: the pre-read stands as the register
                         before Boom is called (faint, no chips, labelled as the
                         file's own reading), the confirm is one banker sentence
                         and one ink pill, the rail carries Boom's four words and
                         real doors, and at the arrival Boom's lines light those
                         same rows, the fold dissolves, the flagged sign carries
                         the page's figure struck beside Boom's, the
                         reconciliation is DERIVED from the two sides, a pin set
                         on the ghost is answered by name, and the room ends in
                         two GLASS doors
     7  the wait follows THE 0.9.31 REQUIREMENT, on the built page rather than at
                         the wire: drop a statement, LEAVE the Spreading room for
                         the worklist, and the header carries the indicator with
                         the relationship, the elapsed clock and the count; the
                         stub then completes the file while the room is shut, the
                         arrival marker lands, the worklist row glows, and the
                         register is on the sheet on the way back in

   THE ARGUMENT NAMES ARE THE ASSERTION. Every call below carries the exact body
   the builders in app/src/channel/boomUpload.ts produce, so running this against
   the real connector is the check that the mapping is complete.

   Exit code is 1 if any assertion fails.

   Usage:  node drive-boom.mjs [file-or-url] [outDir]
*/
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveDir } from "./lib/serve.mjs";

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

/* ------------------------------------------------- the built page, for scenario 7

   THE FIVE WIRE SCENARIOS drive the connector through the artifact template;
   the sixth drives the COCKPIT, because what it asserts is a page-level poll and
   a header, neither of which exists at the wire. The assembly is `spread-e2e`'s
   own, so the two drives are looking at the same bundle. */
const ROOT = `${HERE}../..`;
const BUNDLE = `${ROOT}/app/dist/cockpit.html`;
const SAMPLE = readFileSync(`${HERE}lib/stub-sample.js`, "utf8");

/** THE STATEMENT AS A PAGE PRINTS IT, with this borrower's own name on it so
 *  the room's company ask resolves rather than asking the drive to answer it.
 *
 *  AND IT IS NOT THE SPREAD (0.9.32). The figures are Piedmont's own, so the
 *  room's pre-read and the stub's Boom answer are two readings of ONE statement
 *  and the ghost register can be reconciled against it. Two of the lines are the
 *  whole point:
 *    THE FOLD  the page prints SG and A and D and A on their own lines; Boom
 *              returns one `total_operating_expenses` line carrying their sum.
 *    THE SIGN  the page prints the tax provision as a positive number in a
 *              deduction position; Boom flags it `flipSign`, so the register
 *              carries it negative and the page's figure is struck beside it. */
const STATEMENT_CSV = `${OUT}/statements-fy2025.csv`;
writeFileSync(
  STATEMENT_CSV,
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
  ].join("\n"),
);

/** The printed lines above, in the order the page prints them. The ghost
 *  register is asserted against this list and not against a count. */
const PRINTED_LINES = [
  "Net Sales",
  "Cost of Sales",
  "Gross Profit",
  "Selling, General and Administrative",
  "Depreciation and Amortization",
  "Income from Operations",
  "Interest Expense",
  "Other Income (Expense), Net",
  "Income before Income Taxes",
  "Provision for Income Taxes",
  "Net Income",
];

let site = null;

/** The built cockpit, on the stub lanes, with Boom slow enough that the banker
 *  can leave the room before the file lands. */
async function openCockpit(browser) {
  if (!site) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "boom-drive-"));
    mkdirSync(path.join(dir, "b"), { recursive: true });
    execFileSync(
      "node",
      [`${ROOT}/app/scripts/assemble-artifact.mjs`, `${ROOT}/artifact/live-data.json`, path.join(dir, "b/index.html"), BUNDLE],
      { stdio: "ignore" },
    );
    site = await serveDir(dir);
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(stub);
  await page.addInitScript(SAMPLE);
  /* LONG ENOUGH TO LEAVE. The drive turns this off per file once the room is
     shut, which is the assertion. */
  await page.addInitScript(() => {
    const t = setInterval(() => {
      if (!window.__LANES) return;
      clearInterval(t);
      window.__LANES.boom.processingMs = 600000;
    }, 0);
  });
  await page.goto(site.url + "b/", { waitUntil: "load" });
  await page.waitForSelector(`[data-open="${ACCOUNT}"]`, { timeout: 30000 });
  return page;
}

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

  /* ------------------------------------------------------ 5. wait rejected */
  {
    const page = await openPage(browser);
    await page.evaluate(() => {
      window.__LANES.boom.processingMs = 2500;
    });
    const run = await ladder(page, SHA);

    /* THE DEFECT, REPRODUCED AT THE WIRE. One `boom_await_file` is swallowed by
       the relay. Boom has the file and is spreading it; nothing about the file
       changed, and the room that read this as "Failed" was reading the
       transport, not the ladder. */
    await page.evaluate(() => {
      window.__LANES.boom.rejects.boom_await_file = 1;
    });
    /* CAUGHT INSIDE THE PAGE, deliberately: the rejection is a plain OBJECT and
       not an Error, and carrying it back out through playwright would turn it
       into one and hide the very thing that produced "[object Object]" on the
       glass. `stringified` is that defect, at the wire, in one field. */
    const rejected = await page.evaluate(
      async ({ server, fileId }) => {
        const mcp = await window.claude.use("mcp");
        try {
          await mcp.callTool(server, "boom_await_file", { fileId, maxSeconds: 10 });
          return null;
        } catch (err) {
          return {
            isError: err instanceof Error,
            code: err?.code ?? null,
            message: err?.message ?? null,
            stringified: String(err),
          };
        }
      },
      { server: BOOM_SERVER, fileId: run.fileId },
    );

    // The file is exactly where it was: the rejection carried no news of it.
    const during = await getFile(page, run.fileId);
    const stillWaiting = await awaitFile(page, run.fileId, 1);
    await sleep(2_600);
    const settled = await awaitFile(page, run.fileId);
    const spread = await getSpread(page, run.fileId);
    results.waitRejected = { rejected, during, stillWaiting, settled, statements: (spread.spread?.financialStatements ?? []).length };
    check("waitRejected", "the wait is refused by the transport, not by Boom", rejected !== null);
    check("waitRejected", "and the refusal is the relay's own 502", /502/.test(rejected?.message ?? ""));
    check("waitRejected", "the refusal is an object and not an Error", rejected?.isError === false);
    check(
      "waitRejected",
      "so String() of it is the defect the founder saw, which is why the room may never print it",
      rejected?.stringified === "[object Object]",
    );
    check("waitRejected", "Boom still holds the file, still processing", during.file?.status === "processing");
    check("waitRejected", "the next wait answers rather than refusing", stillWaiting.status === "processing" && stillWaiting.done === false);
    check("waitRejected", "and then reports done on a terminal rung", settled.done === true && settled.status === "completed");
    check("waitRejected", "the spread lands after the rejected wait", results.waitRejected.statements === 1);
    await page.close();
  }

  /* -------------------------------------------- 7. the wait follows the banker

     THE REQUIREMENT ABOVE ALL (design 0.9.31, founder: "so i can leave the
     workroom of spreading and there is a progress indicator somewhere?"). The
     five scenarios above drive the WIRE; this one drives the BUILT PAGE, because
     what is being asserted is that the poll is no longer the room's.

     THE FILE IS COMPLETED WHILE THE ROOM IS SHUT, which is the whole point: the
     stub's per-file clock (`__LANES.boom.files[id].processingMs`, 0.9.31) is set
     to zero from the worklist, with no Spreading room mounted anywhere. */
  {
    const page = await openCockpit(browser);
    const room = "[data-room='spread']";

    await page.click(`[data-open="${ACCOUNT}"]`);
    await page.waitForSelector("#view-account .hero", { timeout: 15000 });
    await page.click("#fab");
    await page.waitForSelector("#actSpread", { state: "visible", timeout: 6000 });
    await page.click("#actSpread");
    await page.waitForSelector(".sp-body", { timeout: 6000 });
    await page.setInputFiles("input.sp-file", STATEMENT_CSV);
    await page.waitForSelector(".sp-cards", { timeout: 10000 });
    for (let i = 0; i < 8; i += 1) {
      if (await page.$(".sp-go")) break;
      await page.waitForSelector(".sp-ask, .sp-go", { timeout: 15000 });
      if (await page.$(".sp-go")) break;
      await page.click(".sp-ask .sp-chip");
      await page.waitForTimeout(400);
    }
    await page.waitForSelector(".sp-go", { timeout: 15000 });
    await page.click(".sp-go");

    // The receipts, and the sentence that says the banker may leave. Waited on
    // the LAST fact rather than on the block: the facts land one per beat and a
    // receipt read at the first of them is a receipt half written.
    await page.waitForFunction(
      () => /Processing since/.test(document.querySelector(".sp-rcpt")?.textContent || ""),
      null,
      { timeout: 20000 },
    );
    const receipt = await page.textContent(".sp-rcpt");
    const leaveLine = await page.textContent(".sp-wait-l");

    // LEAVE. The room closes and the banker goes back to the worklist.
    await page.click("[aria-label='Close the spreading room']");
    await page.waitForSelector(room, { state: "detached", timeout: 6000 });
    await page.click("#goHome");
    await page.waitForSelector(`#view-home [data-open="${ACCOUNT}"]`, { timeout: 10000 });

    // THE INDICATOR, WITH THE ROOM SHUT.
    await page.waitForSelector(".bw-pill[data-boom-state='reading']", { timeout: 10000 });
    const readPill = (state) => page.textContent(`.bw-pill[data-boom-state='${state}'] .bw-t`);
    const readCount = () =>
      page.$eval(".bw-pill[data-boom-state='reading']", (n) =>
        [...n.querySelectorAll(".bw-s")].map((x) => x.textContent).join(" · "),
      );
    const reading = ((await readPill("reading")) || "") + " · " + (await readCount());
    await page.waitForTimeout(1200);
    const readingLater = ((await readPill("reading")) || "") + " · " + (await readCount());

    // Boom finishes while nobody is in the room.
    const shutWhileFinishing = (await page.$(room)) === null;
    await page.evaluate(() => {
      Object.values(window.__LANES.boom.files).forEach((f) => {
        f.processingMs = 0;
      });
    });

    await page.waitForSelector(".bw-pill[data-boom-state='marker'], .bw-pill[data-boom-state='arrived']", { timeout: 20000 });
    const arrived = (await page.textContent(".bw-pill .bw-t")) || "";
    const glow = await page.$$eval('[data-boom="arrived"]', (ns) => ns.length);

    // BACK IN, AND THE REGISTER IS THERE.
    await page.click(".bw-pill");
    await page.waitForSelector(".sp-fin .rg", { timeout: 20000 });
    // The brief types, three sentences at the governed stage's own pace.
    await page.waitForFunction(
      () => /Boom found \d+ periods?:/.test(document.querySelector(".sp-arrive")?.textContent || ""),
      null,
      { timeout: 20000 },
    );
    const brief = (await page.textContent(".sp-arrive")) || "";
    const registerRows = await page.$$eval(".sp-fin .rg-t tbody tr", (ns) => ns.length);
    const clearedOnLook = await page.$$eval(".bw-pill", (ns) => ns.length);

    results.waitFollows = {
      receipt: receipt.replace(/\s+/g, " ").trim().slice(0, 240),
      leaveLine: (leaveLine || "").trim(),
      reading: reading.replace(/\s+/g, " ").trim(),
      readingLater: readingLater.replace(/\s+/g, " ").trim(),
      arrived: arrived.replace(/\s+/g, " ").trim(),
      brief: brief.replace(/\s+/g, " ").trim().slice(0, 400),
      registerRows,
      glow,
      clearedOnLook,
    };
    check("waitFollows", "the drop lands as a receipt Boom's own answers produced", /Known by/.test(receipt) && /Boom acknowledged, file/.test(receipt));
    check("waitFollows", "the room says on the glass that the banker may leave", /You can leave this room/.test(leaveLine || ""));
    check("waitFollows", "the room is shut while Boom is still reading", shutWhileFinishing);
    check("waitFollows", "the header names the relationship Boom is reading for", /^Reading .+ statements/.test(results.waitFollows.reading));
    check("waitFollows", "and counts the files", /\d of \d files?$/.test(results.waitFollows.reading));
    check("waitFollows", "the elapsed clock is running", /\d\d:\d\d/.test(results.waitFollows.reading) && results.waitFollows.reading !== results.waitFollows.readingLater);
    check("waitFollows", "no percentage is invented anywhere on it", !/%/.test(results.waitFollows.reading));
    check("waitFollows", "the arrival is brought to the banker", /^Boom has read /.test(results.waitFollows.arrived));
    check("waitFollows", "the worklist row carries the glow until they look", glow >= 1);
    check("waitFollows", "the register is there on the way back in", registerRows > 0);
    check("waitFollows", "the arrival brief says what Boom found", /Boom found \d+ period/.test(brief));
    check("waitFollows", "and the pill clears once it has been looked at", clearedOnLook === 0);

    await page.close();
  }

  /* ------------------------------------------- 8. the ghost register (0.9.32)

     THE FOUR BEATS OF THE ROOM, on the BUILT PAGE, with the banker staying in
     it. Scenario 7 proves the wait follows them out; this one proves what they
     see if they stay.

       ghost    the room's own pre-read IS the register before Boom is called:
                every printed line, faint, chip column empty, labelled as the
                file's own reading and not Boom's
       confirm  one banker sentence and ONE ink pill, which is the only ink in
                the room (rule 27/41)
       reading  the guided rail: Boom's four words, what happens next, and real
                doors computed from this relationship's own book
       arrival  Boom's lines light those same rows, the two printed lines it
                folded dissolve, the line it read the other way round carries
                the file's own figure struck beside Boom's, the reconciliation
                is DERIVED from the two sides, a pin set on the ghost survives
                and is answered by name, and the room ends in two GLASS doors.  */
  {
    const page = await openCockpit(browser);
    await page.evaluate(() => {
      window.__LANES.boom.processingMs = 4000;
    });

    await page.click(`[data-open="${ACCOUNT}"]`);
    await page.waitForSelector("#view-account .hero", { timeout: 15000 });
    await page.click("#fab");
    await page.waitForSelector("#actSpread", { state: "visible", timeout: 6000 });
    await page.click("#actSpread");
    await page.waitForSelector(".sp-body", { timeout: 6000 });
    await page.setInputFiles("input.sp-file", STATEMENT_CSV);
    await page.waitForSelector(".sp-cards", { timeout: 10000 });
    for (let i = 0; i < 8; i += 1) {
      if (await page.$(".sp-go")) break;
      await page.waitForSelector(".sp-ask, .sp-go", { timeout: 15000 });
      if (await page.$(".sp-go")) break;
      await page.click(".sp-ask .sp-chip");
      await page.waitForTimeout(400);
    }
    await page.waitForSelector(".sp-go", { timeout: 15000 });

    /* THE GHOST, before Boom has been called at all. */
    await page.waitForFunction(
      (n) => document.querySelectorAll(".rg-t tbody tr").length >= n,
      PRINTED_LINES.length,
      { timeout: 15000 },
    );
    const ghostRows = await page.$$eval(".rg-t tbody tr", (ns) =>
      ns.map((n) => ({
        name: (n.querySelector(".rg-nm")?.textContent || "").trim(),
        ghost: n.hasAttribute("data-ghost"),
      })),
    );
    const ghostLine = ((await page.textContent(".rg-line")) || "").replace(/\s+/g, " ").trim();
    const ghostChips = await page.$$eval(".rg-cat", (ns) => ns.length);
    const confirmLine = ((await page.textContent(".sp-confirm-l")) || "").replace(/\s+/g, " ").trim();
    const inkAtConfirm = await page.$$eval(".eg-btn-ink", (ns) =>
      ns.map((n) => n.textContent.trim()),
    );

    /* A PIN, SET ON THE GHOST: it has to survive the wait and be answered by
       name in the arrival brief. */
    const PIN = "Net Sales";
    await page.click('.rg-t tbody tr[data-row="net sales"] .rg-pin');
    const pinnedOnGhost = await page.$$eval("tr[data-pin] .rg-nm", (ns) => ns.map((n) => n.textContent.trim()));

    await page.click(".sp-go");

    /* THE READING BEAT. */
    await page.waitForSelector(".sp-rail", { timeout: 20000 });
    const railHeads = await page.$$eval(".sp-rail dt", (ns) => ns.map((n) => n.textContent.trim()));
    const railDoing = ((await page.textContent(".sp-rail dd")) || "").replace(/\s+/g, " ").trim();
    const railDoors = await page.$$eval(".sp-rail .sp-door", (ns) =>
      ns.map((n) => ({ door: n.dataset.door, label: n.textContent.trim(), ink: n.classList.contains("eg-btn-ink") })),
    );
    const leaveLine = ((await page.textContent(".sp-wait-l")) || "").trim();
    const ghostDuringWait = await page.$$eval(".rg-t tbody tr[data-ghost]", (ns) => ns.length);

    /* THE ARRIVAL. The reconciliation is written once the fold has settled. */
    await page.waitForSelector(".rg-recon", { timeout: 40000 });
    const recon = ((await page.textContent(".rg-recon")) || "").trim();
    const litRows = await page.$$eval(".sp-fin .rg-t tbody tr", (ns) =>
      ns.map((n) => ({
        name: (n.querySelector(".rg-nm")?.textContent || "").trim(),
        code: (n.querySelector(".rg-cat-l")?.textContent || "").trim(),
        verdict: n.dataset.verdict || null,
        note: (n.querySelector(".rg-note")?.textContent || "").trim(),
        was: (n.querySelector(".rg-was")?.textContent || "").trim(),
        pinned: n.hasAttribute("data-pin"),
      })),
    );
    /* WAITED ON THE WHOLE SENTENCE. The brief TYPES, and a pinned line read at
       its third word is a pinned line half written. */
    await page.waitForFunction(
      () => /You pinned .+\. Boom kept it as it stands\./.test(document.querySelector(".sp-arrive")?.textContent || ""),
      null,
      { timeout: 30000 },
    );
    const brief = ((await page.textContent(".sp-arrive")) || "").replace(/\s+/g, " ").trim();
    const endDoors = await page.$$eval(".wk-sheet-acts > *", (ns) =>
      ns.map((n) => ({ label: n.textContent.trim(), ink: n.classList.contains("eg-btn-ink"), cls: n.className })),
    );
    const inkAtEnd = await page.$$eval(".eg-btn-ink", (ns) => ns.length);

    /* THE SENTENCE IS DERIVED, NOT A CONSTANT: every number in it has to
       reconcile with the rows the page actually drew, on both sides of Boom. */
    const said = /Boom kept (\d+) of the (\d+) lines/.exec(recon);
    const foldSaid = /folded (\d+) into (\d+)/.exec(recon);
    const signSaid = /read (\d+) with the opposite sign/.exec(recon);
    const derived = said
      ? {
          kept: Number(said[1]),
          read: Number(said[2]),
          folded: foldSaid ? Number(foldSaid[1]) : 0,
          foldedInto: foldSaid ? Number(foldSaid[2]) : 0,
          sign: signSaid ? Number(signSaid[1]) : 0,
        }
      : null;

    results.ghostRegister = {
      ghostRows: ghostRows.map((r) => r.name),
      ghostLine,
      ghostChips,
      confirmLine,
      inkAtConfirm,
      pinnedOnGhost,
      railHeads,
      railDoing,
      railDoors,
      leaveLine,
      ghostDuringWait,
      recon,
      derived,
      litRows,
      brief: brief.slice(0, 500),
      endDoors,
      inkAtEnd,
    };

    check(
      "ghostRegister",
      "the register stands before Boom is called, and it is the page's own lines in its own order",
      ghostRows.length === PRINTED_LINES.length && ghostRows.every((r, i) => r.name === PRINTED_LINES[i]),
    );
    check("ghostRegister", "in faint ink, every row of it", ghostRows.every((r) => r.ghost));
    check("ghostRegister", "with the chip column empty, because a code is Boom's to give", ghostChips === 0);
    check(
      "ghostRegister",
      "and it says whose reading it is, from which file, over which periods, at which scale",
      /^Not yet mapped by Boom/.test(ghostLine) &&
        /statements-fy2025\.csv/.test(ghostLine) &&
        /FY2023, FY2024, FY2025/.test(ghostLine) &&
        /thousands, as printed/.test(ghostLine),
    );
    check(
      "ghostRegister",
      "the confirm is one banker sentence naming the files, the relationship and Boom's Account Id",
      /^Start Boom reading (this file|these \d+ files) for .+\. Boom registers the borrower under its Account Id 001[A-Za-z0-9]+ and reads each file on its own\./.test(
        confirmLine,
      ),
    );
    check(
      "ghostRegister",
      "and exactly one thing in the room is ink: the commit (rule 27/41)",
      inkAtConfirm.length === 1 && inkAtConfirm[0] === "Confirm and spread",
    );
    check("ghostRegister", "a pin set on the ghost holds", pinnedOnGhost.length === 1 && pinnedOnGhost[0] === PIN);
    check(
      "ghostRegister",
      "the rail carries its four sections",
      railHeads.join(" | ") === "What Boom is doing | What happens next | Meanwhile" &&
        /^You can leave this room\./.test(leaveLine),
    );
    check(
      "ghostRegister",
      "and Boom's own state word, with nothing invented between the rungs",
      /processing, completed, verified or failed/.test(railDoing),
    );
    /* THE DOORS ARE COMPUTED, WHICH IS WHY THIS IS A SUBSEQUENCE AND NOT A LIST.
       A relationship with no covenant package and one with no spread on file
       each simply have one door fewer: a door with nothing behind it is not
       drawn. What is asserted is the ORDER, that the two computed ones carry the
       book's own figures wherever they ARE drawn, and that every one is glass. */
    const DOOR_ORDER = ["covenants", "lastSpread", "financials", "worklist"];
    const drawn = railDoors.map((d) => d.door);
    const covenantDoor = railDoors.find((d) => d.door === "covenants");
    const spreadDoor = railDoors.find((d) => d.door === "lastSpread");
    check(
      "ghostRegister",
      "the doors on it are this relationship's own, computed and in order, and every one is glass",
      drawn.every((d, i) => DOOR_ORDER.indexOf(d) > (i ? DOOR_ORDER.indexOf(drawn[i - 1]) : -1)) &&
        drawn.includes("financials") &&
        drawn.includes("worklist") &&
        (!covenantDoor || /^\d+ covenants? on this relationship$/.test(covenantDoor.label)) &&
        (!spreadDoor || /^The FY\d{4} spread already on file$/.test(spreadDoor.label)) &&
        railDoors.every((d) => !d.ink),
    );
    check("ghostRegister", "the ghost stands through the whole wait", ghostDuringWait === PRINTED_LINES.length);
    check(
      "ghostRegister",
      "Boom's lines light those same rows, chips and all",
      litRows.length > 0 && litRows.every((r) => r.code.length > 0),
    );
    check(
      "ghostRegister",
      "the line Boom folded says what it folded, and the printed lines it took are gone",
      litRows.some((r) => r.verdict === "fold" && /folded 2 printed lines into this one/.test(r.note)) &&
        !litRows.some((r) => r.name === "Selling, General and Administrative"),
    );
    check(
      "ghostRegister",
      "the line Boom read the other way round says so, with the file's own figure struck beside it",
      litRows.some((r) => r.verdict === "sign" && /opposite sign/.test(r.note) && r.was.length > 0),
    );
    check("ghostRegister", "the reconciliation is one banker sentence", /^Boom kept \d+ of the \d+ lines/.test(recon));
    check(
      "ghostRegister",
      "and it is DERIVED: its counts reconcile with the rows the page drew, on both sides",
      derived !== null &&
        derived.read === ghostRows.length &&
        derived.foldedInto === litRows.filter((r) => r.verdict === "fold").length &&
        derived.sign === litRows.filter((r) => r.verdict === "sign").length &&
        derived.kept === litRows.filter((r) => r.verdict === "kept").length &&
        derived.kept + derived.sign + derived.folded === derived.read,
    );
    check("ghostRegister", "the pin survives to the arrival", litRows.some((r) => r.pinned && r.name === PIN));
    check("ghostRegister", "and the brief answers it by name", new RegExp(`You pinned ${PIN}\\. Boom kept it`).test(brief));
    check(
      "ghostRegister",
      "the room ends in exactly two doors, and both are GLASS",
      endDoors.length === 2 && endDoors.every((d) => !d.ink && /wk-sheet-(go|back)/.test(d.cls)),
    );
    check("ghostRegister", "no ink is left in the room once the commit has happened", inkAtEnd === 0);
    await page.close();
  }

  /* ---------------------------------------------------- 6. never verified */
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
  site?.close?.();
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
