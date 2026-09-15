// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BorrowerBundle, C360Data } from "./data/contract";
import { AppProvider } from "./state/appState";
import { FinancialsTab } from "./components/tabs/FinancialsTab";
import { normaliseBoom } from "../../client-360/render/boom-normalise.mjs";
import live from "../../artifact/live-data.json";

/* =============================================================================
   ONE BOOM SHAPE (Cowork feedback 2026-09-03, addendum item 6).

   The Financials tab read a display object; the covenant challenge read the raw boom_get_spread
   payload. Whichever shape the agent staged, the other consumer rendered nothing. Both now read the
   output of client-360/render/boom-normalise.mjs, which the assembler runs once and the app's live
   refresh path runs on what the connector hands back.

   What these tests hold: the staged Piedmont payload IS the live one (raw underneath, display on
   top), the tab still prints its figures, and prior-year EBITDA is null rather than derived, because
   Boom's accountCode chart carries no D&A line to derive it from.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = live as unknown as C360Data;
const PIEDMONT = "001bb00001DLtRMAA1";
const piedmont = () => (data.borrowers as Record<string, BorrowerBundle>)[PIEDMONT];

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
const rowFor = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLElement>(".rr")].find((r) => text(r).startsWith(label));

describe("the staged Boom payload is the normalised one", () => {
  it("carries the raw connector payloads under the display fields", () => {
    const boom = piedmont().boom!;
    expect(boom.ratios?.raw?.ebitda).toBe(5_234_000);
    expect(boom.ratios?.asOf).toBe("2025-12-31");
    expect(boom.spread?.file).toBeTruthy();
  });

  it("is what the shared normaliser produces, unchanged by a second pass", () => {
    const boom = piedmont().boom!;
    expect(normaliseBoom(boom)).toEqual(boom);
  });

  it("scales Boom's fractional margin into the percent the tab prints", () => {
    const boom = piedmont().boom!;
    expect(boom.ratios?.raw?.ebitdaMargin).toBeCloseTo(0.0812, 4);
    expect(boom.ratios?.ebitdaMargin).toBeCloseTo(8.12, 2);
  });
});

describe("Piedmont's Financials tab still reads", () => {
  it("prints revenue, EBITDA, leverage and interest coverage", () => {
    const el = render(piedmont());
    expect(text(rowFor(el, "Revenue")!)).toContain("$64.49M");
    expect(text(rowFor(el, "EBITDA")!)).toContain("$5.23M");
    expect(text(rowFor(el, "Total leverage")!)).toContain("3.85×");
    expect(text(rowFor(el, "Interest coverage")!)).toContain("2.64×");
  });

  it("names the workbook the figures came from", () => {
    const el = render(piedmont());
    expect(text(el)).toContain("Piedmont_Precision_Components_Financials_FY2023-2025.xlsx");
  });

  it("plots one point per spread period", () => {
    const el = render(piedmont());
    expect(piedmont().boom?.spread?.periods).toHaveLength(3);
    expect(text(el)).toContain("Boom · 3 periods");
  });
});

describe("EBITDA belongs to one period and no other", () => {
  it("carries EBITDA only on the ratios' asOf period", () => {
    const periods = piedmont().boom?.spread?.periods ?? [];
    const withEbitda = periods.filter((p) => p.ebitda != null);
    expect(withEbitda).toHaveLength(1);
    expect(withEbitda[0].period).toBe("FY2025");
  });

  it("leaves the prior year's EBITDA out rather than deriving one", () => {
    const ebitda = (piedmont().boom?.spread?.lineItems ?? []).find((r) => r.line === "EBITDA");
    expect(ebitda?.ltm).toBe(5_234_000);
    expect(ebitda?.priorFy).toBeUndefined();
  });

  it("prints EBITDA once, on the ratio card, and never as a zero", () => {
    /* RESTATED FOR THE REGISTER (0.9.28). Piedmont carries the raw
       `spread.file`, so the statement surface is the register and the register
       draws Boom's own lines: Boom's income statement has no EBITDA line at
       all. The derived figure therefore appears exactly once, on Key ratios,
       and the prior year it has no support for is not printed anywhere. */
    const el = render(piedmont());
    expect(el.querySelector(".rg")).not.toBeNull();
    expect(rowFor(el, "EBITDA")).toBeTruthy();
    expect(text(rowFor(el, "EBITDA")!)).toContain("$5.23M");
    expect([...el.querySelectorAll(".rg-t tbody .rg-nm")].map((n) => n.textContent)).not.toContain("EBITDA");
    expect(text(el)).not.toContain("$0");
  });
});

describe("the live refresh path normalises what the connector returns", () => {
  // boom_get_ratios answers with a `raw` object AND a `ratios` array of display cards. Spreading
  // that envelope straight onto the bundle put the CARDS where the tab expects the ratio object.
  const ratiosPayload = {
    company: "Piedmont Precision Components, Inc.",
    asOf: "2025-12-31",
    raw: { revenue: 64_486_000, ebitda: 5_234_000, leverage: 3.8460068781047, interestCoverage: 2.637546468401487, ebitdaMargin: 0.08116490401017275 },
    ratios: [{ label: "Revenue", value: "$64.5M", status: "neutral" }],
  };

  it("lands the numeric contract, never the display cards", () => {
    const merged = normaliseBoom({ ratios: ratiosPayload, spread: { file: piedmont().boom?.spread?.file } })!;
    expect(Array.isArray(merged.ratios)).toBe(false);
    expect(merged.ratios?.revenue).toBe(64_486_000);
    expect(merged.ratios?.totalLeverage).toBeCloseTo(3.85, 2);
    expect(merged.ratios?.interestCoverage).toBeCloseTo(2.64, 2);
  });

  it("renders the refreshed bundle exactly as the staged one does", () => {
    const merged = normaliseBoom({ ratios: ratiosPayload, spread: { file: piedmont().boom?.spread?.file } })!;
    const el = render({ ...piedmont(), boom: merged } as BorrowerBundle);
    expect(text(rowFor(el, "Revenue")!)).toContain("$64.49M");
    expect(text(rowFor(el, "EBITDA")!)).toContain("$5.23M");
    expect(text(rowFor(el, "Total leverage")!)).toContain("3.85×");
  });
});
