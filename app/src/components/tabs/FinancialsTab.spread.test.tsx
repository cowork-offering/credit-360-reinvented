// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppProvider } from "../../state/appState";
import { FinancialsTab } from "./FinancialsTab";
import { publishSpread } from "../../spread/publishSpread";
import { applySpreadEvent, boomSystemWord, type SpreadRoomEvent } from "../../state/spreadPublish";
import type { BoomFinancialStatement } from "../../spread/types";
import type { BorrowerBundle, C360Data } from "../../data/contract";
import live from "../../../../artifact/live-data.json";

/* =============================================================================
   ITEM 18, ON THE GLASS: the Spreading room's period shows in the Financials tab.

   The room is not the destination. A banker spreads statements so the cockpit's
   own Financials move, and this is the proof that they do: Piedmont's staged
   book plus the spread the room published, rendered by the tab nobody changed
   the data path of.

   AND IT SAYS WHAT IT IS. While the Boom connector does not exist the spread is
   the stub's, built from the room's own pre-read, so the new period carries
   "Provisional, Boom verification pending" and the tab never calls it Boom's.
   A tab reading Boom's own spread shows no badge at all, which is the
   no-layout-shift half of the same rule.
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
/** One line of the compact register, by the name Boom printed on it. */
const registerRow = (el: HTMLElement, name: string): string =>
  text(
    [...el.querySelectorAll<HTMLElement>(".rg-t tbody tr")].find(
      (r) => (r.querySelector(".rg-nm")?.textContent ?? "") === name,
    )!,
  );

/** FY2026 as the stub hands it back: Boom's own output shape, built from the
 *  pre-read of the file the banker dropped. Figures continue Piedmont's own. */
const FY2026: BoomFinancialStatement[] = [
  {
    id: "stub-fy2026-s1",
    statementType: "income_statement",
    endDate: "2026-12-31",
    validationStatus: "not_validated",
    periods: [{ id: "stub-fy2026-s1-p1", endDate: "2026-12-31", periodType: "annual" }],
    lineItems: [
      {
        id: "stub-fy2026-s1-l1",
        name: "Net Sales",
        hierarchy: "line_item",
        accountCode: "net_sales_revenue",
        flipSign: false,
        periodValues: { "stub-fy2026-s1-p1": 71_200_000 },
      },
      {
        id: "stub-fy2026-s1-l2",
        name: "Income from Operations",
        hierarchy: "subtotal",
        accountCode: "operating_profit",
        flipSign: false,
        periodValues: { "stub-fy2026-s1-p1": 3_402_000 },
      },
    ],
  },
];

const spreadEvent = (lane: "stub" | "live"): SpreadRoomEvent => ({
  phase: "completed",
  accountId: PIEDMONT,
  company: "Piedmont Precision Components, Inc.",
  summary: "2 statements to Boom, Piedmont Precision Components, Inc.: FY2026 audited income statement, balance sheet.",
  planKey: "sha-a+sha-b",
  fileCount: 2,
  statements: FY2026,
  provenance: lane === "live" ? "boom" : "stub-provisional",
  system: boomSystemWord(lane),
  signedOff: false,
  failure: null,
});

/** The bundle a banker is looking at after the room published, built the way
 *  the host builds it: the staged bundle with the published `boom` over it. */
function afterSpread(lane: "stub" | "live"): BorrowerBundle {
  const staged = piedmont();
  const boom = publishSpread({
    onFile: staged.boom,
    statements: FY2026,
    provenance: lane === "live" ? "boom" : "stub-provisional",
  });
  return { ...staged, boom: boom ?? staged.boom };
}

describe("the published period shows in the Financials tab", () => {
  it("adds the period to the trend and the caption", () => {
    expect(piedmont().boom?.spread?.periods).toHaveLength(3);
    const el = render(afterSpread("stub"));
    expect(text(el)).toContain("Boom · 4 periods");
    expect(text(el)).toContain("FY2026");
  });

  it("makes the new period the headline figure and the prior one its comparison", () => {
    const el = render(afterSpread("stub"));
    // $71.2M against $64.49M FY2025 on the book: +10.4%.
    expect(text(el)).toContain("$71.20M");
    expect(text(el)).toContain("10.4% revenue vs prior period");
  });

  it("moves the register's newest column onto the new period", () => {
    /* THE STATEMENT SURFACE IS THE REGISTER NOW (0.9.28), on every book whose
       `spread.file` carries the raw statements. Piedmont's does, and a publish
       merges the new period into it, so the newest column is the one the room
       just spread and the one before it is the book's. Thousands, the
       register's own scale. */
    const el = render(afterSpread("stub"));
    expect(registerRow(el, "Net Sales")).toContain("71,200");
    expect(registerRow(el, "Net Sales")).toContain("64,486");
  });

  it("draws the room's register in compact mode, not a second idea of a spread", () => {
    const el = render(piedmont());
    const register = el.querySelector<HTMLElement>(".rg")!;
    expect(register.getAttribute("data-mode")).toBe("compact");
    // The statement select, and no other control: the tab is a reading surface.
    expect(register.querySelector("select.rg-sel")).not.toBeNull();
    expect(register.querySelectorAll(".rg-chip, .rg-segb, .rg-tog")).toHaveLength(0);
    // The three newest periods the book carries, with Variance % only: compact
    // drops the absolute pair so the grid fits the tab's card (C5, 2026-09-15).
    expect([...register.querySelectorAll("thead th.rg-v, thead th.rg-p")].map((n) => text(n as HTMLElement))).toEqual([
      "✓FY2023",
      "✓FY2024",
      "✓FY2025",
      "Variance %",
    ]);
    // And no footer: the tab carries its own source note under the pane.
    expect(register.querySelector(".rg-prov")).toBeNull();
    expect(el.querySelector(".dt")).toBeNull();
  });
});

describe("the badge says what the period is", () => {
  it("carries the provisional badge while the spread came from the stub", () => {
    const el = render(afterSpread("stub"));
    const badge = el.querySelector<HTMLElement>("[data-provisional-period]")!;
    expect(badge).toBeTruthy();
    expect(text(badge)).toBe("Provisional, Boom verification pending");
    expect(badge.getAttribute("data-provisional-period")).toBe("FY2026");
  });

  it("never calls a stub spread verified", () => {
    const el = render(afterSpread("stub"));
    expect(text(el)).not.toMatch(/\bverified\b/i);
  });

  it("shows no badge at all on a spread Boom itself returned", () => {
    const el = render(afterSpread("live"));
    expect(el.querySelector("[data-provisional-period]")).toBeNull();
  });

  it("shows no badge on the staged book, so nothing shifts for a relationship nobody spread", () => {
    const el = render(piedmont());
    expect(el.querySelector("[data-provisional-period]")).toBeNull();
    expect(text(el)).toContain("Boom · 3 periods");
  });
});

describe("the same object reaches the trail and the book", () => {
  it("publishes the period and logs the entry that names it", () => {
    const sent: Array<{ type: string }> = [];
    const applied = applySpreadEvent({
      event: spreadEvent("stub"),
      onFileBoom: piedmont().boom,
      dispatch: (action) => sent.push(action),
      actor: "Dana Whitfield",
    });
    expect(applied.period).toBe("FY2026");
    expect(sent.map((a) => a.type)).toEqual(["PATCH_BUNDLE", "LOG_ACTIVITY"]);
    expect(applied.entry.title).toBe("Boom (stub, provisional) spread FY2026 for Piedmont Precision Components, Inc.");
    expect(applied.entry.summary).toContain("2 statements to Boom");
    expect(applied.entry.actor).toBe("Dana Whitfield");
  });

  it("leaves the book alone when the spread came back with nothing", () => {
    const sent: Array<{ type: string }> = [];
    const applied = applySpreadEvent({
      event: { ...spreadEvent("stub"), phase: "failed", statements: [], failure: "Boom could not read this file." },
      onFileBoom: piedmont().boom,
      dispatch: (action) => sent.push(action),
    });
    expect(applied.period).toBeNull();
    expect(sent.map((a) => a.type)).toEqual(["LOG_ACTIVITY"]);
    expect(applied.entry.kind).toBe("ACTION_EXECUTION_FAILED");
    expect(applied.entry.detail?.body).toContain("Boom could not read this file.");
  });
});
