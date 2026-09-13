// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import live from "../../artifact/live-data.json";
import CSV from "../../design/probes/fixtures/piedmont-fy2025.csv?raw";
import { FinancialsTab } from "./components/tabs/FinancialsTab";
import { AppProvider } from "./state/appState";
import { fmtRatio } from "./data/finance";
import { buildMemoDossier } from "./memo/dossier";
import { statementsFromPreRead } from "./channel/boomUpload";
import { extractDocument } from "./spread/extract";
import { deterministicPreRead, type RelationshipSpreadContext } from "./spread/preRead";
import { figuresFromSpread } from "./spread/postRead";
import { onFileBoomFigures, provisionalRead } from "./spread/provisional";
import { publishSpread } from "./spread/publishSpread";
import { mergeFigures } from "./workroom/spreadEngine";
import type { BorrowerBundle, C360Data } from "./data/contract";
import type { DroppedFile } from "./spread/types";

/* =============================================================================
   ONE RATIO, ONE FIGURE, THREE SURFACES.

   FOUNDER REVIEW, 2026-09-13, on the built page (`design/probes/spread-e2e.mjs
   app/dist/cockpit.html pdf`): the fixture spread landed on Hartwell and the
   Spreading room's result panel printed "Interest coverage 3.09×" while the
   Financials tab's Key ratios printed "Interest coverage 2.95×" for the same
   provisional period. Revenue, EBITDA, the margin and leverage agreed; only the
   coverage did not. The room reads the drop; the tab and the memo read
   `bundle.boom.ratios`, and `publishSpread` carried that through untouched from
   the period before the drop.

   THE STANDING RULE IS THAT ONE RATIO HAS ONE DEFINITION ON THE PAGE, so this
   test takes the real Hartwell bundle out of `artifact/live-data.json` and the
   probe's own fixture off disk, runs the deterministic pre-read over it, builds
   the spread the stub hands back, lands it on the book, and holds the three
   surfaces that print interest coverage to one figure:

     the Spreading room's panel   `mergeFigures(...).coverage` through fmtRatio,
                                  which is spreadEngine.ts's own expression and
                                  SpreadingRoom.tsx's own formatter
     the Financials tab           the Key ratios row, rendered
     the memo                     `dossier.canon.ratios.interestCoverage`

   The memo writes its multiples with a lower-case "x" and the glass writes "×",
   so the figure is what is held identical across the three and each surface's
   own rendering of it is held beside it.

   NO ENGINE AND NO FILE READER HERE. The drop, its clock and its asks are the
   e2e tests' subject (`spreadFlow.noModel.e2e.test.ts`); what this test needs
   is the same lines reaching all three surfaces, so it starts at the extraction
   and stays deterministic.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = live as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";
const hartwell = () => (data.borrowers as Record<string, BorrowerBundle>)[HARTWELL];

/** THE FIGURES THE FIXTURE PRINTS for the provisional period, in thousands:
 *  operating profit 5,400 over interest expense 1,750. */
const EXPECTED = (5_400_000 / 1_750_000).toFixed(2);

/** The fixture as the drop hands it to extraction. `readDroppedFile` is a
 *  FileReader away and jsdom has no File.text(), so the shape is built here;
 *  the base64 is the file's own bytes. */
const dropped = (): DroppedFile => ({
  id: "fixture-piedmont-fy2025",
  name: "piedmont-fy2025.csv",
  mime: "text/csv",
  bytes: CSV.length,
  base64: Buffer.from(CSV, "utf8").toString("base64"),
  sha256: "fixture",
  kind: "csv",
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function renderFinancials(bundle: BorrowerBundle): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AppProvider data={data}>
        <FinancialsTab bundle={bundle} />
      </AppProvider>,
    );
  });
  return container;
}

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ");

/** One Key ratios row, by the label a banker reads. */
function ratioRow(el: HTMLElement, label: string): string {
  const row = [...el.querySelectorAll(".rr")].find((r) => text(r).startsWith(label));
  if (!row) throw new Error(`no Key ratios row for ${label}`);
  return text(row);
}

/** The fixture spread under Hartwell, exactly as the room would leave it: the
 *  provisional read, the statements the stub hands back, and the book after the
 *  publish. */
async function spreadUnderHartwell() {
  const bundle = hartwell();
  const ctx: RelationshipSpreadContext = {
    accountId: HARTWELL,
    company: bundle.snapshot.name ?? "",
    onFilePeriods: (bundle.boom?.spread?.periods ?? []).map((p) => p.period ?? "").filter(Boolean),
    covenants: [],
    obligorGroup: [],
  };

  const pre = deterministicPreRead(await extractDocument(dropped()), ctx);
  const provisional = provisionalRead([pre], bundle.boom, ctx.covenants);
  const statements = statementsFromPreRead(pre.fileId, pre);
  const published = publishSpread({ onFile: bundle.boom, statements, provenance: "stub-provisional" });
  return { bundle, provisional, statements, published };
}

describe("interest coverage reads the same on every surface that prints it", () => {
  it("gives the room, the Financials tab and the memo one figure for the provisional period", async () => {
    const { bundle, provisional, statements, published } = await spreadUnderHartwell();
    expect(provisional?.period).toBe("FY2025");

    /* -------------------------------------------- the Spreading room's panel */
    const onFile = onFileBoomFigures(bundle.boom).figures;
    const roomFigure = mergeFigures(figuresFromSpread(statements), provisional, onFile).coverage;
    expect(roomFigure).not.toBeNull();
    expect(roomFigure!.toFixed(2)).toBe(EXPECTED);
    expect(fmtRatio(roomFigure)).toBe(`${EXPECTED}×`);

    /* --------------------------------------------------- the Financials tab */
    const next: BorrowerBundle = { ...bundle, boom: published ?? undefined };
    const tab = renderFinancials(next);
    expect(ratioRow(tab, "Interest coverage")).toBe(`Interest coverage${EXPECTED}×`);

    /* ------------------------------------------------------------- the memo */
    const memoFigure = buildMemoDossier({ bundle: next }).canon.ratios?.interestCoverage ?? null;
    expect(memoFigure).not.toBeNull();
    expect(memoFigure!.toFixed(2)).toBe(EXPECTED);

    /* ONE FIGURE, not three that happen to round the same way. */
    expect(published?.ratios?.interestCoverage).toBe(roomFigure);
    expect(memoFigure).toBe(roomFigure);
  });

  it("leaves the rest of the ratio set on the period Boom struck it for", async () => {
    const { bundle, published } = await spreadUnderHartwell();
    const before = bundle.boom?.ratios;
    // The coverage moved with the spread; nothing the statements cannot support
    // moved with it, which is the half of the publish that still holds.
    expect(published?.ratios?.ebitda).toBe(before?.ebitda);
    expect(published?.ratios?.ebitdaMargin).toBe(before?.ebitdaMargin);
    expect(published?.ratios?.totalLeverage).toBe(before?.totalLeverage);
    // And what the tab printed before the fix, so the regression is named.
    expect(fmtRatio(before?.interestCoverage)).toBe("2.95×");
  });
});
