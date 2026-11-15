#!/usr/bin/env node
// Release gate: every Customer 360 tool name mentioned in the plugin's agent and skill prose must
// exist in the org's McpServerDefinition manifest.
//
// The prose is what a banker's session runs on. A tool name that drifted, was renamed in the org, or
// was typed from memory produces a call that fails at the connector with nothing useful to say. This
// diffs the prose against the manifest so the drift is caught at release time instead.
//
// Run directly for a readable report:   node client-360/render/tool-names.mjs
// Run as a test:                        node --test client-360/render/tool-names.test.mjs
//
// Requires the repo checkout: the manifest lives outside the shipped plugin folder.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = join(HERE, "..");
export const REPO_ROOT = join(PLUGIN_ROOT, "..");
export const MANIFEST_PATH = join(
  REPO_ROOT,
  "knowledge/sf-build-v2/wp2/mcpServerDefinitions/Customer360.mcpServerDefinition-meta.xml"
);

export class ToolNameError extends Error {}

/**
 * The Customer 360 tool-name shape, and only that shape. Three families:
 *   - a read tool, `Customer360` immediately followed by more of the class name;
 *   - a write tool, `stage_` or `execute_` followed by lowercase snake_case;
 *   - a second-hop completion tool, `complete_` followed by lowercase snake_case. Today that is
 *     `complete_new_facility_detail` alone: nCino creates the Loan Detail from an after-commit flow
 *     of its own, so the field it carries cannot be set in the transaction that files the facility.
 *     Without this alternative the name is invisible to the scanner, and a tool the org ships reads
 *     as "declared but never mentioned" however carefully the prose names it.
 * Deliberately narrow. Plan step ids (`held_execution`, `write_assessment_0`), org field names
 * (`LLC_BI__Status__c`) and host tools (`create_artifact`) do not match, and must not: this gate
 * checks names that MUST be manifest tools, not every identifier in the prose.
 */
const TOOL_TOKEN = /\b(?:Customer360[A-Za-z0-9]+|(?:stage|execute|complete)_[a-z0-9]+(?:_[a-z0-9]+)*)\b/g;

/**
 * Names the prose deliberately mentions in order to say they do NOT exist. `stage_renewal` ships
 * without an execute partner: a renewal auto-creates an Opportunity, is effectively irreversible,
 * and the clone field set has not been re-probed. The prose has to be able to name the tool it is
 * refusing to reach for.
 *
 * These are asserted ABSENT from the manifest, not merely skipped. If the org ever ships one, this
 * gate fails and the prose that promises it does not exist gets corrected.
 */
export const ASSERTED_ABSENT = ["execute_renewal"];

/**
 * Words that share the tool-name shape but name something else, so the scan skips them.
 * `stage_advance` is an Experience / nCino AUDIT EVENT TYPE that `ncino_advance_stage` self-logs
 * (vendored memo skill finalize-and-writeback), not a Customer 360 tool.
 */
export const NOT_TOOLS = ["stage_advance"];

/** Tool names the org's manifest declares, in the order it spells them. */
export function manifestToolNames(manifestPath = MANIFEST_PATH) {
  let xml;
  try {
    xml = readFileSync(manifestPath, "utf8");
  } catch {
    throw new ToolNameError(
      `McpServerDefinition manifest not found at ${manifestPath}. ` +
        `This check runs from the repo checkout, not from an installed plugin.`
    );
  }
  const names = [...xml.matchAll(/<toolName>([^<]+)<\/toolName>/g)].map((m) => m[1].trim());
  if (names.length === 0) {
    throw new ToolNameError(`No <toolName> elements found in ${manifestPath}.`);
  }
  return names;
}

/** Every prose file the natural-chat layer ships: the agents and the skills. */
export function proseFiles(pluginRoot = PLUGIN_ROOT) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".md")) found.push(full);
    }
  };
  walk(join(pluginRoot, "agents"));
  walk(join(pluginRoot, "skills"));
  return found;
}

/**
 * Diff the prose against the manifest.
 * @returns {{ unknown: Array<{file: string, token: string, line: number}>, wronglyShipped: string[],
 *             unmentioned: string[], mentioned: string[], files: string[] }}
 */
export function checkToolNames({ pluginRoot = PLUGIN_ROOT, manifestPath = MANIFEST_PATH } = {}) {
  const manifest = new Set(manifestToolNames(manifestPath));
  const files = proseFiles(pluginRoot);
  const unknown = [];
  const mentioned = new Set();

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      for (const match of text.matchAll(TOOL_TOKEN)) {
        const token = match[0];
        if (manifest.has(token)) mentioned.add(token);
        else if (ASSERTED_ABSENT.includes(token) || NOT_TOOLS.includes(token)) continue;
        else unknown.push({ file: relative(pluginRoot, file), token, line: i + 1 });
      }
    });
  }

  return {
    unknown,
    wronglyShipped: ASSERTED_ABSENT.filter((t) => manifest.has(t)),
    unmentioned: [...manifest].filter((t) => !mentioned.has(t)),
    mentioned: [...mentioned],
    files: files.map((f) => relative(pluginRoot, f)),
  };
}

function report() {
  const { unknown, wronglyShipped, unmentioned, mentioned, files } = checkToolNames();
  const manifest = manifestToolNames();

  console.log(`manifest: ${manifest.length} tools · prose: ${files.length} files`);
  console.log(`mentioned and declared: ${mentioned.length}`);
  console.log(`asserted absent: ${ASSERTED_ABSENT.join(", ")}`);

  if (unmentioned.length) {
    // Informational only. A declared tool the prose never names is a coverage gap, not a defect.
    console.log(`declared but never mentioned (${unmentioned.length}): ${unmentioned.join(", ")}`);
  }

  let failed = false;
  if (unknown.length) {
    console.error(`\nFAIL: ${unknown.length} tool name(s) in prose are not in the manifest:`);
    for (const { file, line, token } of unknown) console.error(`  ${file}:${line}  ${token}`);
    failed = true;
  }
  if (wronglyShipped.length) {
    console.error(
      `\nFAIL: the org now ships ${wronglyShipped.join(", ")}, which the prose promises does not ` +
        `exist. Correct the prose and drop the name from ASSERTED_ABSENT.`
    );
    failed = true;
  }
  if (failed) {
    process.exitCode = 1;
    return;
  }
  console.log("\nOK: every tool name in the prose exists in the org manifest.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) report();
