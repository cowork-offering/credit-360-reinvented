// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { C360Data } from "./data/contract";
import { AppProvider } from "./state/appState";
import { AppShell } from "./components/AppShell";
import { AppEntry } from "./test/entry";
import { clearOverlays } from "./state/syncOverlay";
import { resetModalStack } from "./components/modalStack";
import sample from "../../artifact/sample-data.json";

/* =============================================================================
   THE SALESFORCE BUBBLE (founder, 2026-09-01).

   "We add another bubble with the salesforce cloud... when clicking onto this
   bubble it should give me either another tree of bubbles for: latest Product
   Package, Account page."

   Four things are under test and they are the four ways this can go wrong:

   1. IT IS A CLIENT SATELLITE. The landing FAB stays chat-direct (rule 50); an
      org record door on the worklist would be a door to nothing in particular.
   2. IT BRANCHES RATHER THAN ROUTES. Pressing it fans a tier and LEAVES THE ARC
      OPEN — every other satellite folds the corner on its way somewhere.
   3. ONE NARRATOR (rule 54). Both tiers drive the same anchored chip; nothing
      here grows a floating label of its own.
   4. NEVER A WRONG LINK. The host is `meta.instanceUrl` at RUNTIME and the
      package is the one the rooms anchor on. Missing either and the bubble is
      visible but DEAD — a guessed My Domain takes a banker to a login page for
      an org they are not in, which reads as a broken cockpit (A29).
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATA = sample as unknown as C360Data;
const INSTANCE = "https://bankinggpt.lightning.force.com";
const STERLING = "001SAMPLE0000STRL";
const PACKAGE_ID = "a5Fbb000000HA1NEAW";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  resetModalStack();
  try {
    sessionStorage.clear();
    clearOverlays();
  } catch {
    /* ignore */
  }
});

/** The book, optionally wired to an org and carrying a package on every
 *  facility — which is what `packageRecords` reads the deal id off when the
 *  snapshot itself stages none. */
function bookWith({ instanceUrl, packaged }: { instanceUrl?: string; packaged?: boolean }): C360Data {
  const next = structuredClone(DATA) as C360Data;
  next.meta = { ...next.meta, instanceUrl };
  if (packaged) {
    for (const b of Object.values(next.borrowers ?? {})) {
      for (const f of b.exposure?.facilities ?? []) f.productPackageId = PACKAGE_ID;
    }
  }
  return next;
}

function mount(data: C360Data) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AppProvider data={data}>
        <AppShell />
        <AppEntry />
      </AppProvider>,
    );
  });
}

const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const press = (key: string) => act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
const byLabel = (re: RegExp) =>
  [...document.body.querySelectorAll("button")].find((b) => re.test(b.getAttribute("aria-label") ?? ""));
const openRow = (name: string) =>
  [...document.querySelectorAll('[role="button"]')].find((r) => r.textContent?.includes(name))!;
const wrap = () => document.getElementById("fabwrap")!;
const cloud = () => document.getElementById("actSalesforce")!;
const chip = () => document.getElementById("arcLbl")!.textContent;
/** The narrator answers a RAW mouseenter, which is what the probe dispatches
 *  and what React's delegated onMouseEnter would never hear. */
const hover = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false })));
const unhover = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false })));

/** Stand on a client with the arc fanned. */
function openArc(data: C360Data) {
  mount(data);
  click(openRow("Sterling Fabrication"));
  click(byLabel(/Client actions/)!);
}

describe("the arc's cloud seat", () => {
  it("carries the Salesforce cloud on a client", () => {
    openArc(bookWith({ instanceUrl: INSTANCE, packaged: true }));
    expect(document.querySelectorAll(".arcbtn")).toHaveLength(6);
    const sat = cloud();
    expect(sat).toBeTruthy();
    expect(sat.getAttribute("data-act")).toBe("salesforce");
    // The offsets ARE the six-satellite recipe (2026-09-12, the Spreading room
    // took a seat): 18deg steps on r=150, the chat at the top and the cloud at
    // the horizontal exactly where they have always been.
    expect(sat.getAttribute("style")).toContain("--tx: -150px");
    expect(sat.getAttribute("style")).toContain("--ty: 0px");
  });

  it("does not exist on the landing, where the mark is the chat", () => {
    mount(bookWith({ instanceUrl: INSTANCE, packaged: true }));
    expect(byLabel(/Open chat/)).toBeTruthy();
    expect(document.getElementById("actSalesforce")).toBeNull();
    expect(document.querySelectorAll(".arcbtn")).toHaveLength(0);
    expect(document.querySelectorAll(".sfbtn")).toHaveLength(0);
  });

  it("routes nowhere: it fans a second tier and leaves the arc open", () => {
    openArc(bookWith({ instanceUrl: INSTANCE, packaged: true }));
    expect(wrap().className).not.toContain("tier");
    click(cloud());
    expect(wrap().className).toContain("open");
    expect(wrap().className).toContain("tier");
    // No room, no ticket, no chat: the cloud opens nothing of the app's own.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelectorAll(".sfbtn")).toHaveLength(2);
  });

  it("folds the tier again on a second press", () => {
    openArc(bookWith({ instanceUrl: INSTANCE, packaged: true }));
    click(cloud());
    click(cloud());
    expect(wrap().className).toContain("open");
    expect(wrap().className).not.toContain("tier");
  });
});

describe("the tier collapses with the corner", () => {
  it("Escape takes the tier and the arc down together", () => {
    openArc(bookWith({ instanceUrl: INSTANCE, packaged: true }));
    click(cloud());
    press("Escape");
    expect(wrap().className).not.toContain("tier");
    expect(wrap().className).not.toContain("open");
  });

  it("an outside click takes both down", () => {
    openArc(bookWith({ instanceUrl: INSTANCE, packaged: true }));
    click(cloud());
    click(document.body);
    expect(wrap().className).not.toContain("tier");
    expect(wrap().className).not.toContain("open");
  });

  it("closing the arc from the mark takes the tier with it", () => {
    openArc(bookWith({ instanceUrl: INSTANCE, packaged: true }));
    click(cloud());
    click(byLabel(/Client actions/)!);
    expect(wrap().className).not.toContain("open");
    expect(wrap().className).not.toContain("tier");
  });

  it("reopening the arc does not reopen the tier", () => {
    openArc(bookWith({ instanceUrl: INSTANCE, packaged: true }));
    click(cloud());
    press("Escape");
    click(byLabel(/Client actions/)!);
    expect(wrap().className).toContain("open");
    expect(wrap().className).not.toContain("tier");
  });
});

describe("rule 54 — ONE narrator chip does all the talking", () => {
  it("names the satellite and both bubbles, and returns to rest", () => {
    openArc(bookWith({ instanceUrl: INSTANCE, packaged: true }));
    expect(chip()).toBe("Client actions");

    hover(cloud());
    expect(chip()).toBe("Salesforce");
    unhover(cloud());
    expect(chip()).toBe("Client actions");

    click(cloud());
    const account = document.getElementById("sfAccount")!;
    const pkg = document.getElementById("sfPackage")!;
    hover(account);
    expect(chip()).toBe("Account page");
    unhover(account);
    hover(pkg);
    expect(chip()).toBe("Latest package");
    unhover(pkg);
    expect(chip()).toBe("Client actions");
  });

  it("grows no floating label of its own", () => {
    openArc(bookWith({ instanceUrl: INSTANCE, packaged: true }));
    click(cloud());
    for (const b of document.querySelectorAll(".sfbtn")) {
      expect(b.textContent?.trim()).toBe("");
    }
    expect(document.querySelectorAll("#arcLbl")).toHaveLength(1);
  });
});

describe("the two doors open the real records, in a new tab", () => {
  it("links the Account page and the latest Product Package on the org's host", () => {
    openArc(bookWith({ instanceUrl: INSTANCE, packaged: true }));
    click(cloud());

    const account = document.querySelector<HTMLAnchorElement>("a#sfAccount")!;
    expect(account.getAttribute("href")).toBe(`${INSTANCE}/lightning/r/Account/${STERLING}/view`);
    expect(account.getAttribute("target")).toBe("_blank");
    expect(account.getAttribute("rel")).toContain("noopener");

    const pkg = document.querySelector<HTMLAnchorElement>("a#sfPackage")!;
    expect(pkg.getAttribute("href")).toBe(`${INSTANCE}/lightning/r/LLC_BI__Product_Package__c/${PACKAGE_ID}/view`);
    expect(pkg.getAttribute("target")).toBe("_blank");
    expect(pkg.getAttribute("rel")).toContain("noopener");
  });

  it("never invents a host from a trailing slash", () => {
    openArc(bookWith({ instanceUrl: `${INSTANCE}/`, packaged: true }));
    click(cloud());
    expect(document.querySelector<HTMLAnchorElement>("a#sfAccount")!.getAttribute("href")).toBe(
      `${INSTANCE}/lightning/r/Account/${STERLING}/view`,
    );
  });

  it("folds the corner once a door is taken", () => {
    openArc(bookWith({ instanceUrl: INSTANCE, packaged: true }));
    click(cloud());
    click(document.getElementById("sfAccount")!);
    expect(wrap().className).not.toContain("open");
    expect(wrap().className).not.toContain("tier");
  });
});

describe("no host, no id, no link — the bubble is dead rather than wrong", () => {
  it("renders both bubbles DISABLED when the view carries no org address", () => {
    openArc(bookWith({ instanceUrl: undefined, packaged: true }));
    click(cloud());
    const dead = [...document.querySelectorAll(".sfbtn")];
    expect(dead).toHaveLength(2);
    for (const b of dead) {
      expect(b.tagName).toBe("SPAN");
      expect(b.className).toContain("is-dead");
      expect(b.getAttribute("aria-disabled")).toBe("true");
      expect(b.getAttribute("title")).toBe("Not connected to the org");
      expect(b.getAttribute("href")).toBeNull();
    }
    expect(document.querySelector("a#sfAccount")).toBeNull();
    expect(document.querySelector("a#sfPackage")).toBeNull();
  });

  it("kills ONLY the package bubble when the bundle stages no package", () => {
    openArc(bookWith({ instanceUrl: INSTANCE, packaged: false }));
    click(cloud());
    // The Account is known whatever the deal looks like.
    expect(document.querySelector("a#sfAccount")).toBeTruthy();
    const pkg = document.getElementById("sfPackage")!;
    expect(pkg.tagName).toBe("SPAN");
    expect(pkg.className).toContain("is-dead");
    expect(pkg.getAttribute("title")).toBe("Not connected to the org");
  });
});

describe("the hero's nCino affordance is gone — the cloud is the door now", () => {
  it("leaves no Account link and no nCino copy in the client hero", () => {
    mount(bookWith({ instanceUrl: INSTANCE, packaged: true }));
    click(openRow("Sterling Fabrication"));
    const hero = document.querySelector(".hero-controls")!;
    expect(hero).toBeTruthy();
    expect(hero.textContent).not.toMatch(/nCino/);
    expect(document.querySelector("a[data-deeplink='account']")).toBeNull();
    expect(document.querySelector(".hero-ncino")).toBeNull();
    // The row itself survives — Sync still lives here when a channel offers it;
    // what left is the second affordance beside it.
    expect(hero.querySelectorAll("a").length).toBe(0);
  });
});
