// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SpreadingRoom, type TrendPoint } from "./components/workroom/SpreadingRoom";
import { PRE_READ_BEAT_MS, type SpreadDeps } from "./workroom/spreadEngine";
import type { RelationshipSpreadContext } from "./spread/preRead";
import { provisionalRead } from "./spread/provisional";
import { postReadFacts } from "./spread/postRead";
import { boomAdapter, BOOM_UPLOAD_LANE, registerPreRead, resetStubBoom } from "./channel/boomUpload";
import type { DroppedFile, ExtractedDocument, FilePreRead } from "./spread/types";

/* =============================================================================
   ONE GUIDED FLOW, TOP TO BOTTOM (founder, 2026-09-13, after driving the
   shipped room in a browser).

   Four things he read off the glass and this file holds:

     THE ORDER. The drop zone was pinned at full height at the top, the action
     sat in the MIDDLE of the column, and the financials panel was open below it
     before anything had been sent. The spine leads, the zone becomes a bar, the
     card is the first thing, and the action is the LAST thing on the column.

     THE PANEL DOES NOT EXIST BEFORE THE SPREAD. Tiles, a trend and statement
     tabs under an unconfirmed plan read as a spread that had already happened.

     THE ACTION IS THE FILED SHEET'S GLASS DOOR, not a solid violet pill in the
     browser's own button font.

     THE AXIS PRINTS A PERIOD ONCE. The trend read FY2023, FY2024, FY2025, LTM,
     FY2025 because the new point was appended rather than merged by its label.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COMPANY = "Hartwell Precision Manufacturing LLC";
const SHA = "b".repeat(64);

const CTX: RelationshipSpreadContext = {
  accountId: "001bb00001I7FPNAA3",
  company: COMPANY,
  onFilePeriods: ["FY2023", "FY2024", "FY2025"],
  covenants: [{ name: "Maximum Debt to Worth", operator: "<=", threshold: 3, current: 2.42, unit: "ratio" }],
  obligorGroup: [],
};

/** The book's own revenue trend: three fiscal years and the LTM column. */
const TREND: TrendPoint[] = [
  { period: "FY2023", revenue: 52_400_000 },
  { period: "FY2024", revenue: 58_900_000 },
  { period: "FY2025", revenue: 63_800_000 },
  { period: "LTM", revenue: 64_200_000 },
];

const PRE_READ: FilePreRead = {
  fileId: `f_${SHA.slice(0, 12)}`,
  statements: [
    {
      statementType: "income_statement",
      periods: [{ key: "FY2025", endDate: "2025-12-31", periodType: "annual" }],
      lines: [
        { label: "Net sales revenue", accountCode: "net_sales_revenue", values: { FY2025: 71_200_000 }, confidence: "high" },
        { label: "Operating profit", accountCode: "operating_profit", values: { FY2025: 5_400_000 }, confidence: "high" },
        { label: "Interest expense", accountCode: "interest_expense", values: { FY2025: -1_750_000 }, confidence: "high" },
      ],
    },
  ],
  company: COMPANY,
  companyMatchesRelationship: true,
  currency: "USD",
  unitsMultiplier: 1,
  statementQuality: "cpa_audited",
  quality: [],
  confidence: "high",
};

const DROPPED: DroppedFile = {
  id: PRE_READ.fileId,
  name: "hartwell-fy2025.pdf",
  mime: "application/pdf",
  bytes: 21_108,
  base64: "",
  sha256: SHA,
  kind: "pdf-text",
};

const DOC: ExtractedDocument = {
  fileId: DROPPED.id,
  kind: "pdf-text",
  text: "Net sales revenue 71,200",
  tables: [],
  pages: 1,
  isScan: false,
  warnings: [],
};

function deps(): SpreadDeps {
  return {
    readDroppedFile: async () => DROPPED,
    extractDocument: async () => DOC,
    preReadFile: async () => PRE_READ,
    provisionalRead,
    postRead: async (a) => postReadFacts(a),
    adapter: boomAdapter(),
    lane: BOOM_UPLOAD_LANE,
    registerPreRead,
    resetStub: resetStubBoom,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  resetStubBoom();
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.className = "";
  vi.useRealTimers();
  resetStubBoom();
});

function open(): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<SpreadingRoom ctx={CTX} onFileBoom={null} trend={TREND} deps={deps()} onClose={() => {}} />);
  });
  return document.querySelector<HTMLElement>('[data-room="spread"]')!;
}

async function drop(room: HTMLElement): Promise<void> {
  const zone = room.querySelector<HTMLElement>(".sp-drop")!;
  await act(async () => {
    zone.dispatchEvent(
      Object.assign(new Event("drop", { bubbles: true }), {
        dataTransfer: { files: [new File(["x"], DROPPED.name, { type: DROPPED.mime })] },
      }),
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PRE_READ_BEAT_MS * 12);
  });
}

/** The class of each direct child of the column, in document order. */
const order = (room: HTMLElement): string[] =>
  [...room.querySelector(".sp-body")!.children].map((n) => n.className.split(" ")[0]);

describe("the column reads in one order", () => {
  it("opens on the spine, the sentence and the drop zone, with no card and no panel", () => {
    const room = open();
    expect(order(room)).toEqual(["sp-steps", "sp-guide", "sp-drop"]);
    expect(room.querySelector(".sp-drop")?.classList.contains("is-bar")).toBe(false);
    expect(room.querySelector(".sp-fin")).toBeNull();
    expect(room.querySelector(".sp-guide")?.textContent).toContain(COMPANY);
  });

  it("collapses the zone to a bar with the count once a file is in, so the card leads", async () => {
    const room = open();
    await drop(room);
    const zone = room.querySelector<HTMLElement>(".sp-drop")!;
    expect(zone.classList.contains("is-bar")).toBe(true);
    expect(zone.textContent).toContain("Add another statement");
    expect(zone.textContent).toContain("1 file in this plan");
    // And it is still above the card: a target the banker can find.
    expect(order(room).slice(0, 4)).toEqual(["sp-steps", "sp-guide", "sp-drop", "sp-cards"]);
  });

  it("puts the action LAST and opens no financials panel before the spread", async () => {
    const room = open();
    await drop(room);
    const column = order(room);
    expect(column[column.length - 1]).toBe("sp-act");
    expect(room.querySelector(".sp-fin")).toBeNull();
    expect(room.querySelector(".sp-tiles")).toBeNull();
    expect(room.querySelector(".sp-trend")).toBeNull();
    expect(room.querySelector(".sp-st")).toBeNull();
    // What the file reads as is INSIDE the plan, in four lines at most.
    const brief = room.querySelectorAll(".sp-brief p");
    expect(brief.length).toBeGreaterThan(0);
    expect(brief.length).toBeLessThanOrEqual(4);
  });

  it("wears the filed sheet's glass doors rather than a solid pill of its own", async () => {
    const room = open();
    await drop(room);
    const go = room.querySelector(".sp-go")!;
    expect(go.classList.contains("wk-sheet-go")).toBe(true);
    expect(go.textContent).toBe("Confirm and spread");
    expect(room.querySelector(".sp-back")?.classList.contains("wk-sheet-back")).toBe(true);
  });

  it("lights the step the room is actually on", async () => {
    const room = open();
    const lit = () =>
      [...room.querySelectorAll(".sp-step")].findIndex((n) => n.getAttribute("data-state") === "on");
    expect(lit()).toBe(0);
    await drop(room);
    expect(lit()).toBe(2);
    expect(room.querySelectorAll('.sp-step[data-state="done"]')).toHaveLength(2);
  });
});

/* =============================================================================
   THE ROOM ENDS ON THE FINALE'S SHEET (founder, 2026-09-13: "ideally make it at
   the end also with this glowing rainbow card so it is all unified", and
   earlier: the end of a room must have doors like the modification finale).

   ONE ELEMENT, THREE STAGES. The plan, Boom's rungs and the spread are the same
   node wearing the same glass, which is what makes the end of this room read as
   the end of the modification room rather than as a fourth idea of a summary.
   ============================================================================= */
describe("the room ends on the filed sheet's own register", () => {
  it("opens the confirm as the sheet: the glass, the rainbow, the stamp and two doors", async () => {
    const room = open();
    await drop(room);
    const sheet = room.querySelector(".sp-act")!;

    expect(sheet.classList.contains("wk-sheet")).toBe(true);
    // The rainbow is the finale's own element, first child, thinned by the sheet.
    expect(sheet.firstElementChild?.className).toBe("aura");
    expect(sheet.querySelector(".wk-sheet-t")?.textContent).toBe("The plan");
    expect(sheet.querySelector(".wk-sheet-s")?.textContent).toBe(`${COMPANY} · FY2025`);
    expect([...sheet.querySelectorAll(".wk-sheet-sec")].map((n) => n.getAttribute("data-block"))).toEqual([
      "plan",
      "read",
    ]);

    // The doors are the LAST row of the sheet, and there are exactly two.
    const acts = sheet.querySelector(".wk-sheet-acts")!;
    expect(sheet.lastElementChild).toBe(acts);
    expect(acts.children).toHaveLength(2);
    expect(acts.children[0].textContent).toBe("Confirm and spread");
    expect(acts.children[1].textContent).toBe("Leave it for now");
  });

  it("carries the same node from the confirm through Boom to the spread", async () => {
    const room = open();
    await drop(room);
    const sheet = room.querySelector(".sp-act")!;

    await act(async () => {
      room.querySelector<HTMLElement>(".sp-go")!.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_200);
    });
    expect(room.querySelector(".sp-act")).toBe(sheet);
    expect(sheet.getAttribute("data-stage")).toBe("sending");
    expect(sheet.querySelector(".wk-sheet-t")?.textContent).toBe("Boom (stub) is spreading");
    // While Boom works the sheet offers no door at all: it is not a decision.
    expect(sheet.querySelector(".wk-sheet-acts")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(room.querySelector(".sp-act")).toBe(sheet);
    expect(sheet.getAttribute("data-stage")).toBe("spread");
    expect(sheet.querySelector(".wk-sheet-t")?.textContent).toBe("The spread is in");
    // The panel and the post-read are BLOCKS OF THE SHEET, not cards below it.
    expect([...sheet.querySelectorAll(".wk-sheet-sec")].map((n) => n.getAttribute("data-block"))).toEqual([
      "ladder",
      "financials",
      "changes",
    ]);
    expect(room.querySelector(".sp-body")!.lastElementChild).toBe(sheet);
  });

  it("ends in the modification finale's two doors: the memo, and the way back", async () => {
    const asked: Array<string | null> = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <SpreadingRoom
          ctx={CTX}
          onFileBoom={null}
          trend={TREND}
          deps={deps()}
          onDraftMemo={(period) => asked.push(period)}
          onClose={() => {}}
        />,
      );
    });
    const room = document.querySelector<HTMLElement>('[data-room="spread"]')!;
    await drop(room);
    await act(async () => {
      room.querySelector<HTMLElement>(".sp-go")!.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    const acts = room.querySelector(".wk-sheet-acts")!;
    expect([...acts.children].map((n) => n.textContent)).toEqual([
      "Draft the credit memo",
      `Back to ${COMPANY}`,
    ]);
    const memo = acts.querySelector<HTMLElement>('[data-door="memo"]')!;
    expect(memo.classList.contains("wk-sheet-go")).toBe(true);
    await act(async () => {
      memo.click();
    });
    // The memo is opened ON the period this room just spread.
    expect(asked).toEqual(["FY2025"]);
  });
});

describe("the plan becomes the ladder in place", () => {
  it("grows the same card into Boom's rungs rather than opening a second one below it", async () => {
    const room = open();
    await drop(room);
    const card = room.querySelector(".sp-act")!;
    await act(async () => {
      room.querySelector<HTMLElement>(".sp-go")!.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(room.querySelectorAll(".sp-act")).toHaveLength(1);
    expect(room.querySelector(".sp-act")).toBe(card);
    expect(card.classList.contains("sp-ladder")).toBe(true);
    expect(card.classList.contains("sp-plan")).toBe(false);
    expect(card.textContent).toContain("Boom (stub) has spread these files");
    expect(room.querySelector(".sp-go")).toBeNull();
  });
});

describe("the panel lands when the spread does", () => {
  const spread = async (): Promise<HTMLElement> => {
    const room = open();
    await drop(room);
    await act(async () => {
      room.querySelector<HTMLElement>(".sp-go")!.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    return room;
  };

  it("prints the new period on the axis ONCE, merged by its label and not appended", async () => {
    /* AND IT ENDS THE SERIES (founder review, 2026-09-13: the trend "dips into
       an older LTM"). The book holds FY2023, FY2024, FY2025, LTM; the spread
       moved FY2025, and a trailing-twelve-months window closed before that
       year-end, so the spread is the latest point and the LTM sits before it.
       The rule is `publishSpread.mergeDisplayPeriods`, called and not copied. */
    const room = await spread();
    const axis = [...room.querySelectorAll(".sp-trend-ax text")].map((n) => n.textContent);
    expect(axis).toEqual(["FY2023", "FY2024", "LTM", "FY2025"]);
    expect(axis.filter((p) => p === "FY2025")).toHaveLength(1);
  });

  it("marks the point this spread moved, wherever the book's order put it", async () => {
    const room = await spread();
    expect(room.querySelector(".sp-trend-new")?.getAttribute("data-provisional-period")).toBe("FY2025");
  });

  it("opens the tiles, the statement tabs and the post-read only now", async () => {
    const room = await spread();
    expect(room.querySelectorAll(".sp-tile")).toHaveLength(5);
    expect(room.querySelector(".sp-st-tabs")).toBeTruthy();
    expect(room.querySelector(".sp-post")).toBeTruthy();
  });

  it("marks the new period's own column in the statement table", async () => {
    /* The match was `endDate === newPeriod`, which compared "2025-12-31" with
       "FY2025" and was therefore never true: the column the banker opened this
       room for was never marked. Fixed 2026-09-13. */
    const room = await spread();
    const head = [...room.querySelectorAll(".sp-st-t thead th")];
    const marked = head.filter((n) => n.classList.contains("is-new"));
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toBe("2025-12-31");
  });

  it("offers the Explain affordance the Financials tab offers, on a grounded question", async () => {
    const asked: string[] = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <SpreadingRoom
          ctx={CTX}
          onFileBoom={null}
          trend={TREND}
          deps={deps()}
          onExplain={(q) => asked.push(q)}
          onClose={() => {}}
        />,
      );
    });
    const room = document.querySelector<HTMLElement>('[data-room="spread"]')!;
    await drop(room);
    await act(async () => {
      room.querySelector<HTMLElement>(".sp-go")!.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    room.querySelector<HTMLElement>(".sp-explain")!.click();
    expect(asked).toEqual([
      "Explain these financials: revenue trend, leverage, coverage, and which covenant tests move.",
    ]);
  });
});

describe("the room's voice", () => {
  it("carries no em dash in its prose and no exclamation anywhere", async () => {
    const room = open();
    await drop(room);
    await act(async () => {
      room.querySelector<HTMLElement>(".sp-go")!.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(room.textContent ?? "").not.toContain("!");
    /* The em dash the tiles carry is the product's "no figure" mark and is not
       prose. Every surface that writes a sentence is checked for it.
       NARROWED 2026-09-13: `.sp-act` was on this list and the tiles now live
       INSIDE it, because the action is the room's finale sheet and the panel is
       a block of that sheet. The sheet's own sentences are listed one by one
       instead, so the check is no weaker than it was on the surfaces that
       actually write prose. */
    for (const sel of [
      ".sp-guide",
      ".sp-card-f",
      ".sp-card-w",
      ".sp-card-fn",
      ".wk-sheet-t",
      ".wk-sheet-s",
      ".wk-sheet-k",
      ".sp-plan-s",
      ".sp-plan-n",
      ".sp-plan-w",
      ".sp-brief p",
      ".sp-stall",
      ".wk-sheet-acts",
      ".sp-prose",
      ".sp-note",
    ]) {
      for (const node of room.querySelectorAll(sel)) expect(node.textContent ?? "").not.toContain("—");
    }
  });
});
