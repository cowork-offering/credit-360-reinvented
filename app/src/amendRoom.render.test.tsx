// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom, neutralAsk } from "./components/workroom/Workroom";
import { createAmendEngine } from "./workroom/amendEngine";
import { createModifyEngine } from "./workroom/modifyEngine";
import { clearComposed } from "./workroom/engine";
import { workroomContextFor } from "./workroom/openWorkroom";
import type { ActionHistoryRow, BorrowerBundle, C360Data, Facility } from "./data/contract";
import { atOrPastApproval } from "./data/facilityStage";
import type { WorkroomMode } from "./workroom/types";
import live from "../../artifact/live-data.json";

/* =============================================================================
   THE ROOM, STANDING IN A VERSION (0.9.23, spec 2a).

   0.9.17 taught the room to NAME an in-flight version, lock the fork and say
   "editable until approval". It gave the banker nothing that edited it: Modify
   and Renew refused and sent them to Salesforce, and no route in the cockpit
   changed a figure in a version. This is the room that does.

   THE FIXTURE IS HARTWELL'S REAL FORK, built onto the shipped book the way
   `book/packages.test.ts` fabricates one: the booked source a5Fbb000000J6BNEA0
   (Purchase $6.5M, Equipment $1.5M) cloned into a5Fbb000000JFzREAW at
   Qualification with `isModification` true, the Purchase renamed by the filing
   to $12,000,000.00, plus the renewal-chain history row the trail carries
   (`actionId: "loan-modification"`, Completed, `productPackageId` the SOURCE,
   `resultRecordId` a MEMBER of the version - the org names a loan there, never
   the output package). C3's stub lanes mirror this shape.

   Nothing here is wired to a desk or to a connector: every sentence is the
   room's own, deterministic.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.className = "";
  clearComposed();
});

const data = live as unknown as C360Data;
const accountId = "001bb00001I7FPNAA3";
const GENERATED_AT = "2026-07-25T21:04:49Z";

const SOURCE = "a5Fbb000000J6BNEA0";
const VERSION = "a5Fbb000000JFzREAW";
const V_PURCHASE = "a4Zbb000002KFD4EAO";
const V_EQUIPMENT = "a4Zbb000002KFD3EAO";

/** The two clone loans, at the figures the filing left on them. */
function versionMembers(stage = "Qualification"): Facility[] {
  const source = (live as unknown as C360Data).borrowers![accountId].exposure!.facilities!.filter(
    (f) => f.productPackageId === SOURCE,
  );
  const purchase = source.find((f) => (f.name ?? "").includes("Purchase"))!;
  const equipment = source.find((f) => (f.name ?? "").includes("Equipment"))!;
  return [
    {
      ...equipment,
      loanId: V_EQUIPMENT,
      productPackageId: VERSION,
      stage,
      outstanding: 0,
      isModification: true,
    } as Facility,
    {
      ...purchase,
      loanId: V_PURCHASE,
      productPackageId: VERSION,
      stage,
      // The filing is what renamed it, and the name carries the new figure.
      name: "Hartwell Precision Manufacturing LLC - Purchase - $12,000,000.00",
      committed: 12_000_000,
      outstanding: 0,
      isModification: true,
    } as Facility,
  ];
}

/** The trail row a completed modification leaves. */
const HISTORY: ActionHistoryRow[] = [
  {
    stagingId: "a8abb00001N6Z0XAAV",
    actionId: "loan-modification",
    status: "Completed",
    executedAt: "2026-09-12T14:02:00Z",
    productPackageId: SOURCE,
    resultRecordId: V_PURCHASE,
    summary: "Modification filed on the package.",
  },
];

function forkedBundle(stage = "Qualification"): BorrowerBundle {
  const base = data.borrowers![accountId];
  return {
    ...base,
    exposure: {
      ...base.exposure!,
      facilities: [...(base.exposure!.facilities ?? []), ...versionMembers(stage)],
    },
  };
}

/** WHICH MEMBERS THE HOST WOULD CALL WORKABLE, computed the way
 *  `WorkroomHost` computes it for an amend room: the version's own members
 *  still below the approval rung, which is the engine's own gate read from the
 *  other end of the same ladder. A modification's room reads
 *  `bookedFacilities`; a version holds none. */
function workableIn(bundle: BorrowerBundle, packageId: string): Set<string> {
  return new Set(
    (bundle.exposure?.facilities ?? [])
      .filter((f) => f.productPackageId === packageId && !atOrPastApproval(f))
      .map((f) => f.loanId)
      .filter((id): id is string => Boolean(id)),
  );
}

function mount(args: { mode: WorkroomMode; packageId: string; bundle?: BorrowerBundle; routed?: boolean }): HTMLElement {
  const bundle = args.bundle ?? forkedBundle();
  const context = workroomContextFor({
    mode: args.mode,
    data,
    bundle,
    accountId,
    accountName: bundle.snapshot!.name!,
    productPackageId: args.packageId,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const engine =
    args.mode === "amend"
      ? createAmendEngine({ context, data, bundle })
      : createModifyEngine({ context, data, bundle });
  act(() => {
    root!.render(
      <Workroom
        context={context}
        engine={engine}
        eligibleMemberIds={args.mode === "amend" ? workableIn(bundle, args.packageId) : undefined}
        router={
          args.routed
            ? {
                question: neutralAsk(),
                say: null,
                onBind: () => {},
                onRestart: () => {},
              }
            : undefined
        }
        reads={{
          bundle,
          accountName: bundle.snapshot!.name!,
          productPackageId: context.productPackageId,
          generatedAt: GENERATED_AT,
          history: HISTORY,
        }}
        onClose={() => {}}
      />,
    );
  });
  return document.querySelector<HTMLElement>(".wk-room")!;
}

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

async function typeInto(room: HTMLElement, text: string) {
  const input = room.querySelector<HTMLInputElement>(".wk-txt")!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => room.querySelector(".wk-send")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  for (let i = 0; i < 8; i += 1) await settle();
}

const click = async (el: Element | undefined | null) => {
  act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  for (let i = 0; i < 8; i += 1) await settle();
};

const said = (room: HTMLElement) => [...room.querySelectorAll(".wk-msg")].map((m) => m.textContent ?? "").join(" · ");
/* THE ROUTES ARE DOORS ON THE ENTRY SHEET (0.9.25, founder design-intent gate
   2026-09-14). The amend route is still conditional by construction and still
   sits beside the other three; what moved is the node it lives on, and where a
   refusal is said. A route the version has closed is a SHUT DOOR carrying the
   book's sentence on its face rather than a live chip that answers with it. */
const doorLabels = (room: HTMLElement) =>
  [...room.querySelectorAll<HTMLElement>(".wk-entry-door .wk-entry-dl")].map((b) => (b.textContent ?? "").trim());
const routeDoor = (room: HTMLElement, label: string) =>
  [...room.querySelectorAll<HTMLButtonElement>(".wk-entry-door")].find(
    (d) => (d.querySelector(".wk-entry-dl")?.textContent ?? "").trim() === label,
  )!;
const doorLine = (room: HTMLElement, label: string) =>
  (routeDoor(room, label).querySelector(".wk-entry-dw")?.textContent ?? "").trim();

/* -------------------------------------------------------------- the route */

describe("the route question, in a room standing on a version", () => {
  it("offers Amend beside the three, labelled in the banker's words", async () => {
    const room = mount({ mode: "modify", packageId: VERSION, routed: true });
    await settle();
    // The memo door is absent here: this mount hands the room no memo lane.
    expect(doorLabels(room)).toEqual(["Modify", "Renew", "New facility", "Shape this version"]);
  });

  it("offers no Amend door on an ordinary booked package", async () => {
    const room = mount({ mode: "modify", packageId: "a5Fbb000000IHFJEA4", routed: true });
    await settle();
    expect(doorLabels(room)).toEqual(["Modify", "Renew", "New facility"]);
  });

  it("offers no Amend door once the org has taken the version", async () => {
    const room = mount({
      mode: "modify",
      packageId: VERSION,
      bundle: forkedBundle("Approval / Loan Committee"),
      routed: true,
    });
    await settle();
    expect(doorLabels(room)).toEqual(["Modify", "Renew", "New facility"]);
  });

  it("shuts Modify on the version and points at Amend, not at Salesforce", async () => {
    const room = mount({ mode: "modify", packageId: VERSION, routed: true });
    await settle();
    expect(routeDoor(room, "Modify").disabled).toBe(true);
    expect(doorLine(room, "Modify")).toContain(
      "Change the figures in this version: say what should move, and I put it on the plan.",
    );
    expect(doorLine(room, "Modify")).not.toContain("book it in Salesforce first");
    // The sheet stays: the routes a lock does not close are still open.
    expect(doorLabels(room)).toContain("Shape this version");
    expect(routeDoor(room, "Shape this version").disabled).toBe(false);
  });

  it("shuts Renew the same way", async () => {
    const room = mount({ mode: "modify", packageId: VERSION, routed: true });
    await settle();
    expect(routeDoor(room, "Renew").disabled).toBe(true);
    expect(doorLine(room, "Renew")).toContain("say what should move, and I put it on the plan");
  });

  it("still sends a version the org has taken to Salesforce, because there it is true", async () => {
    const room = mount({
      mode: "modify",
      packageId: VERSION,
      bundle: forkedBundle("Approval / Loan Committee"),
      routed: true,
    });
    await settle();
    // Every route is shut on a version at approval, and each door says why.
    expect(routeDoor(room, "Modify").disabled).toBe(true);
    expect(doorLine(room, "Modify")).toContain("Work it through approval in Salesforce");
  });

  /* AND THE REFUSAL IS STILL SPOKEN WHERE A DOOR CANNOT BE SHUT IN ADVANCE. A
     typed line names its route after the fact, so the sentence lands in the
     thread exactly as it always did. */
  it("says the same refusal to a TYPED modification line on the version", async () => {
    const room = mount({ mode: "modify", packageId: VERSION, routed: true });
    await settle();
    await typeInto(room, "increase the line of credit to $25M");
    expect(said(room)).toContain("say what should move, and I put it on the plan");
  });
});

/* --------------------------------------------------------------- the room */

describe("the amend room itself", () => {
  it("names the state on the header, in the founder's own words", async () => {
    const room = mount({ mode: "amend", packageId: VERSION });
    await settle();
    await click(room.querySelector(".wk-pkgline"));
    const peek = document.body.querySelector(".wk-cav")!;
    expect(peek.textContent).toContain("Modification in Progress · editable until approval");
  });

  it("renders the version as pickable and a booked package as blocked, in the switch peek", async () => {
    /* ONE LOCK, THREE PICKERS (0.9.17), now with a fourth kind of ask. In an
       amend room the question is "which package may be shaped in place", so the
       editable version is the pickable row and a booked package is the blocked
       one: the exact mirror of the fork ask. `packagePick` decides both. */
    const room = mount({ mode: "amend", packageId: VERSION });
    await settle();
    await click(room.querySelector(".wk-pkgline"));
    const rows = [...document.body.querySelectorAll<HTMLButtonElement>(".wk-pkg[data-pkgrow]")];
    const version = rows.find((b) => b.getAttribute("data-pkgrow") === VERSION)!;
    const booked = rows.find((b) => b.getAttribute("data-pkgrow") === SOURCE)!;
    // The version is where the room stands, so it is disabled as "you are here"
    // rather than as a refusal, and its line is the roster's own.
    expect(version.textContent).toContain("editable until approval");
    expect(version.getAttribute("data-inflight")).toBeNull();
    expect(booked.disabled).toBe(true);
    expect(booked.getAttribute("data-inflight")).toBe("1");
    expect(booked.textContent).toContain("a change to it is a modification, not an amendment");
  });

  it("calls itself the Amendment Workroom and steps to Approve", async () => {
    const room = mount({ mode: "amend", packageId: VERSION });
    await settle();
    expect(room.querySelector(".wk-title")!.textContent).toBe("Amendment");
  });

  it("shows the VERSION's members on the strip, at the version's own figures", async () => {
    const room = mount({ mode: "amend", packageId: VERSION });
    await settle();
    const chips = [...room.querySelectorAll<HTMLElement>(".wk-mchips .wk-mchip")].map((b) => b.textContent ?? "");
    expect(chips).toHaveLength(2);
    // The version's Purchase reads $12.0MM. Its booked parent reads $6.5MM and
    // is on another package, which is not this room.
    expect(chips.join(" ")).toContain("$12.0MM");
    expect(chips.join(" ")).not.toContain("$6.5MM");
  });

  it("draws the version's members as workable rather than hollow", async () => {
    const room = mount({ mode: "amend", packageId: VERSION });
    await settle();
    /* A member at Qualification is `proposed`, which is what draws it dashed on
       a modification's strip and rightly so: a credit action cannot run against
       it. On a version every member is at Qualification and every one of them
       IS workable, which is why the host computes the eligible set per mode. */
    const chips = [...room.querySelectorAll<HTMLButtonElement>(".wk-mchips .wk-mchip")];
    expect(chips).toHaveLength(2);
    expect(chips.filter((b) => b.disabled)).toHaveLength(0);
  });

  it("composes a change on the version's own loan and never says clone", async () => {
    const room = mount({ mode: "amend", packageId: VERSION });
    await settle();
    await typeInto(room, "take the purchase to 14,000,000");
    expect(said(room)).toContain("changes the version the org already holds");
    // The figures land on the chip the banker confirms, not in the prose.
    const glass = room.textContent ?? "";
    expect(glass).toContain("$12M");
    expect(glass).toContain("$14M");
    expect(glass).not.toMatch(/\bclone\b/i);
  });

  it("never prints the forbidden word", async () => {
    const room = mount({ mode: "amend", packageId: VERSION });
    await settle();
    await typeInto(room, "take the purchase to 14,000,000");
    const text = room.textContent ?? "";
    expect(text).not.toMatch(/IRIS/);
  });
});
