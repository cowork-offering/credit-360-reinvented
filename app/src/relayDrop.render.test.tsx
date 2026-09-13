// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { C360Data } from "./data/contract";
import { AppProvider, useApp } from "./state/appState";
import { ConfirmGate } from "./components/ConfirmGate";
import { ASKING_AGAIN, EXECUTE_CLOCK_MS } from "./channel/writeTools";
import { WRITE_RETRY_BUDGET_MS } from "./channel/mcp";
import type { StagedOutput } from "./actions/stagedPlan";
import sample from "../../artifact/sample-data.json";

/* =============================================================================
   THE RELAY DROP, AT THE GATE (2026-09-13).

   The founder's cockpit, Hartwell: a long modification staged cleanly in the org
   and the page said "request failed (502)" twice. The room stopped there.

   This mounts the REAL write lane over a stubbed platform, so the retry ladder,
   the trail read and the gate's copy are all the shipping ones. Two shapes:

     1. the relay drops ONE answer. The gate says it is asking again, the same
        key goes back out, the org answers, and the banker is told it took two
        asks. Nothing is filed twice.
     2. the relay drops EVERY answer. The gate never says "this did not go
        through" over a write nobody has heard back about: it says what is known,
        keeps the way forward on screen, and that way forward reuses the key.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNT = "001bb00001DLtRMAA1";
const ACTION = "loan-modification";
const STAGING = "a5Xbb0000000001";

const DATA = {
  ...(sample as unknown as C360Data),
  meta: { ...(sample as unknown as C360Data).meta, userId: "005bb000001TESTAAA" },
} as C360Data;

const PLAN: StagedOutput = {
  stagingId: STAGING,
  planHash: "hash-1",
  decisionToken: "tok-1",
  accountId: ACCOUNT,
  summary: "Files a credit action against the selected facility.",
  steps: [],
  warnings: [],
  suggestions: [],
};

const UNAVAILABLE = { code: "server_unavailable", message: "request failed (502)" };

/** The org's own envelope for an execute that landed. */
const executed = (outputValues: unknown) => ({
  content: [{ actionName: "execute_loan_modification", errors: null, isSuccess: true, outputValues, sortOrder: 0, version: 1 }],
});

const EXECUTED_OK = executed({
  ok: true,
  error: null,
  result: {
    stagingId: STAGING,
    terminalState: "success",
    outcome: "The modification cloned the facility and the parent is unchanged.",
    recordName: "LOAN-0000456",
    steps: [{ id: "s1", type: "write", label: "Clone the facility", state: "verified" }],
  },
});

/** One trail row, as Customer360ActionHistory returns it. */
const trail = (status: string) => ({
  content: [
    {
      actionName: "Customer360ActionHistory",
      errors: null,
      isSuccess: true,
      outputValues: { accountId: ACCOUNT, count: 1, entries: [{ stagingId: STAGING, actionId: ACTION, status }] },
      sortOrder: 0,
      version: 1,
    },
  ],
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const confirmed = vi.fn();

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

/** Stub the platform, answering per tool. */
function installPlatform(answer: (tool: string) => unknown) {
  const callTool = vi.fn(async (_server: string, tool: string) => {
    const out = answer(tool);
    if (out && typeof out === "object" && "code" in (out as Record<string, unknown>)) throw out;
    return { payload: out };
  });
  w.claude = { mcp: { callTool, watchTool: vi.fn(), listTools: vi.fn(), invalidate: vi.fn() } };
  return callTool;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  delete w.claude;
  vi.useRealTimers();
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

async function confirm(el: HTMLElement) {
  const button = [...el.querySelectorAll("button")].find((b) => /Confirm and file/i.test(b.textContent || ""));
  expect(button).toBeTruthy();
  await act(async () => {
    button!.click();
  });
}

describe("the gate when the relay drops one answer", () => {
  it("says it is asking again, then files on the second ask", async () => {
    let n = 0;
    const callTool = installPlatform((tool) => {
      if (!tool.startsWith("execute_")) return trail("Staged");
      return ++n === 1 ? UNAVAILABLE : EXECUTED_OK;
    });
    const el = render();
    await confirm(el);

    // Between the two asks the banker is told what is happening, in the room's
    // own words rather than a spinner.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(el.querySelector("[data-asking]")).toBeTruthy();
    expect(el.textContent).toContain(ASKING_AGAIN);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 100);
    });
    expect(confirmed).toHaveBeenCalledTimes(1);
    const [, result, note] = confirmed.mock.calls[0];
    expect(result.terminalState).toBe("success");
    expect(note).toContain("second ask");
    // TWO asks, and the same five fields on both: a second row is impossible.
    const executes = callTool.mock.calls.filter((c) => String(c[1]).startsWith("execute_")) as unknown as unknown[][];
    expect(executes).toHaveLength(2);
    const sentOn = (call: unknown[]) => (call[2] as { inputs: Array<Record<string, unknown>> }).inputs[0];
    expect(sentOn(executes[0])).toEqual(sentOn(executes[1]));
    // And the asking line is gone once it settled.
    expect(el.querySelector("[data-asking]")).toBeNull();
  });
});

describe("the gate when the relay drops every answer", () => {
  it("never calls it a failure, says what is known, and keeps a way forward that reuses the key", async () => {
    const callTool = installPlatform((tool) => (tool.startsWith("execute_") ? UNAVAILABLE : trail("Executing")));
    const el = render();
    await confirm(el);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + EXECUTE_CLOCK_MS + 5_000);
    });

    expect(confirmed).not.toHaveBeenCalled();
    expect(el.textContent).toContain("The answer did not come back");
    // The sentence that files a facility twice.
    expect(el.textContent).not.toContain("This did not go through");
    expect(el.textContent).toContain("still working");
    expect(el.textContent).toContain("(server_unavailable: request failed (502))");

    const again = el.querySelector("[data-try-again]") as HTMLButtonElement | null;
    expect(again).toBeTruthy();

    const before = callTool.mock.calls.filter((c) => String(c[1]).startsWith("execute_")).length;
    expect(before).toBe(1); // the trail said Executing, so the ladder stopped at one
    await act(async () => {
      again!.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const sent = callTool.mock.calls.filter((c) => String(c[1]).startsWith("execute_")) as unknown as unknown[][];
    expect(sent.length).toBeGreaterThan(before);
    // THE SAME KEY, the same stagingId and the same token: asking again cannot
    // file a second time, which is the only reason this chip may exist at all.
    const sentOn = (call: unknown[]) => (call[2] as { inputs: Array<Record<string, unknown>> }).inputs[0];
    expect(sentOn(sent[sent.length - 1])).toEqual(sentOn(sent[0]));
  });
});
