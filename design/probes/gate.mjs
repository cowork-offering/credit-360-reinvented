/* THE DRIVE GATE (backlog row 51, founder 2026-09-13: "it is not only Hartwell, it needs to work
   everywhere").

   ONE COMMAND, THE WHOLE MATRIX. Every workroom scenario on THREE books, plus the spread drive's
   three file kinds, in one table with one exit code.

     cd app && npm run gate:drives            # the whole matrix against app/dist/cockpit.html
     node design/probes/gate.mjs --books Hartwell,Kingsley
     node design/probes/gate.mjs --scenario relayDrop
     node design/probes/gate.mjs --bundle app/dist/cockpit.html --serial
     node design/probes/gate.mjs --classify-selftest   # unit-check the harness-error classifier

   THE GATE RUNS ALONE (backlog row 60, 0.9.27 evidence below). It drives real Chromium instances
   through the whole matrix; it does not share the box. Never run it concurrently with vitest, or
   with a second browser drive of its own. The orchestrator owns when it runs, not an ad hoc
   terminal alongside a test watcher.

   WHY THREE BOOKS. One book green is a coincidence, not a gate. Hartwell is the founder's own:
   two packages, two lines of credit, a twenty-six row graph, so every question the room can ask
   gets asked. Kingsley is ONE package with ONE revolver and a Paid Off member, so every question
   the room can SKIP gets skipped, which is the path a Hartwell-only drive never walks. Piedmont
   has NOTHING BOOKED, so a credit action has nothing to run against and no modification version
   can exist: it is the refusal path end to end.

   EXIT CODE. 0 only when every scenario on every book comes back with no findings and no page
   errors, and every spread run completes its ladder. Anything else is 1, and the table says
   which row. A scenario declared `pending` reports its findings separately and does not fail the
   gate; that is the drive's own rule and this script keeps it.

   BOOKS RUN IN PARALLEL, one browser per book, because the matrix is three full drives and the
   founder runs this before a version bump rather than overnight. `--serial` runs them one at a
   time for a box that cannot hold three Chromiums.

   THE 0.9.27 EVIDENCE, AND THE RETRY IT BOUGHT. The 0.9.27 gate ran alongside the full vitest
   suite (box at 1.7 GB disk free) and lost four rows: Hartwell amendVersion, Hartwell relayDrop,
   Kingsley relayDrop and Piedmont relationshipReviews. Two failure shapes, neither the room's:
   Chromium's target crashed mid-drive, and a plain `.click()` on one of the room's entry controls
   (`#fab`, `#actFacility`, `#actRelationship`) hit Playwright's default 30s action timeout because
   the browser was starved for CPU while vitest ran. All four scenarios came back clean, zero
   findings, when re-run alone. That is a HARNESS error: it says the box was busy, not that the
   room is wrong, and it must never be counted or reported as a finding. So a scenario whose only
   findings match `HARNESS_ERROR_PATTERNS` below is re-run exactly once, on its own book and its
   own name; the row then reports "retried once, then passed" or "retried once, then failed" in
   both the per-row detail and the summary line, and only a second failure counts against the
   gate. A finding the room itself made (an assertion about what the drive saw) is never a harness
   match and is never retried; see `--classify-selftest` for the cases that pin this down. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

const ROOT = "/opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented";
const PROBES = path.join(ROOT, "design/probes");

function flag(name, fallback = null) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const next = process.argv[at + 1];
  return next && !next.startsWith("--") ? next : true;
}

const BUNDLE = String(flag("bundle", path.join(ROOT, "app/dist/cockpit.html")));
const BOOKS = String(flag("books", "Hartwell,Kingsley,Piedmont")).split(",").map((s) => s.trim()).filter(Boolean);
/** The spread drive is one book's worth of work per file kind, so it runs on ONE book. Kingsley
 *  by default: a one-package relationship is where the financials panel has the least to lean on. */
const SPREAD_BOOK = String(flag("spread-book", "Kingsley"));
const SPREAD_KINDS = String(flag("spread", "csv,xlsx,pdf")).split(",").map((s) => s.trim()).filter(Boolean);
const SCENARIO = flag("scenario", "");
const SERIAL = !!flag("serial", false);
const OUTDIR = fs.mkdtempSync(path.join(os.tmpdir(), "c360-gate-"));

const run = (args, label) =>
  new Promise((resolve) => {
    const t0 = Date.now();
    execFile("node", args, { cwd: PROBES, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ label, code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ""), stderr: String(stderr || ""), ms: Date.now() - t0 });
    });
  });

/* ------------------------------------------------------------------- the harness-error classifier */

/** ONE small explicit list, so "is this a harness error" is answered in one place, not re-guessed
 *  at every call site. Each pattern is evidence-backed by the 0.9.27 loss (see the header comment):
 *  a scenario that throws its way into `findings` as `the drive threw: <message>` or
 *  `the script threw: <message>` (workroom-e2e.mjs's own wording, unchanged here) is a harness
 *  error only if EVERY finding it produced matches one of these, never on a hunch. A timeout on
 *  the room's OWN markup (`.wk-root`, a reply node, a card) is deliberately NOT in this list: that
 *  is the room failing to respond, which is exactly the kind of thing the gate exists to catch. */
const HARNESS_ERROR_PATTERNS = [
  /* Hartwell amendVersion, 0.9.27: the whole Chromium target died mid-drive. */
  { label: "chromium target crashed", test: (msg) => /target crashed/i.test(msg) },
  /* Hartwell relayDrop, Kingsley relayDrop, Piedmont relationshipReviews, 0.9.27: a bare
     `.click("#fab" | "#actFacility" | "#actRelationship")` (workroom-e2e.mjs's own doors into a
     room, opened with no explicit timeout) hit Playwright's default 30s action timeout because
     vitest was starving the browser of CPU, not because the room failed to open. */
  {
    label: "click/nav timeout on an entry control (#fab / #actFacility / #actRelationship)",
    test: (msg) => /timeout\s+\d+\s*ms exceeded/i.test(msg) && /#fab|#actFacility|#actRelationship/.test(msg),
  },
  /* Not seen in the 0.9.27 loss but the same family: the browser or the CDP pipe itself went
     away mid-call, which is a box/process fact, not a room fact. */
  {
    label: "protocol or browser disconnect",
    test: (msg) => /protocol error|target closed|browser has been closed|websocket.*(closed|disconnected)/i.test(msg),
  },
];

function classifyHarnessError(message) {
  const msg = String(message ?? "");
  for (const p of HARNESS_ERROR_PATTERNS) if (p.test(msg)) return p.label;
  return null;
}

/** `--classify-selftest`: no browser, no bundle, just the classifier against known-shape messages
 *  (the 0.9.27 losses, and room findings that must never be mistaken for them). This is the unit
 *  test the probes have no other harness for. */
function classifySelfTest() {
  const cases = [
    { msg: "the drive threw: Error: page.click: Target crashed", expect: true, label: "Hartwell amendVersion, 0.9.27" },
    { msg: "the drive threw: Error: page.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator('#fab')", expect: true, label: "Hartwell relayDrop, click timeout on #fab, 0.9.27" },
    { msg: "the drive threw: Error: page.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator('#actFacility')", expect: true, label: "click timeout on #actFacility" },
    { msg: "the drive threw: Error: page.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator('#actRelationship')", expect: true, label: "Piedmont relationshipReviews, click timeout on #actRelationship, 0.9.27" },
    { msg: "the drive threw: browserContext.newPage: Target page, context or browser has been closed", expect: true, label: "browser closed mid-drive" },
    { msg: "the drive threw: Protocol error (Page.navigate): Target closed.", expect: true, label: "CDP protocol disconnect" },
    { msg: "the reply repeated the previous turn verbatim", expect: false, label: "a room finding: repeated reply" },
    { msg: "em dash in the room's reply", expect: false, label: "a room finding: em dash" },
    { msg: "the room panel calls Boom's own spread provisional", expect: false, label: "a room finding: provisional label" },
    {
      msg: "the drive threw: Error: page.waitForSelector: Timeout 8000ms exceeded.\nCall log:\n  - waiting for locator('.wk-root') to be attached",
      expect: false,
      label: "a real timeout on the room's own markup, not an entry control",
    },
  ];
  let failed = 0;
  for (const c of cases) {
    const got = classifyHarnessError(c.msg);
    const pass = Boolean(got) === c.expect;
    if (!pass) failed += 1;
    console.log(`${pass ? "PASS" : "FAIL"}  ${c.label}  ->  ${got ? `harness: ${got}` : "not harness (a room finding)"}`);
  }
  console.log(`${failed ? "FAIL" : "PASS"}  ${cases.length - failed}/${cases.length} classifier cases`);
  process.exit(failed ? 1 : 0);
}
if (flag("classify-selftest", false)) classifySelfTest();

/* ------------------------------------------------------------------- the workroom matrix */

/** Re-run exactly ONE scenario, on its own book, by name: `workroom-e2e.mjs`'s second argument
 *  (`ONLY`) is already built to run a single scenario when it is not empty, so a retry is the
 *  same invocation `driveBook` makes, just narrowed to the one row that threw. */
async function driveScenarioOnly(book, scenario) {
  const out = path.join(OUTDIR, `retry-${book.replace(/\W+/g, "-")}-${scenario.replace(/\W+/g, "-")}.json`);
  const args = [path.join(PROBES, "workroom-e2e.mjs"), BUNDLE, scenario, out, "--book", book];
  const r = await run(args, `${book} ${scenario} (retry)`);
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(out, "utf8"));
  } catch {
    parsed = null;
  }
  return { run: r, parsed };
}

/** THE ONE RETRY. A scenario whose findings are ALL harness matches gets re-run once, on its own
 *  book and name, and the row is replaced with whatever the retry produced. A scenario with even
 *  one non-harness finding mixed in is left alone: that finding is the room's own, and a harness
 *  crash next to it does not launder it into a pass on a second try. */
async function retryHarnessScenarios(book, parsed) {
  for (const [name, s] of Object.entries(parsed?.scenarios ?? {})) {
    if (s.pending) continue;
    const findings = s.findings ?? [];
    if (!findings.length) continue;
    const labels = findings.map(classifyHarnessError);
    if (!labels.every(Boolean)) continue;
    const { parsed: retried } = await driveScenarioOnly(book, name);
    const again = retried?.scenarios?.[name];
    Object.assign(s, again ?? {}, {
      findings: again ? (again.findings ?? []) : [...findings, `retry itself did not finish (harness: ${labels[0]})`],
      retried: true,
      retryOutcome: again && !(again.findings ?? []).length ? "passed" : "failed",
    });
  }
}

async function driveBook(book) {
  const out = path.join(OUTDIR, `wk-${book.replace(/\W+/g, "-")}.json`);
  const args = [path.join(PROBES, "workroom-e2e.mjs"), BUNDLE, String(SCENARIO || ""), out, "--book", book];
  const r = await run(args, book);
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(out, "utf8"));
  } catch {
    parsed = null;
  }
  if (parsed) await retryHarnessScenarios(book, parsed);
  return { book, out, run: r, parsed };
}

/* ------------------------------------------------------------------- the spread drive */

async function driveSpread(kind) {
  const r = await run([path.join(PROBES, "spread-e2e.mjs"), BUNDLE, kind, "--book", SPREAD_BOOK], `spread ${kind}`);
  const findings = [];
  const ladder = /LADDER:\s+(\w+)/.exec(r.stdout);
  const state = ladder ? ladder[1] : "no ladder line";
  if (r.code !== 0) findings.push(`the spread drive exited ${r.code}`);
  if (state !== "completed") findings.push(`the ladder settled as "${state}"`);
  let json = null;
  const at = r.stdout.lastIndexOf("\n{");
  if (at !== -1) {
    try {
      json = JSON.parse(r.stdout.slice(at));
    } catch {
      json = null;
    }
  }
  if (json) {
    /* CHANGED 0.9.28, WITH THE LANE ITSELF. These two rows used to REQUIRE the
       word "provisional" on the panel and on the Financials tab, because the
       spread on stage was the browser's own read of the banker's file and the
       Boom connector did not exist. It does now: the spread the room publishes
       came back from Boom, so the provisional word would be a lie about the
       book and the assertion is the other way round. What the gate checks is
       unchanged in kind: that the glass says exactly what happened. */
    if (json.panel?.hasProvisional) findings.push("the room panel calls Boom's own spread provisional");
    if (json.saysStub) findings.push("the room names a stub while the live lane is on");
    if (!json.financialsTab?.periods?.length) findings.push("the Financials tab carries no period after the spread");
    if (json.iris) findings.push("the forbidden word reached the glass");
    if (json.emDash) findings.push("em dash in the spreading room");
    for (const e of json.pageErrors ?? []) findings.push(`page error: ${e}`);
  } else if (!findings.length) {
    findings.push("the spread drive printed no result block");
  }
  return { kind, findings, state, ms: r.ms, stderr: r.stderr.slice(-400) };
}

/* ------------------------------------------------------------------- the table */

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const rule = (n) => "-".repeat(n);

const started = Date.now();
const bookResults = [];
if (SERIAL) {
  for (const b of BOOKS) bookResults.push(await driveBook(b));
} else {
  bookResults.push(...(await Promise.all(BOOKS.map(driveBook))));
}
const spreadResults = [];
for (const k of SPREAD_KINDS) spreadResults.push(await driveSpread(k));

let failures = 0;
let pendingCount = 0;
let retriedCount = 0;
const lines = [];
lines.push("");
lines.push(`CREDIT 360 DRIVE GATE   bundle ${path.relative(ROOT, BUNDLE)}   ${new Date().toISOString()}`);
lines.push("");
/** The relationship's own short name: the first word is what tells three books
 *  apart, and a column wide enough for "Piedmont Precision Components, Inc."
 *  would push the findings off the line. */
const shortBook = (name) => String(name).split(/[\s,]+/)[0];
lines.push(`${pad("BOOK", 12)}${pad("SCENARIO", 26)}${pad("FIND", 6)}${pad("TURNS", 7)}PATH / FINDINGS`);
lines.push(rule(140));

for (const r of bookResults) {
  if (!r.parsed) {
    failures += 1;
    lines.push(`${pad(shortBook(r.book), 12)}${pad("(the drive did not finish)", 26)}${pad("!", 6)}${pad("-", 7)}exit ${r.run.code}: ${(r.run.stderr || r.run.stdout).trim().slice(-300)}`);
    continue;
  }
  const name = r.parsed.book?.name ?? r.book;
  const scenarios = r.parsed.scenarios ?? {};
  for (const [scenario, s] of Object.entries(scenarios)) {
    const errs = s.pageErrors ?? [];
    const found = [...(s.findings ?? []), ...errs.map((e) => `page error: ${e}`)];
    const pending = s.pendingFindings ?? [];
    if (found.length) failures += 1;
    if (pending.length) pendingCount += 1;
    /* A retried row never adds a second findings-driven failure count on top of `found.length`
       above: `found` already reflects the RETRY's own outcome, since retryHarnessScenarios
       replaced `s.findings` in place. This just says so, in both the row and the summary. */
    if (s.retried) retriedCount += 1;
    const retryNote = s.retried ? `retried once, then ${s.retryOutcome}` : "";
    const tail = found.length
      ? s.retried ? `retried once, then failed: ${found.join(" | ")}` : found.join(" | ")
      : [retryNote, s.path || "", pending.length ? `(pending ${s.pending}: ${pending.length})` : ""].filter(Boolean).join("  ");
    lines.push(`${pad(shortBook(name), 12)}${pad(scenario, 26)}${pad(found.length || ".", 6)}${pad((s.turns ?? []).length, 7)}${tail}`);
  }
}

lines.push(rule(140));
for (const s of spreadResults) {
  if (s.findings.length) failures += 1;
  lines.push(`${pad(shortBook(SPREAD_BOOK), 12)}${pad(`spread ${s.kind}`, 26)}${pad(s.findings.length || ".", 6)}${pad(s.state, 10)}${s.findings.join(" | ")}`);
}
lines.push(rule(140));
lines.push(
  `${failures ? "FAIL" : "PASS"}  ${failures} row${failures === 1 ? "" : "s"} with findings, ` +
    `${pendingCount} pending, ${retriedCount} row${retriedCount === 1 ? "" : "s"} retried once, ` +
    `${BOOKS.length} books, ${SPREAD_KINDS.length} spread files, ` +
    `${Math.round((Date.now() - started) / 1000)}s. Detail: ${OUTDIR}`,
);
lines.push("");
console.log(lines.join("\n"));
process.exit(failures ? 1 : 0);
