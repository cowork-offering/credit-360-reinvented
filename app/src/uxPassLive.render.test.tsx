// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { C360Data } from "./data/contract";
import { AppProvider } from "./state/appState";
import { AppShell } from "./components/AppShell";
import { AppEntry, dispatchOpenSheet } from "./test/entry";
import { clearOverlays } from "./state/syncOverlay";
import live from "../../artifact/live-data.json";

/* =============================================================================
   THE UX PASS, AGAINST THE LIVE-SHAPED BUNDLE (founder UAT, 2026-08-25).

   The sample bundle is tidy. The LIVE one is what the founder actually drove,
   and it is where three of the findings came from, because it carries the
   shapes the sample never had:

     - Hartwell's six facilities are all named "<Borrower> - <Product> - <$Amt>",
       which is what made the old package header and member list unreadable (F1).
     - Hartwell's "Term Covenants" row has a NULL actualValue, which is what
       printed "borrower.covenants.covenants[].actualValue is present but null ·
       Customer360Covenants" onto a banker's screen (F4).
     - Hartwell's 15.0M revolver DOES carry a loan-level covenant junction —
       Accounts Receivable, the borrowing base test — but the live Exposure read
       leaves `loanCovenants` null, so the rule that consulted only that field
       stated as a FACT that no covenant attaches to it (F3/F4).
     - Every Hartwell facility stages its pledges with share, advance rate and
       lien position, which is the context the ticket never showed (F6).

   Nothing here is a fixture. Every assertion below reads `artifact/live-data.json`
   exactly as published.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATA = live as unknown as C360Data;
const HARTWELL = "Hartwell Precision Manufacturing LLC";
/** The 15.0M line of credit. The covenant read attaches Accounts Receivable to
 *  exactly this loan id, and the exposure read carries no junction at all. */
const REVOLVER = "a4Zbb0000027MaYEAU";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  try {
    sessionStorage.clear();
    clearOverlays();
  } catch {
    /* ignore */
  }
});

function mount(): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AppProvider data={DATA}>
        <AppShell />
        <AppEntry />
      </AppProvider>,
    );
  });
  return container;
}

const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const openRow = (name: string) =>
  [...document.querySelectorAll('[role="button"]')].find((r) => r.textContent?.includes(name))!;
const panel = (label: string) =>
  [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute("aria-label") === label) ?? null;

function openTicket(actionLabel: string, account = HARTWELL) {
  mount();
  click(openRow(account));
  act(() => dispatchOpenSheet());
  const row = [...document.querySelector('[role="dialog"]')!.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(actionLabel),
  )!;
  click(row);
  return panel(actionLabel)!;
}

/* ---------------------------------------------------- the bundle's own shape */

describe("the live bundle carries the shapes these findings came from", () => {
  const hartwell = DATA.borrowers![Object.keys(DATA.borrowers!).find((k) => DATA.borrowers![k].snapshot?.name === HARTWELL)!];

  it("attaches the Accounts Receivable covenant to the revolver, on the COVENANT read", () => {
    const ar = hartwell.covenants!.covenants!.find((c) => c.covenantType === "Accounts Receivable")!;
    expect(ar.attachedLoans).toEqual([
      { loanId: REVOLVER, loanName: `${HARTWELL} - Line of Credit - $15,000,000.00` },
    ]);
  });

  it("carries NO junction on the exposure read, which is why one source was not enough", () => {
    for (const f of hartwell.exposure!.facilities!) expect(Array.isArray(f.loanCovenants)).toBe(false);
  });

  it("stages a covenant with no measured value, which is what leaked the contract path", () => {
    const term = hartwell.covenants!.covenants!.find((c) => c.covenantType === "Term Covenants")!;
    expect(term.actualValue == null).toBe(true);
  });
});

/* ------------------------------------------------------------ F3/F4 the card */

describe("F3/F4 — the junction card states what is actually attached", () => {
  it("names the revolver's borrowing base covenant instead of denying it exists", () => {
    const p = openTicket("Loan Modification");
    const text = p.textContent ?? "";
    // The old card's sentence, which was false on this relationship.
    expect(text).not.toContain("No loan-level covenants are attached");
    // Four junctions are real on Hartwell now: the org grew a second package
    // (2026-09-03) and attached DSC (to the new CRE loan) and the FCC covenant
    // (to the Proposal-stage equipment loan), on top of the two that already
    // named a loan (AR on the revolver, the term covenant on construction).
    // The sentence names the first three and folds the rest into "and N more".
    expect(text).toContain("4 loan-level covenant attachments carry onto the new facility.");
    expect(text).toContain("Accounts Receivable on Line of Credit - $15,000,000.00");
    expect(text).toContain("and 1 more");
  });

  it("says it in banker language, with no contract path and no tool name", () => {
    const text = openTicket("Loan Modification").textContent ?? "";
    expect(text).not.toMatch(/borrower\.[a-z]/);
    expect(text).not.toMatch(/Customer360[A-Z]/);
    expect(text).not.toMatch(/loanCovenants|attachedLoans|productPackageId|facilityIds/);
    expect(text).not.toMatch(/\bLLC_BI__/);
  });

  it("turns the null covenant value into a sentence, keeping the path behind a toggle", () => {
    const p = openTicket("Loan Modification");
    expect(p.textContent).toContain("The last test of Term Covenants carries no measured value");
    expect(p.textContent).not.toContain("borrower.covenants.covenants[].actualValue");

    const toggle = [...p.querySelectorAll("button")].find((b) => /Where this comes from/.test(b.textContent ?? ""))!;
    expect(toggle).toBeTruthy();
    click(toggle);
    const opened = panel("Loan Modification")!.textContent ?? "";
    expect(opened).toContain("borrower.covenants.covenants[].actualValue");
    expect(opened).toContain("Customer360Covenants");
  });

  it("quotes the read the ticket is using, not a date with no data behind it", () => {
    const text = openTicket("Loan Modification").textContent ?? "";
    // live-data's snapshot clock is `meta.generatedAt`, 2026-08-25T04:55:34Z (its
    // latest observation, the newest Hartwell activity row), and nothing has been
    // synced since.
    expect(text).toContain("as it was prepared on Aug 25, 2026, 04:55 UTC");
    expect(text).toContain("Sync this relationship to recheck it on today's figures");
    expect(text).not.toContain("computed from data as of");
  });
});

/* ------------------------------------------------------------- F1 the layout */

describe("F1 — the six-facility deal reads as a headline and clean rows", () => {
  it("names the deal once, at headline size, instead of concatenating its members", () => {
    const p = openTicket("Loan Modification");
    // The org grew a second package (2026-09-03): the label now names both,
    // and the C&I package's own facility count carries its Proposal-stage
    // member too (`packageRecords` counts every facility naming the package,
    // not only the booked ones).
    const headline = p.querySelector("h4")!;
    expect(headline.textContent).toBe(`${HARTWELL} credit package · Non-Real Estate and Real Estate`);
    expect(headline.nextElementSibling?.textContent).toBe("7 facilities · $49M committed · $31.03M drawn");
  });

  it("drops the borrower's name from all six member rows", () => {
    const p = openTicket("Loan Modification");
    const boxes = [...p.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes).toHaveLength(6);
    const labels = boxes.map((b) => b.getAttribute("aria-label"));
    expect(labels).toContain("Line of Credit - $15,000,000.00");
    expect(labels).toContain("Construction - $12,000,000.00");
    for (const l of labels) expect(l).not.toContain(HARTWELL);
  });
});

/* ----------------------------------------------------------- F6 the security */

describe("F6 — the ticket shows what secures the members the banker ticked", () => {
  it("lists the pledges of the selected facility with lien, share and advance rate", () => {
    const p = openTicket("Loan Modification");
    // The largest member is preselected: the 15.0M line of credit.
    const text = p.textContent ?? "";
    expect(text).toContain("Security on the selected facilities");
    expect(text).toContain("COL-000762");
    expect(text).toContain("1st lien");
    expect(text).toContain("$8M pledged here");
    expect(text).toContain("80 percent advance");
    expect(text).toContain("All present and future accounts receivable");
  });

  it("connects those pledges to the coverage figure the challenge card measures", () => {
    const text = openTicket("Loan Modification").textContent ?? "";
    expect(text).toContain("The coverage check measures this relationship's lendable collateral");
    // The SAME numerator, stated once under the pledges and once in the ratio:
    // the org's distinct-collateral lendable value, not a re-derivation. Both
    // moved with the org's two-package refresh (2026-09-03): $31.60M -> $42.37M
    // lendable, $46M -> $57M relationship commitment.
    expect(text).toContain("The coverage check measures this relationship's lendable collateral, $42.37M");
    expect(text).toContain("$42.37M lendable against the relationship's $57M commitment");
  });

  it("adds the second facility's security when a second member is ticked", () => {
    const p = openTicket("Loan Modification");
    const boxes = [...p.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    const construction = boxes.find((b) => b.getAttribute("aria-label") === "Construction - $12,000,000.00")!;
    click(construction);
    const text = panel("Loan Modification")!.textContent ?? "";
    expect(text).toContain("COL-000762");
    expect(text).toContain("COL-000765");
    expect(text).toContain("First mortgage on the owner-occupied Fort Wayne manufacturing campus");
  });
});
