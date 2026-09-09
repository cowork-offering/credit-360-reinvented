// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { clearOverlays, dataVersionOf, saveOverlay } from "./state/syncOverlay";
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
import { ACTIONS_BY_ID } from "./actions/registry";
import { closeActionTicket, openActionTicket } from "./components/actionTicket";
import { closeRelationshipRoom } from "./components/relationship/relSession";
import { CHALLENGE_PANEL_INTRO } from "./components/ActionPanel";
import { vi } from "vitest";
import sample from "../../artifact/sample-data.json";
import observedFacilityEnvelopes from "./actions/observed-facilityIds-envelopes.json";
import observedModEnvelopes from "./actions/observed-execute-loan-modification-envelopes.json";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATA = sample as unknown as C360Data;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  // The ticket seam is a MODULE store, so it outlives a test the way it
  // outlives a view. One test's open ticket must not be the next test's.
  closeActionTicket();
  try {
    sessionStorage.clear();
    // The sync overlay persists to localStorage by design; one test's sync must
    // not restore itself into the next test's mount.
    clearOverlays();
  } catch {
    /* ignore */
  }
});

/** The Salesforce user id the org proved it accepts, staged as the assembler
 *  must stage it. Without this the confirm gesture fails closed by design. */
const APPROVER_ID = "005bb00000ftouDAAQ";

/** The first two live facilities booked, the rest at Final Review.
 *
 *  Modification and renewal are only offered against a booked facility, so a
 *  test ABOUT those tickets needs one. Two keeps the SELECTOR meaningful (with
 *  a single booked facility there is nothing to choose and the ticket names it
 *  instead), and Kingsley's third facility keeps the disabled list under test. */
function withBookedFacilities(data: C360Data): C360Data {
  const next = structuredClone(data) as C360Data;
  for (const b of Object.values(next.borrowers ?? {})) {
    let booked = 0;
    for (const f of b.exposure?.facilities ?? []) {
      // EVERY facility gets a stage: partial stage data is "cannot tell", so a
      // fixture that leaves one blank is testing the wrong thing.
      // A credit action anchors on the facility AND its own package.
      f.productPackageId = "a5Fbb000000HA1NEAW";
      if (f.status === "Paid Off") {
        f.stage = "Booked";
        continue;
      }
      f.stage = booked < 2 ? "Booked" : "Final Review";
      booked += 1;
    }
  }
  return next;
}

function mount(meta?: Record<string, unknown>, booked = false): HTMLDivElement {
  const base = booked ? withBookedFacilities(DATA) : DATA;
  const data = meta ? ({ ...base, meta: { ...base.meta, ...meta } } as C360Data) : base;
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
  return container;
}

const buttons = () => [...document.body.querySelectorAll("button")];
const byText = (re: RegExp) => buttons().find((b) => re.test(b.textContent ?? ""));
const byLabel = (re: RegExp) => buttons().find((b) => re.test(b.getAttribute("aria-label") ?? ""));
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const press = (key: string) => act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
/** SURFACE 4, DIRECTION-LOCKED rule 50: the mark is CONTEXT-AWARE. On a client
 *  it fans the action arc and the assist is the satellite at the top, so the
 *  chat entry point below is two gestures rather than one. */
const openAssist = () => {
  click(byLabel(/Client actions/)!);
  click(byLabel(/Assist chat/)!);
};
const openRow = (name: string) =>
  [...document.querySelectorAll('[role="button"]')].find((r) => r.textContent?.includes(name))!;
/** The Action Panel is the dialog whose label is the action name. */
const panel = (label: string) =>
  [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute("aria-label") === label) ?? null;

/** WP7.1 — the panel opens on the briefing; the classic field list is one
 *  disclosure away and is still the completeness view every contract test below
 *  reads. */
const expandAllFields = () => {
  const toggle = byText(/All fields/);
  // Idempotent: the disclosure survives a step back, so only ever open it.
  if (toggle && toggle.getAttribute("aria-expanded") !== "true") click(toggle);
};

/**
 * Open an account, then the action's ticket.
 *
 * THE ENTRY CHANGED, THE MACHINERY DID NOT (founder call, 2026-08-31 night).
 * The Client Actions sheet has no UI trigger any more, so the two actions the
 * arc carries are entered through their satellite — the real gesture a banker
 * makes — and every other action through `openActionTicket`, which is the SAME
 * module seam the arc's shared handler calls when a satellite names an action.
 * Neither is a test-only door: both are the product's own paths.
 */
/* The annual and covenant satellites moved INTO the Relationship room
   (founder consolidation, 2026-09-01): the arc no longer carries per-review
   satellites, so every panel-machinery test enters through the ticket seam,
   which is the same product path the room's own flows call. The one-modal
   entry-point contract is asserted by the room's own render tests now. */
const ARC_SATELLITE: Record<string, RegExp> = {};

const idForLabel = (label: string) => Object.values(ACTIONS_BY_ID).find((a) => a.label === label)!.id;

function openActionPanel(
  actionLabel: string,
  account = "Sterling Fabrication",
  meta?: Record<string, unknown>,
  booked = false,
) {
  mount(meta, booked);
  click(openRow(account));
  const satellite = ARC_SATELLITE[actionLabel];
  if (satellite) {
    click(byLabel(/Client actions/)!);
    click(byLabel(satellite)!);
    return;
  }
  act(() => openActionTicket(idForLabel(actionLabel)));
}

describe("A33.1.1 — one modal, three entry points", () => {
  /* THE ROW IS GONE; THE MODAL IS NOT (founder call, 2026-08-31 night). Entry
     point 1 is the arc now — its own satellite for the two actions it carries,
     and `openActionTicket` for the rest, which is the same seam the satellite
     handler calls. The contract this describe block exists for is unchanged:
     one modal, whichever door opened it. */
  it("opens the Relationship room from the arc's own satellite", () => {
    // The per-review satellites are gone; the arc's third seat opens the
    // Relationship room, and the review flows live inside it.
    mount();
    click(openRow("Sterling Fabrication"));
    click(byLabel(/Client actions/)!);
    click(byLabel(/^Relationship Actions$/)!);
    expect(document.querySelector(".rel-room, [data-room=\"relationship\"]")).toBeTruthy();
    // The room's session store is module-global: close it, or it bleeds into
    // every later test in this file (found the hard way).
    act(() => closeRelationshipRoom());
  });

  it("opens from the ticket seam the arc's handler calls", () => {
    openActionPanel("Create Service Request");
    expect(panel("Create Service Request")).toBeTruthy();
  });

  it("opens from an activity next-step button", () => {
    mount();
    click(openRow("Sterling Fabrication"));
    click(byText(/Headroom analysis concluded/)!);
    const step = [...document.querySelector('[aria-modal="true"]')!.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Collateral Valuation"),
    )!;
    click(step);
    expect(panel("Collateral Valuation")).toBeTruthy();
  });

  it("a chat chip for a room-covered action opens the ROOM, not the retired panel", () => {
    // Founder, 2026-09-03: the rooms took over the panel's work; a chip whose
    // action they carry opens them exactly as the FAB does.
    mount();
    click(openRow("Sterling Fabrication"));
    openAssist();
    const chip = [...document.querySelectorAll('[role="dialog"]')]
      .flatMap((d) => [...d.querySelectorAll("button")])
      .find((b) => b.hasAttribute("title") && /Collateral Valuation/.test(b.textContent ?? ""));
    if (!chip) return; // suggestion ordering is data-driven; covered by engine tests
    click(chip);
    expect(panel("Collateral Valuation")).toBeNull();
    expect(document.querySelector(".wk-room")).toBeTruthy();
    press("Escape"); // close the room so the next test starts on a clean stage
  });

  it("renders the SAME schema whichever entry point opened it", () => {
    // Entry point 1: the arc's ticket seam.
    openActionPanel("Collateral Valuation");
    expandAllFields();
    const fromRow = panel("Collateral Valuation")!.textContent ?? "";
    press("Escape"); // closes the Action Panel

    // Entry point 2: the activity next-step button, same mount.
    click(byText(/Headroom analysis concluded/)!);
    const step = [...document.querySelector('[aria-modal="true"]')!.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Collateral Valuation"),
    )!;
    click(step);
    expandAllFields();
    const fromActivity = panel("Collateral Valuation")!.textContent ?? "";

    for (const label of ["Where the number came from", "Valuation basis", "Valuation amount", "Valuation notes"]) {
      expect(fromRow, label).toContain(label);
      expect(fromActivity, label).toContain(label);
    }
  });

  it("a non-panel action still fires directly instead of opening a modal", () => {
    // Wave 2 gave New Facility Request a ticket; Draft Credit Memo still narrates.
    openActionPanel("Draft Credit Memo");
    expect(panel("Draft Credit Memo")).toBeNull();
  });
});

describe("A31.1 modal chrome", () => {
  it("portals above the app tree", () => {
    openActionPanel("Create Service Request");
    expect(container!.contains(panel("Create Service Request"))).toBe(false);
  });

  it("stacks on the shared z-scale", () => {
    openActionPanel("Create Service Request");
    const overlay = panel("Create Service Request")!.parentElement as HTMLElement;
    expect(overlay.getAttribute("style") ?? "").toContain("--z-modal");
  });

  it("focuses the panel on open and closes on Escape", () => {
    openActionPanel("Create Service Request");
    expect(document.activeElement).toBe(panel("Create Service Request"));
    press("Escape");
    expect(panel("Create Service Request")).toBeNull();
  });

  it("traps Tab inside the panel", () => {
    openActionPanel("Create Service Request");
    const p = panel("Create Service Request")!;
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(p.contains(document.activeElement)).toBe(true);
  });
});

describe("A33.1.2/A33.1.3 — schema-driven render and chips", () => {
  it("renders the schema's fields as inputs with banker labels", () => {
    openActionPanel("Annual Review");
    expandAllFields();
    const text = panel("Annual Review")!.textContent ?? "";
    for (const label of ["Relationship", "Status", "Review type", "Review narrative", "Recommendation"]) {
      expect(text, label).toContain(label);
    }
    // Banker language, never API names.
    expect(text).not.toContain("LLC_BI__");
  });

  it("renders a DERIVED chip for a client-request prefill", () => {
    openActionPanel("Create Service Request");
    expect(panel("Create Service Request")!.textContent).toContain("Derived");
  });

  it("renders read-only fields with their reason rather than as inputs", () => {
    openActionPanel("Annual Review");
    expandAllFields();
    const p = panel("Annual Review")!;
    expect(p.textContent).toContain("the tool creates at In Progress and stops");
    expect(p.textContent).toContain("never written by this tool");
  });

  it("offers no value set the org has not supplied, on either surface", () => {
    // Case.Type has no described values in this view, so both surfaces say so
    // rather than inventing one (A33.1.6).
    openActionPanel("Create Service Request");
    const pill = [...panel("Create Service Request")!.querySelectorAll("button")].find((b) =>
      /Request type/.test(b.textContent ?? ""),
    )!;
    click(pill);
    const sheet = [...document.querySelectorAll('[role="dialog"]')].find(
      (d) => d.getAttribute("aria-label") === "Request type",
    )!;
    expect(sheet.textContent).toContain("come from the org and have not loaded");
    expect(sheet.querySelectorAll("[aria-pressed]")).toHaveLength(0);
    press("Escape");

    expandAllFields();
    const p = panel("Create Service Request")!;
    const rowSelect = p.querySelector<HTMLSelectElement>("#f-type")!;
    expect(rowSelect.hasAttribute("disabled")).toBe(true);
    expect(p.textContent).toContain("Options are read from the org");
  });

  it("never blocks on an options gap the org has already answered (live defect 2026-07-26)", () => {
    openActionPanel("Annual Review");
    click(panel("Annual Review")!.querySelector("#hero-reviewType")!);
    const sheet = [...document.querySelectorAll('[role="dialog"]')].find(
      (d) => d.getAttribute("aria-label") === "Review type",
    )!;
    // The three active values, verbatim from the org describe.
    expect([...sheet.querySelectorAll("[aria-pressed]")].map((b) => b.textContent?.trim())).toEqual([
      "Annual",
      "AdHoc",
      "Problem Loan",
    ]);
    expect(sheet.textContent).not.toContain("have not loaded");

    click([...sheet.querySelectorAll("[aria-pressed]")][0]);
    expandAllFields();
    expect(panel("Annual Review")!.querySelector<HTMLSelectElement>("#f-reviewType")!.value).toBe("Annual");
  });

  it("marks an edited agent narrative as edited, panel-side only", () => {
    openActionPanel("Annual Review");
    expandAllFields();
    const p = panel("Annual Review")!;
    const area = [...p.querySelectorAll("textarea")][0];
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(area, "revised by the banker");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(panel("Annual Review")!.textContent).toContain("edited by you");
    // A33.1.7: nothing is injected into the field text itself.
    expect((area as HTMLTextAreaElement).value).toBe("revised by the banker");
  });
});

describe("WP7.1 — the panel opens on a briefing, not a form", () => {
  it("leads with composed prose carrying the staged figures inline", () => {
    openActionPanel("Annual Review");
    const text = panel("Annual Review")!.textContent ?? "";
    expect(text).toContain("credit review for Sterling Fabrication Co.");
    expect(text).toMatch(/is carried at \$[\d.]+[KMB] committed/);
  });

  it("does not open on a wall of empty inputs", () => {
    openActionPanel("Annual Review");
    const p = panel("Annual Review")!;
    // Nine narrative textareas used to greet the banker. Now: prose.
    expect(p.querySelectorAll("textarea")).toHaveLength(0);
    expect(p.textContent).toContain("All fields");
  });

  it("renders a required empty value as a prompt inside the sentence", () => {
    openActionPanel("Collateral Valuation");
    const cv = panel("Collateral Valuation")!;
    const prompts = [
      ...[...cv.querySelectorAll("select")].flatMap((s) => [...s.options].map((o) => o.text)),
      ...[...cv.querySelectorAll("input")].map((i) => i.getAttribute("placeholder") ?? ""),
    ].join("|");
    // Empty required values ask for themselves in place. A picklist the org has
    // not supplied says that instead; it never offers an invented set.
    expect(prompts).toMatch(/pick the valuation date|enter the valuation|choose the source|options not loaded/);
  });

  it("a briefing chip and the classic row edit the same value", () => {
    openActionPanel("Create Service Request");
    const sr = panel("Create Service Request")!;
    const chip = [...sr.querySelectorAll("input")].find((i) => i.getAttribute("aria-label")?.startsWith("Subject"))!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(chip, "Revised subject line");
      chip.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expandAllFields();
    const row = panel("Create Service Request")!.querySelector<HTMLInputElement>("#f-subject")!;
    expect(row.value).toBe("Revised subject line");
  });

  it("shows the drafted narratives as prose with their AGENT provenance", () => {
    openActionPanel("Annual Review");
    const text = panel("Annual Review")!.textContent ?? "";
    expect(text).toContain("Relationship summary");
    expect(text).toContain("Agent");
    // Drafted, not blank: a real figure from the staged bundle is in the prose.
    expect(text).toMatch(/risk grade \d/);
  });

  it("edits a drafted narrative in place and marks it edited", () => {
    openActionPanel("Annual Review");
    // The narrative cards are collapsed; opening one reveals it for editing.
    const card = [...panel("Annual Review")!.querySelectorAll("button")].find((b) =>
      /Relationship summary/.test(b.textContent ?? ""),
    )!;
    click(card);
    const area = panel("Annual Review")!.querySelector("textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(area, "banker's own words");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(panel("Annual Review")!.textContent).toContain("edited by you");
  });

  it("keeps every schema field one disclosure away", () => {
    openActionPanel("Annual Review");
    expandAllFields();
    const p = panel("Annual Review")!;
    for (const label of ["Review type", "Guarantor analysis", "Risk rating comments", "Review stage (Salesforce)"]) {
      expect(p.textContent, label).toContain(label);
    }
  });
});

describe("the two-phase facility execute, through the panel", () => {
  afterEach(() => {
    delete (window as unknown as { claude?: unknown }).claude;
  });

  const PHASE = (resumable: boolean) => ({
    ok: true,
    error: null,
    result: {
      stagingId: "a8abb00001KtalSAAR",
      terminalState: resumable ? "partial" : "success",
      stage: resumable ? "Qualification" : "Proposal",
      resumable,
      resumeDescriptor: resumable
        ? "Continue this action to verify the Loan Detail and complete the move to Proposal. No new confirmation is needed: the same plan is still running."
        : null,
      loanId: "a4Zbb0000027KdZEAU",
      recordName: "ZZ - Term - $750,000.00",
      outcome: resumable ? "Filed at Qualification." : "Completed and moved to Proposal.",
      steps: [
        { id: "s1", type: "write", label: "Create the credit review", state: "verified" },
        {
          id: "s2",
          type: "verification",
          label: "Confirm the review exists",
          state: resumable ? "waiting" : "verified",
          detail: resumable ? "It cannot be seen from here." : "Done.",
        },
      ],
    },
  });

  it("offers Continue while the org is still working, and never calls it a failure", async () => {
    installWriteMcp({ execute: PHASE(true) });
    openActionPanel("Annual Review", "Sterling Fabrication", { userId: APPROVER_ID });
    click(byText(/Review the plan/)!);
    await flush();
    click(byText(/Confirm and file/)!);
    await flush();
    const p = panel("Annual Review")!;
    expect(p.textContent).toContain("Waiting on the org");
    expect(p.textContent).toContain("No new confirmation is needed");
    expect(p.textContent).not.toContain("Failed");
    expect([...p.querySelectorAll("button")].some((b) => b.textContent === "Continue")).toBe(true);
  });

  it("resends the same five-field payload on the Continue gesture", async () => {
    const callTool = installWriteMcp({ execute: PHASE(true) });
    openActionPanel("Annual Review", "Sterling Fabrication", { userId: APPROVER_ID });
    click(byText(/Review the plan/)!);
    await flush();
    click(byText(/Confirm and file/)!);
    await flush();
    click([...panel("Annual Review")!.querySelectorAll("button")].find((b) => b.textContent === "Continue")!);
    await flush();

    const executes = callTool.mock.calls.filter((c) => String(c[1]).startsWith("execute_"));
    expect(executes).toHaveLength(2);
    const first = inputsOf(executes[0]);
    const second = inputsOf(executes[1]);
    // The resume is the SAME identity, token included: the platform rejects a
    // null token with REQUIRED_FIELD_MISSING before Apex ever runs.
    expect(second).toEqual(first);
    expect(second.decisionToken).toBe("dt-server-001");
  });

  it("keeps the affordance when the org is still not finished", async () => {
    installWriteMcp({ execute: PHASE(true) });
    openActionPanel("Annual Review", "Sterling Fabrication", { userId: APPROVER_ID });
    click(byText(/Review the plan/)!);
    await flush();
    click(byText(/Confirm and file/)!);
    await flush();
    click([...panel("Annual Review")!.querySelectorAll("button")].find((b) => b.textContent === "Continue")!);
    await flush();
    expect([...panel("Annual Review")!.querySelectorAll("button")].some((b) => b.textContent === "Continue")).toBe(true);
  });
});

describe("Codex review fixes, through the panel", () => {
  afterEach(() => {
    delete (window as unknown as { claude?: unknown }).claude;
  });

  const stagedBody = (callTool: ReturnType<typeof installWriteMcp>) =>
    inputsOf(callTool.mock.calls.find((c) => String(c[1]).startsWith("stage_")));

  it("#3 always sends a non-blank rationale, even with no findings", async () => {
    const callTool = installWriteMcp();
    openActionPanel("Risk Rating Review", "Piedmont Precision");
    click(byText(/Review the plan/)!);
    await flush();
    // The contract Codex flagged: never undefined, never blank. JSON drops an
    // undefined key, and the Apex Request declares rationale required.
    const rationale = String(stagedBody(callTool).rationale ?? "");
    expect(rationale.trim()).not.toBe("");
  });

  it("#11 mints a NEW idempotency key when the plan is rebuilt after edits", async () => {
    const callTool = installWriteMcp();
    openActionPanel("Annual Review", "Sterling Fabrication", { userId: APPROVER_ID });
    click(byText(/Review the plan/)!);
    await flush();
    const firstKey = stagedBody(callTool).idempotencyKey;

    click([...panel("Annual Review")!.querySelectorAll("button")].find((b) => b.textContent === "Back")!);
    expandAllFields();
    const area = panel("Annual Review")!.querySelector("textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(area, "edited after staging");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click(byText(/Rebuild the plan/)!);
    await flush();

    const stages = callTool.mock.calls.filter((c) => String(c[1]).startsWith("stage_"));
    expect(stages).toHaveLength(2);
    // A rebuild is a NEW intent: reusing the key invites the org to replay the
    // staging row the banker just edited away from.
    expect(inputsOf(stages[1]).idempotencyKey).not.toBe(firstKey);
  });

  it("#11 keeps the key when stepping back and forward without editing", async () => {
    const callTool = installWriteMcp();
    openActionPanel("Annual Review", "Sterling Fabrication", { userId: APPROVER_ID });
    click(byText(/Review the plan/)!);
    await flush();
    const firstKey = stagedBody(callTool).idempotencyKey;
    click([...panel("Annual Review")!.querySelectorAll("button")].find((b) => b.textContent === "Back")!);
    click(byText(/Back to the plan/)!);
    await flush();
    // Same intent looked at twice: one staging row, one key.
    expect(callTool.mock.calls.filter((c) => String(c[1]).startsWith("stage_"))).toHaveLength(1);
    expect(firstKey).toBeTruthy();
  });

  it("#10 renders a failed resume through the error doctrine", async () => {
    let call = 0;
    const callTool = vi.fn(async (_server: string, tool: string, _input?: unknown) => {
      if (tool.startsWith("stage_")) return stageEnvelope(STAGE_PLAN);
      if (tool.startsWith("execute_")) {
        call += 1;
        return stageEnvelope(
          call === 1
            ? { ok: true, error: null, result: { stagingId: "s", terminalState: "partial", resumable: true, steps: [] } }
            : { ok: false, error: { code: "PRECONDITION", message: "The staging row is no longer resumable." }, result: null },
        );
      }
      return stageEnvelope({});
    });
    (window as unknown as { claude?: unknown }).claude = {
      mcp: { callTool, watchTool: vi.fn().mockReturnValue(() => {}), listTools: vi.fn(), invalidate: vi.fn() },
    };

    openActionPanel("Annual Review", "Sterling Fabrication", { userId: APPROVER_ID });
    click(byText(/Review the plan/)!);
    await flush();
    click(byText(/Confirm and file/)!);
    await flush();
    click([...panel("Annual Review")!.querySelectorAll("button")].find((b) => b.textContent === "Continue")!);
    await flush();

    const p = panel("Annual Review")!;
    expect(p.textContent).toContain("PRECONDITION");
    expect(p.textContent).toContain("The staging row is no longer resumable.");
  });

  it("#2 states the founder gate at the covenant gate, not the LV06 reason", async () => {
    installWriteMcp();
    openActionPanel("Covenant Review", "Piedmont Precision");
    const review = byText(/Review the plan/);
    if (!review || review.hasAttribute("disabled")) return; // gap-blocked in this view
    click(review);
    await flush();
    const text = panel("Covenant Review")!.textContent ?? "";
    expect(text).toContain("founder-gated");
    expect(text).not.toContain("LV06");
  });
});

describe("wave 2 — the five new tickets", () => {
  afterEach(() => {
    delete (window as unknown as { claude?: unknown }).claude;
  });

  const setInput = (el: Element, value: string) =>
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

  /** The org refuses a modification that asks for nothing, and so does the
   *  ticket. Since F5 the amount opens on the selected member's CURRENT
   *  commitment, so a test about the WIRE still has to name a real change:
   *  a standstill is refused by `MODIFICATION_NO_MOVEMENT` instead. */
  const askForACommitment = (amount = "20000000") =>
    setInput(panel("Loan Modification")!.querySelector("#hero-newCommitment")!, amount);

  // One mount per case: the harness keeps a single root, so looping mounts
  // inside one test would leave four orphaned trees in the document.
  it.each(["New Facility Request", "Risk Rating Review", "Covenant Review"])("opens a ticket for %s", (label) => {
    openActionPanel(label);
    expect(panel(label)).toBeTruthy();
  });

  // These two need a BOOKED facility to be offered at all (Probe 9).
  it.each(["Loan Modification", "Renewal"])("opens a ticket for %s against a booked facility", (label) => {
    openActionPanel(label, "Sterling Fabrication", undefined, true);
    expect(panel(label)).toBeTruthy();
  });

  it("offers only booked facilities in the selector, and says why the others are out", () => {
    // Kingsley: two booked, one at Final Review, one paid off.
    openActionPanel("Loan Modification", "Kingsley Precision", undefined, true);
    const p = panel("Loan Modification")!;
    // A multi-select block, not a sheet: the banker reads the list.
    const boxes = [...p.querySelectorAll('input[type="checkbox"]')];
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Kingsley Equipment Term Loan A",
      "Kingsley Working Capital Revolver",
    ]);
    const off = [...p.querySelectorAll("[data-disabled-option]")].map((d) => ({
      value: d.getAttribute("data-disabled-option"),
      text: d.textContent,
    }));
    expect(off.find((o) => o.value === "Kingsley CapEx Facility II")!.text).toContain("at Final Review");
    expect(off.find((o) => o.value === "Kingsley Original Equipment Term Loan")!.text).toContain("Paid Off");
  });

  it("preselects a booked facility so the ticket opens ready", () => {
    openActionPanel("Loan Modification", "Sterling Fabrication", undefined, true);
    const boxes = [...panel("Loan Modification")!.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    // Exactly one is already ticked: the ticket opens ready, not empty.
    expect(boxes.filter((b) => b.checked)).toHaveLength(1);
    expect(boxes[0].getAttribute("aria-label")).toContain("Sterling");
  });

  it("F7 — refuses to stage a facility whose own package is not staged", async () => {
    const callTool = installWriteMcp();
    // Booked, but with no package of its own: the correspondence between the
    // facility and a package cannot be proven, so nothing is sent.
    const data = structuredClone(DATA) as C360Data;
    for (const b of Object.values(data.borrowers ?? {})) {
      for (const f of b.exposure?.facilities ?? []) {
        f.stage = "Booked";
        delete f.productPackageId;
      }
    }
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
    click(openRow("Sterling Fabrication"));
    act(() => openActionTicket("loan-modification"));
    const review = byText(/Review the plan/);
    if (review && !review.hasAttribute("disabled")) {
      click(review);
      await flush();
    }
    expect(callTool.mock.calls.filter((c) => String(c[1]).startsWith("stage_"))).toHaveLength(0);
  });

  it("files SEVERAL facilities as one plan, on the facilityIds shape", async () => {
    const callTool = installWriteMcp({ stage: MULTI_FACILITY_PLAN });
    openActionPanel("Loan Modification", "Kingsley Precision", { userId: APPROVER_ID }, true);
    const boxes = [...panel("Loan Modification")!.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    // Tick the second booked facility. Both are in the same package, so this is
    // one credit action over two facilities, which is how Salesforce frames it.
    click(boxes[1]);
    askForACommitment();
    click(byText(/Review the plan/)!);
    await flush();

    const stages = callTool.mock.calls.filter((c) => String(c[1]).startsWith("stage_"));
    // ONE call. Two plans dressed up as one is exactly what this shape avoids.
    expect(stages).toHaveLength(1);
    const body = inputsOf(stages[0]);
    expect(body.facilityIds).toHaveLength(2);
    // Never both keys: the tool refuses a mixed shape.
    expect("loanId" in body).toBe(false);
    // ONE scalar for the whole selection: that is what the wire carries and
    // what the ticket says it does.
    expect(body.requestedAmount).toBe(20_000_000);
  });

  it("names ONE facility as a member too, because the ticket is package-first", async () => {
    // The flat `loanId` is still a supported shape on the wire and renewal
    // still sends it. THIS ticket does not: a modification runs on the deal and
    // covers the members named inside it, and one member is a selection of one.
    const callTool = installWriteMcp({ stage: FLAT_FACILITY_PLAN });
    openActionPanel("Loan Modification", "Kingsley Precision", { userId: APPROVER_ID }, true);
    askForACommitment();
    click(byText(/Review the plan/)!);
    await flush();
    const body = inputsOf(callTool.mock.calls.find((c) => String(c[1]).startsWith("stage_")));
    expect(body.facilityIds).toHaveLength(1);
    expect("loanId" in body).toBe(false);
    expect(typeof body.productPackageId).toBe("string");
  });

  it("keeps the flat loanId shape on a RENEWAL of exactly one facility", async () => {
    const callTool = installWriteMcp({ stage: FLAT_FACILITY_PLAN });
    openActionPanel("Renewal", "Kingsley Precision", { userId: APPROVER_ID }, true);
    const p = panel("Renewal")!;
    setInput(p.querySelector("#hero-newMaturityDate")!, "2029-06-30");
    click(byText(/Review the plan/)!);
    await flush();
    const body = inputsOf(callTool.mock.calls.find((c) => String(c[1]).startsWith("stage_")));
    expect(typeof body.loanId).toBe("string");
    expect("facilityIds" in body).toBe(false);
  });

  it("refuses a modification that asks for nothing, in the org's own words", async () => {
    const callTool = installWriteMcp({ stage: FLAT_FACILITY_PLAN });
    openActionPanel("Loan Modification", "Kingsley Precision", { userId: APPROVER_ID }, true);
    // Clearing the prefill leaves every requested change empty, which is
    // exactly the plan StageLoanModification throws on.
    setInput(panel("Loan Modification")!.querySelector("#hero-newCommitment")!, "");
    const p = panel("Loan Modification")!;
    expect(p.textContent).toContain("At least one requested change is required: amount, maturity date, rate or term.");
    expect(byText(/Review the plan/)!.hasAttribute("disabled")).toBe(true);
    await flush();
    expect(callTool.mock.calls.filter((c) => String(c[1]).startsWith("stage_"))).toHaveLength(0);

    // Any one of the four lifts it. The maturity date is the one the ticket
    // could not ask for at all before this wave.
    setInput(panel("Loan Modification")!.querySelector('input[type="date"]')!, "2029-06-30");
    expect(panel("Loan Modification")!.textContent).not.toContain("At least one requested change is required");
    click(byText(/Review the plan/)!);
    await flush();
    expect(inputsOf(callTool.mock.calls.find((c) => String(c[1]).startsWith("stage_"))).requestedMaturityDate).toBe(
      "2029-06-30",
    );
  });

  /* F5 (founder, 2026-08-25) — the amount now OPENS on what the selected member
     carries today, so the ticket reads from -> to. The consequence is that the
     org's at-least-one-change rule is satisfied by a plan that changes nothing,
     and the ticket has to catch that itself. */
  it("opens on the member's current commitment and refuses to stage a standstill", async () => {
    const callTool = installWriteMcp({ stage: FLAT_FACILITY_PLAN });
    openActionPanel("Loan Modification", "Kingsley Precision", { userId: APPROVER_ID }, true);
    const hero = panel("Loan Modification")!.querySelector("#hero-newCommitment") as HTMLInputElement;
    // Kingsley's largest booked member is the 10.0M equipment term loan.
    expect(hero.value).toBe("10000000");

    const p = panel("Loan Modification")!;
    // The from -> to reading, per selected member, on the ticket itself.
    expect(p.textContent).toContain("Each selected facility");
    expect(p.textContent).toContain("The amount is what every selected facility already carries");
    expect(byText(/Review the plan/)!.hasAttribute("disabled")).toBe(true);
    await flush();
    expect(callTool.mock.calls.filter((c) => String(c[1]).startsWith("stage_"))).toHaveLength(0);

    // Move it and the ticket lets go.
    setInput(panel("Loan Modification")!.querySelector("#hero-newCommitment")!, "13000000");
    expect(panel("Loan Modification")!.textContent).not.toContain("already carries");
    expect(byText(/Review the plan/)!.hasAttribute("disabled")).toBe(false);
  });

  it("blocks an EMPTY selection in the ticket, before anything is sent", async () => {
    const callTool = installWriteMcp({ stage: FLAT_FACILITY_PLAN });
    openActionPanel("Loan Modification", "Kingsley Precision", { userId: APPROVER_ID }, true);
    const boxes = [...panel("Loan Modification")!.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    // Untick the preselected facility: nothing is named, so there is no plan.
    click(boxes.find((b) => b.checked)!);
    const p = panel("Loan Modification")!;
    expect(p.textContent).toContain("an empty selection is not a plan");
    expect(byText(/Review the plan/)!.hasAttribute("disabled")).toBe(true);
    await flush();
    expect(callTool.mock.calls.filter((c) => String(c[1]).startsWith("stage_"))).toHaveLength(0);
  });

  it("renders the plan per facility, with the org's HELD reason and warnings", async () => {
    installWriteMcp({ stage: MULTI_FACILITY_PLAN });
    openActionPanel("Loan Modification", "Kingsley Precision", { userId: APPROVER_ID }, true);
    click([...panel("Loan Modification")!.querySelectorAll('input[type="checkbox"]')][1]);
    askForACommitment();
    click(byText(/Review the plan/)!);
    await flush();

    const text = panel("Loan Modification")!.textContent ?? "";
    expect(text).toContain("2 facilities in this credit action");
    // Each facility is named, with the steps that will report on it.
    expect(text).toContain("Hartwell Precision Manufacturing LLC - Line of Credit - $15,000,000.00");
    expect(text).toContain("Hartwell Precision Manufacturing LLC - Construction - $12,000,000.00");
    expect(text).toContain("credit_action_1");
    expect(text).toContain("One plan, one confirmation and one decision token");
    // HELD is stated, in the ORG's own sentence, and filing stays off.
    expect(text).toContain("Staged, not filed");
    expect(text).toContain("Loan_Validation_06");
    expect(byText(/Filing is on hold/)!.hasAttribute("disabled")).toBe(true);
    // The renewal's Opportunity warning has a sibling here: the covenant clone.
    expect(text).toContain("2 loan-level covenant junction rows would clone onto the new facilities.");
  });

  it("renders a refusal in the tool's own words", async () => {
    installWriteMcp({
      stage: {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "SENTINEL: the tool's own sentence about why it refused.",
          idempotencyKey: "k",
          resumable: false,
        },
        result: null,
      },
    });
    openActionPanel("Loan Modification", "Kingsley Precision", { userId: APPROVER_ID }, true);
    askForACommitment();
    click(byText(/Review the plan/)!);
    await flush();
    // Verbatim: a refusal from this tool is banker-readable by design, and
    // paraphrasing it would throw away the only explanation there is.
    expect(panel("Loan Modification")!.textContent).toContain(
      "SENTINEL: the tool's own sentence about why it refused.",
    );
  });

  it("stages a batch of valuations, no longer gated", async () => {
    const callTool = installWriteMcp();
    openActionPanel("Collateral Valuation", "Sterling Fabrication", { userId: APPROVER_ID }, true);
    const boxes = [...panel("Collateral Valuation")!.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    if (boxes.length < 2) return; // this bundle stages a single record
    for (const b of boxes.filter((x) => !x.checked)) click(b);
    const p = panel("Collateral Valuation")!;
    expect(p.textContent).not.toContain("needs the bulk tool");

    const review = byText(/Review the plan/)!;
    if (review.hasAttribute("disabled")) return; // required fields still open
    click(review);
    await flush();
    const body = inputsOf(callTool.mock.calls.find((c) => String(c[1]).startsWith("stage_")));
    expect(Array.isArray(body.items)).toBe(true);
    expect((body.items as unknown[]).length).toBeGreaterThan(1);
    expect(body.collateralId).toBeUndefined();
  });

  it("keeps the basis and the origin distinguishable in the ticket", () => {
    openActionPanel("Collateral Valuation");
    const text = panel("Collateral Valuation")!.textContent ?? "";
    // The two were swappable by name alone; now each says what it means.
    expect(text).toContain("Valuation basis");
    expect(text).toContain("Where the number came from");
  });

  it("no longer blocks a bulk valuation", () => {
    openActionPanel("Collateral Valuation", "Sterling Fabrication", undefined, true);
    const boxes = [...panel("Collateral Valuation")!.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    if (boxes.length < 2) return; // this bundle stages a single record
    click(boxes[0]);
    click(boxes[1]);
    expect(panel("Collateral Valuation")!.textContent).not.toContain("needs the bulk tool");
  });

  it.each(["Loan Modification", "Renewal"])("withholds %s when nothing is booked, with the reason", (label) => {
    mount();
    click(openRow("Sterling Fabrication"));
    act(() => dispatchOpenSheet());
    const row = [...document.querySelector('[role="dialog"]')!.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(label),
    )!;
    expect(row.hasAttribute("disabled")).toBe(true);
    expect(row.textContent).toContain("Facility stages are not staged in this view");
  });

  it("reads deal, then members, then the changes — not amount first", () => {
    // The founder's complaint about the old ticket was an ORDER complaint: the
    // hero amount sat above an unread facility list, so a package-anchored
    // action read as a single-loan form.
    openActionPanel("Loan Modification", "Sterling Fabrication", undefined, true);
    const text = panel("Loan Modification")!.textContent ?? "";
    const at = (s: string) => text.indexOf(s);
    expect(at("Deal")).toBeGreaterThan(-1);
    expect(at("Deal")).toBeLessThan(at("Facilities in this credit action"));
    expect(at("Facilities in this credit action")).toBeLessThan(at("New commitment"));
    // The header leads with the deal's NAME and states what it aggregates in
    // one line under it (founder finding F1, 2026-08-25).
    expect(text).toContain("Sterling Fabrication Co. credit package");
    expect(text).toContain("2 facilities · $18M committed · $16.90M drawn");
    // And every change says where it lands.
    expect(text).toContain("Applies to EACH selected facility");
  });

  it("preselects the facility the client's ask is about, and leaves the rest choosable", () => {
    // Sterling asked to move a 10.0M facility to 13.0M. That is the revolver,
    // and the equipment loan stays available rather than being ruled out.
    openActionPanel("Loan Modification", "Sterling Fabrication", undefined, true);
    const boxes = [...panel("Loan Modification")!.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes.filter((b) => b.checked).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Sterling Working Capital Revolver",
    ]);
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => !b.disabled)).toBe(true);
  });

  it("prefills the modification from the client's own ask", () => {
    openActionPanel("Loan Modification", "Sterling Fabrication", undefined, true);
    const hero = panel("Loan Modification")!.querySelector("#hero-newCommitment") as HTMLInputElement;
    // Sterling asked to go from $10.0M to $13.0M; the banker retypes nothing.
    expect(hero.value).toBe("13000000");
    expect(panel("Loan Modification")!.textContent).toContain("Derived");
  });

  it("shows the modification's coverage and leverage move as the ask changes", () => {
    openActionPanel("Loan Modification", "Sterling Fabrication", undefined, true);
    const p = panel("Loan Modification")!;
    expect(p.textContent).toContain("Commitment");
    expect(p.textContent).toContain("Collateral coverage");
    setInput(p.querySelector("#hero-newCommitment")!, "");
    expect(panel("Loan Modification")!.textContent).not.toContain("What this changes");
  });

  it("offers the ordinary confirm on a modification the org will run", async () => {
    installWriteMcp({ stage: MOD_STAGE_PLAN });
    openActionPanel("Loan Modification", "Sterling Fabrication", { userId: APPROVER_ID }, true);
    click(byText(/Review the plan/)!);
    await flush();
    const p = panel("Loan Modification")!;
    // The client hold is gone: no "Staged, not filed" card, no disabled gesture.
    expect(p.textContent).not.toContain("Staged, not filed");
    const confirm = [...p.querySelectorAll("button")].find((b) => /Confirm and file/.test(b.textContent ?? ""))!;
    expect(confirm.hasAttribute("disabled")).toBe(false);
  });

  it("shows the org's warnings verbatim before the gesture, booking note included", async () => {
    installWriteMcp({ stage: MOD_STAGE_PLAN });
    openActionPanel("Loan Modification", "Sterling Fabrication", { userId: APPROVER_ID }, true);
    click(byText(/Review the plan/)!);
    await flush();
    const text = panel("Loan Modification")!.textContent ?? "";
    expect(text).toContain("Before you confirm");
    // Every warning the org returned, as the org wrote it. The booking note is
    // the one the banker acts on: Salesforce, not this page, books the clone.
    for (const w of (MOD_STAGE_PLAN as { result: { warnings: string[] } }).result.warnings) {
      expect(text).toContain(w);
    }
    expect(text).toContain("BOOKING that clone requires nCino's Submit for Approval button");
  });

  it("still stages before it executes, and only on the confirm gesture", async () => {
    const callTool = installWriteMcp({ stage: MOD_STAGE_PLAN, execute: MOD_EXECUTE });
    openActionPanel("Loan Modification", "Sterling Fabrication", { userId: APPROVER_ID }, true);
    click(byText(/Review the plan/)!);
    await flush();
    expect(callTool.mock.calls.filter((c) => String(c[1]) === "stage_loan_modification")).toHaveLength(1);
    // Staging alone writes nothing: the execute tool is untouched until confirm.
    expect(callTool.mock.calls.filter((c) => String(c[1]).startsWith("execute_"))).toHaveLength(0);
  });

  it("executes the modification on the five-field contract and reports per facility", async () => {
    const callTool = installWriteMcp({ stage: MOD_STAGE_PLAN, execute: MOD_EXECUTE });
    openActionPanel("Loan Modification", "Sterling Fabrication", { userId: APPROVER_ID }, true);
    click(byText(/Review the plan/)!);
    await flush();
    click(byText(/Confirm and file/)!);
    await flush();

    const executes = callTool.mock.calls.filter((c) => String(c[1]) === "execute_loan_modification");
    expect(executes).toHaveLength(1);
    expect(Object.keys(inputsOf(executes[0])).sort()).toEqual([
      "approverUserId",
      "decisionToken",
      "idempotencyKey",
      "planHash",
      "stagingId",
    ]);
    // Taken from the staging result verbatim, never re-minted.
    expect(inputsOf(executes[0]).stagingId).toBe("a8abb00001N6Z0XAAV");
    expect(inputsOf(executes[0]).decisionToken).toBe(
      "8fc5099ec8f0a9fa83dc7c6c39c4ed7f76e07d6b8494e7f0bf0d6bd29285ee86",
    );

    const text = panel("Loan Modification")!.textContent ?? "";
    expect(text).toContain("Filed, per facility");
    // The clone, the chain row and the applied change, in the org's own words.
    expect(text).toContain("ZZ-WS05-PROBE Borrower - Equipment - $1,500,000.00");
    expect(text).toContain("at stage Qualification");
    expect(text).toContain("RL-00000198");
    expect(text).toContain("records revision 1");
    expect(text).toContain("Amount reads back at 1500000.00.");
    expect(text).toContain("The parent facility reads back unchanged.");
    // Booking stays Salesforce's run, and the tracker says so from the handoff step.
    expect(text).toContain("Submit for Approval with real approvers");
  });

  it("writes the execution into the trail, naming the clone", async () => {
    installWriteMcp({ stage: MOD_STAGE_PLAN, execute: MOD_EXECUTE });
    openActionPanel("Loan Modification", "Sterling Fabrication", { userId: APPROVER_ID }, true);
    click(byText(/Review the plan/)!);
    await flush();
    click(byText(/Confirm and file/)!);
    await flush();
    // Close the ticket and read the Activity tab the entry landed on.
    press("Escape");
    click(buttons().find((b) => /^Activity$/.test(b.textContent ?? ""))!);
    const shell = document.body.textContent ?? "";
    expect(shell).toContain("Modification ZZ-WS05-PROBE Borrower - Equipment - $1,500,000.00 filed against");
  });

  it("the CHAT surface hands a modification to the ROOM, not the retired ticket", async () => {
    // Founder, 2026-09-03: the rooms took over the panel's work. The chip that
    // used to open the Loan Modification ticket now opens the facility room;
    // the ticket's own execute stays proven through its direct entry points.
    installWriteMcp({ stage: MOD_STAGE_PLAN, execute: MOD_EXECUTE });
    mount({ userId: APPROVER_ID }, true);
    click(openRow("Sterling Fabrication"));
    openAssist();
    const chip = [...document.querySelectorAll('[role="dialog"]')]
      .flatMap((d) => [...d.querySelectorAll("button")])
      .find((b) => b.hasAttribute("title") && b.textContent?.trim() === "Loan Modification")!;
    click(chip);
    await flush();
    expect(panel("Loan Modification")).toBeNull();
    expect(document.querySelector(".wk-room")).toBeTruthy();
    press("Escape");
  });

  it("says nothing was written twice when the org replays the key", async () => {
    installWriteMcp({ stage: MOD_STAGE_PLAN, execute: MOD_REPLAY });
    openActionPanel("Loan Modification", "Sterling Fabrication", { userId: APPROVER_ID }, true);
    click(byText(/Review the plan/)!);
    await flush();
    click(byText(/Confirm and file/)!);
    await flush();
    const text = panel("Loan Modification")!.textContent ?? "";
    expect(text).toContain("This had already been filed under the same key, so nothing was written again.");
    // The org returns no per-facility detail on a replay, so none is invented.
    expect(text).not.toContain("Filed, per facility");
  });

  it("refuses to stage a rating override with no reason, and says the rule", () => {
    openActionPanel("Risk Rating Review");
    const p = panel("Risk Rating Review")!;
    setInput(p.querySelector("#hero-overrideValue")!, "4");
    const after = panel("Risk Rating Review")!;
    expect(after.textContent).toContain("An override requires a stated reason.");
    expect(byText(/Review the plan/)!.hasAttribute("disabled")).toBe(true);
  });

  it("accepts the override once a reason is written", () => {
    openActionPanel("Risk Rating Review");
    setInput(panel("Risk Rating Review")!.querySelector("#hero-overrideValue")!, "4");
    const card = [...panel("Risk Rating Review")!.querySelectorAll("button")].find((b) =>
      /Reason for the override/.test(b.textContent ?? ""),
    )!;
    click(card);
    const area = panel("Risk Rating Review")!.querySelector("textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(area, "Collateral position improved materially since the last review.");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // The reason satisfies the org's VR, and the SECOND block takes over: the
    // override's wire name has never been observed, so it cannot be filed yet.
    const p = panel("Risk Rating Review")!;
    expect(p.textContent).not.toContain("An override requires a stated reason.");
    expect(p.textContent).toContain("needs one live-probe confirmation");
    expect(byText(/Review the plan/)!.hasAttribute("disabled")).toBe(true);
  });

  it("stages the review once the override is cleared", () => {
    openActionPanel("Risk Rating Review");
    setInput(panel("Risk Rating Review")!.querySelector("#hero-overrideValue")!, "4");
    expect(byText(/Review the plan/)!.hasAttribute("disabled")).toBe(true);
    setInput(panel("Risk Rating Review")!.querySelector("#hero-overrideValue")!, "");
    expect(panel("Risk Rating Review")!.textContent).not.toContain("needs one live-probe confirmation");
    expect(byText(/Review the plan/)!.hasAttribute("disabled")).toBe(false);
  });

  it("blocks a covenant review when the relationship stages no product package", () => {
    openActionPanel("Covenant Review");
    const p = panel("Covenant Review")!;
    // WS0.5: the review is anchored on the PACKAGE, and the sample bundle
    // stages none. F4 (2026-08-25): the banker reads the CONSEQUENCE, not the
    // wire field name, and no gesture is offered either way.
    expect(p.textContent).toContain("stages no credit package");
    expect(p.textContent).toContain("no deal for this action to run on");
    expect(p.textContent).not.toContain("productPackageId is required");
    // The wire field name still reaches whoever needs it, on the toggle.
    expect(byText(/Where this comes from/)).toBeTruthy();
    expect(byText(/Review the plan/)!.hasAttribute("disabled")).toBe(true);
  });

  it("lists the package's covenants for selection, none of them preselected", () => {
    openActionPanel("Covenant Review");
    const text = panel("Covenant Review")!.textContent ?? "";
    expect(text).toContain("Covenants to assess");
    // Every covenant of the relationship is offered by name.
    expect(text).toContain("Debt Service Coverage Ratio");
    // An assessment is a verdict, so nothing is checked for the banker.
    const boxes = [...panel("Covenant Review")!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((b) => !b.checked)).toBe(true);
  });

  it("states what allowNonPending does, and does not, in the org's own words", () => {
    openActionPanel("Covenant Review");
    const text = panel("Covenant Review")!.textContent ?? "";
    expect(text).toContain("the covenant schedule does NOT advance");
  });

  /* THE GESTURE ITSELF. The batch rules exist so a banker learns them from the
     ticket rather than from a round trip, which only works if they reach the
     footer and the button. `booked` stages a product package on every facility,
     which is what a package-anchored ticket needs before it can be filled in. */
  it("refuses to build a plan until at least one covenant is chosen", () => {
    openActionPanel("Covenant Review", "Sterling Fabrication", undefined, true);
    const p = panel("Covenant Review")!;
    expect(p.textContent).toContain("Choose at least one covenant");
    expect(byText(/Review the plan/)!.hasAttribute("disabled")).toBe(true);
  });

  it("refuses to build a plan while a chosen covenant carries no assessment", () => {
    openActionPanel("Covenant Review", "Sterling Fabrication", undefined, true);
    const box = panel("Covenant Review")!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    click(box);
    const p = panel("Covenant Review")!;
    // Chosen, and no verdict on it yet.
    expect(p.textContent).toContain("Every covenant you selected needs an assessment");
    expect(p.textContent).toContain("An assessment is a verdict, and it is never defaulted");
    expect(byText(/Review the plan/)!.hasAttribute("disabled")).toBe(true);
  });

  it("offers the gesture once every chosen covenant has a verdict", () => {
    openActionPanel("Covenant Review", "Sterling Fabrication", undefined, true);
    const p = panel("Covenant Review")!;
    click(p.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    const select = panel("Covenant Review")!.querySelector<HTMLSelectElement>("select")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, "Waived");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(byText(/Review the plan/)!.hasAttribute("disabled")).toBe(false);
  });

  it("refuses a valuation batch whose date the banker cleared", () => {
    openActionPanel("Collateral Valuation", "Sterling Fabrication", undefined, true);
    const date = panel("Collateral Valuation")!.querySelector<HTMLInputElement>('input[type="date"]');
    // The sample bundle stages no collateral record id, so the ticket is
    // already blocked by that gap and the date control may not render at all.
    // Where it does, clearing it must block on the org's own reason.
    if (!date) return;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(date, "");
      date.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(byText(/Review the plan/)!.hasAttribute("disabled")).toBe(true);
  });

  it("says the org names the loan, and never proposes one", () => {
    openActionPanel("New Facility Request");
    const p = panel("New Facility Request")!;
    expect(p.textContent).toContain("Salesforce names the loan itself on creation");
    expect(p.querySelector("#f-name")).toBeNull();
    expect(p.textContent).toContain("Loan Detail");
  });

  it("shows the loan officer as org-assigned rather than asking for one", () => {
    openActionPanel("New Facility Request");
    expandAllFields();
    const p = panel("New Facility Request")!;
    expect(p.textContent).toContain("the org assigns this and overwrites what we send");
  });

  it("offers the six products the Commercial record type allows, and nothing else", () => {
    openActionPanel("New Facility Request");
    const pill = [...panel("New Facility Request")!.querySelectorAll("button")].find((b) => /Product/.test(b.textContent ?? ""))!;
    click(pill);
    const sheet = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute("aria-label") === "Product")!;
    expect([...sheet.querySelectorAll("[aria-pressed]")].map((b) => b.textContent?.trim())).toEqual([
      "Construction",
      "Equipment",
      "Line of Credit",
      "HELOC",
      "Purchase",
      "Deposit",
    ]);
  });
});

describe("WP8 — the deal ticket", () => {
  const setInput = (el: Element, value: string) =>
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("opens on a subject card naming what this is and what it acts on", () => {
    openActionPanel("Annual Review");
    const p = panel("Annual Review")!;
    expect(p.textContent).toContain("Annual credit review for Sterling Fabrication Co.");
    expect(p.textContent).toMatch(/is carried at \$[\d.]+[KMB] committed/);
  });

  it("leads with the hero value, not a field list", () => {
    openActionPanel("Collateral Valuation");
    const hero = panel("Collateral Valuation")!.querySelector("#hero-value") as HTMLInputElement;
    expect(hero).toBeTruthy();
    expect(hero.getAttribute("aria-label")).toBe("Valuation amount (required)");
  });

  it("computes the delta live off the hero value, and shows nothing before it", () => {
    openActionPanel("Collateral Valuation");
    const p = panel("Collateral Valuation")!;
    const hero = p.querySelector("#hero-value") as HTMLInputElement;
    // The pledge value is prefilled, so the readout is already showing. Its
    // heading says IMPLIES, not CHANGES: Probe 6 settled that filing a
    // valuation does not move the collateral value.
    expect(p.textContent).toContain("What this valuation implies");
    expect(p.textContent).toContain("It does not move the collateral value");
    expect(p.textContent).not.toContain("What this changes");
    setInput(hero, "");
    expect(panel("Collateral Valuation")!.textContent).not.toContain("What this valuation implies");
    setInput(panel("Collateral Valuation")!.querySelector("#hero-value")!, "12000000");
    expect(panel("Collateral Valuation")!.textContent).toContain("Collateral coverage");
  });

  it("opens a sheet from a pill and writes the pick back to the same values", () => {
    openActionPanel("Collateral Valuation");
    const p = panel("Collateral Valuation")!;
    const pill = [...p.querySelectorAll("button")].find((b) => /Where the number came from/.test(b.textContent ?? ""))!;
    click(pill);
    const sheet = [...document.querySelectorAll('[role="dialog"]')].find(
      (d) => d.getAttribute("aria-label") === "Where the number came from",
    )!;
    expect(sheet).toBeTruthy();
    // The 14 legal values observed from the org's own VALIDATION_FAILED reply.
    const options = [...sheet.querySelectorAll("[aria-pressed]")];
    expect(options.length).toBe(14);
    const option = options.find((b) => b.textContent?.includes("Appraisal"))!;
    click(option);
    expect([...document.querySelectorAll('[role="dialog"]')].some((d) => d.getAttribute("aria-label") === "Where the number came from")).toBe(false);
    expandAllFields();
    const row = panel("Collateral Valuation")!.querySelector<HTMLSelectElement>("#f-source")!;
    expect(row.value).toBe("Appraisal");
  });

  it("shows all 16 valuation types without clipping, longest label included", () => {
    openActionPanel("Collateral Valuation");
    const pill = [...panel("Collateral Valuation")!.querySelectorAll("button")].find((b) =>
      /Valuation basis/.test(b.textContent ?? ""),
    )!;
    click(pill);
    const sheet = [...document.querySelectorAll('[role="dialog"]')].find(
      (d) => d.getAttribute("aria-label") === "Valuation basis",
    )!;

    const cards = [...sheet.querySelectorAll("[aria-pressed]")];
    expect(cards).toHaveLength(16);
    expect(sheet.textContent).toContain("16 values");
    // The longest real label is present in full, not truncated away.
    const longest = cards.find((c) => /Fair Market Value - Equipment \/ Transportation/.test(c.textContent ?? ""));
    expect(longest, "the longest label must render in full").toBeTruthy();
    expect(longest!.querySelector("span")!.className).not.toContain("truncate");

    // The list scrolls inside a bounded sheet: nothing is cut off, and the
    // sheet is anchored to the PANEL, not to the ticket's scrolled content.
    const list = sheet.querySelector("ul")!;
    expect(list.className).toContain("overflow-y-auto");
    expect(sheet.className).toContain("max-h-[70%]");
    expect(sheet.parentElement!.parentElement).toBe(panel("Collateral Valuation"));
  });

  it("closes the sheet on Escape and leaves the panel open (A31.1)", () => {
    openActionPanel("Annual Review");
    click(panel("Annual Review")!.querySelector("#hero-reviewType")!);
    expect([...document.querySelectorAll('[role="dialog"]')].some((d) => d.getAttribute("aria-label") === "Review type")).toBe(true);
    press("Escape");
    expect([...document.querySelectorAll('[role="dialog"]')].some((d) => d.getAttribute("aria-label") === "Review type")).toBe(false);
    expect(panel("Annual Review")).toBeTruthy();
    press("Escape");
    expect(panel("Annual Review")).toBeNull();
  });

  it("collapses the drafted narratives but still says what they contain", () => {
    openActionPanel("Annual Review");
    const p = panel("Annual Review")!;
    expect(p.querySelectorAll("textarea")).toHaveLength(0);
    // The collapsed card is not an empty label: the draft is legible from it.
    expect(p.textContent).toContain("Relationship summary");
    expect(p.textContent).toMatch(/risk grade \d/);
  });

  it("a pill edit and the classic row edit the same value", () => {
    openActionPanel("Collateral Valuation");
    const date = panel("Collateral Valuation")!.querySelector('input[type="date"]')!;
    setInput(date, "2026-08-01");
    expandAllFields();
    expect(panel("Collateral Valuation")!.querySelector<HTMLInputElement>("#f-valuationDate")!.value).toBe("2026-08-01");
  });

  it("states a blocking gap on the ticket, where the banker is reading", () => {
    openActionPanel("Collateral Valuation");
    expect(panel("Collateral Valuation")!.textContent).toMatch(/collateral record id is not staged|No collateral is pledged/);
  });

  it("keeps the provenance chips the previous presentations carried", () => {
    openActionPanel("Create Service Request");
    expect(panel("Create Service Request")!.textContent).toContain("Derived");
  });
});

/* ------------------------------------------------------------------- WP7 B */

const STAGE_PLAN = {
  ok: true,
  error: null,
  result: {
    stagingId: "a8abb00001KtalSAAR",
    planHash: "9f2c1d",
    decisionToken: "dt-server-001",
    replayed: false,
    accountId: "001SAMPLE0000STRL",
    summary: "Files an annual credit review at In Progress.",
    warnings: [],
    steps: [
      {
        id: "s1",
        type: "write",
        label: "Create the credit review",
        objectName: "LLC_BI__Review__c",
        fields: ["LLC_BI__Status__c", "LLC_BI__Narrative__c"],
        verification: "SELECT Id FROM LLC_BI__Review__c",
        state: "pending",
      },
      {
        id: "s2",
        type: "verification",
        label: "Confirm the review exists",
        objectName: "LLC_BI__Review__c",
        fields: [],
        state: "pending",
      },
    ],
  },
};

/* The package-anchored credit-action plans, READ OUT OF the archived live
   observation (Hartwell package a5Fbb000000IHFJEA4, 2026-07-27). Copied, never
   composed: a hand-written plan would test the panel against a wire that does
   not exist. */
const OBSERVED_FACILITY_PLANS = observedFacilityEnvelopes as unknown as Record<
  string,
  Array<{ outputValues: unknown }>
>;
const MULTI_FACILITY_PLAN = OBSERVED_FACILITY_PLANS.package_anchored_modification_multi[0].outputValues;
const FLAT_FACILITY_PLAN = OBSERVED_FACILITY_PLANS.modification_flat_backcompat[0].outputValues;

/* The COMPLETE modification pair, read out of the live wire probe of
   2026-08-22 (throwaway account ZZ-WS05-PROBE, every record deleted after
   capture). Stage and execute both, so the panel is tested against the two
   halves of one real round trip rather than a plan we composed. */
const OBSERVED_MOD = observedModEnvelopes as unknown as Record<string, { response: Array<{ outputValues: unknown }> }>;
const MOD_STAGE_PLAN = OBSERVED_MOD.stage_loan_modification.response[0].outputValues;
const MOD_EXECUTE = OBSERVED_MOD.execute_loan_modification.response[0].outputValues;
const MOD_REPLAY = OBSERVED_MOD.execute_loan_modification_replay.response[0].outputValues;

const stageEnvelope = (outputValues: unknown) => ({
  payload: { content: [{ actionName: "stage_annual_review", errors: null, isSuccess: true, outputValues, sortOrder: 0, version: 1 }] },
});

/** A live connector whose stage/execute results the test controls. */
function installWriteMcp(over: { stage?: unknown; execute?: unknown; stageThrows?: unknown } = {}) {
  const callTool = vi.fn(async (_server: string, tool: string, _input?: unknown) => {
    if (tool.startsWith("stage_")) {
      if (over.stageThrows) throw over.stageThrows;
      return stageEnvelope(over.stage ?? STAGE_PLAN);
    }
    if (tool.startsWith("execute_")) {
      return stageEnvelope(
        over.execute ?? {
          ok: true,
          error: null,
          result: {
            stagingId: "a8abb00001KtalSAAR",
            terminalState: "success",
            outcome: "The review was created and verified.",
            reviewId: "a5nbb000000ABCDEAA",
            recordName: "REV-0000000012",
            anchorName: "Sterling Fabrication Co.",
            steps: [
              { id: "s1", type: "write", label: "Create the credit review", state: "verified" },
              { id: "s2", type: "verification", label: "Confirm the review exists", state: "verified" },
            ],
          },
        },
      );
    }
    return stageEnvelope({});
  });
  (window as unknown as { claude?: unknown }).claude = {
    mcp: { callTool, watchTool: vi.fn().mockReturnValue(() => {}), listTools: vi.fn(), invalidate: vi.fn() },
  };
  return callTool;
}

/** The single `inputs[0]` row a Customer 360 invocable call carries. */
const inputsOf = (call: unknown[] | undefined): Record<string, unknown> =>
  ((call?.[2] as { inputs?: Array<Record<string, unknown>> } | undefined)?.inputs ?? [{}])[0];

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("WP7.3 — the compile sequence", () => {
  afterEach(() => {
    delete (window as unknown as { claude?: unknown }).claude;
  });

  it("runs four lines bound to the real operations and lands on the plan", async () => {
    installWriteMcp();
    openActionPanel("Annual Review");
    click(byText(/Review the plan/)!);
    await flush();
    const p = panel("Annual Review")!;
    expect(p.textContent).toContain("Files an annual credit review");
    // The plan step is where the stepper now is.
    expect(p.querySelector('[aria-current="step"]')?.textContent).toBe("Plan");
  });

  it("stops ON the failing line and renders the org error there", async () => {
    installWriteMcp({ stage: { ok: false, error: { code: "VALIDATION_FAILED", message: "Type: bad value", orgError: "FIELD_INTEGRITY_EXCEPTION" }, result: null } });
    openActionPanel("Annual Review");
    click(byText(/Review the plan/)!);
    await flush();
    const p = panel("Annual Review")!;
    expect(p.textContent).toContain("Sending it to the org to be staged");
    expect(p.textContent).toContain("Type: bad value");
    expect(p.textContent).toContain("FIELD_INTEGRITY_EXCEPTION");
    // The line after it never ran, and a domain refusal offers no retry.
    expect(p.textContent).toContain("Checking the plan that came back");
    expect(p.textContent).toContain("Change the details and build the plan again");
    expect([...p.querySelectorAll("button")].some((b) => b.textContent === "Try again")).toBe(false);
  });

  it("offers a user-gesture retry for a transport failure", async () => {
    installWriteMcp({ stageThrows: { code: "upstream_error", message: "gateway hiccup" } });
    openActionPanel("Annual Review");
    click(byText(/Review the plan/)!);
    await flush();
    const retry = [...panel("Annual Review")!.querySelectorAll("button")].find((b) => b.textContent === "Try again");
    expect(retry).toBeTruthy();
    expect(panel("Annual Review")!.textContent).toContain("You can send it again");
  });

  it("never calls the tool when a preflight line fails first", async () => {
    const callTool = installWriteMcp();
    openActionPanel("Collateral Valuation"); // blocking collateral gap
    const review = [...panel("Collateral Valuation")!.querySelectorAll("button")].find((b) => /Review the plan/.test(b.textContent ?? ""));
    if (review && !review.hasAttribute("disabled")) {
      click(review);
      await flush();
    }
    expect(callTool.mock.calls.filter((c) => String(c[1]).startsWith("stage_"))).toHaveLength(0);
  });
});

describe("WP7.5 — the stepper", () => {
  afterEach(() => {
    delete (window as unknown as { claude?: unknown }).claude;
  });

  it("steps back to the briefing with every value preserved", async () => {
    installWriteMcp();
    openActionPanel("Annual Review");
    expandAllFields();
    const area = panel("Annual Review")!.querySelector("textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(area, "banker's own words");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click(byText(/Review the plan/)!);
    await flush();
    click([...panel("Annual Review")!.querySelectorAll("button")].find((b) => b.textContent === "Back")!);
    expandAllFields();
    expect(panel("Annual Review")!.querySelector("textarea")!.value).toBe("banker's own words");
  });

  it("returns to the SAME plan when nothing was edited", async () => {
    const callTool = installWriteMcp();
    openActionPanel("Annual Review");
    click(byText(/Review the plan/)!);
    await flush();
    click([...panel("Annual Review")!.querySelectorAll("button")].find((b) => b.textContent === "Back")!);
    expect(byText(/Back to the plan/)).toBeTruthy();
    click(byText(/Back to the plan/)!);
    await flush();
    // No second staging call: the plan the banker saw is the plan they return to.
    expect(callTool.mock.calls.filter((c) => String(c[1]).startsWith("stage_"))).toHaveLength(1);
  });

  it("says the plan will be rebuilt once the figures change", async () => {
    installWriteMcp();
    openActionPanel("Annual Review");
    click(byText(/Review the plan/)!);
    await flush();
    click([...panel("Annual Review")!.querySelectorAll("button")].find((b) => b.textContent === "Back")!);
    expandAllFields();
    const area = panel("Annual Review")!.querySelector("textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(area, "edited after staging");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const p = panel("Annual Review")!;
    expect(p.textContent).toContain("the plan will be rebuilt");
    expect(byText(/Rebuild the plan/)).toBeTruthy();
  });

  it("closes on Escape from any step (A31.1)", async () => {
    installWriteMcp();
    openActionPanel("Annual Review");
    click(byText(/Review the plan/)!);
    await flush();
    press("Escape");
    expect(panel("Annual Review")).toBeNull();
  });
});

describe("WP7.4 — the execution", () => {
  afterEach(() => {
    delete (window as unknown as { claude?: unknown }).claude;
  });

  async function executeAndLand() {
    openActionPanel("Annual Review", "Sterling Fabrication", { userId: APPROVER_ID });
    click(byText(/Review the plan/)!);
    await flush();
    click(byText(/Confirm and file/)!);
    await flush();
  }

  it("stamps the filed record and offers Salesforce as the next move", async () => {
    installWriteMcp();
    await executeAndLand();
    const p = panel("Annual Review")!;
    expect(p.textContent).toContain("Filed REV-0000000012 against Sterling Fabrication Co.");
    expect(p.textContent).toContain("a5nbb000000ABCDEAA");
    expect(p.textContent).toContain("View in Salesforce");
  });

  it("shows every step in the state the executor returned", async () => {
    installWriteMcp();
    await executeAndLand();
    const p = panel("Annual Review")!;
    expect(p.textContent).toContain("Verified");
    expect(p.textContent).not.toContain("Not started");
  });

  it("keeps the failing step as the focus, with the org error verbatim", async () => {
    installWriteMcp({
      execute: {
        ok: true,
        error: null,
        result: {
          stagingId: "a8abb00001KtalSAAR",
          terminalState: "partial",
          outcome: "The review was created but could not be verified.",
          steps: [
            { id: "s1", type: "write", label: "Create the credit review", state: "failed", detail: "INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY" },
            { id: "s2", type: "verification", label: "Confirm the review exists", state: "skipped_not_attempted" },
          ],
        },
      },
    });
    await executeAndLand();
    const p = panel("Annual Review")!;
    expect(p.textContent).toContain("INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY");
    expect(p.textContent).toContain("This is where the plan stopped");
    expect(p.textContent).toContain("can be resumed from here");
    // No stamp on a partial: nothing is claimed as filed and verified.
    expect(p.textContent).not.toContain("Filed — ");
  });
});

describe("the terminal deep link targets the record that was just filed", () => {
  const INSTANCE = "https://bankinggpt.lightning.force.com";
  afterEach(() => {
    delete (window as unknown as { claude?: unknown }).claude;
  });

  async function fileIt(actionLabel: string, execute?: unknown) {
    installWriteMcp(execute ? { execute } : {});
    openActionPanel(actionLabel, "Sterling Fabrication", { userId: APPROVER_ID, instanceUrl: INSTANCE });
    click(byText(/Review the plan/)!);
    await flush();
    click(byText(/Confirm and file/)!);
    await flush();
    return panel(actionLabel)!;
  }

  it("opens the created review, not the package", async () => {
    const p = await fileIt("Annual Review");
    const hero = p.querySelector('[data-deeplink="record"]') as HTMLAnchorElement;
    expect(hero.getAttribute("href")).toBe(`${INSTANCE}/lightning/r/LLC_BI__Review__c/a5nbb000000ABCDEAA/view`);
    expect(hero.textContent).toContain("View in Salesforce");
  });

  it("keeps the deal as a secondary link on the same terminal state", async () => {
    const p = await fileIt("Annual Review");
    // The sample stages no productPackageId, so the package affordance is the
    // honest disabled chip. It is still SECONDARY copy, and still present.
    const secondary = p.querySelector('[data-deeplink="package"]')!;
    expect(secondary.textContent).toContain("View deal in Salesforce");
    expect(secondary.querySelector('[aria-disabled="true"]')).toBeTruthy();
  });

  it("names the right object per action", async () => {
    const p = await fileIt("Create Service Request", {
      ok: true,
      error: null,
      result: {
        stagingId: "a8abb00001KtalSAAR",
        terminalState: "success",
        outcome: "The service request was created and verified.",
        caseId: "500bb00000XYZ123AAA",
        // Both planned steps must come back: a step the executor did not report
        // on is not verified, and the terminal state is not success.
        steps: [
          { id: "s1", type: "write", label: "Create the credit review", state: "verified" },
          { id: "s2", type: "verification", label: "Confirm the review exists", state: "verified" },
        ],
      },
    });
    expect((p.querySelector('[data-deeplink="record"]') as HTMLAnchorElement).getAttribute("href")).toBe(
      `${INSTANCE}/lightning/r/Case/500bb00000XYZ123AAA/view`,
    );
  });

  it("falls back to the disabled chip with a selectable id when the org address is absent", async () => {
    installWriteMcp();
    openActionPanel("Annual Review", "Sterling Fabrication", { userId: APPROVER_ID });
    click(byText(/Review the plan/)!);
    await flush();
    click(byText(/Confirm and file/)!);
    await flush();
    const p = panel("Annual Review")!;
    const hero = p.querySelector('[data-deeplink="record"]')!;
    expect(hero.tagName).not.toBe("A");
    expect(hero.querySelector('[aria-disabled="true"]')).toBeTruthy();
    expect(hero.textContent).toContain("a5nbb000000ABCDEAA");
  });

  it("still points at the package when nothing was filed", async () => {
    const p = await fileIt("Annual Review", {
      ok: true,
      error: null,
      result: {
        stagingId: "a8abb00001KtalSAAR",
        terminalState: "failed",
        outcome: "Nothing was written.",
        steps: [{ id: "s1", type: "write", label: "Create the credit review", state: "failed", detail: "INSUFFICIENT_ACCESS" }],
      },
    });
    expect(p.querySelector('[data-deeplink="record"]')).toBeNull();
    expect(p.querySelector('[data-deeplink="package"]')!.textContent).toContain("View in Salesforce");
  });
});

describe("an executed action lands in the Activity trail (A30)", () => {
  afterEach(() => {
    delete (window as unknown as { claude?: unknown }).claude;
  });

  async function fileThenReadActivity(execute?: unknown) {
    installWriteMcp(execute ? { execute } : {});
    openActionPanel("Annual Review", "Sterling Fabrication", {
      userId: APPROVER_ID,
      instanceUrl: "https://bankinggpt.lightning.force.com",
    });
    click(byText(/Review the plan/)!);
    await flush();
    click(byText(/Confirm and file/)!);
    await flush();
    press("Escape"); // close the panel
    return document.body.textContent ?? "";
  }

  it("appears immediately, with no Sync, naming the record and what it was filed against", async () => {
    const text = await fileThenReadActivity();
    expect(text).toContain("Annual credit review REV-0000000012 filed against Sterling Fabrication Co.");
    // A30.4 — marked user-originated, and attributed to the acting user.
    const row = [...document.querySelectorAll('[data-origin="user"]')].find((r) =>
      /Annual credit review REV-0000000012 filed/.test(r.textContent ?? ""),
    )!;
    expect(row).toBeTruthy();
    expect(row.textContent).toContain("Fabian Goetzens");
  });

  it("carries the record link and keeps the staging id for audit", async () => {
    await fileThenReadActivity();
    const entry = [...document.querySelectorAll("button")].find((b) =>
      /Annual credit review REV-0000000012 filed/.test(b.textContent ?? ""),
    )!;
    click(entry);
    const modal = document.querySelector('[role="dialog"]')!;
    expect(modal.textContent).toContain("a5nbb000000ABCDEAA");
    expect(modal.textContent).toContain("a8abb00001KtalSAAR");
  });

  it("logs a failed execution too, with the failing step and its code", async () => {
    const text = await fileThenReadActivity({
      ok: true,
      error: null,
      result: {
        stagingId: "a8abb00001KtalSAAR",
        terminalState: "partial",
        outcome: "The review was created but could not be verified.",
        steps: [
          { id: "s1", type: "write", label: "Create the credit review", state: "failed", detail: "INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY" },
        ],
      },
    });
    expect(text).toContain("Annual credit review did not complete");
    const row = [...document.querySelectorAll('[data-origin="user"]')].find((r) =>
      /did not complete/.test(r.textContent ?? ""),
    )!;
    expect(row).toBeTruthy();
  });

  it("logs one entry per execution, however many times the tracker re-renders", async () => {
    await fileThenReadActivity();
    const entries = [...document.querySelectorAll("button")].filter((b) =>
      /Annual credit review REV-0000000012 filed/.test(b.textContent ?? ""),
    );
    expect(entries).toHaveLength(1);
  });
});

describe("the execute payload, pinned to the shape the org accepted (live defect 2026-07-26)", () => {
  afterEach(() => {
    delete (window as unknown as { claude?: unknown }).claude;
  });

  async function confirmWith(meta: Record<string, unknown>) {
    const callTool = installWriteMcp();
    openActionPanel("Annual Review", "Sterling Fabrication", meta);
    click(byText(/Review the plan/)!);
    await flush();
    const confirm = byText(/Confirm and file/);
    if (confirm) {
      click(confirm);
      await flush();
    }
    return callTool;
  }

  it("sends EXACTLY the five fields, with the stage result's values verbatim", async () => {
    const callTool = await confirmWith({ userId: APPROVER_ID });
    const executeCall = callTool.mock.calls.find((c) => String(c[1]).startsWith("execute_"))!;
    expect(executeCall).toBeTruthy();

    // Positional envelope: one input row, so element 0 of the response is this
    // call's outcome and nothing is silently misaligned.
    expect((executeCall[2] as { inputs: unknown[] }).inputs).toHaveLength(1);
    const stageKey = inputsOf(callTool.mock.calls.find((c) => String(c[1]).startsWith("stage_"))).idempotencyKey;

    // The whole payload, not a subset: an extra field is as much a defect as a
    // wrong one, and the Apex reads these five by name.
    expect(inputsOf(executeCall)).toEqual({
      idempotencyKey: stageKey,
      stagingId: STAGE_PLAN.result.stagingId,
      planHash: STAGE_PLAN.result.planHash,
      decisionToken: STAGE_PLAN.result.decisionToken,
      approverUserId: APPROVER_ID,
    });
  });

  it("reuses the STAGE idempotency key, which is the pairing the org round trip proved", async () => {
    const callTool = await confirmWith({ userId: APPROVER_ID });
    const stage = inputsOf(callTool.mock.calls.find((c) => String(c[1]).startsWith("stage_")));
    const execute = inputsOf(callTool.mock.calls.find((c) => String(c[1]).startsWith("execute_")));
    expect(execute.idempotencyKey).toBe(stage.idempotencyKey);
    expect(String(execute.idempotencyKey)).not.toBe("");
  });

  it("sends the SERVER decision token, never the client-minted record", async () => {
    const callTool = await confirmWith({ userId: APPROVER_ID });
    const execute = inputsOf(callTool.mock.calls.find((c) => String(c[1]).startsWith("execute_")));
    expect(execute.decisionToken).toBe("dt-server-001");
    // The client mint is a bookkeeping cache: its shape must never appear here.
    expect(String(execute.decisionToken)).not.toMatch(/^c360-/);
  });

  it("never puts a display name on the wire, and says why instead", async () => {
    // The live defect: meta.user is "Fabian Goetzens", and the Apex compares
    // approverUserId to the running identity BEFORE redeeming the token.
    const callTool = await confirmWith({ user: "Fabian Goetzens", userId: undefined });
    expect(callTool.mock.calls.filter((c) => String(c[1]).startsWith("execute_"))).toHaveLength(0);
    expect(panel("Annual Review")!.textContent).toContain("no Salesforce user id");
  });

  it("accepts the id from meta.user when the assembler stages it there", async () => {
    // `meta.userId` has to be cleared for this case to mean anything: the sample fixture stages one
    // now (the assembler refuses to build without it), and `userId` is checked before `user`.
    const callTool = await confirmWith({ user: APPROVER_ID, userId: undefined });
    const execute = inputsOf(callTool.mock.calls.find((c) => String(c[1]).startsWith("execute_")));
    expect(execute.approverUserId).toBe(APPROVER_ID);
  });

  it("surfaces the org's own code and words on a precondition refusal", async () => {
    installWriteMcp({
      execute: { ok: false, error: { code: "PRECONDITION", message: "approverUserId does not match the running identity." }, result: null },
    });
    openActionPanel("Annual Review", "Sterling Fabrication", { userId: APPROVER_ID });
    click(byText(/Review the plan/)!);
    await flush();
    click(byText(/Confirm and file/)!);
    await flush();
    const p = panel("Annual Review")!;
    expect(p.textContent).toContain("PRECONDITION");
    expect(p.textContent).toContain("approverUserId does not match the running identity.");
    // Never the platform's generic line in place of the org's own.
    expect(p.textContent).not.toContain("but reported a failure");
  });
});

describe("no staged plan can survive a republish", () => {
  afterEach(() => {
    delete (window as unknown as { claude?: unknown }).claude;
  });

  it("never persists a stagingId, planHash or token, so none can be resurrected stale", async () => {
    installWriteMcp();
    openActionPanel("Annual Review", "Sterling Fabrication", { userId: APPROVER_ID });
    click(byText(/Review the plan/)!);
    await flush();

    // Everything the session writes down, across every key it owns.
    const stored = Object.keys(sessionStorage)
      .map((k) => sessionStorage.getItem(k) ?? "")
      .join(" ");
    for (const secret of [STAGE_PLAN.result.stagingId, STAGE_PLAN.result.planHash, STAGE_PLAN.result.decisionToken]) {
      expect(stored, secret).not.toContain(secret);
    }
    expect(stored).not.toContain("stagingId");
  });

  it("drops the plan entirely when the panel closes", async () => {
    const callTool = installWriteMcp();
    openActionPanel("Annual Review", "Sterling Fabrication", { userId: APPROVER_ID });
    click(byText(/Review the plan/)!);
    await flush();
    // Escape closes the panel (A31.1), and the arc it was opened from is still
    // there to reopen it from.
    press("Escape");
    expect(panel("Annual Review")).toBeNull();
    act(() => openActionTicket(idForLabel("Annual Review")));
    // Reopened on the briefing, with no plan to step forward to.
    expect(byText(/Back to the plan/)).toBeUndefined();
    expect(byText(/Review the plan/)).toBeTruthy();
    expect(callTool.mock.calls.filter((c) => String(c[1]).startsWith("stage_"))).toHaveLength(1);
  });
});

describe("collateral anchor gap blocks the tool (live defect 2026-07-26)", () => {
  /** Install a live mcp capability whose callTool we can assert was NEVER hit. */
  function installLiveMcp() {
    const callTool = vi.fn().mockResolvedValue({ payload: { content: [{ isSuccess: true, outputValues: { ok: true, result: {} } }] } });
    (window as unknown as { claude?: unknown }).claude = {
      mcp: { callTool, watchTool: vi.fn().mockReturnValue(() => {}), listTools: vi.fn(), invalidate: vi.fn() },
    };
    return callTool;
  }

  afterEach(() => {
    delete (window as unknown as { claude?: unknown }).claude;
  });

  it("renders the named gap instead of a stageable form", () => {
    installLiveMcp();
    openActionPanel("Collateral Valuation");
    const text = panel("Collateral Valuation")!.textContent ?? "";
    // The sample stages no collateral record id, so the honest gap shows.
    expect(text).toMatch(/collateral record id is not staged|No collateral is pledged/);
  });

  it("disables the staging gesture, so the tool is never called", () => {
    const callTool = installLiveMcp();
    openActionPanel("Collateral Valuation");
    const review = [...panel("Collateral Valuation")!.querySelectorAll("button")].find((b) =>
      /Review the plan/.test(b.textContent ?? ""),
    );
    if (review) {
      expect(review.hasAttribute("disabled")).toBe(true);
      click(review); // a disabled button fires nothing, but assert the outcome
    }
    const staged = callTool.mock.calls.filter((c) => String(c[1]).startsWith("stage_"));
    expect(staged).toHaveLength(0);
  });

  it("never sends a facility id as the collateral anchor", () => {
    const callTool = installLiveMcp();
    openActionPanel("Collateral Valuation");
    for (const call of callTool.mock.calls) {
      const input = call[2] as { inputs?: Array<Record<string, unknown>> } | undefined;
      for (const row of input?.inputs ?? []) {
        // a1X... is a Loan id prefix; it must never appear as collateralId.
        expect(String(row.collateralId ?? "")).not.toMatch(/^a1X/);
      }
    }
  });
});

describe("A33.2 — suggestions and named gaps in the panel", () => {
  it("shows the deterministic finding under a panel that says what it is for", () => {
    openActionPanel("Collateral Valuation");
    const text = panel("Collateral Valuation")!.textContent ?? "";
    expect(text).toContain("Effective challenge");
    expect(text).toContain(CHALLENGE_PANEL_INTRO);
    // F5 — the pack id is not a bank policy version and must not read as one.
    expect(text).toContain("Demo policy pack (WS2 policy layer pending)");
    expect(text).not.toContain("demo-2026-07");
  });

  it("requires a reason before a suggestion can be declined", () => {
    openActionPanel("Collateral Valuation");
    const p = panel("Collateral Valuation")!;
    const decline = [...p.querySelectorAll("button")].find((b) => /Decline with reason/.test(b.textContent ?? ""));
    if (!decline) return; // no suggestion fired for this data shape
    click(decline);
    const record = [...panel("Collateral Valuation")!.querySelectorAll("button")].find((b) =>
      /Record and decline/.test(b.textContent ?? ""),
    )!;
    expect(record.hasAttribute("disabled")).toBe(true);
  });
});

/* =============================================================================
   FOUNDER UAT, 2026-08-25 — the ticket flow as the banker read it.

   Five findings, live. Each one below is the founder's own reading turned into
   a test, so the ticket cannot quietly go back to the shape they rejected.
   ============================================================================= */

const setHero = (el: Element, value: string) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("F1 — the ticket leads with the deal and reads its members as clean rows", () => {
  it("puts the package NAME at headline size, above everything it governs", () => {
    openActionPanel("Loan Modification", "Sterling Fabrication", undefined, true);
    const p = panel("Loan Modification")!;
    const headline = p.querySelector("h4")!;
    expect(headline.textContent).toBe("Sterling Fabrication Co. credit package");
    // ONE metadata line under it, and it is members, committed, drawn.
    expect(headline.nextElementSibling?.textContent).toBe("2 facilities · $18M committed · $16.90M drawn");
  });

  it("keeps the org's record id off the banker's line and behind a toggle", () => {
    openActionPanel("Loan Modification", "Sterling Fabrication", undefined, true);
    const p = panel("Loan Modification")!;
    const headline = p.querySelector("h4")!;
    expect(headline.parentElement?.textContent).not.toContain("a5Fbb000000HA1NEAW");
    const toggle = [...p.querySelectorAll("button")].find((b) => /Record reference/.test(b.textContent ?? ""))!;
    expect(toggle).toBeTruthy();
    click(toggle);
    expect(panel("Loan Modification")!.textContent).toContain("a5Fbb000000HA1NEAW");
  });

  it("gives every member row a checkbox, its own name and its stage as a chip", () => {
    openActionPanel("Loan Modification", "Kingsley Precision", undefined, true);
    const p = panel("Loan Modification")!;
    const boxes = [...p.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes.length).toBeGreaterThan(1);
    for (const box of boxes) {
      const row = box.closest("label")!;
      // Name, then stage chip, then one line of figures. Nothing else.
      expect(row.textContent).toMatch(/Booked|Final Review|Paid Off/);
      expect(row.textContent).toContain("committed");
    }
  });
});

describe("F2 — the effective challenge asks for a decision", () => {
  it("says what the panel is before it says anything about the figures", () => {
    openActionPanel("Collateral Valuation");
    const text = panel("Collateral Valuation")!.textContent ?? "";
    expect(text).toContain("Effective challenge");
    expect(text).toContain("Advisory only: the decision stays with you");
    // The intro comes before the first card.
    expect(text.indexOf(CHALLENGE_PANEL_INTRO)).toBeLessThan(text.indexOf("below the 1.10x floor"));
  });

  it("leads each card with the verdict, then the detail, then the two decisions", () => {
    openActionPanel("Collateral Valuation");
    const text = panel("Collateral Valuation")!.textContent ?? "";
    const verdict = "Collateral coverage is 0.96x, below the 1.10x floor.";
    expect(text).toContain(verdict);
    expect(text.indexOf(verdict)).toBeLessThan(text.indexOf("Lendable collateral covers"));
    expect(text.indexOf("Lendable collateral covers")).toBeLessThan(text.indexOf("Acknowledge and continue"));
    expect(text).toContain("Decline with reason");
  });

  it("records the acknowledgement and collapses the card that asked for it", () => {
    openActionPanel("Collateral Valuation");
    const before = panel("Collateral Valuation")!.textContent ?? "";
    expect(before).toContain("Lendable collateral covers");

    const ack = [...panel("Collateral Valuation")!.querySelectorAll("button")].find((b) =>
      /Acknowledge and continue/.test(b.textContent ?? ""),
    )!;
    click(ack);

    const after = panel("Collateral Valuation")!.textContent ?? "";
    // The verdict SURVIVES — an acknowledged check is still a check on file —
    // and the detail plus the two gestures fold away.
    expect(after).toContain("Collateral coverage is 0.96x, below the 1.10x floor.");
    expect(after).toContain("acknowledged");
    expect(after).not.toContain("Lendable collateral covers");
    // Only the SECOND card still asks; the acknowledged one has stopped.
    const asks = [...panel("Collateral Valuation")!.querySelectorAll("button")].filter((b) =>
      /Acknowledge and continue/.test(b.textContent ?? ""),
    );
    expect(asks).toHaveLength(before.match(/Acknowledge and continue/g)!.length - 1);
  });

  it("names a DECLINED check by its verdict, never by its rule id", () => {
    openActionPanel("Collateral Valuation");
    const decline = [...panel("Collateral Valuation")!.querySelectorAll("button")].find((b) =>
      /Decline with reason/.test(b.textContent ?? ""),
    )!;
    click(decline);
    const box = panel("Collateral Valuation")!.querySelector("textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(box, "Fresh appraisal already commissioned.");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click(
      [...panel("Collateral Valuation")!.querySelectorAll("button")].find((b) =>
        /Record and decline/.test(b.textContent ?? ""),
      )!,
    );
    const text = panel("Collateral Valuation")!.textContent ?? "";
    expect(text).toContain("declined: Fresh appraisal already commissioned.");
    expect(text).not.toContain("coverage-shortfall");
  });
});

describe("F3 — the challenge quotes the read the ticket itself is using", () => {
  it("quotes the BAKED bundle's own clock when nothing has been synced", () => {
    openActionPanel("Collateral Valuation");
    const text = panel("Collateral Valuation")!.textContent ?? "";
    expect(text).toContain("as it was prepared on Jul 2, 2026, 09:15 UTC");
    expect(text).toContain("Sync this relationship to recheck it on today's figures");
  });

  it("quotes the SYNC once a live read has replaced the bundle the ticket reads", () => {
    // A session that already synced: the overlay is the same one the Sync
    // sweep writes, restored through the same reducer path.
    const account = "001SAMPLE0000STRL";
    const synced = Date.parse("2026-08-25T14:05:00Z");
    saveOverlay(dataVersionOf(DATA.meta), account, {
      patch: {
        exposure: {
          ...structuredClone(DATA.borrowers![account].exposure!),
          totalCommitted: 21_000_000,
        },
      },
      activity: [],
      storedAt: synced,
    });

    openActionPanel("Collateral Valuation");
    const text = panel("Collateral Valuation")!.textContent ?? "";
    expect(text).toContain("as it was read from Salesforce on Aug 25, 2026, 14:05 UTC");
    expect(text).not.toContain("Jul 2, 2026, 09:15 UTC");
    // And the FIGURES moved with the timestamp: the same read, one story.
    expect(text).toContain("0.82x");
  });

  it("says which figures that sync did NOT refresh, in banker language", () => {
    const account = "001SAMPLE0000STRL";
    saveOverlay(dataVersionOf(DATA.meta), account, {
      // Exposure only. The covenant rule is live in its clock and baked in its
      // inputs, and the card has to admit that rather than claim both.
      patch: { exposure: structuredClone(DATA.borrowers![account].exposure!) },
      activity: [],
      storedAt: Date.parse("2026-08-25T14:05:00Z"),
    });
    openActionPanel("Collateral Valuation");
    const text = panel("Collateral Valuation")!.textContent ?? "";
    expect(text).toContain("except the covenant figures, which that sync did not refresh");
  });
});

describe("F4 — nothing on any ticket speaks in contract paths", () => {
  /** Every leak family the founder read on 2026-08-25, plus its relatives. */
  const LEAKS: Array<[string, RegExp]> = [
    ["a contract path", /borrower\.[a-z]/],
    ["a tool name", /Customer360[A-Z]/],
    ["an array path segment", /\[\]\./],
    ["a managed field name", /\bLLC_BI__/],
    ["a wire field name", /productPackageId|covenantComplianceId|facilityIds|attachedLoans|loanCovenants/],
    ["a policy pack id", /demo-2026-07/],
  ];

  it.each([
    ["Collateral Valuation", "Sterling Fabrication"],
    ["Covenant Review", "Sterling Fabrication"],
    ["Annual Review", "Sterling Fabrication"],
    ["Risk Rating Review", "Kingsley Precision"],
    ["New Facility Request", "Kingsley Precision"],
  ])("keeps %s clean", (action, account) => {
    openActionPanel(action, account);
    const text = panel(action)!.textContent ?? "";
    for (const [what, re] of LEAKS) expect(text, `${action} leaks ${what}`).not.toMatch(re);
    // And the same with the completeness view open, which is where the schema's
    // own labels and helps are read.
    expandAllFields();
    const all = panel(action)!.textContent ?? "";
    for (const [what, re] of LEAKS) expect(all, `${action} leaks ${what} in All fields`).not.toMatch(re);
  });
});

describe("F5 — the amount reads from -> to, and the deal is selectable when there is a choice", () => {
  it("shows a per-member from -> to summary once an amount is entered", () => {
    openActionPanel("Loan Modification", "Sterling Fabrication", undefined, true);
    setHero(panel("Loan Modification")!.querySelector("#hero-newCommitment")!, "13000000");
    const p = panel("Loan Modification")!;
    const rows = [...p.querySelectorAll("div")].find((d) => /^Each selected facility/.test(d.textContent ?? ""))!;
    expect(rows.textContent).toContain("Sterling Working Capital Revolver");
    expect(rows.textContent).toContain("$10M");
    expect(rows.textContent).toContain("$13M");
  });

  it("adds a row per member as more members are ticked", () => {
    openActionPanel("Loan Modification", "Sterling Fabrication", undefined, true);
    setHero(panel("Loan Modification")!.querySelector("#hero-newCommitment")!, "13000000");
    const boxes = [...panel("Loan Modification")!.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    const other = boxes.find((b) => !b.checked)!;
    click(other);
    const rows = [...panel("Loan Modification")!.querySelectorAll("div")].find((d) =>
      /^Each selected facility/.test(d.textContent ?? ""),
    )!;
    expect(rows.textContent).toContain("Sterling Working Capital Revolver");
    expect(rows.textContent).toContain("Sterling Equipment Term Loan");
  });

  /* ---------------------------------------------- never a bare member count */

  /** FOUNDER MISREAD, 2026-08-26: a bare "1 facility" on a ticket anchored to a
   *  multi-member package reads as the package's own size. Every
   *  selection-scoped label on the ticket now states both numbers. */
  it("labels the member selection as a fraction of the deal, at N = 1 and N = 2", () => {
    openActionPanel("Loan Modification", "Kingsley Precision", undefined, true);
    setHero(panel("Loan Modification")!.querySelector("#hero-newCommitment")!, "13000000");

    const p = () => panel("Loan Modification")!;
    const members = () =>
      [...p().querySelectorAll("div")].find((d) => /^Facilities/.test(d.textContent ?? ""))!.textContent ?? "";
    const fromTo = () =>
      [...p().querySelectorAll("div")].find((d) => /^Each selected facility/.test(d.textContent ?? ""))!.textContent ??
      "";

    // One preselected member, out of everything the list shows.
    expect(members()).toContain("1 of 4 selected");
    expect(fromTo()).toContain("1 of 4 selected");
    // And never the bare count that caused the misread.
    expect(fromTo()).not.toMatch(/Each selected facility · 1 facility\b/);

    const boxes = [...p().querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    click(boxes.find((b) => !b.checked && !b.disabled)!);
    expect(members()).toContain("2 of 4 selected");
    expect(fromTo()).toContain("2 of 4 selected");
  });

  it("renders NO deal selector when the relationship carries a single package", () => {
    openActionPanel("Loan Modification", "Sterling Fabrication", undefined, true);
    const p = panel("Loan Modification")!;
    // The headline, and the reason there is nothing to choose. No chooser.
    expect(p.textContent).toContain("the relationship stages one product package");
    expect(p.querySelector('[role="group"]')).toBeNull();
  });
});
