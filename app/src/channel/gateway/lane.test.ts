import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  callGateway,
  FALLBACK_CODES,
  GATEWAY_SERVER,
  gatewayHealth,
  gatewayToolName,
  isMirroredRead,
  MIRRORED_READS,
  readThroughEitherLane,
  readWithFallback,
  shouldFallBack,
} from "./lane";
import { describeFailure, TOOLS, type McpFailure } from "../mcp";

/* The runtime is stubbed the way every other channel test stubs it: a
   pre-injected `window.claude.mcp`, which `mcp()` honours synchronously. */
type CallArgs = [string, string, unknown, unknown];

function installMcp(callTool: (...a: CallArgs) => Promise<unknown>) {
  const calls: CallArgs[] = [];
  (globalThis as unknown as { window: unknown }).window = {
    claude: {
      mcp: {
        callTool: (...args: CallArgs) => {
          calls.push(args);
          return callTool(...args);
        },
        watchTool: () => () => {},
        listTools: async () => ({ servers: [] }),
        invalidate: async () => {},
      },
    },
  };
  return calls;
}

const envelope = (outputValues: Record<string, unknown>) => ({
  payload: { content: [{ actionName: "x", isSuccess: true, errors: null, outputValues, sortOrder: 0, version: 1 }] },
});

const fail = (code: string, message = "") => describeFailure({ code, message, retryable: false }, "Customer 360", "t");

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("the mirrored surface", () => {
  it("names the connector exactly as claude.ai must spell it", () => {
    // The page resolves a connector by DISPLAY NAME. A drifted string here is
    // silent: the fallback lane simply never finds a door and the outage the
    // lane exists for looks identical to the one it was meant to survive.
    expect(GATEWAY_SERVER).toBe("Salesforce Read Backup");
  });

  it("covers exactly the ten Customer 360 reads", () => {
    expect(MIRRORED_READS).toHaveLength(10);
    expect(new Set(MIRRORED_READS).size).toBe(10);
    for (const t of MIRRORED_READS) expect(t.startsWith("Customer360")).toBe(true);
  });

  it("prefixes the org tool name with gw_", () => {
    expect(gatewayToolName(TOOLS.snapshot)).toBe("gw_Customer360Snapshot");
    expect(gatewayToolName(TOOLS.portfolio)).toBe("gw_Customer360Portfolio");
  });

  it("does not admit a single write tool", () => {
    expect(isMirroredRead(TOOLS.stageNewFacility)).toBe(false);
    expect(isMirroredRead(TOOLS.executeNewFacility)).toBe(false);
    expect(isMirroredRead(TOOLS.completeNewFacilityDetail)).toBe(false);
    expect(isMirroredRead(TOOLS.snapshot)).toBe(true);
  });
});

describe("callGateway", () => {
  it("calls the backup connector by display name, with the inputs array unchanged", async () => {
    const calls = installMcp(async () => envelope({ accountId: "001a" }));
    const res = await callGateway(TOOLS.snapshot, [{ accountId: "001a" }]);
    expect(calls[0][0]).toBe(GATEWAY_SERVER);
    expect(calls[0][1]).toBe("gw_Customer360Snapshot");
    expect(calls[0][2]).toEqual({ inputs: [{ accountId: "001a" }] });
    expect((res.payload as { content: unknown[] }).content).toHaveLength(1);
  });

  it("refuses a write by name, before any connector call", async () => {
    const calls = installMcp(async () => envelope({}));
    await expect(callGateway(TOOLS.executeNewFacility, [{ accountId: "001a" }])).rejects.toMatchObject({
      code: "bad_request",
      server: GATEWAY_SERVER,
    });
    expect(calls).toHaveLength(0);
  });

  it("passes cache options through", async () => {
    const calls = installMcp(async () => envelope({}));
    await callGateway(TOOLS.exposure, [{ accountId: "001a" }], { cache: { staleTime: 15_000 } });
    expect(calls[0][3]).toMatchObject({ cache: { staleTime: 15_000 } });
  });
});

describe("shouldFallBack", () => {
  it("falls back on the codes the 2026-09-03 outage produced", () => {
    for (const code of FALLBACK_CODES) expect(shouldFallBack(fail(code))).toBe(true);
  });

  it("falls back when a 502 or a timeout is only in the message", () => {
    expect(shouldFallBack(fail("tool_error", "request failed (502)"))).toBe(true);
    expect(shouldFallBack(fail("tool_error", "the call timed out"))).toBe(true);
    expect(shouldFallBack(fail("tool_error", "Bad Gateway"))).toBe(true);
  });

  it("never falls back on an authz denial: the gateway asks as somebody else", () => {
    for (const code of ["needs_reauth", "server_not_connected", "blocked_by_policy", "approval_required"]) {
      expect(shouldFallBack(fail(code))).toBe(false);
    }
  });

  it("never falls back when the page has no connector bridge at all", () => {
    for (const code of ["not_granted", "capability_disabled", "capability_removed"]) {
      expect(shouldFallBack(fail(code))).toBe(false);
    }
  });

  it("does not fall back on a plain tool error or a bad request", () => {
    expect(shouldFallBack(fail("tool_error", "the action reported a failure"))).toBe(false);
    expect(shouldFallBack(fail("bad_request", "malformed"))).toBe(false);
    expect(shouldFallBack(fail("not_in_manifest"))).toBe(false);
  });
});

describe("readWithFallback", () => {
  it("uses the primary lane and never constructs the gateway call", async () => {
    const gateway = vi.fn(async () => "gw");
    const out = await readWithFallback(async () => "primary", gateway);
    expect(out).toEqual({ value: "primary", via: "customer360" });
    expect(gateway).not.toHaveBeenCalled();
  });

  it("marks a gateway answer and carries why the primary lane failed", async () => {
    const failure = fail("server_unavailable", "request failed (502)");
    const onFallback = vi.fn();
    const out = await readWithFallback(
      async () => {
        throw failure;
      },
      async () => "gw",
      { onFallback },
    );
    expect(out.via).toBe("gateway");
    expect(out.value).toBe("gw");
    expect(out.primaryFailure?.code).toBe("server_unavailable");
    expect(onFallback).toHaveBeenCalledWith(failure);
  });

  it("rethrows a failure the gateway could not fix, without calling it", async () => {
    const gateway = vi.fn(async () => "gw");
    await expect(
      readWithFallback(async () => {
        throw fail("needs_reauth");
      }, gateway),
    ).rejects.toMatchObject({ code: "needs_reauth" });
    expect(gateway).not.toHaveBeenCalled();
  });

  it("reports the PRIMARY failure when both doors are shut", async () => {
    const onGatewayFailure = vi.fn();
    await expect(
      readWithFallback(
        async () => {
          throw fail("server_unavailable", "primary down");
        },
        async () => {
          throw fail("server_unavailable", "gateway down");
        },
        { onGatewayFailure },
      ),
    ).rejects.toMatchObject({ message: "primary down" });
    expect(onGatewayFailure).toHaveBeenCalled();
  });

  it("rethrows a non-failure rejection untouched rather than guessing", async () => {
    const boom = new TypeError("not an McpFailure");
    await expect(
      readWithFallback(
        async () => {
          throw boom;
        },
        async () => "gw",
      ),
    ).rejects.toBe(boom);
  });
});

describe("readThroughEitherLane", () => {
  it("tries Customer 360 first and the gateway second, with the same inputs", async () => {
    const calls = installMcp(async (server) => {
      if (server === "Customer 360") throw { code: "server_unavailable", message: "request failed (502)", retryable: false };
      return envelope({ accountId: "001bb00001I7FPNAA3" });
    });
    const out = await readThroughEitherLane(TOOLS.snapshot, [{ accountId: "001bb00001I7FPNAA3" }]);
    expect(out.via).toBe("gateway");
    expect(calls.map((c) => [c[0], c[1]])).toEqual([
      ["Customer 360", "Customer360Snapshot"],
      [GATEWAY_SERVER, "gw_Customer360Snapshot"],
    ]);
    expect(calls[0][2]).toEqual(calls[1][2]);
  });

  it("returns the same envelope shape from either lane, so unwrappers do not branch", async () => {
    const values: unknown[] = [];
    installMcp(async () => envelope({ accountId: "001a", name: "Hartwell Precision Manufacturing LLC" }));
    const primary = await readThroughEitherLane(TOOLS.snapshot, [{ accountId: "001a" }]);
    values.push(primary.value.payload);
    installMcp(async (server) => {
      if (server === "Customer 360") throw { code: "server_unavailable", message: "502", retryable: false };
      return envelope({ accountId: "001a", name: "Hartwell Precision Manufacturing LLC" });
    });
    const viaGateway = await readThroughEitherLane(TOOLS.snapshot, [{ accountId: "001a" }]);
    values.push(viaGateway.value.payload);
    expect(JSON.stringify(values[0])).toBe(JSON.stringify(values[1]));
  });
});

describe("gatewayHealth", () => {
  it("reads the health object and sends no inputs", async () => {
    const calls = installMcp(async () => ({ payload: { ok: true, orgReachable: true, orgError: null, tokenAgeMs: 42 } }));
    const h = await gatewayHealth();
    expect(calls[0][1]).toBe("gw_health");
    expect(calls[0][2]).toEqual({});
    expect(h.orgReachable).toBe(true);
    expect(h.tokenAgeMs).toBe(42);
  });

  it("treats a shapeless answer as a failure, not as a healthy gateway", async () => {
    installMcp(async () => ({ payload: "fine" }));
    await expect(gatewayHealth()).rejects.toMatchObject({ code: "transform_error" });
  });
});

describe("the fallback never carries a write", () => {
  it("readThroughEitherLane only accepts the ten reads at the type level and at runtime", async () => {
    installMcp(async () => envelope({}));
    // Cast past the type guard the way a careless caller would; the runtime
    // guard in callGateway is the one that has to hold.
    await expect(
      callGateway(TOOLS.stageCollateralValuation as unknown as string, [{ accountId: "001a" }]),
    ).rejects.toMatchObject({ code: "bad_request" });
  });
});

describe("the failure shape stays branchable", () => {
  it("a gateway failure is a normalized McpFailure naming the gateway", async () => {
    installMcp(async () => {
      throw { code: "server_not_connected", message: "no such connector" };
    });
    const err = (await callGateway(TOOLS.snapshot, [{ accountId: "001a" }]).catch((e) => e)) as McpFailure;
    expect(err.code).toBe("server_not_connected");
    expect(err.server).toBe(GATEWAY_SERVER);
    expect(err.fix).toContain(GATEWAY_SERVER);
    expect(err.retract).toBe(true);
  });
});
