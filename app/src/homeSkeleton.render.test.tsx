// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { C360Data } from "./data/contract";
import { AppProvider } from "./state/appState";
import { AppShell } from "./components/AppShell";
import sample from "../../artifact/sample-data.json";

/* =============================================================================
   THE COLD-OPEN SKELETON, on the surface.

   A fresh open with a connector must not flash the baked test relationships
   while the org's book is on its way: the landing shows a skeleton in their
   place (KPI band, briefing, queue), and the real book settles in. This mounts
   the home with a connector whose read has not answered and asserts exactly
   that — the skeletons are present, and not one baked sample name is on screen.
   The hook's own suite proves the skeleton then clears; this proves the wiring
   reaches the surface. A share link (no connector) is the inverse and is
   covered by the render tests that mount the home without one.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
  delete (window as unknown as { claude?: unknown }).claude;
  vi.restoreAllMocks();
});

const DATA = sample as unknown as C360Data;

/** A connector whose portfolio read never answers, so the page stays on the
 *  cold-open skeleton for the length of the assertion. */
function installPendingMcp() {
  (window as unknown as { claude?: unknown }).claude = {
    mcp: {
      callTool: vi.fn(() => new Promise(() => {})),
      watchTool: vi.fn().mockReturnValue(() => {}),
      listTools: vi.fn(),
      invalidate: vi.fn(),
    },
  };
}

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AppProvider data={DATA}>
        <AppShell />
      </AppProvider>,
    );
  });
}

describe("the home cold-open skeleton", () => {
  it("shows the skeleton for the band, the briefing and the queue, not the baked samples", () => {
    installPendingMcp();
    mount();
    // The three flashing surfaces are all in their skeleton.
    expect(document.querySelector('[data-skeleton="kpi"]')).toBeTruthy();
    expect(document.querySelector('[data-skeleton="brief"]')).toBeTruthy();
    expect(document.querySelector('[data-skeleton="worklist"]')).toBeTruthy();
    // And none of the real surfaces underneath them are rendered: no KPI figure
    // cell, no assembled briefing verb, and not one real (non-skeleton) queue
    // row. The sample book that used to flash is simply not on this open.
    expect(document.querySelector("#kpiband .v")).toBeNull();
    expect(document.querySelector(".wlrow:not(.c360-skel-row)")).toBeNull();
    expect(document.querySelector(".wlrow.c360-skel-row")).toBeTruthy();
    expect(document.body.textContent).not.toContain("need you today");
  });

  it("shows the real landing, and no skeleton, when there is no connector", () => {
    // No window.claude: mcpAvailable() is false, so the page never boots and the
    // baked book renders exactly as a share link sees it.
    mount();
    expect(document.querySelector('[data-skeleton]')).toBeNull();
    expect(document.body.textContent).toContain("Sterling Fabrication");
  });
});
