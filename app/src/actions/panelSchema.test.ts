import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BorrowerBundle } from "../data/contract";
import { ACTIONS, ACTIONS_BY_ID } from "./registry";
import { buildPanelSchema, PANEL_SCHEMAS } from "./schemas";
import { bankerEntryFields, chipFor, PREFILL_PROVENANCE, stagingBlockers, unfilledRequired } from "./panelSchema";
import { DEMO_POLICY_PACK } from "../policy/policyPack";

/** Every action with a ticket. Wave 1 shipped three; wave 2 added five, two of
 *  which stage but cannot execute (LV06), a property of the tool map rather
 *  than of the panel, so they still belong here. 0.9.23 added the ninth: the
 *  discard, whose panel briefs an undo rather than a create. */
const SHIPPING = [
  "collateral-valuation",
  "create-service-request",
  "annual-review",
  "new-facility-request",
  "risk-rating-review",
  "covenant-review",
  "loan-modification",
  "renewal",
  "discard-version",
];

const bundle: BorrowerBundle = {
  // Both bulk actions are anchored on a product package since WS0.5, so a
  // relationship without one blocks them. The shared fixture stages one; the
  // fixtures below that deliberately omit it prove the block.
  snapshot: { accountId: "001X", name: "Testco", primaryRiskRating: "5", productPackageId: "a5Fbb000000IGZNEA4" },
  exposure: {
    totalCommitted: 10_000_000,
    facilities: [
      { loanId: "L1", name: "Revolver", collateral: [{ collateralType: "Accounts Receivable", currentLendableValue: 4_000_000 }] },
    ],
  },
  requests: [
    { id: "r1", summary: "Sterling asked to raise the revolver.", reference: { kind: "m365-message", id: "MSG-1" } },
  ],
};

const ctx = { bundle, accountId: "001X", accountName: "Testco" };

describe("registry integration (A33.1.2)", () => {
  it("declares a panel on exactly the shipping actions", () => {
    const withPanel = ACTIONS.filter((a) => a.hasPanel).map((a) => a.id).sort();
    expect(withPanel).toEqual([...SHIPPING].sort());
  });

  it("every action flagged hasPanel has a schema builder, and vice versa", () => {
    expect(Object.keys(PANEL_SCHEMAS).sort()).toEqual([...SHIPPING].sort());
    for (const id of SHIPPING) {
      expect(ACTIONS_BY_ID[id].hasPanel, id).toBe(true);
      expect(buildPanelSchema(id, ctx), id).not.toBeNull();
    }
  });

  it("the remaining actions have no panel and stay analysis-only", () => {
    for (const a of ACTIONS.filter((x) => !SHIPPING.includes(x.id))) {
      expect(a.hasPanel, a.id).toBeUndefined();
      expect(buildPanelSchema(a.id, ctx), a.id).toBeNull();
    }
  });

  it("the registry stays the single source of truth for action identity", () => {
    for (const id of Object.keys(PANEL_SCHEMAS)) expect(ACTIONS_BY_ID[id], id).toBeTruthy();
  });
});

describe("prefill sources and provenance chips (A33.1.3)", () => {
  it("maps the six sources onto the UNCHANGED A26 union", () => {
    expect(PREFILL_PROVENANCE).toEqual({
      NCINO_RECORD: "NCINO",
      CLIENT_REQUEST: "DERIVED",
      BOOM_FIGURE: "BOOM",
      COMPUTED: "DERIVED",
      AGENT_NARRATIVE: "AGENT",
      BANKER: null,
    });
  });

  it("CLIENT_REQUEST renders a DERIVED chip, citing the source message", () => {
    const schema = buildPanelSchema("create-service-request", ctx)!;
    const subject = schema.fields.find((f) => f.key === "subject")!;
    expect(subject.prefill.source).toBe("CLIENT_REQUEST");
    expect(chipFor(subject)).toBe("DERIVED");
    expect(subject.prefill.citation).toBe("MSG-1");
  });

  it("BANKER fields render NO chip", () => {
    for (const id of SHIPPING) {
      const schema = buildPanelSchema(id, ctx)!;
      for (const f of bankerEntryFields(schema)) expect(chipFor(f), `${id}.${f.key}`).toBeNull();
    }
  });

  it("falls back to a BANKER subject when no client request is staged", () => {
    const schema = buildPanelSchema("create-service-request", { ...ctx, bundle: { snapshot: { accountId: "001X" } } })!;
    const subject = schema.fields.find((f) => f.key === "subject")!;
    expect(subject.prefill.source).toBe("BANKER");
    expect(chipFor(subject)).toBeNull();
  });

  it("every field carries a resolvable chip decision", () => {
    for (const id of SHIPPING) {
      for (const f of buildPanelSchema(id, ctx)!.fields) {
        expect(() => chipFor(f), `${id}.${f.key}`).not.toThrow();
      }
    }
  });
});

describe("editability is a property of the org (A33.1.6)", () => {
  it("never renders formula or rollup fields as inputs", () => {
    const banned = ["LLC_BI__Lendable_Value__c", "LLC_BI__Final_Risk_Grade__c", "LLC_BI__hasRenewal__c", "HTML_Credit_Memo__c", "RecordTypeId"];
    for (const id of SHIPPING) {
      for (const f of buildPanelSchema(id, ctx)!.fields) {
        const target = "field" in f.target ? f.target.field : "";
        for (const b of banned) expect(target, `${id}.${f.key}`).not.toContain(b);
      }
    }
  });

  it("set-once and tool-owned fields are read-only WITH a reason", () => {
    for (const id of SHIPPING) {
      for (const f of buildPanelSchema(id, ctx)!.fields) {
        if (!f.editable) expect(f.editableReason, `${id}.${f.key}`).toBeTruthy();
      }
    }
  });

  it("the local review ladder is read and labelled, never written", () => {
    const stage = buildPanelSchema("annual-review", ctx)!.fields.find((f) => f.key === "reviewStage")!;
    expect(stage.editable).toBe(false);
    expect(stage.editableReason).toMatch(/never written/);
  });

  it("picklists declare an org option source and hardcode NO value set", () => {
    for (const id of SHIPPING) {
      for (const f of buildPanelSchema(id, ctx)!.fields) {
        // A33.1.6 governs picklist VALUE SETS. A record chooser built from
        // staged rows is a different thing and marks itself as one.
        if (f.type !== "picklist" || f.optionsAreRecords) continue;
        expect(f.optionsFrom, `${id}.${f.key}`).toBeTruthy();
        // Options only appear when the org supplied them.
        expect(f.options, `${id}.${f.key}`).toBeUndefined();
      }
    }
  });

  it("a record chooser is built from staged rows, never from an invented set", () => {
    const booked: BorrowerBundle = {
      snapshot: { accountId: "001X", name: "Testco" },
      exposure: {
        facilities: [
          { loanId: "L1", name: "Term Loan", stage: "Booked", status: "Active" },
          { loanId: "L2", name: "Revolver", stage: "Final Review", status: "Active" },
        ],
      },
    };
    for (const id of ["loan-modification", "renewal"]) {
      const f = buildPanelSchema(id, { bundle: booked, accountId: "001X", accountName: "Testco" })!.fields.find(
        (x) => x.key === "facility",
      )!;
      expect(f.optionsAreRecords, id).toBe(true);
      expect(f.optionsFrom, id).toBeUndefined();
      // Options carry the record ID; the label is display only.
      expect(f.options, id).toEqual(["L1"]);
      expect(f.optionLabels, id).toEqual(["Term Loan"]);
      expect(f.disabledOptions, id).toEqual([{ value: "Revolver", reason: "at Final Review" }]);
    }
  });

  it("renders org-supplied picklist values when they are loaded", () => {
    const withOptions = buildPanelSchema("annual-review", {
      ...ctx,
      orgPicklists: { "LLC_BI__Review__c.LLC_BI__Review_Type__c": ["Annual", "AdHoc", "Problem Loan"] },
    })!;
    expect(withOptions.fields.find((f) => f.key === "reviewType")!.options).toEqual(["Annual", "AdHoc", "Problem Loan"]);
  });
});

describe("the banker confirms, never transcribes (A33.1.4)", () => {
  it("prefills every field a source system can answer", () => {
    const schema = buildPanelSchema("annual-review", ctx)!;
    expect(schema.fields.find((f) => f.key === "account")!.value).toBe("Testco");
    // Probe-confirmed: nothing defaults status, so the tool sets it explicitly.
    expect(schema.fields.find((f) => f.key === "status")!.value).toBe("In Progress");
  });

  it("every unfilled required field is a deliberate BANKER field", () => {
    for (const id of SHIPPING) {
      const schema = buildPanelSchema(id, ctx)!;
      // unfilledRequired excludes BANKER by design; anything it returns is a defect.
      expect(unfilledRequired(schema).map((f) => f.key), id).toEqual([]);
    }
  });

  it("prefills the valuation amount from the pledge rather than asking for it", () => {
    const v = buildPanelSchema("collateral-valuation", ctx)!.fields.find((f) => f.key === "value")!;
    expect(v.value).toBe(4_000_000);
    expect(v.prefill.source).toBe("NCINO_RECORD");
  });
});

describe("the valuation anchor is the COLLATERAL id, never the facility id", () => {
  /** The live defect: a facility loanId was sent as collateralId and the org
   *  refused it, correctly. The anchor now comes only from the pledge row. */
  const withId: BorrowerBundle = {
    snapshot: { accountId: "001X", name: "Testco", productPackageId: "a5Fbb000000IGZNEA4" },
    exposure: {
      facilities: [
        {
          loanId: "a1Xbb000000PLD1",
          name: "Equipment Term Loan",
          collateral: [{ collateralType: "Equipment", currentLendableValue: 4_800_000, collateralId: "a35bb000000zOgXAAU" }],
        },
      ],
    },
  };

  it("offers the collateral record id as the only selectable option", () => {
    const f = buildPanelSchema("collateral-valuation", { ...ctx, bundle: withId })!.fields.find((x) => x.key === "records")!;
    expect(f.options).toEqual(["a35bb000000zOgXAAU"]);
    // One record, so it is preselected: there is nothing to choose.
    expect(f.value).toEqual(["a35bb000000zOgXAAU"]);
    expect(f.gap).toBeUndefined();
  });

  it("NEVER offers the facility loanId as a valuation anchor", () => {
    const f = buildPanelSchema("collateral-valuation", ctx)!.fields.find((x) => x.key === "records")!;
    // ctx's bundle has a pledge but no collateralId: nothing is selectable, and
    // the pledge is listed as unanchorable rather than silently anchored on the
    // facility that happens to hold it.
    expect(f.options).toEqual([]);
    expect(JSON.stringify(f)).not.toContain("L1");
    expect(f.disabledOptions?.[0].reason).toContain("no collateral record id staged");
  });

  it("renders a named gap and BLOCKS staging when the id is not staged", () => {
    const schema = buildPanelSchema("collateral-valuation", ctx)!;
    const f = schema.fields.find((x) => x.key === "records")!;
    expect(f.gap?.blocksStaging).toBe(true);
    expect(f.gap?.reason).toMatch(/collateral record id is not staged/);
    expect(stagingBlockers(schema).map((x) => x.key)).toEqual(["records"]);
  });

  it("does not block when the id is present", () => {
    expect(stagingBlockers(buildPanelSchema("collateral-valuation", { ...ctx, bundle: withId })!)).toEqual([]);
  });

  it("says so plainly when no collateral is pledged at all", () => {
    const bare = { snapshot: { accountId: "001X" }, exposure: { facilities: [] } };
    const f = buildPanelSchema("collateral-valuation", { ...ctx, bundle: bare as never })!.fields.find((x) => x.key === "records")!;
    expect(f.gap?.reason).toMatch(/No collateral is pledged/);
    expect(f.gap?.blocksStaging).toBe(true);
  });

  it("names what each record secures, so the banker knows which piece it is", () => {
    const f = buildPanelSchema("collateral-valuation", { ...ctx, bundle: withId })!.fields.find((x) => x.key === "records")!;
    expect(f.optionLabels).toEqual(["Equipment"]);
    expect(f.optionDetails?.[0]).toContain("secures Equipment Term Loan");
  });

  it("the sample-only bundles show the honest gap rather than an org error", () => {
    // Sterling and friends carry no collateralId anywhere, so their valuation
    // action must never reach the tool.
    const sterling = { snapshot: { accountId: "001SAMPLE0000STRL" }, exposure: { facilities: [{ loanId: "L9", collateral: [{ collateralType: "Inventory", collateralValue: 1 }] }] } };
    const schema = buildPanelSchema("collateral-valuation", { ...ctx, bundle: sterling as never })!;
    // Two honest gaps, not one: Sterling stages no collateral id AND no product
    // package, and the tool requires both.
    expect(stagingBlockers(schema).map((x) => x.key)).toEqual(["package", "records"]);
  });

  it("the other two actions are unaffected and still stageable", () => {
    for (const id of ["create-service-request", "annual-review"]) {
      expect(stagingBlockers(buildPanelSchema(id, ctx)!), id).toEqual([]);
    }
  });
});

describe("write targets match the contract tables (A33.4)", () => {
  it("writes each action to its contracted object", () => {
    expect(buildPanelSchema("collateral-valuation", ctx)!.writeObject).toBe("LLC_BI__Collateral_Valuation__c");
    expect(buildPanelSchema("create-service-request", ctx)!.writeObject).toBe("Case");
    expect(buildPanelSchema("annual-review", ctx)!.writeObject).toBe("LLC_BI__Review__c");
  });

  it("service requests are created at New with no transition offered", () => {
    const status = buildPanelSchema("create-service-request", ctx)!.fields.find((f) => f.key === "status")!;
    expect(status.value).toBe("New");
    expect(status.editable).toBe(false);
  });

  it("the annual review stops at In Progress and says the bank mints Complete", () => {
    const schema = buildPanelSchema("annual-review", ctx)!;
    expect(schema.intro).toMatch(/never does/);
    expect(schema.fields.find((f) => f.key === "status")!.value).toBe("In Progress");
    for (const f of schema.fields) expect(String(f.value ?? ""), f.key).not.toBe("Complete");
  });

  it("stages all nine review narratives as editable agent prose", () => {
    const narratives = buildPanelSchema("annual-review", ctx)!.fields.filter((f) => f.prefill.source === "AGENT_NARRATIVE");
    expect(narratives.length).toBe(9);
    for (const n of narratives) expect(n.editable).toBe(true);
  });
});

describe("A26.2 literal ban extends to policy values (WP4 acceptance 4)", () => {
  const POLICY_LITERALS = [
    String(DEMO_POLICY_PACK.values["collateral.coverageFloor"]),
    String(DEMO_POLICY_PACK.values["covenant.cushionAlertFloor"]),
  ];

  function sources(dir: string): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) out.push(...sources(full));
      else if ((e.name.endsWith(".tsx") || e.name.endsWith(".ts")) && !e.name.includes(".test.")) out.push([full, readFileSync(full, "utf8")]);
    }
    return out;
  }

  /** Geometry is not business logic: SVG path data, stroke widths, viewBoxes and
   *  Tailwind arbitrary sizes routinely contain numbers like 1.1. Strip those
   *  before matching so the check flags a real threshold in code, not a curve. */
  function logicOnly(src: string): string {
    return src
      .replace(/\sd="[^"]*"/g, " ")
      .replace(/\s(?:strokeWidth|strokeMiterlimit|viewBox|width|height|cx|cy|r|x|y|x1|x2|y1|y2|rx|ry|opacity|offset)="[^"]*"/g, " ")
      .replace(/\[[^\]]*\]/g, " ") // Tailwind arbitrary values
      .replace(/\/(?![/*])(?:\\.|\[[^\]]*\]|[^/\n\\])+\/[gimsuy]*/g, " ") // regex literals: {15} is a quantifier, not a threshold
      .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
      .replace(/\/\/[^\n]*/g, " "); // line comments
  }

  it("no component or rule file inlines a policy-pack value", () => {
    const files = [...sources(join(__dirname, "..", "components")), ...sources(join(__dirname))];
    for (const [path, src] of files) {
      const code = logicOnly(src);
      for (const lit of POLICY_LITERALS) {
        // Match the number as a standalone token, not as part of an id or size.
        const re = new RegExp(`(?<![\\w.])${lit.replace(".", "\\.")}(?![\\w.])`);
        expect(re.test(code), `${path} inlines the policy value ${lit}`).toBe(false);
      }
    }
  });

  it("the only home for a threshold is the policy pack", () => {
    const pack = readFileSync(join(__dirname, "..", "policy", "policyPack.ts"), "utf8");
    for (const lit of POLICY_LITERALS) expect(pack).toContain(lit);
  });
});
