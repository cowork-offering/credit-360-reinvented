#!/usr/bin/env node
// ASSEMBLE the Credit 360 cockpit artifact — v2 (Cockpit v3 rebuild, SPEC.md §9 + §12 v1.1 amendments).
//
// The agent composes C360_DATA (portfolio + anchor borrower + the staged `borrowers` book +
// `worklist`) and writes it to a small JSON file. This script bakes that JSON into the cockpit
// bundle's data slot and writes the finished HTML. The agent then publishes the HTML file BY PATH.
//
//   node assemble-cockpit.mjs --data <c360-data.json> --out <out.html> [--template <path>]
//     [--legacy] [--allow-partial] [--no-approver] [--UNSAFE-no-validate-for-tests]
//
// Codex round 2 finding 1 (BLOCK): the validation stage is mandatory for any real release (SPEC
// A5) — there is no production flag to skip it. The only escape hatch is
// --UNSAFE-no-validate-for-tests, which additionally refuses to run unless --out resolves under
// /tmp, so it can never be used to ship a real (un-challenged, no data-quality sweep) artifact.
//
// -------------------------------------------------------------------------------------------
// Injection (A3 — inert data slot; marker-based, exactly-once assertion per A2):
//
//   Primary (v2)  — the bundle must contain this literal marker EXACTLY ONCE:
//                     <script id="c360-data" type="application/json">/*__C360_DATA__*/</script>
//                   A small static bootstrap in the built app parses its textContent into
//                   window.C360_DATA at startup. The slot is INERT — never executed as JS.
//
//   Legacy        — ONLY reached when --legacy is passed (a deliberate mode switch: with --legacy
//                   the v2 marker is not even examined). Falls back to the CURRENT hand-maintained
//                   template's existing anchor (unchanged, still in the repo today):
//                     <script id="c360-data" type="application/json">{{C360_DATA_JSON}}</script>
//                   Also inert JSON; the template's readData() does el.textContent -> JSON.parse.
//                   NOTE ON WORDING: an earlier revision of this brief described --legacy as "the
//                   old executable-assignment path" (a window.C360_DATA = {...} JS statement, no
//                   type attribute). That shape does not exist anywhere in this repo — the actual
//                   current template (client-360/assets/customer-360-template.html, out of this agent's
//                   edit scope) uses the inert {{C360_DATA_JSON}} anchor above. --legacy targets
//                   that real, on-disk anchor, since that's the one the QA gate exercises.
//
//   Both paths inject the SAME escaped JSON text into the SAME wrapper shape
//   (<script id="c360-data" type="application/json">...</script>) — they differ only in which
//   literal placeholder string is being replaced.
//
// A2: marker count is asserted to be exactly one. 0 or >1 occurrences of the marker being checked
// is a hard error (die, exit 1) — for the v2 marker unless --legacy is passed (which skips
// straight to the legacy marker instead, still requiring exactly one legacy occurrence).
//
// Safe JSON embedding (A3): JSON.stringify, then escape the two chars of "</" so "</script>" can
// never prematurely close the tag inside HTML, plus the two characters that are valid inside a
// JSON string but illegal unescaped inside a bare JS string/template literal, U+2028 and U+2029
// (kept escaped in both paths for defense in depth / a single shared embedding function). All of
// these are plain \uXXXX escapes, decoded natively by JSON.parse — nothing downstream unescapes
// them.
//
// A8: referential integrity by construction — the assembler DERIVES top-level `borrower` from
// `borrowers[meta.anchorAccountId]` (see render/contract-checks.mjs deriveAnchorBorrower).
//
// A4: measures output bytes BEFORE writing and fails closed over an 8 MiB budget (conservative
// vs the ~16 MiB host cap for Cowork artifacts) — an oversized artifact never touches disk.
// Reports code bytes vs data bytes separately. After writing, stats the file to self-verify the
// bytes actually on disk match what was measured (Codex round 2 finding 6).
//
// Boom normalisation (boom-normalise.mjs) runs BEFORE validation, so the covenant challenge and
// the Financials tab read one shape: display fields derived from the raw payloads, raw payloads
// kept under boom.spread.file / boom.ratios.raw.
//
// A5: the validation stage (validateC360, SR 11-7 covenant challenge + data-quality sweep) is
// mandatory and runs before injection, across every bundle in `borrowers` (not just the anchor);
// assertValidationSurfaces() asserts the surfaces actually landed (regression guard). There is no
// production way to skip this — see --UNSAFE-no-validate-for-tests above.
//
// A10 / Codex round 2 finding 3: meta.generatedAt is required and must be a valid ISO-8601
// instant — checked before anything else touches the data (assertGeneratedAt).
//
// meta.userId is required on the same footing (assertUserId): the 005 Salesforce user id of the
// signed-in identity is the only accepted approverUserId on execute_*, so an artifact without it
// can stage a plan and never file it. --no-approver downgrades that gate to a warning for the one
// case that earns it: a session that genuinely cannot read the id (the Customer 360 connector has
// no whoami tool) publishing a cockpit whose execute path is knowingly read-only.
//
// Codex round 3 finding 1: the /tmp gate is symlink-safe — it resolves the REAL path of --out's
// parent directory (after mkdir'ing it if needed, since realpath requires the target to exist)
// and checks that against the REAL path of /tmp (itself possibly a symlink, e.g. macOS
// /tmp -> /private/tmp), then refuses outright if the final target already exists as a symlink.
//
// Codex round 3 finding 5: output is written atomically — to `<out>.tmp-<pid>` in --out's own
// directory, self-verified there, then renameSync'd into place. On ANY failure the temp file is
// removed and --out is never created or left partially written.
//
// No dependencies beyond node built-ins. Node 18+ (Object.hasOwn needs Node 16.9+).
import { readFileSync, writeFileSync, statSync, lstatSync, mkdirSync, realpathSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { validateC360, challengeCount } from "./validate-c360.mjs";
import { normaliseC360Boom } from "./boom-normalise.mjs";
import {
  ContractError,
  assertBorrowersStructure,
  assertGeneratedAt,
  assertUserId,
  assertWorklistReasons,
  assertActivity,
  assertRequests,
  computeCoverage,
  deriveAnchorBorrower,
  assertValidationSurfaces,
} from "./contract-checks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
const flag = (n) => process.argv.includes(n);
const die = (msg) => { console.error(`ERROR: ${msg}`); process.exit(1); };

// ---------------------------------------------------------------- args
const dataPath = arg("--data");
const outPath = arg("--out");
// Default template resolves relative to THIS script (import.meta.url), never cwd.
const templatePath = arg("--template") ?? join(here, "..", "assets", "customer-360-template.html");
const legacyFlag = flag("--legacy");
const allowPartial = flag("--allow-partial");
const noApprover = flag("--no-approver");
const unsafeNoValidate = flag("--UNSAFE-no-validate-for-tests");
if (!dataPath) die("missing --data <path/to/c360-data.json>  (usage: node assemble-cockpit.mjs --data <data.json> --out <out.html> [--template <path>] [--legacy] [--allow-partial] [--no-approver])");
if (!outPath) die("missing --out <path/out.html>  (usage: node assemble-cockpit.mjs --data <data.json> --out <out.html> [--template <path>] [--legacy] [--allow-partial] [--no-approver])");

// Codex round 2 finding 1 + round 3 finding 1: --UNSAFE-no-validate-for-tests may ONLY write
// under /tmp. This is the only thing standing between "test convenience" and "silently shippable
// un-validated artifact", so the check must survive a symlink escape:
//   1. resolve --out to an absolute path (lexical only — does not follow symlinks yet).
//   2. mkdir its parent directory if needed (realpath requires the path to already exist).
//   3. realpathSync the parent directory — this DOES follow symlinks, collapsing any
//      "/tmp/innocent-looking-dir -> /etc" indirection to where it actually points.
//   4. compare that real parent against the REAL path of /tmp (itself may be a symlink, e.g.
//      macOS /tmp -> /private/tmp — resolve both sides the same way or the comparison is bogus).
//   5. lstat the final target itself (not following symlinks) and refuse outright if something is
//      already there as a symlink — never write through a pre-placed symlink, even into /tmp.
if (unsafeNoValidate) {
  const resolvedOut = resolve(outPath);
  const parentDir = dirname(resolvedOut);

  try { mkdirSync(parentDir, { recursive: true }); }
  catch (e) { die(`--UNSAFE-no-validate-for-tests: cannot create --out's parent directory ${parentDir}: ${e.message}`); }

  let realParent, realTmp;
  try { realParent = realpathSync(parentDir); }
  catch (e) { die(`--UNSAFE-no-validate-for-tests: cannot resolve the real path of --out's parent directory ${parentDir}: ${e.message}`); }
  try { realTmp = realpathSync("/tmp"); }
  catch (e) { die(`--UNSAFE-no-validate-for-tests: cannot resolve the real path of /tmp: ${e.message}`); }

  const underRealTmp = realParent === realTmp || realParent.startsWith(`${realTmp}${sep}`);
  if (!underRealTmp) {
    die(`--UNSAFE-no-validate-for-tests requires --out's parent directory to resolve (after following symlinks) under the real path of /tmp — got ${realParent} (real /tmp is ${realTmp}) for --out ${resolvedOut}. This flag exists for test fixtures only and can never be used to ship a real artifact without the SR 11-7 validation stage.`);
  }

  try {
    const st = lstatSync(resolvedOut);
    if (st.isSymbolicLink()) {
      die(`--UNSAFE-no-validate-for-tests: refusing to write to ${resolvedOut} — it already exists as a symlink`);
    }
  } catch (e) {
    if (e.code !== "ENOENT") die(`--UNSAFE-no-validate-for-tests: cannot lstat --out target ${resolvedOut}: ${e.message}`);
    // ENOENT: nothing exists at the target path yet — nothing to refuse.
  }
}

// ---------------------------------------------------------------- read + parse the DATA
let rawData;
try { rawData = readFileSync(dataPath, "utf8"); }
catch (e) { die(`cannot read --data ${dataPath}: ${e.message}`); }

let data;
try { data = JSON.parse(rawData); }
catch (e) { die(`--data ${dataPath} is not valid JSON: ${e.message}`); }

if (!data || typeof data !== "object" || Array.isArray(data)) die("--data must be a JSON object (window.C360_DATA)");
if (!data.meta || !data.meta.anchorAccountId) die("--data.meta.anchorAccountId is required");
if (!data.portfolio || !Array.isArray(data.portfolio.accounts)) die("--data.portfolio.accounts must be an array");

// ---------------------------------------------------------------- contract checks (A6/A7/A8/A10)
// Structural checks are UNCONDITIONAL — never bypassable by --allow-partial. That flag only
// downgrades the staging-coverage gap below, never a shape/integrity violation.
try { assertGeneratedAt(data); }
catch (e) { die(e instanceof ContractError ? e.message : `contract check failed: ${e.message}`); }

// The approver identity. Fail-closed by default; --no-approver is the deliberate read-only publish.
let approverHeld = false;
try { assertUserId(data); }
catch (e) {
  const msg = e instanceof ContractError ? e.message : `contract check failed: ${e.message}`;
  if (!noApprover) die(`${msg}. Read it from the sObject connector's getUserInfo, or pass --no-approver to publish a cockpit whose execute path is read-only and SAY SO to the banker.`);
  approverHeld = true;
  console.error(`WARN: ${msg} (--no-approver: the artifact will stage plans and refuse to file them; tell the banker the execute path is read-only this run)`);
}

try { assertBorrowersStructure(data); }
catch (e) { die(e instanceof ContractError ? e.message : `contract check failed: ${e.message}`); }

// Codex round 3 finding 2: validate worklist.reasons shape before it's ever trusted downstream.
try { assertWorklistReasons(data); }
catch (e) { die(e instanceof ContractError ? e.message : `contract check failed: ${e.message}`); }

// SPEC A30 / A29 round 4: optional per-bundle activity[]/requests[] — validated when present,
// passed through untouched otherwise (see contract-checks.mjs for the shape rules).
try { assertActivity(data); }
catch (e) { die(e instanceof ContractError ? e.message : `contract check failed: ${e.message}`); }
try { assertRequests(data); }
catch (e) { die(e instanceof ContractError ? e.message : `contract check failed: ${e.message}`); }

let coverage;
try { coverage = computeCoverage(data); }
catch (e) { die(e instanceof ContractError ? e.message : `contract check failed: ${e.message}`); }

const { requiredIds, missing, source } = coverage;
if (missing.length) {
  const msg = `staging coverage incomplete — ${missing.length}/${requiredIds.length} account(s) in ${source} have no bundle in --data.borrowers: ${missing.join(", ")}`;
  if (allowPartial) console.error(`WARN: ${msg} (--allow-partial: proceeding with a degraded render — those rows need an agent round-trip instead of switching client-side)`);
  else die(`${msg}. Stage the whole book (SPEC.md §5/§9), or pass --allow-partial for a deliberate single-account render.`);
}
const stagedCount = Object.keys(data.borrowers).length;

// A8 / Codex round 2 finding 5: derive top-level `borrower` UNCONDITIONALLY from
// borrowers[anchorId] so every downstream stage sees ONE object. Any input-supplied top-level
// `borrower` is advisory only and is overwritten here, never diffed (see deriveAnchorBorrower).
data.borrower = deriveAnchorBorrower(data);

// ---------------------------------------------------------------- ONE Boom shape (item 6)
// The Financials tab and the covenant challenge used to read different `boom` shapes, so whichever
// one the agent staged, the other silently rendered nothing. Normalise HERE, once, before either
// sees the data: the display fields are derived from the raw payloads, and the raw boom_get_spread
// `file` / boom_get_ratios `raw` stay underneath for provenance. Idempotent, so re-assembling data
// that is already normalised changes nothing.
normaliseC360Boom(data);

// ---------------------------------------------------------------- deterministic validation stage (A5)
// SR 11-7 effective challenge: recompute covenants from the Boom spread + run the data-quality
// sweep, across every bundle in `borrowers`. Runs AFTER data validation and BEFORE injection so
// the rendered artifact always carries the challenge + dataQuality surfaces. The LLM never
// computes these figures — this is the only source. --UNSAFE-no-validate-for-tests skips it (raw
// passthrough) and is gated to /tmp output paths only (see the args section above).
if (!unsafeNoValidate) {
  try { validateC360(data); }
  catch (e) { die(`validation stage failed: ${e.message}`); }
  try { assertValidationSurfaces(data); }
  catch (e) { die(e instanceof ContractError ? e.message : `validation-surface check failed: ${e.message}`); }
}
const challengeN = unsafeNoValidate ? 0 : challengeCount(data);
const dqN = unsafeNoValidate ? 0 : (Array.isArray(data.dataQuality) ? data.dataQuality.length : 0);

// ---------------------------------------------------------------- read the template
let template;
try { template = readFileSync(templatePath, "utf8"); }
catch (e) { die(`cannot read template ${templatePath}: ${e.message}`); }

// ---------------------------------------------------------------- safe JSON embedding (A3)
function safeEmbedJSON(obj) {
  return JSON.stringify(obj)
    .replace(/<\//g, "<\\/")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const payload = safeEmbedJSON(data);

// ---------------------------------------------------------------- marker-based injection (A2/A3)
const V2_MARKER = '<script id="c360-data" type="application/json">/*__C360_DATA__*/</script>';
const LEGACY_MARKER = '<script id="c360-data" type="application/json">{{C360_DATA_JSON}}</script>';

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function injectAt(haystack, marker, jsonText) {
  const parts = haystack.split(marker); // caller has already asserted exactly one occurrence
  const injected = `<script id="c360-data" type="application/json">${jsonText}</script>`;
  return parts[0] + injected + parts[1];
}

let output;
let mode;

if (legacyFlag) {
  const legacyOccurrences = countOccurrences(template, LEGACY_MARKER);
  if (legacyOccurrences !== 1) {
    die(`--legacy was passed but the legacy marker was not found exactly once (found ${legacyOccurrences}). Expected literal: ${LEGACY_MARKER}`);
  }
  if (payload.indexOf("{{C360_DATA_JSON}}") !== -1) die("the composed C360_DATA contains the literal {{C360_DATA_JSON}} — remove it; it would defeat the template's readData() unrendered-placeholder guard");
  mode = "legacy";
  output = injectAt(template, LEGACY_MARKER, payload);
} else {
  const v2Occurrences = countOccurrences(template, V2_MARKER);
  if (v2Occurrences !== 1) {
    die(`template must contain the v2 data-slot marker EXACTLY once; found ${v2Occurrences} occurrence(s). Expected literal: ${V2_MARKER}  (pass --legacy to fall back to the current hand-maintained template's anchor instead)`);
  }
  if (payload.indexOf("__C360_DATA__") !== -1) die("the composed C360_DATA contains the literal __C360_DATA__ — remove it; it would be ambiguous with the unrendered marker comment");
  mode = "v2";
  output = injectAt(template, V2_MARKER, payload);
}

// ---------------------------------------------------------------- A4: assembled-size gate (BEFORE write)
// Codex round 2 finding 6: measure and enforce the budget before anything touches disk — an
// oversized artifact must never land in --out, not even transiently.
const MAX_BYTES = 8 * 1024 * 1024; // 8 MiB, conservative vs the ~16 MiB Cowork artifact host cap
const totalBytes = Buffer.byteLength(output);
const dataBytes = Buffer.byteLength(payload);
const codeBytes = totalBytes - dataBytes;
if (totalBytes > MAX_BYTES) {
  die(`assembled output is ${totalBytes.toLocaleString()} bytes (code ${codeBytes.toLocaleString()} + data ${dataBytes.toLocaleString()}), which exceeds the ${MAX_BYTES.toLocaleString()}-byte (8 MiB) budget — nothing was written`);
}

// ---------------------------------------------------------------- atomic write (Codex round 3 finding 5)
// Write to a temp file IN --out's OWN DIRECTORY (so the final renameSync is same-filesystem and
// therefore atomic), self-verify against the temp file, and only renameSync into place once every
// check has passed. On ANY failure below, the temp file is removed first — --out must never be
// created and no stray temp file may survive a failed run.
const tmpPath = `${outPath}.tmp-${process.pid}`;
const cleanupTmp = () => { try { unlinkSync(tmpPath); } catch { /* best-effort; ENOENT is fine */ } };
const dieCleanup = (msg) => { cleanupTmp(); die(msg); };

try { writeFileSync(tmpPath, output); }
catch (e) { dieCleanup(`cannot write temp file ${tmpPath}: ${e.message}`); }

// self-verify the bytes actually on disk match what was measured pre-write (Codex round 2 finding 6).
let onDiskBytes;
try { onDiskBytes = statSync(tmpPath).size; }
catch (e) { dieCleanup(`self-verify: cannot stat temp file ${tmpPath} after writing: ${e.message}`); }
if (onDiskBytes !== totalBytes) {
  dieCleanup(`self-verify: on-disk temp-file size (${onDiskBytes.toLocaleString()} bytes) does not match the measured pre-write size (${totalBytes.toLocaleString()} bytes) — write may have been truncated or transformed`);
}

// ---------------------------------------------------------------- self-verify the temp file's content
const written = readFileSync(tmpPath, "utf8");

const slotMatch = written.match(/<script id="c360-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!slotMatch) dieCleanup("self-verify: could not locate the c360-data JSON slot in the output");
let recovered;
try { recovered = JSON.parse(slotMatch[1]); }
catch (e) { dieCleanup(`self-verify: injected JSON slot does not parse: ${e.message}`); }
if (JSON.stringify(recovered) !== JSON.stringify(data)) dieCleanup("self-verify: recovered data does not deep-equal the source data (embedding is lossy)");

if (mode === "legacy" && written.indexOf("indexOf('{{C360_DATA_JSON}}')") === -1) {
  console.error("WARN: self-verify: the legacy readData() literal indexOf('{{C360_DATA_JSON}}') was not found in the output — if this template intentionally reads data differently, ignore; otherwise injection may have corrupted the engine script.");
}

// every JS <script> block must be syntactically valid; every application/json block must parse.
// Scan a comment-stripped copy so a <script ...> mentioned inside an HTML comment (template header
// docs referencing the data slot) is not mistaken for a real script tag.
const scanned = written.replace(/<!--[\s\S]*?-->/g, "");
const scriptRe = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let m, blockNo = 0;
while ((m = scriptRe.exec(scanned)) !== null) {
  blockNo++;
  const openAttrs = m[1] || "";
  const scriptBody = m[2] || "";
  if (/application\/json/.test(openAttrs)) {
    try { JSON.parse(scriptBody); }
    catch (e) { dieCleanup(`self-verify: <script${openAttrs}> (block ${blockNo}) is not valid JSON: ${e.message}`); }
  } else {
    try { new vm.Script(scriptBody, { filename: `cockpit-script-block-${blockNo}.js` }); }
    catch (e) { dieCleanup(`self-verify: engine <script> block ${blockNo} has a syntax error: ${e.message}`); }
  }
}

// every check passed — atomically move the verified temp file into place.
try { renameSync(tmpPath, outPath); }
catch (e) { dieCleanup(`cannot rename temp file into place at --out ${outPath}: ${e.message}`); }

// ---------------------------------------------------------------- success
const validateSummary = unsafeNoValidate ? " · validation SKIPPED (UNSAFE, /tmp-only)" : ` · challenge ${challengeN} covenants · DQ ${dqN} findings`;
// Both states ride the same slot: they are what the reply to the banker has to say out loud.
const partialFlag =
  (missing.length ? ` · PARTIAL (${missing.length} unstaged)` : "") +
  (approverHeld ? " · NO APPROVER (execute path read-only)" : "");
console.log(`OK — wrote ${outPath} (${totalBytes.toLocaleString()} bytes: code ${codeBytes.toLocaleString()} + data ${dataBytes.toLocaleString()}) · mode=${mode} · anchor=${data.meta.anchorAccountId} · accounts staged ${stagedCount}/${requiredIds.length}${partialFlag}${validateSummary}`);
