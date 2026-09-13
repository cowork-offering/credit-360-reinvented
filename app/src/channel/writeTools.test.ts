// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeAction,
  executionHeldReason,
  isExecutionHeld,
  resolveApproverUserId,
  isWriteAction,
  parseLegalValues,
  parseProvenance,
  isLostWriteAnswer,
  stageAction,
  toolErrorCopy,
  WRITE_TOOLS,
} from "./writeTools";
import { SERVERS, TOOLS, WRITE_RETRY_BUDGET_MS } from "./mcp";
import { validatePlan } from "../actions/transitionAllowlist";

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

afterEach(() => {
  delete w.claude;
  vi.restoreAllMocks();
});

/** The observed positional envelope: content[i] carries outputValues for input i. */
const envelope = (outputValues: unknown) => ({
  content: [{ actionName: "stage_collateral_valuation", errors: null, isSuccess: true, outputValues, sortOrder: 0, version: 1 }],
});

function installMcp(payload: unknown) {
  const callTool = vi.fn().mockResolvedValue({ payload });
  w.claude = { mcp: { callTool, watchTool: vi.fn(), listTools: vi.fn(), invalidate: vi.fn() } };
  return callTool;
}

/** The observed happy-path StageResult. */
const STAGE_RESULT = {
  ok: true,
  error: null,
  result: {
    stagingId: "a8abb00001KtalSAAR",
    planHash: "9f2c1d",
    decisionToken: "dt-server-001",
    replayed: false,
    accountId: "001bb00001DLtRMAA1",
    productPackageId: "a5Fbb000000HA1NEAW",
    summary: "Files a collateral valuation.",
    warnings: ["The roll-up may not fire."],
    steps: [
      {
        id: "s1",
        type: "write",
        label: "Create the collateral valuation",
        objectName: "LLC_BI__Collateral_Valuation__c",
        fields: ["LLC_BI__Value__c", "LLC_BI__Active__c"],
        automationWoken: ["CollateralValuationTrigger"],
        verification: "SELECT Id FROM LLC_BI__Collateral_Valuation__c",
        state: "pending",
      },
    ],
    provenanceJson: '{"LLC_BI__Value__c":{"source":"NCINO_RECORD"}}',
  },
};

/** The observed domain failure. */
const VALIDATION_FAILED = {
  ok: false,
  result: null,
  error: {
    code: "VALIDATION_FAILED",
    message: "type is not a legal value on this org. Legal values are: Fair Market Value - Real Estate, Net Orderly Liquidation Value, As Is Value",
    orgError: "FIELD_INTEGRITY_EXCEPTION",
    idempotencyKey: "idem-1",
    resumable: false,
  },
};

const PAYLOAD = { idempotencyKey: "idem-1", collateralId: "a34bb00000398KnAAI", value: 1000 };

describe("tool registry", () => {
  it("names every stage tool and every execute tool that exists", () => {
    expect(Object.values(WRITE_TOOLS).flatMap((t) => [t.stage, t.execute]).filter(Boolean).sort()).toEqual([
      "execute_amend_version",
      "execute_annual_review",
      "execute_collateral_valuation",
      "execute_covenant_review",
      "execute_discard_version",
      "execute_loan_modification",
      "execute_new_facility",
      "execute_relationship_intake",
      "execute_risk_rating_review",
      "execute_service_request",
      "stage_amend_version",
      "stage_annual_review",
      "stage_collateral_valuation",
      "stage_covenant_review",
      "stage_discard_version",
      "stage_loan_modification",
      "stage_new_facility",
      "stage_relationship_intake",
      "stage_renewal",
      "stage_risk_rating_review",
      "stage_service_request",
    ]);
  });

  it("holds execution for renewal only, with no tool name invented", () => {
    // No execute_renewal was built, so a null is the honest record of that; a
    // plausible-looking name would be a lie the panel would eventually call.
    expect(WRITE_TOOLS.renewal.execute).toBeNull();
    expect(isExecutionHeld("renewal")).toBe(true);
    expect(isExecutionHeld("collateral-valuation")).toBe(false);
  });

  it("no longer holds the covenant review: the gate's stated reason is spent", () => {
    // WS0.5 items 2+3: the founder gate stood on execute_covenant_review never
    // having been run live. It has now, on both arms, on throwaway data. The
    // ORG can still hold a plan via executionHeld; the client adds no hold.
    expect(WRITE_TOOLS["covenant-review"].execute).toBe("execute_covenant_review");
    expect(WRITE_TOOLS["covenant-review"].heldReason).toBeNull();
    expect(isExecutionHeld("covenant-review")).toBe(false);
    expect(executionHeldReason("covenant-review")).toBeNull();
  });

  it("no longer holds the modification: the client hold is gone and the tool is named", () => {
    // WS0.5: execute_loan_modification is deployed and was exercised live. The
    // cockpit adds no hold of its own; the ORG still holds via the staged plan.
    expect(WRITE_TOOLS["loan-modification"].execute).toBe("execute_loan_modification");
    expect(WRITE_TOOLS["loan-modification"].heldReason).toBeNull();
    expect(isExecutionHeld("loan-modification")).toBe(false);
    expect(executionHeldReason("loan-modification")).toBeNull();
  });

  it("refuses to execute a held action rather than calling a tool that is not there", async () => {
    const callTool = installMcp(envelope({ ok: true, result: {} }));
    const out = await executeAction("renewal", {
      idempotencyKey: "k",
      stagingId: "s",
      planHash: "h",
      decisionToken: "t",
      approverUserId: "005bb00000ftouDAAQ",
    });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error.code).toBe("EXECUTION_HELD");
    expect(callTool).not.toHaveBeenCalled();
  });

  it("exposes them on the manifest constants too", () => {
    for (const t of Object.values(WRITE_TOOLS)) {
      expect(Object.values(TOOLS)).toContain(t.stage);
      if (t.execute) expect(Object.values(TOOLS)).toContain(t.execute);
    }
  });

  it("recognises exactly the three write actions", () => {
    expect(isWriteAction("collateral-valuation")).toBe(true);
    expect(isWriteAction("annual-review")).toBe(true);
    expect(isWriteAction("create-service-request")).toBe(true);
    expect(isWriteAction("generate-spreading")).toBe(false);
  });
});

describe("stage_* — the positional envelope and the typed result", () => {
  it("calls the right server and tool with a positional inputs array", async () => {
    const callTool = installMcp(envelope(STAGE_RESULT));
    await stageAction("collateral-valuation", PAYLOAD as never);
    expect(callTool).toHaveBeenCalledWith(
      SERVERS.customer360,
      "stage_collateral_valuation",
      { inputs: [PAYLOAD] },
      expect.anything(),
    );
  });

  it("never caches a staging call", async () => {
    const callTool = installMcp(envelope(STAGE_RESULT));
    await stageAction("collateral-valuation", PAYLOAD as never);
    expect(callTool.mock.calls[0][3]).toMatchObject({ cache: false });
  });

  it("maps the observed result onto StagedOutput", async () => {
    installMcp(envelope(STAGE_RESULT));
    const out = await stageAction("collateral-valuation", PAYLOAD as never);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.stagingId).toBe("a8abb00001KtalSAAR");
    expect(out.result.planHash).toBe("9f2c1d");
    expect(out.result.decisionToken).toBe("dt-server-001");
    expect(out.result.productPackageId).toBe("a5Fbb000000HA1NEAW");
    expect(out.result.warnings).toHaveLength(1);
    expect(out.result.steps[0]).toMatchObject({
      id: "s1",
      type: "write",
      objectName: "LLC_BI__Collateral_Valuation__c",
      state: "pending",
    });
    expect(out.result.steps[0].fields).toEqual(["LLC_BI__Value__c", "LLC_BI__Active__c"]);
  });

  it("parses provenanceJson, which arrives as a STRING", async () => {
    installMcp(envelope(STAGE_RESULT));
    const out = await stageAction("collateral-valuation", PAYLOAD as never);
    if (!out.ok) throw new Error("expected ok");
    expect(out.result.provenance).toMatchObject({ "LLC_BI__Value__c": { source: "NCINO_RECORD" } });
  });

  it("survives a malformed provenanceJson rather than failing the stage", async () => {
    installMcp(envelope({ ...STAGE_RESULT, result: { ...STAGE_RESULT.result, provenanceJson: "{not json" } }));
    const out = await stageAction("collateral-valuation", PAYLOAD as never);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.provenance).toBeUndefined();
  });

  it("carries no record id, because stage wrote nothing", async () => {
    installMcp(envelope(STAGE_RESULT));
    const out = await stageAction("collateral-valuation", PAYLOAD as never);
    if (!out.ok) throw new Error("expected ok");
    // The staging id is ours, not an org record; the steps carry field names only.
    for (const s of out.result.steps) {
      for (const f of s.fields ?? []) expect(f).not.toMatch(/^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/);
    }
  });

  it("a staged plan from the live tool passes the transition allowlist", async () => {
    installMcp(envelope(STAGE_RESULT));
    const out = await stageAction("collateral-valuation", PAYLOAD as never);
    if (!out.ok) throw new Error("expected ok");
    expect(validatePlan(out.result.steps)).toEqual([]);
  });
});

describe("A33.5.1 — domain failure is not transport failure", () => {
  it("reports ok:false as a DOMAIN error, not a transport one", async () => {
    installMcp(envelope(VALIDATION_FAILED));
    const out = await stageAction("collateral-valuation", PAYLOAD as never);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("VALIDATION_FAILED");
    expect(out.error.orgError).toBe("FIELD_INTEGRITY_EXCEPTION");
    expect(out.error.resumable).toBe(false);
    expect(out.error.code).not.toBe("TRANSPORT");
  });

  it("reports a transport failure separately", async () => {
    installMcp({ content: [{ isSuccess: false, errors: ["row locked"], outputValues: null }] });
    const out = await stageAction("collateral-valuation", PAYLOAD as never);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("TRANSPORT");
  });

  it("reports a shapeless response rather than pretending it succeeded", async () => {
    installMcp(envelope({ ok: undefined }));
    const out = await stageAction("collateral-valuation", PAYLOAD as never);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("UNEXPECTED");
  });
});

describe("legal picklist values come from the tool, never from us", () => {
  it("lifts the legal set out of a VALIDATION_FAILED message", async () => {
    installMcp(envelope(VALIDATION_FAILED));
    const out = await stageAction("collateral-valuation", PAYLOAD as never);
    if (out.ok) throw new Error("expected failure");
    expect(out.error.legalValues).toEqual([
      "Fair Market Value - Real Estate",
      "Net Orderly Liquidation Value",
      "As Is Value",
    ]);
  });

  it("parses both phrasings and tolerates neither", () => {
    expect(parseLegalValues("bad value. Legal values are: A, B")).toEqual(["A", "B"]);
    expect(parseLegalValues("must be one of: X; Y or Z")).toEqual(["X", "Y", "Z"]);
    expect(parseLegalValues("something else entirely")).toBeUndefined();
  });

  it("parseProvenance rejects non-objects", () => {
    expect(parseProvenance("[1,2]")).toBeUndefined();
    expect(parseProvenance("")).toBeUndefined();
    expect(parseProvenance(undefined)).toBeUndefined();
  });
});

describe("execute_* — the shape read from the Apex Request classes", () => {
  const EXEC_PAYLOAD = {
    idempotencyKey: "idem-1",
    stagingId: "a8abb00001KtalSAAR",
    planHash: "9f2c1d",
    decisionToken: "dt-server-001",
    approverUserId: "005xx",
  };

  const EXEC_RESULT = {
    ok: true,
    error: null,
    result: {
      stagingId: "a8abb00001KtalSAAR",
      valuationId: "a3Abb0000012345AAA",
      terminalState: "partial",
      outcome: "Valuation filed, collateral value unchanged.",
      collateralValueMoved: false,
      replayed: false,
      steps: [
        { id: "s1", type: "write", label: "Create the valuation", state: "verified" },
        { id: "s2", type: "verification", label: "Re-query the collateral", state: "filed_unverified", detail: "no roll-up observed" },
      ],
    },
  };

  it("sends exactly the five required fields", async () => {
    const callTool = installMcp(envelope(EXEC_RESULT));
    await executeAction("collateral-valuation", EXEC_PAYLOAD);
    const sent = callTool.mock.calls[0][2] as { inputs: Array<Record<string, unknown>> };
    expect(Object.keys(sent.inputs[0]).sort()).toEqual([
      "approverUserId",
      "decisionToken",
      "idempotencyKey",
      "planHash",
      "stagingId",
    ]);
  });

  it("never caches a write", async () => {
    const callTool = installMcp(envelope(EXEC_RESULT));
    await executeAction("collateral-valuation", EXEC_PAYLOAD);
    expect(callTool.mock.calls[0][3]).toMatchObject({ cache: false });
  });

  it("re-asks a lost answer under the SAME stagingId and token, and says how many asks it took", async () => {
    /* RESTATED 2026-09-13, not relaxed. The old rule ("never auto-retry a
       write") stood on ambiguity, and the key removes it: Execute*.cls answers
       an idempotency key that already produced a record with THAT run's tracker
       and writes nothing, so re-sending the identical five fields cannot file a
       second time. What is still forbidden, and asserted here, is changing any
       of them between asks. */
    vi.useFakeTimers();
    try {
      const callTool = vi.fn().mockRejectedValue({ code: "server_unavailable", message: "request failed (502)" });
      w.claude = { mcp: { callTool, watchTool: vi.fn(), listTools: vi.fn(), invalidate: vi.fn() } };
      const seen = executeAction("collateral-valuation", EXEC_PAYLOAD);
      await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 100);
      const out = await seen;
      expect(out.ok).toBe(false);
      expect(out.attempts).toBe(3);
      expect(callTool).toHaveBeenCalledTimes(3);
      for (const call of callTool.mock.calls) expect((call[2] as { inputs: unknown[] }).inputs[0]).toEqual(EXEC_PAYLOAD);
      // And it is never reported as a refusal: nobody knows yet.
      if (!out.ok) expect(out.error.code).toBe("TRANSPORT");
      expect(out.pending).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps the executor's step states and banker-language outcome", async () => {
    installMcp(envelope(EXEC_RESULT));
    const out = await executeAction("collateral-valuation", EXEC_PAYLOAD);
    if (!out.ok) throw new Error("expected ok");
    expect(out.result.terminalState).toBe("partial");
    expect(out.result.outcome).toMatch(/collateral value unchanged/);
    expect(out.result.collateralValueMoved).toBe(false);
    expect(out.result.steps.map((s) => s.state)).toEqual(["verified", "filed_unverified"]);
  });

  it("routes each executable action to its own execute tool", async () => {
    for (const [actionId, tools] of Object.entries(WRITE_TOOLS)) {
      if (!tools.execute) continue; // held: covered above
      const callTool = installMcp(envelope(EXEC_RESULT));
      await executeAction(actionId as keyof typeof WRITE_TOOLS, EXEC_PAYLOAD);
      expect(callTool.mock.calls[0][1]).toBe(tools.execute);
    }
  });
});


describe("resolveApproverUserId (live defect 2026-07-26)", () => {
  it("accepts a 15 or 18 character Salesforce user id", () => {
    expect(resolveApproverUserId({ userId: "005bb00000ftouDAAQ" })).toBe("005bb00000ftouDAAQ");
    expect(resolveApproverUserId({ userId: "005bb00000ftouD" })).toBe("005bb00000ftouD");
  });

  it("refuses a display name, an email and an empty view", () => {
    // The exact value the panel used to send. It failed the org's running
    // identity check before the token was ever redeemed.
    expect(resolveApproverUserId({ user: "Fabian Goetzens" })).toBeNull();
    expect(resolveApproverUserId({ user: "fabian.goetzens@connectry.io" })).toBeNull();
    expect(resolveApproverUserId({})).toBeNull();
    expect(resolveApproverUserId(undefined)).toBeNull();
  });

  it("refuses an id of another sObject type", () => {
    expect(resolveApproverUserId({ userId: "001bb00001DLtRMAA1" })).toBeNull(); // Account
    expect(resolveApproverUserId({ userId: "a34bb00000399FFAAY" })).toBeNull(); // valuation
  });

  it("prefers the staged userId over anything in the display field", () => {
    expect(resolveApproverUserId({ user: "Fabian Goetzens", userId: "005bb00000ftouDAAQ" })).toBe("005bb00000ftouDAAQ");
  });

  it("trims surrounding whitespace rather than sending it", () => {
    expect(resolveApproverUserId({ userId: "  005bb00000ftouDAAQ " })).toBe("005bb00000ftouDAAQ");
  });
});

/* =========================================================== THE LOST ANSWER

   The founder's 502, 2026-09-13: the org staged STG-0000000149 cleanly and the
   answer never reached the page. What the org does when the same key comes back
   is read from the Apex, not assumed:

     C360ActionStaging.stagePlan       a key it has seen returns THAT row and a
                                       NULL decisionToken, never a second row.
     Execute*.cls (findCompleted)      a key that already produced a record
                                       replays that run's tracker and writes
                                       nothing.

   So the stage lane re-asks under the same key, and where the org comes back
   holding the plan with no token to run it, re-issues the identical plan under a
   fresh key, which is the only way Salesforce will mint one. The execute lane
   re-asks and then falls back to the org's own trail.                         */

describe("stage_*: a lost answer is asked again under the same key", () => {
  const KEY = "idem-relay-1";
  const STAGE_PAYLOAD = { idempotencyKey: KEY, collateralId: "a34bb00000398KnAAI", value: 1000 };

  /** A trail response carrying whatever rows the test wants. */
  const trail = (entries: Array<Record<string, unknown>>) => ({
    content: [{ actionName: "Customer360ActionHistory", errors: null, isSuccess: true, outputValues: { accountId: "001", count: entries.length, entries }, sortOrder: 0, version: 1 }],
  });

  /** One mock over both lanes: the write tool and the trail read. */
  function installLanes(answer: (tool: string, input: Record<string, unknown>) => unknown) {
    const callTool = vi.fn(async (_s: string, tool: string, input: unknown, _o?: unknown) => {
      const out = answer(tool, (input ?? {}) as Record<string, unknown>);
      if (out instanceof Error) throw out;
      if (out && typeof out === "object" && "code" in (out as Record<string, unknown>)) throw out;
      return { payload: out };
    });
    w.claude = { mcp: { callTool, watchTool: vi.fn(), listTools: vi.fn(), invalidate: vi.fn() } };
    return callTool;
  }

  const keysSent = (callTool: ReturnType<typeof vi.fn>) =>
    callTool.mock.calls
      .filter((c) => String(c[1]).startsWith("stage_"))
      .map((c) => ((c[2] as { inputs: Array<Record<string, unknown>> }).inputs[0].idempotencyKey));

  it("refuses a payload with no idempotency key rather than letting the org throw", async () => {
    const callTool = installLanes(() => envelope(STAGE_RESULT));
    const out = await stageAction("collateral-valuation", { collateralId: "x" } as never);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("NO_IDEMPOTENCY_KEY");
    expect(callTool).not.toHaveBeenCalled();
  });

  it("never caches the staging call, and is licensed to ask again", async () => {
    // The flag itself stays inside the call layer and is never sent upstream;
    // what it buys is observable here, where a lost answer costs three asks
    // instead of one.
    vi.useFakeTimers();
    try {
      const callTool = installLanes(() => ({ code: "server_unavailable", message: "request failed (502)" }));
      const seen = stageAction("collateral-valuation", STAGE_PAYLOAD as never).catch((e) => e);
      await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 100);
      await seen;
      expect(callTool.mock.calls[0][3]).toMatchObject({ cache: false });
      expect(keysSent(callTool)).toEqual([KEY, KEY, KEY]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-asks with the same key and reports the attempts", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const callTool = installLanes(() => (++n === 1 ? { code: "server_unavailable", message: "request failed (502)" } : envelope(STAGE_RESULT)));
      const p = stageAction("collateral-valuation", STAGE_PAYLOAD as never);
      await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 100);
      const out = await p;
      expect(out.ok).toBe(true);
      expect(out.attempts).toBe(2);
      expect(keysSent(callTool)).toEqual([KEY, KEY]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-issues under a FRESH key when the org replays the row with no token", async () => {
    /* The incident's exact shape: ask one lands and its answer is lost, ask two
       comes back `replayed: true` with the row the org already holds and a null
       token, which no confirm gate can execute. */
    vi.useFakeTimers();
    try {
      let n = 0;
      const callTool = installLanes((tool) => {
        if (!tool.startsWith("stage_")) return trail([]);
        n += 1;
        if (n === 1) return { code: "server_unavailable", message: "request failed (502)" };
        if (n === 2) {
          return envelope({ ...STAGE_RESULT, result: { ...STAGE_RESULT.result, stagingId: "a8abb00000STG149", decisionToken: null, replayed: true } });
        }
        return envelope({ ...STAGE_RESULT, result: { ...STAGE_RESULT.result, stagingId: "a8abb00000STG150", decisionToken: "dt-server-002", replayed: false } });
      });
      const p = stageAction("collateral-valuation", STAGE_PAYLOAD as never, { accountId: "001bb00001DLtRMAA1" });
      await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 100);
      const out = await p;
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.decisionToken).toBe("dt-server-002");
      expect(out.result.stagingId).toBe("a8abb00000STG150");
      // The row the lost ask left behind is NAMED, never hidden.
      expect(out.reissuedFrom).toBe("a8abb00000STG149");
      expect(out.attempts).toBe(3);
      // Two asks on the original key, one on the derived key. No third row.
      expect(keysSent(callTool)).toEqual([KEY, KEY, `${KEY}#r2`]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a replay the BANKER asked for exactly as the org answered it", async () => {
    // No lost answer anywhere: one ask, one replay. The gate's own copy already
    // tells the banker to stage again, and nothing may mint a second row behind
    // their back.
    const callTool = installLanes(() => envelope({ ...STAGE_RESULT, result: { ...STAGE_RESULT.result, decisionToken: null, replayed: true } }));
    const out = await stageAction("collateral-valuation", STAGE_PAYLOAD as never);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.decisionToken).toBeNull();
    expect(keysSent(callTool)).toEqual([KEY]);
  });

  it("reads the trail when every ask is spent, and NAMES the row the org is holding", async () => {
    vi.useFakeTimers();
    try {
      installLanes((tool) =>
        tool.startsWith("stage_")
          ? { code: "server_unavailable", message: "request failed (502)" }
          : trail([
              {
                stagingId: "STG-0000000149",
                actionId: "collateral-valuation",
                status: "Staged",
                createdDate: new Date().toISOString(),
                productPackageId: "a5Fbb000000HA1NEAW",
              },
            ]),
      );
      const seen = stageAction("collateral-valuation", STAGE_PAYLOAD as never, {
        accountId: "001bb00001DLtRMAA1",
        productPackageId: "a5Fbb000000HA1NEAW",
      }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 100);
      const e = await seen;
      expect(isLostWriteAnswer(e)).toBe(true);
      expect(e.stagedAnyway?.stagingId).toBe("STG-0000000149");
      expect(e.attempts).toBe(3);
      expect(e.said).toContain("STG-0000000149");
      expect(e.said).toContain("Nothing has been executed");
      // And it never claims nothing happened.
      expect(e.said).not.toMatch(/nothing has been filed/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says what IS known when the trail holds no row for this action", async () => {
    vi.useFakeTimers();
    try {
      installLanes((tool) => (tool.startsWith("stage_") ? { code: "server_unavailable", message: "request failed (502)" } : trail([])));
      const seen = stageAction("collateral-valuation", STAGE_PAYLOAD as never, { accountId: "001bb00001DLtRMAA1" }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 100);
      const e = await seen;
      expect(isLostWriteAnswer(e)).toBe(true);
      expect(e.stagedAnyway).toBeUndefined();
      expect(e.said).toContain("nothing has been filed against the relationship");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not chase a refusal: a denial travels as it always has", async () => {
    installLanes(() => ({ code: "needs_reauth", message: "the session is no longer authorised" }));
    await expect(stageAction("collateral-valuation", STAGE_PAYLOAD as never, { accountId: "001" })).rejects.toMatchObject({
      code: "needs_reauth",
    });
  });
});

describe("execute_*: the outcome comes off the org's trail when the wire loses it", () => {
  const EXEC = {
    idempotencyKey: "idem-relay-2",
    stagingId: "a8abb00001KtalSAAR",
    planHash: "9f2c1d",
    decisionToken: "dt-server-001",
    approverUserId: "005xx0000012345",
  };

  const trailRow = (row: Record<string, unknown>) => ({
    content: [{ actionName: "Customer360ActionHistory", errors: null, isSuccess: true, outputValues: { accountId: "001", count: 1, entries: [row] }, sortOrder: 0, version: 1 }],
  });

  function installLanes(answer: (tool: string) => unknown) {
    const callTool = vi.fn(async (_s: string, tool: string) => {
      const out = answer(tool);
      if (out && typeof out === "object" && "code" in (out as Record<string, unknown>)) throw out;
      return { payload: out };
    });
    w.claude = { mcp: { callTool, watchTool: vi.fn(), listTools: vi.fn(), invalidate: vi.fn() } };
    return callTool;
  }

  it("lands the run the org actually made, read back from the trail", async () => {
    vi.useFakeTimers();
    try {
      let status = "Staged";
      installLanes((tool) => {
        if (tool.startsWith("execute_")) {
          // Every ask is lost; the run itself completed in the org.
          status = "Completed";
          return { code: "server_unavailable", message: "request failed (502)" };
        }
        return trailRow({
          stagingId: EXEC.stagingId,
          actionId: "collateral-valuation",
          status,
          resultRecordName: "VAL-0000123",
          steps: [{ id: "s1", type: "write", label: "Create the valuation", state: "verified", verification: "re-queried" }],
        });
      });
      const p = executeAction("collateral-valuation", EXEC, { accountId: "001bb00001DLtRMAA1" });
      await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 60_000);
      const out = await p;
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.recovered).toBe(true);
      expect(out.result.terminalState).toBe("success");
      expect(out.result.recordName).toBe("VAL-0000123");
      expect(out.result.steps.map((s) => s.state)).toEqual(["verified"]);
      expect(out.result.outcome).toContain("Completed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nobody knows yet while the org is still working, and never says it failed", async () => {
    vi.useFakeTimers();
    try {
      installLanes((tool) =>
        tool.startsWith("execute_")
          ? { code: "server_unavailable", message: "request failed (502)" }
          : trailRow({ stagingId: EXEC.stagingId, actionId: "collateral-valuation", status: "Executing" }),
      );
      const p = executeAction("collateral-valuation", EXEC, { accountId: "001bb00001DLtRMAA1" });
      await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 60_000);
      const out = await p;
      expect(out.ok).toBe(false);
      expect(out.pending).toBe(true);
      if (out.ok) return;
      expect(out.error.message).toContain("still working");
      // It states the ONE thing that is true and never the verdict: a run the
      // org has not settled is not a run that failed.
      expect(out.error.message).toContain("Nothing here says it failed");
      expect(out.error.message).not.toMatch(/did not go through|this failed/i);
      expect(out.error.resumable).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops re-asking once the trail says the first ask reached Apex", async () => {
    vi.useFakeTimers();
    try {
      const callTool = installLanes((tool) =>
        tool.startsWith("execute_")
          ? { code: "server_unavailable", message: "request failed (502)" }
          : trailRow({ stagingId: EXEC.stagingId, actionId: "collateral-valuation", status: "Executing" }),
      );
      const p = executeAction("collateral-valuation", EXEC, { accountId: "001bb00001DLtRMAA1" });
      await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 60_000);
      await p;
      // ONE execute. The token is consumed or consuming, and a second ask beside
      // an open transaction is the one thing that could file twice.
      expect(callTool.mock.calls.filter((c) => String(c[1]).startsWith("execute_"))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports the transport as the room's own sentence, with the platform code behind it", () => {
    expect(toolErrorCopy({ code: "TRANSPORT", message: "request failed (502)" })).toMatch(/^Salesforce did not get its answer back/);
    expect(toolErrorCopy({ code: "TRANSPORT", message: "request failed (502)" })).toContain("(request failed (502))");
    // A room that wrote its own sentence keeps it, with the code in parentheses.
    expect(toolErrorCopy({ code: "TRANSPORT", message: "Salesforce holds this plan as STG-149.", orgError: "server_unavailable" })).toBe(
      "Salesforce holds this plan as STG-149. (server_unavailable)",
    );
    // A DOMAIN refusal is the org speaking, and is never dressed up.
    expect(toolErrorCopy({ code: "VALIDATION_FAILED", message: "Type: bad value" })).toBe("Type: bad value");
  });
});
