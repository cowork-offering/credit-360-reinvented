#!/usr/bin/env node
// Generate the PERMITTED-VALUE blocks inside the cockpit skill's prose, and gate them against drift.
//
// The skill tells the session which activity kinds, worklist reason codes and next-step action ids
// it may compose; the assembler REJECTS anything outside those sets. Two hand-maintained lists is
// one list too many: the skill shipped `RENDER_AUDIT` as a permitted kind long after the assembler
// stopped accepting it and started accepting `ACTION_TRIGGERED` instead, so a session that followed
// the prose exactly composed data the assembler then refused, with the failure landing on the
// banker's render rather than on the author of the drift.
//
// So the lists in SKILL.md are GENERATED from contract-checks.mjs, between markers, and the same
// comparison runs as a release gate.
//
// Write the blocks:            node client-360/render/skill-blocks.mjs
// Gate them (exit 1 on drift): node client-360/render/skill-blocks.mjs --check
// Run as a test:               node --test client-360/render/skill-blocks.test.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_ROOT } from "./tool-names.mjs";
import {
  PERMITTED_ACTION_IDS,
  PERMITTED_ACTIVITY_KINDS,
  PERMITTED_REASON_CODES,
} from "./contract-checks.mjs";

export class SkillBlockError extends Error {}

export const SKILL_PATH = join(PLUGIN_ROOT, "skills", "credit-360-cockpit", "SKILL.md");

const code = (values) => values.map((v) => `\`${v}\``).join(" · ");

/** Block name to its generated body, one line each. The names are the marker ids in SKILL.md. */
export function renderBlocks() {
  return new Map([
    ["permitted-activity-kinds", code(PERMITTED_ACTIVITY_KINDS)],
    ["permitted-reason-codes", code(PERMITTED_REASON_CODES)],
    ["permitted-action-ids", code(PERMITTED_ACTION_IDS)],
  ]);
}

export const beginMarker = (name) => `<!-- BEGIN GENERATED ${name} (node client-360/render/skill-blocks.mjs) -->`;
export const endMarker = (name) => `<!-- END GENERATED ${name} -->`;

/**
 * Replace every marked region's body with the generated one. A marker that is missing, duplicated
 * or out of order throws: a block that silently stopped being generated is exactly the drift this
 * exists to prevent, so it must never degrade into a no-op.
 */
export function applyBlocks(text, blocks = renderBlocks()) {
  let out = text;
  for (const [name, body] of blocks) {
    const begin = beginMarker(name);
    const end = endMarker(name);
    const beginCount = out.split(begin).length - 1;
    const endCount = out.split(end).length - 1;
    if (beginCount !== 1 || endCount !== 1) {
      throw new SkillBlockError(
        `expected exactly one ${begin} and one ${end}; found ${beginCount} and ${endCount}`
      );
    }
    const from = out.indexOf(begin);
    const to = out.indexOf(end);
    if (to < from) throw new SkillBlockError(`${end} appears before ${begin}`);
    out = `${out.slice(0, from)}${begin}\n${body}\n${out.slice(to)}`;
  }
  return out;
}

/**
 * @returns {{ drifted: boolean, reason: string|null, expected: string, actual: string }}
 */
export function checkSkillBlocks(skillPath = SKILL_PATH) {
  let actual;
  try {
    actual = readFileSync(skillPath, "utf8");
  } catch {
    throw new SkillBlockError(`skill prose not found at ${skillPath}`);
  }
  const expected = applyBlocks(actual);
  return {
    drifted: expected !== actual,
    reason: expected === actual ? null : `${skillPath} carries a permitted-value list its contract checks do not`,
    expected,
    actual,
  };
}

function main() {
  const check = process.argv.includes("--check");
  const { drifted, reason, expected } = checkSkillBlocks();

  if (check) {
    if (drifted) {
      console.error(`FAIL: ${reason}. Run: node client-360/render/skill-blocks.mjs`);
      process.exitCode = 1;
      return;
    }
    console.log(`OK: ${[...renderBlocks().keys()].join(", ")} match the contract checks`);
    return;
  }

  if (!drifted) {
    console.log("no change: the skill's permitted-value blocks already match the contract checks");
    return;
  }
  writeFileSync(SKILL_PATH, expected);
  console.log(`wrote ${SKILL_PATH}: regenerated ${[...renderBlocks().keys()].join(", ")}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
