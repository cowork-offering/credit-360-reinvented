// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aggregateBorrower } from "./aggregate";
import { __resetBookForTests, openAccountLive } from "./dynamicBook";
import { __setDbForTests } from "../channel/dbDoor";
import { __resetOpenBurstForTests, openInFlightLimit, OPEN_MAX_IN_FLIGHT } from "../channel/openBurst";
import { HOSTED_READ_MAX_IN_FLIGHT } from "../channel/mcp";
import { MAX_IN_FLIGHT } from "../channel/syncSweep";

/* =============================================================================
   THE COLD RELATIONSHIP OPEN GOES WIDE, AND THE VIEW SWITCHES FIRST (A3/E1).

   FOUNDER, 2026-09-12, the latency brief: "110% zero latency and smooth
   transitions etc in all workrooms and chats."

   THE DEFECT. The live-open path read eight tools at TWO in flight, 200ms
   apart: the sweep's pacing, on a path the banker is waiting on. That is four
   waves where the open is one, and against a 500ms relay it cost 1.0 to 1.5
   seconds. Worse, the caller did not navigate until the WHOLE aggregate had
   settled — the relationship graph included, which is the heaviest read in the
   set and deliberately the last one issued — so the graph's own wave was paid
   on the worklist rather than behind the open view.

   FOUR THINGS ARE HELD HERE, and each is a way it could quietly come back:

     1. the reads leave TOGETHER, at the open register's width, not two at a time;
     2. the portfolio read, which nothing is patched from, is not awaited before
        the room may open;
     3. `onOpen` fires while the graph is still in flight;
     4. the platform's own `rate_limited` still narrows the page, permanently.
   ============================================================================= */

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

const BRIGHT = "001bb00001BRIGHT01";

const ok = (outputValues: unknown) => ({ payload: { content: [{ isSuccess: true, outputValues }] } });

const FACILITIES = [
  { loanId: "a4Z01", name: "Line of Credit", productPackageId: "a5F01", committed: 15_000_000, stage: "Booked" },
];

/** The org's answer for every read, so an open that is not being held anywhere
 *  completes and registers. */
function answer(tool: string): unknown {
  const bare = tool.replace(/^gw_/, "");
  if (bare === "Customer360Snapshot") return ok({ accountId: BRIGHT, name: "Bright Horizon Health" });
  if (bare === "Customer360Exposure") return ok({ accountId: BRIGHT, facilities: FACILITIES });
  if (bare === "Customer360RelationshipGraph") return ok({ accountId: BRIGHT, connections: [] });
  return ok({});
}

/** The connector, with named tools HELD open so the order of the waits is
 *  observable rather than inferred. A held tool never answers until the test
 *  lets it, on both of its doors. */
function installConnector(held: string[] = []) {
  const launched: string[] = [];
  const release: Array<() => void> = [];
  const callTool = vi.fn((_server: string, tool: string) => {
    launched.push(tool.replace(/^gw_/, ""));
    if (held.includes(tool.replace(/^gw_/, ""))) {
      return new Promise((resolve) => release.push(() => resolve(answer(tool))));
    }
    return Promise.resolve(answer(tool));
  });
  w.claude = { mcp: { callTool, watchTool: vi.fn().mockReturnValue(() => {}), listTools: vi.fn(), invalidate: vi.fn() } };
  return { callTool, launched, releaseAll: () => release.splice(0).forEach((r) => r()) };
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetBookForTests();
  __resetOpenBurstForTests();
  __setDbForTests(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  delete w.claude;
  __resetBookForTests();
  __resetOpenBurstForTests();
  __setDbForTests(undefined);
  vi.restoreAllMocks();
});

describe("the live open reads at the open's own width", () => {
  it("issues the reads together rather than two at a time, 200ms apart", async () => {
    // Nothing answers, so what is counted is purely what was LAUNCHED.
    const launched: string[] = [];
    w.claude = {
      mcp: {
        callTool: vi.fn((_s: string, tool: string) => {
          launched.push(tool.replace(/^gw_/, ""));
          return new Promise(() => {});
        }),
        watchTool: vi.fn().mockReturnValue(() => {}),
        listTools: vi.fn(),
        invalidate: vi.fn(),
      },
    };

    void aggregateBorrower({ accountId: BRIGHT }).catch(() => {});
    await vi.advanceTimersByTimeAsync(50);

    /* ASKED FOR TOGETHER, SHOWN TO THE HOP FOUR AT A TIME. On the sweep's pacing
       this was 1 at 0ms and the second at 200ms, so 50ms of clock bought exactly
       one read; the open's own width is still six and 50ms of clock now buys the
       cap's worth (0.9.30, backlog row 73: the Salesforce hop is a shared
       resource, and a burst is what the dispatcher answered with 502s). */
    expect(OPEN_MAX_IN_FLIGHT).toBeGreaterThan(HOSTED_READ_MAX_IN_FLIGHT);
    expect(launched).toHaveLength(HOSTED_READ_MAX_IN_FLIGHT);
    expect(new Set(launched).size).toBe(HOSTED_READ_MAX_IN_FLIGHT);
  });

  it("does not wait on the portfolio read before the room may open", async () => {
    // The portfolio confirms the book AROUND the relationship and nothing is
    // patched from it, so it must not stand between the banker and the room.
    const { releaseAll } = installConnector(["Customer360Portfolio"]);
    let ready = false;
    const run = aggregateBorrower({ accountId: BRIGHT, onReady: () => (ready = true) });

    await vi.advanceTimersByTimeAsync(200);
    expect(ready, "the room may open with the portfolio read still in flight").toBe(true);

    releaseAll();
    await vi.advanceTimersByTimeAsync(200);
    await run;
  });
});

describe("the view switches before the graph wave", () => {
  it("fires onOpen while the relationship graph is still in flight", async () => {
    const { releaseAll } = installConnector(["Customer360RelationshipGraph"]);
    let openedAt: "before" | "after" | null = null;
    let settled = false;

    const run = openAccountLive({
      accountId: BRIGHT,
      name: "Bright Horizon Health",
      onOpen: () => (openedAt = settled ? "after" : "before"),
    });

    await vi.advanceTimersByTimeAsync(200);
    expect(openedAt, "the graph is still held, and the view has already switched").toBe("before");

    settled = true;
    releaseAll();
    await vi.advanceTimersByTimeAsync(200);
    expect(await run).toBe(true);
  });
});

describe("the platform's own word still narrows the page", () => {
  it("drops to the sweep's pacing on rate_limited, and stays narrow", async () => {
    w.claude = {
      mcp: {
        callTool: vi.fn().mockRejectedValue({ code: "rate_limited", message: "too many" }),
        watchTool: vi.fn().mockReturnValue(() => {}),
        listTools: vi.fn(),
        invalidate: vi.fn(),
      },
    };

    expect(openInFlightLimit()).toBe(OPEN_MAX_IN_FLIGHT);
    void aggregateBorrower({ accountId: BRIGHT }).catch(() => {});
    await vi.advanceTimersByTimeAsync(30_000);
    expect(openInFlightLimit()).toBe(MAX_IN_FLIGHT);
  });
});
