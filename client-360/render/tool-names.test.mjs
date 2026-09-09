#!/usr/bin/env node
// Release gate for the natural-chat prose. Run with: node --test render/tool-names.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASSERTED_ABSENT,
  checkToolNames,
  manifestToolNames,
  proseFiles,
  manifestToolNames as names,
  ToolNameError,
  MANIFEST_PATH,
} from "./tool-names.mjs";

/** The org's Customer360 definition as of 2026-09-03: 10 reads, 8 stage/execute pairs, the
 *  stage-only renewal and the second-hop `complete_new_facility_detail`. Pinned, not derived: a
 *  count that moved is a deployment the prose, the grant and this runbook have to catch up with. */
const MANIFEST_TOOL_COUNT = 28;

test("the org manifest parses and declares the expected tools", () => {
  const tools = manifestToolNames();
  assert.equal(tools.length, MANIFEST_TOOL_COUNT, `expected ${MANIFEST_TOOL_COUNT} tools in ${MANIFEST_PATH}, got ${tools.length}`);
  assert.equal(new Set(tools).size, MANIFEST_TOOL_COUNT, "manifest tool names must be unique");
});

test("a missing manifest fails loudly rather than passing vacuously", () => {
  assert.throws(() => names("/nonexistent/Customer360.mcpServerDefinition-meta.xml"), ToolNameError);
});

test("the agent and every skill are scanned", () => {
  const files = proseFiles();
  assert.ok(files.some((f) => f.endsWith("agents/credit-360.md")), "the agent must be scanned");
  for (const skill of [
    "credit-360-cockpit",
    "client-request-to-action",
    "covenant-review",
    "collateral-valuation",
    "relationship-actions",
  ]) {
    assert.ok(
      files.some((f) => f.endsWith(`skills/${skill}/SKILL.md`)),
      `${skill}/SKILL.md must be scanned`
    );
  }
});

test("every Customer 360 tool name in the prose exists in the org manifest", () => {
  const { unknown } = checkToolNames();
  const detail = unknown.map((u) => `${u.file}:${u.line} ${u.token}`).join("\n  ");
  assert.equal(unknown.length, 0, `tool names not in the manifest:\n  ${detail}`);
});

test("the prose covers the manifest: nothing declared is left unnamed", () => {
  const { unmentioned } = checkToolNames();
  assert.equal(unmentioned.length, 0, `declared but never mentioned: ${unmentioned.join(", ")}`);
});

test("names the prose promises do not exist are still absent from the org manifest", () => {
  const { wronglyShipped } = checkToolNames();
  assert.equal(
    wronglyShipped.length,
    0,
    `the org now ships ${wronglyShipped.join(", ")}; the prose that says otherwise is stale`
  );
});

test("execute_renewal is the asserted-absent case, and stage_renewal is real", () => {
  assert.deepEqual(ASSERTED_ABSENT, ["execute_renewal"]);
  assert.ok(manifestToolNames().includes("stage_renewal"), "stage_renewal must ship");
  assert.ok(!manifestToolNames().includes("execute_renewal"), "execute_renewal must not ship");
});
