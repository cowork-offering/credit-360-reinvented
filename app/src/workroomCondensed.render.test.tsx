// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom } from "./components/workroom/Workroom";
import { clearComposed } from "./workroom/engine";
import { createModifyEngine } from "./workroom/modifyEngine";
import { workroomContextFor } from "./workroom/openWorkroom";
import type { C360Data } from "./data/contract";
import live from "../../artifact/live-data.json";

/* =============================================================================
   THE FACILITY ROOM, CONDENSED (founder, 2026-09-13, bucket bug-1789294443785).

   "the chips with earlier read etc etc. they basically pile up so that the
   answer is always directly above the chat, as mentioned i wanted to have it
   that only the current action is nicely shown in the chat you know what i mean?
   (likely in all workrooms)".

   The modification room was the room they said it about, on the transcript
   below: raise the $15M line by $20M, answer the amortisation term, answer the
   first payment date, hold the rate. Four decisions, and by the fourth the glass
   carried four chip rows nobody could press again, four receipts and the live
   question pinned to the bottom edge of the column.

   WHAT IS ASSERTED IS THE GLASS, NOT THE RECORD. Each answered turn is one line
   in the room's own settled register, the spent chip rows are off the glass and
   still in the document, the turn the banker is in renders exactly as it always
   did, and the feedback transcript still carries every turn of the conversation.
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
/** The artifact's own instant, so every month the room offers is deterministic. */
const GENERATED_AT = "2026-07-25T21:04:49Z";

function open(): HTMLElement {
  const bundle = data.borrowers![accountId];
  const context = workroomContextFor({
    mode: "modify",
    data,
    bundle,
    accountId,
    accountName: bundle.snapshot!.name!,
    productPackageId: "a5Fbb000000IHFJEA4",
  });
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
          productPackageId: context.productPackageId,
          generatedAt: GENERATED_AT,
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

const lastByText = (re: RegExp) =>
  [...document.body.querySelectorAll("button")].reverse().find((b) => re.test((b.textContent ?? "").trim()));

const click = async (el: Element | undefined) => {
  act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  for (let i = 0; i < 8; i += 1) await settle();
};

/** Increase by $20M, answer the term, answer the date, hold the rate. The exact
 *  four moves of the founder's transcript, on the facility it names. */
async function theTranscript(room: HTMLElement) {
  await typeInto(room, "Increase the 15M line of credit by 20M USD");
  await click(lastByText(/^Confirm$/));
  await click(lastByText(/^Acknowledge$/));
  await click(lastByText(/^240 months$/));
  await click(lastByText(/^Confirm$/));
  await click(lastByText(/^1 September 2026$/));
  await click(lastByText(/^Confirm$/));
  await click(lastByText(/^Hold 6\.58%$/));
}

/** The recap lines on the glass, in order, as the banker reads them. */
const recaps = (room: HTMLElement) =>
  [...room.querySelectorAll("[data-recap]")].map((n) => (n.textContent ?? "").trim());

/** The step the banker is in: the one the room has not collapsed behind it. */
const liveStep = (room: HTMLElement) =>
  [...room.querySelectorAll<HTMLElement>(".wk-step")].filter((s) => !s.classList.contains("wk-gone")).at(-1)!;

describe("the answered turns condense, the live one does not", () => {
  it("says the amount, the term and the first payment back as one line each", async () => {
    const room = open();
    await settle();
    await theTranscript(room);

    const lines = recaps(room);
    expect(lines).toHaveLength(3);
    // The banker's own recap: the field, the move, and how it ended.
    expect(lines[0]).toContain("Commitment amount");
    expect(lines[0]).toContain("$15M → $35M");
    expect(lines[0]).toContain("confirmed");
    expect(lines[1]).toContain("Amortisation term");
    expect(lines[1]).toContain("240 months");
    expect(lines[2]).toContain("First payment date");
    expect(lines[2]).toContain("Sep 1, 2026");
    // One line each, not a paragraph each: no recap runs past a clause.
    for (const line of lines) expect(line.split("·").every((c) => c.trim().length <= 80)).toBe(true);
  });

  it("takes every spent chip row off the glass, and leaves none of them in reach", async () => {
    const room = open();
    await settle();
    await theTranscript(room);

    // Three decisions were confirmed, so three chip rows became their own
    // receipt and none of them can be pressed again.
    const spent = [...room.querySelectorAll<HTMLElement>("[data-spent]")];
    expect(spent).toHaveLength(3);
    // OFF THE GLASS, BY THE ROOM'S OWN GRAMMAR. `.wk-ex[data-spent]` is what
    // recap.css hides, so the marker has to land on the exchange wrapper.
    for (const node of spent) expect(node.classList.contains("wk-ex")).toBe(true);
    // Every confirmed receipt is inside one of them: nothing that says "in the
    // manifest" is still stacked above the composer.
    const receipts = [...room.querySelectorAll<HTMLElement>(".wk-receipt")];
    expect(receipts.length).toBeGreaterThan(0);
    for (const receipt of receipts) expect(receipt.closest("[data-spent]")).toBeTruthy();
    // And nothing the banker still has to press was hidden with them.
    const pressable = [...room.querySelectorAll("button")].filter((b) =>
      /^(Confirm|Discard|Acknowledge)$/.test((b.textContent ?? "").trim()),
    );
    for (const b of pressable) expect(b.closest("[data-spent]")).toBeNull();
  });

  it("renders the live turn exactly as it always did", async () => {
    const room = open();
    await settle();
    await theTranscript(room);

    const live = liveStep(room);
    expect(live.querySelector("[data-recap-line]")).toBeNull();
    expect(live.querySelector("[data-spent]")).toBeNull();
    expect(live.textContent).toContain("The $15.0MM Line of Credit keeps 6.58%");
    expect(live.textContent).toContain("Review & execute");
  });

  it("keeps the feedback transcript complete, turn for turn", async () => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied = text;
        },
      },
    });
    const room = open();
    await settle();
    await theTranscript(room);

    await click(room.querySelector(".bugcopy")!);
    await click(document.querySelector(".bugsheet-cat")!);
    await click(document.querySelector(".bugsheet-send")!);

    // NOTHING IS LOST TO THE GLASS. The condensation decides what SHOWS; the
    // record the founder pastes back to us is still the whole conversation.
    for (const said of [
      "Increase the 15M line of credit by 20M USD",
      "240 months",
      "1 September 2026",
      "Hold 6.58%",
    ]) {
      expect(copied).toContain(said);
    }
    expect(copied).toContain("keeps 6.58%");
  });
});
