import { describe, expect, it, vi } from "vitest";
import { BRAIN_TOOL_NAMES, READ_DOORS, assertReadDoor, buildBrainTools, type BrainToolCall } from "./brainTools";
import { SERVERS, TOOLS } from "./mcp";

/* =============================================================================
   THE TWO CALL-OUTS, HELD TO THE WRITE FENCE.

   This suite exists for one assertion above all others: no path from a model
   reply reaches a door that writes. Everything else here is about keeping the
   list short and the results small, because every extra tool and every extra
   byte is another paid round on the banker's own account.
   ============================================================================= */

const ANCHOR = { accountId: "001bb00001I7NZkAAN", company: "Hartwell Precision Manufacturing LLC" };
const ctx = { signal: new AbortController().signal };

const graphPayload = {
  content: [
    {
      isSuccess: true,
      outputValues: {
        legalEntities: [
          { accountName: "Hartwell Precision Manufacturing LLC", borrowerType: "Borrower", loanId: null, ownershipPercent: 100 },
          { accountName: "Hartwell Industrial Holdings LLC", borrowerType: "Guarantor", loanId: "a4Zbb0000027MaYEAU" },
        ],
      },
    },
  ],
};

const stub = (payload: unknown): BrainToolCall => vi.fn(async () => ({ payload }));

describe("the list is exactly three, each narrow", () => {
  it("builds those three tools and no others", () => {
    const tools = buildBrainTools({ anchor: ANCHOR, call: stub({}) });
    expect(tools.map((t) => t.name)).toEqual([...BRAIN_TOOL_NAMES]);
  });

  it("offers the counterparty door ONLY where the room named an account", () => {
    // No anchor account is no bound relationship, and a downstream read with
    // nothing to bound it against is the free wander this module refuses.
    const loose = buildBrainTools({ anchor: { accountId: null, company: "Hartwell" }, call: stub({}) });
    expect(loose.map((t) => t.name)).toEqual(["currentBoomRatios", "liveInvolvements"]);
  });

  it("binds the two relationship tools to the room, and the third to the anchored graph", () => {
    const [boom, parties, connected] = buildBrainTools({ anchor: ANCHOR, call: stub({}) });
    // Neither of the first two takes an argument, so neither can be pointed at
    // another borrower at all.
    expect(boom.inputSchema).toBeUndefined();
    expect(parties.inputSchema).toBeUndefined();
    /* The third takes exactly ONE, and its bound is enforced in `execute`
       against the anchored graph's own connections (see the refusal below).

       THE ARGUMENT IS THE ID FIRST (2026-09-12, backlog item 14b). The group
       block on the envelope now carries each counterparty's own `counterpartyId`
       and the schema points at it by that name: four parties on Hartwell share
       the word "Hartwell", and a name is the one handle that can be ambiguous.
       The name stays legal because a graph row can carry no id. */
    expect(connected.inputSchema).toEqual({
      type: "object",
      properties: {
        accountId: {
          type: "string",
          description:
            "The counterpartyId CONTEXT.reads.group carries for that party. Use its name from the same block only where the row carries no id: four parties on one relationship can share a name prefix, and the id never does.",
        },
      },
      required: ["accountId"],
    });
  });

  it("names the cheaper source in every description, because models over-call", () => {
    for (const tool of buildBrainTools({ anchor: ANCHOR, call: stub({}) })) {
      expect(tool.description).toMatch(/ONLY/);
      expect(tool.description).toMatch(/context/i);
      expect(tool.description.length).toBeLessThanOrEqual(1024);
      expect(tool.description).not.toMatch(/[—–]/);
    }
  });
});

describe("the write fence is absolute", () => {
  it("allows exactly the four read doors, and every one of them is a read", () => {
    // The two the relationship's own tools open, and the two `connectedPartyBook`
    // points at a counterparty the anchored graph already connects. Nothing is
    // added here without the fence being re-argued.
    expect([...READ_DOORS].sort()).toEqual([TOOLS.boomRatios, TOOLS.graph, TOOLS.exposure, TOOLS.covenants].sort());
  });

  it("admits no stage or execute door to the allow-list", () => {
    for (const door of READ_DOORS) {
      expect(door).not.toMatch(/^stage_/);
      expect(door).not.toMatch(/^execute_/);
    }
    // And every write tool the connector layer knows about is outside it.
    const writers = Object.values(TOOLS).filter((t) => /^(stage|execute)_/.test(t));
    expect(writers.length).toBeGreaterThan(0);
    for (const w of writers) expect(READ_DOORS.has(w)).toBe(false);
  });

  it("refuses a write door before the connector is touched at all", () => {
    expect(() => assertReadDoor(TOOLS.stageLoanModification)).toThrow(/not a read door/);
    expect(() => assertReadDoor(TOOLS.executeLoanModification)).toThrow(/not a read door/);
    expect(() => assertReadDoor(TOOLS.stageNewFacility)).toThrow(/not a read door/);
    expect(() => assertReadDoor(TOOLS.boomRatios)).not.toThrow();
    expect(() => assertReadDoor(TOOLS.graph)).not.toThrow();
  });

  it("never names anything but a read door, on either tool", async () => {
    const call = vi.fn(async () => ({ payload: graphPayload }));
    for (const tool of buildBrainTools({ anchor: ANCHOR, call })) {
      await Promise.resolve(tool.execute({}, ctx)).catch(() => null);
    }
    for (const [, door] of call.mock.calls as unknown as Array<[string, string]>) {
      expect(READ_DOORS.has(door)).toBe(true);
    }
  });

  it("calls every door as a READ", async () => {
    const call = vi.fn(async () => ({ payload: graphPayload }));
    const tools = buildBrainTools({ anchor: ANCHOR, call });
    for (const tool of tools) await tool.execute({}, ctx);
    for (const args of call.mock.calls as unknown as Array<[string, string, unknown, { read: boolean }]>) {
      expect(args[3].read).toBe(true);
    }
  });
});

describe("currentBoomRatios", () => {
  it("reads the gateway ratios door for the bound company", async () => {
    const call = stub({ ratios: { totalLeverage: 2.8, interestCoverage: 6.1, ebitda: 9_400_000 } });
    const [boom] = buildBrainTools({ anchor: ANCHOR, call });
    const out = await boom.execute({}, ctx);
    expect(call).toHaveBeenCalledWith(SERVERS.gateway, TOOLS.boomRatios, { company: ANCHOR.company }, expect.anything());
    expect(out).toEqual({ totalLeverage: 2.8, interestCoverage: 6.1, ebitda: 9_400_000 });
  });

  it("says the door carried no figures rather than returning an empty fact", async () => {
    const [boom] = buildBrainTools({ anchor: ANCHOR, call: stub({ ratios: {} }) });
    expect(await boom.execute({}, ctx)).toMatch(/no ratio figures/);
  });

  it("refuses without a bound company rather than reading somebody else's book", async () => {
    const call = stub({});
    const [boom] = buildBrainTools({ anchor: { accountId: "001", company: null }, call });
    expect(await boom.execute({}, ctx)).toMatch(/No company is bound/);
    expect(call).not.toHaveBeenCalled();
  });

  it("reports itself as an over-call where the envelope already carried pricing", () => {
    const held = buildBrainTools({
      anchor: ANCHOR,
      call: stub({}),
      reads: { pricing: [{ facility: "Line of Credit", rate: "7.25%" }], notCarried: [] },
    })[0];
    expect(held.heldAlready?.()).toBe(true);
    const needed = buildBrainTools({ anchor: ANCHOR, call: stub({}), reads: { notCarried: [] } })[0];
    expect(needed.heldAlready?.()).toBe(false);
  });
});

describe("liveInvolvements is the N4 gap, read live", () => {
  it("returns the union of the anchor's rows and its loans' rows, in role terms", async () => {
    const call = stub(graphPayload);
    const [, parties] = buildBrainTools({ anchor: ANCHOR, call });
    const out = await parties.execute({}, ctx);
    expect(call).toHaveBeenCalledWith(
      SERVERS.customer360,
      TOOLS.graph,
      { inputs: [{ accountId: ANCHOR.accountId }] },
      expect.anything(),
    );
    /* ONE ROW PER PARTY PER ROLE. The org writes the involvement once per loan,
       so the live read of a real book comes back with 22 rows for 5 parties;
       handed over raw the model counts rows and calls them obligations. The
       loan ids all travel, so nothing the org said is lost. */
    expect(out).toEqual([
      {
        name: "Hartwell Precision Manufacturing LLC",
        role: "Borrower",
        scope: "across the relationship",
        loanIds: undefined,
        ownership: 100,
        guaranty: null,
      },
      {
        name: "Hartwell Industrial Holdings LLC",
        role: "Guarantor",
        scope: "1 facility",
        loanIds: ["a4Zbb0000027MaYEAU"],
        ownership: null,
        guaranty: null,
      },
    ]);
  });

  it("collapses the org's row-per-loan into one row per party, keeping the loans", async () => {
    const sixLoans = ["L1", "L2", "L3", "L4", "L5", "L6"].map((loanId) => ({
      accountName: "Hartwell Industrial Holdings LLC",
      borrowerType: "Guarantor",
      guarantyAmountType: "Unlimited",
      loanId,
    }));
    const call = stub({ content: [{ isSuccess: true, outputValues: { legalEntities: sixLoans } }] });
    const [, parties] = buildBrainTools({ anchor: ANCHOR, call });
    expect(await parties.execute({}, ctx)).toEqual([
      {
        name: "Hartwell Industrial Holdings LLC",
        role: "Guarantor",
        scope: "6 facilities",
        loanIds: ["L1", "L2", "L3", "L4", "L5", "L6"],
        ownership: null,
        guaranty: "Unlimited",
      },
    ]);
  });

  it("reads a null loanId as relationship level, which is an answer and not a gap", async () => {
    const [, parties] = buildBrainTools({ anchor: ANCHOR, call: stub(graphPayload) });
    const out = (await parties.execute({}, ctx)) as Array<{ scope: string }>;
    expect(out[0].scope).toBe("across the relationship");
  });

  it("surfaces a per-element failure rather than reporting no parties", async () => {
    const failed = { content: [{ isSuccess: false, errors: "insufficient access" }] };
    const [, parties] = buildBrainTools({ anchor: ANCHOR, call: stub(failed) });
    expect(await parties.execute({}, ctx)).toMatch(/could not be read: insufficient access/);
  });

  it("says the graph carries no rows rather than returning an empty list", async () => {
    const empty = { content: [{ isSuccess: true, outputValues: { legalEntities: [] } }] };
    const [, parties] = buildBrainTools({ anchor: ANCHOR, call: stub(empty) });
    expect(await parties.execute({}, ctx)).toMatch(/no involvement rows/);
  });

  it("reports itself as an over-call where the envelope already carried involvements", () => {
    const held = buildBrainTools({
      anchor: ANCHOR,
      call: stub({}),
      reads: { involvements: [{ name: "Holdings", role: "Guarantor", scope: "all 6" }], notCarried: [] },
    })[1];
    expect(held.heldAlready?.()).toBe(true);
  });
});

/* =============================================================================
   connectedPartyBook — RULE 1'S LAST MILE, AND ITS FENCE.

   The envelope's `group` block says who stands around this borrower and
   `notCarried` refuses their own lending BY NAME, because no read on this
   cockpit opens another relationship's book. This tool is that read. Its whole
   safety is one check: the id must be a counterparty the ANCHORED graph
   connects, verified live before a single figure is fetched.
   ============================================================================= */

const HOLDINGS = "001bb00001HOLDINGS";
const connectionsPayload = {
  content: [
    {
      isSuccess: true,
      outputValues: {
        connections: [
          { counterpartyId: HOLDINGS, counterpartyName: "Hartwell Industrial Holdings LLC", role: "Parent", totalOwnershipPercent: 100 },
          { counterpartyId: "001bb00001LOGISTIC", counterpartyName: "Hartwell Logistics LLC", role: "Affiliated Company" },
          { counterpartyName: "Elena Hartwell", role: "Co-Owner" },
        ],
      },
    },
  ],
};

const holdingsExposure = {
  content: [
    {
      isSuccess: true,
      outputValues: {
        totalCommitted: 24_000_000,
        totalOutstanding: 18_400_000,
        facilities: [{ loanId: "L1" }, { loanId: "L2" }, { loanId: "L3" }],
      },
    },
  ],
};

const holdingsCovenants = {
  content: [
    {
      isSuccess: true,
      outputValues: {
        covenants: [
          { covenantType: "Minimum Debt Service Coverage", thresholdValue: 1.25, actualValue: 1.02, covenantStatus: "Breached" },
          { covenantType: "Maximum Debt to Worth", thresholdValue: 3, actualValue: 2.1, covenantStatus: "Compliant" },
        ],
      },
    },
  ],
};

/** A door-aware stub: the graph answers the bound check, the other two answer
 *  the counterparty's own read. */
const bookCall = (): BrainToolCall & { mock: { calls: unknown[][] } } =>
  vi.fn(async (_server: string, tool: string) => {
    if (tool === TOOLS.graph) return { payload: connectionsPayload };
    if (tool === TOOLS.exposure) return { payload: holdingsExposure };
    if (tool === TOOLS.covenants) return { payload: holdingsCovenants };
    return { payload: {} };
  }) as unknown as BrainToolCall & { mock: { calls: unknown[][] } };

const bookTool = (call: BrainToolCall, reads?: Parameters<typeof buildBrainTools>[0]["reads"]) =>
  buildBrainTools({ anchor: ANCHOR, call, reads })[2];

describe("connectedPartyBook is bound to the anchored graph", () => {
  it("refuses BY NAME any party the graph does not connect, and never opens their book", async () => {
    const call = bookCall();
    const out = await bookTool(call).execute({ accountId: "001bb00001STRANGER" }, ctx);
    expect(out).toBe(
      "001bb00001STRANGER is not connected to this relationship, so its book is not readable from this room." +
        " The graph connects Hartwell Industrial Holdings LLC, Hartwell Logistics LLC, Elena Hartwell.",
    );
    // The graph was read to CHECK. Neither of the two book doors was touched.
    const doors = (call.mock.calls as unknown as Array<[string, string]>).map(([, tool]) => tool);
    expect(doors).toEqual([TOOLS.graph]);
  });

  it("reads the counterparty's own committed, outstanding, facilities, covenants and grade", async () => {
    const call = bookCall();
    const reads = {
      group: [{ name: "Hartwell Industrial Holdings LLC", relation: "parent" as const, ownership: "100%", grade: "4" }],
      notCarried: [],
    };
    const out = await bookTool(call, reads).execute({ accountId: HOLDINGS }, ctx);
    expect(out).toEqual({
      party: "Hartwell Industrial Holdings LLC",
      relation: "Parent",
      committed: "$24M",
      outstanding: "$18.40M",
      facilities: 3,
      covenants: "2 on file, 1 in breach: Breached, Compliant",
      // Off the envelope's own group row: no third door is opened for a grade
      // this cockpit already carries.
      grade: "4",
      scope: "this counterparty's own book, not the relationship in view",
    });
    const doors = (call.mock.calls as unknown as Array<[string, string, unknown]>).map(([, tool]) => tool);
    expect(doors).toEqual([TOOLS.graph, TOOLS.exposure, TOOLS.covenants]);
    // Every book read is pointed at the COUNTERPARTY, never at the anchor.
    for (const [, tool, input] of call.mock.calls as unknown as Array<[string, string, { inputs: Array<{ accountId: string }> }]>) {
      if (tool === TOOLS.graph) expect(input.inputs[0].accountId).toBe(ANCHOR.accountId);
      else expect(input.inputs[0].accountId).toBe(HOLDINGS);
    }
  });

  it("takes the name the group block carries, because that is what the model holds", async () => {
    const out = (await bookTool(bookCall()).execute({ accountId: "hartwell industrial holdings llc" }, ctx)) as {
      party: string;
    };
    expect(out.party).toBe("Hartwell Industrial Holdings LLC");
  });

  it("says so where the graph names a party but carries no account id for them", async () => {
    const call = bookCall();
    expect(await bookTool(call).execute({ accountId: "Elena Hartwell" }, ctx)).toMatch(
      /carries no account id for them, so no read can be pointed at their book/,
    );
    expect((call.mock.calls as unknown as Array<[string, string]>).map(([, t]) => t)).toEqual([TOOLS.graph]);
  });

  it("is never an over-call: no read on this cockpit carries another party's book", () => {
    expect(bookTool(bookCall()).heldAlready?.()).toBe(false);
  });
});
