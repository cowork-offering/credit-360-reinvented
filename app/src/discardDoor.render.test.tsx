// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppProvider, useApp } from "./state/appState";
import { ConfirmGate } from "./components/ConfirmGate";
import { ActivityTab } from "./components/tabs/ActivityTab";
import { ActionsPanelBody } from "./components/ActionsPanel";
import { DISCARD_LABEL, DISCARD_LINE, NO_VERSION_REASON, STAGING_KEPT } from "./actions/discardVersion";
import { IN_APPROVAL_REFUSAL, MODIFICATION_IN_PROGRESS } from "./book/packages";
import type { StagedOutput } from "./actions/stagedPlan";
import type { BorrowerBundle, C360Data, Facility } from "./data/contract";
import live from "../../artifact/live-data.json";

/* =============================================================================
   THE DOOR ON THE GLASS.

   Three surfaces, one rule: the Client Actions row, the Activity trail's
   standing "Modification in Progress" row, and the confirm gate that renders
   the org's inventory. Every one of them reads the SAME
   `discardAvailability` / `discardTarget`, so a version at approval closes all
   three at once and a version still in the banker's hands opens all three.

   THE INVENTORY IS HANDED IN, exactly as the tool would return it. Nothing on
   this page composes a delete set, so nothing in this file lets it.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = live as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";
const SOURCE = "a5Fbb000000IHFJEA4";
const VERSION = "a5Fbb0000009TESTV1";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function forked(stage = "Qualification"): BorrowerBundle {
  const base = structuredClone(data.borrowers![HARTWELL]) as BorrowerBundle;
  const members = (base.exposure?.facilities ?? []).filter((f) => f.productPackageId === SOURCE);
  const clones: Facility[] = members.map((f, i) => ({
    ...f,
    loanId: `a4Zbb000009CLONE${i}`,
    name: f.committed === 15_000_000 ? f.name?.replace("$15,000,000.00", "$20,000,000.00") : f.name,
    committed: f.committed === 15_000_000 ? 20_000_000 : f.committed,
    productPackageId: VERSION,
    stage,
    outstanding: 0,
  }));
  base.exposure = { ...base.exposure, facilities: [...(base.exposure?.facilities ?? []), ...clones] };
  return base;
}

const dataWith = (bundle: BorrowerBundle): C360Data =>
  ({ ...data, borrowers: { ...data.borrowers, [HARTWELL]: bundle } }) as C360Data;

function Opener({ children }: { children: ReactNode }) {
  const { dispatch } = useApp();
  useEffect(() => dispatch({ type: "OPEN_ACCOUNT", accountId: HARTWELL }), [dispatch]);
  return <>{children}</>;
}

function render(node: ReactNode, d: C360Data): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AppProvider data={d}>
        <Opener>{node}</Opener>
      </AppProvider>,
    );
  });
  return container;
}

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ");

/* ------------------------------------------------------ the confirm gate */

const INVENTORY = [
  { object: "LLC_BI__LoanRenewal__c", id: "a3Xbb000000CHAIN0", name: "LR-0001 revision 0", reason: "the self-anchor row on the booked parent" },
  { object: "LLC_BI__LoanRenewal__c", id: "a3Xbb000000CHAIN1", name: "LR-0002 revision 1", reason: "points the booked parent at the clone" },
  { object: "LLC_BI__Loan_Collateral2__c", id: "a3Ybb000000PLDG0", name: "Pledge on the $20,000,000.00 line", reason: "a copy of the parent pledge; the asset stays" },
  { object: "LLC_BI__Pricing_Stream__c", id: "a40bb000000STRM0", name: "Pricing stream on the $20,000,000.00 line", reason: "cloned by the nCino pricing engine" },
  { object: "LLC_BI__Loan__c", id: "a4Zbb000009CLONE0", name: "Hartwell Precision Manufacturing LLC - Line of Credit - $20,000,000.00", reason: "a modification clone at Qualification" },
  { object: "LLC_BI__Loan__c", id: "a4Zbb000009CLONE7", name: "Hartwell Precision Manufacturing LLC - Line of Credit - $2,500,000.00", reason: "a modification clone at Qualification" },
  { object: "LLC_BI__Product_Package__c", id: VERSION, name: "Hartwell Precision Manufacturing LLC credit package", reason: "the version package itself" },
  { object: "cm_Action_Staging__c", id: "a5Sbb000000STG01", name: "Staging a5Sbb000000STG01", reason: "kept as the audit and marked Withdrawn" },
];

const discardPlan = (items: unknown[] = INVENTORY): StagedOutput => ({
  stagingId: "a5Sbb0000001TEST",
  planHash: "hash-discard",
  decisionToken: "tok-discard",
  productPackageId: VERSION,
  summary: "Removes the unbooked version and its copies.",
  steps: [{ id: "d1", type: "write", label: "Delete the version chain rows", objectName: "LLC_BI__LoanRenewal__c" }],
  warnings: [],
  suggestions: [],
  items: items as StagedOutput["items"],
});

describe("the confirm gate renders the org's inventory before anything is deleted", () => {
  const gate = (plan: StagedOutput) =>
    render(
      <ConfirmGate plan={plan} actionId="discard-version" simulated onConfirmed={() => {}} onBack={() => {}} />,
      dataWith(forked()),
    );

  it("counts every record the org named", () => {
    const block = gate(discardPlan()).querySelector('[data-inventory="discard"]');
    expect(text(block)).toContain("8 records in this discard");
  });

  it("groups them in the order the executor runs, chain rows first and staging last", () => {
    const block = gate(discardPlan()).querySelector('[data-inventory="discard"]')!;
    const titles = [...block.querySelectorAll("div")]
      .map((d) => (d.textContent ?? "").trim())
      .filter((t) =>
        ["Version chain rows", "Pledges and junctions", "Pricing and fees", "The version's facilities", "The version package", "Staging rows, marked Withdrawn"].includes(t),
      );
    expect(titles).toEqual([
      "Version chain rows",
      "Pledges and junctions",
      "Pricing and fees",
      "The version's facilities",
      "The version package",
      "Staging rows, marked Withdrawn",
    ]);
  });

  it("names the two clone facilities and the version package", () => {
    const said = text(gate(discardPlan()).querySelector('[data-inventory="discard"]'));
    expect(said).toContain("Line of Credit - $20,000,000.00");
    expect(said).toContain("Line of Credit - $2,500,000.00");
    expect(said).toContain("Hartwell Precision Manufacturing LLC credit package");
  });

  it("carries the org's own reason for each row, verbatim", () => {
    const said = text(gate(discardPlan()).querySelector('[data-inventory="discard"]'));
    expect(said).toContain("points the booked parent at the clone");
    expect(said).toContain("a copy of the parent pledge; the asset stays");
  });

  it("says what stays in the same block as what goes", () => {
    const said = text(gate(discardPlan()).querySelector('[data-inventory="discard"]'));
    expect(said).toContain(STAGING_KEPT);
    expect(said).toContain("stays exactly as it is");
    expect(said).toContain("only the version's own copies of them go");
  });

  it("renders no inventory block on a plan that carries none", () => {
    const plan = { ...discardPlan(), items: undefined };
    expect(gate(plan).querySelector('[data-inventory="discard"]')).toBeNull();
  });

  it("renders no inventory block for a bulk valuation's items, which share the slot", () => {
    const plan = discardPlan([{ collateralId: "a3Kbb000000COL01", collateralName: "Plant and equipment", value: 1_000_000 }]);
    expect(gate(plan).querySelector('[data-inventory="discard"]')).toBeNull();
  });
});

/* ---------------------------------------------------- the trail's own row */

describe("the Activity trail carries the standing Modification in Progress row", () => {
  it("names the version, its state and the package it locks", () => {
    const row = render(<ActivityTab bundle={forked()} />, dataWith(forked())).querySelector('[data-inflight-row="1"]');
    const said = text(row);
    expect(said).toContain(MODIFICATION_IN_PROGRESS);
    expect(said).toContain("editable until approval");
    expect(said).toContain("cannot take a second modification");
  });

  it("carries the door, with the founder's own label and line", () => {
    const el = render(<ActivityTab bundle={forked()} />, dataWith(forked()));
    const door = el.querySelector('[data-discard-door="trail"]');
    expect(text(door)).toBe(DISCARD_LABEL);
    expect(text(el.querySelector('[data-inflight-row="1"]'))).toContain(DISCARD_LINE);
  });

  it("opens the discard panel on the door, and no other panel", () => {
    const el = render(<ActivityTab bundle={forked()} />, dataWith(forked()));
    act(() => el.querySelector('[data-discard-door="trail"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const dialog = [...document.body.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute("aria-label"));
    expect(dialog).toEqual([DISCARD_LABEL]);
  });

  it("shows no row at all where the relationship carries no version", () => {
    const bundle = data.borrowers![HARTWELL];
    expect(render(<ActivityTab bundle={bundle} />, data).querySelector('[data-inflight-row="1"]')).toBeNull();
  });

  it("shows no row once the org has taken the version to approval", () => {
    // The version is no longer the banker's, so the trail offers no undo. The
    // package pickers already say why, in the approval's own words.
    const bundle = forked("Approval / Loan Committee");
    expect(render(<ActivityTab bundle={bundle} />, dataWith(bundle)).querySelector('[data-inflight-row="1"]')).toBeNull();
  });
});

/* ------------------------------------------------- the client actions row */

describe("the Client Actions row is gated by the same data", () => {
  const row = (el: HTMLElement) =>
    [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(DISCARD_LABEL)) ?? null;

  it("is enabled where a version is in flight and still editable", () => {
    const el = render(<ActionsPanelBody />, dataWith(forked()));
    const button = row(el)!;
    expect(button).toBeTruthy();
    expect(button.getAttribute("aria-disabled")).toBe("false");
  });

  it("stays visible and disabled with the reason where there is no version", () => {
    const el = render(<ActionsPanelBody />, data);
    const button = row(el)!;
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(text(button)).toContain(NO_VERSION_REASON);
  });

  it("is disabled in the approval's own words once the org has the version", () => {
    const bundle = forked("Approval / Loan Committee");
    const button = row(render(<ActionsPanelBody />, dataWith(bundle)))!;
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(text(button)).toContain(IN_APPROVAL_REFUSAL);
  });
});
