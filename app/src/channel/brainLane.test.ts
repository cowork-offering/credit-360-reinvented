import { describe, expect, it } from "vitest";
import {
  askBrain,
  composeBrainPrompt,
  NO_ANSWER_CLARIFY,
  NOT_CONNECTED_CLARIFY,
  parseBrainReply,
  restateProposal,
  UNREADABLE_CLARIFY,
  type BrainDeltaProposal,
  type BrainEnvelope,
} from "./brainLane";

/* =============================================================================
   THE BRAIN LANE, HELD TO ITS CONTRACT.

   A model reply is untrusted text arriving from outside this page. The whole
   point of the validator is that NOTHING the brain can say reaches the glass
   unless it is exactly one of the three shapes, so the fuzz cases below are not
   decoration: each one is a reply a real model has produced or plausibly will,
   and every one of them must degrade to the neutral clarify rather than render.
   ============================================================================= */

const envelope: BrainEnvelope = {
  v: 2,
  line: "which borrowers have we already in the package?",
  room: "facility",
  relationship: "Hartwell Precision Manufacturing LLC",
  route: "modify",
  packageName: "Hartwell Industrial C&I Credit Package",
  productPackageId: "a5Fbb000000IHFJEA4",
  selectedFacility: null,
  facilities: [{ loanId: "a4Zbb0000027MaYEAU", label: "Line of Credit", commitment: "$15.0M" }],
  staged: [],
  grounding: "plugin-skill:workroom-brain",
};

const READ_CARD = {
  type: "read-card",
  topic: "involvements",
  title: "Borrowing structure on the Hartwell package",
  rows: [{ icon: "borrower", label: "Hartwell Precision Manufacturing LLC", value: "Borrower", sub: "all 6 facilities" }],
  followUp: "Who should be added, and on which facility?",
};

const DELTA: BrainDeltaProposal = {
  type: "delta-proposal",
  action: "loan-modification",
  rationale: "Client requested a seasonal working capital increase ahead of Q4 build.",
  facilityIds: ["a4Zbb0000027MaYEAU"],
  changes: { scalarChangesJson: [{ key: "requestedAmount", value: 20000000 }] },
};

const CLARIFY = {
  type: "clarify",
  text: "Which line do you mean? The relationship carries two.",
  options: [{ label: "Revolving line, $15.0MM", say: "the revolving line of credit" }],
};

describe("the validator accepts the three shapes, and only in contract", () => {
  it("takes a read-card with every required field", () => {
    const parsed = parseBrainReply(JSON.stringify(READ_CARD));
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.reply.type).toBe("read-card");
  });

  it("takes a delta-proposal carrying one of the seven wire keys", () => {
    expect(parseBrainReply(JSON.stringify(DELTA)).ok).toBe(true);
  });

  it("takes a clarify, with and without its closed answer set", () => {
    expect(parseBrainReply(JSON.stringify(CLARIFY)).ok).toBe(true);
    expect(parseBrainReply(JSON.stringify({ type: "clarify", text: "Which facility?" })).ok).toBe(true);
  });

  it("reads a reply the model fenced or prefaced, because models do that", () => {
    const fenced = "Here is the answer.\n```json\n" + JSON.stringify(READ_CARD) + "\n```\nHope that helps.";
    expect(parseBrainReply(fenced).ok).toBe(true);
  });

  it("does not close the object on a brace inside a quoted value", () => {
    const tricky = { type: "clarify", text: 'Which one? The org calls it "{Line of Credit}" here.' };
    const parsed = parseBrainReply("prose " + JSON.stringify(tricky));
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.reply.type === "clarify" && parsed.reply.text).toMatch(/Line of Credit/);
  });
});

describe("the validator refuses everything else, and never half-accepts", () => {
  /** Each case is a reply that must NOT render. The reason is asserted so a
   *  future loosening of one branch cannot silently loosen another. */
  const fuzz: Array<[string, string, string]> = [
    ["an empty answer", "", "empty"],
    ["whitespace only", "   \n  ", "empty"],
    ["prose with no object at all", "The package carries six facilities.", "not-json"],
    ["an unterminated object", '{"type":"clarify","text":"which one', "not-json"],
    ["a JSON array", "[1,2,3]", "not-json"],
    ["a JSON string", '"just a string"', "not-json"],
    ["a fourth shape", JSON.stringify({ type: "answer", text: "hello" }), "unknown-type"],
    ["no type at all", JSON.stringify({ title: "x", rows: [] }), "unknown-type"],
    ["a read-card with no rows", JSON.stringify({ ...READ_CARD, rows: [] }), "bad-read-card"],
    ["a read-card whose rows are strings", JSON.stringify({ ...READ_CARD, rows: ["a", "b"] }), "bad-read-card"],
    [
      "a read-card row missing its value",
      JSON.stringify({ ...READ_CARD, rows: [{ icon: "borrower", label: "x" }] }),
      "bad-read-card",
    ],
    ["a read-card with no title", JSON.stringify({ ...READ_CARD, title: "" }), "bad-read-card"],
    ["a delta with no rationale", JSON.stringify({ ...DELTA, rationale: "" }), "bad-delta"],
    ["a delta with no change at all", JSON.stringify({ ...DELTA, changes: {} }), "bad-delta"],
    [
      "a delta carrying BOTH facilityIds and loanId",
      JSON.stringify({ ...DELTA, loanId: "a4Zbb0000027MaYEAU" }),
      "bad-delta",
    ],
    [
      "a delta naming a scalar key the tool does not have",
      JSON.stringify({ ...DELTA, changes: { scalarChangesJson: [{ key: "requestedVibes", value: 1 }] } }),
      "bad-delta",
    ],
    [
      "a covenant add with an operator outside the five",
      JSON.stringify({
        ...DELTA,
        changes: { covenantAddsJson: [{ typeName: "Debt Service Coverage", threshold: 1.25, operator: "~=" }] },
      }),
      "bad-delta",
    ],
    [
      "a percentage fee that also carries an amount",
      JSON.stringify({
        ...DELTA,
        changes: { feeAddsJson: [{ feeType: "Loan Origination", calculationType: "Percentage", percentage: 0.5, amount: 150000 }] },
      }),
      "bad-delta",
    ],
    [
      "a pledge carrying both an existing asset and a new one",
      JSON.stringify({
        ...DELTA,
        changes: {
          pledgeAddsJson: [
            { collateralId: "a35bb0000013xz3AAA", newCollateral: { description: "x", collateralType: "Equipment", value: 1 } },
          ],
        },
      }),
      "bad-delta",
    ],
    [
      "a pledge carrying neither shape",
      JSON.stringify({ ...DELTA, changes: { pledgeAddsJson: [{ amountPledged: 100 }] } }),
      "bad-delta",
    ],
    [
      "a policy exception taking the org's Unmitigated default by omission",
      JSON.stringify({ ...DELTA, changes: { policyExceptionAddsJson: [{ title: "Advance rate above guideline" }] } }),
      "bad-delta",
    ],
    [
      "a policy exception with a status the org does not hold",
      JSON.stringify({ ...DELTA, changes: { policyExceptionAddsJson: [{ title: "x", status: "Pending" }] } }),
      "bad-delta",
    ],
    [
      "an involvement change naming nobody",
      JSON.stringify({ ...DELTA, changes: { involvementChangesJson: [{ op: "add", role: "Guarantor" }] } }),
      "bad-delta",
    ],
    [
      "a change list that is not a list",
      JSON.stringify({ ...DELTA, changes: { scalarChangesJson: { key: "requestedAmount", value: 1 } } }),
      "bad-delta",
    ],
    [
      "a targetLoanId that is not a string",
      JSON.stringify({ ...DELTA, changes: { scalarChangesJson: [{ key: "requestedAmount", value: 1, targetLoanId: 7 }] } }),
      "bad-delta",
    ],
    ["a clarify with no text", JSON.stringify({ type: "clarify" }), "bad-clarify"],
    [
      "a clarify whose options carry no sayable line",
      JSON.stringify({ type: "clarify", text: "which?", options: [{ label: "the revolver" }] }),
      "bad-clarify",
    ],
  ];

  it.each(fuzz)("refuses %s", (_name, raw, why) => {
    const parsed = parseBrainReply(raw);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.why).toBe(why);
  });

  it("drops the WHOLE list when one entry of it is malformed", () => {
    // A half-read change list would stage some of what the brain proposed and
    // silently drop the rest, which is the one outcome worse than refusing.
    const half = {
      ...DELTA,
      changes: {
        scalarChangesJson: [
          { key: "requestedAmount", value: 20000000 },
          { key: "requestedNonsense", value: 1 },
        ],
      },
    };
    expect(parseBrainReply(JSON.stringify(half)).ok).toBe(false);
  });
});

describe("a proposal is restated as a sentence the parser already stages on", () => {
  const name = (id: string | undefined) => (id === "a4Zbb0000027MaYEAU" ? "Line of Credit" : null);

  it("says a commitment the way the banker would", () => {
    const { lines, dropped } = restateProposal(DELTA, name);
    expect(dropped).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0].say).toBe("take the Line of Credit to $20,000,000");
  });

  it("names the member a targetLoanId points at, not the one that was selected", () => {
    const two: BrainDeltaProposal = {
      ...DELTA,
      facilityIds: ["a4Zbb0000027MaYEAU", "a4Zbb0000027MnREAU"],
      changes: {
        scalarChangesJson: [
          { key: "requestedAmount", value: 20000000, targetLoanId: "a4Zbb0000027MaYEAU" },
          { key: "requestedTermMonths", value: 240, targetLoanId: "a4Zbb0000027MnREAU" },
        ],
      },
    };
    const { lines } = restateProposal(two, (id) =>
      id === "a4Zbb0000027MaYEAU" ? "Line of Credit" : id === "a4Zbb0000027MnREAU" ? "Equipment Loan" : null,
    );
    expect(lines.map((l) => l.say)).toEqual([
      "take the Line of Credit to $20,000,000",
      "give the Equipment Loan a 240 month term",
    ]);
  });

  it("says a maturity, a rate, a covenant, a party, a fee, a pledge and an exception", () => {
    const wide: BrainDeltaProposal = {
      ...DELTA,
      changes: {
        scalarChangesJson: [
          { key: "requestedMaturityDate", value: "2028-03-15" },
          { key: "requestedRate", value: 8.1 },
        ],
        covenantAddsJson: [{ typeName: "Debt Service Coverage", threshold: 1.25, operator: ">=" }],
        involvementChangesJson: [{ op: "add", role: "Guarantor", accountName: "Hartwell Logistics LLC" }],
        feeAddsJson: [{ feeType: "Loan Origination", calculationType: "Percentage", percentage: 0.5 }],
        pledgeAddsJson: [{ newCollateral: { description: "Kokomo CNC cell", collateralType: "Equipment", value: 3200000 } }],
        policyExceptionAddsJson: [{ title: "Advance rate above guideline", status: "Mitigated" }],
      },
    };
    const { lines } = restateProposal(wide, name);
    expect(lines.map((l) => l.say)).toEqual([
      "move the Line of Credit maturity to 2028-03-15",
      "move the Line of Credit rate to 8.1%",
      "add a Debt Service Coverage covenant >= 1.25 on the Line of Credit",
      "add Hartwell Logistics LLC as a Guarantor on the Line of Credit",
      "add a 0.5% Loan Origination fee on the Line of Credit",
      "add a new $3,200,000 Equipment as collateral on the Line of Credit",
      "log a policy exception: Advance rate above guideline, mitigated on the Line of Credit",
    ]);
  });

  it("DROPS what it has no proven phrasing for rather than inventing one", () => {
    // An existing pledge by id, and a party named only by record id: the parser
    // resolves assets by description and parties by name, so neither carries a
    // sentence a banker could have typed.
    const unsayable: BrainDeltaProposal = {
      ...DELTA,
      changes: {
        pledgeAddsJson: [{ collateralId: "a35bb0000013xz3AAA" }],
        involvementChangesJson: [{ op: "add", accountId: "001bb00001I7NZkAAN" }],
      },
    };
    const { lines, dropped } = restateProposal(unsayable, name);
    expect(lines).toHaveLength(0);
    expect(dropped).toBe(2);
  });
});

describe("the wire never hands the room something it cannot draw", () => {
  it("carries the doctrine itself, not a pointer at a pack that never loads", () => {
    const prompt = composeBrainPrompt(envelope);
    // THE MARKER STAYS. A session that HAS loaded the pack should still be told
    // the pack is the authority.
    expect(prompt).toMatch(/WORKROOM-BRAIN\.md/);
    expect(prompt).toMatch(/plugin-skill:workroom-brain/);
    // The banker's line travels verbatim.
    expect(prompt).toContain("which borrowers have we already in the package?");
    // And the contract is restated, so a responder that has never seen the pack
    // still fails closed on shape rather than answering ungrounded prose.
    expect(prompt).toMatch(/EXACTLY ONE JSON object/);
    expect(prompt).toMatch(/Never write/);
  });

  /* THE PACK NEVER ARRIVES. The gateway calls a model that has never read
     WORKROOM-BRAIN.md, so the doctrine the answer depends on has to travel in
     the prompt. What is asserted here is that the slices are IN it: the rules
     whose absence makes an answer wrong, and the fences of whichever surface
     the line is about. */
  describe("the doctrine travels in the prompt", () => {
    const promptFor = (line: string) => composeBrainPrompt({ ...envelope, line });

    it("never lets an index name be invented, on any line", () => {
      const prompt = promptFor("what is the rate on the revolver");
      expect(prompt).toMatch(/IT STORES NO INDEX NAME/);
      expect(prompt).toMatch(/Never say "SOFR", "Prime", "LIBOR"/);
    });

    it("carries the covenant bands as proposal guidance on every line", () => {
      const prompt = promptFor("anything at all");
      expect(prompt).toMatch(/DSCR minimum 1\.20x to 1\.25x/);
      expect(prompt).toMatch(/FCCR minimum 1\.15x to 1\.25x/);
      expect(prompt).toMatch(/Debt to tangible net worth maximum 3\.00x/);
      // A band is offered. It is never stated as a fact about this borrower and
      // it is never applied as a threshold.
      expect(prompt).toMatch(/Bands are PROPOSAL guidance/);
      expect(prompt).toMatch(/Propose a band, never a threshold/);
    });

    it("carries the covenant fences on a covenant line", () => {
      const prompt = promptFor("add another covenant to all of the loans");
      expect(prompt).toMatch(/covenant ADD is safe/i);
      expect(prompt).toMatch(/AMEND and DETACH are REFUSED/);
      expect(prompt).toMatch(/effective date is set once at creation and is never updated/);
      expect(prompt).toMatch(/Exception alone is never a breach/);
    });

    it("carries the collateral fences on a collateral line", () => {
      const prompt = promptFor("pledge the warehouse to the equipment loan");
      expect(prompt).toMatch(/advance rate on a pledge is a formula/);
      expect(prompt).toMatch(/Never ask a banker for either and never invent a valuation/);
    });

    it("carries the fee fences on a fee line", () => {
      const prompt = promptFor("add a 1% origination fee");
      expect(prompt).toMatch(/percentage OR a fixed amount, never both/);
      expect(prompt).toMatch(/Never state a money figure beside a percentage/);
    });

    it("sends only the slices the line needs, so the envelope keeps its room", () => {
      const covenant = promptFor("add a DSCR covenant of 1.25x");
      expect(covenant).not.toMatch(/percentage OR a fixed amount/);
      expect(covenant).not.toMatch(/INVOLVEMENT ROLES/);
    });
  });

  it("degrades a malformed reply to the neutral clarify", async () => {
    const reply = await askBrain(envelope, { send: async () => "I think you should raise it." });
    expect(reply).toEqual(UNREADABLE_CLARIFY);
  });

  /* CHANGED 2026-09-12 (founder: "avoid any fallbacks", the fallback audit).
     A door that threw produced NO reply, and telling the banker the reply could
     not be read is a false statement about the desk, followed by "try asking
     directly", which points back at the path that just failed. The two failures
     are now told apart: this one says the desk did not answer, and the
     malformed-reply case above still degrades as unreadable. */
  it("says the desk did not answer when the transport failed, not that the reply was unreadable", async () => {
    const reply = await askBrain(envelope, {
      send: async () => {
        throw { code: "server_unavailable", message: "gateway down" };
      },
    });
    expect(reply).toEqual(NO_ANSWER_CLARIFY);
    expect(reply).not.toEqual(UNREADABLE_CLARIFY);
    // Rule 4: it still hands the banker a move the room can actually take.
    expect(NO_ANSWER_CLARIFY.text).toMatch(/say the change you want/i);
  });

  it("names the delay honestly when the desk does not come back", async () => {
    const reply = await askBrain(envelope, { send: () => new Promise<string>(() => {}), timeoutMs: 10 });
    expect(reply.type).toBe("clarify");
    expect(reply.type === "clarify" && reply.text).toMatch(/has not come back/);
    // It never hangs and it never claims an answer it does not have.
    expect(reply.type === "clarify" && reply.text).not.toMatch(/covenant|facility/i);
  });

  it("passes a valid reply through untouched", async () => {
    const reply = await askBrain(envelope, { send: async () => JSON.stringify(CLARIFY) });
    expect(reply.type).toBe("clarify");
    expect(reply.type === "clarify" && reply.options).toHaveLength(1);
  });

  it("says NOT CONNECTED rather than waiting on a bridge that is not there", async () => {
    // No injected transport and no `window.claude.mcp` in this environment.
    const reply = await askBrain(envelope);
    expect(reply).toEqual(NOT_CONNECTED_CLARIFY);
  });
});
