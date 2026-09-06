// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import live from "../../artifact/live-data.json";
import { Workroom, neutralAsk, type WorkroomRouter } from "./components/workroom/Workroom";
import { createModifyEngine } from "./workroom/modifyEngine";
import { workroomContextFor } from "./workroom/openWorkroom";
import { clearComposed } from "./workroom/engine";
import { resetCatalog } from "./channel/catalog";
import { resetSessionDoor } from "./channel/sampleDoor";
import { MemoRoom, steerTarget, type MemoContext, type MemoDeps } from "./components/memo/MemoRoom";
import type { MemoFiledSummary } from "./components/memo/memoSession";
import { closeMemoRoom, openMemoRoom, useMemoRoom } from "./components/memo/memoSession";
import { changesFromFiled, splitOfFiled } from "./components/memo/carry";
import { memoGreeting, executedRead } from "./components/memo/memoGreeting";
import { buildMemoDossier } from "./memo/dossier";
import { renderPlanFor, sectionsFrom, renderMemo } from "./memo/renderMemo";
import { applyMemoOverrides, memoDateFrom, MEMO_TYPE_FOR } from "./memo/overrides";
import { NOT_WIRED_LINE } from "./memo/publish";
import type { MemoDraft } from "./memo/store";
import type { ReviewFrame, ReviewFrameWindow } from "./memo/reviewBridge";
import type { FiledLine } from "./components/workroom/FiledList";
import type { ActionHistoryRow, ActionStep, BorrowerBundle, C360Data } from "./data/contract";
import type { MemoChange } from "./memo/types";

/* =============================================================================
   THE CREDIT MEMO ROOM, AS A SESSION.

   What is proved here is the ROOM and its two doors: that the facility room
   offers the memo without pretending it is a fourth route, that a finale hands
   its ledger over, that the greeting states what the ORG says was executed and
   says so honestly when the org says nothing, that the conversation speaks in
   the same bubbles the other two rooms speak in, that the reading pane holds
   the memo the renderer produced with its DRAFT banner and the memo's OWN
   review panel under every section, that the publish door stays shut with its
   reason on it until every section has been reviewed, and that what comes back
   from the writeback seam is the truth about this build.

   THE SIGN-OFF IS DRIVEN THROUGH THE MEMO'S OWN BUTTONS. jsdom never loads a
   `srcdoc` frame, so `attach()` parses the document the pane is showing, runs
   the review shell the room injected into it, and hands the result back to the
   room as `deps.frame`. What the assertions click is `review-shell.js`.

   The renderer is proved in memo/parity.test.ts, the substitution seam in
   memo/overrides.test.ts, the change list and the greeting's sentences in
   components/memo/memoGreeting.test.ts and the store in memo/store.test.ts.
   Nothing below reaches a connector: the narrator and the publisher are
   injected, which is the same discipline the other two rooms' tests follow.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => resetSessionDoor());

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  act(() => closeMemoRoom());
  document.body.className = "";
  delete (window as unknown as { claude?: unknown }).claude;
  clearComposed();
  resetCatalog();
});

const data = live as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";
const PACKAGE = "a5Fbb000000IHFJEA4";
const bundle = data.borrowers![HARTWELL] as BorrowerBundle;

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/* ----------------------------------------------------------------- fixtures */

/** The org's own step detail for an executed modification on this package. */
const STEPS: ActionStep[] = [
  {
    id: "write_amount",
    type: "write",
    label: "Increase the line of credit to $15.0M",
    objectName: "LLC_BI__Loan__c",
    targetLoanId: "a4Zbb0000027MaYEAU",
    targetLabel: "Line of Credit",
    field: "LLC_BI__Amount__c",
    before: "$12,000,000",
    after: "$15,000,000",
    state: "verified",
    verification: "Customer360Exposure returned committed 15000000",
    orgRecordId: "a4Zbb0000027MaYEAU",
  },
  {
    id: "write_loan",
    type: "write",
    label: "Book the $3.0M equipment term loan",
    objectName: "LLC_BI__Loan__c",
    targetLoanId: "a4Zbb000002CECXEA4",
    targetLabel: "Equipment",
    field: "LLC_BI__Amount__c",
    after: "$3,000,000",
    state: "verified",
    orgRecordId: "a4Zbb000002CECXEA4",
  },
];

const trailRow = (steps: ActionStep[] | undefined): ActionHistoryRow => ({
  stagingId: "a8abb00001NL6ZUAA1",
  actionId: "loan-modification",
  status: "Completed",
  executedAt: "2026-09-03T14:02:00Z",
  productPackageId: PACKAGE,
  accountId: HARTWELL,
  steps,
  stepCount: steps?.length,
  changeCounts: steps ? { requested: 1, derived: 1 } : undefined,
});

/** The ledger the facility room's finale card is showing when it hands over. */
const FILED: FiledLine[] = [
  {
    key: "d1",
    icon: "commit",
    title: "Increase the line of credit",
    target: "Line of Credit",
    before: "$12.0M",
    after: "$15.0M",
    recordId: "a4Zbb0000027MaYEAU",
  },
  {
    key: "d2",
    icon: "pricing",
    title: "Reprice to SOFR + 250",
    target: "Line of Credit",
    after: "5.83%",
    recordId: "a4Kbb000001PRCEAA2",
    derivedReason: "nCino requires a pricing row when a commitment moves",
  },
];

const ctxFor = (over: Partial<MemoContext> = {}): MemoContext => ({
  accountId: HARTWELL,
  accountName: "Hartwell Precision Manufacturing LLC",
  packageId: PACKAGE,
  packageName: "Hartwell C&I Credit Package",
  trigger: "modify",
  user: "Fabian Goetzens",
  generatedAt: "2026-09-04T09:12:00Z",
  source: null,
  ...over,
});

interface Mounted {
  room: HTMLElement;
  prompts: string[];
  published: MemoDraft[];
  saved: MemoDraft[];
  /** Open the memo the pane is showing as the frame it is being read in, run
   *  its own review shell against it, and give the room the seam. */
  attach: () => ReviewFrame;
}

function openRoom(
  args: {
    rows?: ActionHistoryRow[];
    carried?: MemoChange[] | null;
    deps?: Partial<MemoDeps>;
    latest?: MemoDraft | null;
    ctx?: Partial<MemoContext>;
    /** The sheet the finale handed over, and whether its slide has finished. */
    filed?: MemoFiledSummary | null;
    settled?: boolean;
  } = {},
): Mounted {
  const executed = executedRead(args.rows ?? [], PACKAGE);
  const changes = executed.hasSteps ? executed.changes : (args.carried ?? []);
  const dossier = buildMemoDossier({
    bundle,
    changes,
    instanceUrl: data.meta?.instanceUrl ?? null,
    productPackageName: "Hartwell C&I Credit Package",
  });
  const greeting = memoGreeting({
    packageId: PACKAGE,
    trigger: "modify",
    executed,
    carried: args.carried ?? null,
    carriedSplit: args.carried ? splitOfFiled(FILED) : null,
    plan: renderPlanFor(dossier),
    hasStoredMemo: args.latest != null,
    filed: args.filed ?? null,
  });

  const prompts: string[] = [];
  const published: MemoDraft[] = [];
  const saved: MemoDraft[] = [];
  const deps: MemoDeps = {
    narrate: async ({ prompt, onText }) => {
      prompts.push(prompt);
      const reply = "The recommendation is to approve the increase.";
      onText?.(reply);
      return reply;
    },
    publish: async (draft) => {
      published.push(draft);
      return { memoId: draft.memoId, packageId: draft.packageId, status: "not-wired" as const, lanes: [], reason: NOT_WIRED_LINE };
    },
    save: async (draft) => {
      saved.push(draft);
      return draft;
    },
    ...args.deps,
  };

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const paint = (extra: Partial<MemoDeps> = {}) => {
    act(() => {
      root!.render(
        <MemoRoom
          ctx={ctxFor(args.ctx)}
          dossier={dossier}
          changes={changes}
          greeting={greeting}
          filed={args.filed ?? null}
          settled={args.settled ?? true}
          latest={args.latest ?? null}
          deps={{ ...deps, ...extra }}
          onClose={() => {}}
        />,
      );
    });
  };
  paint();

  /* THE FRAME, AS A BROWSER WOULD HAVE IT. Only the two scripts the room
     injected are executed: the reviewer assignment and the review shell, in
     the order the document puts them in. The memo's own progress pill is left
     alone because jsdom has no IntersectionObserver, and the bridge's
     behaviour with a pill already on the hook is proved in
     `memo/reviewBridge.test.ts`. */
  const attach = (): ReviewFrame => {
    const srcdoc = document.querySelector<HTMLIFrameElement>(".mm-doc")!.getAttribute("srcdoc")!;
    const doc = new DOMParser().parseFromString(srcdoc, "text/html");
    const win: ReviewFrameWindow = {};
    for (const script of [...doc.querySelectorAll("script")].slice(-2)) {
      new Function("window", "document", script.textContent ?? "")(win, doc);
    }
    const frame: ReviewFrame = { doc, win };
    paint({ frame });
    return frame;
  };

  return { room: document.querySelector<HTMLElement>(".mm-room")!, prompts, published, saved, attach };
}

/** Type into a controlled input the way React sees it: the native value setter,
 *  so React's own value tracker registers the change rather than ignoring it. */
async function type(room: HTMLElement, selector: string, value: string, enter = true) {
  const input = room.querySelector<HTMLInputElement>(selector)!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
  if (!enter) return;
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
  });
}

const click = async (el: Element | null) => {
  await act(async () => {
    (el as HTMLButtonElement).click();
    await Promise.resolve();
  });
};

/** Press one of the memo's own review controls, inside the frame. The bridge
 *  reads the shell one microtask later, which is still inside the click. */
const press = async (root: ParentNode, selector: string) => {
  await act(async () => {
    root.querySelector<HTMLElement>(selector)!.click();
    await Promise.resolve();
  });
};

/* ======================================================== THE TWO DOORS IN */

describe("the door from the facility room", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sits under the three routes and is not a fourth chip", async () => {
    const opened: string[] = [];
    const context = workroomContextFor({
      mode: "modify",
      data,
      bundle,
      accountId: HARTWELL,
      accountName: "Hartwell Precision Manufacturing LLC",
      productPackageId: PACKAGE,
    });
    const router: WorkroomRouter = {
      question: neutralAsk(),
      say: null,
      onBind: () => {},
      onRestart: () => {},
      onMemo: () => opened.push("memo"),
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <Workroom
          context={context}
          engine={createModifyEngine({ context, data, bundle })}
          router={router}
          reads={{ bundle, accountName: context.accountName, productPackageId: PACKAGE, generatedAt: data.meta?.generatedAt }}
          onClose={() => {}}
        />,
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    const room = document.querySelector<HTMLElement>(".wk-room")!;
    // THE THREE ROUTES ARE STILL THREE. A memo binds no engine and stages
    // nothing, so it never took a seat in the row that picks one.
    expect(room.querySelectorAll(".wk-routes .wk-opt").length).toBe(3);

    const door = room.querySelector<HTMLElement>('.wk-memobtn[data-door="memo"]')!;
    expect(door).toBeTruthy();
    expect(text(door)).toBe("Credit memo");
    expect(text(room.querySelector(".wk-memonote"))).toContain("Nothing is staged");

    await click(door);
    expect(opened).toEqual(["memo"]);
  });
});

describe("the door from the finale", () => {
  it("opens the memo room on the version that was just filed, carrying its ledger", () => {
    act(() =>
      openMemoRoom({
        accountId: HARTWELL,
        accountName: "Hartwell Precision Manufacturing LLC",
        productPackageId: PACKAGE,
        trigger: "modify",
        carried: changesFromFiled(FILED),
        carriedSplit: splitOfFiled(FILED),
      }),
    );

    let session: ReturnType<typeof useMemoRoom> = null;
    function Probe() {
      session = useMemoRoom();
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Probe />));

    expect(session!.productPackageId).toBe(PACKAGE);
    expect(session!.trigger).toBe("modify");
    expect(session!.carried).toHaveLength(2);
    expect(session!.carried![0].orgId).toBe("a4Zbb0000027MaYEAU");
    expect(session!.carriedSplit).toEqual({ requested: 1, derived: 1 });
  });

  it("opens from the FAB with no ledger at all, which is a legitimate state", () => {
    act(() =>
      openMemoRoom({ accountId: HARTWELL, accountName: "Hartwell", productPackageId: PACKAGE }),
    );
    let session: ReturnType<typeof useMemoRoom> = null;
    function Probe() {
      session = useMemoRoom();
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Probe />));

    expect(session!.trigger).toBe("adhoc");
    expect(session!.carried).toBeNull();
    act(() => closeMemoRoom());
  });

  it("carries the filed rows without recomputing one of them", () => {
    const changes = changesFromFiled(FILED);
    expect(changes.map((c) => c.label)).toEqual(["Increase the line of credit", "Reprice to SOFR + 250"]);
    expect(changes[0].before).toEqual({ printed: "$12.0M" });
    // A row with no before was a create, and the absence is preserved.
    expect(changes[1].before).toBeUndefined();
    expect(splitOfFiled(FILED)).toEqual({ requested: 1, derived: 1 });
  });
});

/* ========================================================== THE GREETING */

describe("the greeting on the glass", () => {
  it("states what the org says was executed", () => {
    const { room } = openRoom({ rows: [trailRow(STEPS)] });
    const said = text(room.querySelector(".wk-thread"));
    expect(said).toContain("Since the last memo on");
    expect(said).toContain("a modification filed 3 Sep");
    expect(said).toContain("2 changes");
    /* The render plan stands above the pane, not in the thread (founder, 2026-09-04). */
    expect(said).not.toContain("Render plan:");
    expect(said).toContain("Draft it, or steer me first?");
  });

  it("says the honest line when the org read carries no step detail", () => {
    const { room } = openRoom({ rows: [trailRow(undefined)], carried: changesFromFiled(FILED) });
    const said = text(room.querySelector(".wk-thread"));
    expect(said).toContain("Working from what this session just filed");
  });

  it("offers Draft and Steer, and the stored memo only when there is one", () => {
    const { room } = openRoom({ rows: [trailRow(STEPS)] });
    expect([...room.querySelectorAll(".mm-chip")].map(text)).toEqual(["Draft", "Steer"]);
  });

  it("says what asked for the memo, when an instruction did", () => {
    const { room } = openRoom({
      rows: [trailRow(STEPS)],
      ctx: { source: { kind: "email", from: "cfo@hartwell.example", subject: "Increase on the line" } },
    });
    expect(text(room.querySelector(".wk-thread"))).toContain(
      'This one was asked for by email from cfo@hartwell.example: "Increase on the line".',
    );
  });

  it("says nothing about a source when a banker simply opened the room", () => {
    const { room } = openRoom({ rows: [trailRow(STEPS)] });
    expect(text(room.querySelector(".wk-thread"))).not.toContain("asked for by");
  });
});

/* ======================================================= THE CONVERSATION */

describe("the conversation", () => {
  it("speaks in the rooms' own bubbles, with the identity chip above each one", async () => {
    const { room } = openRoom({ rows: [trailRow(STEPS)] });
    const bubbles = () => [...room.querySelectorAll<HTMLElement>(".wk-thread .wk-msg")];

    /* THE SAME GRAMMAR AS THE OTHER TWO ROOMS (founder, 2026-09-04). Not one
       class of this room's own: the wrapper, the bubble, the side and the
       identity chip are all the shared primitives. */
    expect(bubbles().length).toBeGreaterThanOrEqual(2);
    expect(bubbles().every((b) => !!b.querySelector(".wk-bub"))).toBe(true);
    expect(bubbles().every((b) => b.className.includes("wk-agent") || b.className.includes("wk-banker"))).toBe(true);

    const greeting = bubbles()[0];
    expect(greeting.className).toContain("wk-agent");
    // The chip is `content: attr(data-who)` in workroom.css, so the attribute
    // IS the chip: no attribute, no chip, which is what this room had.
    expect(greeting.dataset.who).toBe("Agent");
    // And the agent speaks word by word rather than pasting (rule 65).
    expect(greeting.querySelectorAll(".wk-bub .wk-w").length).toBeGreaterThan(3);
    expect(text(room.querySelector(".wk-thread"))).toContain("Since the last memo on");

    // Every exchange is the shared settle wrapper, so the collapse is theirs too.
    expect(room.querySelector('.wk-thread > .wk-ex[data-settle-state="on"] > .wk-ex-in .wk-msg')).toBeTruthy();
    // The chips are the shared option row, not a fourth kind of control.
    expect(room.querySelector(".wk-opts.mm-chips .wk-opt.mm-chip")).toBeTruthy();

    await click([...room.querySelectorAll(".mm-chip")].find((c) => text(c) === "Draft")!);

    // THE BANKER HANGS ON THE OTHER SIDE, with their own chip on it.
    const banker = bubbles().find((b) => b.className.includes("wk-banker"))!;
    expect(banker.dataset.who).toBe("You");
    expect(text(banker)).toBe("Draft it.");
    expect(banker.querySelector(".wk-bub")).toBeTruthy();

    /* AND THE LINE THAT CLOSES THE DRAFT IS THE SAME BUBBLE. The per-section
       receipts are gone: the work is a timeline while it happens and one
       compact row afterwards (founder, 2026-09-04), so what the agent says at
       the end is a sentence about the memo rather than a seventh "X written." */
    const closing = bubbles().filter((b) => text(b).startsWith("The memo is drafted"));
    expect(closing).toHaveLength(1);
    expect(closing[0].className).toContain("wk-agent");
    expect(closing[0].dataset.who).toBe("Agent");
    expect(closing[0].querySelectorAll(".wk-bub .wk-w").length).toBeGreaterThan(1);

    // The settled exchanges stay mounted and summonable, under their own row.
    expect(room.querySelectorAll('.wk-thread > .wk-ex[data-settle-state="settled"]').length).toBeGreaterThan(0);
    expect(room.querySelector(".wk-thread .wk-settled")).toBeTruthy();
  });
});

/* ======================================================== THE READING PANE */

describe("the reading pane", () => {
  it("holds the rendered memo, with the DRAFT banner in it", () => {
    const { room } = openRoom({ rows: [trailRow(STEPS)] });
    const frame = room.querySelector<HTMLIFrameElement>(".mm-doc")!;
    const html = frame.getAttribute("srcdoc") ?? "";
    expect(html).toContain("Commercial Credit Memo");
    expect(html).toContain("DRAFT, PENDING CREDIT COMMITTEE REVIEW");
    expect(html).toContain("Hartwell Precision Manufacturing LLC");
    // And it is the memo the seam finished with, not the vendored renderer's.
    expect(html).not.toContain("Demo Commercial RM");
    expect(html).toContain("Fabian Goetzens");
  });

  it("carries the memo's OWN review panel per section, and no rail of its own", () => {
    const dossier = buildMemoDossier({ bundle, changes: [], instanceUrl: data.meta?.instanceUrl ?? null });
    const expected = sectionsFrom(
      applyMemoOverrides(renderMemo(dossier).html, {
        rmName: "Fabian Goetzens",
        memoDate: memoDateFrom("2026-09-04T09:12:00Z"),
        memoType: MEMO_TYPE_FOR.modify,
      }),
    );

    const { room, attach } = openRoom();
    /* THE ROOM'S OWN APPROVE / FLAG RAIL IS GONE (founder, 2026-09-04). The
       reading pane is the whole right lane and the decision lives under the
       section, in the document, where the banker is reading. */
    expect(room.querySelector(".mm-edge")).toBeNull();
    expect(room.querySelector(".mm-ctl")).toBeNull();

    const frame = attach();
    const controls = [...frame.doc.querySelectorAll(".rv-ctrl")];
    expect(controls).toHaveLength(expected.length);
    expect(controls.every((c) => !!c.querySelector(".rv-approve"))).toBe(true);
    // One sticky bar, naming the banker, with review-all on it and the CLI's
    // hand-off (Export sign-offs) taken off the glass.
    expect(text(frame.doc.querySelector(".rv-bar .rv-id"))).toContain("Fabian Goetzens");
    expect(frame.doc.querySelector(".rv-all")).toBeTruthy();
    const srcdoc = room.querySelector<HTMLIFrameElement>(".mm-doc")!.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain(".rv-bar .rv-export{display:none!important}");
  });

  it("states the review progress and the render plan, and keeps suppressed quiet", () => {
    const { room, attach } = openRoom({ rows: [trailRow(STEPS)] });
    const total = attach().doc.querySelectorAll(".rv-ctrl").length;
    expect(text(room.querySelector(".mm-prog"))).toBe(`0 of ${total} sections reviewed`);
    expect(text(room.querySelector(".mm-plan"))).toMatch(/^\d+ modules on$/);

    // SUPPRESSED IS NOT A GAP: one line, collapsed, with the reasons inside it.
    const supp = room.querySelector<HTMLDetailsElement>(".mm-supp")!;
    expect(supp.open).toBe(false);
    expect(text(supp.querySelector("summary"))).toMatch(/^\d+ suppressed by the deal's flags$/);
    expect(supp.querySelectorAll("li").length).toBeGreaterThan(0);
  });
});

/* ======================================================== THE ATTESTATION */

describe("the publish door", () => {
  it("is shut, with its reason on it, until the memo says every section is reviewed", async () => {
    const { room, attach } = openRoom({ rows: [trailRow(STEPS)] });
    const frame = attach();
    const total = frame.doc.querySelectorAll(".rv-ctrl").length;

    /* THE DOOR IS NOT THERE UNTIL THE WORK IS DONE (founder, 2026-09-04): no
       greyed button, one quiet line of where the review stands. */
    expect(room.querySelector(".mm-publish")).toBeNull();
    expect(text(room.querySelector(".mm-why"))).toBe(`${total} sections still to attest`);

    // One sign-off, taken inside the memo, and the room hears it.
    await press(frame.doc, ".rv-approve");
    expect(room.querySelector(".mm-publish")).toBeNull();
    expect(text(room.querySelector(".mm-prog"))).toBe(`1 of ${total} sections reviewed`);

    await press(frame.doc, ".rv-all");

    expect(room.querySelector<HTMLButtonElement>(".mm-publish")!.disabled).toBe(false);
    expect(room.querySelector(".mm-why")).toBeNull();
    expect(text(room.querySelector(".mm-prog"))).toBe(`${total} of ${total} sections reviewed`);
  });

  it("shuts again when the banker undoes one, because the shell is the truth", async () => {
    const { room, attach } = openRoom({ rows: [trailRow(STEPS)] });
    const frame = attach();
    await press(frame.doc, ".rv-all");
    expect(room.querySelector(".mm-publish")).toBeTruthy();

    await press(frame.doc, ".rv-undo");
    expect(room.querySelector(".mm-publish")).toBeNull();
    expect(text(room.querySelector(".mm-why"))).toBe("1 section still to attest");
  });

  it("takes the banker's own words out of the frame and into what gets published", async () => {
    const { room, attach, published } = openRoom({ rows: [trailRow(STEPS)] });
    const frame = attach();
    const edited = frame.doc.querySelector<HTMLElement>("section[data-mod] .rv-edit")!.closest("section")!;
    const modId = edited.getAttribute("data-mod")!;

    await press(edited, ".rv-edit");
    edited.querySelector<HTMLElement>("[data-editable]")!.innerHTML = "<p>The Kokomo appraisal is stale.</p>";
    await press(edited, ".rv-save");

    // An edit IS a sign-off: it is the banker's paragraph now, not the model's.
    expect(text(room.querySelector(".mm-prog"))).toMatch(/^1 of \d+ sections reviewed$/);

    await press(frame.doc, ".rv-all");
    await click(room.querySelector(".mm-publish"));

    const section = published[0].sections.find((sec) => sec.id === modId)!;
    expect(section.status).toBe("edited");
    expect(section.note).toBe("Revised in review");
    expect(section.by).toBe("Fabian Goetzens");
    // And the published memo carries what the banker wrote, not the draft.
    expect(published[0].html).toContain("The Kokomo appraisal is stale.");
    expect(published[0].html).not.toContain("rv-ctrl");
  });
});

/* ============================================================ THE FINALE */

describe("the finale", () => {
  it("exhales into one card and says the truth about this build's writeback", async () => {
    const { room, attach, published, saved } = openRoom({ rows: [trailRow(STEPS)] });
    await press(attach().doc, ".rv-all");
    await click(room.querySelector(".mm-publish"));

    // The seam was called with the draft the room is holding.
    expect(published).toHaveLength(1);
    expect(published[0].packageId).toBe(PACKAGE);
    expect(published[0].sections.every((s) => s.status === "approved")).toBe(true);
    expect(saved).toHaveLength(1);

    // The pane is gone and the card is alone on the stage.
    expect(room.dataset.finale).toBe("still");
    expect(room.querySelector(".mm-pane")!.getAttribute("data-finale")).toBe("still");

    const card = room.querySelector<HTMLElement>(".mm-card")!;
    expect(text(card)).toContain("Credit memo attested");
    expect(text(card)).toContain(PACKAGE);
    expect(card.querySelector(".aura")).toBeTruthy();
    expect(text(card)).toContain(NOT_WIRED_LINE);

    // One door, the room's own word for it, and one quiet line.
    const afterglow = room.querySelector<HTMLElement>(".wk-afterglow")!;
    expect(text(afterglow.querySelector(".wk-ag-close"))).toBe("Close workroom");
    expect(text(afterglow.querySelector(".wk-ag-note"))).toBe(NOT_WIRED_LINE);
    // And the composer has gone with the rest of the room.
    expect(room.querySelector<HTMLElement>(".wk-composer")!.hidden).toBe(true);
  });
});

/* ========================================================== THE NARRATIVE */

describe("drafting and steering", () => {
  it("draws the prose section by section, around figures it is forbidden to invent", async () => {
    const { room, prompts } = openRoom({ rows: [trailRow(STEPS)] });
    await click([...room.querySelectorAll(".mm-chip")].find((c) => text(c) === "Draft")!);

    expect(prompts.length).toBeGreaterThan(3);
    for (const prompt of prompts) {
      expect(prompt).toContain("EVERY FIGURE YOU USE MUST APPEAR VERBATIM IN THE FIGURES BLOCK");
      expect(prompt).toContain("FIGURES (the memo's own; use these and no others)");
      expect(prompt).toContain("Hartwell Precision Manufacturing LLC");
    }
    /* EVERY SECTION IS A ROW ON THE TIMELINE, and every one of them landed. */
    const rows = [...room.querySelectorAll<HTMLElement>(".mm-tl-row")];
    expect(rows.length).toBe(prompts.length);
    expect(rows.every((r) => r.dataset.state === "done")).toBe(true);
    // And the chips have retired now the memo is on the glass.
    expect(room.querySelector(".mm-chip")).toBeNull();
  });

  it("stores the draft once the prose has landed, so it can be opened again", async () => {
    const { room, saved } = openRoom({ rows: [trailRow(STEPS)] });
    await click([...room.querySelectorAll(".mm-chip")].find((c) => text(c) === "Draft")!);
    expect(saved).toHaveLength(1);
    expect(saved[0].packageId).toBe(PACKAGE);
    expect(saved[0].generator).toBe("cockpit");
    expect(Object.keys(saved[0].narratives).length).toBeGreaterThan(0);
    expect(saved[0].html).toContain("Commercial Credit Memo");
  });

  it("says which half is missing when the desk is not connected", async () => {
    const { room } = openRoom({ rows: [trailRow(STEPS)], deps: { narrate: undefined } });
    await click([...room.querySelectorAll(".mm-chip")].find((c) => text(c) === "Draft")!);
    expect(text(room.querySelector(".wk-thread"))).toContain("The desk is not connected");
  });

  it("rewrites one named section and no others", async () => {
    const { room, prompts } = openRoom({ rows: [trailRow(STEPS)] });
    await type(room, ".wk-txt", "tighten the covenant paragraph");

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("The banker asked for this specifically: tighten the covenant paragraph");
    expect(text(room.querySelector(".wk-thread"))).toContain("Rewriting");
  });

  it("asks rather than guessing when a line names no section", async () => {
    const { room, prompts } = openRoom({ rows: [trailRow(STEPS)] });
    await type(room, ".wk-txt", "make it better");
    expect(prompts).toHaveLength(0);
    expect(text(room.querySelector(".wk-thread"))).toContain("Name the section");
  });

  it("resolves a steer against the sections the renderer actually stamped", () => {
    const sections = sectionsFrom(renderMemo(buildMemoDossier({ bundle, changes: [] })).html);
    expect(steerTarget("tighten the covenant paragraph", sections)).toBe("covenant_conditions");
    expect(steerTarget("mention the Kokomo appraisal in collateral", sections)).toBe("collateral");
    expect(steerTarget("make it better", sections)).toBeNull();
  });
});

/* =============================================================================
   THE HAND FROM THE FILED SHEET (founder, 2026-09-06).

   "This then directs you to the Credit memo workroom where it inserts all the
   information, but all super super gentle, no hangers."

   TWO CLAIMS. The sheet becomes this room's first timeline row, in the room's
   own grammar rather than as a card imported from another room; and the draft
   starts ITSELF, but only once the facility room's slide has finished, because
   prose landing under a moving surface is the hanger the founder named.
   ============================================================================= */

const HANDOVER: MemoFiledSummary = {
  title: "Filed on Hartwell, Hartwell C&I Credit Package, version a5Fbb000000J61hEAC",
  version: "a5Fbb000000J61hEAC",
  kind: "modify",
  items: [
    { id: "f1", label: "Commitment amount", target: "Line of Credit", before: "$15,000,000", after: "$18,000,000" },
  ],
  exposureBefore: "$46.0M",
  exposureAfter: "$49.0M",
  pending: true,
};

describe("the hand from the filed sheet", () => {
  it("draws the filing as the room's first timeline row, in the timeline's own grammar", async () => {
    const { room } = openRoom({ filed: HANDOVER, settled: false });
    const first = room.querySelector(".mm-filed")!;
    expect(first).toBeTruthy();
    // The same classes the draft's own timeline uses, so the two read as one.
    expect(first.classList.contains("mm-work")).toBe(true);
    expect(text(first.querySelector(".mm-work-lead"))).toBe(HANDOVER.title);
    const rows = [...first.querySelectorAll(".mm-tl-row")];
    expect(rows.map((r) => r.getAttribute("data-kind"))).toEqual(["filed", "exposure"]);
    // Every row is already done: this is the past tense of the timeline below it.
    for (const r of rows) expect(r.getAttribute("data-state")).toBe("done");
    expect(text(rows[0])).toContain("Line of Credit · Commitment amount");
    // The exposure carries the org's outstanding confirmation, unchanged.
    expect(text(rows[1])).toContain("$46.0M → $49.0M pending");
  });

  it("writes nothing while the facility room's sheet is still sliding off it", async () => {
    /* THE HANGER THE FOUNDER NAMED. Prose landing under a moving surface is the
       one thing the handover must not do, so the draft waits for the slide's own
       end rather than for a clock of its own. */
    const { room, prompts } = openRoom({ filed: HANDOVER, settled: false });
    expect(prompts).toHaveLength(0);
    expect(room.querySelector('.mm-work[data-work="draft"]')).toBeNull();
  });

  it("drafts without being asked once the glass has settled", async () => {
    // THE BANKER ALREADY ANSWERED THE QUESTION by pressing the door on the
    // sheet, so the room does not put it to them a second time.
    const { prompts } = openRoom({ filed: HANDOVER, settled: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(prompts.length).toBeGreaterThan(0);
  });

  it("asks the greeting's question as usual when nothing was handed over", async () => {
    const { room, prompts } = openRoom();
    expect(room.querySelector(".mm-filed")).toBeNull();
    expect(prompts).toHaveLength(0);
    expect(room.querySelector('[data-chip="draft"]')).toBeTruthy();
  });
});
