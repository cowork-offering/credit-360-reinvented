// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AppProvider } from "./state/appState";
import { FinancialsTab } from "./components/tabs/FinancialsTab";
import { resetBoomServer } from "./channel/boomLane";
import type { BorrowerBundle, C360Data } from "./data/contract";
import live from "../../artifact/live-data.json";

import RATIOS from "./__fixtures__/boom-live/ratios-piedmont.json";
import SPREAD from "./__fixtures__/boom-live/spread-piedmont.json";

/* =============================================================================
   "WHERE IS THE OPEN IN BOOM BUTTON THERE IS NONE" (founder, live, 2026-09-16,
   standing on the Financials tab).

   The room has had the control since 0.9.29 and the tab never did: compact mode
   was given no footer at all in 0.9.28, so the register printed "Not validated
   in Boom" over a spread with no way to go and look at it.

   THE DOCTRINE IS THE ROOM'S, UNCHANGED, and it is what these cases pin. The
   verification session is a 60-minute token, so it is minted on the CLICK and
   never at render; the control is a button until Boom answers and an anchor
   after it; a refusal shows Boom's own words and no dead link; and the file the
   door opens is the one the tab's own Boom read resolved to
   (`_provenance.ids.fileId` / `support.fileId`, both on the live answer).

   Every answer here is the live server's, off `src/__fixtures__/boom-live/`.

   IT LIVES AT THE SUITE ROOT, beside the room's own render tests and not under
   `components/`, for the reason every one of them does: the F2 provenance audit
   scans `components/` for the field names a component reads off a bundle, and a
   test carrying Boom's own URLs and a local named after the connector reads as
   two data leaves nobody declared.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = live as unknown as C360Data;
const PIEDMONT = "001bb00001DLtRMAA1";
const FILE_ID = "cf677dcc-594c-45b5-b47d-c92c0b2ee909";
const SESSION = "https://app.boom.build/file-validation/cf677dcc#token=bvs_1";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** The Boom connector, answering the two reads the tab makes and the one the
 *  control makes. `refuse` is the relay's own shape: an object, never an Error. */
function boomWindow(options: { refuse?: boolean } = {}) {
  const tools: Array<{ tool: string; input: unknown }> = [];
  const callTool = vi.fn(async (_server: string, tool: string, input?: unknown) => {
    tools.push({ tool, input });
    if (tool === "boom_get_ratios") return { payload: RATIOS, raw: {} };
    if (tool === "boom_get_spread") return { payload: SPREAD, raw: {} };
    if (tool === "boom_open_verification") {
      if (options.refuse) throw { code: "server_unavailable", message: "request failed (502)", retryable: false };
      return { payload: { ...RATIOS, url: SESSION, expiresAt: "2026-09-16T21:00:00Z" }, raw: {} };
    }
    return { payload: {}, raw: {} };
  });
  (window as unknown as { claude?: unknown }).claude = {
    mcp: { callTool, listTools: async () => ({ servers: [] }), invalidate: async () => {}, watchTool: vi.fn() },
  };
  return { tools };
}

beforeEach(() => {
  resetBoomServer();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  resetBoomServer();
  delete (window as unknown as { claude?: unknown }).claude;
});

/** The tab, after its own Boom read has landed. */
async function tab(): Promise<HTMLDivElement> {
  const bundle = (data.borrowers as Record<string, BorrowerBundle>)[PIEDMONT];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <AppProvider data={data}>
        <FinancialsTab bundle={bundle} />
      </AppProvider>,
    );
  });
  // The read, the normalise and the patch all land inside one more tick.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

describe("Open in Boom, on the Financials tab", () => {
  it("draws the control over the compact register and mints nothing at render", async () => {
    const lane = boomWindow();
    const host = await tab();

    const control = host.querySelector<HTMLButtonElement>("button.rg-provlink");
    expect(control).not.toBeNull();
    expect(control!.textContent).toBe("Open in Boom");
    expect(lane.tools.map((c) => c.tool)).not.toContain("boom_open_verification");
    // NO CITATION IN COMPACT. The tab names its own source in its Note, and a
    // second copy under the grid would be the same fact twice.
    expect(host.querySelector(".rg-provline")).toBeNull();
    expect(host.querySelector(".rg-prov")!.textContent).not.toContain("Spread by Boom");
  });

  it("asks for the page by the file the tab's own Boom read resolved to, then becomes a real anchor", async () => {
    const lane = boomWindow();
    const host = await tab();

    await act(async () => {
      host.querySelector<HTMLButtonElement>("button.rg-provlink")!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const asked = lane.tools.filter((c) => c.tool === "boom_open_verification");
    expect(asked).toHaveLength(1);
    expect(asked[0].input).toEqual({ fileId: FILE_ID });

    const link = host.querySelector<HTMLAnchorElement>("a.rg-provlink")!;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe(SESSION);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(host.querySelector("button.rg-provlink")).toBeNull();
  });

  it("says Boom's own words on a refusal and offers no dead link", async () => {
    boomWindow({ refuse: true });
    const host = await tab();

    await act(async () => {
      host.querySelector<HTMLButtonElement>("button.rg-provlink")!.click();
    });
    /* THE READ LADDER IS CLIMBED FIRST. `boom_open_verification` is a read at
       the seam, so a transport refusal costs three attempts with a wait between
       them before the room hears about it: the words arrive when the ladder is
       spent, not on the first rejection. */
    for (let i = 0; i < 80 && !host.querySelector(".rg-proverr"); i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
    }

    const footer = host.querySelector<HTMLElement>(".rg-prov")!;
    expect(footer.textContent).toContain("Boom did not open the verification page: request failed (502)");
    expect(host.querySelector("a.rg-provlink")).toBeNull();
    expect(footer.textContent).not.toContain("[object Object]");
  });

  it("draws nothing where no live Boom file backs the tab", async () => {
    // No connector at all: the book's own figures still render, and a door that
    // could open nothing is not offered.
    const bundle = (data.borrowers as Record<string, BorrowerBundle>)[PIEDMONT];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <AppProvider data={data}>
          <FinancialsTab bundle={bundle} />
        </AppProvider>,
      );
    });
    expect(container.querySelector(".rg-provlink")).toBeNull();
  });
});
