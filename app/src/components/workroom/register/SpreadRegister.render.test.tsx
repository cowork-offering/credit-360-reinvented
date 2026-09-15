// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SpreadRegister } from "./SpreadRegister";
import type { RatioSupportLine } from "./registerModel";
import type { BoomFinancialStatement } from "../../../spread/types";
import spreadLive from "../../../__fixtures__/boom-live/spread-piedmont.json";
import ratiosLive from "../../../__fixtures__/boom-live/ratios-piedmont.json";

/* =============================================================================
   THE REGISTER ON THE GLASS, against the live Boom spread.

   WHAT IS ASSERTED IS THE SURFACE, not the model: the statement select offers
   exactly the statements the file carries, dropping a period recomputes the
   variance pair rather than only hiding a column, the adjusted switch hands the
   decision back to the caller instead of filtering locally, and the register
   prints NO FACT THE ROOM ALREADY CARRIES. The room owns revenue, EBITDA and
   leverage on its tiles; a register that printed them again would be the same
   figure twice with two chances to disagree.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const statements = (spreadLive as { spread: { financialStatements: BoomFinancialStatement[] } })
  .spread.financialStatements;
const support = (ratiosLive as { support: { lines: RatioSupportLine[] } }).support.lines;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount(node: React.ReactElement): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const cells = (host: HTMLElement, sel: string): string[] =>
  Array.from(host.querySelectorAll(sel)).map((n) => text(n));
const rowFor = (host: HTMLElement, name: string): HTMLTableRowElement =>
  Array.from(host.querySelectorAll("tbody tr")).find(
    (tr) => text(tr.querySelector(".rg-nm")) === name,
  ) as HTMLTableRowElement;

const base = {
  statements,
  support,
  adjusted: true,
};

describe("the controls", () => {
  it("lists exactly the statements the file carries", () => {
    const host = mount(<SpreadRegister {...base} />);
    const select = host.querySelector("select.rg-sel") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Income statement",
      "Balance sheet",
      "Cash flow",
    ]);
  });

  it("switches the grid to the statement the banker picked", () => {
    const host = mount(<SpreadRegister {...base} />);
    const select = host.querySelector("select.rg-sel") as HTMLSelectElement;
    act(() => {
      select.value = "1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(text(host.querySelector(".rg-line"))).toContain("17 of 17 lines carry a Boom account code");
    expect(cells(host, ".rg-nm")).toContain("Total Assets");
  });

  it("hides a period and recomputes the variance against the new prior", () => {
    const host = mount(<SpreadRegister {...base} />);
    const sales = () => Array.from(rowFor(host, "Net Sales").querySelectorAll("td"));
    /* FY2023 56,266 · FY2024 59,915 · FY2025 64,486, so the pair is FY2025 on FY2024. */
    expect(text(sales()[6])).toBe("4,571");
    expect(text(sales()[7])).toBe("+7.6%");

    const fy2024 = Array.from(host.querySelectorAll<HTMLButtonElement>(".rg-chip")).find(
      (b) => text(b) === "FY2024",
    )!;
    act(() => fy2024.click());

    const after = Array.from(rowFor(host, "Net Sales").querySelectorAll("td"));
    expect(cells(host, "thead th.rg-v").slice(0, 2).join(" ")).toContain("FY2023");
    /* Two columns now, so the variance cells move left, and the pair is FY2025 on FY2023. */
    expect(text(after[5])).toBe("8,220");
    expect(text(after[6])).toBe("+14.6%");
  });

  it("changes the unit scale and says which scale it is showing", () => {
    const host = mount(<SpreadRegister {...base} />);
    expect(text(host.querySelector(".rg-line"))).toContain("$ in thousands");
    const millions = Array.from(host.querySelectorAll<HTMLButtonElement>(".rg-segb")).find(
      (b) => text(b) === "M",
    )!;
    act(() => millions.click());
    expect(text(host.querySelector(".rg-line"))).toContain("$ in millions");
    expect(Array.from(rowFor(host, "Net Sales").querySelectorAll("td")).map(text)).toContain("64.5");
  });

  it("drops the variance pair when the banker turns it off", () => {
    const host = mount(<SpreadRegister {...base} />);
    expect(cells(host, "thead th")).toContain("Variance %");
    const toggle = host.querySelector(".rg-tog") as HTMLButtonElement;
    act(() => toggle.click());
    expect(cells(host, "thead th")).not.toContain("Variance %");
  });
});

describe("adjusted is a re-read, not a filter", () => {
  it("calls the caller back and leaves the grid exactly where it was", () => {
    const onAdjustedChange = vi.fn();
    const host = mount(<SpreadRegister {...base} onAdjustedChange={onAdjustedChange} />);
    const before = cells(host, "tbody .rg-v");
    const asGiven = Array.from(host.querySelectorAll<HTMLButtonElement>(".rg-adj .rg-segb")).find(
      (b) => text(b) === "As given",
    )!;
    act(() => asGiven.click());
    expect(onAdjustedChange).toHaveBeenCalledWith(false);
    expect(cells(host, "tbody .rg-v")).toEqual(before);
  });

  it("redraws on the figures the caller hands back", () => {
    const host = mount(<SpreadRegister {...base} adjusted={false} onAdjustedChange={() => {}} />);
    const asGiven = Array.from(host.querySelectorAll<HTMLButtonElement>(".rg-adj .rg-segb")).find(
      (b) => text(b) === "As given",
    )!;
    expect(asGiven.getAttribute("aria-pressed")).toBe("true");
    /* Provision for Income Taxes carries flipSign, so it reads negative on both
       reads: what changes with the switch is the source of the figure, not its sign. */
    expect(Array.from(rowFor(host, "Provision for Income Taxes").querySelectorAll("td")).map(text)).toContain("-427");
  });

  it("offers no adjusted switch at all when the caller cannot re-read", () => {
    const host = mount(<SpreadRegister {...base} />);
    expect(host.querySelector(".rg-adj")).toBeNull();
  });
});

describe("the grid", () => {
  it("marks the column a fresh upload added", () => {
    const host = mount(<SpreadRegister {...base} newPeriodEnd="FY2025" />);
    const heads = Array.from(host.querySelectorAll("thead th.rg-v"));
    expect(heads.filter((h) => h.classList.contains("is-new")).map(text)).toEqual(["✓FY2025"]);
    /* Ten body rows on the income statement; the one header row spans the grid
       and carries no period cell of its own. */
    expect(host.querySelectorAll("tbody td.is-new").length).toBe(10);
  });

  it("marks no column when nothing was added this session", () => {
    const host = mount(<SpreadRegister {...base} />);
    expect(host.querySelectorAll(".is-new").length).toBe(0);
  });

  it("chips every mapped code by its family and flags a line Boom left unmapped", () => {
    const host = mount(<SpreadRegister {...base} />);
    expect(rowFor(host, "Net Sales").querySelector(".rg-cat--rev")).not.toBeNull();
    expect(rowFor(host, "Cost of Sales").querySelector(".rg-cat--exp")).not.toBeNull();
    expect(rowFor(host, "Gross Profit").querySelector(".rg-cat--tot")).not.toBeNull();
    expect(rowFor(host, "Net Sales").querySelector(".rg-flag")).toBeNull();

    const select = host.querySelector("select.rg-sel") as HTMLSelectElement;
    act(() => {
      select.value = "2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(rowFor(host, "Net Income").querySelector(".rg-cat--none")).not.toBeNull();
    expect(rowFor(host, "Net Income").querySelector(".rg-flag")).not.toBeNull();
  });

  it("says n/m rather than a percentage on a negative prior period", () => {
    const host = mount(<SpreadRegister {...base} />);
    const interest = Array.from(rowFor(host, "Interest Expense").querySelectorAll("td")).map(text);
    expect(interest).toContain("n/m");
  });

  it("names the figure a line feeds and never prints the figure", () => {
    const host = mount(<SpreadRegister {...base} />);
    expect(cells(host, ".rg-feeds")).toContain("feeds revenue");
    expect(cells(host, ".rg-feeds")).toContain("feeds interest expense");
    expect(text(host.querySelector(".rg-feeds"))).not.toMatch(/\d/);
  });
});

describe("compact mode", () => {
  const compact = <SpreadRegister {...base} mode="compact" verificationUrl="https://verification.invalid/session" />;

  it("carries the statement select and no other control", () => {
    const host = mount(compact);
    expect(host.querySelector("select.rg-sel")).not.toBeNull();
    expect(host.querySelectorAll(".rg-chip").length).toBe(0);
    expect(host.querySelectorAll(".rg-segb").length).toBe(0);
    expect(host.querySelector(".rg-tog")).toBeNull();
  });

  /* THE TAB IS THE SUMMARY, THE ROOM IS THE AUDIT (founder, 2026-09-15). At the
     Financials tab's 506 px card the gutter and the account-code chip took 190 px
     and pushed FY2025, the column a banker reads first, off the right edge. The
     five columns asserted here ARE the fit: the line, the three newest periods
     and the percentage measure 456 px at that card, which is the card's own
     inner width, so nothing scrolls. */
  it("drops the account-code chip column and the row gutter", () => {
    const host = mount(compact);
    expect(host.querySelectorAll("th.rg-c, td.rg-c").length).toBe(0);
    expect(host.querySelectorAll("th.rg-g, td.rg-g").length).toBe(0);
    expect(host.querySelectorAll(".rg-cat").length).toBe(0);
  });

  it("shows the three newest periods and the percentage, with FY2025 last", () => {
    const host = mount(compact);
    expect(cells(host, "thead th")).toEqual([
      "Reported line item",
      "✓FY2023",
      "✓FY2024",
      "✓FY2025",
      "Variance %",
    ]);
    /* The absolute pair is the room's: a change in dollars is a figure the room
       already carries, and it is the column that did not fit. */
    expect(cells(host, "thead th")).not.toContain("Variance");
    /* One cell per header, in the same order: the name (carrying its feeds note
       where the caller handed support in), the three periods, the percentage. */
    expect(Array.from(rowFor(host, "Net Sales").querySelectorAll("td")).map(text)).toEqual([
      "Net Salesfeeds revenue",
      "56,266",
      "59,915",
      "64,486",
      "+7.6%",
    ]);
  });

  it("spans a section header across the five columns it actually has", () => {
    const host = mount(compact);
    const select = host.querySelector("select.rg-sel") as HTMLSelectElement;
    act(() => {
      select.value = "1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const sect = host.querySelector("tbody tr.rg-sect td") as HTMLTableCellElement;
    expect(sect.colSpan).toBe(5);
  });

  it("keeps the mis-map flag as a dot after the line name", () => {
    const host = mount(compact);
    const select = host.querySelector("select.rg-sel") as HTMLSelectElement;
    act(() => {
      select.value = "2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const row = rowFor(host, "Net Income");
    expect(row.querySelector(".rg-dot")).not.toBeNull();
    expect(row.querySelector(".rg-flag")).toBeNull();
    /* A mark, not a word: the line name is what the column is for. */
    expect(text(row.querySelector(".rg-dot"))).toBe("");
  });

  /* WHERE THE CARD IS NARROWER THAN THE GRID, THE GRID OPENS ON THE NEWEST
     PERIOD. jsdom lays nothing out, so the overflow a narrow card produces is
     stated on the node; what is under test is that the register drives its own
     grid to the right edge rather than leaving it on the oldest column. */
  const withOverflow = (box: HTMLElement, content: number) => {
    const at = { left: 0 };
    Object.defineProperty(box, "scrollWidth", { configurable: true, value: content });
    Object.defineProperty(box, "scrollLeft", {
      configurable: true,
      get: () => at.left,
      set: (v: number) => {
        at.left = v;
      },
    });
    return at;
  };

  it("opens the grid on the newest period, never on the oldest", () => {
    const host = mount(compact);
    const at = withOverflow(host.querySelector(".rg-scroll") as HTMLElement, 600);
    const select = host.querySelector("select.rg-sel") as HTMLSelectElement;
    act(() => {
      select.value = "1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(at.left).toBe(600);
  });

  it("leaves the room's own grid where the banker left it", () => {
    const host = mount(<SpreadRegister {...base} />);
    const at = withOverflow(host.querySelector(".rg-scroll") as HTMLElement, 600);
    const select = host.querySelector("select.rg-sel") as HTMLSelectElement;
    act(() => {
      select.value = "1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(at.left).toBe(0);
  });

  it("carries no footer, not even when a verification link was handed in", () => {
    const host = mount(compact);
    expect(host.querySelector(".rg-prov")).toBeNull();
    expect(host.querySelector(".rg-provlink")).toBeNull();
  });
});

describe("no fact twice, and no door", () => {
  const full = (
    <SpreadRegister
      {...base}
      verificationUrl="https://verification.invalid/session"
      provenance={{
        fileName: "Piedmont_Precision_Components_Financials_FY2023-2025.xlsx",
        source: "BOOM-LIVE",
        method: "derived-local",
      }}
    />
  );

  it("draws no tile and no trend: the room already carries them", () => {
    const host = mount(full);
    expect(host.querySelector(".sp-tiles")).toBeNull();
    expect(host.querySelector(".sp-tile")).toBeNull();
    expect(host.querySelector("svg")).toBeNull();
  });

  it("keeps every headline figure out of the header line and the footer", () => {
    const host = mount(full);
    for (const sel of [".rg-line", ".rg-prov"]) {
      const line = text(host.querySelector(sel));
      /* A money figure is "$" followed by a digit. "$ in thousands" is a caption. */
      expect(line).not.toMatch(/\$\s?\d/);
      /* A leverage or coverage multiple, and a margin. */
      expect(line).not.toMatch(/\d+(\.\d+)?x\b/);
      expect(line).not.toMatch(/\d+(\.\d+)?%/);
    }
  });

  it("puts no fact on a control pill", () => {
    const host = mount(full);
    for (const pill of cells(host, ".wk-opt")) {
      expect(pill).not.toMatch(/\$\s?\d/);
      expect(pill).not.toMatch(/—\d{3}/);
    }
  });

  it("cites the file in the footer and leaves the doors to the room", () => {
    const host = mount(full);
    expect(text(host.querySelector(".rg-prov"))).toContain(
      "Piedmont_Precision_Components_Financials_FY2023-2025.xlsx",
    );
    expect(text(host.querySelector(".rg-prov"))).toContain("BOOM-LIVE");
    expect(text(host.querySelector(".rg-prov"))).toContain("method derived-local");
    /* The only thing that leaves is a citation, and it is a link, never a door. */
    expect(host.querySelectorAll(".wk-sheet-go, .wk-sheet-back, [data-door]").length).toBe(0);
    expect((host.querySelector(".rg-provlink") as HTMLAnchorElement).href).toBe("https://verification.invalid/session");
  });

  it("uses no em dash anywhere on the surface", () => {
    const host = mount(full);
    expect(text(host)).not.toContain("—");
  });
});
