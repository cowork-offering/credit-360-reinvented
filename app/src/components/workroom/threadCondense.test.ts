/* =============================================================================
   THE CONDENSED THREAD, ON THE FOUNDER'S OWN TRANSCRIPT.

   Feedback bucket bug-1789294443785 (Fabian, 2026-09-13), Hartwell Precision
   Manufacturing LLC, modification room. The thread he read, item for item, is
   the fixture below: four decisions, and between them three chip rows nobody
   could press again and eight receipts, so the live question sat on the bottom
   edge of the column directly above the composer.

   WHAT THIS PINS is his sentence: "only the current action is nicely shown in
   the chat". After "Hold 6.58%" the glass carries four recap lines and one live
   turn, no spent chips and no receipt standing on its own.
   ============================================================================= */
import { describe, expect, it } from "vitest";

import { condenseThread, type CondensableItem } from "./threadCondense";

type Item = CondensableItem;

const chipRow = (id: string, title: string, before: string, after: string): Item => ({
  id,
  kind: "chips",
  chips: [{ state: "settled", delta: { title, before, after } }],
});

/** The thread as the transcript shows it, in order. Ids are the transcript's
 *  own beats; the receipts carry the two fields a settled row carries. */
const HARTWELL: Item[] = [
  { id: "b1", kind: "banker", text: "Increase the line of credit by 20M USD" },
  {
    id: "a1",
    kind: "agent",
    text: "Confirming stages the next version of the package: nothing booked moves until the bank's own approval books it.",
  },
  chipRow("c1", "Commitment amount", "$15M", "$35M"),
  { id: "s1", kind: "settled", row: { what: "$15M → $35M", how: "confirmed" }, covers: ["b1", "a1", "c1"] },
  {
    id: "a2",
    kind: "agent",
    text: "Commitment amount on Line of Credit ($15M): $15M -> $35M, staged on the clone. That takes the package from $49M to $69M.",
  },
  { id: "ch1", kind: "challenge" },
  { id: "s2", kind: "settled", row: { what: "Coverage thins", how: "acknowledged" }, covers: ["a2", "ch1"] },
  { id: "a3", kind: "agent", text: "What is the amortisation term on the $15.0MM Line of Credit?" },
  { id: "s3", kind: "settled", row: { what: "Amortisation term", how: "asked" }, covers: ["a3"] },

  { id: "b2", kind: "banker", text: "240 months" },
  { id: "a4", kind: "agent", text: "The amortisation term on the $15.0MM Line of Credit goes onto the plan at 240 months." },
  chipRow("c2", "Amortisation term (months)", "not staged in this read", "240 months"),
  {
    id: "s4",
    kind: "settled",
    row: { what: "Amortisation term (months) 240 months", how: "confirmed" },
    covers: ["b2", "a4", "c2"],
  },
  { id: "a5", kind: "agent", text: "Amortisation term (months) on Line of Credit ($15M): not staged in this read -> 240 months." },
  { id: "a6", kind: "agent", text: "What is the first payment date on the $15.0MM Line of Credit?" },
  { id: "s5", kind: "settled", row: { what: "First payment date", how: "asked" }, covers: ["a5", "a6"] },

  { id: "b3", kind: "banker", text: "1 October 2026" },
  { id: "a7", kind: "agent", text: "The first payment date on the $15.0MM Line of Credit goes onto the plan at Oct 1, 2026." },
  chipRow("c3", "First payment date", "not staged in this read", "Oct 1, 2026"),
  {
    id: "s6",
    kind: "settled",
    row: { what: "First payment date Oct 1, 2026", how: "confirmed" },
    covers: ["b3", "a7", "c3"],
  },
  { id: "a8", kind: "agent", text: "First payment date on Line of Credit ($15M): not staged in this read -> Oct 1, 2026." },
  { id: "a9", kind: "agent", text: "What rate should the $15.0MM Line of Credit carry? The read carries 6.58% on it." },
  { id: "s7", kind: "settled", row: { what: "Rate", how: "asked" }, covers: ["a8", "a9"] },

  { id: "b4", kind: "banker", text: "Hold 6.58%" },
  {
    id: "a10",
    kind: "agent",
    text: "The $15.0MM Line of Credit keeps 6.58%. Nothing is staged for the rate and the new version carries it forward.",
  },
  { id: "s8", kind: "settled", row: { what: "Rate held at 6.58%", how: "no change" }, covers: ["b4", "a10"] },
];

const shownBy = (views: ReturnType<typeof condenseThread<Item>>, show: string) =>
  views.filter((v) => v.show === show).map((v) => v.id);

describe("the condensed thread (founder, 2026-09-13)", () => {
  const views = condenseThread(HARTWELL);
  const recaps = views.filter((v) => v.show === "recap");

  it("keeps one decision per item, in the thread's own order", () => {
    expect(views.map((v) => v.id)).toEqual(HARTWELL.map((i) => i.id));
  });

  it("condenses the three settled turns to ONE recap line each", () => {
    expect(recaps.map((v) => (v.show === "recap" ? v.recap.text : ""))).toEqual([
      "Commitment amount: $15M → $35M, confirmed · challenged, acknowledged",
      "Amortisation term: 240 months, confirmed",
      "First payment date: Oct 1, 2026, confirmed",
    ]);
    // The line the turn is filed under is its FIRST receipt, so the recap lands
    // where the exchange stood rather than at the end of the thread.
    expect(recaps.map((v) => v.id)).toEqual(["s1", "s4", "s6"]);
  });

  it("leaves the live turn, and only the live turn, in full", () => {
    expect(shownBy(views, "full")).toEqual(["b4", "a10", "s8"]);
  });

  it("takes every spent chip row off the glass", () => {
    for (const id of ["c1", "c2", "c3"]) {
      expect(views.find((v) => v.id === id)!.show).toBe("none");
    }
    expect(views.some((v) => v.show !== "none" && v.item.kind === "chips")).toBe(false);
  });

  it("leaves no receipt standing on its own behind the live turn", () => {
    // The eight receipts become three recap lines, the live turn's own row, and
    // four that the recap lines already say.
    const rows = views.filter((v) => v.item.kind === "settled");
    expect(rows.filter((v) => v.show === "recap")).toHaveLength(3);
    expect(rows.filter((v) => v.show === "full")).toHaveLength(1);
    expect(rows.filter((v) => v.show === "none").map((v) => v.id)).toEqual(["s2", "s3", "s5", "s7"]);
  });

  it("condenses the effective challenge to one word on the line it belongs to", () => {
    const first = recaps[0];
    expect(first.show === "recap" && first.recap.text).toContain("challenged, acknowledged");
    // And never as a line of its own.
    expect(recaps).toHaveLength(3);
  });

  it("brings the whole turn back when the banker opens its line, one at a time", () => {
    const open = condenseThread(HARTWELL, { opened: new Set(["s4"]) });
    const inTurn = ["b2", "a4", "s4", "a5", "a6", "s5"];
    for (const id of inTurn) {
      const view = open.find((v) => v.id === id)!;
      // The spent chip row stays spent; everything else in the turn is back.
      expect(view.show).toBe(id === "s4" ? "recap" : "full");
    }
    expect(open.find((v) => v.id === "c2")!.show).toBe("none");
    expect(open.find((v) => v.id === "s4")!).toMatchObject({ recap: { open: true } });
    // The turns it did not name are untouched.
    expect(open.find((v) => v.id === "s1")!.show).toBe("recap");
  });
});

describe("the recap sentence", () => {
  const recapOf = (items: Item[]): string => {
    const views = condenseThread(items);
    const recap = views.find((v) => v.show === "recap");
    return recap && recap.show === "recap" ? recap.recap.text : "";
  };
  /** The live turn every fixture needs, so the turn under test is an earlier one. */
  const LIVE: Item[] = [
    { id: "live-b", kind: "banker", text: "and then?" },
    { id: "live-a", kind: "agent", text: "Next." },
  ];

  it("keeps a receipt nothing later overtakes", () => {
    // A pricing ask the banker left for later IS what happened in that turn.
    expect(
      recapOf([
        { id: "b", kind: "banker", text: "move the construction loan maturity to 2029-06-30" },
        { id: "a", kind: "agent", text: "What is the amortisation term?" },
        { id: "s", kind: "settled", row: { what: "Pricing left for later", how: "skipped" }, covers: ["b", "a"] },
        ...LIVE,
      ]),
    ).toBe("Pricing left for later, skipped");
  });

  it("falls back to what the banker said, where the turn settled nothing", () => {
    expect(
      recapOf([
        { id: "b", kind: "banker", text: "what borrowers are on this loan already?" },
        { id: "a", kind: "agent", text: "One decision at a time." },
        ...LIVE,
      ]),
    ).toBe("what borrowers are on this loan already?");
  });

  it("carries the ritual's own step number where the room numbers its steps", () => {
    const views = condenseThread([
      { id: "b", kind: "banker", text: "Annual" },
      { id: "a", kind: "agent", text: "State the relationship position." },
      { id: "s", kind: "settled", row: { what: "Annual", how: "recorded", kicker: "Step 1 of 6" }, covers: ["b", "a"] },
      ...LIVE,
    ]);
    const recap = views.find((v) => v.show === "recap")!;
    expect(recap.show === "recap" && recap.recap.kicker).toBe("Step 1 of 6");
  });

  it("never condenses a pinned item, so the entry tiers keep their own summon", () => {
    const views = condenseThread(
      [
        { id: "open", kind: "opening" },
        { id: "brief", kind: "brief" },
        { id: "a", kind: "agent", text: "Which review is this?" },
        ...LIVE,
      ],
      { pinned: (i) => i.kind === "opening" || i.kind === "brief" },
    );
    expect(views.find((v) => v.id === "open")!.show).toBe("full");
    expect(views.find((v) => v.id === "brief")!.show).toBe("full");
  });

  it("cuts a room's own exchanges where the room models them", () => {
    const items: Item[] = [
      { id: "g1", kind: "say", who: "agent", text: "Nothing filed on this package since the last memo." },
      { id: "r1", kind: "settled", row: { what: "Nothing filed on this package", how: "read" } },
      { id: "g2", kind: "say", who: "agent", text: "Draft it, or steer me first?" },
      { id: "d1", kind: "say", who: "banker", text: "Draft it." },
      { id: "d2", kind: "work" },
    ];
    // The memo room's receipt is inserted at the HEAD of the exchange it closes,
    // ahead of the banker line that opened it, so a cut on banker lines alone
    // would file it under the turn before its own.
    const ex: Record<string, string> = { g1: "greeting", r1: "greeting", g2: "greeting", d1: "draft", d2: "draft" };
    const views = condenseThread(items, { turnKey: (i) => ex[i.id] });
    expect(views.find((v) => v.id === "r1")!.show).toBe("recap");
    expect(shownBy(views, "full")).toEqual(["d1", "d2"]);
  });
});
