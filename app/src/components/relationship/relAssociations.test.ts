// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JUNCTION_NOT_CARRIED,
  RELATIONSHIP_LEVEL,
  associationLine,
  collateralAssociationLine,
  collateralAssociations,
  covenantAssociationLine,
  covenantAssociations,
  facilityWord,
  packageWord,
  packagesTouched,
} from "./relAssociations";
import { relBookFor } from "./relBook";
import { buildStagePayload, relContextFor, relRouteBlock, nextStep, type RelContext } from "./reviewFlows";
import { parseAssociations, stageAction, type ExecuteResult, type StagePayloads } from "../../channel/writeTools";
import { assertNoRecordIds, type StagedOutput } from "../../actions/stagedPlan";
import { executedActivityEntry } from "../../actions/executedActivity";
import type { BorrowerBundle, C360Data, Facility } from "../../data/contract";
import live from "../../../../artifact/live-data.json";

/* =============================================================================
   COVENANTS AND COLLATERAL, DRIVEN FROM THE RELATIONSHIP (0.9.24, row 49).

   Founder, 2026-09-13: "covenants and collaterals should be driven from the
   relationship perspective. A package is an association the row shows, which PPs
   and facilities it is tied to, never a filter or a narrowing control."

   Everything below stands on HARTWELL'S REAL BOOK, the one the artifact ships:
   two product packages, nine active facilities, six covenants of which four
   carry a loan junction and two are relationship-level, and seven distinct
   pledged assets. A fixture of my own would prove the shape and none of the
   facts; this proves both.
   ============================================================================= */

const data = live as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";
const NAME = "Hartwell Precision Manufacturing LLC";
const NON_RE_PACKAGE = "a5Fbb000000IHFJEA4";
const SECOND_PACKAGE = "a5Fbb000000J6BNEA0";

function hartwell(): RelContext {
  const bundle = data.borrowers![HARTWELL] as BorrowerBundle;
  return relContextFor({ data, bundle, accountId: HARTWELL, accountName: NAME });
}

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

afterEach(() => {
  delete w.claude;
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------- the shape */

describe("the relationship is the anchor, and the package is a fact on the row", () => {
  it("stages two packages and anchors on neither", () => {
    const ctx = hartwell();
    expect(ctx.packages.map((p) => p.id)).toEqual([NON_RE_PACKAGE, SECOND_PACKAGE]);
    // The shipped snapshot deliberately carries no anchor: two packages exist
    // and `anchor-snapshot-packages.mjs` refuses to pick one.
    expect(ctx.productPackageId).toBeNull();
  });

  it("runs both reviews on that relationship without asking for a package", () => {
    const ctx = hartwell();
    expect(relRouteBlock("covenant", ctx)).toBeNull();
    expect(relRouteBlock("valuation", ctx)).toBeNull();
    expect(nextStep("covenant", ctx, {})!.key).toBe("covenants");
    expect(nextStep("valuation", ctx, {})!.key).toBe("records");
  });

  it("lists EVERY covenant on the relationship, across both packages", () => {
    const step = nextStep("covenant", hartwell(), {})!;
    expect(step.options).toHaveLength(6);
    const labels = step.options!.map((o) => o.label);
    expect(labels).toContain("Accounts Receivable");
    expect(labels).toContain("Debt Service Coverage of Borrower");
    expect(labels).toContain("Maximum Debt to Worth");
    expect(labels).toContain("Minimum Liquidity");
    expect(labels).toContain("Debt Service Coverage with and without Distributions");
    expect(labels).toContain("Term Covenants");
  });

  it("lists every asset the borrower owns, once, across both packages", () => {
    const step = nextStep("valuation", hartwell(), {})!;
    // Seven distinct collateral ids over nine facilities: the cross-pledged
    // assets are offered ONCE, because a duplicate in a batch is refused.
    expect(step.options).toHaveLength(7);
    expect(new Set(step.options!.map((o) => o.value)).size).toBe(7);
  });
});

/* ------------------------------------------------------- the words on a row */

describe("the association line", () => {
  it("names a package by what it holds, in the bank's own shorthand", () => {
    expect(packageWord(`${NAME} credit package · Non-Real Estate and Real Estate`, NAME)).toBe("Non-RE/RE");
    expect(packageWord(`${NAME} credit package · Real Estate`, NAME)).toBe("RE");
    // A relationship staging ONE package is named without a suffix, and the
    // roster's own word for it already carries the noun.
    expect(packageWord(`${NAME} credit package`, NAME)).toBe("credit package");
    expect(packageWord(null, NAME)).toBe("the package");
  });

  it("names a facility by its product and its commitment, never by the org's loan name", () => {
    const line = (hartwell().bundle!.exposure!.facilities as Facility[]).find(
      (f) => f.loanId === "a4Zbb0000027MaYEAU",
    )!;
    expect(facilityWord(line, NAME)).toBe("Line of Credit $15M");
  });

  it("reads a covenant's junctions off the book, with the package behind them", () => {
    const ctx = hartwell();
    const ar = ctx.bundle!.covenants!.covenants!.find((c) => c.covenantType === "Accounts Receivable")!;
    expect(covenantAssociations(ctx, ar)).toEqual([
      {
        loanId: "a4Zbb0000027MaYEAU",
        loanName: `${NAME} - Line of Credit - $15,000,000.00`,
        productPackageId: NON_RE_PACKAGE,
        packageName: ctx.packages[0].name,
      },
    ]);
    expect(covenantAssociationLine(ctx, ar)).toBe("Line of Credit $15M; Non-RE/RE package");
  });

  it("says relationship-level where the junction array is EMPTY", () => {
    const ctx = hartwell();
    const liquidity = ctx.bundle!.covenants!.covenants!.find((c) => c.covenantType === "Minimum Liquidity")!;
    expect(covenantAssociations(ctx, liquidity)).toEqual([]);
    expect(covenantAssociationLine(ctx, liquidity)).toBe(RELATIONSHIP_LEVEL);
  });

  it("says something DIFFERENT where the read carries no junction field at all", () => {
    // Absent is "the read does not carry it", never "tied to nothing". Two
    // facts, two sentences.
    expect(covenantAssociationLine(hartwell(), { covenantId: "x", covenantType: "Leverage" })).toBe(
      JUNCTION_NOT_CARRIED,
    );
  });

  it("reads an asset's pledges across facilities and packages", () => {
    const ctx = hartwell();
    // The Fort Wayne / Kokomo mortgage is pledged to two facilities of the same
    // package; the line names both and the package once.
    const line = collateralAssociationLine(ctx, "a35bb0000013y3tAAA");
    expect(line).toContain("Construction $12M");
    expect(line).toContain("Non-RE/RE package");
    expect(collateralAssociations(ctx, "a35bb0000013y3tAAA").length).toBeGreaterThan(1);
  });

  it("names the second package on an asset pledged inside it", () => {
    // COL on the Purchase - $6,500,000.00 facility, which is the only member of
    // the relationship's second package that carries real estate.
    const line = collateralAssociationLine(hartwell(), "a35bb0000019cv7AAA");
    expect(line).toContain("Purchase $6.50M");
    expect(line).toContain("RE/Non-RE package");
  });

  it("adds the noun once, never twice", () => {
    expect(
      associationLine([{ loanName: "Testco - Line of Credit - $1,000,000.00", packageName: "Testco credit package" }], "Testco"),
    ).toBe("Line of Credit $1M; credit package");
  });

  it("is blank where nothing was handed to it, so a caller can tell absent from empty", () => {
    expect(associationLine(undefined)).toBe("");
    expect(associationLine([])).toBe(RELATIONSHIP_LEVEL);
  });
});

describe("the book carries the line on every row", () => {
  it("puts the associations on each covenant and each asset", () => {
    const book = relBookFor(hartwell());
    expect(book.covenants).toHaveLength(6);
    expect(book.covenants.filter((c) => c.associations.length > 0)).toHaveLength(4);
    expect(book.covenants.filter((c) => c.associationLine === RELATIONSHIP_LEVEL)).toHaveLength(2);
    expect(book.assets).toHaveLength(7);
    for (const a of book.assets) expect(a.associationLine).not.toBe("");
  });

  it("shows the line on the chooser rows the banker actually reads", () => {
    const covenants = nextStep("covenant", hartwell(), {})!;
    const ar = covenants.options!.find((o) => o.label === "Accounts Receivable")!;
    expect(ar.detail).toContain("Line of Credit $15M; Non-RE/RE package");
    const assets = nextStep("valuation", hartwell(), {})!;
    expect(assets.options!.every((o) => (o.detail ?? "").length > 0)).toBe(true);
  });

  it("NEVER narrows: every covenant is offered whatever package it sits in", () => {
    /* The association is a fact on the row. A relationship standing in one
       package must still see all six, which is the whole of the founder's
       correction: "never a filter or a narrowing control". */
    const ctx = relContextFor({
      data,
      bundle: data.borrowers![HARTWELL] as BorrowerBundle,
      accountId: HARTWELL,
      accountName: NAME,
      productPackageId: SECOND_PACKAGE,
    });
    expect(ctx.productPackageId).toBe(SECOND_PACKAGE);
    expect(nextStep("covenant", ctx, {})!.options).toHaveLength(6);
    expect(nextStep("valuation", ctx, {})!.options).toHaveLength(7);
  });
});

/* ---------------------------------------------------------------- the wire */

describe("the payloads anchor on the account", () => {
  it("sends accountId and no productPackageId on the covenant review", () => {
    const ctx = hartwell();
    const built = buildStagePayload(
      "covenant",
      ctx,
      {
        covenants: ["a3Bbb000000S0bNEAS"],
        covenantStatuses: { a3Bbb000000S0bNEAS: "Compliant" },
        covenantObservedValues: { a3Bbb000000S0bNEAS: 80 },
        assessmentNarrative: "The June borrowing base was tested.",
      },
      "key-1",
    );
    expect(built.ok).toBe(true);
    const p = (built as { payload: StagePayloads["covenant-review"] }).payload;
    expect(p.accountId).toBe(HARTWELL);
    expect(p).not.toHaveProperty("productPackageId");
    expect(p.covenantIds).toEqual(["a3Bbb000000S0bNEAS"]);
  });

  it("sends accountId and no productPackageId on the collateral valuation", () => {
    const ctx = hartwell();
    const built = buildStagePayload(
      "valuation",
      ctx,
      {
        records: ["a35bb0000013xz3AAA"],
        recordValues: { a35bb0000013xz3AAA: 12_000_000 },
        valuationDate: "2026-09-13",
        type: "Fair Market Value",
        source: "Receivables Aging",
        primary: "no",
      },
      "key-2",
    );
    expect(built.ok).toBe(true);
    const p = (built as { payload: StagePayloads["collateral-valuation"] }).payload;
    expect(p.accountId).toBe(HARTWELL);
    expect(p).not.toHaveProperty("productPackageId");
    expect(p.items).toHaveLength(1);
  });
});

/* -------------------------------------------------------------- the mapper */

describe("the org's associations come back as a JSON string", () => {
  const rows = [
    { loanId: "a4Zbb0000027MaYEAU", loanName: `${NAME} - Line of Credit - $15,000,000.00`, productPackageId: NON_RE_PACKAGE, packageName: `${NAME} credit package · Non-Real Estate` },
  ];

  it("parses the string the contract sends", () => {
    expect(parseAssociations(JSON.stringify(rows))).toEqual(rows);
  });

  it("takes an array too, where a tool answers with one", () => {
    expect(parseAssociations(rows)).toEqual(rows);
  });

  it("leaves the key ABSENT rather than inventing an empty list", () => {
    // "the org did not say" and "tied to nothing" are different facts.
    expect(parseAssociations(undefined)).toBeUndefined();
    expect(parseAssociations("")).toBeUndefined();
    expect(parseAssociations("{not json")).toBeUndefined();
    expect(parseAssociations('{"loanId":"x"}')).toBeUndefined();
    expect(parseAssociations([])).toEqual([]);
  });

  it("drops what is not a row, and never throws", () => {
    expect(parseAssociations('[null, 3, {"loanId":"a4Zbb0000027MaYEAU"}]')).toEqual([
      { loanId: "a4Zbb0000027MaYEAU", loanName: undefined, productPackageId: undefined, packageName: undefined },
    ]);
  });

  it("lands on the staged plan, per covenant and per item", async () => {
    const outputValues = {
      ok: true,
      result: {
        stagingId: "STG-0000000200",
        planHash: "hash",
        decisionToken: "tok",
        summary: "Assesses one covenant on the relationship.",
        steps: [],
        warnings: [],
        accountId: HARTWELL,
        covenants: [
          { covenantId: "a3Bbb000000S0bNEAS", covenantName: "COV-000652", state: "planned", associations: JSON.stringify(rows) },
        ],
        items: [{ collateralId: "a35bb0000013xz3AAA", collateralName: "COL-000762", associations: JSON.stringify(rows) }],
      },
    };
    w.claude = {
      mcp: {
        callTool: vi.fn().mockResolvedValue({
          payload: { content: [{ actionName: "t", errors: null, isSuccess: true, outputValues, sortOrder: 0, version: 1 }] },
        }),
        watchTool: vi.fn(),
        listTools: vi.fn(),
        invalidate: vi.fn(),
      },
    };
    const out = await stageAction("covenant-review", {
      idempotencyKey: "k",
      accountId: HARTWELL,
      assessments: [{ covenantId: "a3Bbb000000S0bNEAS", status: "Compliant" }],
    });
    expect(out.ok).toBe(true);
    const plan = (out as { result: StagedOutput }).result;
    expect(plan.covenants![0].associations).toEqual(rows);
    expect(plan.items![0].associations).toEqual(rows);
    // AND THE FENCE STILL PASSES. An association names a loan booked long
    // before the plan was staged, exactly as `facilityId` does on a credit
    // action; reading it as evidence of a write would be wrong.
    expect(assertNoRecordIds(plan)).toEqual([]);
  });
});

/* --------------------------------------------------------------- the trail */

describe("the trail row anchors on the account and names the packages", () => {
  const outcome: ExecuteResult = {
    stagingId: "STG-0000000200",
    terminalState: "success",
    outcome: "Four assessments were written and verified.",
    recordName: "COMP-0489",
    steps: [],
  };

  it("names the relationship and the reach, not a package the room never asked for", () => {
    const entry = executedActivityEntry({
      actionId: "covenant-review",
      outcome,
      target: NAME,
      packages: ["Non-RE/RE", "RE/Non-RE"],
      now: () => new Date("2026-09-13T10:00:00Z"),
    })!;
    expect(entry.title).toBe(`Covenant review on ${NAME}, across the Non-RE/RE and the RE/Non-RE packages`);
    // The org's own record and its own sentence are not lost.
    expect(entry.detail!.body).toContain("Four assessments were written and verified.");
    expect(entry.detail!.body).toContain("STG-0000000200");
  });

  it("says one package where the exercise reached one", () => {
    const entry = executedActivityEntry({
      actionId: "collateral-valuation",
      outcome,
      target: NAME,
      packages: ["Non-RE/RE"],
      now: () => new Date("2026-09-13T10:00:00Z"),
    })!;
    expect(entry.title).toBe(`Collateral valuation on ${NAME}, on the Non-RE/RE package`);
  });

  it("adds the noun once where the roster's word already carries it", () => {
    const entry = executedActivityEntry({
      actionId: "covenant-review",
      outcome,
      target: "Testco",
      packages: ["credit package"],
      now: () => new Date("2026-09-13T10:00:00Z"),
    })!;
    expect(entry.title).toBe("Covenant review on Testco, on the credit package");
  });

  it("names the relationship and stops where no association reached the room", () => {
    const entry = executedActivityEntry({
      actionId: "covenant-review",
      outcome,
      target: NAME,
      packages: [],
      now: () => new Date("2026-09-13T10:00:00Z"),
    })!;
    expect(entry.title).toBe(`Covenant review on ${NAME}`);
  });

  it("leaves the Client Actions panel's own row exactly as it was", () => {
    // The panel stages a package-scoped batch of its own and sends no
    // `packages` key; its trail row must not change under this release.
    const entry = executedActivityEntry({
      actionId: "collateral-valuation",
      outcome: { ...outcome, anchorName: "COL-000758", valuationId: "a34bb000000AAAA" },
      target: "Equipment",
      now: () => new Date("2026-09-13T10:00:00Z"),
    })!;
    expect(entry.title).toBe("Collateral valuation COMP-0489 filed against COL-000758");
  });
});

describe("the packages one exercise touched", () => {
  it("reads them off the associations, deduplicated, in the order they were met", () => {
    expect(
      packagesTouched(
        [
          { packageName: `${NAME} credit package · Non-Real Estate and Real Estate` },
          { packageName: `${NAME} credit package · Non-Real Estate and Real Estate` },
          { packageName: `${NAME} credit package · Real Estate and Non-Real Estate` },
          { loanId: "a4Zbb0000027MaYEAU" },
        ],
        NAME,
      ),
    ).toEqual(["Non-RE/RE", "RE/Non-RE"]);
  });
});
