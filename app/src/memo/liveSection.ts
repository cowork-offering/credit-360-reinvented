/* =============================================================================
   THE WORDS LAND IN THE DOCUMENT THE BANKER IS READING.

   FOUNDER, 2026-09-06: "all super super gentle, no hangers, I hate when it gets
   stuck, so we need to ensure it's all fluid."

   THE PANE USED TO REBUILD THE WHOLE MEMO PER CHUNK. Every few hundred
   milliseconds of a streaming section, the room rendered the entire document,
   wrapped it in the review shell, wrote it into the hidden frame and waited for
   the browser to parse a long page with its own stylesheet - and then crossfaded
   to it. Seven sections is thirty of those, on the same main thread the composer
   types into, and it is the single most expensive thing the room does.

   IT DOES NOT HAVE TO. While ONE section is being written, the only thing that
   changes in the document is that section's own narrative blocks. So the room
   patches them, in place, in the live frame: no reload, no parse, no swap, no
   reader losing their place. The full rebuild happens ONCE per section, at its
   end, through the double buffer exactly as before - which is what keeps the
   stored, published and attested memo the renderer's own output and never
   something this file assembled.

   THE SEAM IS A `Document` AND NOTHING ELSE, for the same reason
   `reviewBridge.ts` and `writingMark.ts` take one: the frame is same-origin by
   construction (srcdoc), and a function that takes a document can be driven in
   jsdom, where a srcdoc frame never loads at all.

   IT NEVER TOUCHES A BLOCK THE BANKER IS IN. A section can be edited while a
   LATER one is being written; a patch that overwrote an open editor would throw
   away words a person typed, which is the one failure here that cannot be undone.
   ============================================================================= */

/** A module id, as the manifest writes them. Anything else is not a selector. */
const MOD_ID = /^[A-Za-z0-9_-]+$/;

/* THE VENDOR'S OWN REGEX, DELIBERATELY. `render-memo.mjs` extracts narrative
   blocks with exactly this pattern when it builds the nCino RTE field, so the
   blocks this reads and the blocks the renderer considers narrative are the same
   blocks by construction. It is non-greedy to the first `</div>`, which is
   correct for the renderer's own output: a narrative block carries prose, not
   nested markup. */
const NARRATIVE = /<div class="rte-narrative"[^>]*>([\s\S]*?)<\/div>/g;

/** The narrative blocks of one rendered section, innermost html, in order. */
export function narrativeBlocks(sectionHtml: string): string[] {
  const out: string[] = [];
  NARRATIVE.lastIndex = 0;
  for (let m = NARRATIVE.exec(sectionHtml); m; m = NARRATIVE.exec(sectionHtml)) out.push(m[1]);
  return out;
}

/**
 * Put those blocks into the live document's own section, in place.
 *
 * BY POSITION, WHICH IS THE ONLY KEY THERE IS. The renderer emits narrative
 * blocks in a fixed order per module and carries no key on them, so the nth
 * block of the rendered section is the nth block of the live one. The section is
 * the same section: same module, same renderer, same plan.
 *
 * @returns how many blocks were written. Zero is a legitimate answer - the
 *          section is not in this document, or every block of it is being edited
 *          - and the caller treats it as "nothing to show yet", never an error.
 */
export function patchNarratives(doc: Document, modId: string, blocks: readonly string[]): number {
  if (!MOD_ID.test(modId) || !blocks.length) return 0;
  const section = doc.querySelector(`section[data-mod="${modId}"]`);
  if (!section) return 0;
  const live = section.querySelectorAll(".rte-narrative");
  let written = 0;
  for (let i = 0; i < live.length && i < blocks.length; i++) {
    const block = live[i];
    // THE BANKER'S OWN EDITOR IS NEVER STOMPED. The shell turns a block into a
    // live editor by making it contenteditable; anything inside one of those is
    // words a person is typing.
    if (block.closest("[contenteditable]") || block.hasAttribute("contenteditable")) continue;
    if (block.innerHTML === blocks[i]) continue;
    block.innerHTML = blocks[i];
    written += 1;
  }
  return written;
}
