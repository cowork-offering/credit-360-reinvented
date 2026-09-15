// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { C360Data } from "./data/contract";
import { AppProvider, useApp } from "./state/appState";
import { GovernedStage } from "./components/GovernedStage";
import { DISCARD_ACTION_ID, DISCARD_LABEL, DISCARD_OBJECT_TITLES } from "./actions/discardVersion";
import { closingSentences, stageGroups } from "./actions/stageModel";
import { forgetAllRuns, recallRun, rememberRun, RESUME_LABEL, stoppedRunRow } from "./actions/resumeRun";
import type { StagedOutput } from "./actions/stagedPlan";
import type { ExecuteResult } from "./channel/writeTools";
import sample from "../../artifact/sample-data.json";
import STG168 from "./__fixtures__/discard/stage-discard-version-stg168.json";

/* =============================================================================
   THE GOVERNED-ACTION STAGE, ON THE ORG'S OWN ANSWER (0.9.29, rows 64 + 65).

   The plan under every test below is `stage_discard_version`'s live return for
   Sunbelt Hospitality Group Inc, staging STG-0000000169, 2026-09-15: 32 records
   across eleven write groups, the org's own labels, warnings, names, reasons,
   plan hash and decision token. Nothing is stripped and nothing is composed.

   IT IS PUT THROUGH THE REAL UNWRAPPER. `stageAction` is what turns that
   envelope into the plan the glass reads, and it is the thing this fixture
   caught: the wire spells the inventory rows `objectName` / `recordId` and the
   client read `object` / `id`, so all 32 rows were dropped as "not inventory"
   and the surface that says what a discard deletes said nothing at all.
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

/** The org's own result, ahead of the unwrapper. */
const RESULT = (STG168 as Array<{ outputValues: { result: Record<string, unknown> } }>)[0].outputValues.result;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  callTool.mockReset();
  executeAction.mockReset();
  forgetAllRuns();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  delete document.body.dataset.c360Stage;
});

/** The plan exactly as the page gets it: the org's envelope through the real
 *  staging call. */
async function livePlan(): Promise<StagedOutput> {
  callTool.mockResolvedValue({ payload: { content: STG168 } });
  const { stageAction } = await import("./channel/writeTools");
  const out = await stageAction(DISCARD_ACTION_ID as never, {
    idempotencyKey: "key-stg168",
    rationale: "Forked by mistake.",
    versionPackageId: String(RESULT.versionPackageId),
  } as never);
  if (!out.ok) throw new Error(`the fixture did not unwrap: ${out.error.code}`);
  return out.result;
}

/** What the executor returns when every group settles. */
function ranClean(plan: StagedOutput): ExecuteResult {
  return {
    stagingId: plan.stagingId,
    terminalState: "success",
    outcome: `Version ${RESULT.versionPackageId} discarded.`,
    steps: plan.steps.map((s) => ({
      id: s.id,
      state: s.type === "observed_side_effect" ? "filed_unverified" : "verified",
      detail:
        s.id === "verify_parents"
          ? "Sunbelt Hospitality Group Inc - Purchase - $18,000,000.00 reads hasRenewal false and can be forked again."
          : s.id === "verify_version_gone"
            ? `Version package ${RESULT.versionPackageId} no longer resolves.`
            : s.id === "withdraw_trail"
              ? "STG-0000000168 marked Withdrawn."
              : s.id === "observe_aggregates"
                ? "None was left standing."
                : undefined,
    })) as ExecuteResult["steps"],
  };
}

/** What the executor returned on the founder's own stopped run: the chain
 *  refused at `delete_chain` and nothing after it was attempted. */
const ORG_REFUSAL =
  "CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY, LLC_BI.LoanTrigger: execution of BeforeUpdate caused by: System.UnexpectedException: Script-thrown exception";

function stoppedAtChain(plan: StagedOutput): ExecuteResult {
  const stop = plan.steps.findIndex((s) => s.id === "delete_chain");
  return {
    stagingId: plan.stagingId,
    terminalState: "partial",
    outcome: "The discard stopped at delete_chain. 0 records are gone and 32 remain.",
    steps: plan.steps.map((s, i) => ({
      id: s.id,
      state: i < stop ? "verified" : i === stop ? "failed" : "skipped_not_attempted",
      detail: i === stop ? ORG_REFUSAL : i > stop ? "an earlier step did not complete" : undefined,
    })) as ExecuteResult["steps"],
  };
}

function Opener({ children }: { children: ReactNode }) {
  const { dispatch } = useApp();
  useEffect(() => dispatch({ type: "OPEN_ACCOUNT", accountId: ACCOUNT }), [dispatch]);
  return <>{children}</>;
}

function render(node: ReactNode): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AppProvider data={DATA}>
        <Opener>{node}</Opener>
      </AppProvider>,
    );
  });
  return container;
}

const sheet = () => document.querySelector(".gs-sheet")!;
const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ");
const rowsOf = () => [...document.querySelectorAll<HTMLElement>(".gs-row")];
const buttons = () => [...document.body.querySelectorAll("button")];
const byText = (re: RegExp) => buttons().find((b) => re.test(b.textContent ?? ""));
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

function stage(plan: StagedOutput, extra: Partial<Parameters<typeof GovernedStage>[0]> = {}) {
  return render(
    <GovernedStage
      plan={plan}
      actionId={DISCARD_ACTION_ID}
      title="Discard the version Sunbelt Hospitality Group Inc - 9/14/2026 - PP"
      objectTitles={DISCARD_OBJECT_TITLES}
      commitLabel={DISCARD_LABEL}
      simulated={false}
      idempotencyKey="key-stg168"
      backLabel="Back to Sunbelt Hospitality Group Inc"
      onConfirmed={() => {}}
      onClose={() => {}}
      {...extra}
    />,
  );
}

/* ================================================== the plan, off the wire */

describe("the org's live answer reaches the glass", () => {
  it("unwraps all 32 inventory rows, which the wire spells objectName and recordId", async () => {
    const plan = await livePlan();
    expect(plan.items).toHaveLength(32);
    expect(plan.items!.every((i) => typeof i.object === "string" && i.object.length > 0)).toBe(true);
    expect(plan.items![0].id).toBe("a4Obb000000GBihEAG");
    expect(plan.items![0].object).toBe("LLC_BI__LoanRenewal__c");
  });

  it("reads eleven write groups, in the org's own order, adding up to the 32", async () => {
    const groups = stageGroups(await livePlan(), DISCARD_OBJECT_TITLES);
    expect(groups).toHaveLength(11);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(32);
    expect(groups.map((g) => g.id)).toEqual([
      "delete_chain",
      "delete_pledges",
      "delete_covenant_junctions",
      "delete_rate_components",
      "delete_payment_components",
      "delete_pricing_streams",
      "delete_fees",
      "delete_involvements",
      "delete_members",
      "delete_aggregates",
      "delete_package",
    ]);
  });

  it("carries the org's own banker title, its label without the count it repeats, and its rows", async () => {
    const chain = stageGroups(await livePlan(), DISCARD_OBJECT_TITLES)[0];
    expect(chain.title).toBe("Version chain rows");
    expect(chain.label).toBe("Remove the renewal chain rows that keep the booked parents flagged");
    expect(chain.count).toBe(4);
    // Four rows the org gave four different reasons for: four lines, because
    // deduplicating distinct sentences would lose what each row is.
    expect(chain.reasons).toHaveLength(4);
    expect(chain.reasons[0].text).toContain("While it stands the parent reads hasRenewal true");
    expect(chain.reasons[0].names).toBe("RL-00000885");
  });

  it("says one org sentence once, however many rows gave it, and counts the names", async () => {
    const groups = stageGroups(await livePlan(), DISCARD_OBJECT_TITLES);
    const involvements = groups.find((g) => g.id === "delete_involvements")!;
    expect(involvements.count).toBe(7);
    // SEVEN rows, ONE org reason. Repeating one sentence seven times is not
    // detail, and seven copies of two record names is a wall.
    expect(involvements.reasons).toHaveLength(1);
    expect(involvements.reasons[0].text).toBe(
      "a borrowing structure row on this version. The account it names is untouched.",
    );
    expect(involvements.reasons[0].names).toBe(
      "Entity involvement on Sunbelt Hospitality Group Inc - Purchase - $19,000,000.00 \u00d74, Entity involvement on Sunbelt Hospitality Group Inc - Term - $2,500,000.00 \u00d73",
    );
    // The ROW shows what differs; the disclosure above keeps the exact names.
    expect(involvements.names).toBe("Purchase - $19,000,000.00 \u00d74, Term - $2,500,000.00 \u00d73");
  });

  it("says None found on the group the org found nothing for", async () => {
    const groups = stageGroups(await livePlan(), DISCARD_OBJECT_TITLES);
    const empty = groups.find((g) => g.id === "delete_rate_components")!;
    expect(empty.count).toBe(0);
    expect(empty.names).toBe("None found on this version");
  });

  it("closes on the plan's own tail steps and never on a group's", async () => {
    const plan = await livePlan();
    const groups = stageGroups(plan, DISCARD_OBJECT_TITLES);
    const lines = closingSentences(plan, groups, ranClean(plan).steps);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("STG-0000000168 marked Withdrawn.");
  });
});

/* ============================================================ beat 1, the plan */

describe("beat one, the plan", () => {
  it("takes the page: the relationship recedes and there is no scrim", async () => {
    stage(await livePlan());
    expect(document.body.dataset.c360Stage).toBe("open");
    expect(document.querySelector(".gs-stage")).toBeTruthy();
  });

  it("leads with the title and the org's own count line, verbatim", async () => {
    const plan = await livePlan();
    const el = stage(plan);
    expect(text(el.ownerDocument.querySelector(".gs-hd"))).toContain("Discard the version Sunbelt");
    expect(text(document.querySelector(".gs-hd"))).toContain(plan.warnings[0]);
  });

  it("stands the eleven groups up as rows with the org's counts", async () => {
    stage(await livePlan());
    const rows = rowsOf();
    expect(rows).toHaveLength(11);
    expect(rows.map((r) => text(r.querySelector(".gs-n")))).toEqual(
      ["4", "3", "5", "0", "2", "2", "4", "7", "2", "2", "1"],
    );
  });

  it("expands one row to the org's exact strings and reasons", async () => {
    stage(await livePlan());
    const first = rowsOf()[0];
    expect(first.hasAttribute("data-open")).toBe(false);
    click(first.querySelector("button")!);
    expect(first.hasAttribute("data-open")).toBe(true);
    expect(text(first.querySelector(".gs-why"))).toContain("RL-00000885");
    expect(text(first.querySelector(".gs-why"))).toContain("nCino managed delete handling");
  });

  it("puts every warning the org gave on the glass BEFORE the gesture", async () => {
    const plan = await livePlan();
    stage(plan);
    const said = text(sheet());
    for (const w of plan.warnings) expect(said).toContain(w);
  });

  it("offers one ink commit pill and one way out, and nothing else", async () => {
    stage(await livePlan());
    const acts = [...document.querySelectorAll(".gs-acts button")];
    expect(acts.map((b) => b.textContent)).toEqual([DISCARD_LABEL, "Not now"]);
    expect(acts[0].className).toContain("eg-btn-ink");
  });
});

/* ========================================================= beats 2 and 3 */

describe("the confirmation and the run", () => {
  it("sends the org's own token, staging id and plan hash under the page's key", async () => {
    const plan = await livePlan();
    executeAction.mockResolvedValue({ ok: true, attempts: 1, result: ranClean(plan) });
    stage(plan);
    await act(async () => {
      byText(new RegExp(`^${DISCARD_LABEL}$`))!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(executeAction).toHaveBeenCalledTimes(1);
    expect(executeAction.mock.calls[0][1]).toMatchObject({
      idempotencyKey: "key-stg168",
      stagingId: plan.stagingId,
      planHash: plan.planHash,
      decisionToken: plan.decisionToken,
      approverUserId: "005bb000001TESTAAA",
    });
  });

  it("records the confirmation with the signed-in banker's name, and claims nothing more", async () => {
    const plan = await livePlan();
    executeAction.mockResolvedValue({ ok: true, attempts: 1, result: ranClean(plan) });
    stage(plan);
    await act(async () => {
      byText(new RegExp(`^${DISCARD_LABEL}$`))!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(text(document.querySelector(".gs-conf"))).toBe(
      "Confirmed by Fabian Goetzens. This records that a named person saw this plan, and nothing more.",
    );
  });

  it("empties itself: every group gone, and the org's three sentences left standing", async () => {
    const plan = await livePlan();
    executeAction.mockResolvedValue({ ok: true, attempts: 1, result: ranClean(plan) });
    stage(plan);
    await act(async () => {
      byText(new RegExp(`^${DISCARD_LABEL}$`))!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Reduced motion reaches the same ending without the dissolves, which is
    // what jsdom is: the list is empty and the closing is whole, in one commit.
    expect(sheet().getAttribute("data-phase")).toBe("close");
    expect(rowsOf().every((r) => r.dataset.state === "gone")).toBe(true);
    const said = [...document.querySelectorAll(".gs-said p")].map((p) => p.textContent);
    expect(said).toEqual([
      "Sunbelt Hospitality Group Inc - Purchase - $18,000,000.00 reads hasRenewal false and can be forked again.",
      `Version package ${RESULT.versionPackageId} no longer resolves.`,
      "STG-0000000168 marked Withdrawn.",
    ]);
  });

  it("reports what the org OBSERVED under the closing, not as a fourth finding", async () => {
    const plan = await livePlan();
    executeAction.mockResolvedValue({ ok: true, attempts: 1, result: ranClean(plan) });
    stage(plan);
    await act(async () => {
      byText(new RegExp(`^${DISCARD_LABEL}$`))!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelectorAll(".gs-said p")).toHaveLength(3);
    expect(text(document.querySelector(".gs-after"))).toContain("None was left standing.");
    expect(text(document.querySelector(".gs-after"))).toContain("Back to Sunbelt Hospitality Group Inc");
  });
});

/* =============================================================== the stop */

describe("the stop scene", () => {
  async function stopped() {
    const plan = await livePlan();
    executeAction.mockResolvedValue({ ok: true, attempts: 1, result: stoppedAtChain(plan) });
    stage(plan);
    await act(async () => {
      byText(new RegExp(`^${DISCARD_LABEL}$`))!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    return plan;
  }

  it("leaves the refused group standing with the org's own words under it", async () => {
    await stopped();
    expect(sheet().getAttribute("data-phase")).toBe("stopped");
    const first = rowsOf()[0];
    expect(first.dataset.state).toBe("stopped");
    expect(text(first.querySelector(".gs-orgsays"))).toBe(ORG_REFUSAL);
  });

  it("says of every later group that it was never attempted, and dissolves none of them", async () => {
    await stopped();
    const later = rowsOf().slice(1);
    expect(later.every((r) => r.dataset.state === "skipped")).toBe(true);
    expect(rowsOf().some((r) => r.dataset.state === "gone")).toBe(false);
  });

  it("offers the resume and the room's two doors, and nothing else", async () => {
    await stopped();
    const doors = [...document.querySelectorAll(".gs-doors button, .gs-doors a")].map((b) => b.textContent);
    expect(doors).toEqual([RESUME_LABEL, "Back to Sunbelt Hospitality Group Inc"]);
  });

  it("resumes on the SAME key, the same token and the same frozen plan", async () => {
    const plan = await stopped();
    executeAction.mockClear();
    await act(async () => {
      byText(new RegExp(`^${RESUME_LABEL}$`))!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(executeAction.mock.calls[0][1]).toMatchObject({
      idempotencyKey: "key-stg168",
      stagingId: plan.stagingId,
      planHash: plan.planHash,
      decisionToken: plan.decisionToken,
    });
  });
});

/* ================================================= what the page may resume */

describe("a resume needs the run this page made", () => {
  it("reads an Executing row carrying a result id as a stopped run, and nothing else as one", () => {
    expect(stoppedRunRow({ stagingId: "a", status: "Executing", resultRecordId: "a5F000" })).toBe(true);
    expect(stoppedRunRow({ stagingId: "a", status: "Executing" })).toBe(false);
    expect(stoppedRunRow({ stagingId: "a", status: "Completed", resultRecordId: "a5F000" })).toBe(false);
    expect(stoppedRunRow({ stagingId: "a", status: "Staged" })).toBe(false);
  });

  it("holds the run only for the page that made it, and never invents one", async () => {
    const plan = await livePlan();
    expect(recallRun(plan.stagingId)).toBeNull();
    rememberRun({
      actionId: DISCARD_ACTION_ID,
      plan,
      idempotencyKey: "key-stg168",
      approverUserId: "005bb000001TESTAAA",
      outcome: stoppedAtChain(plan),
    });
    expect(recallRun(plan.stagingId)?.plan.decisionToken).toBe(plan.decisionToken);
    forgetAllRuns();
    expect(recallRun(plan.stagingId)).toBeNull();
  });
});
