// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppProvider } from "../../state/appState";
import { FinancialsTab } from "./FinancialsTab";
import { newPeriodOf, publishSpread } from "../../spread/publishSpread";
import { applySpreadEvent, boomSystemWord, type SpreadRoomEvent } from "../../state/spreadPublish";
import { statementsFromPreRead } from "../../channel/boomUpload";
import { adaptBoomSpread } from "../../memo/dossier";
import type { BoomFinancialStatement, FilePreRead } from "../../spread/types";
import type { Boom, BorrowerBundle, C360Data } from "../../data/contract";
import live from "../../../../artifact/live-data.json";

/* =============================================================================
   ITEM 18 ON THE BOOK THE BROWSER ACTUALLY RAN (2026-09-12, Hartwell anchored).

   The sibling suite beside this one stands on PIEDMONT, and Piedmont is the one
   relationship in `artifact/live-data.json` whose `boom` carries a RAW
   `spread.file`. Every other relationship, Hartwell included, carries a
   HAND-SHAPED display object: `spread.periods[]` and `spread.lineItems[]` with
   no statements underneath them. That difference is the whole of what the
   browser run exposed and what the fixture could not: a run on Hartwell showed
   "Boom · 1 period · FY2025" where the book held FY2023, FY2024, FY2025 and
   LTM, no `[data-provisional-period]` badge anywhere, and "Prior FY" empty
   down the income statement.

   So this suite stands on the REAL Hartwell bundle, loaded from the same file
   the artifact ships, and on the stub's own statement shape
   (`statementsFromPreRead`), with the figures the run put on the glass.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = live as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";
const hartwell = () => (data.borrowers as Record<string, BorrowerBundle>)[HARTWELL];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(bundle: BorrowerBundle): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AppProvider data={data}>
        <FinancialsTab bundle={bundle} />
      </AppProvider>,
    );
  });
  return container;
}

const text = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ");

/* THE FILE THE BANKER DROPPED, as the room read it: one income statement, two
   columns. The figures are the ones the browser run printed. */
const DROPPED: FilePreRead = {
  fileId: "hartwell-drop",
  statements: [
    {
      statementType: "income_statement",
      periods: [
        { key: "FY2025", endDate: "2025-12-31", periodType: "annual" },
        { key: "FY2024", endDate: "2024-12-31", periodType: "annual" },
      ],
      lines: [
        { label: "Net Sales", accountCode: "net_sales_revenue", values: { FY2025: 71_200_000, FY2024: 64_486_000 }, confidence: "high" },
        { label: "Gross Profit", accountCode: "gross_profit", values: { FY2025: 21_360_000, FY2024: 19_345_800 }, confidence: "high" },
        { label: "Net Income", accountCode: "net_income", values: { FY2025: 2_700_000, FY2024: 2_180_000 }, confidence: "high" },
        { label: "Interest Expense", accountCode: "interest_expense", values: { FY2025: -1_750_000, FY2024: -1_610_000 }, confidence: "high" },
      ],
    },
  ],
  company: "Hartwell Precision Manufacturing LLC",
  companyMatchesRelationship: true,
  currency: "USD",
  unitsMultiplier: 1_000,
  statementQuality: "cpa_reviewed",
  quality: [],
  confidence: "high",
};

/** Boom's output shape, built by the stub from that pre-read. `not_validated`
 *  throughout, which is the only thing the stub is allowed to claim. */
const STATEMENTS: BoomFinancialStatement[] = statementsFromPreRead("stub-hartwell", DROPPED);

const published = (provenance: "boom" | "stub-provisional" = "stub-provisional"): Boom | null =>
  publishSpread({ onFile: hartwell().boom, statements: STATEMENTS, provenance });

function afterSpread(provenance: "boom" | "stub-provisional" = "stub-provisional"): BorrowerBundle {
  const staged = hartwell();
  return { ...staged, boom: published(provenance) ?? staged.boom };
}

const keys = (boom: Boom | null | undefined) => (boom?.spread?.periods ?? []).map((p) => p.period);
const revenueOf = (boom: Boom | null | undefined, key: string) =>
  (boom?.spread?.periods ?? []).find((p) => p.period === key)?.revenue;

describe("the stub carries both columns and the book keeps its own periods", () => {
  it("hands the stub two periods, not one", () => {
    expect(STATEMENTS).toHaveLength(1);
    expect(STATEMENTS[0].validationStatus).toBe("not_validated");
    expect(STATEMENTS[0].periods.map((p) => p.endDate)).toEqual(["2025-12-31", "2024-12-31"]);
  });

  it("keeps every on-file period and takes the two the spread carries", () => {
    expect(keys(hartwell().boom)).toEqual(["FY2023", "FY2024", "FY2025", "LTM"]);
    expect(keys(published())).toEqual(["FY2023", "FY2024", "FY2025", "LTM"]);
  });

  it("puts the dropped file's figures on the periods it spread, and only those", () => {
    const after = published();
    expect(revenueOf(after, "FY2025")).toBe(71_200_000);
    expect(revenueOf(after, "FY2024")).toBe(64_486_000);
    // Neither period came from this file, so neither moves.
    expect(revenueOf(after, "FY2023")).toBe(52_400_000);
    expect(revenueOf(after, "LTM")).toBe(64_200_000);
  });

  it("appends nothing on a second publish of the same statements", () => {
    const once = published();
    const twice = publishSpread({ onFile: once, statements: STATEMENTS, provenance: "stub-provisional" });
    expect(keys(twice)).toEqual(["FY2023", "FY2024", "FY2025", "LTM"]);
    expect(twice?.spread?.periods).toEqual(once?.spread?.periods);
  });

  /* WHERE THE RUN'S SECOND COLUMN WENT, AND WHOSE FIX IT IS. The browser run
     printed ONE period, not two, because the file it read printed no full date
     for its FY2024 column and `spread/periods.ts` returns `endDate: null`
     rather than inventing 2024-12-31. Everything downstream is keyed on the end
     date (`indexSpreadFile` in boom-normalise.mjs), so a dateless period cannot
     reach the glass at all, and publishing cannot repair it: a raw period with
     no end date carries nothing to say WHICH period it is. The fix belongs in
     the pre-read, where the file's own words are. This pins the boundary. */
  it("cannot carry a period the pre-read gave no end date", () => {
    const dateless: FilePreRead = {
      ...DROPPED,
      statements: [
        {
          ...DROPPED.statements[0],
          periods: [
            { key: "FY2025", endDate: "2025-12-31", periodType: "annual" },
            { key: "FY2024", endDate: null, periodType: "annual" },
          ],
        },
      ],
    };
    const after = publishSpread({
      onFile: hartwell().boom,
      statements: statementsFromPreRead("stub-dateless", dateless),
      provenance: "stub-provisional",
    });
    expect(keys(after)).toEqual(["FY2023", "FY2024", "FY2025", "LTM"]);
    // FY2024 stays the book's own figure: the drop's column never arrived.
    expect(revenueOf(after, "FY2024")).toBe(58_900_000);
    expect(revenueOf(after, "FY2025")).toBe(71_200_000);
  });

  it("draws one trend point per period", () => {
    const el = render(afterSpread());
    expect(text(el)).toContain("Boom · 4 periods");
    expect(el.querySelectorAll("svg .axis text")).toHaveLength(4);
  });
});

describe("the income statement fills its prior year", () => {
  it("reads LTM against the period before it, both from the file just spread", () => {
    const row = (after: Boom | null) => (after?.spread?.lineItems ?? []).find((r) => r.line === "Revenue");
    expect(row(published())?.ltm).toBe(71_200_000);
    expect(row(published())?.priorFy).toBe(64_486_000);
  });

  it("prints no empty prior-year column on the glass", () => {
    const el = render(afterSpread());
    const revenue = [...el.querySelectorAll<HTMLElement>("tr")].find((r) => text(r).startsWith("Revenue"))!;
    expect(text(revenue)).toContain("$71.20M");
    expect(text(revenue)).toContain("$64.49M");
    const interest = [...el.querySelectorAll<HTMLElement>("tr")].find((r) => text(r).startsWith("Interest Expense"))!;
    expect(text(interest)).toContain("$1.75M");
    expect(text(interest)).toContain("$1.61M");
  });
});

describe("the badge says the spread is the stub's", () => {
  it("renders on the newest period the stub spread, and names it", () => {
    const el = render(afterSpread());
    const badges = el.querySelectorAll<HTMLElement>("[data-provisional-period]");
    expect(badges).toHaveLength(1);
    expect(badges[0].getAttribute("data-provisional-period")).toBe("FY2025");
    expect(text(badges[0])).toContain("Provisional, Boom verification pending");
  });

  it("marks both periods the stub spread and neither of the book's own", () => {
    const marked = (published()?.spread?.periods ?? []).filter(
      (p) => (p as { provisional?: boolean }).provisional === true,
    );
    expect(marked.map((p) => p.period)).toEqual(["FY2024", "FY2025"]);
  });

  it("marks nothing when Boom itself answered", () => {
    const el = render(afterSpread("boom"));
    expect(el.querySelector("[data-provisional-period]")).toBeNull();
  });

  it("never calls a stub spread verified", () => {
    expect(text(render(afterSpread()))).not.toMatch(/\bverified\b/i);
  });
});

describe("no ratio is invented on a book that carries none", () => {
  it("leaves the on-file ratios exactly where they were", () => {
    const before = hartwell().boom!;
    expect(published()?.ratios).toEqual(before.ratios);
    expect(published()?.ratios?.asOf).toBeUndefined();
  });

  it("keeps the ratio tiles on the glass", () => {
    const el = render(afterSpread());
    expect(text(el)).toContain("EBITDA$5.20M");
    expect(text(el)).toContain("EBITDA margin8.1%");
    expect(text(el)).toContain("2.42×");
    expect(text(el)).toContain("2.95×");
  });

  it("prints no EBITDA on a period the ratios were not computed for", () => {
    const spread = (published()?.spread?.periods ?? []).find((p) => p.period === "FY2025");
    expect(spread?.ebitda).toBeUndefined();
    expect(spread?.margin).toBeUndefined();
  });
});

describe("the memo's Boom graph reads the same spread", () => {
  it("sees every period the raw file now carries", () => {
    const { spread } = adaptBoomSpread(published()?.spread?.file);
    expect(spread.periods).toEqual(["FY2024", "FY2025"]);
    expect(spread.incomeStatement.sales_revenue.FY2025).toBe(71_200_000);
    expect(spread.incomeStatement.sales_revenue.FY2024).toBe(64_486_000);
    expect(spread.incomeStatement.net_income.FY2025).toBe(2_700_000);
  });
});

describe("the trail names what landed", () => {
  const event: SpreadRoomEvent = {
    phase: "completed",
    accountId: HARTWELL,
    company: "Hartwell Precision Manufacturing LLC",
    summary: "1 statement to Boom, Hartwell Precision Manufacturing LLC: FY2025 reviewed income statement.",
    planKey: "sha-hartwell",
    fileCount: 1,
    statements: STATEMENTS,
    provenance: "stub-provisional",
    system: boomSystemWord("stub"),
    signedOff: false,
    failure: null,
  };

  it("names the newest period the spread moved", () => {
    expect(newPeriodOf(hartwell().boom, published())).toBe("FY2025");
  });

  it("publishes the book and logs the entry that names the period", () => {
    const sent: Array<{ type: string }> = [];
    const applied = applySpreadEvent({
      event,
      onFileBoom: hartwell().boom,
      dispatch: (action) => sent.push(action),
      actor: "Dana Whitfield",
    });
    expect(applied.period).toBe("FY2025");
    expect(sent.map((a) => a.type)).toEqual(["PATCH_BUNDLE", "LOG_ACTIVITY"]);
  });
});
