import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CATALOG,
  chipSet,
  catalogField,
  orgAccepted,
  orgRefused,
  orgValues,
  readCatalog,
  reconcileChips,
  resetCatalog,
  type OrgCatalog,
} from "./catalog";
import { READ_COALESCE_WINDOW_MS } from "./mcp";

/* =============================================================================
   Customer360Catalog: THE CHIPS COME FROM THE ORG.

   The shapes below are `design/proposals/org-arms-addendum.md` verbatim, with
   the values the tool actually returned off bankinggpt-at on 2026-09-02.
   ============================================================================= */

afterEach(() => {
  resetCatalog();
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

const FIELDS = [
  {
    objectName: "LLC_BI__Policy_Exception__c",
    fieldName: "LLC_BI__Status__c",
    source: "picklist",
    values: [
      { label: "Waived", value: "Waived" },
      { label: "Mitigated", value: "Mitigated" },
      { label: "Unmitigated", value: "Unmitigated" },
    ],
    acceptedValues: [],
    note: "The org DEFAULTS a new row to Unmitigated, which reads as a decision nobody made.",
  },
  {
    objectName: "LLC_BI__Legal_Entities__c",
    fieldName: "LLC_BI__Borrower_Type__c",
    source: "picklist",
    values: ["Borrower", "Guarantor", "Limited Guarantor", "Co-Borrower", "Related Entity", "Grantor", "Contractor"].map(
      (v) => ({ label: v, value: v }),
    ),
    acceptedValues: ["Borrower", "Co-Borrower", "Guarantor", "Limited Guarantor", "Related Entity"],
  },
  {
    objectName: "LLC_BI__Collateral__c",
    fieldName: "LLC_BI__Collateral_Type__c",
    source: "catalog",
    values: [
      { label: "Equipment", value: "a3Kbb0000001AAA" },
      { label: "Real Estate", value: "a3Kbb0000001BBB" },
      { label: "Inventory", value: "a3Kbb0000001CCC" },
    ],
    acceptedValues: ["Equipment", "Real Estate"],
    note: "A type whose advance rate is null is refused before the org's own rule fires on the insert.",
  },
  {
    objectName: "LLC_BI__Fee__c",
    fieldName: "LLC_BI__Fee_Type__c",
    source: "picklist",
    values: ["Loan Origination", "Attorney", "Appraisal", "Other"].map((v) => ({ label: v, value: v })),
    acceptedValues: [],
    note: "This picklist is residential and TRID. A C&I fee has no value in this list.",
  },
];

const CAT: OrgCatalog = { fields: FIELDS as OrgCatalog["fields"], note: "Every list here is the ORG's, read live." };

function stubMcp(payload: unknown) {
  const callTool = vi.fn(async (..._args: unknown[]) => ({ payload }));
  (globalThis as { window?: unknown }).window = { claude: { mcp: { callTool } } };
  return callTool;
}

const envelope = (fields: unknown, note = "read live") => ({
  content: [{ isSuccess: true, outputValues: { fields, note } }],
});

describe("reading it", () => {
  it("calls the tool with NO input at all, which returns everything", async () => {
    const callTool = stubMcp(envelope(FIELDS));
    const catalog = await readCatalog();
    expect(catalog?.fields).toHaveLength(4);
    expect(callTool.mock.calls[0][2]).toEqual({ inputs: [{}] });
    expect(callTool.mock.calls[0][1]).toBe("Customer360Catalog");
  });

  it("reads ONCE PER VIEW, however many callers ask", async () => {
    const callTool = stubMcp(envelope(FIELDS));
    await Promise.all([readCatalog(), readCatalog()]);
    await readCatalog();
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("is null with no connector, and the room falls back to its mirror", async () => {
    expect(await readCatalog()).toBeNull();
  });

  it("is null on a refused element rather than half a catalog", async () => {
    stubMcp({ content: [{ isSuccess: false, errors: "INSUFFICIENT_ACCESS" }] });
    expect(await readCatalog()).toBeNull();
  });

  it("is null on an empty envelope, never a catalog of nothing", async () => {
    stubMcp(envelope([]));
    expect(await readCatalog()).toBeNull();
  });

  /* A FAILED READ IS NOT AN ANSWER TO CACHE (2026-09-02). The promise was the
     cache whatever it resolved to, and `resetCatalog` is never called by the
     room, so a view mounted before the connector registered its tools stayed on
     the mirror for its whole life with no retry. */
  it("retries on the next read where the first one came back with nothing", async () => {
    expect(await readCatalog()).toBeNull();
    const callTool = stubMcp(envelope(FIELDS));
    expect((await readCatalog())?.fields).toHaveLength(4);
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("retries after a REFUSAL too, and caches the catalog once it arrives", async () => {
    stubMcp({ content: [{ isSuccess: false, errors: "INSUFFICIENT_ACCESS" }] });
    expect(await readCatalog()).toBeNull();
    /* PAST THE READ SEAM'S WINDOW (0.9.30). The refusal is a per-element failure
       inside a transport SUCCESS, so the seam holds that envelope for five
       seconds and a room asking again inside it is answered without a call,
       which is the intended relief. The retry this test is about is the next
       room, minutes later. */
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + READ_COALESCE_WINDOW_MS);
    const callTool = stubMcp(envelope(FIELDS));
    await Promise.all([readCatalog(), readCatalog()]);
    await readCatalog();
    // ONE round trip once it succeeds: the cache is unchanged for the state it
    // was built for.
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("still shares ONE round trip between callers on the frame that fails", async () => {
    const callTool = stubMcp(envelope([]));
    expect(await Promise.all([readCatalog(), readCatalog()])).toEqual([null, null]);
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("keeps a catalog entry's record ids, because the names are not unique", async () => {
    stubMcp(envelope(FIELDS));
    const catalog = await readCatalog();
    expect(catalogField(catalog, "collateralType")?.values[0]).toEqual({ label: "Equipment", value: "a3Kbb0000001AAA" });
    expect(catalogField(catalog, "collateralType")?.source).toBe("catalog");
  });
});

describe("reading a field out of it", () => {
  it("names each entry by the object.field key the tool returns", () => {
    expect(CATALOG.exceptionStatus).toBe("LLC_BI__Policy_Exception__c.LLC_BI__Status__c");
    expect(CATALOG.caseType).toBe("Case.Type");
    expect(catalogField(CAT, "exceptionStatus")?.values).toHaveLength(3);
  });

  it("takes an empty acceptedValues as EVERYTHING, never as nothing", () => {
    expect(orgAccepted(CAT, "exceptionStatus")).toEqual(["Waived", "Mitigated", "Unmitigated"]);
    expect(orgRefused(CAT, "exceptionStatus")).toEqual([]);
  });

  it("names the two roles the object holds and the write path refuses", () => {
    expect(orgAccepted(CAT, "borrowerType")).toHaveLength(5);
    expect(orgRefused(CAT, "borrowerType")).toEqual(["Grantor", "Contractor"]);
  });

  it("narrows collateral types to the ones carrying their own advance rate", () => {
    expect(orgValues(CAT, "collateralType")).toEqual(["Equipment", "Real Estate", "Inventory"]);
    expect(orgAccepted(CAT, "collateralType")).toEqual(["Equipment", "Real Estate"]);
  });

  it("EXPOSES the fee type list, whose 37 values carry no C&I entry", () => {
    // Exposed, and deliberately not curated: the room keeps its own default
    // ("origination fee" resolves to Loan Origination) until the founder says
    // otherwise. See design/proposals/wire-arms-addendum.md.
    expect(orgValues(CAT, "feeType")).toContain("Loan Origination");
    expect(catalogField(CAT, "feeType")?.note).toContain("no value in this list");
  });

  it("falls back to the mirror where the read carries nothing", () => {
    expect(chipSet(null, "borrowerType", ["Borrower"])).toEqual({ values: ["Borrower"], fromOrg: false });
    expect(chipSet(CAT, "borrowerType", ["Borrower"]).fromOrg).toBe(true);
  });
});

describe("a fenced chip set, held against the org's own", () => {
  const say = (label: string) => label;
  const chips = (labels: string[]) => labels.map((label) => ({ label, say: label }));

  it("leaves a set alone where there is no catalog", () => {
    const out = reconcileChips(chips(["Waived"]), null, "exceptionStatus", say);
    expect(out.options?.map((o) => o.label)).toEqual(["Waived"]);
    expect(out.said).toBeNull();
  });

  it("adds a value the org offers and the engine did not, and says nothing about it", () => {
    const out = reconcileChips(chips(["Mitigated", "Unmitigated"]), CAT, "exceptionStatus", say);
    expect(out.options?.map((o) => o.label)).toEqual(["Mitigated", "Unmitigated", "Waived"]);
    expect(out.said).toBeNull();
  });

  it("drops a value the write path refuses AND says so", () => {
    const out = reconcileChips(chips(["Borrower", "Grantor"]), CAT, "borrowerType", say);
    expect(out.options?.map((o) => o.label)).not.toContain("Grantor");
    expect(out.said).toContain("Grantor is on the org's own list and the write path refuses it");
  });

  it("leaves ANOTHER question's chip set completely alone", () => {
    const other = chips(["Quarterly", "Monthly"]);
    const out = reconcileChips(other, CAT, "exceptionStatus", say);
    expect(out.options).toBe(other);
    expect(out.said).toBeNull();
  });
});
