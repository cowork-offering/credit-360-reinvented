// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom } from "./components/workroom/Workroom";
import { clearComposed, createScriptedEngine } from "./workroom/engine";
import { doorFor } from "./workroom/modes";
import type { WorkroomContext } from "./workroom/types";

/* =============================================================================
   THE RECORD IS ONE CLICK AWAY (Batch 2, items 7a and 7b).

   Two links, one doctrine, and it is the doctrine that is actually under test:
   the org's Lightning host comes from `meta.instanceUrl` at RUNTIME, and where
   the view carries none, NOTHING renders. A guessed My Domain is worse than no
   link at all — it takes a banker to a login page for an org they are not in,
   which reads as a broken cockpit rather than as missing data (A29).
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const INSTANCE = "https://bankinggpt.lightning.force.com";
const ACCOUNT_ID = "001bb00001I7FPNAA3";
const PACKAGE_ID = "a5Fbb000000IHFJEA4";

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

function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const buttons = () => [...document.body.querySelectorAll("button")];
const byText = (re: RegExp) => buttons().find((b) => re.test(b.textContent ?? ""));
const click = (el: Element | undefined) => act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

/* 7b's HERO LINK IS RETIRED (founder, 2026-09-01): "the cloud is the door now".
   The Account record is reached from the Salesforce satellite's second tier,
   and the doctrine under test moved with it — sfBubble.render.test.tsx asserts
   the same runtime-host contract there, plus the hero's own silence. What is
   left in this file is the dossier's link, which stayed and only changed the
   copy it wears. */

/* -------------------------------------------- 7a. the result dossier's link */

function contextFor(): WorkroomContext {
  return {
    mode: "modify",
    door: doorFor("modify", PACKAGE_ID),
    accountId: ACCOUNT_ID,
    accountName: "Hartwell Precision Manufacturing LLC",
    productPackageId: PACKAGE_ID,
    packageName: "Hartwell Industrial C&I Credit Package",
    approver: "fabian.goetzens@accenture.com.bankinggpt",
  };
}

/** Drive the scripted room all the way to the dossier, the way a banker does. */
async function fileAPlan(instanceUrl?: string) {
  const context = contextFor();
  const filed: Array<{ changeCount: number; packageHref: string | null }> = [];
  mount(
    <Workroom
      context={context}
      engine={createScriptedEngine(context)}
      instanceUrl={instanceUrl}
      onFiled={(f) => filed.push({ changeCount: f.changeCount, packageHref: f.packageHref })}
      onClose={() => {}}
    />,
  );
  const room = document.querySelector<HTMLElement>(".wk-room")!;
  click(byText(/liquidity covenant/));
  await settle();
  for (const b of buttons().filter((x) => x.textContent === "Confirm")) {
    click(b);
    await settle();
  }
  for (const b of buttons().filter((x) => x.textContent === "Acknowledge")) click(b);
  await settle();
  click(document.querySelector<HTMLButtonElement>(".wk-propose")!);
  await settle();
  click(byText(/^File \d+ change/));
  await settle();
  return { room, filed };
}

describe("the dossier names the package it filed against, and the name is the link", () => {
  it("links the Product Package record on the org's host", async () => {
    const { room } = await fileAPlan(INSTANCE);
    expect(room.querySelector(".wk-rescard")).toBeTruthy();
    const link = room.querySelector<HTMLAnchorElement>("a[data-deeplink='workroom-package']")!;
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe(`${INSTANCE}/lightning/r/LLC_BI__Product_Package__c/${PACKAGE_ID}/view`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    // THE COPY IS THE REFERENCE, NOT AN AFFORDANCE (founder, 2026-09-01). The
    // card no longer says "Open in nCino" anywhere: the package's own name
    // carries the href, in the card's header.
    expect(link.textContent).not.toMatch(/nCino/);
    expect(link.textContent!.length).toBeGreaterThan(0);
    expect(link.closest(".rc-h")).toBeTruthy();
    expect(room.textContent).not.toMatch(/Open (in|the package in) nCino/);
  });

  it("renders no link at all where the view carries no org address", async () => {
    const { room } = await fileAPlan(undefined);
    expect(room.querySelector(".wk-rescard")).toBeTruthy();
    expect(room.querySelector("a[data-deeplink='workroom-package']")).toBeNull();
    // The package is still NAMED, it simply is not a door.
    expect(room.querySelector(".wk-rescard .rc-h b")!.textContent!.length).toBeGreaterThan(0);
    // The filing itself still reads: the card is not diminished by the absence.
    expect(room.textContent).toMatch(/single use/);
  });
});

/* --------------------------------------- 8. the plan lands in the trail */

describe("an executed plan tells the trail what it filed", () => {
  it("hands over the change count and the resolved link, once", async () => {
    const { filed } = await fileAPlan(INSTANCE);
    expect(filed).toHaveLength(1);
    expect(filed[0].changeCount).toBeGreaterThan(0);
    expect(filed[0].packageHref).toBe(`${INSTANCE}/lightning/r/LLC_BI__Product_Package__c/${PACKAGE_ID}/view`);
  });

  it("hands over a null link rather than a guessed one when there is no host", async () => {
    const { filed } = await fileAPlan(undefined);
    expect(filed).toHaveLength(1);
    expect(filed[0].packageHref).toBeNull();
  });
});
