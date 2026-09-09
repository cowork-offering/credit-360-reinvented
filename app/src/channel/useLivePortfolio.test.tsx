// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PORTFOLIO_REFETCH_MS, useLivePortfolio, __skipBootForTests } from "./useLivePortfolio";
import { RETRY_BUDGET_MS, RETRY_MAX_MS } from "./mcp";
import {
  __resetDbScreenForTests,
  __setDbForTests,
  type DbCollectionReference,
  type DbDocumentReference,
  type DbNamespace,
} from "./dbDoor";

/* =============================================================================
   The book's read is a POLL over `callTool`, not a `watchTool` subscription.

   On 2026-09-09 the founder's seat opened to "Salesforce unreachable:
   bad_request" with the platform's reason beside it: "declared-write tools
   cannot be watched". The Salesforce-hosted MCP server declares every Apex
   invocable as a write, reads included, and the runtime allows a watch only on
   a declared read. So the portfolio goes through `callTool` like the other
   reads on the connector, on the page's own two-minute clock. What is asserted
   here is that contract: the first read on mount, the re-read on the clock,
   the retry policy in front of the banner, the retraction on a denial, and the
   clock stopping with the view.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  delete w.claude;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const PORTFOLIO = "Customer360Portfolio";
const envelope = (data: unknown) => ({ content: [{ isSuccess: true, errors: null, outputValues: data }] });
const BOOK = envelope({ accounts: [{ accountId: "A" }] });
const UNAVAILABLE = { code: "server_unavailable", message: "session expired", retryable: true };

/** A connector whose portfolio answer the test owns; every other tool (the
 *  backup lane's one-shot, for one) is unreachable, so only the primary counts. */
function connector(answer: () => Promise<unknown>) {
  const callTool = vi.fn((_server: string, tool: string, _input?: unknown, _options?: unknown) => (tool === PORTFOLIO ? answer() : Promise.reject(UNAVAILABLE)));
  const watchTool = vi.fn();
  w.claude = { mcp: { callTool, watchTool, listTools: vi.fn(), invalidate: vi.fn() } };
  const portfolioCalls = () => callTool.mock.calls.filter((c) => c[1] === PORTFOLIO);
  return { callTool, watchTool, portfolioCalls };
}

function mountHook(enabled = true) {
  let latest: ReturnType<typeof useLivePortfolio> = {};
  function Probe() {
    latest = useLivePortfolio(enabled);
    return null;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Probe />));
  return { get value() { return latest; } };
}

const tick = async (ms = 10) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("useLivePortfolio", () => {
  it("reads on mount through callTool, never through a watch, and re-reads on the page's own clock", async () => {
    vi.useFakeTimers();
    const c = connector(() => Promise.resolve({ payload: BOOK, cache: { storedAt: 555, revalidating: false } }));
    mountHook();
    await tick();
    expect(c.watchTool).not.toHaveBeenCalled();
    expect(c.portfolioCalls()).toHaveLength(1);
    // The first read may take a cached answer inside the clock; a re-read asks for a fresh one.
    expect(c.portfolioCalls()[0][3]).toMatchObject({ cache: { staleTime: PORTFOLIO_REFETCH_MS } });
    await tick(PORTFOLIO_REFETCH_MS);
    expect(c.portfolioCalls()).toHaveLength(2);
    expect(c.portfolioCalls()[1][3]).toMatchObject({ cache: { refresh: true } });
    expect(PORTFOLIO_REFETCH_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("unwraps the invocable envelope and records freshness: the platform stamp, or the arrival time of an executed read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T09:00:00Z"));
    const c = connector(() => Promise.resolve({ payload: BOOK, cache: { storedAt: 555, revalidating: false } }));
    const h = mountHook();
    await tick();
    expect(h.value.portfolio?.accounts?.[0]?.accountId).toBe("A");
    expect(h.value.storedAt).toBe(555);

    c.callTool.mockImplementation((_s: string, tool: string, _i?: unknown, _o?: unknown) => (tool === PORTFOLIO ? Promise.resolve({ payload: envelope({ accounts: [{ accountId: "B" }] }) }) : Promise.reject(UNAVAILABLE)));
    const before = Date.now();
    await tick(PORTFOLIO_REFETCH_MS);
    expect(h.value.portfolio?.accounts?.[0]?.accountId).toBe("B");
    // No cache block means EXECUTED for this call, and a declared write is never cached: the arrival is the "as of".
    expect(h.value.storedAt).toBeGreaterThanOrEqual(before);
    expect(h.value.storedAt).toBeLessThanOrEqual(Date.now());
  });

  it("NEVER shows the banner when the retry succeeds", async () => {
    vi.useFakeTimers();
    let first = true;
    const c = connector(() => {
      if (first) {
        first = false;
        return Promise.reject(UNAVAILABLE);
      }
      return Promise.resolve({ payload: BOOK, cache: { storedAt: 777, revalidating: false } });
    });
    const h = mountHook();
    await tick();
    expect(h.value.failure).toBeUndefined(); // the retry is still running
    await tick(RETRY_MAX_MS + 50);
    expect(c.portfolioCalls()).toHaveLength(2);
    expect(h.value.failure).toBeUndefined();
    expect(h.value.portfolio?.accounts?.[0]?.accountId).toBe("A");
    expect(h.value.storedAt).toBe(777);
  });

  it("shows the failure only after every retry has failed too, keeping last-good data", async () => {
    vi.useFakeTimers();
    let good = true;
    const c = connector(() => (good ? Promise.resolve({ payload: BOOK, cache: { storedAt: 111, revalidating: false } }) : Promise.reject(UNAVAILABLE)));
    const h = mountHook();
    await tick();
    expect(h.value.storedAt).toBe(111);

    good = false;
    await tick(PORTFOLIO_REFETCH_MS);
    expect(h.value.failure).toBeUndefined(); // retrying, silently
    await tick(RETRY_BUDGET_MS + 50);
    expect(h.value.failure?.code).toBe("server_unavailable");
    expect(h.value.portfolio?.accounts?.[0]?.accountId).toBe("A"); // retained
    expect(h.value.storedAt).toBe(111); // the freshness the banner quotes
    expect(c.portfolioCalls().length).toBeGreaterThan(2);
  });

  it("RETRACTS data on an authz denial", async () => {
    vi.useFakeTimers();
    let good = true;
    connector(() => (good ? Promise.resolve({ payload: BOOK }) : Promise.reject({ code: "needs_reauth" })));
    const h = mountHook();
    await tick();
    expect(h.value.portfolio).toBeTruthy();
    good = false;
    await tick(PORTFOLIO_REFETCH_MS);
    expect(h.value.portfolio).toBeUndefined(); // retracted
    expect(h.value.failure?.retract).toBe(true);
  });

  it("Retry reads again now, and the good read is what clears the banner", async () => {
    vi.useFakeTimers();
    let good = false;
    const c = connector(() => (good ? Promise.resolve({ payload: BOOK }) : Promise.reject({ code: "not_in_manifest" })));
    const h = mountHook();
    await tick();
    expect(h.value.failure).toBeTruthy();
    expect(c.portfolioCalls()).toHaveLength(1); // not retryable: one attempt

    good = true;
    act(() => h.value.retry!());
    // The click does not clear the banner. The next good read does.
    expect(h.value.retrying).toBe(true);
    expect(h.value.failure).toBeTruthy();
    await tick();
    expect(c.portfolioCalls()).toHaveLength(2);
    expect(c.portfolioCalls()[1][3]).toMatchObject({ cache: { refresh: true } }); // a restart asks fresh
    expect(h.value.failure).toBeUndefined();
    expect(h.value.retrying).toBe(false);
    expect(h.value.portfolio?.accounts?.[0]?.accountId).toBe("A");
  });

  it("stops the clock on unmount", async () => {
    vi.useFakeTimers();
    const c = connector(() => Promise.resolve({ payload: BOOK }));
    mountHook();
    await tick();
    act(() => root?.unmount());
    root = null;
    await tick(PORTFOLIO_REFETCH_MS * 3);
    expect(c.portfolioCalls()).toHaveLength(1);
  });

  it("does not read when disabled", async () => {
    vi.useFakeTimers();
    const c = connector(() => Promise.resolve({ payload: BOOK }));
    mountHook(false);
    await tick(PORTFOLIO_REFETCH_MS);
    expect(c.portfolioCalls()).toHaveLength(0);
  });
});

/* =============================================================================
   THE COLD-OPEN SKELETON, and the book cache behind it.

   A fresh open with a connector boots through a skeleton (booting = true) until
   the first book lands, so a viewer never watches the baked test relationships
   flash before the org's real book arrives. A returning viewer's cached book
   clears the skeleton before it is ever seen; a share link with no connector
   never boots at all. And every good read is remembered, so the NEXT open has a
   book to seed from.
   ============================================================================= */

/** A stateful namespace: gives back what was set, so a seed and a persist can
 *  both be asserted. */
function fakeStore() {
  const docs = new Map<string, Record<string, unknown>>();
  const ref = (path: string): DbDocumentReference =>
    ({
      id: path.split("/").pop() ?? "",
      path,
      get: async () => {
        const data = docs.get(path);
        return { id: path, exists: data !== undefined, data: () => data };
      },
      set: async (data: Record<string, unknown>) => void docs.set(path, data),
      update: async (data: Record<string, unknown>) => void docs.set(path, { ...(docs.get(path) ?? {}), ...data }),
      delete: async () => void docs.delete(path),
    }) as unknown as DbDocumentReference;
  const query = (path: string): DbCollectionReference => {
    const self = {
      path,
      doc: (id?: string) => ref(`${path}/${id ?? "auto"}`),
      where: () => self,
      orderBy: () => self,
      limit: () => self,
      get: async () => ({ docs: [] }),
      onSnapshot: () => () => {},
    } as unknown as DbCollectionReference;
    return self;
  };
  const ns: DbNamespace = { doc: ref, collection: query };
  return { ns, docs };
}

describe("useLivePortfolio: the cold-open skeleton and the book cache", () => {
  afterEach(() => {
    __setDbForTests(undefined);
    __resetDbScreenForTests();
    __skipBootForTests(false);
  });

  it("boots through the skeleton on a fresh open, and the live read clears it", async () => {
    vi.useFakeTimers();
    connector(() => Promise.resolve({ payload: BOOK, cache: { storedAt: 555, revalidating: false } }));
    const h = mountHook();
    // Synchronously after mount the read is in flight and nothing has landed.
    expect(h.value.booting).toBe(true);
    expect(h.value.portfolio).toBeUndefined();
    await tick();
    // The org answered: the skeleton is done and the book is live.
    expect(h.value.booting).toBe(false);
    expect(h.value.source).toBe("live");
    expect(h.value.portfolio?.accounts?.[0]?.accountId).toBe("A");
  });

  it("never boots without a connector, so a share link opens on the baked book", () => {
    vi.useFakeTimers();
    const h = mountHook(false);
    expect(h.value.booting).toBeFalsy();
  });

  it("the test seam opens the home already settled, as a warm cache does", () => {
    vi.useFakeTimers();
    __skipBootForTests(true);
    connector(() => Promise.resolve({ payload: BOOK }));
    const h = mountHook();
    expect(h.value.booting).toBeFalsy();
  });

  it("a failure ends the skeleton rather than shimmering forever", async () => {
    vi.useFakeTimers();
    connector(() => Promise.reject({ code: "not_in_manifest" }));
    const h = mountHook();
    expect(h.value.booting).toBe(true);
    await tick();
    expect(h.value.booting).toBe(false);
    expect(h.value.failure).toBeTruthy();
  });

  it("the backstop clears a wedged skeleton even if the read never answers", async () => {
    vi.useFakeTimers();
    // A read that never resolves and never rejects: only the backstop can end it.
    connector(() => new Promise<never>(() => {}));
    const h = mountHook();
    expect(h.value.booting).toBe(true);
    await tick(20_000);
    expect(h.value.booting).toBe(false);
  });

  it("seeds the cached book first, marked as cache, when the live read is slow", async () => {
    vi.useFakeTimers();
    const store = fakeStore();
    __resetDbScreenForTests();
    __setDbForTests(store.ns);
    // The cached book is already in the store, stamped recently so it clears the
    // age gate; the live read never answers, so the only thing that can paint is
    // the cache.
    const recent = Date.now() - 1_000;
    store.docs.set("cache/book", { storedAt: recent, tool: PORTFOLIO, payload: { accounts: [{ accountId: "CACHED" }] } });
    connector(() => new Promise<never>(() => {}));
    const h = mountHook();
    await tick();
    expect(h.value.source).toBe("cache");
    expect(h.value.booting).toBe(false);
    expect(h.value.portfolio?.accounts?.[0]?.accountId).toBe("CACHED");
  });

  it("remembers every good read, so the next open has a book to seed from", async () => {
    vi.useFakeTimers();
    const store = fakeStore();
    __resetDbScreenForTests();
    __setDbForTests(store.ns);
    connector(() => Promise.resolve({ payload: BOOK, cache: { storedAt: 900, revalidating: false } }));
    mountHook();
    await tick();
    const written = store.docs.get("cache/book");
    expect(written?.storedAt).toBe(900);
    expect((written?.payload as { accounts?: unknown[] })?.accounts?.length).toBe(1);
  });

  it("a live read settles over an identical cached book without churning the object", async () => {
    vi.useFakeTimers();
    const store = fakeStore();
    __resetDbScreenForTests();
    __setDbForTests(store.ns);
    // Cache and live are the SAME book. The cache paints first; the live read
    // must keep the object it built, advancing only the stamp and the source.
    store.docs.set("cache/book", { storedAt: Date.now() - 1_000, tool: PORTFOLIO, payload: BOOK });
    connector(() => Promise.resolve({ payload: BOOK, cache: { storedAt: 900, revalidating: false } }));
    const h = mountHook();
    await tick();
    const first = h.value.portfolio;
    await tick(PORTFOLIO_REFETCH_MS);
    expect(h.value.portfolio).toBe(first); // same reference: nothing reflowed
    expect(h.value.source).toBe("live");
  });
});
