import { Component, type ErrorInfo, type ReactNode } from "react";

/* =============================================================================
   GARBAGE IN, CALM OUT.

   A malformed payload is not rare. A connector mid-deploy, an org field that
   went null, a tool whose shape moved under a cached schema: any of them can
   hand a module an object it cannot read. Without a boundary, one bad row in
   one card unmounts the entire React tree and the banker gets a white page,
   which is worse than the missing figure by a wide margin.

   TWO SCOPES, ON PURPOSE.

   A MODULE boundary is the small one: one card, one lane, one pane. It fails
   to the same gap marker the app already uses for a figure the source system
   does not carry, plus one line saying which module it was. Everything around
   it keeps working, which is the honest render: the rest of the room really is
   fine.

   A ROOM boundary is the outer one, and it should never fire. If it does, the
   room says so in its own voice, keeps the way out visible, and never shows a
   stack: a component stack on the glass in front of a client is the failure,
   not the diagnosis. The detail goes to the console, where an engineer can
   read it and a banker never has to.

   NEITHER ONE RETRIES BY ITSELF. A boundary that remounted a throwing subtree
   on a timer is an infinite loop with a spinner on it. `reset` exists and is
   wired to a control the banker presses.
   ============================================================================= */

/** The marker the memo already uses for a figure the source system does not
 *  carry. Repeated here rather than imported so the boundary has no dependency
 *  that could itself be the thing that failed. */
const GAP_MARKER = "[not in source system; flagged for RM]";

interface Props {
  /** What broke, in banker words. "the exposure card", "the reading pane". */
  what: string;
  children: ReactNode;
  /** Room scope renders the wider notice; module scope renders the gap row. */
  scope?: "module" | "room";
  /** Told once, so a room can say a line about it in its own thread. */
  onCaught?: (what: string, message: string) => void;
}

interface State {
  message: string | null;
}

export class RoomBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    const message =
      typeof error === "object" && error !== null && typeof (error as Error).message === "string"
        ? (error as Error).message
        : String(error);
    return { message: message || "the payload could not be read" };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    /* eslint-disable no-console */
    console.error(`[c360] ${this.props.what} could not render`, error, info.componentStack);
    /* eslint-enable no-console */
    this.props.onCaught?.(this.props.what, String((error as Error)?.message ?? error));
  }

  render(): ReactNode {
    if (this.state.message === null) return this.props.children;

    if (this.props.scope === "room") {
      return (
        <div className="wk-notice" role="alert">
          <div>
            <div className="wk-nt">This part of the room did not render.</div>
            <div className="wk-nb">
              {`${this.props.what} came back in a shape I could not read, so I have stopped it here rather than let it take the room with it. `}
              Nothing has been staged and nothing has been filed. Close the room and open it again, and it will read the file afresh.
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="wk-gap" role="status">
        <span className="wk-gap-mark">{GAP_MARKER}</span>
        <span className="wk-gap-why">{`${this.props.what} came back in a shape I could not read, so this stands empty rather than showing a figure I cannot stand behind.`}</span>
      </div>
    );
  }
}
