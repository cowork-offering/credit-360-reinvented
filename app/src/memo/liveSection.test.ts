// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { narrativeBlocks, patchNarratives } from "./liveSection";

/* =============================================================================
   THE WORDS LAND IN THE DOCUMENT THE BANKER IS READING (founder, 2026-09-06).

   What is under test is the seam, not the memo: given the renderer's own output
   for one section, the live document's narrative blocks carry the same prose
   afterwards, the rest of the document is untouched, and a block the banker has
   open in the shell's editor is never overwritten.
   ============================================================================= */

const doc = (html: string): Document => new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

const section = (mod: string, ...blocks: string[]) =>
  `<section data-mod="${mod}"><h2>Title</h2>${blocks
    .map((b) => `<div class="rte-narrative" data-editable>${b}</div>`)
    .join("")}</section>`;

describe("the renderer's own narrative blocks", () => {
  it("lifts them in order, innermost html only", () => {
    expect(narrativeBlocks(section("collateral", "<p>One.</p>", "<p>Two.</p>"))).toEqual(["<p>One.</p>", "<p>Two.</p>"]);
  });

  it("finds none in a module that carries no prose, which is a legitimate answer", () => {
    expect(narrativeBlocks(`<section data-mod="exposure"><table><tr><td>$18M</td></tr></table></section>`)).toEqual([]);
  });
});

describe("patching the live document", () => {
  it("puts the new prose in place and leaves everything else alone", () => {
    const d = doc(section("collateral", "<p>Old.</p>") + section("risk", "<p>Untouched.</p>"));
    expect(patchNarratives(d, "collateral", ["<p>New.</p>"])).toBe(1);
    expect(d.querySelector('section[data-mod="collateral"] .rte-narrative')!.innerHTML).toBe("<p>New.</p>");
    expect(d.querySelector('section[data-mod="risk"] .rte-narrative')!.innerHTML).toBe("<p>Untouched.</p>");
  });

  it("never overwrites a block the banker has open in the shell's editor", () => {
    const d = doc(
      `<section data-mod="collateral"><div class="rte-narrative" contenteditable="true"><p>Mine.</p></div></section>`,
    );
    expect(patchNarratives(d, "collateral", ["<p>Theirs.</p>"])).toBe(0);
    expect(d.querySelector(".rte-narrative")!.innerHTML).toBe("<p>Mine.</p>");
  });

  it("writes nothing when the prose has not moved, so an idle stream costs no DOM", () => {
    const d = doc(section("collateral", "<p>Same.</p>"));
    expect(patchNarratives(d, "collateral", ["<p>Same.</p>"])).toBe(0);
  });

  it("is a no-op on a section this document does not carry, and on a bad id", () => {
    const d = doc(section("collateral", "<p>One.</p>"));
    expect(patchNarratives(d, "not_here", ["<p>x</p>"])).toBe(0);
    expect(patchNarratives(d, 'collateral"] , [data-mod="risk', ["<p>x</p>"])).toBe(0);
    expect(patchNarratives(d, "collateral", [])).toBe(0);
  });

  it("stops at whichever list is shorter, so a half-streamed section patches what it has", () => {
    const d = doc(section("collateral", "<p>One.</p>", "<p>Two.</p>"));
    expect(patchNarratives(d, "collateral", ["<p>First only.</p>"])).toBe(1);
    expect([...d.querySelectorAll(".rte-narrative")].map((n) => n.innerHTML)).toEqual([
      "<p>First only.</p>",
      "<p>Two.</p>",
    ]);
  });
});
