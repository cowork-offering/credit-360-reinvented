#!/usr/bin/env node
/* =============================================================================
   VENDORED MEMO AGENTS — DRIFT CHECK

   client-360/ carries the credit-memo plugin's two agent personas and the four
   skills they invoke (see client-360/VENDORED-MEMO-AGENTS.md). Nobody edits
   them by hand. This is the sibling of app/scripts/memo-vendor-check.mjs, which
   guards the vendored renderer CODE; this one guards the vendored PROMPTS.

     1. every vendored file is hashed against
        client-360/vendored-agents-manifest.json (missing, changed and extra all
        fail),
     2. the AFS gate: the vendored copy must contain ZERO case-insensitive
        matches for the Truist-specific name that AFS replaced. That rename is
        the one deliberate divergence from upstream, so it is enforced, not
        trusted.

   Run:  node scripts/memo-agents-vendor-check.mjs           verify (exit 1 on drift)
         node scripts/memo-agents-vendor-check.mjs --write   re-record after a refresh

   `--write` is for ONE case: the vendored copy was refreshed from a newer
   upstream plugin version, the rename was re-applied, and
   VENDORED-MEMO-AGENTS.md was updated to name that version.
   ============================================================================= */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, "..", "client-360");
const MANIFEST = join(PLUGIN, "vendored-agents-manifest.json");

/** Vendored trees, plus the individually vendored plugin-root assets. */
const TREES = [
  "agents/credit-memo.md",
  "agents/credit-reviewer.md",
  "skills/commercial-credit-memo",
  "skills/credit-review",
  "skills/finalize-and-writeback",
  "skills/sr-11-7-model-risk",
  // plugin-root assets the memo fast path reads (assets/ also holds cockpit
  // files that are OURS, so this list is explicit rather than a directory walk)
  "assets/ncino-demo-data.json",
  "assets/piedmont-narratives.json",
  "assets/boom-spread.json",
  "assets/boom-ratios.json",
  "assets/ic_placeholder.json",
  "assets/peers_placeholder.json",
  "assets/brand-tokens.css",
  "assets/brand-notes.md",
  "assets/brand-mark.svg",
  "assets/brand-horizontal.svg",
  "assets/accenture-logo.svg",
];

/** The banned name. Split so this file is not itself a match for its own gate. */
const BANNED = ["IR", "IS"].join("") + "";
const MANIFEST_README =
  "sha256 of every file vendored from the credit-memo plugin into this one (the two agent personas, " +
  "the four skills they invoke, and the plugin-root assets the memo fast path reads). Recorded so " +
  "upstream drift is detected rather than discovered. Verified by scripts/memo-agents-vendor-check.mjs. " +
  "Regenerate with --write ONLY when refreshing from a newer upstream version named in " +
  "client-360/VENDORED-MEMO-AGENTS.md.";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function walk(abs) {
  if (!statSync(abs).isDirectory()) return [abs];
  return readdirSync(abs)
    .sort()
    .flatMap((name) => walk(join(abs, name)));
}

export function hashVendoredTree() {
  return Object.fromEntries(
    TREES.flatMap((rel) => walk(join(PLUGIN, rel))).map((abs) => [
      relative(PLUGIN, abs).split(sep).join("/"),
      sha256(readFileSync(abs)),
    ]),
  );
}

/** Files still carrying the renamed-away system name. Empty array = gate passes. */
export function renameGate() {
  const re = new RegExp(BANNED, "i");
  return TREES.flatMap((rel) => walk(join(PLUGIN, rel)))
    .filter((abs) => re.test(readFileSync(abs, "utf8")))
    .map((abs) => relative(PLUGIN, abs).split(sep).join("/"));
}

/** Recorded-vs-actual plus the rename gate. Empty array = clean. */
export function vendoredAgentsDrift() {
  const actual = hashVendoredTree();
  const recorded = JSON.parse(readFileSync(MANIFEST, "utf8")).files;
  const problems = [];
  for (const [path, hash] of Object.entries(recorded)) {
    if (!(path in actual)) problems.push(`MISSING  ${path}`);
    else if (actual[path] !== hash) problems.push(`CHANGED  ${path}`);
  }
  for (const path of Object.keys(actual)) if (!(path in recorded)) problems.push(`EXTRA    ${path}`);
  for (const path of renameGate()) problems.push(`NOT RENAMED  ${path} still names the replaced rating source`);
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--write")) {
    const bad = renameGate();
    if (bad.length) {
      console.error("refusing to record: the rename gate fails for:");
      for (const p of bad) console.error(`  ${p}`);
      process.exit(1);
    }
    const files = hashVendoredTree();
    writeFileSync(MANIFEST, JSON.stringify({ _README: MANIFEST_README, files }, null, 2) + "\n");
    console.log(`recorded ${Object.keys(files).length} vendored agent/skill/asset files`);
  } else {
    const problems = vendoredAgentsDrift();
    if (problems.length) {
      console.error(`vendored memo-agent drift (${problems.length}):`);
      for (const p of problems) console.error(`  ${p}`);
      console.error(
        "\nThese files are the credit-memo plugin's, not ours. If this is an intentional refresh from a " +
          "newer upstream version, update client-360/VENDORED-MEMO-AGENTS.md and re-run with --write.",
      );
      process.exit(1);
    }
    console.log(
      `vendored memo agents clean: ${Object.keys(hashVendoredTree()).length} files, rename gate passes`,
    );
  }
}
