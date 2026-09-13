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
   THE FOUNDER'S OWN LINES, TYPED INTO THE REAL ROOM (IMPROVEMENTS row 44).

   The same eight lines the browser drive types, run against Hartwell's real
   book with no desk behind the room: everything answered here is answered from
   what the room was already holding. On 0.9.22 the first four came back as "I
   could not match that to anything on this package" or went to the desk, and
   the fifth read every facility on the package instead of the two Elena
   Hartwell guarantees.
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
const said = (room: HTMLElement) => [...room.querySelectorAll(".wk-msg")].map((m) => m.textContent ?? "").join(" · ");
const chips = () =>
  [...document.body.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
const DEAD_END = /I could not match that to anything on this package/;

describe("collateral, in the words the founder used", () => {
  it("lands the collateral card for 'show me all my collaterals'", async () => {
    const room = open();
    await settle();
    await typeInto(room, "show me all my collaterals");

    expect(said(room)).not.toMatch(DEAD_END);
    const card = room.querySelector<HTMLElement>('.wk-read[data-topic="collateral"]');
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain("8 pledges are recorded against this package");
  });

  it("lands it for 'show my full collaterals' too", async () => {
    const room = open();
    await settle();
    await typeInto(room, "show my full collaterals");

    expect(said(room)).not.toMatch(DEAD_END);
    expect(room.querySelector('.wk-read[data-topic="collateral"]')).toBeTruthy();
  });
});

describe("the borrowing structure, answered from the book", () => {
  it("answers 'who are the guarantors on this package' with a card, never the desk", async () => {
    const room = open();
    await settle();
    await typeInto(room, "who are the guarantors on this package");

    const card = room.querySelector<HTMLElement>('.wk-read[data-topic="structure"]');
    expect(card).toBeTruthy();
    const text = card!.textContent ?? "";
    expect(text).toContain("3 guarantors are on this package");
    expect(text).toContain("Hartwell Industrial Holdings LLC");
    expect(text).toContain("James Hartwell");
    // A limited guaranty is a guaranty, and the role the org wrote is on the row.
    expect(text).toContain("Limited Guarantor");
  });

  it("narrows 'which entities are on the $15M line of credit' to that facility", async () => {
    const room = open();
    await settle();
    await typeInto(room, "which entities are on the $15M line of credit");

    const card = room.querySelector<HTMLElement>('.wk-read[data-topic="structure"]');
    expect(card).toBeTruthy();
    const text = card!.textContent ?? "";
    expect(text).toContain("the Line of Credit ($15M)");
    expect(text).toContain("Elena Hartwell");
    // The Related Entity sits on the Construction alone, so it is not an answer
    // to a question about the Line of Credit.
    expect(text).not.toContain("Hartwell Logistics LLC");
  });
});

describe("taking a party off a loan", () => {
  it("resolves a first name and asks which of the two loans she is on", async () => {
    const room = open();
    await settle();
    await typeInto(room, "remove Elena from this loan");

    expect(said(room)).not.toMatch(DEAD_END);
    expect(said(room)).toContain("Elena Hartwell is on 2 of these facilities");
    expect(said(room)).toContain("the Line of Credit $15M as Limited Guarantor");
    expect(said(room)).toContain("the Construction $12M as Limited Guarantor");
    expect(chips()).toEqual(expect.arrayContaining(["Line of Credit $15M", "Construction $12M"]));
  });

  it("asks the same question for the full name, and never reads the whole package", async () => {
    const room = open();
    await settle();
    await typeInto(room, "remove Elena Hartwell from this loan");

    expect(said(room)).toContain("Elena Hartwell is on 2 of these facilities");
    // The 0.9.22 reply read every facility on the package back at the banker.
    expect(said(room)).not.toContain("Equipment ($8M)");
    expect(said(room)).not.toContain("and the Purchase");
  });

  it("stages the exclusion on the loan the banker picks, with the role the book holds", async () => {
    const room = open();
    await settle();
    await typeInto(room, "remove Elena Hartwell from this loan");
    await click(lastByText(/^Line of Credit \$15M$/));

    // The shell stamps the book's own role onto the exclusion and says it.
    expect(said(room)).toContain("Elena Hartwell, Limited Guarantor on the $15.0MM Line of Credit");
    await click(lastByText(/^Confirm$/));
    const entries = [...room.querySelectorAll(".wk-ent")].map((e) => e.textContent ?? "").join(" | ");
    expect(entries).toContain("Remove a legal entity");
    expect(entries).toContain("Limited Guarantor, carried over from the parent");
  });

  it("keeps the line that always worked, on that facility alone", async () => {
    const room = open();
    await settle();
    await typeInto(room, "remove Elena Hartwell as guarantor from the 15M line of credit");
    expect(said(room)).toContain("Elena Hartwell");
    await click(lastByText(/^Confirm$/));

    const entries = [...room.querySelectorAll(".wk-ent")].map((e) => e.textContent ?? "");
    // One facility, not both lines of credit: she is on the $15M one alone.
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain("Line of Credit ($15M)");
  });

  it("takes an add on a first name the same way", async () => {
    const room = open();
    await settle();
    await typeInto(room, "add James as guarantor on the 15M line");

    expect(said(room)).not.toMatch(DEAD_END);
    // The first name resolves to the book's own spelling, and the book then
    // answers the ask: he already guarantees that facility, and a modification
    // carries the row onto the clone.
    expect(said(room)).toContain("James Hartwell is already Guarantor on $15.0MM Line of Credit");
    expect(chips()).toEqual(expect.arrayContaining(["Take James Hartwell off that facility"]));
  });
});

describe("the eight lines, end to end", () => {
  it("answers every one of them and never dead-ends", async () => {
    const room = open();
    await settle();
    const LINES = [
      "show me all my collaterals",
      "show my full collaterals",
      "who are the guarantors on this package",
      "which entities are on the $15M line of credit",
      "remove Elena from this loan",
      "remove Elena Hartwell from this loan",
      "remove Elena Hartwell as guarantor from the 15M line of credit",
      "add James as guarantor on the 15M line",
    ];
    for (const line of LINES) {
      await typeInto(room, line);
      const confirm = lastByText(/^Confirm$/);
      if (confirm) await click(confirm);
    }

    const transcript = said(room);
    expect(transcript).not.toMatch(DEAD_END);
    expect(transcript).not.toMatch(/I could not read that answer/);
    expect(transcript).not.toMatch(/—/);
    // Two reads, two structure answers, and the party lines all landed.
    expect(room.querySelectorAll('.wk-read[data-topic="collateral"]').length).toBeGreaterThanOrEqual(2);
    expect(room.querySelectorAll('.wk-read[data-topic="structure"]').length).toBeGreaterThanOrEqual(2);
  });
});
