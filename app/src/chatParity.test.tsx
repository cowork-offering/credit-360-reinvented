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
import { resetModalStack } from "./components/modalStack";
import { ACTIONS_BY_ID } from "./actions/registry";
import sample from "../../artifact/sample-data.json";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATA = sample as unknown as C360Data;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function teardown() {
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
}

afterEach(() => {
  teardown();
  delete (window as unknown as { claude?: unknown }).claude;
  vi.restoreAllMocks();
});

const envelope = (outputValues: unknown) => ({
  payload: { content: [{ actionName: "t", errors: null, isSuccess: true, outputValues, sortOrder: 0, version: 1 }] },
});

const PLAN = {
  ok: true,
  error: null,
  result: {
    stagingId: "a8abb00001KtalSAAR",
    planHash: "9f2c1d",
    decisionToken: "dt-server-001",
    summary: "Files it.",
    warnings: [],
    steps: [{ id: "s1", type: "write", label: "Create the record", objectName: "Case", fields: ["Subject"], state: "pending" }],
  },
};

function installMcp() {
  const staged: Array<Record<string, unknown>> = [];
  const callTool = vi.fn(async (_server: string, tool: string, input?: unknown) => {
    if (tool.startsWith("stage_")) {
      staged.push(((input as { inputs?: Array<Record<string, unknown>> })?.inputs ?? [{}])[0]);
      return envelope(PLAN);
    }
    return envelope({});
  });
  (window as unknown as { claude?: unknown }).claude = {
    mcp: { callTool, watchTool: vi.fn().mockReturnValue(() => {}), listTools: vi.fn(), invalidate: vi.fn() },
  };
  return staged;
}

function mount() {
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
}

const buttons = () => [...document.body.querySelectorAll("button")];
const byText = (re: RegExp) => buttons().find((b) => re.test(b.textContent ?? ""));
const byLabel = (re: RegExp) => buttons().find((b) => re.test(b.getAttribute("aria-label") ?? ""));
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const openAccount = () =>
  click([...document.querySelectorAll('[role="button"]')].find((r) => r.textContent?.includes("Sterling Fabrication"))!);
/** SURFACE 4, DIRECTION-LOCKED rule 50: the mark is CONTEXT-AWARE. On the
 *  landing it opens the assist directly; on a client it fans the action arc and
 *  the assist is the satellite at the top. These tests all stand on a client,
 *  so the chat entry point is now two gestures rather than one. */
const openAssist = () => {
  click(byLabel(/Client actions/)!);
  click(byLabel(/Assist chat/)!);
};
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

/** The chips the chat offers for this account that open a panel. */
function panelChips(): HTMLButtonElement[] {
  return [...document.querySelectorAll('[role="dialog"]')]
    .flatMap((d) => [...d.querySelectorAll("button")])
    .filter((b) => b.hasAttribute("title") && Object.values(ACTIONS_BY_ID).some((a) => a.hasPanel && a.label === b.textContent?.trim()));
}

/** The sheet has no UI trigger since 2026-08-31 (the > FAB arc owns client
 *  actions); its rows are entered through the app's own SET_PANEL, which is
 *  what the retired button dispatched. The PARITY under test is unchanged. */
async function stageViaClientActions(label: string) {
  const staged = installMcp();
  mount();
  openAccount();
  act(() => dispatchOpenSheet());
  click([...document.querySelector('[role="dialog"]')!.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!);
  click(byText(/Review the plan/)!);
  await flush();
  teardown();
  return staged[0];
}

async function stageViaChatChip(label: string) {
  const staged = installMcp();
  mount();
  openAccount();
  openAssist();
  const chip = panelChips().find((b) => b.textContent?.trim() === label)!;
  click(chip);
  click(byText(/Review the plan/)!);
  await flush();
  teardown();
  return staged[0];
}

describe("A33.6.1 — the chat path and the panel path stage the same thing", () => {
  it("offers at least one panel-backed action as a chat chip", () => {
    installMcp();
    mount();
    openAccount();
    openAssist();
    expect(panelChips().length).toBeGreaterThan(0);
  });

  it("produces identical staged values whichever entry point opened the ticket", async () => {
    installMcp();
    mount();
    openAccount();
    openAssist();
    const labels = panelChips().map((b) => b.textContent!.trim());
    teardown();
    expect(labels.length).toBeGreaterThan(0);
    /* When every suggested chip is room-owned there is nothing to prove here,
       and that is the correct outcome rather than a skipped truth. */

    /* THE ROOMS TOOK THE ROOM-COVERED ACTIONS (founder, 2026-09-03): a chip for
       a modification, renewal, new facility or a relationship review opens the
       room rather than the ticket, so panel parity is only provable for the
       actions the panel still owns. */
    const ROOM_OWNED = new Set([
      "Loan Modification",
      "Renewal",
      "New Facility Request",
      "Covenant Review",
      "Collateral Valuation",
      "Annual Review",
      "Risk Rating Review",
      "Create Service Request",
    ]);
    const panelLabels = labels.filter((l) => !ROOM_OWNED.has(l));

    for (const label of panelLabels) {
      const fromRow = await stageViaClientActions(label);
      const fromChat = await stageViaChatChip(label);

      // Parity of OUTCOME first: an action blocked by a staging gap (the sample
      // stages no collateral record id) must be equally blocked from both, and
      // neither may reach the tool.
      expect(Boolean(fromChat), `${label}: one path staged and the other did not`).toBe(Boolean(fromRow));
      if (!fromRow) continue;

      // The idempotency key is minted per panel instance and MUST differ: two
      // openings are two intents, and sharing a key would let the second replay
      // the first. Everything the org reads is identical.
      expect(fromChat.idempotencyKey).not.toBe(fromRow.idempotencyKey);
      const { idempotencyKey: _a, ...rowRest } = fromRow;
      const { idempotencyKey: _b, ...chatRest } = fromChat;
      expect(chatRest, `${label}: the two entry points staged different values`).toEqual(rowRest);
    }
  });

  it("carries the staged client request into the ticket from the actions row", async () => {
    // The chat chip for this action opens the relationship room now, so the
    // carried request is proven through the row path alone.
    const label = ACTIONS_BY_ID["create-service-request"].label;
    const fromRow = await stageViaClientActions(label);
    // Sterling has an inbound request staged; the ticket opens carrying it.
    expect(String(fromRow.summary ?? "")).toContain("Revolver");
  });
});
