// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { C360Data } from "../data/contract";
import { createFakeDb, type FakeDb } from "../intent/fakeDb";
import { __setDbForTests } from "../channel/dbDoor";
import { __resetLaneHealthForTests, noteLaneSuccess } from "../channel/laneHealth";
import { SERVERS } from "../channel/mcp";
import { AppProvider, useApp } from "./appState";
import {
  COCKPIT_STATE_COLLECTION,
  COCKPIT_STATE_DOC,
  COCKPIT_STATE_DEBOUNCE_MS,
  MAX_COCKPIT_STATE_BYTES,
  useCockpitState,
  type CockpitStateDoc,
} from "./cockpitState";
import sample from "../../../artifact/sample-data.json";

/* =============================================================================
   "WHAT AM I LOOKING AT?"

   The page and the Cowork session are two windows onto the same afternoon and
   neither can see the other, so the page writes down where it is standing. What
   these prove is the part that could quietly rot:

     1. the document says the relationship and the tab a banker can see;
     2. it carries the connector clock, so a session can answer "is it slow"
        with a number rather than an impression;
     3. NOTHING from the write path is in it, no token, no plan hash, no
        staging id. The store is shared and readable by every viewer of the
        artifact, and a replayable token in it would undo the confirm gate;
     4. with no store, nothing is written and nothing throws.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATA = sample as unknown as C360Data;
const ACCOUNT = "001bb00001DLtRMAA1";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let store: FakeDb;
/** How many times the document was actually SET, so the debounce is provable
 *  rather than assumed. The fake store records what a document holds, not how
 *  often it was written, so the count is taken at the door. */
let sets = 0;

/** The fake store with a counter on the one write this file makes. */
function counting(base: FakeDb): FakeDb {
  return {
    ...base,
    collection: (path: string) => {
      const col = base.collection(path);
      return {
        ...col,
        doc: (id?: string) => {
          const ref = col.doc(id);
          return { ...ref, set: (data: Record<string, unknown>) => { sets += 1; return ref.set(data); } };
        },
      };
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetLaneHealthForTests();
  sets = 0;
  store = counting(createFakeDb());
  __setDbForTests(store);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  __setDbForTests(undefined);
  __resetLaneHealthForTests();
  vi.useRealTimers();
});

function Harness({ open, children }: { open?: string; children?: ReactNode }) {
  const { dispatch } = useApp();
  useCockpitState();
  useEffect(() => {
    if (open) dispatch({ type: "OPEN_ACCOUNT", accountId: open });
  }, [dispatch, open]);
  return <>{children}</>;
}

function render(open?: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AppProvider data={DATA}>
        <Harness open={open} />
      </AppProvider>,
    );
  });
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(COCKPIT_STATE_DEBOUNCE_MS + 50);
  });
}

const PATH = `${COCKPIT_STATE_COLLECTION}/${COCKPIT_STATE_DOC}`;
const written = (): CockpitStateDoc | undefined => store.docs.get(PATH) as CockpitStateDoc | undefined;

describe("the cockpit state document", () => {
  it("names the relationship and the tab the banker is on", async () => {
    render(ACCOUNT);
    await settle();

    const doc = written();
    expect(doc).toBeTruthy();
    expect(doc!.openAccount).toEqual({ id: ACCOUNT, name: DATA.borrowers![ACCOUNT].snapshot!.name });
    expect(doc!.openTab).toBe("activity");
    expect(doc!.openRoom).toBeNull();
    expect(doc!.stagedPlan).toBeNull();
    expect(typeof doc!.updatedAt).toBe("string");
  });

  it("carries the connector clock, so 'is it slow' has a number", async () => {
    noteLaneSuccess(SERVERS.customer360, Date.now(), { tool: "Customer360Snapshot", ms: 431 });
    render(ACCOUNT);
    await settle();

    expect(written()!.health.Salesforce).toMatchObject({ state: "live", lastMs: 431 });
  });

  it("carries nothing from the write path", async () => {
    render(ACCOUNT);
    await settle();

    /* THE RULE `lastGood.ts` WRITES UNDER, and for the same reason: every viewer
       of this artifact can read this document, and one banker seeing one plan is
       the whole contract the confirm gate rests on. */
    const body = JSON.stringify(written());
    for (const forbidden of ["decisionToken", "planHash", "stagingId", "idempotencyKey"]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("stays small", async () => {
    render(ACCOUNT);
    await settle();
    expect(JSON.stringify(written()).length).toBeLessThan(MAX_COCKPIT_STATE_BYTES);
  });

  it("writes once for a burst of changes, not once per change", async () => {
    render(ACCOUNT);
    await settle();
    const first = sets;

    // Six connector answers inside a second is an ordinary open. The banker's
    // position did not change six times.
    act(() => {
      for (let i = 0; i < 6; i += 1) {
        noteLaneSuccess(SERVERS.customer360, Date.now(), { tool: `tool-${i}`, ms: 100 + i });
      }
    });
    await settle();

    expect(sets - first).toBe(1);
  });

  it("writes nothing at all with no store, and does not throw", async () => {
    __setDbForTests(undefined);
    render(ACCOUNT);
    await settle();
    expect(written()).toBeUndefined();
  });
});
