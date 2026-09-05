// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RoomBoundary } from "./RoomBoundary";

/* =============================================================================
   THE BOUNDARY, WITH SOMETHING ACTUALLY THROWN AT IT.

   The thing a boundary has to be right about cannot be reasoned about from the
   source: React only calls it when a render throws, and a boundary that is
   wired wrong looks exactly like one that is wired right until the day it is
   needed. So this throws.

   TWO CLAIMS. The banker sees the room's own words and never a stack, and the
   siblings around the failure keep rendering: a boundary that took the whole
   thread down with one bad card would be the white page it exists to prevent.
   ============================================================================= */

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

let host: HTMLDivElement;
let root: Root;
let errors: string[];

beforeEach(() => {
  errors = [];
  // React logs the caught error itself; the boundary logs its own line. Neither
  // is the assertion, and both would otherwise flood the run.
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const render = (node: React.ReactNode) => act(() => root.render(node));

describe("a module that cannot render its payload", () => {
  it("leaves the gap marker and one line, and never a stack", () => {
    render(
      <RoomBoundary what="the exposure card">
        <Boom message="Cannot read properties of undefined (reading 'rows')" />
      </RoomBoundary>,
    );
    const gap = host.querySelector(".wk-gap")!;
    expect(gap).toBeTruthy();
    expect(gap.querySelector(".wk-gap-mark")!.textContent).toBe("[not in source system; flagged for RM]");
    expect(gap.querySelector(".wk-gap-why")!.textContent).toBe(
      "the exposure card came back in a shape I could not read, so this stands empty rather than showing a figure I cannot stand behind.",
    );
    // The exception's own text is for the console, never for the glass.
    expect(host.textContent).not.toContain("Cannot read properties");
  });

  it("keeps every sibling on the glass", () => {
    render(
      <div>
        <div id="above">the covenant card</div>
        <RoomBoundary what="the exposure card">
          <Boom message="bad payload" />
        </RoomBoundary>
        <div id="below">the collateral card</div>
      </div>,
    );
    expect(host.querySelector("#above")!.textContent).toBe("the covenant card");
    expect(host.querySelector("#below")!.textContent).toBe("the collateral card");
    expect(host.querySelector(".wk-gap")).toBeTruthy();
  });

  it("sends the detail to the console, where an engineer can read it", () => {
    render(
      <RoomBoundary what="the exposure card">
        <Boom message="bad payload" />
      </RoomBoundary>,
    );
    expect(errors.join(" ")).toContain("the exposure card could not render");
  });

  it("tells the room, once, so the room can say a line of its own", () => {
    const caught: Array<[string, string]> = [];
    render(
      <RoomBoundary what="the exposure card" onCaught={(what, message) => caught.push([what, message])}>
        <Boom message="bad payload" />
      </RoomBoundary>,
    );
    expect(caught).toEqual([["the exposure card", "bad payload"]]);
  });

  it("renders its children untouched when nothing throws", () => {
    render(
      <RoomBoundary what="the exposure card">
        <div id="fine">$42.4MM pledged</div>
      </RoomBoundary>,
    );
    expect(host.querySelector("#fine")!.textContent).toBe("$42.4MM pledged");
    expect(host.querySelector(".wk-gap")).toBeNull();
  });
});

describe("a room that cannot render", () => {
  it("says so in the room's voice, states nothing was staged, and shows the way out", () => {
    render(
      <RoomBoundary what="the facility room" scope="room">
        <Boom message="bad payload" />
      </RoomBoundary>,
    );
    const notice = host.querySelector(".wk-notice")!;
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.querySelector(".wk-nt")!.textContent).toBe("This part of the room did not render.");
    const body = notice.querySelector(".wk-nb")!.textContent!;
    expect(body).toContain("Nothing has been staged and nothing has been filed.");
    expect(body).toContain("Close the room and open it again");
    expect(body).not.toContain("bad payload");
  });

  it("keeps its fault copy sober: no apology, no exclamation, no em dash", () => {
    render(
      <RoomBoundary what="the facility room" scope="room">
        <Boom message="bad payload" />
      </RoomBoundary>,
    );
    const said = host.textContent!;
    expect(said).not.toMatch(/!/);
    expect(said).not.toMatch(/—/);
    expect(said).not.toMatch(/\bsorry\b|\bapolog|\boops\b/i);
  });
});
