// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom } from "./components/workroom/Workroom";
import { clearComposed, createScriptedEngine, type WorkroomEngine } from "./workroom/engine";
import { doorFor } from "./workroom/modes";
import type { WorkroomContext, WorkroomExecution } from "./workroom/types";
import { FILED_LIST_MS, FILED_ROW_MS, FILED_ROW_STAGGER_MS, filedRowAt } from "./components/workroom/FiledList";

/* =============================================================================
   THE FILED FINALE (founder, 2026-09-03).

   "When the modification is done, can we gently and elegantly clean up the room,
   a cinematic kind of creation success with that card. Right now the room stays
   like nothing happened."

   WHAT IS UNDER TEST IS THE ROOM AFTER THE FILING, and nothing about the filing
   itself: the dossier's content, its link, its handoffs and the trail write are
   held by ncinoLinks and workroom.render, and they are unchanged. This holds the
   four claims the finale makes.

     1  everything that is not the card leaves the stage, and stays mounted
     2  the card is the only thing left, with its real rows, in a centred pane
     3  the rail says one line, and the record ids it drained are still readable
     4  the afterglow offers the card's own door, and the room stays alive

   JSDOM IS THE REDUCED-MOTION PATH. There is no matchMedia here, so
   `prefersReducedMotion` is true and the finale lands on `still` in the same
   commit as the filing - which is exactly the contract for a reader who asked
   for no animation, and is asserted as such rather than worked around.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const INSTANCE = "https://bankinggpt.lightning.force.com";
const ACCOUNT_ID = "001bb00001I7FPNAA3";
const PACKAGE_ID = "a5Fbb000000IHFJEA4";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let closed = 0;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  closed = 0;
  document.body.className = "";
  clearComposed();
});

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const buttons = () => [...document.body.querySelectorAll("button")];
const byText = (re: RegExp) => buttons().find((b) => re.test(b.textContent ?? ""));
const click = (el: Element | undefined) => act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

/** Drive the scripted room all the way to the dossier, the way a banker does.
 *  `bend` re-shapes the storyline engine where a case needs a plan the drive
 *  does not produce on its own: an entry the ROOM added, or a filing the org
 *  only half took. */
async function fileAPlan(bend?: (engine: WorkroomEngine) => WorkroomEngine) {
  const context: WorkroomContext = {
    mode: "modify",
    door: doorFor("modify", PACKAGE_ID),
    accountId: ACCOUNT_ID,
    accountName: "Hartwell Precision Manufacturing LLC",
    productPackageId: PACKAGE_ID,
    packageName: "Hartwell Industrial C&I Credit Package",
    approver: "fabian.goetzens@accenture.com.bankinggpt",
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <Workroom
        context={context}
        engine={(bend ?? ((e: WorkroomEngine) => e))(createScriptedEngine(context))}
        instanceUrl={INSTANCE}
        onClose={() => {
          closed += 1;
        }}
      />,
    ),
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
  /* WHAT THE ROOM IS HOLDING BEFORE THE FILING. The count is the evidence the
     finale is a change and not a coincidence: these are the items that have to
     leave. */
  const before = room.querySelectorAll("[data-ex-id]").length;
  click(room.querySelector<HTMLButtonElement>(".wk-propose")!);
  await settle();
  /* WHAT THE GLASS LOOKS LIKE WHILE THE PLAN IS STILL OPEN: the rail is
     carrying the ledger and the card does not exist yet. */
  const staged = { sections: room.querySelectorAll(".rc-fl").length, rail: room.querySelectorAll(".wk-ent").length };
  click(byText(/^Approve and file /));
  await settle();
  return { room, before, staged };
}

/** The second entry, stamped as one the ROOM added rather than the banker. The
 *  storyline engine composes no `wire`, so the pricing gate's own rule can
 *  never fire here; `derivedReason` is `derivedDelta.ts`'s documented escape
 *  hatch and it is what a real derived entry reaches the rail as. */
const withADerivedEntry = (engine: WorkroomEngine): WorkroomEngine => ({
  ...engine,
  parseIntent: async (text, context) => {
    const out = await engine.parseIntent(text, context);
    if (out.kind !== "deltas") return out;
    return {
      ...out,
      deltas: out.deltas.map((d, i) => (i === 1 ? { ...d, derivedReason: "The room added this so the plan can be priced." } : d)),
    };
  },
});

/** The org took the first entry and handed the second back. */
const withAHandoff = (engine: WorkroomEngine): WorkroomEngine => ({
  ...engine,
  execute: async (approval) => {
    const out: WorkroomExecution = await engine.execute(approval);
    const [kept, off] = out.filed;
    return {
      ...out,
      filed: [kept],
      handoffs: [{ deltaId: off.deltaId, title: "the second change", reason: "No deployed tool files this one." }],
    };
  },
});

/** Everything the reader can still meet in the thread. */
const onStage = (room: HTMLElement) => [...room.querySelectorAll("[data-ex-id]:not([data-finale])")];
const drained = (room: HTMLElement) => [...room.querySelectorAll('[data-ex-id][data-finale="gone"]')];

describe("the room exhales when the card lands", () => {
  it("takes every item that is not the filing's own output off the stage", async () => {
    const { room, before } = await fileAPlan();
    expect(before).toBeGreaterThan(3);

    /* THE COUNT. What is left on stage is the dossier, alone (founder,
       2026-09-03, second pass): the drafted reply drains with the rest. */
    const left = onStage(room);
    expect(left).toHaveLength(1);
    expect(left[0].querySelector(".wk-rescard")).toBeTruthy();

    // And everything the room WAS holding went, rather than simply never having
    // been there: the one on stage is new, appended by the filing itself.
    expect(drained(room).length).toBeGreaterThanOrEqual(before);
    for (const gone of drained(room)) expect(gone.getAttribute("aria-hidden")).toBe("true");
  });

  it("drains the tiers with the exchanges, and keeps them all mounted", async () => {
    const { room } = await fileAPlan();
    // The greeting, the package and the facilities: tiers have their own
    // wrapper and the finale rides it rather than adding a second one.
    const tiers = [...room.querySelectorAll('[data-tier][data-finale="gone"]')];
    expect(tiers.length).toBeGreaterThan(0);
    /* NOTHING IS UNMOUNTED. The settle machinery's contract is that an absence
       test can tell "left the stage" from "never happened", and the finale does
       not get to break it: every drained node is still in the document. */
    for (const gone of drained(room)) expect(gone.isConnected).toBe(true);
  });
});

describe("the card ascends alone", () => {
  it("is the star of a centred pane, with the rows the filing actually wrote", async () => {
    const { room } = await fileAPlan();
    const card = room.querySelector(".wk-rescard")!;
    expect(card).toBeTruthy();
    /* ONE ROW PER CHANGE THAT ACTUALLY FILED, off the real manifest. Read
       against the rail's own cards rather than against a hard number, so the
       claim is "the card still says what filed" and not "the drive stages two". */
    expect(card.querySelectorAll(".rc-r")).toHaveLength(room.querySelectorAll(".wk-ent").length);
    expect(card.querySelector(".rc-f")!.textContent!.length).toBeGreaterThan(0);
    // The pane centres what is left, and the card's own wrapper is the star.
    expect(room.querySelector(".wk-thread")!.getAttribute("data-finale")).toBe("still");
    expect(card.closest("[data-finale-card]")).toBeTruthy();
  });

  it("lands instantly under reduced motion: no drain beat, no sweep, no offset", async () => {
    const { room } = await fileAPlan();
    /* NOTHING IS MID-EXIT. The finale skipped the middle beat entirely, so no
       node ever carried the sinking state and the card waits for nothing. */
    expect(room.querySelector('[data-finale="exhale"]')).toBeNull();
    const star = room.querySelector<HTMLElement>("[data-finale-card]")!;
    expect(star.style.getPropertyValue("--wk-fin-hold")).toBe("0ms");
    // The paced reveal starts where it always did rather than after a drain.
    const header = room.querySelector<HTMLElement>(".wk-rescard .rc-h")!;
    expect(header.style.animationDelay).toBe("140ms");
  });
});

describe("the rail is filed too", () => {
  it("wipes as a whole and takes its staged cards off the stage", async () => {
    const { room } = await fileAPlan();
    expect(room.querySelector(".wk-col-r")!.getAttribute("data-finale")).toBe("still");

    const cards = [...room.querySelectorAll(".wk-ent")];
    expect(cards.length).toBe(2);
    for (const card of cards) expect(card.getAttribute("data-finale")).toBe("gone");

    /* AND THE PROOF SURVIVES THE DRAIN. Each card carries the org record id that
       verifies its write; the room being finished with them does not make them
       untrue, so they go off stage and stay readable. */
    const ids = [...room.querySelectorAll(".wk-filedbar .wk-id")].map((n) => n.textContent);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(id!.length).toBeGreaterThan(0);
  });
});

/* =============================================================================
   THE CLEAN SHEET (founder, 2026-09-06).

   "I liked the rainbow card morphing into this but I need a clean room at the
   end when it's done with a clean Summary screen."

   THE AFTERGLOW IS GONE and its two doors are on the sheet, which is the surface
   they belong to. What is under test is that the card GROWS into that sheet: the
   card goes off stage, the sheet is the room, and every figure on it is one the
   room already held rather than one it went and read.

   jsdom is the reduced-motion path (there is no matchMedia here), so the morph
   lands in one commit - which is exactly its contract for a reader who asked for
   no animation, and is asserted as such rather than worked around.
   ============================================================================= */

const sheetOf = (room: HTMLElement) => room.querySelector<HTMLElement>(".wk-sheet")!;

describe("the card becomes the sheet", () => {
  it("takes the card off stage and stands the summary in its place", async () => {
    const { room } = await fileAPlan();
    const sheet = sheetOf(room);
    expect(sheet).toBeTruthy();
    // The card is off stage and still mounted: the drain's own contract.
    expect(room.querySelector("[data-finale-card]")!.getAttribute("data-morph")).toBe("gone");
    // NO BUTTON EVER SITS ON THE CARD. The doors are the sheet's.
    expect(room.querySelector(".wk-rescard")!.querySelector("button")).toBeNull();
    expect(room.querySelector(".wk-afterglow")).toBeNull();
    /* NO MORPH STATE UNDER REDUCED MOTION. The sheet simply is, so nothing is
       ever measured and no growth keyframe can be left half-run. */
    expect(sheet.getAttribute("data-morph")).toBeNull();
  });

  it("keeps the card's own step on the glass, which is what the morph measures", async () => {
    const { room } = await fileAPlan();
    /* THE CARD IS NOT A DIRECT CHILD OF THE THREAD. It sits inside its step, and
       the finale's "still" rule hides every direct child that is not the card -
       so it was hiding the step holding it, and the room's ending was laying
       itself out over nothing on any conversation with two steps. A FLIP cannot
       measure a `display: none` box, which is how it was finally caught. */
    const star = room.querySelector("[data-finale-card]")!;
    const step = star.parentElement!;
    expect(step.classList.contains("wk-step")).toBe(true);
    expect(step.hasAttribute("data-star")).toBe(true);
    // And no other step claims it.
    expect(room.querySelectorAll("[data-star]")).toHaveLength(1);
  });

  it("names what was filed, on which version, and when, in the mode's own words", async () => {
    const { room } = await fileAPlan();
    const title = sheetOf(room).querySelector(".wk-sheet-t")!.textContent!;
    // A modification is FILED ON the relationship and the package it filed against.
    expect(title).toMatch(/^Filed on Hartwell Precision Manufacturing LLC, Hartwell Industrial C&I Credit Package/);
    // The stamp is a clock and the banker in the seat, and nothing else.
    expect(sheetOf(room).querySelector(".wk-sheet-s")!.textContent).toMatch(
      /^\d\d:\d\d, by fabian\.goetzens@accenture\.com\.bankinggpt$/,
    );
  });

  it("states exposure before and after, and says the delta is pending until the org confirms", async () => {
    const { room } = await fileAPlan();
    const block = sheetOf(room).querySelector('[data-block="exposure"]')!;
    expect(block.querySelector(".wk-sheet-was")!.textContent).toMatch(/^\$\d+\.\dM$/);
    expect(block.querySelector(".wk-sheet-now")!.textContent).toMatch(/^\$\d+\.\dM$/);
    /* PRO FORMA UNTIL THE ORG SAYS OTHERWISE. The figure is the room's own
       arithmetic over the manifest, so the word rides it rather than the room
       claiming a read it has not made. */
    const delta = block.querySelector(".wk-sheet-d")!;
    expect(delta.textContent).toMatch(/pending$/);
    expect(delta.hasAttribute("data-pending")).toBe(true);
    /* AND NO LINE ABOUT A MISSED CONFIRMATION. A scripted room has no staging
       record to read, so no deadline was ever set and none was missed. */
    expect(block.querySelector(".wk-sheet-note")).toBeNull();
  });

  it("offers two doors and no others, named after the relationship", async () => {
    const { room } = await fileAPlan();
    const doors = [...sheetOf(room).querySelectorAll(".wk-sheet-acts button")];
    /* ONE DOOR WITHOUT A MEMO IN THE VIEW. `onDraftMemo` is the host's, and a
       room mounted without it offers the way back and nothing hollow. */
    expect(doors.map((b) => b.textContent)).toEqual(["Back to Hartwell Precision Manufacturing LLC"]);
    click(doors[0]);
    expect(closed).toBe(1);
  });

  it("never spins: the sheet is whole on the commit that lands it", async () => {
    const { room } = await fileAPlan();
    const sheet = sheetOf(room);
    expect(sheet.querySelectorAll(".wk-loadchip, .wk-compose, .goo").length).toBe(0);
    expect(sheet.textContent).not.toMatch(/Working|Loading|…$/);
  });

  it("takes the composer and the rail off the glass with everything else", async () => {
    const { room } = await fileAPlan();
    expect(room.querySelector(".wk-composer")!.hasAttribute("hidden")).toBe(true);
    expect(room.querySelector(".wk-col-r")!.getAttribute("data-finale")).toBe("still");
    expect((room.matches(".wk-room") ? room : room.querySelector(".wk-room")!).getAttribute("data-finale")).toBe("still");
    expect(room.textContent).not.toContain("The workroom holds");
  });
});

/* =============================================================================
   WHAT WAS FILED, ON THE CARD (founder, 2026-09-04).

   "The cinematic closing with the button, please include the card with WHAT HAS
   BEEN GENERATED as well; cinematic, elegant."

   THE RAIL WAS THE ONLY SURFACE THAT LISTED THE WRITES with the org record ids
   that prove them, and beat one wipes it. What is under test is that the card
   left standing carries that ledger: the same entries, in the same order, with
   the same ids, the same Derived badges and the same counts the rail head had.
   ============================================================================= */

const ledgerRows = (room: HTMLElement) => [...room.querySelectorAll(".wk-rescard .rc-fl-r")];

describe("the card carries what was filed", () => {
  it("lists exactly the rail's entries, in rail order, with the ids the rail showed", async () => {
    const { room } = await fileAPlan();
    const rail = [...room.querySelectorAll(".wk-ent")];
    const rows = ledgerRows(room);
    expect(rows).toHaveLength(rail.length);

    // SAME ROWS, SAME ORDER. Read against the rail rather than a hard list, so
    // the claim is "the card says what the rail said" and not "the drive stages
    // these two".
    expect(rows.map((r) => r.querySelector(".rc-fl-l b")!.textContent)).toEqual(
      rail.map((e) => e.querySelector(".wk-ent-t b")!.firstChild!.textContent),
    );
    // AND THE PROOF TRAVELS WITH THEM: the org record id per row, the same id
    // the drained rail card is still carrying off stage.
    expect(rows.map((r) => r.querySelector(".rc-fl-id")!.textContent)).toEqual(
      rail.map((e) => e.querySelector(".wk-filedbar .wk-id")!.textContent),
    );
    // The target and the delta ride each row too: a ledger with neither is a
    // list of titles.
    expect(rows[0].querySelector(".rc-fl-tg")!.textContent!.length).toBeGreaterThan(0);
    expect(rows[0].querySelector(".rc-fl-was")!.textContent).toBe("$15,000,000");
    expect(rows[0].querySelector(".rc-fl-now")!.textContent).toBe("$18,000,000");
  });

  it("counts the set in its head, and badges only the entries the room added", async () => {
    const { room } = await fileAPlan(withADerivedEntry);
    expect(room.querySelector(".wk-rescard .rc-fl-n")!.textContent).toBe("2 changes · 1 requested · 1 derived");

    const rows = ledgerRows(room);
    const badged = rows.filter((r) => r.querySelector(".wk-derived"));
    expect(badged).toHaveLength(1);
    // The badged row is the SECOND one, which is the entry the bend marked, and
    // it is the same row the rail badged.
    expect(rows.indexOf(badged[0])).toBe(1);
    expect([...room.querySelectorAll(".wk-ent")][1].querySelector(".wk-derived")).toBeTruthy();
  });

  it("reads a plain count where nothing on the plan was derived", async () => {
    const { room } = await fileAPlan();
    expect(room.querySelector(".wk-rescard .rc-fl-n")!.textContent).toBe("2 changes");
    expect(room.querySelector(".wk-rescard .wk-derived")).toBeNull();
  });

  it("names the handoff where the org wrote no record, rather than leaving a blank", async () => {
    const { room } = await fileAPlan(withAHandoff);
    const rows = ledgerRows(room);
    // BOTH ENTRIES ARE STILL LISTED. What the room staged is the ledger; what
    // the org took is what the id column says.
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".rc-fl-id")).toBeTruthy();
    expect(rows[1].querySelector(".rc-fl-id")).toBeNull();
    expect(rows[1].querySelector(".rc-fl-off")!.textContent).toBe("Handed off");
    expect(rows[1].querySelector(".rc-fl-off")!.getAttribute("title")).toBe("No deployed tool files this one.");
  });

  it("is absent while the room is still open, because the rail is saying it", async () => {
    const { room, staged } = await fileAPlan();
    /* THE LEDGER IS ON THE GLASS EXACTLY ONCE AT EVERY MOMENT. While the plan
       was open the rail was carrying it and the card did not exist. */
    expect(staged.rail).toBe(2);
    expect(staged.sections).toBe(0);
    /* AND AFTER THE FILING IT IS ON THE GLASS EXACTLY ONCE. The card carries it
       too - it is what the card grew FROM - and the card is off stage by the time
       the sheet is the room, so the reader meets the ledger once. */
    const sections = [...room.querySelectorAll(".rc-fl")];
    expect(sections).toHaveLength(2);
    expect(sections[0].closest(".wk-rescard")).toBeTruthy();
    expect(sections[0].closest("[data-finale-card]")!.getAttribute("data-morph")).toBe("gone");
    expect(sections[1].closest(".wk-sheet")).toBeTruthy();
  });

  it("reveals the rows after the card's own reveal, 60ms apart, inside 1.2s", async () => {
    const { room } = await fileAPlan();
    const at = (el: Element) => Number.parseInt((el as HTMLElement).style.animationDelay, 10);
    const card = room.querySelector(".wk-rescard")!;
    // The card's last beat: the footer's check. The head comes after it.
    const check = at(card.querySelector(".rc-f .ok")!);
    const head = at(card.querySelector(".rc-fl-h")!);
    expect(head).toBeGreaterThan(check);

    const rows = ledgerRows(room).map(at);
    expect(rows[1] - rows[0]).toBe(FILED_ROW_STAGGER_MS);
    // The whole list, head to the last row finishing, inside the founder's 1.2s.
    expect(rows[rows.length - 1] + FILED_ROW_MS - head).toBeLessThanOrEqual(FILED_LIST_MS);
    /* AND THE CAP HOLDS FOR A PLAN THIS DRIVE CANNOT STAGE. Twenty entries
       would be a 1.2s wave of their own; past the cap the rows share the last
       beat, so the budget is a promise and not a coincidence of this plan. */
    expect(filedRowAt(200) + FILED_ROW_MS).toBeLessThanOrEqual(FILED_LIST_MS);
  });
});
