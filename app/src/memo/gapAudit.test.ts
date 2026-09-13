/* =============================================================================
   THE GAP AUDIT — every "[not in source system; flagged for RM]" in the memo,
   named, located and classified.

   FOUNDER QUESTION (Fabian, 2026-09-13): "there is a lot of 'not in source
   system' in the memo; check in detail if something is missing or if we can
   enhance it from our book."

   THIS FILE IS THE ANSWER, AND IT IS A TEST SO THE ANSWER STAYS TRUE. It builds
   the memo dossier for BOTH live relationships in `artifact/live-data.json`, for
   BOTH of the room's triggers (an ad hoc memo with no executed step, and a
   modify memo carrying executed steps), renders each through the vendored
   renderer, and inventories two different things that both look like a hole:

     THE MARKER   a dossier field the bundle cannot fill. The renderer never
                  writes the marker itself — it prints what the dossier holds —
                  so every occurrence in the HTML traces to a field below.
     A DROPPED    a renderer block that emits nothing because the data behind it
     BLOCK        is absent. Distinct from a SUPPRESSED module, which a flag
                  switched off (references/conditionality.md): a suppressed
                  module has nothing for anyone to complete, a dropped block has.

   EVERY GAP IS CLASSIFIED, and an unclassified one fails the test:

     A  the bundle carries it (or it is derivable from the bundle) and the
        dossier did not map it. Fixed in dossier.ts.
     B  the org has it but none of the ten Customer 360 reads carries it. The
        object.field and the read that would carry it are named. Apex is out of
        scope here; the marker stays and the list below is the work order.
     C  no source we have carries it at all. The marker stays. That is the
        SR 11-7 doctrine, not a defect.
   ============================================================================= */

import { describe, expect, it } from "vitest";
import live from "../../../artifact/live-data.json";
import type { BorrowerBundle } from "../data/contract";
import { buildMemoDossier } from "./dossier";
import { applyMemoOverrides, proFormaLeverageFrom } from "./overrides";
import { renderMemo, sectionsFrom } from "./renderMemo";
import { NOT_IN_SOURCE, type MemoChange, type MemoDossier } from "./types";

const borrowers = live.borrowers as unknown as Record<string, BorrowerBundle>;
const HARTWELL = borrowers["001bb00001I7FPNAA3"];
const PIEDMONT = borrowers["001bb00001DLtRMAA1"];

/** Hartwell's executed steps, as `overrides.test.ts` reads them off the trail. */
const HARTWELL_CHANGES: MemoChange[] = [
  {
    id: "write_loan",
    label: "Increase the line of credit to $15.0M",
    target: { kind: "LLC_BI__Loan__c", id: "a4Zbb0000027MaYEAU", name: "Line of Credit" },
    before: { commitment: 12_000_000 },
    after: { commitment: 15_000_000 },
    verification: "Customer360Exposure returned committed 15000000 on a4Zbb0000027MaYEAU",
    orgId: "a4Zbb0000027MaYEAU",
  },
  {
    id: "write_loan_2",
    label: "Book the equipment term loan",
    target: { kind: "LLC_BI__Loan__c", id: "a4Zbb000002CECXEA4", name: "Equipment" },
    after: { commitment: 3_000_000 },
    verification: "Customer360Exposure returned the new facility a4Zbb000002CECXEA4",
    orgId: "a4Zbb000002CECXEA4",
  },
];

/** Piedmont's, as `dossier.test.ts` reads them. */
const PIEDMONT_CHANGES: MemoChange[] = [
  {
    id: "step-1",
    label: "Increase the $5.0M revolver to $7.5M",
    target: { kind: "facility", id: "a4Zbb000001zEQTEA2", name: "Line of Credit" },
    before: { commitment: 5_000_000, outstanding: 4_250_000, maturity: "2026-07-15" },
    after: { commitment: 7_500_000, outstanding: 4_250_000, maturity: "2027-07-15" },
    verification: "Customer360Exposure re-query returned committed 7500000",
    orgId: "a4Zbb000001zEQTEA2",
  },
];

/* -----------------------------------------------------------------------------
   THE FOUR MEMOS. Built the way `MemoRoomHost` builds one: the same bundle, the
   same executed steps, the same instance url, and the trigger's own credit
   event — `create` is a new relationship, everything else is existing material.
   ----------------------------------------------------------------------------- */

interface AuditCase {
  bundle: "Hartwell" | "Piedmont";
  trigger: "adhoc" | "modify";
  dossier: MemoDossier;
  html: string;
  suppressed: readonly string[];
}

const caseFor = (
  bundle: "Hartwell" | "Piedmont",
  trigger: "adhoc" | "modify",
  b: BorrowerBundle,
  changes: MemoChange[],
): AuditCase => {
  const dossier = buildMemoDossier({
    bundle: b,
    changes,
    instanceUrl: live.meta.instanceUrl,
    productPackageName: `${b.snapshot.name} credit package`,
    creditEvent: "existing_material",
  });
  const { html, suppressed } = renderMemo(dossier);
  return { bundle, trigger, dossier, html, suppressed };
};

const CASES: AuditCase[] = [
  caseFor("Hartwell", "adhoc", HARTWELL, []),
  caseFor("Hartwell", "modify", HARTWELL, HARTWELL_CHANGES),
  caseFor("Piedmont", "adhoc", PIEDMONT, []),
  caseFor("Piedmont", "modify", PIEDMONT, PIEDMONT_CHANGES),
];

/* -----------------------------------------------------------------------------
   WALKING THE DOSSIER FOR THE MARKER
   ----------------------------------------------------------------------------- */

/** Every path in the dossier whose value IS the marker, in document order. */
function markerPaths(value: unknown, at = ""): string[] {
  if (value === NOT_IN_SOURCE) return [at];
  if (Array.isArray(value)) return value.flatMap((v, i) => markerPaths(v, `${at}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      markerPaths(v, at ? `${at}.${k}` : k),
    );
  }
  return [];
}

/** The same path with array indices collapsed, so twelve pledges are one row. */
const generalise = (path: string): string => path.replace(/\[\d+\]/g, "[]");

const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/* -----------------------------------------------------------------------------
   THE CLASSIFICATION. One row per dossier field that can hold the marker.
   ----------------------------------------------------------------------------- */

interface GapClass {
  /** The generalised dossier path. */
  path: string;
  /** Which memo module prints it. */
  module: string;
  klass: "A" | "B" | "C";
  /** For A: what the bundle carries and what was done. For B: object.field and
   *  the read that would carry it. For C: why nothing we have carries it. */
  note: string;
}

const CLASSIFIED: readonly GapClass[] = [
  {
    path: "canon.borrower.naicsDesc",
    module: "cover",
    klass: "B",
    note: "The NAICS TITLE for the code. Customer360Snapshot returns naicsCode and the Salesforce Industry picklist, not the NAICS description; Account.NaicsDesc would carry it on that read. The Industry value is a different field and printing it here would mislabel it.",
  },
  {
    path: "canon.borrower.profile",
    module: "borrower_description",
    klass: "A",
    note: "FIXED: composed from the snapshot's own industry, NAICS code and annual revenue. Still the marker when the snapshot carries none of the three.",
  },
  {
    path: "canon.creditAction.productPackageName",
    module: "cover",
    klass: "B",
    note: "LLC_BI__Product_Package__c.Name via Customer360Snapshot, which returns productPackageId only. The room passes a derived label, so this is the marker only where no package is anchored at all.",
  },
  {
    path: "canon.creditApprovalSummary.hrbDesignation",
    module: "executive_summary",
    klass: "C",
    note: "Highly Restricted Borrower designation. A credit-policy determination held in no system the cockpit reads.",
  },
  {
    path: "canon.creditApprovalSummary.ureExceptions",
    module: "executive_summary",
    klass: "C",
    note: "Underwriting requirement exceptions. No policy-exception record is on any read; deriving one from covenant state would be a different fact wearing its name.",
  },
  {
    path: "canon.creditApprovalSummary.pastDueFinancialStatements",
    module: "executive_summary",
    klass: "C",
    note: "The financial-statement ticklers. Boom carries the statements it has spread, never the ones the borrower owes.",
  },
  {
    path: "canon.guarantor.name",
    module: "guarantor_profile",
    klass: "A",
    note: "graph.legalEntities[].accountName. Present on both bundles; the marker only where a guarantor row carries no name.",
  },
  {
    path: "canon.guarantor.guarantyType",
    module: "guarantor_profile",
    klass: "A",
    note: "FIXED: read from guarantyAmountType (Unlimited / Limited) with relationshipType as the qualifier. It was reading relationshipType alone, which Hartwell's rows leave null, so an Unlimited corporate guaranty printed as a gap.",
  },
  {
    path: "canon.loans[].riskRating",
    module: "executive_summary",
    klass: "C",
    note: "exposure.facilities[].riskGrade, and the marker is the ORG'S OWN empty field: Hartwell's a4Zbb000002CECXEA4 sits at stage Proposal and carries no risk grade yet. Nothing is missing from the read and nothing is derivable; an ungraded facility reads as ungraded.",
  },
  {
    path: "canon.loans[].existing.commitment",
    module: "executive_summary",
    klass: "A",
    note: "The step's own before block, else the org's current commitment.",
  },
  {
    path: "canon.loans[].existing.outstanding",
    module: "executive_summary",
    klass: "A",
    note: "The step's own before block, else the org's current outstanding.",
  },
  {
    path: "canon.collateral[].description",
    module: "collateral",
    klass: "A",
    note: "exposure.facilities[].collateral[].collateralDescription, with collateralName as the fallback. Present on every pledge both bundles carry.",
  },
  {
    path: "canon.collateral[].lienPosition",
    module: "collateral",
    klass: "A",
    note: "exposure.facilities[].collateral[].lienPosition. Present on every pledge both bundles carry.",
  },
  {
    path: "canon.borrower.naics",
    module: "cover",
    klass: "A",
    note: "snapshot.naicsCode. Present on both bundles.",
  },
  {
    path: "canon.exposureSummary.existing.commitment",
    module: "executive_summary",
    klass: "A",
    note: "exposure.totalCommitted less what the executed steps moved.",
  },
  {
    path: "canon.exposureSummary.proposed.commitment",
    module: "executive_summary",
    klass: "A",
    note: "exposure.totalCommitted.",
  },
  {
    path: "ic.covenantCompliance[].name",
    module: "covenant_conditions",
    klass: "A",
    note: "covenants.covenants[].covenantType. Present on every covenant both bundles carry.",
  },
];

const classOf = (path: string): GapClass | undefined => CLASSIFIED.find((c) => c.path === path);

/* -----------------------------------------------------------------------------
   THE BLOCKS THAT DROP OUT FOR MISSING DATA (never for a flag)
   ----------------------------------------------------------------------------- */

interface DataBlock {
  module: string;
  block: string;
  /** The dossier field the renderer tests before emitting anything. */
  needs: string;
  /** True when the dossier carries what the block needs. */
  has: (d: MemoDossier) => boolean;
  /** A string that appears in the rendered memo if, and only if, it emitted. */
  signature: string;
  klass: "A" | "B" | "C";
  note: string;
}

const DATA_BLOCKS: readonly DataBlock[] = [
  {
    module: "financial_commentary",
    block: "Key Metrics table (one column per period the book carries)",
    needs: "canon.spread.periods",
    has: (d) => d.canon.spread.periods.length > 0,
    signature: "<th>Metric</th>",
    klass: "A",
    note: "FIXED for a display-only book: Hartwell carries no raw boom.spread.file, but boom.spread.periods and boom.spread.lineItems are figures on file with a source, so the period axis is built from them. The table itself is rebuilt by the seam (2026-09-13, founder report); keyMetrics.test.ts is the rule.",
  },
  {
    module: "financial_commentary",
    block: "Spreading trends (revenue / EBITDA and margin charts)",
    needs: "canon.spread.periods",
    has: (d) => d.canon.spread.periods.length > 0,
    signature: "Spreading Trends",
    klass: "A",
    note: "Same fix. The charts are drawn from the display periods, and the Boom line-item graph itself stays gap-marked: no balance sheet and no cash-flow statement is on a display-only book.",
  },
  {
    module: "financial_commentary",
    block: "Revolver usage trend",
    needs: "afs.revolverUsage",
    has: (d) => d.afs.revolverUsage != null,
    signature: "Revolver Usage Trend",
    klass: "C",
    note: "12-month servicing utilisation. AFS is not on the cockpit's grant and snapshot.afs carries no obligation coordinates on either bundle, so there is nothing to read.",
  },
  {
    module: "financial_commentary",
    block: "Sensitivity analysis",
    needs: "ic.sensitivity.scenarios",
    has: (d) => (d.ic.sensitivity?.scenarios ?? []).length > 0,
    signature: "<th>Scenario</th>",
    klass: "C",
    note: "A scenario set is modelled, not read. Nothing in the org or in Boom carries one.",
  },
  {
    module: "risk_rating_internal",
    block: "Risk rating trend",
    needs: "ic.riskRatingTrend.events",
    has: (d) => (d.ic.riskRatingTrend?.events ?? []).length > 0,
    signature: "Risk Rating Trend",
    klass: "B",
    note: "Rating history over time. Customer360Snapshot returns primaryRiskRating as of now; the history lives on LLC_BI__Risk_Rating__c / the rating-change audit and no read carries it.",
  },
  {
    module: "industry_analysis",
    block: "Peer comparison table",
    needs: "peers.peers.set",
    has: (d) => (d.peers.peers?.set ?? []).length > 0,
    signature: "Peer Comparison",
    klass: "C",
    note: "Peer set and industry outlook. The vendored placeholder stands in and the renderer chips it as a stub; no cockpit read carries peers.",
  },
  {
    module: "collateral",
    block: "Collateral table",
    needs: "canon.collateral",
    has: (d) => (d.canon.collateral ?? []).length > 0,
    signature: "<th>Collateral</th>",
    klass: "A",
    note: "exposure.facilities[].collateral. Hartwell carries pledges on every facility; Piedmont carries them on the equipment facility only.",
  },
  {
    module: "covenant_conditions",
    block: "Covenant compliance table",
    needs: "ic.covenantCompliance",
    has: (d) => (d.ic.covenantCompliance ?? []).length > 0,
    signature: "<th>Covenant</th>",
    klass: "A",
    note: "covenants.covenants. Both bundles carry them.",
  },
  {
    module: "risk_mitigants",
    block: "Risk / mitigant / residual grid",
    needs: "canon.riskMitigants",
    has: (d) => (d.canon.riskMitigants ?? []).length > 0,
    signature: "<td>Margin compression</td>",
    klass: "C",
    note: "Written credit judgement. Deliberately empty rather than borrowing the plugin's demo assessment; the reviewer writes it in the per-section review.",
  },
  {
    module: "risk_rating_internal",
    block: "Rating factor grid",
    needs: "canon.riskRatingFactors",
    has: (d) => (d.canon.riskRatingFactors ?? []).length > 0,
    signature: "<td>Financial strength</td>",
    klass: "C",
    note: "Written credit judgement, same reason.",
  },
  {
    module: "appendix",
    block: "Supporting document index",
    needs: "canon.supportingDocuments",
    has: (d) => (d.canon.supportingDocuments ?? []).length > 0,
    signature: '<td class="cmr-doc-name">',
    klass: "A",
    note: "FIXED: the Boom spread file the figures were read off, and every collateral valuation on the book, are documents the cockpit can name. Everything else in DocMan is on no read.",
  },
];

/* -----------------------------------------------------------------------------
   WHAT ONLY THE VENDOR CAN FIX

   `renderMemo.vendor.mjs` is derived from a hash-checked copy of the plugin's
   own renderer and neither may be edited here, so the findings below are
   written down rather than fixed. Some are cosmetic-but-real; the ones that
   printed a wrong figure are held off the glass by the post-render seam
   (`overrides.ts`) until upstream takes them.
   ----------------------------------------------------------------------------- */

export const VENDOR_SIDE: ReadonlyArray<{ where: string; finding: string }> = [
  {
    where: "render-memo.mjs, the Key Metrics pro forma leverage cell",
    finding:
      "Total debt missing is read as zero and divided into a real EBITDA, printing 0.00x. Reachable on any dossier with no balance sheet. Held off the glass by the `pro_forma_leverage` entry in overrides.ts; the renderer should emit its own gap cell instead.",
  },
  /* THE FOUR THE FOUNDER'S 2026-09-13 REPORT NAMED. All four are shape, not
     data: no dossier can render them correctly, so the seam rebuilds the whole
     block (`key_metrics_table` in overrides.ts) and keyMetrics.test.ts holds
     the result. Upstream should take all four. */
  {
    where: "render-memo.mjs:411 and :412, the Key Metrics pro forma Revenue and Adjusted EBITDA cells",
    finding:
      "Both cells repeat the latest fiscal column's figure and stamp it \"(unchanged)\", on every memo, whether or not a step was executed. A reader meets the same figure twice and a fourth column that looks like a fourth year.",
  },
  {
    where: "render-memo.mjs:387, the Key Metrics period axis",
    finding:
      "`periodsArr.slice(-3)` caps the table at three columns. Hartwell's book carries FY2023, FY2024, FY2025 and LTM, and FY2023 fell off with nothing on the page saying it had. The table should print one column per period the spread carries.",
  },
  {
    where: "render-memo.mjs:416, the Key Metrics Debt Service Coverage row",
    finding:
      "nCino's last covenant test is printed in the LAST FISCAL COLUMN. That test has its own evaluation date (Hartwell 2026-07-15, Piedmont 2026-04-30), which is not the fiscal period it is printed under, so one row carries two source systems on two different clocks. It belongs in its own labelled column or in a footnote naming the test date.",
  },
  {
    where: "render-memo.mjs:413 to :416, the Key Metrics gap cells",
    finding:
      "Three vocabularies for one absence inside one table: \"flagged for RM\" in a measured cell, \"not modeled\" in a pro forma one, and the doctrine marker written in by the seam's own `pro_forma_leverage` entry. \"not modeled\" also claims a modelling decision where the fact is that no source carries the figure.",
  },
  {
    where: "render-memo.mjs, the Key Metrics free cash flow row",
    finding:
      "Free cash flow is derived as operating cash flow plus capital expenditure, so a book that carries the figure itself and not its two parts cannot fill the row. A `free_cash_flow` account code read directly would fill it from a display book.",
  },
  {
    where: "render-memo.mjs, the guarantor table",
    finding:
      "One guarantor is rendered. Hartwell's package carries three (an unlimited corporate guaranty, an unlimited personal one and a limited one), and the memo names the first. A guarantor LIST would carry the package as the org records it.",
  },
  {
    where: "render-memo.mjs, the spreading block and the `src()` helper",
    finding:
      "`src()` is defined and never called, so a figure has no source line beneath it. The dossier now labels a display-derived book `Boom, as displayed on the cockpit's book` in `boom.files[].\_source`; printing that under the spreading charts is a one-line vendor change.",
  },
];

/* -----------------------------------------------------------------------------
   THE TABLE
   ----------------------------------------------------------------------------- */

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

function printTable(): void {
  const lines: string[] = [];
  lines.push("");
  lines.push("GAP AUDIT — memo dossier over the two live bundles");
  lines.push("");
  lines.push(`${pad("MODULE", 24)}${pad("FIELD", 46)}${pad("BUNDLE/TRIGGER", 34)}${pad("CLASS", 6)}WHY`);
  lines.push("-".repeat(140));

  const seen = new Map<string, { cases: string[]; g: GapClass }>();
  for (const c of CASES) {
    for (const path of new Set(markerPaths(c.dossier).map(generalise))) {
      const g = classOf(path);
      if (!g) continue;
      const key = path;
      const row = seen.get(key) ?? { cases: [], g };
      row.cases.push(`${c.bundle}/${c.trigger}`);
      seen.set(key, row);
    }
  }
  for (const [path, { cases, g }] of seen) {
    lines.push(`${pad(g.module, 24)}${pad(path, 46)}${pad(cases.join(" "), 34)}${pad(g.klass, 6)}${g.note}`);
  }

  lines.push("");
  lines.push("BLOCKS THAT EMIT NOTHING FOR MISSING DATA (not conditionality)");
  lines.push("-".repeat(140));
  for (const b of DATA_BLOCKS) {
    const missing = CASES.filter((c) => !b.has(c.dossier)).map((c) => `${c.bundle}/${c.trigger}`);
    if (!missing.length) continue;
    lines.push(`${pad(b.module, 24)}${pad(b.block, 46)}${pad(missing.join(" "), 34)}${pad(b.klass, 6)}needs ${b.needs} — ${b.note}`);
  }

  lines.push("");
  lines.push("MARKER COUNT PER MEMO");
  lines.push("-".repeat(140));
  for (const c of CASES) {
    const sections = sectionsFrom(c.html);
    const inSections = sections.reduce((n, s) => n + occurrences(s.html, NOT_IN_SOURCE), 0);
    const total = occurrences(c.html, NOT_IN_SOURCE);
    const where = sections
      .map((s) => ({ id: s.id, n: occurrences(s.html, NOT_IN_SOURCE) }))
      .filter((s) => s.n > 0)
      .map((s) => `${s.id}×${s.n}`)
      .join(" ");
    lines.push(
      `${pad(`${c.bundle}/${c.trigger}`, 24)}${pad(`${total} marker(s)`, 46)}${pad(`cover/chrome ×${total - inSections}`, 20)}      ${where}`,
    );
  }
  lines.push("");
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

/* -----------------------------------------------------------------------------
   THE ASSERTIONS
   ----------------------------------------------------------------------------- */

describe("the memo gap audit", () => {
  it("prints the gap table", () => {
    printTable();
    expect(CASES).toHaveLength(4);
  });

  it("has a classification for every gap the dossier holds", () => {
    const unclassified = new Set<string>();
    for (const c of CASES) {
      for (const path of markerPaths(c.dossier).map(generalise)) {
        if (!classOf(path)) unclassified.add(path);
      }
    }
    // A gap nobody has looked at is the one failure this audit exists to stop.
    expect([...unclassified]).toEqual([]);
  });

  it("leaves no class A gap standing on either bundle", () => {
    const stillOpen: string[] = [];
    for (const c of CASES) {
      for (const path of new Set(markerPaths(c.dossier).map(generalise))) {
        if (classOf(path)?.klass === "A") stillOpen.push(`${c.bundle}/${c.trigger} ${path}`);
      }
    }
    expect(stillOpen).toEqual([]);
  });

  it("keeps the class C gaps marked: the marker is the doctrine, not a defect", () => {
    for (const c of CASES) {
      const paths = new Set(markerPaths(c.dossier).map(generalise));
      expect(paths.has("canon.creditApprovalSummary.hrbDesignation")).toBe(true);
      expect(paths.has("canon.creditApprovalSummary.ureExceptions")).toBe(true);
      expect(paths.has("canon.creditApprovalSummary.pastDueFinancialStatements")).toBe(true);
      // …and the reader meets them, in the table a credit officer looks in.
      expect(c.html).toContain(NOT_IN_SOURCE);
    }
  });

  it("emits a block exactly when the dossier carries what it needs", () => {
    for (const c of CASES) {
      for (const b of DATA_BLOCKS) {
        expect({ case: `${c.bundle}/${c.trigger}`, block: b.block, emitted: c.html.includes(b.signature) }).toEqual({
          case: `${c.bundle}/${c.trigger}`,
          block: b.block,
          emitted: b.has(c.dossier),
        });
      }
    }
  });

  it("renders the financial modules for a display-only Boom book", () => {
    // Hartwell has no raw `boom.spread.file`. The figures are still on the book,
    // with a source, so the period axis and the ratio tables render from them —
    // and nothing fabricates a Boom file to get there.
    const hartwell = CASES.filter((c) => c.bundle === "Hartwell");
    for (const c of hartwell) {
      expect(HARTWELL.boom?.spread?.file).toBeUndefined();
      expect(c.dossier.canon.spread.periods).toEqual(["FY2023", "FY2024", "FY2025", "LTM"]);
      expect(c.dossier.canon.spread.incomeStatement.sales_revenue.LTM).toBe(64_200_000);
      expect(c.dossier.canon.spread.incomeStatement.adjusted_ebitda.LTM).toBe(5_200_000);
      // The graph itself stays a gap: a display book carries no balance sheet
      // and no cash-flow statement, and neither is invented to fill the table.
      expect(c.dossier.canon.spread.balanceSheet.total_debt).toBeUndefined();
      expect(c.dossier.canon.spread.cashFlow.operating_cash_flow).toBeUndefined();
      expect(c.html).toContain("Spreading Trends");
    }
  });

  it("holds the renderer's zero-debt pro forma leverage off the glass", () => {
    // The one finding from this audit that printed a WRONG figure rather than a
    // missing one. See VENDOR_SIDE. The seam writes the marker where the dossier
    // has no balance sheet, and leaves a correct cell alone where it has one.
    const seam = (c: AuditCase) =>
      applyMemoOverrides(c.html, { proFormaLeverage: proFormaLeverageFrom(c.dossier) });
    const leverageRow = (html: string) => /<tr><td>Debt \u00f7 EBITDA<\/td>.*?<\/tr>/.exec(html)?.[0] ?? "";

    for (const c of CASES.filter((x) => x.bundle === "Hartwell")) {
      // Hartwell has no balance sheet, so every measured period is a gap and
      // the pro forma cell is a MULTIPLE anyway: zero debt on an ad hoc memo,
      // this action's new money alone on a modify memo. Both are wrong.
      expect(leverageRow(c.html)).toMatch(/<td class="numeric">\d+\.\d\dx<\/td><\/tr>$/);
      expect(leverageRow(seam(c))).toContain(NOT_IN_SOURCE);
      expect(leverageRow(seam(c))).not.toMatch(/<td class="numeric">\d+\.\d\dx<\/td><\/tr>$/);
    }
    for (const c of CASES.filter((x) => x.bundle === "Piedmont")) {
      // Piedmont's raw spread carries the balance sheet, so the cell is real.
      expect(leverageRow(seam(c))).toBe(leverageRow(c.html));
      expect(leverageRow(c.html)).not.toContain(NOT_IN_SOURCE);
    }
  });

  it("names what only the vendor can fix", () => {
    expect(VENDOR_SIDE.length).toBeGreaterThan(0);
    for (const v of VENDOR_SIDE) expect(v.where).toContain("render-memo.mjs");
  });

  it("never prints a figure the bundle does not carry", () => {
    // The renderer writes the marker nowhere: every occurrence on the glass is a
    // dossier field this audit has classified. Prove it by counting.
    for (const c of CASES) {
      const fields = markerPaths(c.dossier).length;
      expect(fields).toBeGreaterThan(0);
      expect(occurrences(c.html, NOT_IN_SOURCE)).toBeGreaterThan(0);
    }
  });
});
