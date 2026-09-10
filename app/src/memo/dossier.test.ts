/* =============================================================================
   THE DOSSIER BUILDER, over the cockpit's own staged relationship.

   The parity test proves the renderer survived the port. This proves the OTHER
   half: that a dossier built from a live BorrowerBundle renders, that the render
   plan and the suppressed list come back for the room to show, and that the two
   are kept apart — a module a flag switched off is not work anybody has to do.

   The bundle is `artifact/live-data.json`'s Piedmont relationship: three
   facilities, four covenants, a real Boom spread, a personal guarantor, and no
   servicing connector.
   ============================================================================= */

import { describe, expect, it } from "vitest";
import live from "../../../artifact/live-data.json";
import type { BorrowerBundle } from "../data/contract";
import { buildMemoDossier, collateralTag, inferOperator } from "./dossier";
import { renderMemo, renderPlanFor, sectionsFrom } from "./renderMemo";
import { NOT_IN_SOURCE, type MemoChange } from "./types";

const bundle = live.borrower as unknown as BorrowerBundle;
const instanceUrl = live.meta.instanceUrl;

/** Two executed steps, shaped as Phase B will read them off the staging rows. */
const CHANGES: MemoChange[] = [
  {
    id: "step-1",
    label: "Increase the $5.0M revolver to $7.5M",
    target: { kind: "facility", id: "a4Zbb000001zEQTEA2", name: "Line of Credit" },
    before: { commitment: 5_000_000, outstanding: 4_250_000, maturity: "2026-07-15" },
    after: { commitment: 7_500_000, outstanding: 4_250_000, maturity: "2027-07-15" },
    verification: "Customer360Exposure re-query returned committed 7500000",
    orgId: "a4Zbb000001zEQTEA2",
  },
  {
    id: "step-2",
    label: "Book the $5.0M equipment term loan",
    target: { kind: "facility", id: "a4Zbb000001zEQTEA4", name: "Equipment" },
    after: { commitment: 5_000_000, outstanding: 0, maturity: "2033-07-15" },
    verification: "Customer360Exposure re-query returned the new facility",
    orgId: "a4Zbb000001zEQTEA4",
  },
];

const build = (changes: MemoChange[] = []) =>
  buildMemoDossier({ bundle, changes, instanceUrl, productPackageName: "Piedmont Precision C&I Credit Package" });

describe("buildMemoDossier over a live cockpit bundle", () => {
  it("renders a full memo without throwing", () => {
    const { html, plan, suppressed } = renderMemo(build(CHANGES));
    expect(html).toContain("Commercial Credit Memo");
    expect(html).toContain("Piedmont Precision Components, Inc.");
    expect(html).not.toContain("{{");
    expect(plan.length).toBeGreaterThan(5);
    expect(suppressed.length).toBeGreaterThan(0);
    expect(sectionsFrom(html).length).toBe(plan.length - 2); // less the two chrome modules
  });

  it("carries the org's own facts: every facility, every covenant, the record deep-links", () => {
    const d = build(CHANGES);
    const facilities = bundle.exposure?.facilities ?? [];
    expect(d.canon.loans.map((l) => l.ncinoId)).toEqual(facilities.map((f) => f.loanId));
    expect(d.ic.covenantCompliance).toHaveLength(bundle.covenants?.covenants?.length ?? 0);
    expect(d.canon.borrower.instanceUrl).toBe(instanceUrl);
    expect(d.canon.borrower.salesforceAccountId).toBe(bundle.snapshot.accountId);

    const { html } = renderMemo(d);
    for (const f of facilities) expect(html).toContain(`/lightning/r/LLC_BI__Loan__c/${f.loanId}/view`);
    expect(html).toContain(`/lightning/r/Account/${bundle.snapshot.accountId}/view`);
  });

  it("reads before/after and the exposure delta from the executed steps, not from the browser", () => {
    const d = build(CHANGES);
    const revolver = d.canon.loans.find((l) => l.ncinoId === "a4Zbb000001zEQTEA2");
    expect(revolver?.existing.commitment).toBe(5_000_000);
    expect(revolver?.proposed.commitment).toBe(7_500_000); // the org's current value: the step executed
    expect(revolver?.isIncrease).toBe(true);
    expect(revolver?.isNewMoney).toBe(false);

    // The org's totals are the AFTER; the BEFORE is the after less what moved.
    expect(d.canon.exposureSummary.proposed.commitment).toBe(bundle.exposure?.totalCommitted);
    expect(d.canon.exposureSummary.changeInExposure.commitment).toBe(2_500_000);
    expect(d.canon.exposureSummary.existing.commitment).toBe((bundle.exposure?.totalCommitted ?? 0) - 2_500_000);
    expect(d.canon.creditAction.flags.has_new_money).toBe(true);
    expect(d.canon.creditAction.flags.has_revolver_increase).toBe(true);
  });

  it("with no executed step, states that rather than inventing one", () => {
    const d = build();
    expect(d.canon.exposureSummary.changeInExposure.commitment).toBe(0);
    expect(d.canon.exposureSummary.existing.commitment).toBe(d.canon.exposureSummary.proposed.commitment);
    expect(d.canon.exposureSummary.changeInExposure.note).toContain("No executed plan step");
    expect(d.canon.creditAction.flags.has_new_money).toBe(false);
  });

  it("marks a figure no source system carries, and never substitutes one", () => {
    const d = build(CHANGES);
    expect(d.canon.creditApprovalSummary.hrbDesignation).toBe(NOT_IN_SOURCE);
    expect(d.canon.creditApprovalSummary.ureExceptions).toBe(NOT_IN_SOURCE);
    expect(d.canon.borrower.naicsDesc).toBe(NOT_IN_SOURCE);
    // …and the marker reaches the reader, in the table where it is looked for.
    expect(renderMemo(d).html).toContain(NOT_IN_SOURCE);
    // The plugin's own written-up demo content is NOT borrowed for this borrower.
    expect(d.canon.riskMitigants).toEqual([]);
    expect(d.canon.supportingDocuments).toEqual([]);
  });

  it("takes the covenant direction from the org's verdict, not from the covenant's name", () => {
    const covenants = bundle.covenants?.covenants ?? [];
    const byType = (t: string) => covenants.find((c) => c.covenantType === t)!;
    // Named like a minimum, tested as one.
    expect(inferOperator(byType("Debt Service Coverage Ratio"))).toBe(">=");
    // Named like neither; the org calls 2.18 against 3.00 compliant, so it is a ceiling.
    expect(inferOperator(byType("Debt-to-Worth"))).toBe("<=");
    expect(inferOperator(byType("Minimum Liquidity"))).toBe(">=");
    expect(inferOperator(byType("Fixed Asset Purchases Limit"))).toBe("<=");
    // Every covenant the org calls compliant reads as compliant in the memo.
    // Scoped to the covenant section: the shell's stylesheet names every badge class.
    const covenantSection = sectionsFrom(renderMemo(build(CHANGES)).html).find((s) => s.id === "covenant_conditions");
    expect(covenantSection?.html).toContain("badge-pass");
    expect(covenantSection?.html).not.toContain("badge-breach");
  });

  it("adapts the Boom spread to the periods the Financials tab already shows", () => {
    const d = build(CHANGES);
    expect(d.canon.spread.periods).toEqual(["FY2023", "FY2024", "FY2025"]);
    expect(d.canon.spread.incomeStatement.sales_revenue.FY2025).toBe(64_486_000);
    expect(d.canon.ratios?.revenue).toBe(bundle.boom?.ratios?.raw?.revenue);
    // Boom emits the margin as a fraction; the memo prints a percent.
    expect(d.canon.ratios?.ebitdaMarginPct).toBeCloseTo(8.116, 2);
  });

  it("keeps the Collateral section by speaking the manifest's collateral vocabulary", () => {
    // EVERY component of the Collateral module keys off `collateral_types`, so a
    // module with no matching tag is suppressed WHOLE — pledges and all. This is
    // the mapping that stops a secured relationship rendering an unsecured memo.
    expect(collateralTag("UCC-Equipment", "Three new Mazak INTEGREX machining centres")).toBe("equipment");
    expect(collateralTag("Real Estate-Warehouse", "First mortgage on the Fort Wayne campus")).toBe("real_estate");
    expect(collateralTag("UCC-Accounts", "Blanket lien on all present and future accounts")).toBe("blanket_lien");
    // Unknowable takes the narrower reading: a specific filing, not an all-asset lien.
    expect(collateralTag("Accounts Receivable", null)).toBe("specific_ucc");

    const d = build(CHANGES);
    expect(d.canon.creditAction.flags.collateral_types).toEqual(["equipment"]);
    expect(d.canon.collateral?.length).toBe(2);
    const section = sectionsFrom(renderMemo(d).html).find((s) => s.id === "collateral");
    expect(section?.html).toContain("Mazak INTEGREX");
  });

  it("renders every staged relationship, not just the one it was written against", () => {
    // The gap the parity test cannot see: a bundle whose shape differs from
    // Piedmont's. A gap marker is a pass here; a throw or a blank memo is not.
    for (const [accountId, other] of Object.entries(live.borrowers as Record<string, unknown>)) {
      const d = buildMemoDossier({ bundle: other as BorrowerBundle, instanceUrl });
      const { html, plan } = renderMemo(d);
      expect(html.length, accountId).toBeGreaterThan(20_000);
      expect(html, accountId).not.toContain("{{");
      expect(plan.map((m) => m.id), accountId).toContain("executive_summary");
      // The vendored Piedmont prose stays with Piedmont.
      if (accountId !== bundle.snapshot.accountId) expect(d.canon.narratives, accountId).toEqual({});
    }
  });

  it("renders no servicing trend, because no servicing connector is on the grant", () => {
    const d = build(CHANGES);
    expect(d.afs.revolverUsage).toBeUndefined();
    expect(renderMemo(d).html).not.toContain("Revolver Usage Trend");
  });
});

describe("renderPlanFor: the SR 11-7 render plan the room displays", () => {
  const plan = renderPlanFor(build(CHANGES));

  it("returns the ON modules and the suppressed ones, each with the manifest's own reason", () => {
    expect(plan.modules.length).toBeGreaterThan(5);
    expect(plan.suppressed.length).toBeGreaterThan(0);
    expect(plan.modules.every((m) => m.on)).toBe(true);
    expect(plan.suppressed.every((m) => !m.on)).toBe(true);
    expect(plan.modules.every((m) => m.reason.length > 0)).toBe(true);
    expect(plan.modules.map((m) => m.id)).toContain("executive_summary");
    expect(plan.modules.find((m) => m.id === "executive_summary")?.reason).toBe("always");
  });

  it("SUPPRESSED IS NOT A GAP: a module a flag switched off is absent, not incomplete", () => {
    const off = new Map(plan.suppressed.map((m) => [m.id, m]));
    // is_syndicated / is_peg / is_lft are all false on this relationship.
    for (const id of ["syndications", "peg_assessment", "leveraged_finance_ev"]) {
      const entry = off.get(id);
      expect(entry, `${id} should be suppressed`).toBeDefined();
      // Its reason is the flag that switched it off, never "always" and never a gap marker.
      expect(entry!.reason).not.toBe("always");
      expect(entry!.reason).not.toContain(NOT_IN_SOURCE);
    }

    const { html } = renderMemo(build(CHANGES));
    const rendered = new Set(sectionsFrom(html).map((s) => s.id));
    // Nothing suppressed rendered a section, so nothing suppressed can carry a
    // gap for a banker to complete. The gaps live inside the ON modules.
    for (const m of plan.suppressed) expect(rendered.has(m.id)).toBe(false);
    for (const m of plan.modules) {
      if (m.id !== "relationship_name_tbe" && m.id !== "table_of_contents") expect(rendered.has(m.id)).toBe(true);
    }
    // The engine records its own decisions in the memo itself.
    expect(html).toContain("CONDITIONALITY ENGINE: SUPPRESSED");
  });

  it("names every section the room will attest, with the module id the attestation is keyed by", () => {
    const sections = sectionsFrom(renderMemo(build(CHANGES)).html);
    expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length);
    expect(sections.every((s) => s.title.length > 0)).toBe(true);
    expect(sections.map((s) => s.id)).toEqual(
      plan.modules.filter((m) => m.id !== "relationship_name_tbe" && m.id !== "table_of_contents").map((m) => m.id),
    );
  });
});
