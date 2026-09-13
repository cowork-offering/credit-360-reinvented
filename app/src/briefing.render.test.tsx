// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import live from "../../artifact/live-data.json";
import { buildBriefing, briefingItemSentence } from "./channel/relationshipBriefing";
import { RelationshipBriefing } from "./components/relationship/Briefing";
import type { BorrowerBundle, C360Data } from "./data/contract";
import type { RelRoute } from "./components/relationship/relRoute";

/* =============================================================================
   THE BRIEFING ON THE GLASS.

   The component owns the order, the labels and the material and it owns no
   words, so what these tests hold it to is exactly that: every sentence the
   builder wrote reaches the DOM verbatim, the five sections arrive in the
   founder's own order, and the gap section is rendered rather than hidden.

   NO TILE GRID. The founder read the old opening as flat, and a tile grid is
   what flat looks like; the structural assertion is that a section is a run of
   paragraphs and that the changes are ONE paragraph across every lane.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = live as unknown as C360Data;
const asOf = data.meta.generatedAt;
const hartwell = (data.borrowers ?? {})["001bb00001I7FPNAA3"] as BorrowerBundle;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(route: RelRoute | null, bundle: BorrowerBundle | null): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<RelationshipBriefing briefing={buildBriefing(route, bundle, { asOf })} />);
  });
  return container;
}

describe("the briefing renders what the builder wrote", () => {
  it("prints the lede and every due paragraph verbatim", () => {
    const briefing = buildBriefing("covenant", hartwell, { asOf });
    const el = render("covenant", hartwell);
    expect(el.querySelector(".bf-lede")?.textContent).toBe(briefing.opening);
    const paragraphs = [...el.querySelectorAll(".bf-sec")]
      .find((s) => s.querySelector(".bf-k")?.textContent === "What is due")!
      .querySelectorAll(".bf-p");
    expect(paragraphs).toHaveLength(briefing.due.length);
    for (const [i, item] of briefing.due.entries()) {
      expect(paragraphs[i].textContent).toBe(briefingItemSentence(item));
    }
  });

  it("puts the five sections in the founder's order", () => {
    const el = render("covenant", hartwell);
    expect([...el.querySelectorAll(".bf-k")].map((k) => k.textContent)).toEqual([
      "What is due",
      "What has changed since",
      "What I need from you",
      "What the committee will ask",
      "Not in front of me",
    ]);
  });

  it("renders the changes as ONE paragraph, each sentence carrying its lane and source", () => {
    const briefing = buildBriefing("covenant", hartwell, { asOf });
    const el = render("covenant", hartwell);
    const section = [...el.querySelectorAll(".bf-sec")].find(
      (s) => s.querySelector(".bf-k")?.textContent === "What has changed since",
    )!;
    expect(section.querySelectorAll(".bf-p")).toHaveLength(1);
    const spans = [...section.querySelectorAll(".bf-chg")];
    expect(spans).toHaveLength(briefing.changedSince.length);
    for (const [i, change] of briefing.changedSince.entries()) {
      expect(spans[i].textContent?.trim()).toBe(change.sentence);
      expect(spans[i].getAttribute("data-lane")).toBe(change.lane);
      expect(spans[i].getAttribute("title")).toBe(change.source);
    }
  });

  it("leads each need with the ask and follows it with the reason", () => {
    const briefing = buildBriefing("covenant", hartwell, { asOf });
    const el = render("covenant", hartwell);
    const asks = [...el.querySelectorAll(".bf-ask")].map((a) => a.textContent);
    expect(asks).toEqual(briefing.needs.map((n) => n.ask));
  });

  it("shows the gap rather than hiding it", () => {
    const el = render("covenant", hartwell);
    const gap = el.querySelector(".bf-gap")?.textContent ?? "";
    /* RESTATED 2026-09-14: a gap written as a sentence stands on its own,
       capitalised; a noun-phrase gap takes the lede "Not on this read:". The one
       shared lede joined the two shapes into "does not carry no inbox rows". */
    expect(/^(No inbox rows|Not on this read: )/.test(gap)).toBe(true);
    expect(gap.toLowerCase()).toContain("no inbox rows are loaded on this relationship");
  });

  it("carries the route on the root so the room can style it, and never a tile grid", () => {
    const el = render("valuation", hartwell);
    expect(el.querySelector(".bf")?.getAttribute("data-route")).toBe("valuation");
    expect(el.querySelectorAll("table")).toHaveLength(0);
    expect(el.querySelectorAll("ul, ol, li")).toHaveLength(0);
  });

  it("renders every route, and an empty relationship, without throwing", () => {
    for (const route of ["covenant", "valuation", "annual", "rating", "service", null] as Array<RelRoute | null>) {
      for (const bundle of Object.values(data.borrowers ?? {})) {
        expect(() => render(route, bundle as BorrowerBundle)).not.toThrow();
        act(() => root?.unmount());
        container?.remove();
      }
    }
    const el = render(null, null);
    // Nothing is due and nothing has changed, and the room says only that.
    expect([...el.querySelectorAll(".bf-k")].map((k) => k.textContent)).toEqual(["What I need from you", "Not in front of me"]);
  });
});
