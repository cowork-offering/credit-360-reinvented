// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVERS, TOOLS } from "./mcp";
import { GATEWAY_HEALTH_TOOL, GATEWAY_SERVER } from "./gateway/lane";
import { __resetGrantWarmupForTests, warmConnectorGrants, WARMUP_MAIL_QUERY } from "./grantWarmup";

/* THE FOUNDER'S ASK, 2026-09-13: "the connector permission prompts come one by
   one on different pages or on Sync; I want them all at the beginning." What
   these pin is that ONE read goes to each connector, that none of them writes,
   and that a connector the viewer never added costs nothing but a silence. */

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

const ACCOUNT = "Sterling Fabrication Co.";
const AFS = { bank: "01", obligor: "44821", obligation: "9001" };

beforeEach(() => {
  __resetGrantWarmupForTests();
  w.claude = { mcp: { callTool: vi.fn(), watchTool: vi.fn(), listTools: vi.fn(), invalidate: vi.fn() } };
});

afterEach(() => {
  delete w.claude;
  vi.restoreAllMocks();
});

/** A stand-in for `callTool` that records what was asked of which connector. */
function spy(impl: (server: string, tool: string) => Promise<unknown> = async () => ({ payload: {} })) {
  return vi.fn(async (server: string, tool: string, _input?: unknown, _options?: unknown) => impl(server, tool));
}

type Spy = ReturnType<typeof spy>;
/** The option the module declares is `typeof callTool`; the spy answers the
 *  same three questions and none of the envelope, which is all it is asked. */
const asCall = (fn: Spy) => fn as unknown as NonNullable<Parameters<typeof warmConnectorGrants>[0]>["call"];

const serversCalled = (call: Spy) => call.mock.calls.map((c) => String(c[0]));
const toolsCalled = (call: Spy) => call.mock.calls.map((c) => String(c[1]));

describe("every configured connector is asked once, at the start", () => {
  it("reads each connector exactly once", async () => {
    const call = spy();
    await warmConnectorGrants({
      accountName: ACCOUNT,
      afs: AFS,
      call: asCall(call),
      grantOf: () => "granted",
    });

    const servers = serversCalled(call);
    for (const server of [GATEWAY_SERVER, SERVERS.boom, SERVERS.m365, SERVERS.experience, SERVERS.afs]) {
      expect(servers.filter((s) => s === server)).toHaveLength(1);
    }
    expect(servers).toHaveLength(5);
  });

  it("does not re-read Customer 360: the landing already called it", async () => {
    const call = spy();
    await warmConnectorGrants({ accountName: ACCOUNT, afs: AFS, call: asCall(call), grantOf: () => "granted" });
    expect(serversCalled(call)).not.toContain(SERVERS.customer360);
  });

  it("asks for the cheap read on each, and never a write", async () => {
    const call = spy();
    await warmConnectorGrants({ accountName: ACCOUNT, afs: AFS, call: asCall(call), grantOf: () => "granted" });

    expect(toolsCalled(call)).toEqual([
      GATEWAY_HEALTH_TOOL,
      TOOLS.boomRatios,
      TOOLS.mailSearch,
      TOOLS.covenantGrade,
      TOOLS.afsLoanSummary,
    ]);
    // Nothing that stages, executes, publishes or files.
    for (const tool of toolsCalled(call)) expect(tool).not.toMatch(/^(stage_|execute_|ncino_|record_|log_|create_)/);
    // And every one of them is marked a read, so the shared retry policy applies.
    for (const args of call.mock.calls) expect((args[3] as { read?: boolean }).read).toBe(true);
  });

  it("sends the mailbox search with a fixed harmless query", async () => {
    const call = spy();
    await warmConnectorGrants({ accountName: ACCOUNT, call: asCall(call), grantOf: () => "granted" });
    const mail = call.mock.calls.find((c) => c[1] === TOOLS.mailSearch)!;
    expect(mail[2]).toEqual({ query: WARMUP_MAIL_QUERY });
  });

  /* RESTATED 0.9.28. Boom's own server takes a BORROWER on `boom_get_ratios`,
     named by the Salesforce record id it stores as `externalUniqueId`, and the
     company name only where the view carries no id. The old `{ company }` was
     the gateway relay's argument and the live server refuses it. */
  it("keys the Boom read to the relationship the worklist opened on", async () => {
    const call = spy();
    await warmConnectorGrants({ accountId: "001bb00001DLtRMAA1", accountName: ACCOUNT, call: asCall(call), grantOf: () => "granted" });
    expect(call.mock.calls.find((c) => c[1] === TOOLS.boomRatios)![2]).toEqual({ salesforceRecordId: "001bb00001DLtRMAA1" });
  });

  it("falls back to the borrower's name where the worklist row carries no id", async () => {
    const call = spy();
    await warmConnectorGrants({ accountName: ACCOUNT, call: asCall(call), grantOf: () => "granted" });
    expect(call.mock.calls.find((c) => c[1] === TOOLS.boomRatios)![2]).toEqual({ companyName: ACCOUNT });
  });
});

describe("what it declines to ask", () => {
  it("skips the read backup when the boot probe did not see it", async () => {
    const call = spy();
    await warmConnectorGrants({ accountName: ACCOUNT, call: asCall(call), grantOf: () => "not-granted" });
    expect(serversCalled(call)).not.toContain(GATEWAY_SERVER);
  });

  it("skips AFS with no servicing mapping: a defaulted key reads another borrower", async () => {
    const call = spy();
    await warmConnectorGrants({ accountName: ACCOUNT, call: asCall(call), grantOf: () => "granted" });
    expect(serversCalled(call)).not.toContain(SERVERS.afs);
    expect(toolsCalled(call)).not.toContain(TOOLS.afsLoanSummary);
  });

  it("skips Boom with no relationship to key it to", async () => {
    const call = spy();
    await warmConnectorGrants({ call: asCall(call), grantOf: () => "granted" });
    expect(toolsCalled(call)).not.toContain(TOOLS.boomRatios);
    // The connectors that need no key are still warmed.
    expect(toolsCalled(call)).toContain(TOOLS.mailSearch);
  });

  it("does nothing at all with no connector bridge in this view", async () => {
    delete w.claude;
    const call = spy();
    await warmConnectorGrants({ accountName: ACCOUNT, call: asCall(call), grantOf: () => "granted" });
    expect(call.mock.calls).toHaveLength(0);
  });
});

describe("it is silent, and it happens once", () => {
  it("swallows every failure", async () => {
    const call = spy(async (_server, tool) => {
      if (tool === TOOLS.mailSearch) throw { code: "server_not_connected", message: "no grant" };
      throw { code: "upstream_error", message: "502" };
    });
    await expect(warmConnectorGrants({ accountName: ACCOUNT, afs: AFS, call: asCall(call), grantOf: () => "granted" })).resolves.toBeUndefined();
  });

  it("a second call in the same page session is a no-op", async () => {
    const first = spy();
    await warmConnectorGrants({ accountName: ACCOUNT, call: asCall(first), grantOf: () => "granted" });
    expect(first.mock.calls.length).toBeGreaterThan(0);

    const second = spy();
    await warmConnectorGrants({ accountName: ACCOUNT, call: asCall(second), grantOf: () => "granted" });
    expect(second.mock.calls).toHaveLength(0);
  });
});
