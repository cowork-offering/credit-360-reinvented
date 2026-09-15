// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppProvider, useApp } from "./state/appState";
import { ActivityTab } from "./components/tabs/ActivityTab";
import { ActionsPanelBody } from "./components/ActionsPanel";
import { DISCARD_ACTION_ID, DISCARD_LABEL, DISCARD_LINE, DISCARD_OBJECT_TITLES, NO_VERSION_REASON } from "./actions/discardVersion";
import { closingSteps, stageGroups } from "./actions/stageModel";
import { forgetAllRuns, rememberRun, RESUME_LABEL, RESUME_NEEDS_RESTAGE } from "./actions/resumeRun";
import { IN_APPROVAL_REFUSAL, MODIFICATION_IN_PROGRESS } from "./book/packages";
import type { StagedOutput } from "./actions/stagedPlan";
import type { ActionHistoryRow, BorrowerBundle, C360Data, Facility } from "./data/contract";
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

function Opener({ children, history }: { children: ReactNode; history?: ActionHistoryRow[] }) {
  const { dispatch } = useApp();
  useEffect(() => {
    dispatch({ type: "OPEN_ACCOUNT", accountId: HARTWELL });
    if (history) dispatch({ type: "SET_ACTION_HISTORY", accountId: HARTWELL, rows: history });
  }, [dispatch, history]);
  return <>{children}</>;
}

function render(node: ReactNode, d: C360Data, history?: ActionHistoryRow[]): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AppProvider data={d}>
        <Opener history={history}>{node}</Opener>
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

/** The plan the org would return over that inventory: one write step per
 *  object, each proved by its own `<id>_verify` step, which is the pairing the
 *  frozen contract runs and the stage reads its groups off. */
const PAIRS: Array<[string, string]> = [
  ["delete_chain", "LLC_BI__LoanRenewal__c"],
  ["delete_pledges", "LLC_BI__Loan_Collateral2__c"],
  ["delete_pricing_streams", "LLC_BI__Pricing_Stream__c"],
  ["delete_members", "LLC_BI__Loan__c"],
  ["delete_package", "LLC_BI__Product_Package__c"],
];

const discardPlan = (items: unknown[] = INVENTORY): StagedOutput => ({
  stagingId: "a5Sbb0000001TEST",
  planHash: "hash-discard",
  decisionToken: "tok-discard",
  productPackageId: VERSION,
  summary: "Removes the unbooked version and its copies.",
  steps: [
    ...PAIRS.flatMap(([id, objectName]) => [
      { id, type: "write" as const, label: `Remove the ${objectName} rows (0)`, objectName },
      { id: `${id}_verify`, type: "verification" as const, label: `Confirm every ${objectName} is gone`, objectName },
    ]),
    // The trail row is KEPT and marked Withdrawn, so it is a closing sentence
    // rather than a group: nothing about it dissolves off the glass.
    { id: "withdraw_trail", type: "write" as const, label: "Mark the action trail rows Withdrawn (1)", objectName: "cm_Action_Staging__c" },
  ],
  warnings: ["This action DELETES 7 records."],
  suggestions: [],
  items: items as StagedOutput["items"],
});

/* =============================================================================
   THE INVENTORY IS ON THE GOVERNED-ACTION STAGE (0.9.29, backlog row 65).

   It used to be a block on the confirm gate, inside the modal the founder
   called "this old school looking pop up". The facts it has to carry did not
   change: the org's own rows, in the org's own order, with the org's own
   reasons, and NOTHING composed here. Only the surface did.

   The same suite on the real Sunbelt plan is `governedStage.render.test.tsx`;
   this one holds the inventory doctrine on a hand-built org answer, which is
   what this file has always been for.
   ============================================================================= */

describe("the stage renders the org's inventory before anything is deleted", () => {
  const groups = () => stageGroups(discardPlan(), DISCARD_OBJECT_TITLES);

  it("counts every record the org named against the group that deletes it", () => {
    expect(groups().reduce((n, g) => n + g.count, 0)).toBe(7);
  });

  it("groups them in the order the executor runs, chain rows first", () => {
    expect(groups().map((g) => g.title)).toEqual([
      "Version chain rows",
      "Collateral pledges",
      "Pricing streams",
      "The version's facilities",
      "The version package",
    ]);
  });

  it("shows on the row what differs between the org's names, and keeps the exact ones under it", () => {
    const g = groups();
    const facilities = g.find((x) => x.objectName === "LLC_BI__Loan__c")!;
    // The row shows what differs: both clones open on the same borrower and the
    // same product, and printing that twice is not detail.
    expect(facilities.names).toBe("$20,000,000.00, $2,500,000.00");
    // The disclosure keeps the org's exact strings, which is what the banker
    // matches against the record in front of them.
    expect(facilities.reasons.flatMap((r) => r.names).join(" | ")).toContain(
      "Hartwell Precision Manufacturing LLC - Line of Credit - $20,000,000.00",
    );
    expect(g.find((x) => x.objectName === "LLC_BI__Product_Package__c")!.names).toBe(
      "Hartwell Precision Manufacturing LLC credit package",
    );
  });

  it("carries the org's own reason for each row, verbatim", () => {
    const said = groups().flatMap((g) => g.reasons.map((r) => r.text));
    expect(said).toContain("points the booked parent at the clone");
    expect(said).toContain("a copy of the parent pledge; the asset stays");
  });

  it("makes no group of the staging row, which is kept and marked Withdrawn", () => {
    expect(groups().some((g) => g.objectName === "cm_Action_Staging__c")).toBe(false);
    const plan = discardPlan();
    expect(closingSteps(plan, groups()).map((s) => s.id)).toEqual(["withdraw_trail"]);
  });

  it("builds no group at all from a plan that carries no inventory", () => {
    expect(stageGroups({ ...discardPlan(), items: undefined }, DISCARD_OBJECT_TITLES).every((g) => g.count === 0)).toBe(true);
  });

  it("takes nothing from a bulk valuation's items, which share the wire slot", () => {
    const plan = discardPlan([{ collateralId: "a3Kbb000000COL01", collateralName: "Plant and equipment", value: 1_000_000 }]);
    expect(stageGroups(plan, DISCARD_OBJECT_TITLES).every((g) => g.count === 0)).toBe(true);
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

/* =============================================================================
   A STOPPED RUN ON THE TRAIL (0.9.29, backlog row 64).

   FOUNDER, 2026-09-15 17:51 UTC: the Sunbelt discard stopped at `delete_chain`,
   the tracker said to re-run the executor with the same idempotency key, and
   the page offered nothing to press.

   THE CONTROL EXISTS ONLY WHERE THE RUN CAN ACTUALLY BE RESUMED. The decision
   token is minted server-side and lives on the page that made the run; where
   this page no longer holds it the row says so in one line and offers no
   button, because the only other option is a button that invents a token.
   ============================================================================= */

const STOPPED_ROW: ActionHistoryRow = {
  stagingId: "a8abb00001Oj89mAAB",
  actionId: DISCARD_ACTION_ID,
  status: "Executing",
  resultRecordId: "a5Fbb000000JIR3EAO",
  executedAt: "2026-09-15T17:51:00.000Z",
  approverUserId: "005bb000001TESTAAA",
  summary: "The discard stopped at delete_chain. 0 records are gone and 32 remain.",
};

const RESUMABLE_PLAN: StagedOutput = {
  stagingId: STOPPED_ROW.stagingId,
  planHash: "hash-frozen",
  decisionToken: "tok-frozen",
  summary: "Removes the unbooked version and its copies.",
  steps: [],
  warnings: [],
  suggestions: [],
};

describe("a run that stopped part way is offered a resume, or an honest line", () => {
  afterEach(() => forgetAllRuns());

  it("says on the trail that the run stopped, not that it is 'recorded as Executing'", () => {
    const el = render(<ActivityTab bundle={forked()} />, dataWith(forked()), [STOPPED_ROW]);
    expect(text(el)).toContain("Version discard stopped part way");
    expect(text(el)).not.toContain("recorded as Executing");
  });

  it("offers the resume where this page still holds the run it made", () => {
    rememberRun({
      actionId: DISCARD_ACTION_ID,
      plan: RESUMABLE_PLAN,
      idempotencyKey: "key-stg168",
      approverUserId: "005bb000001TESTAAA",
      outcome: { stagingId: RESUMABLE_PLAN.stagingId, terminalState: "partial", outcome: "stopped", steps: [] },
    });
    const el = render(<ActivityTab bundle={forked()} />, dataWith(forked()), [STOPPED_ROW]);
    const row = el.querySelector(`[data-stopped-run="${STOPPED_ROW.stagingId}"]`)!;
    expect(row).toBeTruthy();
    expect(row.querySelector("button")?.textContent).toBe(RESUME_LABEL);
    expect(text(row)).toContain("the same decision token");
  });

  it("explains in one line, and offers NO dead button, where the token is gone", () => {
    const el = render(<ActivityTab bundle={forked()} />, dataWith(forked()), [STOPPED_ROW]);
    const row = el.querySelector(`[data-stopped-run="${STOPPED_ROW.stagingId}"]`)!;
    expect(row.querySelector("button")).toBeNull();
    expect(text(row)).toBe(RESUME_NEEDS_RESTAGE);
  });

  it("puts no resume under a run the org calls finished", () => {
    const done: ActionHistoryRow = { ...STOPPED_ROW, status: "Completed" };
    const el = render(<ActivityTab bundle={forked()} />, dataWith(forked()), [done]);
    expect(el.querySelector("[data-stopped-run]")).toBeNull();
  });
});
