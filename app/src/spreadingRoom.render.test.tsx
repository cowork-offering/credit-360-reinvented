// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SpreadingRoom } from "./components/workroom/SpreadingRoom";
import type { SpreadDeps } from "./workroom/spreadEngine";
import type { RelationshipSpreadContext } from "./spread/preRead";

/* =============================================================================
   THE SPREADING ROOM OPENS ON THE FIRST FRAME.

   The founder's bar for this room is "no latency, elegant cinematic loading":
   the drop zone paints immediately and NOTHING is fetched to open, because
   everything the room needs at open is already in the cockpit's book. That is
   one assertion and it is the one worth holding in a test: mount the room and
   prove the zone is there, the room is empty, and no connector, network call or
   file read happened on the way in.

   The flow itself is proved in `workroom/spreadEngine.test.ts`, where the
   machine is testable without a DOM.
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
  vi.restoreAllMocks();
});

const CTX: RelationshipSpreadContext = {
  accountId: "001Hartwell",
  company: "Hartwell Precision",
  onFilePeriods: ["FY2023", "FY2024"],
  covenants: [{ name: "Fixed charge coverage", operator: ">=", threshold: 1.25, current: 1.31 }],
  obligorGroup: [],
};

/** Every dependency the room could reach, spied. None of them may be called by
 *  a mount: an open that reads a file or asks Boom anything is the latency the
 *  spec forbids. */
function spiedDeps() {
  return {
    readDroppedFile: vi.fn(),
    extractDocument: vi.fn(),
    preReadFile: vi.fn(),
    provisionalRead: vi.fn(),
    postRead: vi.fn(),
    adapter: { upload: vi.fn(), status: vi.fn() },
  } as unknown as SpreadDeps & {
    readDroppedFile: ReturnType<typeof vi.fn>;
    adapter: { upload: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> };
  };
}

function mount(deps: SpreadDeps) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<SpreadingRoom ctx={CTX} deps={deps} onClose={() => {}} />));
  return document.querySelector<HTMLElement>('[data-room="spread"]')!;
}

describe("the room opens instantly, on the drop zone", () => {
  it("paints the drop zone on the first commit, with no file read and no Boom call", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const deps = spiedDeps();
    const room = mount(deps);

    expect(room).toBeTruthy();
    const zone = room.querySelector<HTMLElement>(".sp-drop");
    expect(zone).toBeTruthy();
    expect(zone!.getAttribute("data-stage")).toBe("idle");
    expect(zone!.textContent).toContain("Drop financial statements for Hartwell Precision.");
    expect(room.querySelector("input[type=file]")?.getAttribute("accept")).toContain(".pdf");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(deps.readDroppedFile).not.toHaveBeenCalled();
    expect(deps.adapter.upload).not.toHaveBeenCalled();
    expect(deps.adapter.status).not.toHaveBeenCalled();
  });

  it("opens with no card, no ask, no plan and no ladder", () => {
    const room = mount(spiedDeps());
    expect(room.querySelectorAll(".sp-card")).toHaveLength(0);
    expect(room.querySelector(".sp-ask")).toBeNull();
    expect(room.querySelector(".sp-plan")).toBeNull();
    expect(room.querySelector(".sp-ladder")).toBeNull();
    expect(room.querySelector(".sp-fin")).toBeNull();
  });

  it("wears the rooms' own chrome: the mark, the title, the Feedback pill, the close", () => {
    const room = mount(spiedDeps());
    const head = room.querySelector(".wk-head")!;
    expect(head.querySelector(".wk-title")?.textContent).toBe("Spread financials");
    expect(head.querySelector(".bugcopy")).toBeTruthy();
    expect(head.querySelector('[aria-label="Close the spreading room"]')).toBeTruthy();
    expect(document.body.classList.contains("wk-open")).toBe(true);
  });
});
