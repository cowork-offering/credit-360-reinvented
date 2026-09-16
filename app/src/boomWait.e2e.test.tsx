// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { BoomWaitLine, possessive, readingLine } from "./components/BoomWaitLine";
import {
  boomArrivals,
  boomExpectationLine,
  boomRowState,
  boomWaits,
  lookedAtBoom,
  POLL_EVERY_MS,
  startBoomWatcher,
  watchBoomFile,
  type BoomFileHandle,
} from "./components/workroom/boomWatch";
import {
  allBoomReceipts,
  closeSpreadingRoom,
  pendingBoomFiles,
  rememberBoomFile,
  useSpreadingRoom,
} from "./components/workroom/spreadSession";
import { liveBoomAdapter } from "./channel/boomUpload";
import type { McpOk } from "./channel/mcp";

import AWAIT from "./__fixtures__/boom-live/await-piedmont.json";
import FILE from "./__fixtures__/boom-live/file-piedmont.json";
import FILE_PROCESSING from "./__fixtures__/boom-live/file-processing.json";
import RATIOS from "./__fixtures__/boom-live/ratios-piedmont.json";
import SPREAD from "./__fixtures__/boom-live/spread-piedmont.json";

/* =============================================================================
   THE WAIT FOLLOWS THE BANKER (0.9.31), PROVEN.

   THE REQUIREMENT ABOVE ALL, in the founder's own words: "so i can leave the
   workroom of spreading and there is a progress indicator somewhere?" Every
   case below is one clause of that sentence.

   The poll is at PAGE level and keyed on the persisted receipts, so nothing
   here mounts a Spreading room at all: that is the point. Where an answer is
   Boom's it comes off `src/__fixtures__/boom-live/`, verbatim from the live
   server on 2026-09-15.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ONE = { accountId: "001bb00001DLtRMAA1", accountName: "Piedmont Precision Components, Inc." };
const TWO = { accountId: "001bb00001I7FPNAA3", accountName: "Hartwell Precision Manufacturing LLC" };

const handle = (fileId: string, fileName: string, bytes = 8_192): BoomFileHandle => ({
  fileId,
  companyId: null,
  fileName,
  startedAt: Date.now(),
  bytes,
});

/** A Boom connector under the test's control. `spreading` is what Boom is still
 *  doing; `misses` swallows that many of the next answers the way the relay
 *  does, which is never news about the file. */
function boomLane(options: { spreading?: boolean; misses?: number } = {}) {
  const state = { spreading: options.spreading ?? false, misses: options.misses ?? 0 };
  const tools: string[] = [];
  /** How many calls this lane has ever seen at once. One poll per file means
   *  one, however many rooms are asking. */
  const flight = { now: 0, max: 0 };
  const call = async (_server: string, tool: string, input?: unknown): Promise<McpOk<unknown>> => {
    tools.push(tool);
    flight.now += 1;
    flight.max = Math.max(flight.max, flight.now);
    try {
      return await answer(tool, input);
    } finally {
      flight.now -= 1;
    }
  };
  const answer = async (tool: string, input?: unknown): Promise<McpOk<unknown>> => {
    if (state.misses > 0) {
      state.misses -= 1;
      throw { code: "server_unavailable", message: "request failed (502)", retryable: false };
    }
    const fileId = (input as { fileId?: string } | undefined)?.fileId ?? "";
    if (tool === "boom_await_file") {
      return { payload: { ...AWAIT, fileId, status: state.spreading ? "processing" : "verified", done: !state.spreading }, raw: {} };
    }
    if (tool === "boom_get_file") return { payload: state.spreading ? FILE_PROCESSING : FILE, raw: {} };
    if (tool === "boom_get_spread") return { payload: SPREAD, raw: {} };
    if (tool === "boom_get_ratios") return { payload: RATIOS, raw: {} };
    return { payload: {}, raw: {} };
  };
  return { adapter: liveBoomAdapter(call), tools, state, flight };
}

let stop: (() => void) | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  stop?.();
  stop = null;
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

function render(): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<BoomWaitLine />);
  });
  return container;
}

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ");

/* ============================================================== the poller */

describe("the poll is the page's, not the room's", () => {
  it("keeps checking with no room mounted at all, and clears the receipt when Boom settles", async () => {
    const lane = boomLane({ spreading: true });
    const ticket = watchBoomFile({ account: ONE, handle: handle("f1", "fy2025.xlsx"), adapter: lane.adapter });

    await vi.advanceTimersByTimeAsync(40_000);
    // The receipt stands while Boom is working, and nothing has been sent.
    expect(pendingBoomFiles(ONE.accountId).map((h) => h.fileId)).toEqual(["f1"]);
    expect(lane.tools).not.toContain("boom_create_upload");
    expect(lane.tools.filter((t) => t === "boom_await_file").length).toBeGreaterThan(1);

    lane.state.spreading = false;
    await vi.advanceTimersByTimeAsync(40_000);
    const outcome = await ticket.settled;
    expect(outcome.result?.financialStatements?.length).toBe(3);
    expect(pendingBoomFiles(ONE.accountId)).toEqual([]);
  });

  it("polls ONE file once, however many times a room asks for it", async () => {
    const lane = boomLane({ spreading: true });
    const first = watchBoomFile({ account: ONE, handle: handle("f1", "fy2025.xlsx"), adapter: lane.adapter });
    const again = watchBoomFile({ account: ONE, handle: handle("f1", "fy2025.xlsx"), adapter: lane.adapter });
    const third = watchBoomFile({ account: ONE, handle: handle("f1", "fy2025.xlsx"), adapter: lane.adapter });
    expect(again.settled).toBe(first.settled);
    expect(third.settled).toBe(first.settled);

    await vi.advanceTimersByTimeAsync(30_000);
    /* ONE LOOP, ONE CALL AT A TIME. Three loops on one file would show the
       connector three concurrent waits every window, which is exactly what a
       room owning its own poll cost every time a banker walked back in. */
    expect(lane.flight.max).toBe(1);
    expect(boomWaits()).toHaveLength(1);
    expect(boomWaits()[0].total).toBe(1);
  });

  it("re-arms on a miss and never moves the rung, exactly as 0.9.29 has it", async () => {
    const lane = boomLane({ spreading: true, misses: 3 });
    const ticket = watchBoomFile({
      account: ONE,
      handle: handle("f1", "fy2025.xlsx"),
      adapter: lane.adapter,
      // The rung Boom named on the way in, so the loop opens on the blocking
      // wait rather than on the resume's first plain read.
      first: { fileId: "f1", companyId: null, fileGroupId: null, status: "processing" },
    });

    await vi.advanceTimersByTimeAsync(POLL_EVERY_MS * 2);
    // A rejected call says nothing about the file: it is where Boom put it.
    expect(ticket.get().status).toBe("processing");
    expect(ticket.get().checking).toBe(true);
    // And after two consecutive misses the loop drops to the plain read.
    await vi.advanceTimersByTimeAsync(POLL_EVERY_MS * 2);
    expect(lane.tools.slice(0, 3)).toEqual(["boom_await_file", "boom_await_file", "boom_get_file"]);

    lane.state.spreading = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await ticket.settled).result).not.toBeNull();
  });

  it("raises the arrival once, and only when the whole set has landed", async () => {
    const lane = boomLane({ spreading: true });
    watchBoomFile({ account: ONE, handle: handle("f1", "one.pdf"), adapter: lane.adapter });
    watchBoomFile({ account: ONE, handle: handle("f2", "two.pdf"), adapter: lane.adapter });

    await vi.advanceTimersByTimeAsync(20_000);
    expect(boomWaits()[0]).toMatchObject({ accountId: ONE.accountId, total: 2, done: 0 });
    expect(boomArrivals()).toEqual([]);

    lane.state.spreading = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(boomWaits()).toEqual([]);
    const arrivals = boomArrivals();
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0]).toMatchObject({ accountId: ONE.accountId, period: "FY2025" });
  });

  it("carries two relationships at once, newest first, each with its own count", async () => {
    const lane = boomLane({ spreading: true });
    watchBoomFile({ account: ONE, handle: handle("f1", "one.pdf"), adapter: lane.adapter });
    await vi.advanceTimersByTimeAsync(2_000);
    watchBoomFile({ account: TWO, handle: handle("g1", "two.pdf"), adapter: lane.adapter });
    watchBoomFile({ account: TWO, handle: handle("g2", "three.pdf"), adapter: lane.adapter });

    await vi.advanceTimersByTimeAsync(10_000);
    const waits = boomWaits();
    expect(waits.map((w) => w.accountId)).toEqual([TWO.accountId, ONE.accountId]);
    expect(waits[0].total).toBe(2);
    expect(waits[1].total).toBe(1);
  });

  it("picks the wait back up off the persisted receipts, which is what a reload leaves", async () => {
    // Exactly the state a reloaded page opens in: receipts in storage, no room,
    // no engine, nothing running.
    rememberBoomFile(ONE, handle("f1", "fy2025.xlsx"));
    expect(allBoomReceipts()[0].files.map((h) => h.fileId)).toEqual(["f1"]);
    const raw = sessionStorage.getItem("c360:boom:receipts");
    expect(raw).toContain("f1");

    const lane = boomLane({ spreading: true });
    stop = startBoomWatcher(lane.adapter);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(boomWaits()[0]).toMatchObject({ accountId: ONE.accountId, accountName: ONE.accountName, total: 1 });

    lane.state.spreading = false;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(pendingBoomFiles(ONE.accountId)).toEqual([]);
    expect(boomArrivals()).toHaveLength(1);
  });
});

/* ========================================================== the expectation */

describe("the expectation line is observed or it is absent", () => {
  it("says nothing at all before this page has watched Boom finish a set", () => {
    expect(boomExpectationLine(8_192)).toBeNull();
  });

  it("names the count and the minutes it actually watched, and only for sets of that size", async () => {
    const lane = boomLane({ spreading: true });
    watchBoomFile({ account: ONE, handle: handle("f1", "fy2025.xlsx", 8_192), adapter: lane.adapter });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    lane.state.spreading = false;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(boomExpectationLine(8_192)).toMatch(/^Boom's last 1 set this size took about \d+ minutes?\.$/);
    // A set two orders of magnitude bigger is not "this size".
    expect(boomExpectationLine(80_000_000)).toBeNull();
  });
});

/* ============================================================ the indicator */

describe("the header indicator", () => {
  it("is not drawn at all where Boom is holding nothing", () => {
    expect(render().querySelector(".bw")).toBeNull();
  });

  it("names the relationship, the elapsed clock and the count while Boom reads", async () => {
    const lane = boomLane({ spreading: true });
    watchBoomFile({ account: TWO, handle: handle("g1", "one.pdf"), adapter: lane.adapter });
    watchBoomFile({ account: TWO, handle: handle("g2", "two.pdf"), adapter: lane.adapter });
    const host = render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(134_000);
    });

    const pill = host.querySelector('[data-boom-state="reading"]');
    expect(text(pill)).toContain(readingLine(TWO.accountName));
    expect(text(pill)).toContain("02:14");
    expect(text(pill)).toContain("0 of 2 files");
    // No percentage anywhere: Boom reports rungs, and the room may not invent one.
    expect(text(pill)).not.toMatch(/%/);
  });

  it("brings the arrival, and clears it when the banker looks", async () => {
    const lane = boomLane({ spreading: true });
    watchBoomFile({ account: ONE, handle: handle("f1", "fy2025.xlsx"), adapter: lane.adapter });
    const host = render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    lane.state.spreading = false;
    /* IN STEPS SHORTER THAN THE MARKER'S OWN BEAT, so the lit state is actually
       observed rather than jumped over. */
    for (let i = 0; i < 60 && !boomArrivals().length; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
    }

    // One beat lit, then the quiet pill, and the words are Boom's own act.
    const marker = host.querySelector('[data-boom-state="marker"]');
    expect(text(marker?.querySelector(".bw-t") ?? null)).toBe(
      `Boom has read ${possessive(ONE.accountName)} FY2025 statements`,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(host.querySelector('[data-boom-state="arrived"]')).not.toBeNull();
    expect(boomRowState(ONE.accountId)).toBe("arrived");

    // The look clears the marker and the row's glow with it.
    act(() => lookedAtBoom(ONE.accountId));
    expect(boomArrivals()).toEqual([]);
    expect(boomRowState(ONE.accountId)).toBeNull();
    expect(host.querySelector(".bw")).toBeNull();
  });

  it("opens the right Spreading room on the click", async () => {
    const lane = boomLane({ spreading: true });
    watchBoomFile({ account: ONE, handle: handle("f1", "one.pdf"), adapter: lane.adapter });
    watchBoomFile({ account: TWO, handle: handle("g1", "two.pdf"), adapter: lane.adapter });

    /* THE SESSION STORE IS THE DOOR. It is what `SpreadingRoomHost` mounts off,
       so reading it back is reading which room the click opened. */
    const opened: Array<string | null> = [];
    function Probe() {
      opened.push(useSpreadingRoom()?.accountId ?? null);
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <>
          <BoomWaitLine />
          <Probe />
        </>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    act(() => {
      (container!.querySelector(`[data-boom-account="${TWO.accountId}"]`) as HTMLButtonElement).click();
    });
    expect(opened.at(-1)).toBe(TWO.accountId);
    act(() => {
      (container!.querySelector(`[data-boom-account="${ONE.accountId}"]`) as HTMLButtonElement).click();
    });
    expect(opened.at(-1)).toBe(ONE.accountId);
    act(() => closeSpreadingRoom());
  });
});

/* ===================================================== the row, and the glow */

describe("the worklist row", () => {
  it("says reading while Boom reads and arrived until the banker looks", async () => {
    const lane = boomLane({ spreading: true });
    watchBoomFile({ account: ONE, handle: handle("f1", "fy2025.xlsx"), adapter: lane.adapter });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(boomRowState(ONE.accountId)).toBe("reading");
    // A relationship Boom is not reading for carries nothing at all.
    expect(boomRowState(TWO.accountId)).toBeNull();

    lane.state.spreading = false;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(boomRowState(ONE.accountId)).toBe("arrived");
  });
});
