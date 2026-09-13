/* THE DRIVE GATE (backlog row 51, founder 2026-09-13: "it is not only Hartwell, it needs to work
   everywhere").

   ONE COMMAND, THE WHOLE MATRIX. Every workroom scenario on THREE books, plus the spread drive's
   three file kinds, in one table with one exit code.

     cd app && npm run gate:drives            # the whole matrix against app/dist/cockpit.html
     node design/probes/gate.mjs --books Hartwell,Kingsley
     node design/probes/gate.mjs --scenario relayDrop
     node design/probes/gate.mjs --bundle app/dist/cockpit.html --serial

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
   time for a box that cannot hold three Chromiums. */
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

/* ------------------------------------------------------------------- the workroom matrix */

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
    if (!json.panel?.hasProvisional) findings.push("the room panel does not mark the period provisional");
    if (!json.financialsTab?.hasProvisional) findings.push("the Financials tab does not mark the period provisional");
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
    const tail = found.length
      ? found.join(" | ")
      : [s.path || "", pending.length ? `(pending ${s.pending}: ${pending.length})` : ""].filter(Boolean).join("  ");
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
    `${pendingCount} pending, ${BOOKS.length} books, ${SPREAD_KINDS.length} spread files, ` +
    `${Math.round((Date.now() - started) / 1000)}s. Detail: ${OUTDIR}`,
);
lines.push("");
console.log(lines.join("\n"));
process.exit(failures ? 1 : 0);
