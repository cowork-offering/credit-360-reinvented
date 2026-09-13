import { describe, expect, it } from "vitest";
import type { BorrowerBundle, C360Data } from "../data/contract";
import { ACTIONS, ACTIONS_BY_ID, CATEGORY_ORDER, renderPrompt, stageRationale } from "./registry";

const ID = "001TEST";
const NAME = "Testco Industries, Inc.";

const PACKAGE = "a5Fbb000000FULLP1";
const VERSION_PACKAGE = "a5Fbb000000FULLV1";

/** A fully-capable bundle: booked active facility, collateral, covenants,
 *  Boom financials, a risk rating, and (0.9.23) one unbooked modification
 *  version of the booked package, so the discard door's own predicate has
 *  something to be capable of. The version is a member-for-member copy at
 *  Qualification, which is the shape `book/packages.ts` recognises as a fork
 *  and the shape nCino actually produces. Every predicate should pass. */
function fullBundle(): BorrowerBundle {
  return {
    snapshot: { accountId: ID, name: NAME, primaryRiskRating: "5" },
    exposure: {
      facilities: [
        {
          loanId: "L1",
          name: "Term Loan",
          productPackageId: PACKAGE,
          // A credit action runs only against a BOOKED facility, so the
          // fully-capable fixture has to actually be one.
          stage: "Booked",
          maturityDate: "2028-01-31",
          collateral: [{ collateralType: "Equipment", collateralValue: 100 }],
        },
        {
          loanId: "L1M",
          name: "Term Loan",
          productPackageId: VERSION_PACKAGE,
          stage: "Qualification",
          maturityDate: "2028-01-31",
        },
      ],
    },
    covenants: { covenants: [{ covenantType: "DSC", thresholdValue: 1.25, actualValue: 1.4 }] },
    boom: { ratios: { totalLeverage: 3.1 } },
  };
}

/** An onboarded relationship with nothing booked yet. */
function bareBundle(): BorrowerBundle {
  return { snapshot: { accountId: ID, name: NAME }, exposure: { facilities: [] } };
}

function dataWith(bundle: BorrowerBundle): C360Data {
  return {
    meta: { anchorAccountId: ID, generatedAt: "2026-07-02T09:15:00Z" },
    portfolio: { accounts: [{ accountId: ID, name: NAME }] },
    borrower: bundle,
    borrowers: { [ID]: bundle },
  } as unknown as C360Data;
}

const ALWAYS_AVAILABLE = ["new-facility-request", "create-service-request"];

describe("registry shape", () => {
  it("declares the eleven actions (A27.6, plus the 0.9.23 undo)", () => {
    expect(ACTIONS).toHaveLength(11);
    expect(ACTIONS.map((a) => a.id).sort()).toEqual(
      [
        "annual-review",
        "collateral-valuation",
        "covenant-review",
        "create-service-request",
        // THE ONLY ROW THAT TAKES SOMETHING OFF THE ORG (0.9.23).
        "discard-version",
        "draft-credit-memo",
        "generate-spreading",
        "loan-modification",
        "new-facility-request",
        "renewal",
        "risk-rating-review",
      ].sort(),
    );
  });

  it("gives every action a category from the four groups, an icon and a description", () => {
    for (const a of ACTIONS) {
      expect(CATEGORY_ORDER, `${a.id} category`).toContain(a.category);
      expect(a.icon.length).toBeGreaterThan(0);
      expect(a.description.trim().length, `${a.id} needs banker-language copy`).toBeGreaterThan(40);
      expect(a.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("templates both account placeholders in every prompt", () => {
    for (const a of ACTIONS) {
      expect(a.promptTemplate, `${a.id} must name the account`).toContain("{account}");
      expect(a.promptTemplate, `${a.id} must carry the account id`).toContain("{accountId}");
    }
  });

  it("renders a prompt with no placeholders left behind", () => {
    for (const a of ACTIONS) {
      const p = renderPrompt(a, NAME, ID);
      expect(p).not.toMatch(/\{account\}|\{accountId\}/);
      expect(p).toContain(NAME);
      expect(p).toContain(ID);
    }
  });

  it("keeps apexAction a declared-but-unused v2 seam", () => {
    const withSeam = ACTIONS.filter((a) => a.apexAction);
    expect(withSeam.length).toBeGreaterThan(0);
    for (const a of withSeam) {
      expect(a.apexAction!.tool).toMatch(/^ncino_/);
      expect(a.apexAction!.params).toBeTypeOf("object");
    }
  });
});

describe("relocated verdict-bar prompts (A27.4) keep their exact strings", () => {
  it("Draft Credit Memo", () => {
    expect(renderPrompt(ACTIONS_BY_ID["draft-credit-memo"], NAME, ID)).toBe(
      `Draft the credit memo for ${NAME} (${ID}).`,
    );
  });

  it("Generate Spreading", () => {
    expect(renderPrompt(ACTIONS_BY_ID["generate-spreading"], NAME, ID)).toBe(
      `Pull up the Boom spreads for ${NAME} (${ID}).`,
    );
  });
});

describe("availability — every predicate passes on a fully-capable bundle", () => {
  const data = dataWith(fullBundle());
  for (const a of ACTIONS) {
    it(`${a.id} is available`, () => {
      expect(a.availability(data, ID)).toEqual({ available: true });
    });
  }
});

describe("availability — unavailable actions give a concrete banker reason", () => {
  const data = dataWith(bareBundle());

  it("gates booked-loan actions on an active facility", () => {
    for (const id of ["draft-credit-memo", "annual-review"]) {
      const r = ACTIONS_BY_ID[id].availability(data, ID);
      expect(r.available, `${id} should be unavailable`).toBe(false);
      expect(r.reason).toBe("No booked loans on this relationship");
    }
  });

  it("gates spreading on Boom financials", () => {
    const r = ACTIONS_BY_ID["generate-spreading"].availability(data, ID);
    expect(r.available).toBe(false);
    expect(r.reason).toBe("No spread financials on file for this borrower");
  });

  it("gates covenant review on covenants", () => {
    const r = ACTIONS_BY_ID["covenant-review"].availability(data, ID);
    expect(r.available).toBe(false);
    expect(r.reason).toBe("No covenants recorded for this relationship");
  });

  it("gates collateral valuation on pledged collateral", () => {
    const r = ACTIONS_BY_ID["collateral-valuation"].availability(data, ID);
    expect(r.available).toBe(false);
    expect(r.reason).toBe("No collateral pledged against these facilities");
  });

  it("gates risk rating review on a rating being on file", () => {
    const r = ACTIONS_BY_ID["risk-rating-review"].availability(data, ID);
    expect(r.available).toBe(false);
    expect(r.reason).toBe("No risk rating on file for this borrower");
  });

  it("keeps the always-available actions available even on a bare relationship", () => {
    for (const id of ALWAYS_AVAILABLE) {
      expect(ACTIONS_BY_ID[id].availability(data, ID).available, id).toBe(true);
    }
  });

  it("every unavailable result carries a non-empty reason", () => {
    for (const a of ACTIONS) {
      const r = a.availability(data, ID);
      if (!r.available) expect(r.reason?.trim().length, `${a.id} reason`).toBeGreaterThan(0);
    }
  });
});

describe("availability — a CLOSED facility is not a booked loan (F6 carries through)", () => {
  it("gates modification/renewal when the only facility is closed", () => {
    const b = fullBundle();
    // EVERY facility, booked parent and version clone alike: the case under
    // test is "the only facility is closed", not "one of two is".
    for (const f of b.exposure!.facilities!) f.status = "Closed";
    const data = dataWith(b);
    for (const id of ["draft-credit-memo", "annual-review"]) {
      const r = ACTIONS_BY_ID[id].availability(data, ID);
      expect(r.available, `${id} should be gated by the closed facility`).toBe(false);
      expect(r.reason).toBe("No booked loans on this relationship");
    }
  });
});

describe("C1 — staging is a precondition for EVERY action", () => {
  const data = dataWith(fullBundle());
  it("disables every action for an account in the portfolio but not staged", () => {
    // In portfolio.accounts, absent from borrowers -> not actionable.
    const withUnstaged = {
      ...data,
      portfolio: { accounts: [{ accountId: ID, name: NAME }, { accountId: "001UNSTAGED", name: "Unstaged Co." }] },
    } as unknown as C360Data;
    for (const a of ACTIONS) {
      const r = a.availability(withUnstaged, "001UNSTAGED");
      expect(r.available, `${a.id} must be gated by staging`).toBe(false);
      expect(r.reason).toBe("Account not staged in this view");
    }
  });

  it("gates the always-available actions on staging too", () => {
    for (const id of ALWAYS_AVAILABLE) {
      expect(ACTIONS_BY_ID[id].availability(data, "001UNSTAGED").reason).toBe("Account not staged in this view");
      // ...but they need no further data precondition once staged.
      expect(ACTIONS_BY_ID[id].availability(dataWith(bareBundle()), ID).available).toBe(true);
    }
  });
});

describe("C2 — spreading needs real Boom content, not an empty container", () => {
  const spreading = ACTIONS_BY_ID["generate-spreading"];
  const withBoom = (boom: unknown) => {
    const b = fullBundle();
    b.boom = boom as never;
    return dataWith(b);
  };

  it("rejects an empty ratios array", () => {
    expect(spreading.availability(withBoom({ ratios: [] }), ID).available).toBe(false);
  });

  it("rejects empty containers", () => {
    for (const boom of [{}, { ratios: {} }, { spread: {} }, { spread: { periods: [], lineItems: [] } }]) {
      expect(spreading.availability(withBoom(boom), ID).available, JSON.stringify(boom)).toBe(false);
    }
  });

  it("accepts a real ratio figure", () => {
    expect(spreading.availability(withBoom({ ratios: { totalLeverage: 3.85 } }), ID).available).toBe(true);
  });

  it("accepts a populated spread", () => {
    expect(spreading.availability(withBoom({ spread: { periods: [{ period: "LTM" }] } }), ID).available).toBe(true);
  });

  it("gives the honest reason when empty", () => {
    expect(spreading.availability(withBoom({ ratios: {} }), ID).reason).toBe(
      "No spread financials on file for this borrower",
    );
  });
});

describe("C3 — collateral valuation only counts ACTIVE facilities", () => {
  it("is disabled when the only collateral sits on a paid-off facility", () => {
    const b = fullBundle();
    b.exposure!.facilities = [
      { loanId: "L1", status: "Paid Off", collateral: [{ collateralType: "Equipment", collateralValue: 100 }] },
      { loanId: "L2", status: "Active" },
    ];
    const r = ACTIONS_BY_ID["collateral-valuation"].availability(dataWith(b), ID);
    expect(r.available).toBe(false);
    expect(r.reason).toBe("No collateral pledged against these facilities");
  });

  it("is available when an active facility carries the pledge", () => {
    const b = fullBundle();
    b.exposure!.facilities = [
      { loanId: "L1", status: "Paid Off" },
      { loanId: "L2", status: "Active", collateral: [{ collateralType: "Equipment" }] },
    ];
    expect(ACTIONS_BY_ID["collateral-valuation"].availability(dataWith(b), ID).available).toBe(true);
  });
});

describe("availability — no account in scope", () => {
  const data = dataWith(fullBundle());
  it("disables every action with an open-a-relationship reason", () => {
    for (const a of ACTIONS) {
      const r = a.availability(data, null);
      expect(r.available, `${a.id}`).toBe(false);
      expect(r.reason).toBe("Open a relationship to run this action.");
    }
  });

  it("disables actions for an account with no staged bundle", () => {
    const r = ACTIONS_BY_ID["covenant-review"].availability(data, "001NOTSTAGED");
    expect(r.available).toBe(false);
    expect(r.reason).toBe("Account not staged in this view");
  });
});


describe("the staged rationale is never blank (Codex #3)", () => {
  it("uses what the figures said when a finding is carrying the reason", () => {
    expect(
      stageRationale({ actionId: "annual-review", accountName: "Testco", accepted: "Coverage is below the floor." }),
    ).toBe("Coverage is below the floor.");
  });

  it("leads with what the banker wrote, then the findings", () => {
    expect(
      stageRationale({ actionId: "loan-modification", accountName: "Testco", accepted: "Coverage is thin.", typed: "Client asked." }),
    ).toBe("Client asked. Coverage is thin.");
  });

  it("states the action and the anchor when nothing else does", () => {
    expect(stageRationale({ actionId: "risk-rating-review", accountName: "Testco" })).toBe(
      "Banker-initiated risk rating review for Testco via the cockpit.",
    );
  });

  it("is never blank, for any action, however empty the inputs", () => {
    for (const a of ACTIONS) {
      for (const inputs of [{}, { accepted: "   " }, { typed: "" }, { accepted: "", typed: "  " }]) {
        const r = stageRationale({ actionId: a.id, accountName: "Testco", ...inputs });
        expect(r.trim(), a.id).not.toBe("");
      }
    }
  });
});
