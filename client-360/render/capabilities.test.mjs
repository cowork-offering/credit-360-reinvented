#!/usr/bin/env node
// Release gate for the capabilities manifest. Run with: node --test render/capabilities.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAPABILITIES_PATH,
  CapabilitiesError,
  READ_BACKUP_TOOLS,
  SERVERS,
  WRITE_DOOR_TOOLS,
  buildCapabilities,
  channelToolNames,
  checkCapabilities,
  serialize,
} from "./capabilities.mjs";
import { manifestToolNames } from "./tool-names.mjs";

const committed = () => JSON.parse(readFileSync(CAPABILITIES_PATH, "utf8"));
const serverEntry = (caps, name) => caps.mcp.servers.find((s) => s.server === name);

test("the committed capabilities.json is byte-identical to what the sources generate", () => {
  const { drifted, reason } = checkCapabilities();
  assert.equal(drifted, false, `${reason}. Run: node client-360/render/capabilities.mjs`);
});

test("the Customer 360 grant is the org manifest ENTIRE, in the org's own order", () => {
  // The one that matters: a tool the org ships but the grant omits is refused `not_in_manifest`
  // at the moment a banker confirms a plan, which is the worst possible time to discover it.
  assert.deepEqual(serverEntry(committed(), SERVERS.customer360).tools, manifestToolNames());
});

test("the read backup mirrors the org's ten reads, and carries its own health tool", () => {
  // Derived from the SAME manifest the Customer 360 grant is, so a read the org gains is mirrored
  // on the next regeneration and the two lanes cannot drift apart. Eleven names: ten mirrors and
  // `gw_health`. Nothing else, and above all no write tool: the backup holds one service
  // credential, and a filing made through it would carry the service's identity, not the banker's.
  const tools = serverEntry(committed(), SERVERS.readBackup).tools;
  assert.deepEqual(tools, READ_BACKUP_TOOLS());
  assert.equal(tools.length, 11);
  assert.deepEqual(
    tools.filter((t) => t !== "gw_health"),
    manifestToolNames()
      .filter((n) => n.startsWith("Customer360"))
      .map((n) => `gw_${n}`)
  );
  for (const t of tools) {
    assert.ok(!/^gw_(stage|execute|complete)_/.test(t), `${t} is a write tool and must never be mirrored`);
  }
});

test("the write door mirrors the org's governed writes, and carries no read at all", () => {
  // 0.9.29. Derived from the SAME manifest, so a pair the org gains is on the
  // door at the next regeneration. The door exists to carry a write whose
  // answer the relay lost; a read on it would be a second read lane nobody
  // asked for, and the read backup is already that.
  const tools = serverEntry(committed(), SERVERS.writeDoor).tools;
  assert.deepEqual(tools, WRITE_DOOR_TOOLS());
  assert.deepEqual(
    tools.filter((t) => t !== "gw_health"),
    manifestToolNames()
      .filter((n) => /^(stage|execute|complete)_/.test(n))
      .map((n) => `gw_${n.replace(/(^|_)([a-z0-9])/g, (_m, _sep, c) => c.toUpperCase())}`)
  );
  for (const t of tools) {
    assert.ok(!t.startsWith("gw_Customer360"), `${t} is a read and must never be on the write door`);
  }
});

test("the Boom and mail grants are the tool names the page itself calls", () => {
  // CHANGED 0.9.28: the two Boom reads left the gateway with the lane itself.
  // They are unprefixed now, and they sit beside the upload ladder on Boom's own
  // connector.
  // 2026-09-15: IDB Gateway retired; the restate assist is session-door only, so
  // the one tool the gateway answered is not granted by anything any more.
  const caps = committed();
  assert.deepEqual(
    serverEntry(caps, SERVERS.boom).tools,
    channelToolNames([
      "boomRatios",
      "boomSpread",
      "boomEnsureCompany",
      "boomListFiles",
      "boomCreateUpload",
      "boomUploadBytes",
      "boomProcessFile",
      "boomAwaitFile",
      "boomGetFile",
      "boomOpenVerification",
    ])
  );
  assert.deepEqual(serverEntry(caps, SERVERS.m365).tools, channelToolNames(["mailSearch"]));
});

test("neither Boom read carries the old relay prefix any more", () => {
  // The prefix was the gateway relaying Boom; Boom's own server publishes them
  // under their own names, and a prefixed name would be refused upstream.
  for (const tool of serverEntry(committed(), SERVERS.boom).tools) {
    assert.ok(!tool.includes("___"), `${tool} still carries a relay prefix`);
  }
});

test("the memo writeback grants are the tool names the page itself calls", () => {
  // The room writes to four systems through two connectors. A name that drifted
  // here is refused `not_in_manifest` at the moment a banker presses publish,
  // with a half-written memo across the systems that did accept their call.
  const caps = committed();
  assert.deepEqual(
    serverEntry(caps, SERVERS.experience).tools,
    channelToolNames([
      "syncMemoSections",
      "publishCreditMemo",
      "finalizeCreditMemo",
      "submitForApproval",
      "ncinoNotify",
      "recordDecision",
      "logAuditEvent",
      "recallDecisions",
      "covenantGrade",
    ])
  );
  assert.deepEqual(
    serverEntry(caps, SERVERS.afs).tools,
    channelToolNames(["afsLoanSummary", "afsPaymentHistory", "afsRevolverUtilization", "afsCreateWorkpackage"])
  );
});

test("all seven connectors are declared, by display name", () => {
  // 2026-09-15: IDB Gateway retired; the restate assist is session-door only,
  // so the grant that used to sit third is gone and nothing replaced it.
  // 0.9.29: the write door is declared third, beside the read backup it shares
  // a host with and never shares a tool with.
  assert.deepEqual(
    committed().mcp.servers.map((s) => s.server),
    [SERVERS.customer360, SERVERS.readBackup, SERVERS.writeDoor, SERVERS.boom, SERVERS.m365, SERVERS.experience, SERVERS.afs]
  );
  assert.ok(!committed().mcp.servers.some((s) => s.server === "IDB Gateway"));
});

test("sample and db are declared, and nothing else is", () => {
  assert.deepEqual(Object.keys(committed()).sort(), ["db", "mcp", "sample"]);
  assert.deepEqual(committed().sample, {});
  assert.deepEqual(committed().db, {});
});

test("every server carries a display name and a non-empty tool list", () => {
  // An empty `tools` array is refused at publish and never means "all tools".
  for (const entry of committed().mcp.servers) {
    assert.equal(typeof entry.server, "string");
    assert.ok(entry.server.trim().length > 0, "server must be a display name, never an id");
    assert.ok(Array.isArray(entry.tools) && entry.tools.length > 0, `${entry.server} has no tools`);
    assert.equal(new Set(entry.tools).size, entry.tools.length, `${entry.server} repeats a tool name`);
  }
});

test("no tool name carries a colon (rejected 422 at publish)", () => {
  for (const entry of committed().mcp.servers) {
    for (const tool of entry.tools) assert.ok(!tool.includes(":"), `${entry.server} / ${tool} carries a colon`);
  }
});

test("a missing channel module fails loudly rather than generating a short grant", () => {
  assert.throws(() => channelToolNames(["mailSearch"], "/nonexistent/mcp.ts"), CapabilitiesError);
});

test("a TOOLS key that stopped existing fails the build", () => {
  assert.throws(() => channelToolNames(["neverDeclared"]), CapabilitiesError);
});

test("the serialized form round-trips and ends in a newline", () => {
  const caps = buildCapabilities();
  const text = serialize(caps);
  assert.ok(text.endsWith("\n"));
  assert.deepEqual(JSON.parse(text), caps);
});
