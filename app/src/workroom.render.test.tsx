// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom, neutralAsk, smartAsk, type RouterQuestion } from "./components/workroom/Workroom";
import type { SmartOpening } from "./components/workroom/route";
import type { SettleDeps } from "./components/workroom/settleExecution";
import { clearComposed, createScriptedEngine, type WorkroomEngine } from "./workroom/engine";
import { NO_CONNECTOR_REFUSAL } from "./workroom/explain";
import { createModifyEngine } from "./workroom/modifyEngine";
import { doorFor } from "./workroom/modes";
import { workroomContextFor } from "./workroom/openWorkroom";
import type { BorrowerBundle, C360Data } from "./data/contract";
import type { WorkroomContext, WorkroomMode } from "./workroom/types";
import live from "../../artifact/live-data.json";

/* =============================================================================
   THE WORKROOM SHELL, HELD TO THE EIGHT LAWS.

   ONE component renders all three modes. These prove the shell that ships on
   day one: the entry scene stays under sixty words, the manifest starts empty,
   an arrival walks the package figures and a removal walks them back, the
   brand mark is TYPOGRAPHIC rather than a drawn chevron, and nothing in the
   room declares a scroll container.

   The storyline behind them is scripted and its engine is tested separately in
   workroom/engine.test.ts. What is tested here is the ROOM.
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
  // The composed manifest is held in MODULE scope so a close does not lose it,
  // which means it outlives a test the way it outlives a room. Every test here
  // opens on the same package: without this, one test's staged entry is the next
  // test's opening rail.
  clearComposed();
});

/** `joined` is the create room's package door, and it is now reached ONLY by the
 *  banker choosing a package to file into (founder, 2026-09-06: a new facility
 *  creates a new package). It defaults true here so every test that names a
 *  package still gets the room it was written against; the one test that is
 *  about the DEFAULT anchor passes it false. */
function contextFor(
  mode: WorkroomMode,
  packageId: string | null = "a5Fbb000000IHFJEA4",
  joined = true,
): WorkroomContext {
  return {
    mode,
    door: doorFor(mode, packageId, joined),
    accountId: "001bb00001DLtRMAA1",
    accountName: "Hartwell Precision Manufacturing LLC",
    productPackageId: packageId,
    packageName: "Hartwell Industrial C&I Credit Package",
    approver: "fabian.goetzens@accenture.com.bankinggpt",
  };
}

function openWith(context: WorkroomContext, engine: WorkroomEngine, settleDeps?: SettleDeps) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Workroom context={context} engine={engine} settleDeps={settleDeps} onClose={() => {}} />);
  });
  return document.querySelector<HTMLElement>(".wk-room")!;
}

function open(mode: WorkroomMode, packageId?: string | null, joined = true) {
  const context = contextFor(mode, packageId, joined);
  // THE SHELL, ON A SHELL ENGINE. Which engine a mode gets is WorkroomHost's
  // decision; what is proved here is the ROOM, so the storyline engine is
  // handed in directly rather than resolved from an app provider.
  return openWith(context, createScriptedEngine(context));
}

/** Close the room the way the banker does. The next `open` builds a fresh mount
 *  the way reopening the workroom does. */
function shut() {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
}

const buttons = () => [...document.body.querySelectorAll("button")];
/**
 * OPEN THE PLAN.
 *
 * SURFACE 5 (rule 38, "review & execute lives in the chat"): the island is
 * retired. The approval is no longer a bar under the manifest — a confirm puts
 * a glass review chip in the thread, and the flow card (token, Cancel, ink
 * Execute) pops open where that chip stands. Every test that used to reach
 * straight for the approve button now opens that card the way the banker does.
 */
const openPlan = async () => {
  const chip = document.querySelector<HTMLButtonElement>(".wk-propose");
  if (chip) click(chip);
  await settle();
};
const byText = (re: RegExp) => buttons().find((b) => re.test(b.textContent ?? ""));
const click = (el: Element | undefined) =>
  act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
/** Let a promise chain and a zero-delay timer settle. */
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

/** Say a line in the composer. React holds the input's value, so the setter has
 *  to go round it for the change event to carry. */
async function typeInto(room: HTMLElement, text: string) {
  const input = room.querySelector<HTMLInputElement>(".wk-txt")!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  click(room.querySelector(".wk-send")!);
  await settle();
}

/**
 * VISIBLE WORDS (law 3).
 *
 * Text nodes, walked, with two exclusions and no others: `aria-hidden` subtrees
 * are decoration (the brand glyph, the ambient wash) and the manifest rail is
 * genuinely invisible at entry — it has zero width and zero opacity until the
 * conversation opens, which jsdom does not apply for us.
 */
function visibleWords(room: HTMLElement): string[] {
  const words: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      words.push(...(node.textContent ?? "").split(/\s+/).filter(Boolean));
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.getAttribute("aria-hidden") === "true") return;
    if (node.classList.contains("wk-col-r")) return;
    node.childNodes.forEach(walk);
  };
  walk(room);
  return words;
}

describe("law 3 — the opening view is under sixty words", () => {
  for (const mode of ["modify", "renew", "create"] as WorkroomMode[]) {
    it(`holds in ${mode}`, () => {
      const words = visibleWords(open(mode));
      expect(words.length).toBeLessThan(60);
    });
  }

  it("holds on the account door of create, which opens on no package at all", () => {
    expect(visibleWords(open("create", null)).length).toBeLessThan(60);
  });

  it("opens by NAME, and the greeting fits inside the budget", () => {
    const room = open("modify");
    // The room was opened on "fabian.goetzens@accenture.com.bankinggpt", which
    // is an identity the assembler stamps rather than a name anyone types. The
    // greeting is a real read out of it or it is nothing.
    expect(room.querySelector(".wk-greet")!.textContent).toBe("Hey Fabian. ");
    expect(room.querySelector(".wk-headline")!.textContent).toMatch(/^Hey Fabian\. \S/);
    expect(visibleWords(room).length).toBeLessThan(60);
  });

  it("greets nobody rather than greeting a record id", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // The two things that are NOT a name: the org's own user id, and the
    // placeholder the context falls back to when there is no identity at all.
    for (const approver of ["005bb00000ftouDAAQ", "the signed-in banker"]) {
      const context = { ...contextFor("modify"), approver };
      act(() => {
        root!.render(<Workroom context={context} engine={createScriptedEngine(context)} onClose={() => {}} />);
      });
      expect(document.querySelector(".wk-greet")).toBeNull();
      expect(document.querySelector(".wk-headline")!.textContent).not.toMatch(/hey/i);
    }
  });

  it("says the position ONCE, and the conversation is already open under it", () => {
    const room = open("modify");
    expect(room.querySelectorAll(".wk-headline")).toHaveLength(1);
    // W3, decided 2026-08-27: ONE scene. The briefing, the suggestion and the
    // composer arrive together, and there is no button between the banker and
    // the room. Law 3 still holds — the count above proves it.
    expect(room.querySelector(".wk-composer")).toBeTruthy();
    expect(room.querySelector(".wk-sugg")).toBeTruthy();
    expect(buttons().some((b) => /Open the conversation/.test(b.textContent ?? ""))).toBe(false);
    // SURFACE 5 (rule 44): the stage is FOUR MICRO-DOTS in the slim bar, and
    // the bar always carries them. The spine that used to arrive with the first
    // move is retired, so what law 3 protects here is the WORD BUDGET — and
    // four 5px dots carrying their labels on `title` spend none of it.
    expect(room.querySelectorAll(".wk-stg")).toHaveLength(4);
    expect([...room.querySelectorAll(".wk-stg")].map((d) => d.textContent).join("")).toBe("");
  });
});

/**
 * THE ROOM THE FOUNDER IS ACTUALLY IN.
 *
 * Every law-3 test above runs the SHELL engine on a seven-member fixture, which
 * is the room's own storyline and not the room a banker opens. The wired room
 * derives its strip, its position sentence and its suggestion from a real
 * bundle, and its word count moves with what that bundle holds — so the budget
 * is measured there too, or it is only guarded where nobody is standing.
 */
describe("law 3 — the WIRED room, on the baked relationship", () => {
  const data = live as unknown as C360Data;
  /** Hartwell: the C&I package's six booked members plus its Proposal-stage
   *  loan, anchored explicitly below; no client request staged. */
  const accountId = "001bb00001I7FPNAA3";

  function openWired() {
    const bundle = data.borrowers![accountId];
    const context = workroomContextFor({
      mode: "modify",
      data,
      bundle,
      accountId,
      accountName: bundle.snapshot!.name!, productPackageId: "a5Fbb000000IHFJEA4" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <Workroom
          context={context}
          engine={createModifyEngine({ context, data, bundle })}
          onClose={() => {}}
        />,
      );
    });
    return document.querySelector<HTMLElement>(".wk-room")!;
  }

  it("holds the sixty-word budget with the greeting in it", () => {
    expect(visibleWords(openWired()).length).toBeLessThan(60);
  });

  it("opens by name and leads on the deal's next move, not a headcount", () => {
    const room = openWired();
    const headline = room.querySelector(".wk-headline")!.textContent ?? "";
    expect(headline).toContain("Hey Fabian.");
    // Wave 2: the opener is proactive. Of Hartwell's six booked members, none
    // matures inside the coming quarter as of this snapshot's own clock
    // (`meta.generatedAt`), so the highest-priority thing this room can say is
    // the nearest covenant test due SOON (`nextMove.ts`, tier 2). On the clock
    // this snapshot actually carries, 2026-08-25, that is the Debt Service
    // Coverage with and without Distributions test, 36 days out. The Accounts
    // Receivable test is 25 days PAST due on the same clock, and the opener
    // deliberately does not lead on a missed test: it is the room's overdue
    // tier that says that out loud (`tips.ts`, exercised below). The old
    // headcount sentence ("All 6 members are booked...") is the fallback,
    // exercised in modifyEngine.test.ts on a bundle with no next move.
    expect(headline).toContain("The Debt Service Coverage with and without Distributions covenant is due in 36 days.");
    expect(headline).toMatch(/Start the review\?$/);
  });

  it("offers every eligible member as something to click, not something to read", () => {
    // The org grew a second package (2026-09-03) and its exposure read now
    // carries the C&I package's Proposal-stage $3M equipment loan too, so the
    // package's own member roster is seven now, not six.
    const chips = [...openWired().querySelectorAll<HTMLButtonElement>(".wk-mchip")];
    expect(chips).toHaveLength(7);
    // Six of the seven are eligible (booked) and click; the seventh, the
    // Proposal-stage $3M equipment loan the package now also carries, renders
    // disabled rather than dropped — it is a member of this package, just not
    // one this room's actions can touch yet.
    expect(chips.filter((c) => !c.disabled)).toHaveLength(6);
    expect(chips.filter((c) => c.disabled)).toHaveLength(1);
    // The chip says the PRODUCT. A record id on the face of a member chip is
    // what the founder's UAT read as hardcoded.
    expect(chips.map((c) => c.querySelector("b")!.textContent)).toEqual([
      "Line of Credit",
      "Construction",
      "Equipment",
      "Purchase",
      "Equipment",
      "Equipment",
      "Line of Credit",
    ]);
  });

  it("names the pill in banker grammar, with today's figure as context", () => {
    // NOT "Increase the Line of Credit - $15,000,000.00", which reads as
    // "increase BY fifteen million" — the exact ambiguity the live UAT hit.
    expect(openWired().querySelector(".wk-pill")!.textContent).toBe("Line of Credit · $15M committed");
  });
});

describe("one shell, three modes", () => {
  it("changes the vocabulary and nothing structural", () => {
    const titles = (["modify", "renew", "create"] as WorkroomMode[]).map((m) => {
      const room = open(m);
      const title = room.querySelector(".wk-title")!.textContent;
      act(() => root?.unmount());
      container?.remove();
      return title;
    });
    // SURFACE 5 (rule 44): the bar carries ONE word. "Workroom" is the noun the
    // room already is, and the app bar carries the brand.
    expect(titles).toEqual(["Modification", "Renewal", "New Facility"]);
  });

  it("names the fourth step for what the mode actually does", async () => {
    for (const [mode, step] of [
      ["modify", "Approve"],
      ["renew", "Submit"],
      ["create", "File"],
    ] as [WorkroomMode, string][]) {
      const room = open(mode);
      click(room.querySelector(".wk-pill")!);
      await settle();
      // SURFACE 5 (rule 44): NO STAGE WORD. The dot's label lives on `title`,
      // shown on hover, so the mode's own fourth verb is still named — it is
      // just no longer set in the bar.
      const spine = [...room.querySelectorAll(".wk-stg")].map((s) => s.getAttribute("title"));
      expect(spine.at(-1)).toContain(step);
      act(() => root?.unmount());
      container?.remove();
    }
  });

  it("shows the package's members on the door the banker joined, and none on the default one", () => {
    /* JOINED: the banker chose a package to file into, so its members are the
       thing the new facility sits beside. DEFAULT: the plan opens a package of
       its own and it is empty, so there is nothing to draw and the room does
       not borrow another package's members to fill the space. */
    expect(open("create").querySelectorAll(".wk-mchip").length).toBeGreaterThan(0);
    act(() => root?.unmount());
    container?.remove();
    const blank = open("create", "a5Fbb000000IHFJEA4", false);
    expect(blank.querySelectorAll(".wk-mchip")).toHaveLength(0);
    // The at-rest figures strip is gone (founder call, 2026-09-01): an invented
    // package would now have to show up as a chip, and there is none.
    expect(blank.querySelector(".wk-agg")).toBeNull();
  });
});

describe("law 8 — the manifest starts empty and the arrival is the signature", () => {
  it("stages nothing until a confirm lands", () => {
    const room = open("modify");
    // Founder call 2026-09-01: the lane opens EMPTY - no placeholder line, no
    // manifest header, no figures strip. The manifest does not merely start
    // empty, it starts ABSENT; the first confirm is what summons it.
    expect(room.querySelector(".wk-empty")).toBeNull();
    expect(room.querySelector(".wk-ent")).toBeNull();
    expect(room.querySelector(".wk-man-h")).toBeNull();
    expect(room.querySelector(".wk-agg")).toBeNull();
  });

  it("walks the package figures forward on a confirm and back on a removal", async () => {
    const room = open("modify");
    click(byText(/liquidity covenant/));
    await settle();

    // Two proposed changes, nothing written, nothing in the rail yet.
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(2);
    expect(room.querySelector(".wk-ent")).toBeNull();
    // No strip to read any more: before the first confirm the lane stays bare.
    expect(room.querySelector(".wk-man-h")).toBeNull();

    click(buttons().find((b) => b.textContent === "Confirm"));
    await settle();

    // The commitment change landed: one entry, and the strip is pro forma.
    expect(room.querySelectorAll(".wk-ent")).toHaveLength(1);
    // The confirm SUMMONS the ledger: header appears with the walked figure.
    expect(room.querySelector(".wk-man-h")!.textContent).toContain("1 of 7 members");
    // The confirmed chip left a receipt, because the change itself moved right.
    expect(room.querySelector(".wk-receipt")!.textContent).toContain("in the manifest");

    click(room.querySelector(".wk-ent-x")!);
    await settle();

    expect(room.querySelectorAll(".wk-ent")).toHaveLength(0);
    // Walked back to zero, the ledger retires entirely - no strip, no header,
    // no "Nothing staged" placeholder (founder call 2026-09-01).
    expect(room.querySelector(".wk-agg")).toBeNull();
    expect(room.querySelector(".wk-man-h")).toBeNull();
    // The receipt does not lie about where the change is.
    expect(room.querySelector(".wk-receipt")!.textContent).toContain("say it again to restage");
  });

  it("brings the check back into the conversation the moment the confirm trips it", async () => {
    const room = open("modify");
    click(byText(/liquidity covenant/));
    await settle();
    click(buttons().find((b) => b.textContent === "Confirm"));
    await settle();

    const verdict = room.querySelector(".wk-vchip");
    expect(verdict?.textContent).toBe("No shortfall");
    // The check is a gate: the spine's Checks step is lit and not settled.
    expect([...room.querySelectorAll(".wk-stg")][2].className).toContain("wk-on");
    click(byText(/^Acknowledge$/));
    expect([...room.querySelectorAll(".wk-stg")][2].className).toContain("wk-done");
  });

  it("takes one decision at a time and says so rather than queueing a second", async () => {
    const room = open("modify");
    click(byText(/liquidity covenant/));
    await settle();

    await typeInto(room, "and raise the seasonal line too");
    expect(room.textContent).toContain("One decision at a time");
  });
});

/* =============================================================================
   THE CONVERSATION LOOP.

   Reproduced headless on 2026-08-27, before any of this existed: the banker
   confirmed a chip, the entry landed in the rail, the chip collapsed to a
   receipt — and the room said NOTHING. No acknowledgement, no check, no next
   move, and no approval either, because the approve bar waited on the engine's
   suggestions running out. The manifest filled and the room went quiet, which a
   banker reads as broken rather than as finished.

   Every test below is that failure, held closed.
   ============================================================================= */

describe("no move the banker makes is answered with silence", () => {
  /** The storyline's first beat, confirmed. Two chips arrive; this settles one. */
  async function confirmFirstChip() {
    const room = open("modify");
    click(byText(/liquidity covenant/));
    await settle();
    const before = room.querySelectorAll(".wk-msg").length;
    click(buttons().find((b) => b.textContent === "Confirm"));
    await settle();
    return { room, before };
  }

  it("SPEAKS when a chip lands, naming what it did", async () => {
    const { room, before } = await confirmFirstChip();
    // The entry is in the rail AND the room said so. The rail moving on its own
    // is the bug: a manifest that grows in silence reads as nothing happening.
    expect(room.querySelectorAll(".wk-ent")).toHaveLength(1);
    expect(room.querySelectorAll(".wk-msg").length).toBeGreaterThan(before);
    const bubbles = [...room.querySelectorAll(".wk-agent .wk-bub")].map((n) => n.textContent ?? "");
    expect(bubbles.some((t) => /in the manifest/.test(t))).toBe(true);
    /* AND IT ENDS ON THE FACT, NOT ON A TAIL (founder, 2026-09-03: "no
       tails"). "Anything else on this facility, or shall I stage it?" was the
       room keeping the conversation open; the composer under it has been doing
       that on its own since the room had one, and the question was one more
       thing to read on a glass the founder was already asking to quieten. */
    expect(bubbles.some((t) => /Anything else on this facility/.test(t))).toBe(false);
  });

  it("advances the stepper visibly on the same confirm", async () => {
    const { room } = await confirmFirstChip();
    expect(room.querySelector(".wk-stepper")).toBeTruthy();
    // SURFACE 5 (rule 44): the compose count rides the dot's `title`.
    expect([...room.querySelectorAll(".wk-stg")][1].getAttribute("title")).toContain("1/");
    // The beat's second chip is still open, so the room holds the next move back
    // rather than offering two decisions at once (law 2). SURFACE 5: the scene
    // bar is retired with the island (rule 44), so what proves the gate is the
    // absence of the REVIEW CHIP — the only route to the plan there now is.
    expect(room.querySelector(".wk-pill")).toBeNull();
    expect(room.querySelector(".wk-propose")).toBeNull();
  });

  it("opens the approval on a staged manifest, NOT on the suggestions running out", async () => {
    const room = open("modify");
    click(byText(/liquidity covenant/));
    await settle();
    for (const b of buttons().filter((x) => x.textContent === "Confirm")) {
      click(b);
      await settle();
    }
    for (const b of buttons().filter((x) => x.textContent === "Acknowledge")) click(b);
    await settle();

    // Two entries staged, nothing waiting on the banker — so the approval is the
    // open move, even though the engine still has moves left to suggest.
    expect(room.querySelectorAll(".wk-ent").length).toBeGreaterThan(0);
    expect(room.querySelector(".wk-pill")).toBeTruthy();
    // SURFACE 5 (rule 38): the review chip is in the thread, and opening it is
    // what puts the token and the ink Execute on the table. Both moves are
    // legitimate, so the room offers the suggestion AND the chip rather than
    // choosing for the banker — which is what the retired scene bar proved.
    expect(room.querySelector(".wk-propose")).toBeTruthy();
    await openPlan();
    expect(byText(/^Approve and file /)).toBeTruthy();
  });

  it("answers a discard, because declining a change is a decision too", async () => {
    const room = open("modify");
    click(byText(/liquidity covenant/));
    await settle();
    const before = room.querySelectorAll(".wk-msg").length;
    click(buttons().find((b) => b.textContent === "Discard"));
    await settle();
    expect(room.querySelectorAll(".wk-msg").length).toBeGreaterThan(before);
    expect(room.textContent).toContain("the package has not moved");
    expect(room.querySelector(".wk-ent")).toBeNull();
  });

  it("answers a refusal being understood, and leaves the reason on screen", async () => {
    const room = open("modify");
    click(byText(/liquidity covenant/));
    await settle();
    for (const b of buttons().filter((x) => x.textContent === "Confirm")) {
      click(b);
      await settle();
    }
    for (const b of buttons().filter((x) => x.textContent === "Acknowledge")) click(b);
    click(byText(/construction loan too/));
    await settle();
    const reason = room.querySelector(".wk-refuse .wk-quote")!.textContent;
    click(byText(/^Understood$/));
    await settle();
    expect(room.textContent).toContain("stays off the manifest");
    // Settled, not vanished: the refusal's reason IS the answer, so taking the
    // chip off the screen would take the answer with it.
    expect(room.querySelector(".wk-refuse .wk-quote")!.textContent).toBe(reason);
  });
});

describe("law 7 — the mark is the original vector", () => {
  // Superseded 2026-08-31 (Electric Glass lock): the mark is the ORIGINAL
  // Accenture ">" path (path8760), never a typed character. This law asserted
  // the 2026-08-27 typographic directive; the newer founder call inverts it.
  // SURFACE 5 (rules 44 + 45): the room's bar is ONE SLIM LINE and carries NO
  // lockup — the app bar behind the glass owns the brand, and the room owns the
  // mark alone. So what this law asserts in here is that the mark the bar does
  // carry is the official vector, never a typed ">".
  it("draws the bar's mark with the official vector, never a typed character", () => {
    const room = open("modify");
    expect(room.querySelector(".c360-lockup")).toBeNull();
    const mark = room.querySelector<HTMLElement>(".wk-head .c360-glyph")!;
    expect(mark.querySelector("svg path")).not.toBeNull();
    expect(mark.textContent).toBe("");
  });

  it("carries the load, step and arrival motif on the same vector glyph", async () => {
    const room = open("modify");
    click(room.querySelector(".wk-pill")!);
    await settle();
    for (const glyph of room.querySelectorAll(".c360-glyph")) {
      expect(glyph.querySelector("svg path")).not.toBeNull();
      expect(glyph.textContent).toBe("");
    }
    // SURFACE 5 (rule 44): the stage is four 5px DOTS, not four glyphs — the
    // mark's census in this room is the bar, the composing beat and the liquid
    // moments, and nothing else.
    expect(room.querySelectorAll(".wk-stg .c360-glyph")).toHaveLength(0);
    expect(room.querySelectorAll(".wk-head .c360-glyph")).toHaveLength(1);
  });
});

describe("law 5 — nothing in the room scrolls", () => {
  const css = readFileSync(resolve(process.cwd(), "src/styles/workroom.css"), "utf8");

  it("declares exactly ONE scroller, and it never shows a scrollbar", () => {
    // SURFACE 5 (rule 31): the room shows ONE live exchange and the steps behind
    // it collapse — but the live exchange itself may run long, so the thread is
    // allowed to scroll. What is NOT allowed is a visible scrollbar: "no visible
    // scrollbar in the thread ever" is the rule as locked, and it replaces the
    // fold model this law used to be built on. So the file may declare exactly
    // one scroller, it must be `.wk-thread`, and it must hide its own bar in
    // both engines. Comments explain the rule; only DECLARATIONS can break it.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const scrollers = [...rules.matchAll(/overflow(?:-[xy])?:\s*(auto|scroll)/g)];
    expect(scrollers).toHaveLength(1);
    const thread = rules.slice(rules.indexOf(".wk-thread {"));
    expect(thread).toContain("overflow: auto");
    expect(thread).toContain("scrollbar-width: none");
    expect(rules).toContain(".wk-thread::-webkit-scrollbar {\n  display: none;\n}");
  });

  it("opens every disclosure as a peek that floats over the room", async () => {
    const room = open("modify");
    // The explainer is the quiet "?" in the question bubble's own top-right
    // corner now (founder, 2026-09-01) rather than a "Why" pill in the row
    // under the chips. Same peek, same read, one less control in the band.
    const why = room.querySelector<HTMLButtonElement>(".wk-openbub > .wk-whybtn")!;
    expect(why.textContent).toBe("?");
    expect(why.getAttribute("aria-label")).toBe("Why this position");
    click(why);
    await settle();
    const peek = document.querySelector(".wk-peek-card");
    expect(peek).toBeTruthy();
    // The peek is OUTSIDE the room's own box, so it cannot grow a pane.
    expect(room.contains(peek!)).toBe(false);
    expect(peek!.textContent).toContain("the agent recommends, the banker decides");
  });

  it("locks the page behind the room while it is open", () => {
    open("modify");
    expect(document.body.classList.contains("wk-open")).toBe(true);
  });
});

describe("the closing beat", () => {
  it("files every entry with the org id that proves it, and drafts the reply", async () => {
    const room = open("modify");

    // The whole storyline: two beats of changes, a refusal, then the rest.
    click(byText(/liquidity covenant/));
    await settle();
    for (const b of buttons().filter((x) => x.textContent === "Confirm")) {
      click(b);
      await settle();
    }
    for (const b of buttons().filter((x) => x.textContent === "Acknowledge")) click(b);
    click(byText(/construction loan too/));
    await settle();
    click(byText(/^Understood$/));
    click(byText(/pledge the Mazak/));
    await settle();
    for (const b of buttons().filter((x) => x.textContent === "Confirm")) {
      click(b);
      await settle();
    }
    for (const b of buttons().filter((x) => x.textContent === "Acknowledge")) click(b);

    expect(room.querySelectorAll(".wk-ent")).toHaveLength(4);
    await openPlan();
    const approve = byText(/^Approve and file 4 changes$/);
    expect(approve).toBeTruthy();
    click(approve);
    await settle();

    const filed = [...room.querySelectorAll(".wk-filedbar .wk-id")].map((n) => n.textContent);
    expect(filed).toHaveLength(4);
    expect(filed).toContain("a4Zbb0000027NpMEAU");
    expect(room.querySelector(".wk-tokline")!.textContent).toContain("single use");
    expect(room.textContent).toContain("Hartwell Industrial, operating line increase and equipment facility");
  });

  it("RENEW says booking runs through the bank's own approval process", async () => {
    const room = open("renew");
    click(byText(/Renew at \$2.5MM/));
    await settle();
    for (const b of buttons().filter((x) => x.textContent === "Confirm")) {
      click(b);
      await settle();
    }
    for (const b of buttons().filter((x) => x.textContent === "Acknowledge")) click(b);
    click(byText(/construction facility while we are here/));
    await settle();
    click(byText(/^Understood$/));
    click(byText(/Carry the pledge and the covenant/));
    await settle();
    for (const b of buttons().filter((x) => x.textContent === "Confirm")) {
      click(b);
      await settle();
    }
    for (const b of buttons().filter((x) => x.textContent === "Acknowledge")) click(b);

    await openPlan();
    click(byText(/^Approve and submit 4 terms$/));
    await settle();
    expect(room.querySelector(".wk-handoff")!.textContent).toContain("Submit for Approval");
    expect(room.querySelector(".wk-handoff")!.textContent).toContain("does not book the facility");
    expect(room.querySelector(".wk-filedbar .wk-st")!.textContent).toBe("Submitted");
  });
});

/* =============================================================================
   THE ROOM EXPLAINS ITSELF, AND ADVISES BEFORE IT STAGES.

   Founder verdict 2026-08-29: the room "feels almost more like guided template
   still, no explanation" — "it can explain also concise in the flow what and why
   it is needed."

   The copy is proved in `workroom/explain.test.ts` and the rules in
   `workroom/modifyEngine.test.ts`. What is proved HERE is the reading: advice
   looks like advice and not like a verdict, it never becomes a gate, and taking
   it replaces the change it was about rather than piling a second one on top.
   ============================================================================= */

describe("tier-1 advice, in the room", () => {
  const ADVICE_PACKAGE = "a5Fbb000000ADVICE";

  /** A read built for the rules rather than borrowed from the baked
   *  relationship, so what the advice says is a property of the room and not of
   *  whatever Hartwell happens to hold this week. One booked member, drawn
   *  $9.2MM, with the client's own $20MM ask on the file. */
  function adviceBundle(over: Partial<BorrowerBundle["exposure"]> = {}) {
    return {
      snapshot: {
        accountId: "001bb00001DLtRMAA1",
        name: "Hartwell Precision Manufacturing LLC",
        productPackageId: ADVICE_PACKAGE,
      },
      exposure: {
        totalCommitted: 15_000_000,
        totalOutstanding: 9_200_000,
        facilities: [
          {
            loanId: "a4Zbb000000ADVICE",
            name: "Hartwell Precision Manufacturing LLC - Line of Credit - $15,000,000.00",
            productType: "Line of Credit",
            productPackageId: ADVICE_PACKAGE,
            stage: "Booked",
            status: "Active",
            committed: 15_000_000,
            outstanding: 9_200_000,
          },
        ],
        ...over,
      },
      requests: [{ id: "r1", ask: { type: "facility_increase", from: 15_000_000, to: 20_000_000 } }],
    } as unknown as BorrowerBundle;
  }

  function openAdvice() {
    const context = contextFor("modify", ADVICE_PACKAGE);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <Workroom
          context={context}
          engine={createModifyEngine({ context, data: live as unknown as C360Data, bundle: adviceBundle() })}
          onClose={() => {}}
        />,
      );
    });
    return document.querySelector<HTMLElement>(".wk-room")!;
  }

  /** Say a line the way a banker does: pick the member off the strip, then talk
   *  about it. The strip IS the way in, so the room already knows which one. */
  async function askForEightMillion(room: HTMLElement) {
    click(room.querySelector(".wk-mchip")!);
    await settle();
    await typeInto(room, "take it to $8,000,000");
  }

  it("says the thing a credit officer would say across the desk, on this read's own figures", async () => {
    const room = openAdvice();
    await askForEightMillion(room);
    const advice = room.querySelector(".wk-advice")!;
    expect(advice.textContent).toContain("$9.20M is already drawn on the Line of Credit");
    expect(advice.textContent).toContain("a limit of $8M does not work as stated");
    expect(advice.getAttribute("data-rule")).toBe("commitment-below-outstanding");
  });

  it("is ADVICE, not a verdict: no verdict chip, no acknowledgement, no gate", async () => {
    const room = openAdvice();
    await askForEightMillion(room);
    // A check carries a coloured verdict chip and an Acknowledge button because
    // it IS a gate. This carries neither, and it sits above a live Confirm.
    expect(room.querySelector(".wk-advice .wk-vchip")).toBeNull();
    expect(byText(/^Acknowledge$/)).toBeUndefined();
    expect(room.querySelector(".wk-advice")!.contains(byText(/^Confirm$/)!)).toBe(false);
    expect(buttons().find((b) => b.textContent === "Confirm")!.disabled).toBe(false);
  });

  it("lets the banker proceed anyway, which is what never blocking means", async () => {
    const room = openAdvice();
    await askForEightMillion(room);
    click(buttons().find((b) => b.textContent === "Confirm"));
    await settle();
    // Staged, and the route to the plan is open — with the advice never
    // acknowledged. SURFACE 5 (rule 38): that route is the REVIEW CHIP in the
    // thread, and this fixture has no channel behind it, so what proves "never
    // blocking" here is that the chip is offered at all. What happens when the
    // chip is opened against no connector is the channel-none doctrine and is
    // asserted where that belongs.
    expect(room.querySelectorAll(".wk-ent")).toHaveLength(1);
    expect(room.querySelector(".wk-propose")!.textContent).toContain("1 change on the manifest");
  });

  it("stops being advice once the decision is made", async () => {
    const room = openAdvice();
    await askForEightMillion(room);
    expect(room.querySelector(".wk-advice")).toBeTruthy();
    click(buttons().find((b) => b.textContent === "Confirm"));
    await settle();
    expect(room.querySelector(".wk-advice")).toBeNull();
    expect(room.querySelector(".wk-receipt")).toBeTruthy();
  });

  it("REPLACES the change when the resolution is taken, rather than stacking a second one", async () => {
    const room = openAdvice();
    await askForEightMillion(room);
    click(room.querySelector(".wk-advice-b")!);
    await settle();

    // The proposal the advice was about is gone — settled by the same gesture,
    // so law 2 holds and there is still exactly one decision on the table.
    const chips = [...room.querySelectorAll(".wk-chip")];
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain("$20M");
    expect(chips[0].textContent).not.toContain("$8M");
    // And the room did not answer it with "one decision at a time".
    expect(room.textContent).not.toContain("One decision at a time");
    // The banker's own line is in the thread, in the words they clicked.
    expect(room.textContent).toContain("Make it $20M, the client's own ask");
  });

  it("holds the sixty-word budget: nothing here reaches the opening view", () => {
    expect(visibleWords(openAdvice()).length).toBeLessThan(60);
    expect(document.querySelector(".wk-advice")).toBeNull();
  });
});

describe("the WIRED room says why, at the beats that carry a decision", () => {
  const data = live as unknown as C360Data;
  const accountId = "001bb00001I7FPNAA3";

  function openWired() {
    const bundle = data.borrowers![accountId];
    const context = workroomContextFor({ mode: "modify", data, bundle, accountId, accountName: bundle.snapshot!.name!, productPackageId: "a5Fbb000000IHFJEA4" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <Workroom context={context} engine={createModifyEngine({ context, data, bundle })} onClose={() => {}} />,
      );
    });
    return document.querySelector<HTMLElement>(".wk-room")!;
  }

  it("puts the reason under the check's own figures, quietly", async () => {
    const room = openWired();
    click(room.querySelector(".wk-mchip")!);
    await settle();
    await typeInto(room, "take it to $20,000,000");
    click(buttons().find((b) => b.textContent === "Confirm"));
    await settle();

    const why = room.querySelector(".wk-vwhy")!;
    expect(why.textContent).toContain("does not grow with the commitment");
    // It is the reason BEHIND the verdict, so it sits under the figures rather
    // than competing with them.
    expect(room.querySelector(".wk-vtxt")!.compareDocumentPosition(why) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("leads a refusal with the way through it, and keeps the org's own words as the quote", async () => {
    const room = openWired();
    await typeInto(room, "waive the covenant on the Hartwell Precision Manufacturing LLC - Line of Credit - $15,000,000.00");
    const refusal = room.querySelector(".wk-refuse")!;
    expect(refusal.querySelector(".wk-refuse-why")!.textContent).toContain("Open the covenant review");
    expect(refusal.querySelector(".wk-quote")!.textContent).toMatch(/founder-gated/);
    // The banker's reading comes FIRST; the org's account is the quote below it.
    const why = refusal.querySelector(".wk-refuse-why")!;
    const quote = refusal.querySelector(".wk-quote")!;
    expect(why.compareDocumentPosition(quote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

/* =============================================================================
   THREE DEFECTS OFF A LIVE CLICK-THROUGH.

   Each one is a place where the room dropped, refused or garbled something the
   banker had already decided. None of them is in the engine: they are all in
   what the shell does with what the engine hands back.
   ============================================================================= */

/** The storyline's first beat, staged: a pill, its chips confirmed. Leaves the
 *  room with the checks that confirm trips still open. */
async function stageTheFirstBeat() {
  click(byText(/liquidity covenant/));
  await settle();
  for (const b of buttons().filter((x) => x.textContent === "Confirm")) {
    click(b);
    await settle();
  }
}

describe("closing the room does not drop the composed manifest", () => {
  it("picks the manifest up again, and says that it did", async () => {
    const room = open("modify");
    await stageTheFirstBeat();
    for (const b of buttons().filter((x) => x.textContent === "Acknowledge")) click(b);
    await settle();
    const staged = room.querySelectorAll(".wk-ent").length;
    expect(staged).toBeGreaterThan(0);

    shut();
    const reopened = open("modify");
    await settle();

    // The rail is where the banker left it, and the room says so rather than
    // presenting it as though it had always been there. (Law 3 is about an
    // OPENING view; a room picking work back up is not one.)
    expect(reopened.querySelectorAll(".wk-ent").length).toBe(staged);
    expect(reopened.textContent).toContain(`Picking up where you left off: ${staged} changes on the manifest.`);
  });

  it("starts clean on a different package, because the anchor is the boundary", async () => {
    open("modify");
    await stageTheFirstBeat();
    shut();

    const elsewhere = open("modify", "a5Fbb000000IHXXEA4");
    await settle();
    expect(elsewhere.querySelector(".wk-ent")).toBeNull();
    expect(elsewhere.textContent).not.toContain("Picking up where you left off");
  });
});

describe("a typed acknowledgment settles the check it is about", () => {
  it("settles the open checks exactly as the button does, and opens the approval", async () => {
    const room = open("modify");
    await stageTheFirstBeat();
    expect(buttons().some((b) => b.textContent === "Acknowledge")).toBe(true);

    await typeInto(room, "acknowledged, proceed");

    // Settled, and the room did not answer a decision with "one decision at a
    // time" — which is what it used to do to the banker who typed it.
    expect(buttons().some((b) => b.textContent === "Acknowledge")).toBe(false);
    expect(room.textContent).not.toContain("One decision at a time");
    const agentBubbles = [...room.querySelectorAll(".wk-agent .wk-bub")].map((n) => n.textContent ?? "");
    expect(agentBubbles.some((t) => /(That check is|Those \d+ checks are) acknowledged\./.test(t))).toBe(true);
    await openPlan();
    expect(byText(/^Approve and file /)).toBeTruthy();
  });

  it("NEVER settles a confirm or a discard from a sentence", async () => {
    const room = open("modify");
    click(byText(/liquidity covenant/));
    await settle();

    await typeInto(room, "acknowledged");

    // What goes on the manifest is chosen by a gesture on the chip and never by
    // a word in a sentence, so the room holds the line it always held.
    expect(room.textContent).toContain("One decision at a time");
    expect(buttons().some((b) => b.textContent === "Confirm")).toBe(true);
  });
});

describe("a failed execute is a sentence, and it closes the approval", () => {
  /** The transport rejects with a plain failure OBJECT, not an Error. This is
   *  the shape that put "[object Object]" in the thread as the room's whole
   *  answer to an execute the org had in fact completed. */
  function roomThatFailsOnExecute() {
    const context = contextFor("modify");
    const scripted = createScriptedEngine(context);
    const engine: WorkroomEngine = {
      ...scripted,
      execute: async () => {
        throw { code: "TOKEN_REFUSED", server: "customer360" };
      },
    };
    /* THE ORG SAYS THE ROW IS STILL `Staged`, which is how the room knows the
       token was never redeemed and this refusal is the whole truth. Two reads,
       because one can catch a real dispatch between the callout and the claim. */
    let clock = 0;
    return openWith(context, engine, {
      readState: async () => ({ stagingId: "STG", status: "Staged" }),
      wait: async (ms: number) => {
        clock += ms;
      },
      now: () => clock,
    });
  }

  it("says what came back, and never says [object Object]", async () => {
    const room = roomThatFailsOnExecute();
    await stageTheFirstBeat();
    for (const b of buttons().filter((x) => x.textContent === "Acknowledge")) click(b);
    await settle();

    await openPlan();
    click(byText(/^Approve and file /));
    await settle();

    expect(room.textContent).not.toContain("[object Object]");
    expect(room.textContent).toContain("TOKEN_REFUSED");
  });

  it("does not re-arm a button whose retry would bounce on a burnt token", async () => {
    const room = roomThatFailsOnExecute();
    await stageTheFirstBeat();
    for (const b of buttons().filter((x) => x.textContent === "Acknowledge")) click(b);
    await settle();

    await openPlan();
    click(byText(/^Approve and file /));
    await settle();

    const approve = room.querySelector<HTMLButtonElement>(".wk-approve")!;
    expect(approve.disabled).toBe(true);
    expect(approve.textContent).toBe("Approval closed");
    /* AND IT NO LONGER GUESSES (2026-09-03). The room used to add "the filing
       may have completed despite the error; do not approve again, check the
       staging record" to every failure that had reached the org. On the
       founder's live run the filing HAD completed, so the warning was both
       frightening and wrong. The org's own refusal is now the whole answer. */
    expect(room.textContent).not.toContain("may have completed despite the error");
    expect(room.textContent).not.toContain("Do not approve again");
  });
});

/* =============================================================================
   SURFACE — A FILING THE ROOM CANNOT SEE THE END OF.

   The connector's invocation timeout is shorter than a modification carrying a
   net-new facility: the founder's run took 55 seconds and the answer never came
   back. The engine now waits on the org's own staging record; the ROOM's job is
   to say so quietly, land the ordinary executed card when the answer arrives,
   and — when the wait budget runs out — offer to ask the org again rather than
   to approve again.
   ============================================================================= */

describe("a filing whose answer was lost", () => {
  /** THE LOST ANSWER, in the shape the connector actually rejects with. */
  const LOST = { code: "upstream_error", server: "customer360", message: "Timeout while invoking the tool ExecuteLoanModification" };

  /**
   * The room, on its own storyline engine, with the execute made to lose its
   * answer the first N times and the org's trail scripted alongside.
   *
   * The wrapper delegates to THIS engine and no other: a second scripted engine
   * has staged nothing and would refuse the approval the room is holding.
   */
  function roomLosing(loseTimes: number, statuses: Array<string | undefined>) {
    const context = contextFor("modify");
    const scripted = createScriptedEngine(context);
    let lost = 0;
    const calls = { execute: 0, reads: 0 };
    const engine: WorkroomEngine = {
      ...scripted,
      execute: async (approval) => {
        calls.execute += 1;
        if (lost < loseTimes) {
          lost += 1;
          throw LOST;
        }
        return scripted.execute(approval);
      },
    };
    let clock = 0;
    const room = openWith(context, engine, {
      readState: async () => {
        const status = statuses[Math.min(calls.reads, statuses.length - 1)];
        calls.reads += 1;
        return status ? { stagingId: "STG", status } : undefined;
      },
      wait: async (ms: number) => {
        clock += ms;
      },
      now: () => clock,
    });
    return { room, calls };
  }

  async function approve() {
    await stageTheFirstBeat();
    for (const b of buttons().filter((x) => x.textContent === "Acknowledge")) click(b);
    await settle();
    await openPlan();
    click(byText(/^Approve and file /));
    await settle();
  }

  it("says one quiet line, waits out the org, and lands the ordinary executed card", async () => {
    // Two polls of Executing — where consuming the token leaves the row — then
    // the terminal status the founder's own run ended on.
    const { room, calls } = roomLosing(1, ["Executing", "Executing", "Partial"]);
    await approve();

    expect(room.textContent).toContain("Filing in progress, nCino is still writing");
    // THE CARD LANDS EXACTLY AS ON A NORMAL SUCCESS. A recovered filing that
    // rendered differently would teach the banker to distrust the honest one.
    expect(room.querySelector(".wk-rescard")).toBeTruthy();
    expect(room.textContent).not.toContain("Do not approve again");
    expect(room.textContent).not.toContain("may have completed despite the error");
    // ONE filing call and ONE replay. The room never files twice.
    expect(calls.execute).toBe(2);
  });

  it("offers a status re-read, not an approval, when the budget runs out", async () => {
    const { room, calls } = roomLosing(1, ["Executing"]);
    await approve();

    // The approval is closed and stays closed.
    const approveBtn = room.querySelector<HTMLButtonElement>(".wk-approve")!;
    expect(approveBtn.disabled).toBe(true);
    expect(room.textContent).toContain("Nothing needs approving again");
    expect(room.querySelector(".wk-rescard")).toBeNull();
    // The budget was spent on READS. The tool was called once, to file.
    expect(calls.execute).toBe(1);
  });

  it("the chip asks the org again, and lands the card without a second approval", async () => {
    const context = contextFor("modify");
    const scripted = createScriptedEngine(context);
    let lost = false;
    let status = "Executing";
    let executes = 0;
    let clock = 0;
    const room = openWith(
      context,
      {
        ...scripted,
        execute: async (approval) => {
          executes += 1;
          if (lost) return scripted.execute(approval);
          lost = true;
          throw LOST;
        },
      },
      {
        readState: async () => ({ stagingId: "STG", status }),
        wait: async (ms: number) => {
          clock += ms;
        },
        now: () => clock,
      },
    );
    await approve();

    const chip = buttons().find((b) => b.textContent === "Check the filing")!;
    expect(chip).toBeTruthy();
    // The banker reads the line; the org finishes while they do.
    status = "Completed";
    clock = 0;
    click(chip);
    await settle();

    // The card landed, and the plan is off the stage exactly as on a filing that
    // answered the first time — the approve control goes with it.
    expect(room.querySelector(".wk-rescard")).toBeTruthy();
    expect(room.querySelector(".wk-approve")).toBeNull();
    // Still ONE filing call, plus the one replay the chip spent.
    expect(executes).toBe(2);
  });

  it("says a terminal failure as the org's own fact, and never as a timeout", async () => {
    const { room, calls } = roomLosing(1, ["Failed"]);
    await approve();

    expect(room.textContent).toContain("The org reports this filing as failed");
    expect(room.textContent).not.toContain("Nothing needs approving again: the plan is with the org");
    expect(room.querySelector(".wk-rescard")).toBeNull();
    expect(calls.execute).toBe(1);
  });

  it("a plan that never reached an org is not waited on at all", async () => {
    const context = contextFor("modify");
    const scripted = createScriptedEngine(context);
    const readState = vi.fn();
    const room = openWith(
      context,
      { ...scripted, execute: async () => { throw { code: "server_not_connected", server: "customer360" }; } },
      { readState, wait: async () => {}, now: () => 0 },
    );
    await approve();

    expect(readState).not.toHaveBeenCalled();
    expect(room.querySelector(".wk-rescard")).toBeNull();
  });
});

/* =============================================================================
   SURFACE 5 — THE CHANNEL-NONE DOCTRINE, SAID OUT LOUD.

   No connector means no plan, nothing simulated, and no token ever burnt. That
   part was always true; what it was NOT was legible. The refusal arrived as one
   more sentence in the flow of the conversation, and a founder reading the room
   could not tell "this view is not connected" from "something went wrong" —
   which is a banker retrying a room that can never answer. It gets a surface of
   its own now, in glass, with the way out of it.
   ============================================================================= */

describe("no connector is a state the room SHOWS, not a sentence it mumbles", () => {
  /** An engine that reaches no org. The refusal is the one the real engines
   *  raise, verbatim, so the room is matching production and not a fixture. */
  function roomWithNoConnector(seen: { executed: number }) {
    const context = contextFor("modify");
    const scripted = createScriptedEngine(context);
    const engine: WorkroomEngine = {
      ...scripted,
      stagePlan: async () => {
        throw new Error(NO_CONNECTOR_REFUSAL);
      },
      execute: async () => {
        seen.executed += 1;
        throw new Error("the room must never get here");
      },
    };
    return openWith(context, engine);
  }

  it("puts a glass notice in the thread, with the reason and the way out", async () => {
    const seen = { executed: 0 };
    const room = roomWithNoConnector(seen);
    await stageTheFirstBeat();
    for (const b of buttons().filter((x) => x.textContent === "Acknowledge")) click(b);
    await settle();

    await openPlan();

    const notice = room.querySelector(".wk-notice")!;
    expect(notice).toBeTruthy();
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toContain("not connected to the bank's systems");
    // The way out, in the banker's own terms, not a stack trace.
    expect(notice.textContent).toContain("Reload the page and accept the connection prompt");
  });

  it("burns no token and offers no plan it cannot honour", async () => {
    const seen = { executed: 0 };
    const room = roomWithNoConnector(seen);
    await stageTheFirstBeat();
    for (const b of buttons().filter((x) => x.textContent === "Acknowledge")) click(b);
    await settle();

    await openPlan();

    // Staging is where the room found out, so execute is never reached and no
    // single-use token is spent finding out what it already knew.
    expect(seen.executed).toBe(0);
    // And no flow card is left on the table pretending it has a plan.
    expect(room.querySelector(".wk-flowcard")).toBeNull();
    expect(byText(/^Approve and file /)).toBeUndefined();
    // The manifest is untouched: nothing was written and nothing was dropped.
    expect(room.querySelectorAll(".wk-ent").length).toBeGreaterThan(0);
  });
});

/* =============================================================================
   SURFACE 5 — WRITE-BACK THROUGH THE GLASS (rule 62).

   Execute is theatre with REAL numbers: the commitment delta the manifest
   carried is handed to the cockpit, which rolls its own figures behind the
   room's blur while the room is still open on the confirmation. The room hands
   the figure over and does not reach into the cockpit itself — it has no
   provider above it here, and a dispatch that rebuilt its own engine would
   knock it out of the scene it just landed on.
   ============================================================================= */

describe("the executed commitment delta leaves the room", () => {
  it("hands the cockpit the delta its own manifest carried, once, on a landed execute", async () => {
    const context = contextFor("modify");
    const seen: number[] = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <Workroom
          context={context}
          engine={createScriptedEngine(context)}
          onClose={() => {}}
          onExecuted={(mm) => seen.push(mm)}
        />,
      );
    });
    const room = document.querySelector<HTMLElement>(".wk-room")!;

    await stageTheFirstBeat();
    for (const b of buttons().filter((x) => x.textContent === "Acknowledge")) click(b);
    await settle();
    await openPlan();
    click(byText(/^Approve and file /));
    await settle();

    // The dossier landed, so the write is real — and the delta went out exactly
    // once, carrying the figure the manifest computed rather than a constant.
    expect(room.querySelector(".wk-rescard")).toBeTruthy();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThan(0);
  });
});

/* =============================================================================
   THE UNIFIED ROUTER — ONE ROOM, THREE ROUTES.

   The founder's consolidation (2026-08-31): the room can be opened WITHOUT a
   route and its first question decides which engine takes the session. What is
   proved here is the ROOM's half of that — the question in the greeting slot,
   the chips, the free text that binds implicitly, and the discipline that stops
   a bound room quietly changing engine under a composed manifest.

   THE ENGINES ARE UNTOUCHED BY ALL OF IT. Every test below runs the same
   scripted engine every other test in this file runs; the router is a prop.
   ============================================================================= */

/** A signal the deal actually made, shaped as `smartOpeningFor` returns it. */
const MATURITY_SIGNAL: SmartOpening = {
  line: "The $15M Line of Credit matures in 47 days. Start the renewal?",
  route: "renew",
  yesLabel: "Start the renewal",
  memberId: "HW1001",
};

function openRouted(opts: {
  question: RouterQuestion | null;
  say?: string | null;
  mode?: WorkroomMode;
  preselectMemberId?: string | null;
}) {
  const bound: Array<{ route: WorkroomMode; memberId?: string | null; say?: string }> = [];
  const restarts: Array<{ route: WorkroomMode; say: string }> = [];
  const context = contextFor(opts.mode ?? "modify");
  // A second room in the same test is a second MOUNT, and `.wk-room` is found
  // in document order — so the previous one has to go, or every query below
  // silently reads the room the test already finished with.
  shut();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Workroom
        context={context}
        engine={createScriptedEngine(context)}
        router={{
          question: opts.question,
          say: opts.say ?? null,
          preselectMemberId: opts.preselectMemberId ?? null,
          onBind: (route, o) => bound.push({ route, memberId: o?.memberId, say: o?.say }),
          onRestart: (route, say) => restarts.push({ route, say }),
        }}
        onClose={() => {}}
      />,
    );
  });
  return { room: document.querySelector<HTMLElement>(".wk-room")!, bound, restarts };
}

const routeChips = (room: HTMLElement) =>
  [...room.querySelectorAll<HTMLButtonElement>(".wk-headline ~ .wk-opts .wk-opt")].map((b) => b.textContent);
const clickChip = (room: HTMLElement, label: string) =>
  click([...room.querySelectorAll<HTMLButtonElement>(".wk-opt")].find((b) => b.textContent === label));

describe("the router — the room's first question", () => {
  it("opens on the deal signal, with the yes and the way out of it", () => {
    const { room } = openRouted({ question: smartAsk(MATURITY_SIGNAL) });
    // The insight is the engine's own sentence and it sits in the greeting slot
    // (rule 30), not in a modal of its own.
    expect(room.querySelector(".wk-headline")!.textContent).toBe(
      "Hey Fabian. The $15M Line of Credit matures in 47 days. Start the renewal?",
    );
    expect(routeChips(room)).toEqual(["Start the renewal", "Something else"]);
    // The room has no mode to name until the banker names one.
    expect(room.querySelector(".wk-title")!.textContent).toBe("Facility Actions");
    expect(room.getAttribute("aria-label")).toBe("Facility Actions");
  });

  it("opens on the neutral three-way when the data made no suggestion", () => {
    const { room } = openRouted({ question: neutralAsk() });
    const headline = room.querySelector(".wk-headline")!.textContent ?? "";
    expect(headline).toBe(
      "Hey Fabian. What are we doing with this relationship - modifying, renewing, or structuring something new?",
    );
    expect(routeChips(room)).toEqual(["Modify", "Renew", "New facility"]);
  });

  it("NEVER fabricates a suggestion: the neutral opening names no facility and no figure", () => {
    // The channel-none doctrine, in the greeting slot. A room with nothing to
    // lead on asks; it does not invent a renewal to propose.
    const { room } = openRouted({ question: neutralAsk() });
    const headline = room.querySelector(".wk-headline")!.textContent ?? "";
    expect(headline).not.toMatch(/\$/);
    expect(headline).not.toMatch(/matures|drawn to|due in/);
    expect(routeChips(room)).not.toContain("Start the renewal");
  });

  it("holds the opening view under sixty words with the question in it (law 3)", () => {
    expect(visibleWords(openRouted({ question: smartAsk(MATURITY_SIGNAL) }).room).length).toBeLessThan(60);
    expect(visibleWords(openRouted({ question: neutralAsk() }).room).length).toBeLessThan(60);
  });

  it("offers no NEXT move while the route is still open", () => {
    // A suggestion pill beside the three chips would be a fourth chip answering
    // a different question.
    const { room } = openRouted({ question: neutralAsk() });
    expect(room.querySelector(".wk-sugg .wk-pill")).toBeNull();
    // And it is there again the moment the route is bound.
    expect(openRouted({ question: null }).room.querySelector(".wk-sugg .wk-pill")).toBeTruthy();
  });

  for (const [label, route] of [
    ["Modify", "modify"],
    ["Renew", "renew"],
    ["New facility", "create"],
  ] as Array<[string, WorkroomMode]>) {
    it(`binds ${route} when the ${label} chip is taken, and the question retires`, () => {
      const { room, bound } = openRouted({ question: neutralAsk() });
      clickChip(room, label);
      expect(bound).toEqual([{ route, memberId: null, say: undefined }]);
      expect(routeChips(room)).toEqual([]);
      // The room states its position again, now that it knows which room it is.
      expect(room.querySelector(".wk-headline")!.textContent).not.toContain("What are we doing");
    });
  }

  it("binds the suggested route AND the facility the insight named", () => {
    const { room, bound } = openRouted({ question: smartAsk(MATURITY_SIGNAL) });
    clickChip(room, "Start the renewal");
    expect(bound).toEqual([{ route: "renew", memberId: "HW1001", say: undefined }]);
  });

  it("falls through to the neutral three-way on Something else, binding nothing", () => {
    const { room, bound } = openRouted({ question: smartAsk(MATURITY_SIGNAL) });
    clickChip(room, "Something else");
    expect(bound).toEqual([]);
    expect(routeChips(room)).toEqual(["Modify", "Renew", "New facility"]);
    expect(room.querySelector(".wk-headline")!.textContent).toContain("What are we doing with this relationship");
  });

  it("binds implicitly on a typed line, and carries the line into the bound room", async () => {
    const { room, bound } = openRouted({ question: smartAsk(MATURITY_SIGNAL) });
    await typeInto(room, "increase the LoC to 20M");
    // The line named a change to what exists, so it is a modification — and it
    // is handed on to be SAID, not echoed and dropped.
    expect(bound).toEqual([{ route: "modify", memberId: undefined, say: "increase the LoC to 20M" }]);
    expect(routeChips(room)).toEqual([]);
  });

  it("says the line the binding carried, through the parser, once the room is bound", async () => {
    // The bound room's own half of the same gesture: the engine hears it.
    const { room } = openRouted({ question: null, say: "increase the liquidity covenant headroom" });
    await settle();
    expect([...room.querySelectorAll(".wk-msg.wk-banker")].map((m) => m.textContent)).toContain(
      "increase the liquidity covenant headroom",
    );
  });

  it("asks again rather than guessing, on a line that names no route", async () => {
    const { room, bound } = openRouted({ question: neutralAsk() });
    await typeInto(room, "who is the relationship manager");
    expect(bound).toEqual([]);
    // The chips are still on screen: the room refused and kept the reason.
    expect(routeChips(room)).toEqual(["Modify", "Renew", "New facility"]);
    expect(room.textContent).toContain("I can take a modification, a renewal or a new facility from here.");
  });

  it("opens the lane on the member the binding preselected", () => {
    const { room } = openRouted({ question: null, preselectMemberId: "HW1001" });
    expect(room.querySelector(".wk-detail .wk-dh")!.textContent).toContain("Revolver");
  });
});

describe("the router — route binding is final per plan", () => {
  it("rebuilds the room on the other route while nothing is staged", async () => {
    const { room, restarts } = openRouted({ question: null });
    await typeInto(room, "actually let's renew instead");
    expect(restarts).toEqual([{ route: "renew", say: "actually let's renew instead" }]);
  });

  it("does NOT reroute on the current route's own grammar", async () => {
    // A modification legitimately says "increase the commitment". Reading that
    // as a request to leave the room would take the banker out mid-sentence.
    const { room, restarts } = openRouted({ question: null });
    await typeInto(room, "increase the commitment to $20M");
    expect(restarts).toEqual([]);
  });

  it("refuses the swap once the manifest holds something, and offers the discard", async () => {
    const { room, restarts } = openRouted({ question: null });
    click(byText(/liquidity covenant/));
    await settle();
    for (const b of buttons().filter((x) => x.textContent === "Confirm")) {
      click(b);
      await settle();
    }
    for (const b of buttons().filter((x) => x.textContent === "Acknowledge")) click(b);
    await settle();
    expect(room.querySelectorAll(".wk-ent").length).toBeGreaterThan(0);

    await typeInto(room, "actually let's renew instead");
    // No silent engine swap: the room says why and puts the discard on the table.
    expect(restarts).toEqual([]);
    expect(room.textContent).toContain("the room is locked to it");
    const discard = [...room.querySelectorAll<HTMLButtonElement>(".wk-opt")].find((b) =>
      /Discard and start the renewal/.test(b.textContent ?? ""),
    )!;
    expect(discard).toBeTruthy();

    click(discard);
    await settle();
    // Taking it is explicit, and it clears the manifest before it rebuilds.
    expect(restarts).toEqual([{ route: "renew", say: "actually let's renew instead" }]);
    expect(room.querySelectorAll(".wk-ent")).toHaveLength(0);
  });
});

describe("the router — the room claims no mode until it has one", () => {
  it("names neither the mode nor the change set while the route is open", () => {
    const { room } = openRouted({ question: neutralAsk() });
    expect(room.querySelector(".wk-title")!.textContent).toBe("Facility Actions");
    // The lane opens bare (founder call 2026-09-01), so an unbound room cannot
    // leak its mode through lane furniture - there is none to read.
    expect(room.querySelector(".wk-kicker")).toBeNull();
    expect(room.querySelector(".wk-col-r")!.getAttribute("aria-label")).toBe("This package");
  });

  it("takes the mode's own words the moment the route is bound", () => {
    const { room } = openRouted({ question: null });
    expect(room.querySelector(".wk-title")!.textContent).toBe("Modification");
    // The mode's words appear in the bar; the lane kicker waits for a confirm.
    expect(room.querySelector(".wk-col-r")!.getAttribute("aria-label")).toBe("This modification");
  });
});

/* =============================================================================
   THE FOUNDER'S LIVE RUN — THE THREE FAILURES, AS REGRESSION FIXTURES.

   Every line the room is given below is the founder's own, verbatim from the
   2026-09-01 session driving the built app. What each one did then:

     "which borrowers have we already in the package?"
        -> the parser's refusal boilerplate, over a bundle holding all 21
           involvements. The canonical demo-loop failure.
     "what covenants are against this Product Package"
        -> field="Product", value="Package" on the Line of Credit, staged as a
           Term change delta. Confidently wrong, which is worse than refusing.
     "package with information and what exisiting covenants do i have against
      this relationship i can use ?"
        -> the same wave, with the ENTIRE fifteen-word tail as the value.

   The human confirm gate held through all three - nothing could be written -
   so what is asserted here is the intelligence, not the safety.
   ============================================================================= */

describe("the founder's live run — a question is never a delta", () => {
  const data = live as unknown as C360Data;
  const accountId = "001bb00001I7FPNAA3";

  function openAsking() {
    const bundle = data.borrowers![accountId];
    const context = workroomContextFor({
      mode: "modify",
      data,
      bundle,
      accountId,
      accountName: bundle.snapshot!.name!, productPackageId: "a5Fbb000000IHFJEA4" });
    shut();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <Workroom
          context={context}
          engine={createModifyEngine({ context, data, bundle })}
          reads={{ bundle, accountName: bundle.snapshot!.name!, productPackageId: context.productPackageId }}
          onClose={() => {}}
        />,
      );
    });
    return document.querySelector<HTMLElement>(".wk-room")!;
  }

  const readCards = () => [...document.querySelectorAll<HTMLElement>(".wk-read")];
  const lastRead = () => readCards()[readCards().length - 1];

  it("answers the borrowers question from the package, and stages nothing", async () => {
    const room = openAsking();
    await settle();
    await typeInto(room, "which borrowers have we already in the package?");
    const card = lastRead();
    expect(card).toBeTruthy();
    expect(card.dataset.topic).toBe("structure");
    // Role-grouped involvements per facility, in the room's own card language.
    expect(card.querySelectorAll(".wk-read-g").length).toBeGreaterThan(0);
    expect(card.querySelectorAll(".wk-read-r").length).toBeGreaterThan(0);
    expect(card.querySelectorAll(".tico").length).toBeGreaterThan(0);
    // The guided follow-up flows into the EXISTING involvement op.
    expect(card.querySelector(".wk-read-next")!.textContent).toMatch(/which facility/i);
    // NOT ONE DELTA, and no refusal boilerplate about members.
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
    expect(room.textContent).not.toMatch(/no member I hold/i);
  });

  it("answers a guarantor question about ONE loan with that loan's guarantors", async () => {
    /* THE 22-ROW BOOK (2026-09-02). The org writes the guaranty once per loan,
       so the pinned read carries 14 guaranty rows over three guarantors. The
       card used to print one line per row grouped by facility; it now prints
       one line per guarantor, and a question that NAMES a loan narrows to it. */
    const room = openAsking();
    await settle();
    await typeInto(room, "who guarantees the construction loan?");
    const card = lastRead();
    expect(card.dataset.topic).toBe("structure");
    const rows = [...card.querySelectorAll<HTMLElement>(".wk-read-r")];
    expect(rows.map((r) => r.textContent)).toHaveLength(3);
    const text = card.textContent ?? "";
    for (const name of ["Hartwell Industrial Holdings LLC", "James Hartwell", "Elena Hartwell"]) {
      expect(text.split(name).length - 1, `${name} once`).toBe(1);
    }
    // The limited guarantor is kept AND labelled: the cap is on the amount.
    expect(text).toContain("Limited Guarantor");
    // The heading names the loan, and the lede counts guarantors, not org rows.
    expect(card.querySelector(".wk-read-g")!.textContent).toContain("Construction");
    expect(card.textContent).toContain("3 guarantors are on the Construction today");
    expect(card.textContent).not.toContain("14 guaranty rows");
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
  });

  it("answers who is on the package with every party once, not 22 org rows", async () => {
    const room = openAsking();
    await settle();
    await typeInto(room, "who is on this package?");
    const card = lastRead();
    expect(card.dataset.topic).toBe("structure");
    expect([...card.querySelectorAll(".wk-read-r")]).toHaveLength(5);
    expect(card.textContent).toContain("5 parties are on this package today");
    // The facility count is the fact six identical lines were standing in for.
    expect(card.textContent).toContain("on 6 facilities");
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
  });

  it("answers the covenants question that used to stage a term change", async () => {
    const room = openAsking();
    await settle();
    await typeInto(room, "what covenants are against this Product Package");
    const card = lastRead();
    expect(card).toBeTruthy();
    expect(card.dataset.topic).toBe("covenants");
    // Thresholds and the org's own verdicts, as a compact card.
    expect(card.textContent).toMatch(/threshold/);
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
    expect(room.textContent).not.toMatch(/Term change/);
    expect(room.querySelectorAll(".wk-ent")).toHaveLength(0);
  });

  it("stages nothing off the fifteen-word tail of the second repro", async () => {
    const room = openAsking();
    await settle();
    await typeInto(
      room,
      "package with information and what exisiting covenants do i have against this relationship i can use ?",
    );
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
    expect(room.querySelectorAll(".wk-ent")).toHaveLength(0);
  });

  it("still parses a real instruction into a proposal", async () => {
    // The guard must not have cost the room its actual job.
    const room = openAsking();
    await settle();
    await typeInto(room, "increase the Line of Credit to $19M");
    expect(room.textContent).toMatch(/Line of Credit/);
    expect(room.querySelectorAll(".wk-read")).toHaveLength(0);
  });

  it("answers a question it cannot read in plain words, naming what it CAN do", async () => {
    const room = openAsking();
    await settle();
    await typeInto(room, "what is the relationship manager's phone number");
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
    const said = room.textContent ?? "";
    expect(said).toMatch(/What I can do is change this package/);
    // Banker language: an example of a line that WOULD work, not parser-speak.
    expect(said).toMatch(/take the Line of Credit to \$19M/);
  });
});

describe("thread compactness — every send collapses what came before", () => {
  const data = live as unknown as C360Data;
  const accountId = "001bb00001I7FPNAA3";

  function openWiredRoom() {
    const bundle = data.borrowers![accountId];
    const context = workroomContextFor({
      mode: "modify",
      data,
      bundle,
      accountId,
      accountName: bundle.snapshot!.name!, productPackageId: "a5Fbb000000IHFJEA4" });
    shut();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <Workroom
          context={context}
          engine={createModifyEngine({ context, data, bundle })}
          reads={{ bundle, accountName: bundle.snapshot!.name!, productPackageId: context.productPackageId }}
          onClose={() => {}}
        />,
      );
    });
    return document.querySelector<HTMLElement>(".wk-room")!;
  }

  const shown = (room: HTMLElement) =>
    [...room.querySelectorAll(".wk-step")].filter((s) => !s.classList.contains("wk-gone"));

  it("shows ONE live exchange, however many reads came before it (rule 31)", async () => {
    const room = openWiredRoom();
    await settle();
    expect(shown(room)).toHaveLength(1);

    await typeInto(room, "which borrowers have we already in the package?");
    expect(shown(room)).toHaveLength(1);
    expect(room.querySelector(".wk-hist")).toBeTruthy();

    await typeInto(room, "what covenants are against this Product Package");
    await typeInto(room, "show me the collateral");
    // Four steps have happened; exactly one of them is on screen, and the chip
    // above it counts the rest.
    expect(room.querySelectorAll(".wk-step").length).toBe(4);
    expect(shown(room)).toHaveLength(1);
    expect(room.querySelector(".wk-hist")!.textContent).toContain("(3)");
  });

  it("opening the history shows every step again, and the top fades", async () => {
    const room = openWiredRoom();
    await settle();
    await typeInto(room, "which borrowers have we already in the package?");
    click(room.querySelector<HTMLButtonElement>(".wk-hist")!);
    expect(shown(room)).toHaveLength(2);
    expect(room.querySelector(".wk-thread")!.classList.contains("wk-masked")).toBe(true);
  });

  it("a REFUSAL never pins the thread, and never blocks the next line", async () => {
    // The compounding bug behind the founder's report: a refusal card counted
    // as an open gate, so it pinned its own step open AND answered every later
    // line with "one decision at a time". A refusal is an answer, not a gate.
    const room = openWiredRoom();
    await settle();
    await typeInto(room, "increase the equipment loan by an amount");
    await typeInto(room, "which borrowers have we already in the package?");
    expect(room.textContent).not.toMatch(/One decision at a time/);
    expect(shown(room)).toHaveLength(1);
  });
});

describe("the strip refuses what the engine would refuse", () => {
  it("renders a non-booked member visible but disabled, with the reason", () => {
    // Hartwell's 7th fixture member is at Proposal. It was selectable, so the
    // room looked as if it could work on a loan it then refused in words.
    const room = open("modify");
    const rows = [...room.querySelectorAll<HTMLButtonElement>(".wk-mchip")];
    expect(rows.length).toBeGreaterThan(1);
    const proposal = rows.find((r) => r.classList.contains("wk-prop"))!;
    expect(proposal).toBeTruthy();
    expect(proposal.disabled).toBe(true);
    expect(proposal.title).toBe("Proposal stage - not modifiable");
    // Every booked member stays live.
    for (const row of rows.filter((r) => !r.classList.contains("wk-prop"))) {
      expect(row.disabled).toBe(false);
    }
  });

  it("takes the eligibility the ENGINE computes when the host hands it down", () => {
    // `eligibleMemberIds` is `bookedFacilities` resolved once where the bundle
    // lives. A member outside it is disabled whatever its own tag says, so the
    // strip and the engine's refusal can never drift apart.
    const context = contextFor("modify");
    shut();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <Workroom
          context={context}
          engine={createScriptedEngine(context)}
          eligibleMemberIds={new Set(["HW1001"])}
          onClose={() => {}}
        />,
      );
    });
    const rows = [...document.querySelectorAll<HTMLButtonElement>(".wk-mchip")];
    expect(rows.filter((r) => !r.disabled)).toHaveLength(1);
    expect(rows.filter((r) => !r.disabled)[0].textContent).toContain("Revolver");
  });
});

describe("the two quiet tiers under the conversation", () => {
  const data = live as unknown as C360Data;
  const accountId = "001bb00001I7FPNAA3";

  function openWithReads(reads: Parameters<typeof Workroom>[0]["reads"]) {
    const bundle = data.borrowers![accountId];
    const context = workroomContextFor({
      mode: "modify",
      data,
      bundle,
      accountId,
      accountName: bundle.snapshot!.name!, productPackageId: "a5Fbb000000IHFJEA4" });
    shut();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <Workroom
          context={context}
          engine={createModifyEngine({ context, data, bundle })}
          reads={reads}
          onClose={() => {}}
        />,
      );
    });
    return document.querySelector<HTMLElement>(".wk-room")!;
  }

  /** The same bundle with one covenant test pushed into the past. */
  function overdueBundle() {
    const bundle = data.borrowers![accountId];
    const covenants = (bundle.covenants?.covenants ?? []).map((c, i) =>
      i === 0 ? { ...c, covenantType: "DSC", nextEvaluationDate: "2026-07-05", latestComplianceStatus: "Exception" } : c,
    );
    return { ...bundle, covenants: { ...bundle.covenants, covenants } };
  }

  it("says an overdue test out loud, which the opener deliberately does not", async () => {
    const bundle = overdueBundle();
    const room = openWithReads({
      bundle,
      accountName: bundle.snapshot!.name!,
      productPackageId: null,
      generatedAt: data.meta!.generatedAt,
    });
    await settle();
    const tip = room.querySelector(".wk-tips .wk-tip")!;
    expect(tip).toBeTruthy();
    expect(tip.querySelector(".wk-tip-l")!.textContent).toMatch(/^The DSC test is \d+ days overdue\.$/);
  });

  /** The same bundle with every covenant test still ahead of the clock. The
   *  baked snapshot carries a late one of its own (Accounts Receivable, 25 days
   *  past due on `meta.generatedAt`), so the quiet case has to be CONSTRUCTED
   *  the way the overdue case above is. A negative test that reads its premise
   *  off whatever the last data bake happened to contain is not testing
   *  anything. */
  function quietBundle() {
    const bundle = data.borrowers![accountId];
    const covenants = (bundle.covenants?.covenants ?? []).map((c) => ({ ...c, nextEvaluationDate: "2027-06-30" }));
    return { ...bundle, covenants: { ...bundle.covenants, covenants } };
  }

  it("renders NOTHING when nothing is overdue and no channel answered", async () => {
    const bundle = quietBundle();
    const room = openWithReads({
      bundle,
      accountName: bundle.snapshot!.name!,
      productPackageId: null,
      generatedAt: data.meta!.generatedAt,
    });
    await settle();
    // No placeholder, no spinner, no empty frame: the block is simply absent.
    expect(room.querySelector(".wk-tips")).toBeNull();
  });

  it("waits for the route: law 3 owns the opening view", async () => {
    const bundle = overdueBundle();
    shut();
    const context = workroomContextFor({
      mode: "modify",
      data,
      bundle,
      accountId,
      accountName: bundle.snapshot!.name!, productPackageId: "a5Fbb000000IHFJEA4" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <Workroom
          context={context}
          engine={createModifyEngine({ context, data, bundle })}
          reads={{
            bundle,
            accountName: bundle.snapshot!.name!,
            productPackageId: null,
            generatedAt: data.meta!.generatedAt,
          }}
          router={{ question: neutralAsk(), say: null, onBind: () => {}, onRestart: () => {} }}
          onClose={() => {}}
        />,
      );
    });
    const room = document.querySelector<HTMLElement>(".wk-room")!;
    await settle();
    // A tip beside three chips answering a different question is the fourth
    // chip rule 30 bans, and the opening view is still under sixty words.
    expect(room.querySelector(".wk-tips")).toBeNull();
    expect(visibleWords(room).length).toBeLessThan(60);
  });
});
