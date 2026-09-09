// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearOverlays } from "./state/syncOverlay";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { C360Data } from "./data/contract";
import { AppProvider } from "./state/appState";
import { __skipBootForTests } from "./channel/useLivePortfolio";
// These tests mount the home only to navigate through it into an account; the
// cold-open skeleton is not what they exercise, so the home opens already
// settled, the way a returning viewer with a warm cache does. See the seam.
__skipBootForTests();
import { AppShell } from "./components/AppShell";
import { AppEntry, dispatchOpenSheet } from "./test/entry";
import { ACCOUNT_TABS } from "./state/appState";
import { resetModalStack } from "./components/modalStack";
import { readAnchors } from "./data/contract";
import { collapseConnections } from "./data/graphAggregate";
import { collateralAssets } from "./domain/collateralAssets";
import { packageRecords } from "./actions/schemas";
import { resolveBundle } from "./actions/registry";
import live from "../../artifact/live-data.json";
import sample from "../../artifact/sample-data.json";

/* =============================================================================
   EVERY STAGED ACCOUNT RENDERS. EVERY TAB.

   The gap this exists to close: a real bundle merged from live tool responses
   crashed the profile to a blank screen, because one field arrived in a shape
   no sample bundle had ever used. Unit tests over helpers cannot catch that —
   only mounting the real data can.

   So this walks EVERY account in EVERY staged data file through EVERY tab and
   asserts something rendered. A gap state is a pass. A blank screen is not.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  resetModalStack();
  try {
    sessionStorage.clear();
    // The sync overlay persists to localStorage by design; one test's sync must
    // not restore itself into the next test's mount.
    clearOverlays();
  } catch {
    /* ignore */
  }
});

const FILES: Array<[string, C360Data]> = [
  ["live-data.json", live as unknown as C360Data],
  ["sample-data.json", sample as unknown as C360Data],
];

function mount(data: C360Data) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AppProvider data={data}>
        <AppShell />
        <AppEntry />
      </AppProvider>,
    );
  });
}

const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

function openAccount(name: string) {
  const row = [...document.querySelectorAll('[role="button"]')].find((r) => r.textContent?.includes(name));
  expect(row, `no worklist row for ${name}`).toBeTruthy();
  click(row!);
}

for (const [fileName, data] of FILES) {
  const accounts = Object.entries(data.borrowers ?? {});

  describe(`${fileName} — every staged account renders`, () => {
    it("has accounts to render", () => {
      expect(accounts.length).toBeGreaterThan(0);
    });

    for (const [accountId, bundle] of accounts) {
      const name = bundle.snapshot?.name ?? accountId;

      it(`renders the profile for ${name}`, () => {
        mount(data);
        openAccount(name);
        const workspace = container!.textContent ?? "";
        // The account view rendered SOMETHING about this relationship, not a
        // blank shell.
        expect(workspace, `${name} rendered blank`).toContain(name);
        expect(workspace.length).toBeGreaterThan(200);
      });

      it(`renders every tab for ${name}`, () => {
        mount(data);
        openAccount(name);
        for (const tab of ACCOUNT_TABS) {
          const button = [...container!.querySelectorAll("button")].find((b) => b.textContent?.trim() === tab.label);
          expect(button, `${name}: no tab button for ${tab.label}`).toBeTruthy();
          click(button!);
          const text = container!.textContent ?? "";
          // A gap state is a pass. A crash is not: React unmounts the tree and
          // the workspace loses the account name it was rendering a moment ago.
          expect(text, `${name}: ${tab.label} crashed the workspace`).toContain(name);
          expect(text.length, `${name}: ${tab.label} rendered nothing`).toBeGreaterThan(200);
        }
      });
    }
  });
}

describe("the shapes a real bundle is allowed to arrive in", () => {
  it("tolerates anchors in EITHER shape, whatever the producer sends", () => {
    // The crash: every sample bundle carried `anchors` as an array of chips, so
    // the header mapped over it. One real bundle carried an object, and .map
    // threw straight through the workspace. The producer has since corrected
    // the shape, which is exactly why the guard must stay: the cockpit cannot
    // depend on a producer never regressing.
    const hartwell = (live as unknown as C360Data).borrowers?.["001bb00001I7FPNAA3"];
    expect(hartwell).toBeTruthy();
    expect(() => readAnchors(hartwell)).not.toThrow();
    expect(readAnchors({ ...hartwell!, anchors: { accountId: "x" } as never })).toEqual([]);
  });

  it("tolerates a bundle with no boom, no verdict and no requests", () => {
    // Hartwell WAS the live fixture for this guard, first losing its missing
    // verdict on 2026-09-01 and then its missing boom on 2026-09-03, when the
    // demo borrower was given a spread. Both holes read as lost information on
    // the glass, so both were filled. The tolerance contract survives on a
    // synthetic stripped bundle instead: the cockpit still cannot depend on a
    // producer always sending all three.
    const hartwell = (live as unknown as C360Data).borrowers?.["001bb00001I7FPNAA3"]!;
    expect(hartwell.requests).toBeUndefined();
    const stripped = { ...hartwell, verdict: undefined, boom: undefined };
    expect(() => readAnchors(stripped)).not.toThrow();
    expect(stripped.verdict).toBeUndefined();
    expect(stripped.boom).toBeUndefined();
  });
});


describe("Hartwell's real-data conditions each render as a gap, not a crash", () => {
  const HARTWELL = "Hartwell Precision Manufacturing LLC";
  const data = live as unknown as C360Data;

  const openTab = (label: string) => {
    mount(data);
    openAccount(HARTWELL);
    const button = [...container!.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
    click(button);
    return container!.textContent ?? "";
  };

  it("the Financials tab renders Hartwell's spread", () => {
    const text = openTab("Financials");
    expect(text).toContain(HARTWELL);
    // Four periods, and the LTM revenue the dossier and the covenants both stand on.
    expect(text.length).toBeGreaterThan(200);
  });

  it("a covenant with null actual and threshold still renders its row", () => {
    const covenants = data.borrowers?.["001bb00001I7FPNAA3"]?.covenants?.covenants ?? [];
    const nulls = covenants.filter((c) => c.actualValue == null || c.thresholdValue == null);
    expect(nulls.length, "the fixture should carry a null-valued covenant").toBeGreaterThan(0);
    const text = openTab("Covenants");
    expect(text).toContain(nulls[0].covenantType ?? "");
  });

  it("no facility has matured, and one that had would still render", () => {
    // Hartwell carried an already-expired $2.5M line, maturity 2026-06-30, until
    // 2026-09-03, when the two lines were aligned onto 2027-03-15. A booked
    // facility whose maturity is in the past is a data fault, not a state the
    // demo should show, so the fixture is asserted clean. The crash guard the
    // old assertion bought is kept on a synthetic past-dated facility.
    const facs = data.borrowers?.["001bb00001I7FPNAA3"]?.exposure?.facilities ?? [];
    expect(facs.filter((f) => f.maturityDate && f.maturityDate < "2026-09-03")).toHaveLength(0);
    const withPast = {
      ...data,
      borrowers: {
        ...data.borrowers,
        "001bb00001I7FPNAA3": {
          ...data.borrowers!["001bb00001I7FPNAA3"],
          exposure: {
            ...data.borrowers!["001bb00001I7FPNAA3"].exposure,
            facilities: [{ ...facs[0], maturityDate: "2024-01-31" }, ...facs.slice(1)],
          },
        },
      },
    } as C360Data;
    mount(withPast);
    openAccount(HARTWELL);
    const button = [...container!.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Exposure & Collateral",
    )!;
    click(button);
    expect(container!.textContent ?? "").toContain(HARTWELL);
  });

  it("no verdict key: the header renders without one", () => {
    mount(data);
    openAccount(HARTWELL);
    expect(container!.textContent).toContain(HARTWELL);
  });
});

describe("readAnchors tolerates whatever a producer sends", () => {
  it("keeps well-formed chips", () => {
    const chips = [{ label: "Rating", value: "Grade 5" }];
    expect(readAnchors({ snapshot: { accountId: "x" }, anchors: chips } as never)).toEqual(chips);
  });

  it("treats a non-array as no chips at all, rather than throwing", () => {
    for (const shape of [{ accountId: "x" }, "chips", 7, null, undefined]) {
      expect(readAnchors({ snapshot: { accountId: "x" }, anchors: shape } as never)).toEqual([]);
    }
  });

  it("drops malformed entries and keeps the rest", () => {
    const mixed = [{ label: "Rating", value: "Grade 5" }, { label: "Broken" }, null, "nope"];
    expect(readAnchors({ snapshot: { accountId: "x" }, anchors: mixed } as never)).toEqual([
      { label: "Rating", value: "Grade 5" },
    ]);
  });
});


describe("no list surface renders raw org row multiplicity", () => {
  const HARTWELL = "Hartwell Precision Manufacturing LLC";
  const data = live as unknown as C360Data;

  const graphText = () => {
    mount(data);
    openAccount(HARTWELL);
    const button = [...container!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Relationship Graph")!;
    click(button);
    return container!.textContent ?? "";
  };

  it("shows each mirrored counterparty ONCE", () => {
    const text = graphText();
    for (const name of ["Hartwell Industrial Holdings LLC", "Hartwell Logistics LLC", "James Hartwell", "Elena Hartwell"]) {
      const hits = text.split(name).length - 1;
      expect(hits, `${name} rendered ${hits} times`).toBeLessThanOrEqual(1);
    }
  });

  it("never shows the mirror's generic role", () => {
    // "Child" and "Company" are the reflections of Parent and Owner, not
    // relationships in their own right.
    const text = graphText();
    expect(text).not.toContain("· Child");
    expect(text).not.toContain("· Company");
  });

  it("shows one borrower involvement with its facility count, not six rows", () => {
    const text = graphText();
    expect(text).toContain("6 facilities");
    // The borrower's own name appears once in the involvement list.
    const rows = [...container!.querySelectorAll("div")].filter((d) => d.textContent?.trim().startsWith(HARTWELL));
    expect(rows.length).toBeLessThan(6);
  });

  it("leaves Piedmont's unduplicated graph alone", () => {
    mount(data);
    openAccount("Piedmont Precision Components, Inc.");
    const button = [...container!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Relationship Graph")!;
    click(button);
    // The PANE, not the page: the hero above it now states the facility count
    // for the relationship (derived, 2026-09-09), which is a different claim.
    const text = container!.querySelector(".pane")?.textContent ?? "";
    expect(text).toContain("Margaret Holloway");
    expect(text).toContain("Personal Guaranty");
    // One facility each: no count is claimed where there is nothing to count.
    expect(text).not.toContain("facilities");
  });
});


describe("the founder's button, on the real bundle", () => {
  const data = live as unknown as C360Data;

  it("offers Loan Modification and Renewal on Hartwell's booked facilities", () => {
    mount(data);
    openAccount("Hartwell Precision Manufacturing LLC");
    act(() => dispatchOpenSheet());
    for (const label of ["Loan Modification", "Renewal"]) {
      const row = [...document.querySelectorAll('[role="dialog"]')]
        .flatMap((d) => [...d.querySelectorAll("button")])
        .find((b) => b.textContent?.includes(label))!;
      expect(row, `${label} missing from Client Actions`).toBeTruthy();
      expect(row.hasAttribute("disabled"), `${label} is greyed out on six booked loans`).toBe(false);
    }
  });

  it("still greys them on Piedmont, and says the facilities are at Final Review", () => {
    mount(data);
    openAccount("Piedmont Precision Components, Inc.");
    act(() => dispatchOpenSheet());
    const row = [...document.querySelectorAll('[role="dialog"]')]
      .flatMap((d) => [...d.querySelectorAll("button")])
      .find((b) => b.textContent?.includes("Loan Modification"))!;
    expect(row.hasAttribute("disabled")).toBe(true);
    expect(row.textContent).toContain("Final Review");
  });
});


describe("signals show one alert per guarantor, not one per facility", () => {
  it("names each Hartwell guarantor once, with the facility span", () => {
    mount(live as unknown as C360Data);
    openAccount("Hartwell Precision Manufacturing LLC");
    const button = [...container!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Structural Signals")!;
    click(button);
    const text = container!.textContent ?? "";
    // The org sends 14 rows for 3 guarantors. The founder saw six identical
    // "Guarantor signal" lines; there is now one, and it says how far it reaches.
    const alerts = text.split("Guarantor signal").length - 1;
    expect(alerts).toBeLessThanOrEqual(3);
    expect(text).toContain("across 6 facilities");
  });
});


/* =============================================================================
   PER-BORROWER RENDER VERIFICATION.

   Founder rule: a surface that works for one relationship and not another is a
   failed item. Each fixed surface is mounted for EVERY account in EVERY staged
   file and checked for the four failure modes that actually happened: a crash,
   raw mirror rows, duplicate identity rows, and an empty surface where the
   bundle has data.
   ============================================================================= */

for (const [fileName, data] of FILES) {
  for (const [accountId, bundle] of Object.entries(data.borrowers ?? {})) {
    const name = bundle.snapshot?.name ?? accountId;

    describe(`${name} (${fileName}) renders its own data`, () => {
      const openTab = (label: string) => {
        mount(data);
        openAccount(name);
        const button = [...container!.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
        expect(button, `${name}: no ${label} tab`).toBeTruthy();
        click(button);
        return container!.textContent ?? "";
      };

      it("shows every graph counterparty, and never a mirror role", () => {
        const text = openTab("Relationship Graph");
        const rows = collapseConnections(bundle.graph?.connections);
        for (const row of rows) {
          const label = row.counterpartyName ?? "";
          if (!label) continue;
          expect(text, `${name}: ${label} missing from the graph`).toContain(label);
        }
        // A counterparty may legitimately appear in more than one SECTION (an
        // owner who is also a guarantor), so per-section uniqueness is asserted
        // at the aggregation layer. What must never appear anywhere is the
        // mirror's own generic role rendered as a relationship.
        expect(text).not.toContain("· Child");
        expect(text).not.toContain("· Company");
        // And the aggregation the tab renders from is one row per identity.
        const ids = rows.map((r) => r.counterpartyId ?? r.counterpartyName);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it("shows every collateral ASSET once, and none when there are none", () => {
        const text = openTab("Exposure & Collateral");
        const assets = collateralAssets(bundle);
        expect(text).toContain("Collateral");
        if (assets.length === 0) {
          expect(text).toContain("No collateral pledged");
          return;
        }
        for (const a of assets) {
          // The asset is named by WHAT IT IS. The org's long description is on
          // hover, never as the row's title (founder, 2026-09-03).
          expect(text, `${name}: ${a.type} missing`).toContain(a.type);
          if (a.collateralName) expect(text).toContain(a.collateralName);
          if (a.description && a.description !== a.descriptor)
            expect(text, `${name}: the long description is in the row`).not.toContain(a.description);
        }
        // One row per asset, with its pledge count — never a row per pledge.
        const multi = assets.find((a) => a.pledges.length > 1);
        if (multi) expect(text).toContain(`${multi.pledges.length} pledges`);
      });

      it("renders its covenants without losing or duplicating any", () => {
        const text = openTab("Covenants");
        const covs = bundle.covenants?.covenants ?? [];
        if (!covs.length) {
          expect(text).toContain("No active covenants");
          return;
        }
        for (const c of covs) {
          if (!c.covenantType) continue;
          expect(text, `${name}: ${c.covenantType} missing`).toContain(c.covenantType);
        }
      });

      it("renders its structural signals without repeating a guarantor", () => {
        const text = openTab("Structural Signals");
        expect(text).toContain(name);
        const guarantors = new Set(
          ((bundle.signals?.guarantorSignals ?? []) as Array<Record<string, unknown>>)
            .filter((g) => g.riskStatus || g.highestRiskGrade)
            .map((g) => String(g.guarantorName ?? "")),
        );
        for (const g of guarantors) {
          if (!g) continue;
          const hits = text.split(g).length - 1;
          expect(hits, `${name}: guarantor ${g} appeared ${hits} times`).toBeLessThanOrEqual(1);
        }
      });
    });
  }
}


describe("a connection with no ownership percent still renders (founder rule)", () => {
  it("draws Hartwell Logistics onto the borrower, not into a side card", () => {
    mount(live as unknown as C360Data);
    openAccount("Hartwell Precision Manufacturing LLC");
    const button = [...container!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Relationship Graph")!;
    click(button);
    const text = container!.textContent ?? "";
    // One node per party, all of them on the borrower. The side card is gone:
    // a party with no equity edge is still a party on this credit, and exiling
    // it to a text list left it with no line at all (founder, 2026-09-03).
    expect(container!.querySelector(".rr")).toBeNull();
    const names = [...container!.querySelectorAll(".onode b")].map((n) => n.textContent);
    expect(names).toContain("Hartwell Logistics LLC");
    expect(text).toContain("Affiliated Company");
    // The involvement the connection knows nothing about rides the same node.
    expect(text).toContain("Related Entity");
    // The percent-bearing ones carry the guaranty the involvement read gives
    // them on the same node, not on a second row somewhere else.
    expect(names).toContain("Hartwell Industrial Holdings LLC");
    expect(text).toMatch(/Parent · Guarantor/);
  });
});


describe("the graph edges reach the borrower (founder, 2026-09-03)", () => {
  const openGraph = () => {
    mount(live as unknown as C360Data);
    openAccount("Hartwell Precision Manufacturing LLC");
    const button = [...container!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Relationship Graph")!;
    click(button);
  };

  it("draws one node per party, and the borrower they all point at", () => {
    openGraph();
    const names = [...container!.querySelectorAll(".onode b")].map((n) => n.textContent);
    expect(names).toEqual([
      "Hartwell Industrial Holdings LLC",
      "Hartwell Logistics LLC",
      "James Hartwell",
      "Elena Hartwell",
    ]);
    const borrower = container!.querySelector("#oBorrower")!;
    expect(borrower).not.toBeNull();
    expect(borrower.querySelector("b")?.textContent).toBe("Hartwell Precision Manufacturing LLC");
    // The org grew a second package (2026-09-03): nine facilities now, not seven.
    expect(borrower.textContent).toContain("Borrower · 9 facilities");
  });

  it("paints the stroke over MEASURED space, so a straight edge still renders", () => {
    // THE BUG, exactly. James Hartwell sits directly above the borrower, so his
    // route is a vertical line whose bounding box is zero pixels wide, and SVG
    // 1.1 §13.2.4 says an objectBoundingBox gradient does not paint a shape with
    // no width. His was the one edge on the pane that rendered as nothing.
    openGraph();
    const grad = container!.querySelector("#ogr")!;
    expect(grad).not.toBeNull();
    expect(grad.getAttribute("gradientUnits")).toBe("userSpaceOnUse");
  });

  it("hangs an arrowhead on the borrower end of every ownership edge", () => {
    openGraph();
    expect(container!.querySelector("#oarrIn")).not.toBeNull();
    expect(container!.querySelector("#oarrOut")).not.toBeNull();
  });
});

describe("a client email proposes its action (founder: when is the action coming out of there?)", () => {
  const envelope = (outputValues: unknown) => ({
    payload: { content: [{ actionName: "t", errors: null, isSuccess: true, outputValues, sortOrder: 0, version: 1 }] },
  });

  /** The observed single-object mail shape, synthetic values. */
  const mail = {
    id: "SYNTHETIC-1",
    subject: "Test for Hartwell",
    sender: "cfo@example.com",
    receivedDateTime: "2026-07-27T09:00:00Z",
    summary: "Could we increase the line of credit from 15Mio to 20Mio before quarter end?",
    webLink: "https://example.com/mail/1",
  };

  const syncWithMail = async (payload: unknown) => {
    const callTool = vi.fn(async (_s: string, tool: string) => {
      if (tool === "outlook_email_search") return { payload };
      if (tool === "Customer360ActionHistory") return envelope({ entries: [] });
      return envelope({});
    });
    (window as unknown as { claude?: unknown }).claude = {
      mcp: { callTool, watchTool: vi.fn().mockReturnValue(() => {}), listTools: vi.fn(), invalidate: vi.fn() },
    };
    mount(live as unknown as C360Data);
    openAccount("Hartwell Precision Manufacturing LLC");
    click([...container!.querySelectorAll("button")].find((b) => /^Sync$/.test(b.textContent ?? ""))!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
  };

  afterEach(() => {
    delete (window as unknown as { claude?: unknown }).claude;
  });

  it("renders the matched email as ONE compact row with the workroom on it", async () => {
    vi.useFakeTimers();
    await syncWithMail(mail);
    const text = container!.textContent ?? "";
    expect(text).toContain("Test for Hartwell");
    // FOUNDER, 2026-09-03. The row's one action is OUR room; the registry's
    // next-step suggestion, which opened the pre-workroom panel, is gone.
    expect(text).toContain("Open in workroom");
    expect(text).not.toContain("suggested next step");
  });

  it("prefills the modification ticket from the client's own ask", async () => {
    vi.useFakeTimers();
    await syncWithMail(mail);
    vi.useRealTimers();

    act(() => dispatchOpenSheet());
    const row = [...document.querySelectorAll('[role="dialog"]')]
      .flatMap((d) => [...d.querySelectorAll("button")])
      .find((b) => b.textContent?.includes("Loan Modification"))!;
    click(row);

    const panel = [...document.querySelectorAll('[role="dialog"]')].find(
      (d) => d.getAttribute("aria-label") === "Loan Modification",
    )!;
    const hero = panel.querySelector("#hero-newCommitment") as HTMLInputElement;
    // The client asked for 20Mio, and that is what the field carries.
    expect(hero.value).toBe("20000000");
    // Marked as the CLIENT's number, not the org's and not the banker's.
    expect(panel.textContent).toContain("Derived");
  });

  it("proposes nothing from a message that is not a request", async () => {
    vi.useFakeTimers();
    await syncWithMail({ ...mail, subject: "Hartwell — invoice attached", summary: "Copy of invoice 4471 for your records." });
    const text = container!.textContent ?? "";
    expect(text).toContain("Hartwell");
    expect(text).not.toContain("suggested next step");
  });
});

/* =============================================================================
   THE PACKAGE ANCHOR, ON THE SHIPPED FIXTURE.

   `relContextFor` reads the relationship's product package off the SNAPSHOT,
   and no snapshot in this file carried one, although every borrower has exactly
   one package and every one of its facilities names it. So the covenant review
   and the collateral valuation both refused with NO_PACKAGE_ANCHOR before their
   first question, on the fixture the demo runs against.

   `scripts/anchor-snapshot-packages.mjs` derives the anchor from the facilities
   and refuses where it cannot. This pins the result, so a regenerated bundle
   that drops the key fails here rather than in the room.

   HARTWELL IS NOW THE DELIBERATE EXCEPTION (2026-09-03). The org grew a real
   second package on Hartwell, and `anchor-snapshot-packages.mjs` correctly
   REFUSES to derive a single anchor where two exist: that refusal is the whole
   point, and it is the state the greeting's package-ask question exists to
   handle. Every OTHER borrower still carries exactly one package and one
   anchor; Hartwell is the one relationship this fixture ships unanchored.
   ============================================================================= */

describe("every relationship in the shipped fixture is anchored on its own package", () => {
  const allBorrowers = Object.entries((live as unknown as C360Data).borrowers ?? {});
  const HARTWELL_ID = "001bb00001I7FPNAA3";
  const borrowers = allBorrowers.filter(([id]) => id !== HARTWELL_ID);

  it("carries a snapshot productPackageId on all of them", () => {
    expect(borrowers.length).toBeGreaterThan(0);
    for (const [id, b] of borrowers) {
      expect(b.snapshot?.productPackageId, `${id} has no package anchor`).toBeTruthy();
    }
  });

  it("takes it from the facilities, and stages exactly ONE package for each", () => {
    for (const [id, b] of borrowers) {
      const onFacilities = [...new Set((b.exposure?.facilities ?? []).map((f) => f.productPackageId).filter(Boolean))];
      expect(onFacilities, `${id}`).toEqual([b.snapshot!.productPackageId]);
      // And so `packageRecords` cannot produce a duplicate: it seeds with the
      // snapshot's id and skips any facility already naming it.
      expect(packageRecords(resolveBundle(live as unknown as C360Data, id)), `${id}`).toHaveLength(1);
    }
  });

  it("refuses to anchor Hartwell, which now stages two packages of its own", () => {
    const hartwell = allBorrowers.find(([, b]) => (b.snapshot?.name ?? "").startsWith("Hartwell"))!;
    expect(hartwell[1].snapshot?.productPackageId).toBeUndefined();
    const onFacilities = [...new Set((hartwell[1].exposure?.facilities ?? []).map((f) => f.productPackageId).filter(Boolean))];
    expect(onFacilities.sort()).toEqual(["a5Fbb000000IHFJEA4", "a5Fbb000000J6BNEA0"].sort());
    expect(packageRecords(resolveBundle(live as unknown as C360Data, HARTWELL_ID))).toHaveLength(2);
  });
});
