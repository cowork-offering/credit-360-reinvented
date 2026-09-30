// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { C360Data } from "./data/contract";
import { AppProvider, useApp } from "./state/appState";
import { GovernedStage } from "./components/GovernedStage";
import {
  STAGE_IN_FLIGHT,
  STAGE_LATE,
  STAGE_LATE_BODY,
  STAGE_LATE_TITLE,
  STAGE_STILL,
  STAGE_WAIT,
  UNSETTLED_TITLE,
} from "./components/ConfirmGate";
import { STAGE_CEILING_MS } from "./components/governedConfirm";
import { DISCARD_ACTION_ID, DISCARD_LABEL, DISCARD_OBJECT_TITLES } from "./actions/discardVersion";
import { recordIdsIn, type StagedOutput } from "./actions/stagedPlan";
import { ASKING_AGAIN, EXECUTE_CLOCK_MS, RUN_IN_FLIGHT, type ExecuteOutcome, type ExecuteResult, type WriteCallOptions } from "./channel/writeTools";
import sample from "../../artifact/sample-data.json";
import STG168 from "./__fixtures__/discard/stage-discard-version-stg168.json";

/* =============================================================================
   THE STAGE WHILE SALESFORCE WORKS (0.9.33, row 78).

   knowledge/DESIGN-0.9.33-STAGE-WAIT.md. Between the press and the org's answer
   no row moves, because the org commits the discard in one transaction and has
   reported nothing. The sheet says it is listening (the lens pass) and how long
   it has been (the clock). Nothing turns amber before the ceiling, and
   RUN_IN_FLIGHT, the org's own report that the run is going, is never an error.

   The plan is the org's live Sunbelt answer through the real unwrapper; the
   execute is held open under fake timers so every second of the wait is seen.
   jsdom has no matchMedia, which the page reads as reduced motion.
   ============================================================================= */

const callTool = vi.hoisted(() => vi.fn());
vi.mock("./channel/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./channel/mcp")>()),
  callTool,
  mcpAvailable: () => true,
}));

const executeAction = vi.hoisted(() => vi.fn());
vi.mock("./channel/writeTools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./channel/writeTools")>()),
  executeAction,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNT = "001bb00001DLtRMAA1";
const DATA = {
  ...(sample as unknown as C360Data),
  meta: { ...(sample as unknown as C360Data).meta, user: "Fabian Goetzens", userId: "005bb000001TESTAAA" },
} as C360Data;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  callTool.mockReset();
  executeAction.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  delete document.body.dataset.c360Stage;
  vi.useRealTimers();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

async function livePlan(): Promise<StagedOutput> {
  callTool.mockResolvedValue({ payload: { content: STG168 } });
  const { stageAction } = await import("./channel/writeTools");
  const out = await stageAction(DISCARD_ACTION_ID as never, {
    idempotencyKey: "key-stg168",
    rationale: "Forked by mistake.",
    versionPackageId: "a5Fbb000000JIR3EAO",
  } as never);
  if (!out.ok) throw new Error(`the fixture did not unwrap: ${out.error.code}`);
  return out.result;
}

/* THE HARTWELL ROLLBACK, STG-0000000183 (2026-09-29), in the org's own order:
   two self-anchor notes, THEN the count line. The build used to take the first
   warning as the count line and led the sheet with a note about RL-00000831. */
const HARTWELL_WARNINGS = [
  "Self-anchor chain row RL-00000831 on Hartwell Precision Manufacturing LLC - Purchase - $6,500,000.00 predates this version and is left in place. It does not feed the hasRenewal rollup, and it is not ours to delete.",
  "Self-anchor chain row RL-00000832 on Hartwell Precision Manufacturing LLC - Equipment - $1,500,000.00 predates this version and is left in place. It does not feed the hasRenewal rollup, and it is not ours to delete.",
  "This action DELETES 17 records. Nothing outside the list above is touched: the booked package, the booked facilities, the collateral assets and their ownership junctions, and the covenant records all stay exactly as they are.",
  "After the discard, Hartwell Precision Manufacturing LLC - Purchase - $6,500,000.00, Hartwell Precision Manufacturing LLC - Equipment - $1,500,000.00 will read hasRenewal false and be available to fork again. That is verified by re-query, not assumed.",
];

async function hartwellPlan(): Promise<StagedOutput> {
  return { ...(await livePlan()), warnings: HARTWELL_WARNINGS };
}

/** The executor's answer when every group settles, in the banker wording the
 *  org's `verify_version_gone` now uses (the package name, never its id). */
function ranClean(plan: StagedOutput): ExecuteResult {
  return {
    stagingId: plan.stagingId,
    terminalState: "success",
    outcome: "The version was discarded.",
    steps: plan.steps.map((s) => ({
      id: s.id,
      type: s.type,
      label: s.label,
      state: s.type === "observed_side_effect" ? "filed_unverified" : "verified",
      detail:
        s.id === "verify_parents"
          ? "Hartwell Precision Manufacturing LLC - Purchase - $6,500,000.00 reads hasRenewal false and can be forked again."
          : s.id === "verify_version_gone"
            ? "The version package Hartwell Precision Manufacturing LLC - 9/22/2026 - PP no longer resolves."
            : s.id === "withdraw_trail"
              ? "STG-0000000183 marked Withdrawn."
              : s.id === "observe_aggregates"
                ? "None was left standing."
                : undefined,
    })),
  };
}

function Opener({ children }: { children: ReactNode }) {
  const { dispatch } = useApp();
  useEffect(() => dispatch({ type: "OPEN_ACCOUNT", accountId: ACCOUNT }), [dispatch]);
  return <>{children}</>;
}

function stage(plan: StagedOutput) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AppProvider data={DATA}>
        <Opener>
          <GovernedStage
            plan={plan}
            actionId={DISCARD_ACTION_ID}
            title="Discard the version Hartwell Precision Manufacturing LLC - 9/22/2026 - PP"
            objectTitles={DISCARD_OBJECT_TITLES}
            commitLabel={DISCARD_LABEL}
            simulated={false}
            idempotencyKey="key-stg183"
            backLabel="Back to Hartwell Precision Manufacturing LLC"
            onConfirmed={() => {}}
            onClose={() => {}}
          />
        </Opener>
      </AppProvider>,
    );
  });
}

const sheet = () => document.querySelector(".gs-sheet")!;
const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const line = () => text(document.querySelector(".gs-wait-line"));
const clock = () => text(document.querySelector(".gs-wait-clock"));
const rowStates = () => [...document.querySelectorAll<HTMLElement>(".gs-row")].map((r) => r.dataset.state);
const warningInk = () => document.querySelectorAll('.gs-notice[data-tone="warning"], .gs-notice[data-tone="critical"]');

/** Holds the execute open until the test answers it. */
function holdExecute() {
  const held: { answer: (o: ExecuteOutcome) => void; opts: WriteCallOptions } = {
    answer: () => {},
    opts: {},
  };
  executeAction.mockImplementation(
    (_id: string, _payload: unknown, opts: WriteCallOptions) =>
      new Promise<ExecuteOutcome>((resolve) => {
        held.answer = resolve;
        held.opts = opts;
      }),
  );
  return held;
}

async function press() {
  const pill = document.querySelector<HTMLButtonElement>('[data-commit="stage"]')!;
  await act(async () => {
    pill.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function answer(held: ReturnType<typeof holdExecute>, outcome: ExecuteOutcome) {
  await act(async () => {
    held.answer(outcome);
    await vi.advanceTimersByTimeAsync(0);
  });
}

/* ================================================================== the wait */

describe("the wait, between the press and the answer", () => {
  it("says Salesforce has it, counts the clock, and moves no row", async () => {
    const plan = await hartwellPlan();
    vi.useFakeTimers();
    holdExecute();
    stage(plan);
    // Before the press there is no clock and no line.
    expect(clock()).toBe("");
    expect(sheet().hasAttribute("data-wait")).toBe(false);

    await press();
    expect(sheet().getAttribute("data-phase")).toBe("wait");
    expect(sheet().hasAttribute("data-wait")).toBe(true);
    expect(document.querySelector(".gs-wait")!.hasAttribute("data-on")).toBe(true);
    expect(line()).toBe(STAGE_WAIT);
    expect(clock()).toBe("0:00");
    // The lens pass is one layer over the whole list, never inside a row.
    expect(document.querySelector(".gs-rows-wrap > .gs-sweep")).toBeTruthy();
    expect(document.querySelector(".gs-row .gs-sweep")).toBeNull();

    await wait(5_000);
    expect(clock()).toBe("0:05");
    await wait(30_000);
    expect(clock()).toBe("0:35");
    // No row is marked writing, verified or gone: the org has reported nothing.
    expect(rowStates().every((s) => s === "queued")).toBe(true);
    expect(text(document.querySelector(".gs-colhead span"))).toBe("The inventory, as the org grouped it");
    expect(document.querySelectorAll(".gs-notice")).toHaveLength(0);
  });

  it("changes the line at 45 s, in the same register, and raises no notice", async () => {
    const plan = await hartwellPlan();
    vi.useFakeTimers();
    holdExecute();
    stage(plan);
    await press();
    await wait(EXECUTE_CLOCK_MS - 1_000);
    expect(line()).toBe(STAGE_WAIT);
    await wait(1_000);
    expect(line()).toBe(STAGE_STILL);
    expect(clock()).toBe("0:45");
    // The gate's 45 s notice is not the stage's: the call is open and a long
    // wait is not news yet.
    expect(document.querySelector("[data-unsettled]")).toBeNull();
    expect(text(sheet())).not.toContain(UNSETTLED_TITLE);
    expect(warningInk()).toHaveLength(0);
    expect(rowStates().every((s) => s === "queued")).toBe(true);
  });

  it("puts nothing in warning ink before the ceiling, and the late notice at 2:30", async () => {
    const plan = await hartwellPlan();
    vi.useFakeTimers();
    holdExecute();
    stage(plan);
    await press();
    for (let t = 0; t < 140_000; t += 10_000) {
      expect(warningInk()).toHaveLength(0);
      await wait(10_000);
    }
    await wait(STAGE_CEILING_MS - 140_000 - 1_000);
    expect(clock()).toBe("2:29");
    expect(warningInk()).toHaveLength(0);

    await wait(1_000);
    expect(clock()).toBe("2:30");
    const late = document.querySelector('.gs-notice[data-tone="warning"][data-late]');
    expect(late).toBeTruthy();
    expect(text(late)).toBe(`${STAGE_LATE_TITLE}${STAGE_LATE_BODY}`);
    // The line shortens so the notice is the one place the news lives, and the
    // notice never repeats the elapsed time the clock already shows.
    expect(line()).toBe(STAGE_LATE);
    expect(text(late)).not.toMatch(/\d:\d\d/);
    // The light keeps going: the call is still open.
    expect(sheet().hasAttribute("data-wait")).toBe(true);
    expect(rowStates().every((s) => s === "queued")).toBe(true);
  });

  it("says the same key is going back out as the wait line, never as a warning notice", async () => {
    const plan = await hartwellPlan();
    vi.useFakeTimers();
    const held = holdExecute();
    stage(plan);
    await press();
    await act(async () => held.opts.onAttempt?.(2));
    expect(line()).toBe(ASKING_AGAIN);
    expect(document.querySelector("[data-asking]")).toBeNull();
    expect(warningInk()).toHaveLength(0);
    // For one lens pass, then the plain line again.
    await wait(5_000);
    expect(line()).toBe(STAGE_WAIT);
  });
});

describe("refused after the press", () => {
  it("brings the org's words and both controls back, never a silent sheet", async () => {
    const plan = await hartwellPlan();
    vi.useFakeTimers();
    const held = holdExecute();
    stage(plan);
    await press();
    await act(async () =>
      held.answer({
        ok: false,
        attempts: 1,
        error: { code: "ORG_REJECTED_WRITE", message: "The org refused the delete.", resumable: true },
      } as ExecuteOutcome),
    );
    const foot = document.querySelector(".gs-foot")!;
    expect(foot.hasAttribute("data-quiet")).toBe(false);
    expect(foot.querySelector('.gs-notice[data-tone="critical"]')?.textContent).toContain("This did not go through");
    expect(foot.querySelector('[data-commit="stage"]')).not.toBeNull();
    expect(document.querySelector("[data-wait]")).toBeNull();
    expect(document.querySelectorAll(".gs-row[data-state=\"writing\"]")).toHaveLength(0);
  });
});

/* ============================================================ RUN_IN_FLIGHT */

describe("RUN_IN_FLIGHT: the org reports the run still going", () => {
  it("is the org's own line, never a notice and never an error", async () => {
    const plan = await hartwellPlan();
    vi.useFakeTimers();
    const held = holdExecute();
    stage(plan);
    await press();
    await wait(50_000);
    await act(async () => held.opts.onInFlight?.());
    expect(line()).toBe(STAGE_IN_FLIGHT);
    expect(document.querySelectorAll(".gs-notice")).toHaveLength(0);

    // The watch budget runs out with the trail still Executing: the lane hands
    // back pending under the org's code, and the stage keeps waiting.
    await answer(held, {
      ok: false,
      attempts: 1,
      pending: true,
      error: { code: RUN_IN_FLIGHT, message: "Another transaction holds this run.", resumable: true },
    });
    expect(sheet().hasAttribute("data-wait")).toBe(true);
    expect(line()).toBe(STAGE_IN_FLIGHT);
    expect(document.querySelectorAll(".gs-notice")).toHaveLength(0);
    expect(text(sheet())).not.toContain(RUN_IN_FLIGHT);
    expect(text(sheet())).not.toContain("This did not go through");
    expect(clock()).toBe("0:50");
  });

  it("settles normally when the trail turns terminal, through the real write lane", async () => {
    const plan = await hartwellPlan();
    const real = await vi.importActual<typeof import("./channel/writeTools")>("./channel/writeTools");
    executeAction.mockImplementation(real.executeAction);
    let completed = false;
    const done = ranClean(plan);
    callTool.mockImplementation(async (_server: string, tool: string) => {
      if (String(tool).startsWith("execute_")) {
        return {
          payload: {
            content: [
              {
                actionName: tool,
                errors: null,
                isSuccess: true,
                outputValues: { ok: false, result: null, error: { code: RUN_IN_FLIGHT, message: "Another transaction holds this run." } },
                sortOrder: 0,
                version: 1,
              },
            ],
          },
        };
      }
      return {
        payload: {
          content: [
            {
              actionName: "Customer360ActionHistory",
              errors: null,
              isSuccess: true,
              outputValues: {
                accountId: plan.accountId,
                count: 1,
                entries: [
                  {
                    stagingId: plan.stagingId,
                    actionId: DISCARD_ACTION_ID,
                    status: completed ? "Completed" : "Executing",
                    steps: completed
                      ? done.steps.map((s) => ({ id: s.id, type: s.type, label: s.label, state: s.state, verification: s.detail }))
                      : undefined,
                  },
                ],
              },
              sortOrder: 0,
              version: 1,
            },
          ],
        },
      };
    });
    vi.useFakeTimers();
    stage(plan);
    await press();
    expect(line()).toBe(STAGE_IN_FLIGHT);
    expect(document.querySelectorAll(".gs-notice")).toHaveLength(0);

    await wait(9_000);
    expect(sheet().hasAttribute("data-wait")).toBe(true);
    expect(rowStates().every((s) => s === "queued")).toBe(true);

    completed = true;
    await wait(3_000);
    // The trail turned Completed: the ending lands, off the org's own tracker.
    expect(sheet().hasAttribute("data-wait")).toBe(false);
    expect(sheet().getAttribute("data-phase")).toBe("close");
    expect(rowStates().every((s) => s === "gone")).toBe(true);
    expect(text(document.querySelector(".gs-said"))).toContain("no longer resolves");
    expect(document.querySelectorAll(".gs-notice")).toHaveLength(0);
  });
});

/* ================================================================ the answer */

describe("the answer lands", () => {
  it("under reduced motion: no light, and the whole ending in the same commit as the answer", async () => {
    const plan = await hartwellPlan();
    vi.useFakeTimers();
    const held = holdExecute();
    stage(plan);
    await press();
    await wait(112_000);
    expect(clock()).toBe("1:52");
    await answer(held, { ok: true, attempts: 1, result: ranClean(plan) });

    expect(sheet().hasAttribute("data-wait")).toBe(false);
    expect(sheet().getAttribute("data-phase")).toBe("close");
    expect(rowStates().every((s) => s === "gone")).toBe(true);
    expect(document.querySelector(".gs-after")!.hasAttribute("data-on")).toBe(true);
    expect(document.querySelectorAll(".gs-said p")).toHaveLength(3);
    // The clock stops and its time moves into the line, which folds with the
    // header on the close.
    expect(clock()).toBe("");
    expect(line()).toBe("Salesforce answered after 1:52.");
    expect(document.querySelector(".gs-hd")!.hasAttribute("data-quiet")).toBe(true);

    // Reduced motion lights nothing: the stylesheet takes the lens pass away
    // and every fade the wait added, and leaves the clock alone.
    const css = readFileSync(resolve(__dirname, "styles/stage.css"), "utf8");
    const reducedBlock = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reducedBlock).toMatch(/\.gs-sweep\s*\{\s*display:\s*none;/);
    expect(reducedBlock).toMatch(/\.gs-wait,\s*\.gs-wait-line,\s*\.gs-late\s*\{\s*transition:\s*none !important;/);
    expect(reducedBlock.slice(0, reducedBlock.indexOf("/* ----"))).not.toContain("gs-wait-clock");
  });

  it("with motion: the light goes, and the unchanged reveal starts T.toFirst later under the new heading", async () => {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
    const plan = await hartwellPlan();
    vi.useFakeTimers();
    const held = holdExecute();
    stage(plan);
    await press();
    await wait(20_000);
    expect(sheet().hasAttribute("data-wait")).toBe(true);
    await answer(held, { ok: true, attempts: 1, result: ranClean(plan) });

    // The same commit that carries the answer drops the light and hands the
    // list to the reveal; no row has moved yet.
    expect(sheet().hasAttribute("data-wait")).toBe(false);
    expect(sheet().getAttribute("data-phase")).toBe("run");
    expect(text(document.querySelector(".gs-colhead span"))).toBe("As Salesforce reports it");
    expect(rowStates().every((s) => s === "queued")).toBe(true);
    expect(line()).toBe("Salesforce answered after 0:20.");

    await wait(559);
    expect(rowStates().every((s) => s === "queued")).toBe(true);
    await wait(1);
    expect(rowStates()[0]).toBe("writing");
    expect(rowStates().slice(1).every((s) => s === "queued")).toBe(true);
  });
});

/* ============================================= what reaches the glass, by eye */

describe("the org's count line, and no record id on the glass", () => {
  it("leads with the org's DELETES sentence wherever the org put it, and keeps the rest in the foot", async () => {
    stage(await hartwellPlan());
    const ledes = [...document.querySelectorAll(".gs-hd .gs-lede")].map(text);
    expect(ledes).toEqual([HARTWELL_WARNINGS[2]]);
    const foot = text(document.querySelector(".gs-notes"));
    expect(foot).toContain("RL-00000831");
    expect(foot).toContain("RL-00000832");
    expect(foot).toContain("will read hasRenewal false");
    // Said once: the count line is not in the foot as well.
    expect(foot).not.toContain("DELETES 17 records");
  });

  it("renders no count line for a plan that carries no DELETES sentence", async () => {
    stage({ ...(await livePlan()), warnings: [HARTWELL_WARNINGS[0]] });
    expect(document.querySelectorAll(".gs-hd .gs-lede")).toHaveLength(0);
    expect(text(document.querySelector(".gs-notes"))).toContain("RL-00000831");
  });

  it("shows no Salesforce-id-shaped token through the plan, the wait and the close", async () => {
    const plan = await hartwellPlan();
    // The fixture's own ids are what would leak.
    expect(recordIdsIn(`${plan.stagingId} ${plan.accountId}`)).toHaveLength(2);
    vi.useFakeTimers();
    const held = holdExecute();
    stage(plan);
    expect(recordIdsIn(text(sheet()))).toEqual([]);
    await press();
    await wait(50_000);
    expect(recordIdsIn(text(sheet()))).toEqual([]);
    await answer(held, { ok: true, attempts: 1, result: ranClean(plan) });
    expect(sheet().getAttribute("data-phase")).toBe("close");
    const closed = text(sheet());
    expect(closed).toContain("Hartwell Precision Manufacturing LLC - 9/22/2026 - PP no longer resolves.");
    expect(closed).toMatch(/Plan [0-9a-f]{8} · confirmed by Fabian Goetzens/);
    expect(recordIdsIn(closed)).toEqual([]);
    // And no em dash anywhere the wait speaks.
    expect(closed).not.toMatch(/\u2014/);
  });
});
