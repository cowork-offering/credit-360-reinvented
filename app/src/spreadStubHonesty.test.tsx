// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SpreadingRoom } from "./components/workroom/SpreadingRoom";
import { PRE_READ_BEAT_MS, type SpreadDeps } from "./workroom/spreadEngine";
import type { RelationshipSpreadContext } from "./spread/preRead";
import { postReadFacts, NOT_VERIFIED_LINE, VERIFIED_LINE } from "./spread/postRead";
import { provisionalRead } from "./spread/provisional";
import { publishSpread } from "./spread/publishSpread";
import { spreadActivityEntry } from "./actions/executedActivity";
import { boomSystemWord, type SpreadRoomEvent } from "./state/spreadPublish";
import { FinancialsTab } from "./components/tabs/FinancialsTab";
import { AppProvider } from "./state/appState";
import {
  BOOM_UPLOAD_LANE,
  registerPreRead,
  resetStubBoom,
  stubBoomAdapter,
  STUB_PROVISIONAL_MESSAGE,
} from "./channel/boomUpload";
import type { BoomFinancialStatement, DroppedFile, ExtractedDocument, FilePreRead } from "./spread/types";
import type { BorrowerBundle, C360Data } from "./data/contract";
import live from "../../artifact/live-data.json";

/* =============================================================================
   THE STUB SAYS IT IS THE STUB, ON EVERY SURFACE.

   RESTATED 0.9.28. The Boom connector EXISTS now and `BOOM_UPLOAD_LANE` is
   "live": a spread on stage is Boom's own, and the live lane's own cases live in
   spreadLiveLane.e2e.test.ts. What this file still pins is the other half of the
   same promise, and it is not one to let rot: on the day the lane is flipped
   back (an outage, a demo without a connector), the room must say so on every
   surface. A provisional figure a committee reads as a verified spread is the
   one failure this feature can cause, and it is caused by silence.

   So every case below runs the room on the STUB adapter explicitly, and one case
   pins which lane actually ships.

   So the claim is pinned in one place, across all four surfaces the spread
   reaches:

     THE ROOM'S PANEL  says Provisional and offers no verification link.
     THE LADDER        stops at Completed. It never lights Verified.
     THE FINANCIALS TAB says "Provisional, Boom verification pending".
     THE POST-READ     says the spread is not yet verified in Boom.
     THE ACTIVITY TRAIL names the system as "Boom (stub, provisional)".

   And nothing anywhere claims a verification, because verification is an
   analyst's act inside Boom's own page and this cockpit cannot perform one.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COMPANY = "Piedmont Precision Components, Inc.";
const SHA = "a".repeat(64);

const CTX: RelationshipSpreadContext = {
  accountId: "001bb00001DLtRMAA1",
  company: COMPANY,
  onFilePeriods: ["FY2024"],
  covenants: [{ name: "Interest coverage", operator: ">=", threshold: 1.25, current: 4.95 }],
  obligorGroup: [],
};

const PRE_READ: FilePreRead = {
  fileId: `f_${SHA.slice(0, 12)}`,
  statements: [
    {
      statementType: "income_statement",
      periods: [{ key: "FY2025", endDate: "2025-12-31", periodType: "annual" }],
      lines: [
        { label: "Net Sales", accountCode: "net_sales_revenue", values: { FY2025: 64_486_000 }, confidence: "high" },
        { label: "Income from Operations", accountCode: "operating_profit", values: { FY2025: 2_838_000 }, confidence: "high" },
        { label: "Interest Expense", accountCode: "interest_expense", values: { FY2025: -1_076_000 }, confidence: "high" },
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
  id: `f_${SHA.slice(0, 12)}`,
  name: "piedmont-fy2025.csv",
  mime: "text/csv",
  bytes: 2_048,
  base64: "",
  sha256: SHA,
  kind: "csv",
};

const DOC: ExtractedDocument = {
  fileId: DROPPED.id,
  kind: "csv",
  text: "Net Sales,64486000",
  tables: [],
  isScan: false,
  warnings: [],
};

function deps(): SpreadDeps {
  return {
    readDroppedFile: async () => DROPPED,
    extractDocument: async () => DOC,
    preReadFile: async () => PRE_READ,
    provisionalRead,
    postRead: async (args) => postReadFacts(args),
    // THE REAL STUB, with its own ladder and its own clock. Named, not taken
    // from the lane constant: these cases are ABOUT the stub.
    adapter: stubBoomAdapter(),
    lane: "stub" as const,
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

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** The room, all the way to a spread on the stub lane. */
async function roomAfterSpread(onSpreadEvent?: (e: SpreadRoomEvent) => void): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <SpreadingRoom ctx={CTX} onFileBoom={null} deps={deps()} onSpreadEvent={onSpreadEvent} onClose={() => {}} />,
    );
  });
  const room = document.querySelector<HTMLElement>('[data-room="spread"]')!;

  const zone = room.querySelector<HTMLElement>(".sp-drop")!;
  await act(async () => {
    zone.dispatchEvent(
      Object.assign(new Event("drop", { bubbles: true }), {
        dataTransfer: { files: [new File(["x"], "piedmont-fy2025.csv", { type: "text/csv" })] },
      }),
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PRE_READ_BEAT_MS * 12);
  });

  const go = room.querySelector<HTMLElement>(".sp-go")!;
  await act(async () => {
    go.click();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  return room;
}

describe("the stub says it is the stub, wherever it is the one answering", () => {
  it("is not the lane that ships, and names itself in the trail when it is", () => {
    expect(BOOM_UPLOAD_LANE).toBe("live");
    expect(boomSystemWord("live")).toBe("Boom");
    expect(boomSystemWord("stub")).toBe("Boom (stub, provisional)");
  });

  it("never lets the stub adapter answer verified, validated or with a verification page", async () => {
    registerPreRead(SHA, PRE_READ);
    const adapter = stubBoomAdapter();
    const sent = await adapter.upload({
      accountId: CTX.accountId,
      company: { externalUniqueId: CTX.accountId, name: COMPANY },
      file: { name: "x.csv", mime: "text/csv", base64: "", sha256: SHA },
      externalUniqueId: SHA,
      statementQuality: "cpa_audited",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    const settled = await adapter.status(sent.fileId);

    expect(settled.status).toBe("completed");
    expect(settled.message).toBe(STUB_PROVISIONAL_MESSAGE);
    expect(settled.validationUrl).toBeNull();
    expect((settled.financialStatements ?? []).every((s) => s.validationStatus === "not_validated")).toBe(true);
    // The optional method is ABSENT, which is how the room learns it cannot
    // offer "Verify in Boom" yet.
    expect(adapter.validationSession).toBeUndefined();
  });
});

describe("the room's own surfaces", () => {
  it("badges the panel Provisional, offers no verification link, and stops the ladder at Completed", async () => {
    const room = await roomAfterSpread();

    const badge = room.querySelector(".sp-badge");
    expect(text(badge)).toBe("Provisional");
    expect(badge?.classList.contains("is-prov")).toBe(true);
    expect(room.querySelector(".sp-verify")).toBeNull();

    const rung = room.querySelector(".sp-rung")!;
    expect(rung.getAttribute("data-state")).toBe("completed");
    expect(text(rung.querySelector(".sp-rung-w"))).toBe("Completed");
    expect(text(rung)).not.toMatch(/\bverified\b/i);

    // The note under the tiles says where the figures came from.
    expect(text(room)).toContain("Boom's own spread replaces it");
    // And nothing in the room claims a verification.
    expect(text(room)).not.toContain("Validated in Boom");
  });

  it("tells the cockpit what it did, once when the plan goes and once when it settles", async () => {
    const events: SpreadRoomEvent[] = [];
    await roomAfterSpread((e) => events.push(e));

    expect(events.map((e) => e.phase)).toEqual(["sent", "completed"]);
    for (const event of events) {
      expect(event.accountId).toBe(CTX.accountId);
      expect(event.company).toBe(COMPANY);
      expect(event.planKey).toBe(SHA);
      expect(event.fileCount).toBe(1);
      expect(event.provenance).toBe("stub-provisional");
      expect(event.system).toBe("Boom (stub, provisional)");
      expect(event.signedOff).toBe(false);
      expect(event.summary).toBe(`1 statement to Boom, ${COMPANY}: FY2025 audited income statement.`);
    }
    // The plan carries no spread when it leaves; it carries Boom's own when it lands.
    expect(events[0].statements).toEqual([]);
    expect(events[1].statements).toHaveLength(1);
    expect(events[1].failure).toBeNull();
  });
});

describe("the surfaces outside the room", () => {
  it("badges the Financials tab period as provisional and never calls it verified", () => {
    const data = live as unknown as C360Data;
    const staged = (data.borrowers as Record<string, BorrowerBundle>)["001bb00001DLtRMAA1"];
    const statements: BoomFinancialStatement[] = [
      {
        id: "stub-s1",
        statementType: "income_statement",
        endDate: "2026-12-31",
        validationStatus: "not_validated",
        periods: [{ id: "stub-s1-p1", endDate: "2026-12-31", periodType: "annual" }],
        lineItems: [
          {
            id: "stub-s1-l1",
            name: "Net Sales",
            hierarchy: "line_item",
            accountCode: "net_sales_revenue",
            flipSign: false,
            periodValues: { "stub-s1-p1": 71_200_000 },
          },
        ],
      },
    ];
    const boom = publishSpread({ onFile: staged.boom, statements, provenance: "stub-provisional" });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <AppProvider data={data}>
          <FinancialsTab bundle={{ ...staged, boom: boom ?? staged.boom }} />
        </AppProvider>,
      );
    });

    expect(text(container.querySelector("[data-provisional-period]"))).toBe("Provisional, Boom verification pending");
    expect(text(container)).not.toMatch(/\bverified\b/i);
  });

  it("says in the post-read that Boom has not verified it", () => {
    const facts = postReadFacts({
      company: COMPANY,
      before: null,
      after: [
        {
          id: "stub-s1",
          statementType: "income_statement",
          endDate: "2025-12-31",
          validationStatus: "not_validated",
          periods: [{ id: "p1", endDate: "2025-12-31", periodType: "annual" }],
          lineItems: [
            {
              id: "l1",
              name: "Net Sales",
              hierarchy: "line_item",
              accountCode: "net_sales_revenue",
              flipSign: false,
              periodValues: { p1: 64_486_000 },
            },
          ],
        },
      ],
      covenants: CTX.covenants,
      validationStatus: "not_validated",
    });
    expect(facts).toContain(NOT_VERIFIED_LINE);
    expect(facts).not.toContain(VERIFIED_LINE);
  });

  it("names the system as the stub in the relationship's activity trail", () => {
    const system = boomSystemWord("stub");
    const sent = spreadActivityEntry({
      phase: "sent",
      company: COMPANY,
      summary: `1 statement to Boom, ${COMPANY}: FY2025 audited income statement.`,
      system,
      planKey: SHA,
      fileCount: 1,
    });
    const done = spreadActivityEntry({
      phase: "completed",
      company: COMPANY,
      summary: `1 statement to Boom, ${COMPANY}: FY2025 audited income statement.`,
      system,
      planKey: SHA,
      fileCount: 1,
      period: "FY2025",
    });

    expect(sent.title).toBe("Financial statements sent to Boom (stub, provisional)");
    expect(done.title).toBe(`Boom (stub, provisional) spread FY2025 for ${COMPANY}`);
    expect(done.detail?.body).toContain("An analyst has not signed this spread off in Boom.");
    for (const entry of [sent, done]) {
      expect(entry.reference?.source).toBe("Boom (stub, provisional)");
      expect(`${entry.title} ${entry.summary ?? ""} ${entry.detail?.body ?? ""}`).not.toMatch(/\bverified\b/i);
    }
  });
});

describe("the live lane is the only thing that changes any of this", () => {
  it("names Boom plainly once the connector is behind the adapter", () => {
    expect(boomSystemWord("live")).toBe("Boom");
  });
});
