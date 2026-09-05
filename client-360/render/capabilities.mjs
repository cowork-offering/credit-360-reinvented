#!/usr/bin/env node
// Generate the artifact CAPABILITIES MANIFEST from source, and gate it against drift.
//
// The cockpit is a compiled page that calls the viewer's connectors through the `mcp` capability.
// A publish that omits `capabilities` on a first publish (or restates it short) ships a page with
// no connector grant: `claude.use("mcp")` resolves null, the room paints its offline chip, the
// intent lane never subscribes, and every governed action is refused before it reaches the org.
// The declaration therefore has to be derived, never typed from memory.
//
//   Customer 360         <- the org's own McpServerDefinition, via tool-names.mjs (org order, all of them)
//   Salesforce Read Backup <- the same manifest's ten reads, gw_-prefixed, plus the backup's own health tool
//   IDB Gateway       <- app/src/channel/mcp.ts TOOLS.boomRatios / boomSpread / llm
//   Microsoft 365     <- app/src/channel/mcp.ts TOOLS.mailSearch
//   Experience / nCino <- app/src/channel/mcp.ts, the memo writeback and ledger tools
//   AFS               <- app/src/channel/mcp.ts, the servicing reads and create_workpackage
//
// plus `sample` (the room's own Ask lane) and `db` (the intent store, and what makes the published
// page organization-internal).
//
// Write the committed copy:   node client-360/render/capabilities.mjs
// Gate it (exit 1 on drift):  node client-360/render/capabilities.mjs --check
// Run as a test:              node --test client-360/render/capabilities.test.mjs
//
// Requires the repo checkout: both sources live outside the shipped plugin folder.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { manifestToolNames, PLUGIN_ROOT, REPO_ROOT, MANIFEST_PATH } from "./tool-names.mjs";

export class CapabilitiesError extends Error {}

/** The generated file the skill reads and passes verbatim as the `capabilities` input. */
export const CAPABILITIES_PATH = join(PLUGIN_ROOT, "assets", "capabilities.json");

/** The page's own tool-name constants: the second source, for the two non-Salesforce servers. */
export const CHANNEL_PATH = join(REPO_ROOT, "app", "src", "channel", "mcp.ts");

/** Connector DISPLAY NAMES. Viewers resolve a connector by name; an id is never valid here. */
export const SERVERS = {
  customer360: "Customer 360",
  readBackup: "Salesforce Read Backup",
  gateway: "IDB Gateway",
  m365: "Microsoft 365",
  experience: "Experience / nCino",
  afs: "AFS",
};

/**
 * The relay-independent read lane: the ten Customer 360 reads with a `gw_` prefix, plus the
 * backup's own health tool. DERIVED FROM THE CUSTOMER 360 GRANT so the two lanes cannot drift
 * apart: a read the org gains is mirrored here on the next regeneration, and a hand-typed
 * second list would be a second thing to keep true.
 *
 * A page published without this server in `capabilities` gets `not_in_manifest` on the first
 * fallback call, which is exactly the failure the fallback exists to avoid.
 */
export const READ_BACKUP_TOOLS = (manifestPath) =>
  manifestToolNames(manifestPath)
    .filter((n) => n.startsWith("Customer360"))
    .map((n) => `gw_${n}`)
    .concat("gw_health");

/** `TOOLS` keys in app/src/channel/mcp.ts, by the server that answers them. */
const GATEWAY_KEYS = ["boomRatios", "boomSpread", "llm"];
const M365_KEYS = ["mailSearch"];
/** The memo room's writeback, in the order the publish sequence fires them,
 *  then the two the room reads from. */
const EXPERIENCE_KEYS = [
  "syncMemoSections",
  "publishCreditMemo",
  "finalizeCreditMemo",
  "submitForApproval",
  "ncinoNotify",
  "recordDecision",
  "logAuditEvent",
  "recallDecisions",
  "covenantGrade",
];
/** Servicing: three reads and the workpackage the publish stages at the end. */
const AFS_KEYS = ["afsLoanSummary", "afsPaymentHistory", "afsRevolverUtilization", "afsCreateWorkpackage"];

/**
 * Read the named `TOOLS` entries out of the page's own channel module. Regex rather than a TS
 * parse, so this stays dependency-free: the TOOLS object literal is sliced out first, comments are
 * stripped, and only `key: "value",` lines anchored to their own line are read. A key that is not
 * found throws rather than quietly dropping a tool out of the grant.
 */
export function channelToolNames(keys, channelPath = CHANNEL_PATH) {
  let source;
  try {
    source = readFileSync(channelPath, "utf8");
  } catch {
    throw new CapabilitiesError(
      `channel module not found at ${channelPath}. ` +
        `This generator runs from the repo checkout, not from an installed plugin.`
    );
  }
  const start = source.indexOf("export const TOOLS = {");
  if (start === -1) throw new CapabilitiesError(`no "export const TOOLS = {" block in ${channelPath}`);
  const end = source.indexOf("} as const;", start);
  if (end === -1) throw new CapabilitiesError(`the TOOLS block in ${channelPath} is not closed with "} as const;"`);

  const body = source
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  const found = new Map();
  for (const m of body.matchAll(/^\s*([A-Za-z0-9_]+):\s*"([^"]+)",?\s*$/gm)) found.set(m[1], m[2]);

  return keys.map((key) => {
    const name = found.get(key);
    if (!name) throw new CapabilitiesError(`TOOLS.${key} is not declared in ${channelPath}`);
    return name;
  });
}

/**
 * The whole declaration, exactly as it must be passed to the Artifact tool.
 *
 * The Customer 360 grant is the org manifest ENTIRE, in the org's own order. Trimming it to the
 * call paths the current bundle happens to reach is how the grant went short before: the guided
 * skills route writes the cockpit itself never calls, and a tool outside the manifest is refused
 * `not_in_manifest` at the moment a banker confirms a plan.
 */
export function buildCapabilities({ manifestPath = MANIFEST_PATH, channelPath = CHANNEL_PATH } = {}) {
  return {
    mcp: {
      servers: [
        { server: SERVERS.customer360, tools: manifestToolNames(manifestPath) },
        { server: SERVERS.readBackup, tools: READ_BACKUP_TOOLS(manifestPath) },
        { server: SERVERS.gateway, tools: channelToolNames(GATEWAY_KEYS, channelPath) },
        { server: SERVERS.m365, tools: channelToolNames(M365_KEYS, channelPath) },
        { server: SERVERS.experience, tools: channelToolNames(EXPERIENCE_KEYS, channelPath) },
        { server: SERVERS.afs, tools: channelToolNames(AFS_KEYS, channelPath) },
      ],
    },
    sample: {},
    db: {},
  };
}

/** The committed file's exact bytes, so the gate compares text and not just parsed shape. */
export function serialize(capabilities) {
  return `${JSON.stringify(capabilities, null, 2)}\n`;
}

/**
 * Diff the committed JSON against what the sources say it should be.
 * @returns {{ drifted: boolean, reason: string|null, expected: string, actual: string|null }}
 */
export function checkCapabilities(options = {}) {
  const { capabilitiesPath = CAPABILITIES_PATH, ...sources } = options;
  const expected = serialize(buildCapabilities(sources));
  let actual = null;
  try {
    actual = readFileSync(capabilitiesPath, "utf8");
  } catch {
    return { drifted: true, reason: `${capabilitiesPath} does not exist`, expected, actual };
  }
  if (actual !== expected) {
    return { drifted: true, reason: `${capabilitiesPath} is out of step with its sources`, expected, actual };
  }
  return { drifted: false, reason: null, expected, actual };
}

function counts(capabilities) {
  return capabilities.mcp.servers.map((s) => `${s.server} ${s.tools.length}`).join(" · ");
}

function main() {
  const check = process.argv.includes("--check");
  const capabilities = buildCapabilities();

  if (check) {
    const { drifted, reason } = checkCapabilities();
    if (drifted) {
      console.error(`FAIL: ${reason}. Run: node client-360/render/capabilities.mjs`);
      process.exitCode = 1;
      return;
    }
    console.log(`OK: capabilities.json is in step with its sources (${counts(capabilities)})`);
    return;
  }

  writeFileSync(CAPABILITIES_PATH, serialize(capabilities));
  console.log(`wrote ${CAPABILITIES_PATH}: ${counts(capabilities)}, plus sample and db`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
