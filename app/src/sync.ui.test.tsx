// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearOverlays } from "./state/syncOverlay";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { C360Data } from "./data/contract";
import { AppProvider } from "./state/appState";
import { AppShell } from "./components/AppShell";
import { TOOLS } from "./channel/mcp";
import { prefersReducedMotion } from "./data/motion";
import { compilePace, COMPILE_PACE } from "./actions/compile";
import sample from "../../artifact/sample-data.json";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATA = sample as unknown as C360Data;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  delete (window as unknown as { claude?: unknown }).claude;
  vi.useRealTimers();
  vi.restoreAllMocks();
  try {
    sessionStorage.clear();
    // The sync overlay persists to localStorage by design; one test's sync must
    // not restore itself into the next test's mount.
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
      </AppProvider>,
    );
  });
  return container;
}

const buttons = () => [...document.body.querySelectorAll("button")];
const byText = (re: RegExp) => buttons().find((b) => re.test(b.textContent ?? ""));
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const openRow = (name: string) =>
  [...document.querySelectorAll('[role="button"]')].find((r) => r.textContent?.includes(name))!;

const envelope = (outputValues: unknown) => ({
  payload: { content: [{ actionName: "t", errors: null, isSuccess: true, outputValues, sortOrder: 0, version: 1 }] },
});

/** A live connector whose Exposure read returns a MOVED drawn balance. */
function installMcp(exposure?: Record<string, unknown>) {
  const callTool = vi.fn(async (_server: string, tool: string) => {
    if (tool === TOOLS.mailSearch) return { payload: { value: [] } };
    if (tool === TOOLS.actionHistory) return envelope({ rows: [] });
    if (tool === TOOLS.exposure && exposure) return envelope(exposure);
    return envelope({});
  });
  (window as unknown as { claude?: unknown }).claude = {
    mcp: { callTool, watchTool: vi.fn().mockReturnValue(() => {}), listTools: vi.fn(), invalidate: vi.fn() },
  };
  return callTool;
}

describe("the sync trigger lives in the account header", () => {
  /* The Client Actions button this used to sit beside is RETIRED (founder call,
     2026-08-31 night): the > FAB arc owns client actions and Sync is the hero's
     one quiet secondary control. The contract that mattered is unchanged and
     still asserted — Sync is in the hero's name row, not on a tab. */
  it("is the hero's one control, on the name row and not on the Activity tab", () => {
    installMcp();
    mount();
    click(openRow("Sterling Fabrication"));
    const sync = byText(/^Sync$/)!;
    expect(sync).toBeTruthy();
    expect(sync.closest(".hero")).toBeTruthy();
    expect(sync.closest(".acct-name-row")).toBeTruthy();
    /* ONE CONTROL, still. The hero gained an "As of" caption beside Sync when
       the figures on screen are baked or stored rather than live, and a caption
       is not a control: the rule the founder set is about what a banker can
       press here, and Sync is still the only thing. */
    expect(sync.parentElement!.querySelectorAll("button, a, input, select")).toHaveLength(1);
    expect(sync.parentElement!.textContent).toContain("As of");
    expect(document.getElementById("c360-client-actions-trigger")).toBeNull();
  });

  it("retired the separate refresh and inbox controls", () => {
    installMcp();
    mount();
    click(openRow("Sterling Fabrication"));
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Refresh from org");
    expect(text).not.toContain("Check my inbox");
  });

  it("is absent with no connector, rather than an inert button", () => {
    mount();
    click(openRow("Sterling Fabrication"));
    expect(byText(/^Sync$/)).toBeUndefined();
  });
});

describe("the sweep", () => {
  it("disables the button while it runs and re-enables it after", async () => {
    vi.useFakeTimers();
    installMcp();
    mount();
    click(openRow("Sterling Fabrication"));
    const sync = byText(/^Sync$/)!;
    click(sync);
    expect(byText(/Syncing/)!.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(byText(/^Sync$/)!.hasAttribute("disabled")).toBe(false);
  });

  it("shows one console line per real read and lifts the scrim afterwards", async () => {
    vi.useFakeTimers();
    installMcp();
    mount();
    click(openRow("Sterling Fabrication"));
    click(byText(/^Sync$/)!);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const console = document.querySelector('[role="status"]')!;
    expect(console.textContent).toContain("Exposure and collateral");
    expect(console.textContent).toContain("Your inbox for this relationship");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it("pulses a figure the sync actually changed, where it already sits", async () => {
    vi.useFakeTimers();
    const staged = (DATA.borrowers ?? {})["001SAMPLE0000STRL"];
    installMcp({ ...staged?.exposure, totalOutstanding: (staged?.exposure?.totalOutstanding ?? 0) + 1_000_000 });
    mount();
    click(openRow("Sterling Fabrication"));
    click(byText(/Exposure & Collateral/)!);
    click(byText(/^Sync$/)!);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    const cell = document.querySelector('[data-delta="exposure.totalOutstanding"]')!;
    expect(cell.className).toContain("c360-pulse");
    // Unchanged figures stay quiet.
    expect(document.querySelector('[data-delta="exposure.totalCommitted"]')!.className).not.toContain("c360-pulse");
  });

  it("says so when nothing moved", async () => {
    vi.useFakeTimers();
    const staged = (DATA.borrowers ?? {})["001SAMPLE0000STRL"];
    installMcp({ ...staged?.exposure });
    mount();
    click(openRow("Sterling Fabrication"));
    click(byText(/^Sync$/)!);

    await act(async () => {
      // Nine paced lines land at ~4.05s; the report is held on the console for
      // 900ms after that, so read it inside that window.
      await vi.advanceTimersByTimeAsync(4_500);
    });
    const status = document.querySelector('[role="status"]')?.textContent ?? "";
    expect(status).toContain("Everything current, nothing new.");
    /* REACHABILITY LEADS THE SUMMARY. "Everything current" on its own was read
       as an all-clear even when a line had quietly failed, which is how a
       transient covenant read came to look like a failing covenant position. */
    expect(status).toContain("Reachable, 9 lines refreshed.");
  });

  it("keeps the workspace when a read fails", async () => {
    vi.useFakeTimers();
    const callTool = vi.fn(async (_server: string, tool: string) => {
      if (tool === TOOLS.exposure) throw { code: "upstream_error", message: "boom" };
      if (tool === TOOLS.mailSearch) return { payload: { value: [] } };
      if (tool === TOOLS.actionHistory) return envelope({ rows: [] });
      return envelope({});
    });
    (window as unknown as { claude?: unknown }).claude = {
      mcp: { callTool, watchTool: vi.fn().mockReturnValue(() => {}), listTools: vi.fn(), invalidate: vi.fn() },
    };
    mount();
    click(openRow("Sterling Fabrication"));
    click(byText(/Exposure & Collateral/)!);
    const before = document.querySelector('[data-delta="exposure.totalCommitted"]')!.textContent;
    click(byText(/^Sync$/)!);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    // The scrim lifted and the figure the failed read would have carried is
    // still the last-good one.
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.querySelector('[data-delta="exposure.totalCommitted"]')!.textContent).toBe(before);
  });
});

describe("reduced motion", () => {
  const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

  it("stops the sweep spinner and the pulse outright, rather than running them fast", () => {
    expect(reduced).toContain(".c360-sync-spin");
    expect(reduced).toContain(".c360-pulse");
    expect(reduced).toContain("animation: none !important");
  });

  it("collapses the stepper slide, the execution reveal and the option sheet", () => {
    expect(reduced).toContain(".c360-step-in");
    expect(reduced).toContain(".c360-row-land");
    expect(reduced).toContain(".c360-sheet-in");
  });

  it("collapses SEQUENCE pacing, so lines resolve as fast as the work", () => {
    // jsdom has no matchMedia, which the motion guard reads as reduced motion.
    // Every compile-sequence UI test above therefore lands on the plan inside a
    // single macrotask: with pacing applied, four lines would cost ~1.8s.
    expect(prefersReducedMotion()).toBe(true);
    expect(compilePace()).toBe(0);
    expect(compilePace(false)).toBe(COMPILE_PACE);
  });

  it("animates the pulse with colour only, so nothing moves or reflows", () => {
    const block = css.slice(css.indexOf("@keyframes c360-pulse"), css.indexOf("}\n.c360-pulse"));
    expect(block).not.toMatch(/transform|translate|width|height|margin|padding/);
  });
});
