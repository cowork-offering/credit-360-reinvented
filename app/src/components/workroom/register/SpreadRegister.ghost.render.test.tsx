// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SpreadRegister } from "./SpreadRegister";
import { ghostStatements, type GhostStatement } from "./ghostModel";
import type { BoomFinancialStatement, FilePreRead, PreReadLine } from "../../../spread/types";
import spreadLive from "../../../__fixtures__/boom-live/spread-piedmont.json";

/* =============================================================================
   THE GHOST REGISTER ON THE GLASS (0.9.32).

   The mapped side is Boom's own live read of Piedmont; the ghost side is the
   same statement as the room's pre-read takes it off the page. What is asserted
   here is the SURFACE the founder gated: the rows stand in faint ink with the
   chip column reserved and ruled, they are APPENDED rather than pre-laid, a
   pinned row lights first when Boom answers, the validation word comes off
   Boom's own rung, the reconciliation is the derived sentence and nothing where
   nothing differs, and reduced motion reaches every one of those facts in one
   commit.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const K = 1_000;
const PERIODS = [
  { key: "FY2025", endDate: "2025-12-31", periodType: "annual" as const },
  { key: "FY2024", endDate: "2024-12-31", periodType: "annual" as const },
  { key: "FY2023", endDate: "2023-12-31", periodType: "annual" as const },
];

function line(label: string, fy2025: number, fy2024: number, fy2023: number): PreReadLine {
  return {
    label,
    accountCode: null,
    values: { FY2025: fy2025 * K, FY2024: fy2024 * K, FY2023: fy2023 * K },
    confidence: "low",
  };
}

/** The Hartwell income statement as the page prints it: Boom's one mapped
 *  operating-expense line printed as its two components, and the provision Boom
 *  flagged. */
const PRINTED: PreReadLine[] = [
  line("Net Sales", 64486, 59915, 56266),
  line("Cost of Sales", 50422, 45371, 40829),
  line("Gross Profit", 14064, 14544, 15437),
  line("Selling, General and Administrative", 8830, 8800, 8743),
  line("Depreciation and Amortization", 2396, 2189, 2009),
  line("Income from Operations", 2838, 3555, 4685),
  line("Interest Expense", -1076, -1019, -947),
  line("Other Income (Expense), Net", 55, -45, 71),
  line("Income before Income Taxes", 1817, 2491, 3809),
  line("Provision for Income Taxes", 427, 623, 936),
  line("Net Income", 1390, 1868, 2873),
];

function preRead(lines: PreReadLine[], type: FilePreRead["statements"][number]["statementType"] = "income_statement"): FilePreRead {
  return {
    fileId: "f1",
    statements: [{ statementType: type, periods: PERIODS, lines }],
    company: "Piedmont Precision Components, Inc.",
    companyMatchesRelationship: true,
    currency: "USD",
    unitsMultiplier: K,
    statementQuality: "cpa_compiled",
    quality: [],
    confidence: "low",
  };
}

const ghostOf = (lines = PRINTED, fileId = "f1", fileName = "compiled-statements-2025.pdf"): GhostStatement[] =>
  ghostStatements([{ fileId, fileName, pre: { ...preRead(lines), fileId } }]);

const BOOM = (spreadLive as unknown as { spread: { financialStatements: BoomFinancialStatement[] } })
  .spread.financialStatements;
const INCOME = BOOM.filter((s) => s.statementType === "income_statement");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(node: React.ReactElement): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

/** MOTION ON. jsdom has no `matchMedia`, which the motion guard reads as reduced
 *  motion; the choreography blocks stub it to prove the animated path. */
function motionOn(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  delete (window as unknown as Record<string, unknown>).matchMedia;
  vi.useRealTimers();
});

const text = (el: Element | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLTableRowElement>(".rg-t tbody tr")];
const named = (host: HTMLElement, name: string) =>
  rows(host).find((tr) => text(tr.querySelector(".rg-nm")) === name);

describe("the ghost, before Boom has answered", () => {
  it("stands the file's own lines up in faint ink, with the chip column reserved and ruled", () => {
    const host = mount(<SpreadRegister statements={[]} ghost={ghostOf()} adjusted={false} />);
    expect(rows(host)).toHaveLength(PRINTED.length);
    expect(rows(host).every((tr) => tr.hasAttribute("data-ghost"))).toBe(true);
    /* The chip column is EMPTY and ruled: an account code is Boom's to give. */
    expect(host.querySelectorAll(".rg-cat")).toHaveLength(0);
    expect(host.querySelectorAll(".rg-rule")).toHaveLength(PRINTED.length);
  });

  it("says whose reading this is, from which file, over which periods, at which scale", () => {
    const host = mount(<SpreadRegister statements={[]} ghost={ghostOf()} adjusted={false} />);
    expect(text(host.querySelector(".rg-line"))).toBe(
      "Not yet mapped by Boom·compiled-statements-2025.pdf·FY2023, FY2024, FY2025·thousands, as printed",
    );
  });

  it("offers the statement select from the first beat, and no control it cannot honour", () => {
    const both = [...ghostOf(PRINTED, "f1", "income.pdf"), ...ghostOf(PRINTED, "f2", "balance.pdf").map((g) => ({ ...g }))];
    const balance = ghostStatements([
      { fileId: "f2", fileName: "balance.pdf", pre: { ...preRead(PRINTED, "balance_sheet"), fileId: "f2" } },
    ]);
    const host = mount(<SpreadRegister statements={[]} ghost={[...both.slice(0, 1), ...balance]} adjusted={false} />);
    expect([...host.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Income statement",
      "Balance sheet",
    ]);
    /* Nothing to switch between until Boom answers. */
    expect(host.querySelector(".rg-late")).toBeNull();
    expect(host.querySelector(".rg-seg")).toBeNull();
    expect(host.querySelector(".rg-prov")).toBeNull();
    expect(host.querySelectorAll("th.rg-p")).toHaveLength(0);
  });

  it("carries a pin on every row, and holds it", () => {
    const pinned = new Set<string>();
    const host = mount(
      <SpreadRegister
        statements={[]}
        ghost={ghostOf()}
        adjusted={false}
        pinned={pinned}
        onTogglePin={(key) => pinned.add(key)}
      />,
    );
    const pin = named(host, "Net Sales")!.querySelector<HTMLButtonElement>(".rg-pin")!;
    expect(pin.getAttribute("aria-label")).toBe("Watch Net Sales");
    act(() => pin.click());
    expect([...pinned]).toEqual(["net sales"]);
  });

  it("stands a statement Boom did not read up unmapped, in Boom's own words", () => {
    const host = mount(
      <SpreadRegister
        statements={INCOME}
        ghost={ghostStatements([
          { fileId: "f9", fileName: "management.xlsx", pre: { ...preRead(PRINTED, "cash_flow_statement"), fileId: "f9" } },
        ])}
        failures={{ f9: "no financial statement was found in this document" }}
        settled
        adjusted={false}
      />,
    );
    const select = host.querySelector<HTMLSelectElement>("select")!;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Income statement",
      "Cash flow statement (not read by Boom)",
    ]);
    act(() => {
      select.value = "1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(text(host.querySelector(".rg-line"))).toBe(
      "Boom did not read this file·Boom's words: no financial statement was found in this document·" +
        "The 11 lines this room read off the page stand below, unmapped",
    );
  });

  it("keeps promising nothing once Boom has answered, and names what it did not return", () => {
    const ghost = ghostStatements([
      { fileId: "f9", fileName: "management.xlsx", pre: { ...preRead(PRINTED, "cash_flow_statement"), fileId: "f9" } },
    ]);
    const host = mount(<SpreadRegister statements={INCOME} ghost={ghost} settled adjusted={false} />);
    const select = host.querySelector<HTMLSelectElement>("select")!;
    act(() => {
      select.value = "1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(text(host.querySelector(".rg-line"))).toBe(
      "Boom returned no spread for this statement·The 11 lines this room read off the page stand below, unmapped",
    );
  });

  it("says a refusal with no reason is still a refusal", () => {
    const ghost = ghostStatements([
      { fileId: "f9", fileName: "management.xlsx", pre: { ...preRead(PRINTED, "cash_flow_statement"), fileId: "f9" } },
    ]);
    const host = mount(
      <SpreadRegister statements={INCOME} ghost={ghost} failures={{ f9: "" }} settled adjusted={false} />,
    );
    const select = host.querySelector<HTMLSelectElement>("select")!;
    act(() => {
      select.value = "1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(text(host.querySelector(".rg-line"))).toBe(
      "Boom did not read this file·The 11 lines this room read off the page stand below, unmapped",
    );
  });
});

describe("the arrival, when Boom's lines land", () => {
  it("lights the ghost rows in place, gives each Boom's own code, and writes the derived sentence", () => {
    const host = mount(<SpreadRegister statements={INCOME} ghost={ghostOf()} adjusted={false} fileStatus="verified" />);
    /* The fold has settled: the two printed lines are gone and the line they
       became stands where they stood. */
    expect(rows(host).map((tr) => text(tr.querySelector(".rg-nm")))).toEqual([
      "Net Sales",
      "Cost of Sales",
      "Gross Profit",
      "Operating Expenses",
      "Income from Operations",
      "Interest Expense",
      "Other Income (Expense), Net",
      "Income before Income Taxes",
      "Provision for Income Taxes",
      "Net Income",
    ]);
    expect(rows(host).every((tr) => tr.hasAttribute("data-lit"))).toBe(true);
    expect(text(named(host, "Net Sales")!.querySelector(".rg-cat"))).toBe("REVnet_sales_revenue");
    expect(text(host.querySelector(".rg-recon"))).toBe(
      "Boom kept 8 of the 11 lines this room read off the page as they stand, folded 2 into 1 and read 1 with the opposite sign.",
    );
  });

  it("says under the row what Boom did to it, and strikes the file's figure where the two differ", () => {
    const host = mount(<SpreadRegister statements={INCOME} ghost={ghostOf()} adjusted={false} />);
    expect(text(named(host, "Operating Expenses")!.querySelector(".rg-note"))).toBe(
      "Boom folded 2 printed lines into this one.",
    );
    const provision = named(host, "Provision for Income Taxes")!;
    expect(text(provision.querySelector(".rg-note"))).toContain("opposite sign");
    /* The file prints it positive; Boom's own flag makes the column foot, so
       the two figures differ on the glass and the file's is struck. */
    expect(text(provision.querySelector(".rg-was"))).toBe("936");
  });

  it("writes no sentence at all where Boom changed nothing", () => {
    const same = INCOME[0].lineItems
      .filter((li) => li.hierarchy !== "header" && !li.flipSign)
      .map((li) => {
        const ids = INCOME[0].periods.map((p) => p.id);
        return {
          label: li.name,
          accountCode: null,
          values: {
            FY2025: li.periodValues[ids[0]] ?? null,
            FY2024: li.periodValues[ids[1]] ?? null,
            FY2023: li.periodValues[ids[2]] ?? null,
          },
          confidence: "low" as const,
        };
      });
    const host = mount(
      <SpreadRegister
        statements={[{ ...INCOME[0], lineItems: INCOME[0].lineItems.filter((li) => !li.flipSign) }]}
        ghost={ghostOf(same)}
        adjusted={false}
      />,
    );
    expect(host.querySelector(".rg-recon")).toBeNull();
  });

  it("reads the validation word off Boom's own rung", () => {
    const completed = [{ ...INCOME[0], validationStatus: "not_validated" as const }];
    const one = mount(<SpreadRegister statements={completed} ghost={ghostOf()} adjusted={false} fileStatus="completed" />);
    expect(text(one.querySelector(".sp-badge"))).toBe("Not validated in Boom");
    act(() => root?.unmount());
    container?.remove();
    const two = mount(<SpreadRegister statements={INCOME} ghost={ghostOf()} adjusted={false} fileStatus="verified" />);
    expect(text(two.querySelector(".sp-badge"))).toBe("Validated in Boom");
  });

  it("brings the controls and the citation with the spread", () => {
    const host = mount(
      <SpreadRegister
        statements={INCOME}
        ghost={ghostOf()}
        adjusted={false}
        onAdjustedChange={() => {}}
        provenance={{ fileName: "compiled-statements-2025.pdf" }}
      />,
    );
    expect(host.querySelectorAll(".rg-seg")).toHaveLength(2);
    expect(host.querySelector(".rg-tog")).not.toBeNull();
    expect(text(host.querySelector(".rg-prov"))).toContain("Spread by Boom");
  });
});

describe("the choreography, and the same facts without it", () => {
  beforeEach(() => {
    motionOn();
    vi.useFakeTimers();
  });

  it("appends the ghost rows one per beat rather than pre-laying them", () => {
    const host = mount(<SpreadRegister statements={[]} ghost={ghostOf()} adjusted={false} />);
    /* NOT PRE-LAID: the grid holds no row-heights before a row has landed. */
    expect(rows(host)).toHaveLength(0);
    act(() => void vi.advanceTimersByTime(1));
    expect(rows(host)).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(130 * 4));
    expect(rows(host).length).toBeGreaterThan(1);
    expect(rows(host).length).toBeLessThan(PRINTED.length);
    act(() => void vi.advanceTimersByTime(130 * PRINTED.length));
    expect(rows(host)).toHaveLength(PRINTED.length);
  });

  it("lights the pinned row first when Boom answers", () => {
    const host = mount(
      <SpreadRegister
        statements={INCOME}
        ghost={ghostOf()}
        adjusted={false}
        pinned={new Set(["net income"])}
        onTogglePin={() => {}}
      />,
    );
    /* Nothing has taken its chip yet. */
    expect(host.querySelectorAll("tr[data-lit]")).toHaveLength(0);
    act(() => void vi.advanceTimersByTime(80));
    const first = [...host.querySelectorAll<HTMLTableRowElement>("tr[data-lit]")].map((tr) =>
      text(tr.querySelector(".rg-nm")),
    );
    expect(first).toEqual(["Net Income"]);
    act(() => void vi.advanceTimersByTime(80 * PRINTED.length + 340 + 520));
    expect(host.querySelectorAll("tr[data-lit]").length).toBe(rows(host).length);
  });

  it("dissolves the folded lines before the line they became settles into the gap", () => {
    const host = mount(<SpreadRegister statements={INCOME} ghost={ghostOf()} adjusted={false} />);
    act(() => void vi.advanceTimersByTime(80 * PRINTED.length + 340));
    expect([...host.querySelectorAll('tr[data-fold="out"]')].map((tr) => text(tr.querySelector(".rg-nm")))).toEqual([
      "Selling, General and Administrative",
      "Depreciation and Amortization",
    ]);
    expect(named(host, "Operating Expenses")).toBeUndefined();
    /* And the sentence waits for the beat to land. */
    expect(host.querySelector(".rg-recon")).toBeNull();
    act(() => void vi.advanceTimersByTime(520));
    expect(named(host, "Operating Expenses")).toBeDefined();
    expect(host.querySelector(".rg-recon")).not.toBeNull();
  });

  it("reduced motion reaches every one of those facts in one commit", () => {
    delete (window as unknown as Record<string, unknown>).matchMedia;
    const host = mount(<SpreadRegister statements={INCOME} ghost={ghostOf()} adjusted={false} />);
    expect(rows(host)).toHaveLength(10);
    expect(rows(host).every((tr) => tr.hasAttribute("data-lit"))).toBe(true);
    expect(host.querySelectorAll('tr[data-fold="out"]')).toHaveLength(0);
    expect(host.querySelector(".rg-recon")).not.toBeNull();
    expect(named(host, "Operating Expenses")).toBeDefined();
  });
});
