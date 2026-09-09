// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom, neutralAsk, type WorkroomRouter } from "./components/workroom/Workroom";
import { clearComposed } from "./workroom/engine";
import { createModifyEngine } from "./workroom/modifyEngine";
import { workroomContextFor } from "./workroom/openWorkroom";
import { IN_FLIGHT_REFUSAL, lockedSourcePackage, packageRoster } from "./book/packages";
import { filedAmount } from "./components/FiledChip";
import { resetSessionDoor } from "./channel/sampleDoor";
import { resetCatalog } from "./channel/catalog";
import { AppProvider } from "./state/appState";
import { AppShell } from "./components/AppShell";
import { AppEntry, dispatchWriteBack } from "./test/entry";
import { clearOverlays } from "./state/syncOverlay";
import type { ActionHistoryRow, C360Data, Facility } from "./data/contract";
import type { WorkroomMode } from "./workroom/types";
import live from "../../artifact/live-data.json";

/* =============================================================================
   TWO PRODUCT RULES, FOUNDER 2026-09-03.

   RULE 1  BOOKED IS THE ONLY COMMITTED. A modification files an UNBOOKED new
           package version; it is real when nCino's booking run approves it and
           not before. So no booked figure in the cockpit moves on an execute.
           What the execute earns is a LABELLED, adjacent figure: the hero
           anchor and the worklist row state the booked exposure and carry a
           quiet "+$5.0M filed · booking pending" chip beside it. Nothing sums.

   RULE 2  ONE MODIFICATION IN FLIGHT PER PACKAGE. A package that already has an
           unbooked version with the org cannot start another: the room lists
           the version, refuses Modify and Renew by name, and hands over the
           door to it. A new facility of its own and the relationship reviews
           are untouched, because neither forks a version.

   THE FIXTURE IS SYNTHETIC AND THE REASON IS PUBLISHED. Hartwell's org DOES
   carry a real in-flight version today (a5Fbb000000J6PtEAK: seven loans, every
   one `stage: "Qualification"`, mirroring the booked C&I package), created by
   the founder's own final test and kept deliberately. The published bundle
   predates it, so these tests fork the shipped Hartwell into the same shape
   rather than pinning assertions to a book that carries no version — which is
   also why `design/probes/drive-hygiene.mjs` still drives clean: on the
   shipped bundle nothing locks.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const shipped = live as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";
const HARTWELL_NAME = "Hartwell Precision Manufacturing LLC";
/** The booked C&I package. The source, in the org and in the fixture. */
const SOURCE = "a5Fbb000000IHFJEA4";
/** The version's own id, at the org's own shape. */
const VERSION = "a5Fbb000000J6PtEAK";
/** A second booked package, for the trail-correction case. */
const OTHER_SOURCE = "a5Fbb000000J6BNEA0";
/** The commitment the modification moved: the 15.0M revolver, up 5.0M. */
const DELTA_MM = 5;

/**
 * THE FORK, AT THE ORG'S OWN SHAPE.
 *
 * nCino copies every member into the new version at an unbooked stage and
 * carries the loan NAMES across verbatim — except on the facility the
 * modification changed, whose amount is part of its own name. That is exactly
 * what this builds: six booked members, six Qualification copies, one of them
 * renamed from $15,000,000.00 to $20,000,000.00.
 */
function withInFlightVersion(
  data: C360Data,
  opts: { versionId?: string; members?: number } = {},
): C360Data {
  const versionId = opts.versionId ?? VERSION;
  const next = JSON.parse(JSON.stringify(data)) as C360Data;
  const bundle = next.borrowers![HARTWELL];
  const booked = (shipped.borrowers![HARTWELL].exposure?.facilities ?? []).filter(
    (f) => f.productPackageId === SOURCE && f.stage === "Booked",
  );
  const source = opts.members ? booked.slice(0, opts.members) : booked;
  const copies: Facility[] = source.map((f, i) => ({
    ...JSON.parse(JSON.stringify(f)),
    loanId: `a4Zbb000002IEp${i}EAG`,
    productPackageId: versionId,
    stage: "Qualification",
    ...(f.committed === 15_000_000
      ? {
          committed: 20_000_000,
          name: `${HARTWELL_NAME} - Line of Credit - $20,000,000.00`,
        }
      : {}),
  }));
  bundle.exposure!.facilities = [...source, ...copies];
  return next;
}

/** One filed loan-modification row, at the envelope's OBSERVED shape: the
 *  source package in `productPackageId`, and a LOAN of the version it created
 *  in `resultRecordId` — never the output package's own id. */
const modRow = (over: Partial<ActionHistoryRow> = {}): ActionHistoryRow => ({
  stagingId: "a8abb00001O3FdwAAF",
  actionId: "loan-modification",
  status: "Partial",
  productPackageId: SOURCE,
  resultRecordId: "a4Zbb000002IEp0EAG",
  executedAt: "2026-09-03T08:58:09Z",
  planHashPresent: true,
  accountId: HARTWELL,
  ...over,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => resetSessionDoor());

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.className = "";
  delete (window as unknown as { claude?: unknown }).claude;
  clearComposed();
  resetCatalog();
  try {
    sessionStorage.clear();
    clearOverlays();
  } catch {
    /* ignore */
  }
});

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/* ================================================ the reading, field by field */

describe("reading an in-flight modification version", () => {
  const forked = withInFlightVersion(shipped);
  const bundle = forked.borrowers![HARTWELL];

  it("names the all-unbooked package that MIRRORS a booked one, and only that one", () => {
    const roster = packageRoster(bundle);
    const version = roster.find((p) => p.id === VERSION)!;
    const source = roster.find((p) => p.id === SOURCE)!;

    expect(version.inFlightVersion).toBe(true);
    expect(version.booked).toBe(0);
    expect(version.members.every((f) => f.stage === "Qualification")).toBe(true);
    expect(source.inFlightVersion).toBe(false);
    expect(source.booked).toBe(6);
  });

  it("links the version back to the package it was forked from", () => {
    const roster = packageRoster(bundle);
    expect(roster.find((p) => p.id === SOURCE)!.hasInFlightModification).toBe(true);
    expect(roster.find((p) => p.id === SOURCE)!.inFlightVersionId).toBe(VERSION);
    expect(roster.find((p) => p.id === VERSION)!.hasInFlightModification).toBe(false);
    expect(lockedSourcePackage(roster, SOURCE)?.id).toBe(SOURCE);
    expect(lockedSourcePackage(roster, VERSION)).toBeNull();
  });

  it("states what the version holds, for the row that cannot be picked", () => {
    const version = packageRoster(bundle).find((p) => p.id === VERSION)!;
    // 46.0M booked, with the revolver up 5.0M on the copy.
    expect(version.committed).toBe(51_000_000);
    expect(version.reason).toBe("Modification in flight · booking pending · 6 facilities · $51M");
  });

  it("does NOT read a package of a different size as a fork: a first draft is not a version", () => {
    // Three copies beside six booked members. Same stages, no mirror, so it is
    // a deal in progress and the room stays open on both.
    const partial = withInFlightVersion(shipped, { members: 3 });
    partial.borrowers![HARTWELL].exposure!.facilities = [
      ...(shipped.borrowers![HARTWELL].exposure?.facilities ?? []).filter(
        (f) => f.productPackageId === SOURCE && f.stage === "Booked",
      ),
      ...(partial.borrowers![HARTWELL].exposure?.facilities ?? []).filter((f) => f.productPackageId === VERSION),
    ];
    const roster = packageRoster(partial.borrowers![HARTWELL]);
    expect(roster.find((p) => p.id === VERSION)!.inFlightVersion).toBe(false);
    expect(roster.find((p) => p.id === SOURCE)!.hasInFlightModification).toBe(false);
  });

  it("takes the trail's own answer for WHICH package was forked", () => {
    /* Two identical booked packages both mirror the version, so the mirror
       alone can only pick the first. The trail says which one it actually was,
       and the lock moves off the guess onto the read. */
    const two = withInFlightVersion(shipped);
    const b = two.borrowers![HARTWELL];
    const booked = (b.exposure!.facilities ?? []).filter((f) => f.productPackageId === SOURCE);
    b.exposure!.facilities = [
      ...(b.exposure!.facilities ?? []),
      ...booked.map((f, i) => ({
        ...JSON.parse(JSON.stringify(f)),
        loanId: `a4Zbb000002ZZZ${i}EAG`,
        productPackageId: OTHER_SOURCE,
      })),
    ];

    const guessed = packageRoster(b);
    expect(guessed.find((p) => p.id === SOURCE)!.hasInFlightModification).toBe(true);

    const read = packageRoster(b, [modRow({ productPackageId: OTHER_SOURCE })]);
    expect(read.find((p) => p.id === OTHER_SOURCE)!.hasInFlightModification).toBe(true);
    expect(read.find((p) => p.id === SOURCE)!.hasInFlightModification).toBe(false);
    expect(read.find((p) => p.id === SOURCE)!.inFlightVersionId).toBeNull();
  });

  it("ignores a row that wrote nothing: a Staged filing forked no version", () => {
    const roster = packageRoster(bundle, [modRow({ status: "Staged", productPackageId: OTHER_SOURCE })]);
    // The mirror's own answer stands; the unfiled row moved nothing.
    expect(roster.find((p) => p.id === SOURCE)!.hasInFlightModification).toBe(true);
  });

  it("locks nothing on the SHIPPED book, which carries no version", () => {
    for (const [, b] of Object.entries(shipped.borrowers ?? {})) {
      for (const entry of packageRoster(b)) {
        expect(entry.inFlightVersion).toBe(false);
        expect(entry.hasInFlightModification).toBe(false);
      }
    }
  });
});

/* ============================================================== rule 2, in the room */

interface Opened {
  room: HTMLElement;
  bound: WorkroomMode[];
}

function openRoom(args: { data: C360Data; productPackageId?: string | null; history?: ActionHistoryRow[] }): Opened {
  const bundle = args.data.borrowers![HARTWELL];
  const context = workroomContextFor({
    mode: "modify",
    data: args.data,
    bundle,
    accountId: HARTWELL,
    accountName: HARTWELL_NAME,
    productPackageId: args.productPackageId ?? null,
  });
  const bound: WorkroomMode[] = [];
  const router: WorkroomRouter = {
    question: neutralAsk(),
    say: null,
    onBind: (route) => bound.push(route),
    onRestart: () => {},
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Workroom
        context={context}
        engine={createModifyEngine({ context, data: args.data, bundle })}
        router={router}
        reads={{
          bundle,
          accountName: HARTWELL_NAME,
          productPackageId: context.productPackageId,
          generatedAt: args.data.meta?.generatedAt,
          history: args.history,
        }}
        instanceUrl="https://bankinggpt-at.my.salesforce.com"
        onAnchor={() => {}}
        onClose={() => {}}
      />,
    );
  });
  return { room: document.querySelector<HTMLElement>(".wk-room")!, bound };
}

const settle = async () => {
  await act(async () => {
    vi.advanceTimersByTime(2000);
    await Promise.resolve();
  });
};

/** A line, said the way the composer says it. The value setter is React's own
 *  hook, so the controlled input's state actually changes. */
async function typeInto(room: HTMLElement, line: string) {
  const input = room.querySelector<HTMLInputElement>(".wk-txt")!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, line);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => room.querySelector(".wk-send")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await settle();
  await settle();
}

const routeChip = (room: HTMLElement, label: string) =>
  [...room.querySelectorAll<HTMLElement>(".wk-routes .wk-opt")].find((b) => text(b) === label)!;

describe("the room refuses a second modification", () => {
  const forked = withInFlightVersion(shipped);

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lists the version in the package ask, visible and disabled, with the reason on it", async () => {
    const { room } = openRoom({ data: forked, productPackageId: null });
    await settle();

    const cards = [...room.querySelectorAll<HTMLButtonElement>(".wk-pkgask .wk-pkg")];
    expect(cards).toHaveLength(2);
    const version = cards.find((c) => c.dataset.pkg === VERSION)!;
    const source = cards.find((c) => c.dataset.pkg === SOURCE)!;

    expect(version.disabled).toBe(true);
    expect(version.dataset.inflight).toBe("1");
    expect(text(version)).toContain("Modification in flight · booking pending · 6 facilities · $51M");
    // No arrow on a row that goes nowhere.
    expect(version.querySelector(".wk-go")).toBeNull();

    // The source is still a room the banker can walk into.
    expect(source.disabled).toBe(false);
    expect(source.querySelector(".wk-go")).toBeTruthy();
  });

  it("refuses Modify on the locked source, in one sentence, with the version's Salesforce link", async () => {
    const { room, bound } = openRoom({ data: forked, productPackageId: SOURCE, history: [modRow()] });
    await settle();

    act(() => routeChip(room, "Modify").click());
    await settle();

    expect(bound).toEqual([]);
    const said = [...room.querySelectorAll(".wk-agent")].map(text);
    expect(said.some((s) => s.includes(IN_FLIGHT_REFUSAL))).toBe(true);

    const door = room.querySelector<HTMLAnchorElement>("a.wk-opt")!;
    expect(door.getAttribute("href")).toBe(
      `https://bankinggpt-at.my.salesforce.com/lightning/r/LLC_BI__Product_Package__c/${VERSION}/view`,
    );
    expect(text(door)).toBe("Open the version in Salesforce");

    // The question stays: a lock closes two routes, not the room.
    expect(room.querySelector(".wk-routes")).toBeTruthy();
  });

  it("refuses Renew the same way", async () => {
    const { room, bound } = openRoom({ data: forked, productPackageId: SOURCE });
    await settle();

    act(() => routeChip(room, "Renew").click());
    await settle();

    expect(bound).toEqual([]);
    expect([...room.querySelectorAll(".wk-agent")].map(text).join(" ")).toContain(IN_FLIGHT_REFUSAL);
  });

  it("allows a new facility of its own: it joins a package, it does not fork one", async () => {
    const { room, bound } = openRoom({ data: forked, productPackageId: SOURCE });
    await settle();

    act(() => routeChip(room, "New facility").click());
    await settle();

    expect(bound).toEqual(["create"]);
    expect([...room.querySelectorAll(".wk-agent")].map(text).join(" ")).not.toContain(IN_FLIGHT_REFUSAL);
  });

  it("refuses a TYPED modification line too, after the banker's own bubble", async () => {
    const { room, bound } = openRoom({ data: forked, productPackageId: SOURCE });
    await settle();

    await typeInto(room, "increase the line of credit to $25M");

    expect(bound).toEqual([]);
    expect(text(room.querySelector(".wk-banker"))).toContain("increase the line of credit");
    expect([...room.querySelectorAll(".wk-agent")].map(text).join(" ")).toContain(IN_FLIGHT_REFUSAL);
  });

  it("drops Facility Terms from the composer's menu on a locked package", async () => {
    const { room } = openRoom({ data: forked, productPackageId: SOURCE });
    await settle();

    act(() => room.querySelector<HTMLElement>(".cp-plus")!.click());
    await settle();
    // Level one is the package's members; walk into the first one.
    act(() => document.querySelector<HTMLElement>(".cp-panel .cp-row")!.click());
    await settle();
    const topics = [...document.querySelectorAll(".cp-panel .cp-row")].map(text).join(" | ");
    expect(topics).not.toContain("Facility Terms");
    expect(topics).toContain("Covenant");
  });

  it("leaves the menu whole where nothing is in flight", async () => {
    const { room } = openRoom({ data: shipped, productPackageId: SOURCE });
    await settle();

    act(() => room.querySelector<HTMLElement>(".cp-plus")!.click());
    await settle();
    act(() => document.querySelector<HTMLElement>(".cp-panel .cp-row")!.click());
    await settle();
    expect([...document.querySelectorAll(".cp-panel .cp-row")].map(text).join(" | ")).toContain("Facility Terms");
  });
});

/* ================================================= rule 1, on the cockpit's figures */

function mountCockpit(): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AppProvider data={shipped}>
        <AppShell />
        <AppEntry />
      </AppProvider>,
    );
  });
}

const worklistRow = () =>
  [...document.querySelectorAll<HTMLElement>(".wlrow")].find((r) => r.textContent?.includes(HARTWELL_NAME))!;

describe("a filed modification never moves a booked figure", () => {
  it("says it in words: the chip is the delta, labelled", () => {
    expect(filedAmount(5)).toBe("+$5.0M");
    expect(filedAmount(-2.5)).toBe("-$2.5M");
  });

  it("the worklist row keeps the booked exposure and names the filing beside it", () => {
    mountCockpit();
    const before = text(worklistRow().querySelector(".amt b"));
    expect(worklistRow().querySelector(".filedchip")).toBeNull();

    act(() => dispatchWriteBack(HARTWELL, DELTA_MM));

    const row = worklistRow();
    // THE FIGURE DID NOT MOVE.
    expect(text(row.querySelector(".amt b"))).toBe(before);
    expect(text(row.querySelector(".filedchip"))).toBe("+$5.0M filed · booking pending");
    // And it is never the sum: 46.0 + 5.0 appears nowhere on the row.
    expect(text(row)).not.toContain("$51");
  });

  it("the hero anchor states the BOOKED committed with the filed chip adjacent", () => {
    mountCockpit();
    act(() => worklistRow().dispatchEvent(new MouseEvent("click", { bubbles: true })));

    // The hero is derived from the exposure read since 2026-09-09: $57.0M of
    // open facilities less the $3.0M proposal is the BOOKED $54.0M.
    const anchor = () => document.querySelector<HTMLElement>("#ancExposure")!;
    expect(text(anchor().querySelector(".v"))).toBe("$54.0M");
    expect(document.querySelector("#ancExpFiled")).toBeNull();

    act(() => dispatchWriteBack(HARTWELL, DELTA_MM));

    expect(text(anchor().querySelector(".v"))).toBe("$54.0M");
    expect(text(document.querySelector("#ancExpFiled"))).toBe("+$5.0M filed · booking pending");
    expect(text(anchor())).not.toContain("$59");
  });

  it("the exposure pane's committed, and everything derived from it, stay booked", () => {
    mountCockpit();
    act(() => worklistRow().dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const tab = [...document.querySelectorAll<HTMLElement>("button")].find((b) => text(b) === "Exposure & Collateral")!;
    act(() => tab.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const pane = () => document.querySelector<HTMLElement>("#pane-exposure")!;
    const committed = () => [...pane().querySelectorAll<HTMLElement>(".pfig")].find((f) => text(f).startsWith("Committed"))!;
    // The exposure read's own total over BOTH of the shipped book's packages.
    const before = text(committed().querySelector(".v"));
    expect(before).toBe("$57M");

    act(() => dispatchWriteBack(HARTWELL, DELTA_MM));

    // THE PANE IS DERIVED FROM `committed`: the strip, the drawn percentage, the
    // coverage and the table total. None of them moved, and the filed delta is
    // declared where the caption used to be.
    expect(text(committed().querySelector(".v"))).toBe(before);
    expect(text(document.querySelector("#expCommittedFiled"))).toBe("+$5.0M filed · booking pending");
    expect(text(document.querySelector("#tblExpTotal"))).toBe(before);
  });
});
