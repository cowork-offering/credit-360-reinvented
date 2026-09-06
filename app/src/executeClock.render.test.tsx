// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { C360Data } from "./data/contract";
import { AppProvider, useApp } from "./state/appState";
import { ConfirmGate, EXECUTE_CLOCK_MS, UNSETTLED_TITLE } from "./components/ConfirmGate";
import type { StagedOutput } from "./actions/stagedPlan";
import sample from "../../artifact/sample-data.json";

/* =============================================================================
   THE EXECUTE CLOCK: a limit on WAITING, never a verdict on the write.

   THE DEFECT. `callTool` bounds a write at sixty seconds and marks the result
   AMBIGUOUS, which is the honest transport answer; the gate then rendered it in
   critical ink under "This did not go through". Over a write that landed, that
   sentence is worse than no sentence: the banker files it again, and a
   duplicated facility is the one thing this cockpit cannot take back.

   So the gate keeps its own shorter clock, and what it does when the clock runs
   out is the whole point. Three things are asserted:

     1. before the clock, nothing changes, a slow org is not a broken one;
     2. at the clock, the banker is told the ORG HAS NOT ANSWERED, in warning
        ink, with the words "did not go through" nowhere on the screen;
     3. the call is still running, so an answer arriving late is taken and the
        notice is replaced by the real outcome.
   ============================================================================= */

const executeAction = vi.hoisted(() => vi.fn());
vi.mock("./channel/writeTools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./channel/writeTools")>()),
  executeAction,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNT = "001bb00001DLtRMAA1";
const ACTION = "loan-modification";

/** The gate refuses to execute without a Salesforce user id for the running
 *  human, which is the whole point of the staged-plan pattern. */
const DATA = {
  ...(sample as unknown as C360Data),
  meta: { ...(sample as unknown as C360Data).meta, userId: "005bb000001TESTAAA" },
} as C360Data;

const PLAN: StagedOutput = {
  stagingId: "a5Xbb0000000001",
  planHash: "hash-1",
  decisionToken: "tok-1",
  summary: "Files a credit action against the selected facility.",
  steps: [],
  warnings: [],
  suggestions: [],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

beforeEach(() => {
  vi.useFakeTimers();
  // A live connector, so the gate takes the executing path rather than the
  // fail-closed one it takes with no capability at all.
  w.claude = { mcp: { callTool: vi.fn(), watchTool: vi.fn(), listTools: vi.fn(), invalidate: vi.fn() } };
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  delete w.claude;
  vi.useRealTimers();
  executeAction.mockReset();
  confirmed.mockReset();
});

function Opener({ children }: { children: ReactNode }) {
  const { dispatch } = useApp();
  useEffect(() => dispatch({ type: "OPEN_ACCOUNT", accountId: ACCOUNT }), [dispatch]);
  return <>{children}</>;
}

function render(): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AppProvider data={DATA}>
        <Opener>
          <ConfirmGate actionId={ACTION} plan={PLAN} simulated={false} onBack={() => {}} onConfirmed={confirmed} />
        </Opener>
      </AppProvider>,
    );
  });
  return container;
}

const confirmed = vi.fn();

/** Press the one button that files. */
async function confirm(el: HTMLElement) {
  const button = [...el.querySelectorAll("button")].find((b) => /Confirm and file/i.test(b.textContent || ""));
  expect(button).toBeTruthy();
  await act(async () => {
    button!.click();
  });
}

describe("the execute clock", () => {
  it("says nothing while the org is merely slow", async () => {
    executeAction.mockReturnValue(new Promise(() => {}));
    const el = render();
    await confirm(el);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXECUTE_CLOCK_MS - 1_000);
    });
    expect(el.querySelector("[data-unsettled]")).toBeNull();
    // And the banker can see it is still working rather than nothing at all.
    expect(el.textContent).toContain("Working");
  });

  it("says the org has not answered, and never that it failed", async () => {
    executeAction.mockReturnValue(new Promise(() => {}));
    const el = render();
    await confirm(el);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXECUTE_CLOCK_MS + 100);
    });

    expect(el.querySelector("[data-unsettled]")).not.toBeNull();
    expect(el.textContent).toContain(UNSETTLED_TITLE);
    // THE SENTENCE THAT MUST NEVER APPEAR over a write nobody has ruled on.
    expect(el.textContent).not.toContain("This did not go through");
    // Nothing was reported as filed either: the outcome is unknown both ways.
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("takes a late answer and replaces the notice with it", async () => {
    let land: (v: unknown) => void = () => {};
    executeAction.mockReturnValue(new Promise((resolve) => { land = resolve; }));
    const el = render();
    await confirm(el);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXECUTE_CLOCK_MS + 100);
    });
    expect(el.querySelector("[data-unsettled]")).not.toBeNull();

    // The org comes back a minute later. The write DID land, and the gate has
    // to be able to say so rather than leaving the banker on a warning.
    await act(async () => {
      land({ ok: true, result: { stagingId: PLAN.stagingId, terminalState: "completed", outcome: "completed", replayed: false, steps: [], recordName: "MOD-0042", anchorName: null } });
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(el.querySelector("[data-unsettled]")).toBeNull();
    expect(confirmed).toHaveBeenCalled();
  });

  it("takes a late refusal as a refusal, once", async () => {
    let refuse: (e: unknown) => void = () => {};
    executeAction.mockReturnValue(new Promise((_resolve, reject) => { refuse = reject; }));
    const el = render();
    await confirm(el);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXECUTE_CLOCK_MS + 100);
    });
    await act(async () => {
      refuse({ code: "FIELD_CUSTOM_VALIDATION_EXCEPTION", message: "the org refused" });
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(el.querySelector("[data-unsettled]")).toBeNull();
    expect(el.textContent).toContain("the org refused");
    expect(confirmed).not.toHaveBeenCalled();
  });
});
