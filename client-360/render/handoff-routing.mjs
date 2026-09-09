#!/usr/bin/env node
// Generate the HANDOFF ROUTING block that the agent file and the cockpit skill both carry, and gate
// it against drift.
//
// A banker mentioned a new collateral in the main chat and the session banged on a modification
// directly: it staged a governed write out of the conversation while the banker's cockpit sat open
// beside it, holding nothing. The rule since (founder, 2026-09-03) is that anything actionable a
// banker says in chat is handed GENTLY into the room that owns it, as an intent, and the room stages
// it where the banker can watch it happen.
//
// That rule is only worth the table that says WHICH room and WHICH route, and the table has to read
// identically in the agent's prose and in the cockpit skill's prose. Two hand-maintained copies is
// one copy too many: the permitted-value lists drifted exactly that way before (see
// skill-blocks.mjs), so both copies are GENERATED from here, between markers, and the same
// comparison runs as a release gate.
//
// Write the blocks:            node client-360/render/handoff-routing.mjs
// Gate them (exit 1 on drift): node client-360/render/handoff-routing.mjs --check
// Run as a test:               node --test client-360/render/handoff-routing.test.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_ROOT, REPO_ROOT } from "./tool-names.mjs";

export class HandoffRoutingError extends Error {}

export const BLOCK_NAME = "handoff-routing";

/** The two prose files that must carry an identical routing table. */
export const TARGET_PATHS = [
  join(PLUGIN_ROOT, "agents", "credit-360.md"),
  join(PLUGIN_ROOT, "skills", "credit-360-cockpit", "SKILL.md"),
];

/** The page's own route contract, for the cross-check below. Outside the shipped plugin folder. */
export const CONTRACT_PATH = join(REPO_ROOT, "app", "src", "intent", "contract.ts");

/** Which routes each room binds. The page refuses a route that does not belong to its room. */
export const ROOM_ROUTES = {
  facility: ["modify", "renew", "create"],
  relationship: ["annual", "covenant", "valuation", "rating", "service", "intake"],
};

/**
 * One row per route, in the order a banker meets them. `ask` describes what the banker's ask
 * CHANGES, because that is the only reliable discriminator: the same word, collateral, routes two
 * different ways depending on whether it is pledged to a facility.
 */
export const ROUTING_ROWS = [
  {
    room: "facility",
    route: "modify",
    ask:
      "A facility that already exists changes: amount, rate, maturity, term, a fee, a party on the loan, " +
      "a covenant on the loan, or collateral pledged to it, whether the collateral is new or already " +
      "held. A pledge to a facility rightly versions the package, and that is a modification, not a mistake.",
  },
  { room: "facility", route: "renew", ask: "An existing facility is renewed." },
  {
    room: "facility",
    route: "create",
    ask:
      "A facility that does not exist yet is structured, on a new package unless an unapproved package " +
      "is chosen. It rides inside a `modify` document instead when other changes travel with it.",
  },
  {
    room: "relationship",
    route: "intake",
    ask:
      "A collateral ASSET is registered with nothing pledged, a new party joins the relationship, or a " +
      "covenant is written at relationship level.",
  },
  { room: "relationship", route: "valuation", ask: "Collateral that is already pledged is valued." },
  { room: "relationship", route: "covenant", ask: "Covenants are assessed against the evidence." },
  { room: "relationship", route: "annual", ask: "An annual or ad-hoc credit review is opened." },
  { room: "relationship", route: "rating", ask: "A risk rating is reviewed." },
  { room: "relationship", route: "service", ask: "A servicing ask is raised." },
];

/** Two per room. The first of each pair is the case the doctrine exists for. */
export const EXAMPLES = [
  {
    room: "facility",
    route: "modify",
    said:
      "James attached an appraisal for the Kokomo plant expansion, $6.5M, real estate; he wants it as " +
      "security on the construction loan",
    line: "pledge new collateral on the construction loan: Kokomo plant expansion, real estate, valued at 6,500,000",
  },
  {
    room: "facility",
    route: "renew",
    said: "March is coming and the 15M line needs to roll",
    line: "renew the 15M line of credit",
  },
  {
    room: "relationship",
    route: "intake",
    said: "register the Kokomo plant as an asset of the relationship, nothing pledged yet",
    line: "add collateral: Kokomo plant expansion, real estate",
  },
  {
    room: "relationship",
    route: "valuation",
    said: "the field exam on the receivables came back at 4.2M",
    line: "value the pledged accounts receivable at 4,200,000, field exam dated 12 September 2026",
  },
];

/** The sentence that separates the two collateral rows. It is the whole reason this table exists. */
export const DISAMBIGUATION =
  "The two collateral rows are the pair most easily confused. Collateral pledged TO a facility is a " +
  "facility modification. A collateral asset registered ON the relationship, with no pledge, is a " +
  "relationship intake.";

const exampleLines = (room) =>
  EXAMPLES.filter((e) => e.room === room).map(
    (e) => `- "${e.said}" is \`${e.room}\` / \`${e.route}\`, one line: \`${e.line}\`.`
  );

/** The generated body, identical in every target file. */
export function renderHandoffRouting() {
  return [
    "| What the ask changes | Room | Route |",
    "|---|---|---|",
    ...ROUTING_ROWS.map((r) => `| ${r.ask} | \`${r.room}\` | \`${r.route}\` |`),
    "",
    "**Facility, worked.**",
    "",
    ...exampleLines("facility"),
    "",
    "**Relationship, worked.**",
    "",
    ...exampleLines("relationship"),
    "",
    DISAMBIGUATION,
  ].join("\n");
}

export const BEGIN_MARKER = `<!-- BEGIN GENERATED ${BLOCK_NAME} (node client-360/render/handoff-routing.mjs) -->`;
export const END_MARKER = `<!-- END GENERATED ${BLOCK_NAME} -->`;

/**
 * Replace the marked region's body with the generated one. A marker that is missing, duplicated or
 * out of order throws: a routing table that silently stopped being generated is the drift this
 * exists to prevent, so it must never degrade into a no-op.
 */
export function applyBlock(text, body = renderHandoffRouting()) {
  const begin = BEGIN_MARKER;
  const end = END_MARKER;
  const beginCount = text.split(begin).length - 1;
  const endCount = text.split(end).length - 1;
  if (beginCount !== 1 || endCount !== 1) {
    throw new HandoffRoutingError(
      `expected exactly one ${begin} and one ${end}; found ${beginCount} and ${endCount}`
    );
  }
  const from = text.indexOf(begin);
  const to = text.indexOf(end);
  if (to < from) throw new HandoffRoutingError(`${end} appears before ${begin}`);
  return `${text.slice(0, from)}${begin}\n${body}\n${text.slice(to)}`;
}

/**
 * The route sets the published page actually binds, read from its own contract.
 * @returns {{facility: string[], relationship: string[]}|null} null when the app checkout is absent.
 */
export function readPageRoutes() {
  let source;
  try {
    source = readFileSync(CONTRACT_PATH, "utf8");
  } catch {
    return null;
  }
  const list = (name) => {
    const m = source.match(new RegExp(`${name}\\s*:\\s*IntentRoute\\[\\]\\s*=\\s*\\[([^\\]]*)\\]`));
    if (!m) throw new HandoffRoutingError(`${CONTRACT_PATH} no longer declares ${name}`);
    return [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
  };
  return { facility: list("FACILITY_ROUTES"), relationship: list("RELATIONSHIP_ROUTES") };
}

/**
 * @returns {{path: string, drifted: boolean, expected: string, actual: string}[]}
 */
export function checkHandoffRouting() {
  return TARGET_PATHS.map((path) => {
    let actual;
    try {
      actual = readFileSync(path, "utf8");
    } catch {
      throw new HandoffRoutingError(`prose not found at ${path}`);
    }
    const expected = applyBlock(actual);
    return { path, drifted: expected !== actual, expected, actual };
  });
}

function main() {
  const check = process.argv.includes("--check");

  const pageRoutes = readPageRoutes();
  if (pageRoutes) {
    for (const [room, routes] of Object.entries(ROOM_ROUTES)) {
      const mine = [...routes].sort().join(",");
      const theirs = [...(pageRoutes[room] ?? [])].sort().join(",");
      if (mine !== theirs) {
        console.error(`FAIL: room ${room} routes to ${mine}; the page binds ${theirs}`);
        process.exitCode = 1;
        return;
      }
    }
  }

  const results = checkHandoffRouting();
  const drifted = results.filter((r) => r.drifted);

  if (check) {
    if (drifted.length) {
      for (const r of drifted) console.error(`FAIL: ${r.path} carries a routing table this module does not`);
      console.error("Run: node client-360/render/handoff-routing.mjs");
      process.exitCode = 1;
      return;
    }
    console.log(`OK: ${BLOCK_NAME} matches in ${results.length} files${pageRoutes ? ", and the rooms bind the page's own routes" : ""}`);
    return;
  }

  if (!drifted.length) {
    console.log(`no change: every ${BLOCK_NAME} block already matches`);
    return;
  }
  for (const r of drifted) {
    writeFileSync(r.path, r.expected);
    console.log(`wrote ${r.path}: regenerated ${BLOCK_NAME}`);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
