/* =============================================================================
   GOLDEN PARITY — the room shows THE memo, not a memo.

   `src/memo/golden/piedmont-memo.golden.html` is not our output. It is what the
   credit-memo plugin's own harness (`test/build-memo.mjs`) writes when it renders
   the plugin's own Piedmont fixture, captured by `scripts/memo-golden.mjs` from a
   temp copy of the read-only mirror.

   This renders the same fixture through the cockpit's browser entry and asserts
   the two are the same bytes. If that ever fails, the port has started to drift
   from the plugin, and the fix is the port — never the golden.
   ============================================================================= */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderMemo, sectionsFrom, MEMO_SHELL } from "./renderMemo";
import type { MemoDossier } from "./types";

import canonRaw from "./vendor/fixtures/piedmont.json?raw";
import boomRaw from "./vendor/fixtures/boom_spread.json?raw";
import afsRaw from "./vendor/fixtures/piedmont_afs.json?raw";
import icRaw from "./vendor/plugin-assets/ic_placeholder.json?raw";
import peersRaw from "./vendor/plugin-assets/peers_placeholder.json?raw";
import golden from "./golden/piedmont-memo.golden.html?raw";

/** Exactly the five inputs `test/build-memo.mjs` assembles, from the same files. */
const pluginFixtureDossier = (): MemoDossier =>
  ({
    canon: JSON.parse(canonRaw),
    boom: JSON.parse(boomRaw),
    afs: JSON.parse(afsRaw),
    ic: JSON.parse(icRaw),
    peers: JSON.parse(peersRaw),
  }) as MemoDossier;

/**
 * Neutralise the render instant, and nothing else.
 *
 * The renderer stamps a fixed `{{MEMO_DATE}}` today and emits no wall-clock
 * value at all, so this is expected to be a no-op — which the test below
 * ASSERTS, rather than assuming. The moment a generated-at stamp lands in the
 * shell, this keeps parity meaningful instead of turning it red at midnight.
 */
const normaliseGeneratedAt = (html: string): string =>
  html.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "{{GENERATED_AT}}");

describe("golden parity with the credit-memo plugin", () => {
  const { html } = renderMemo(pluginFixtureDossier());

  it("renders the Piedmont fixture byte-for-byte as the plugin's own harness does", () => {
    expect(normaliseGeneratedAt(html)).toBe(normaliseGeneratedAt(golden));
  });

  it("renders deterministically: nothing in the memo body is a wall-clock stamp", () => {
    // If this fails, the normaliser above stopped being a no-op and the parity
    // assertion is now hiding a moving value. Look at what moved.
    expect(normaliseGeneratedAt(html)).toBe(html);
    expect(renderMemo(pluginFixtureDossier()).html).toBe(html);
  });

  it("carries the plugin's shell, unfilled placeholders and all", () => {
    expect(MEMO_SHELL).toContain("{{MODULES}}");
    expect(MEMO_SHELL).toContain("{{TOC}}");
    // …and the rendered memo has none of them left.
    expect(html).not.toContain("{{");
  });

  it("splits into the same sections the golden carries, in document order", () => {
    const ours = sectionsFrom(html);
    const theirs = sectionsFrom(golden);
    expect(ours.map((s) => s.id)).toEqual(theirs.map((s) => s.id));
    expect(ours.map((s) => s.html)).toEqual(theirs.map((s) => s.html));
    // Every section is a manifest module id, and the shell chrome (cover, TOC)
    // is correctly absent: it carries no data-mod anchor and is not attestable.
    expect(ours.length).toBeGreaterThan(5);
    expect(ours.map((s) => s.id)).toContain("executive_summary");
    expect(ours.map((s) => s.id)).not.toContain("table_of_contents");
    expect(ours.every((s) => s.html.startsWith("<section class=\"page\"") && s.html.endsWith("</section>"))).toBe(true);
  });
});

describe("the vendored copy is upstream's, unedited", () => {
  it("passes the drift check over every vendored file and the derived browser copy", () => {
    const app = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    // Throws (non-zero exit) on any missing, extra, changed or re-derived file.
    const out = execFileSync(process.execPath, [join(app, "scripts", "memo-vendor-check.mjs")], { encoding: "utf8" });
    expect(out).toContain("memo vendor clean");
  });
});
