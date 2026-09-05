// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_STRING_BYTES,
  __resetDbScreenForTests,
  __setDbForTests,
  db,
  dbRefusals,
  screenDocument,
  type DbCollectionReference,
  type DbDocumentReference,
  type DbNamespace,
} from "./dbDoor";
import { putLastGood } from "./lastGood";

/* =============================================================================
   THE GUARD AT THE DOOR.

   FOUNDER, 2026-09-06: claude.ai's web application firewall served him the
   Cloudflare block page where the cockpit should have been, on the current
   build and on the older plugin copy alike, so the block was scoped to his
   client and not to a build. The one request this page makes that a firewall
   can read as an attack is a store write, and the memo store's first write
   carried the whole rendered memo, review-shell script included, in a JSON
   body (fixed in 92d51af). These are the tests for the guard that stops the
   NEXT module making the same request.
   ============================================================================= */

/** An in-memory namespace of the db.d.ts shape that records what reached it. */
function fakeStore() {
  const written: Array<{ path: string; data: unknown }> = [];
  const ref = (path: string): DbDocumentReference => ({
    id: path.split("/").pop() ?? "",
    path,
    get: async () => ({ id: path, exists: false, data: () => undefined }),
    set: async (data) => void written.push({ path, data }),
    update: async (data) => void written.push({ path, data }),
    delete: async () => {},
  });
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
  return { ns, written };
}

let store: ReturnType<typeof fakeStore>;

beforeEach(() => {
  store = fakeStore();
  __resetDbScreenForTests();
  __setDbForTests(store.ns);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  __setDbForTests(undefined);
  __resetDbScreenForTests();
  vi.restoreAllMocks();
});

const bigString = (n: number) => "a".repeat(n);

describe("what the screen refuses", () => {
  it.each([
    ["a rendered document", { html: "<html><body>memo</body></html>" }],
    ["a review shell", { body: "<script>window.print()</script>" }],
    ["an embedded frame", { body: "<iframe src='x'></iframe>" }],
    ["a javascript url", { link: "javascript:alert(1)" }],
    ["an error handler", { img: "<img src=x onerror=alert(1)>" }],
    ["a load handler", { svg: "<svg onload=alert(1)>" }],
  ])("refuses %s", (_label, doc) => {
    expect(screenDocument("p/d", doc)).not.toBeNull();
  });

  it("matches whatever case the string is written in, exactly as a firewall does", () => {
    expect(screenDocument("p/d", { a: "<SCRIPT>x</SCRIPT>" })?.reason).toBe("<script");
    expect(screenDocument("p/d", { a: "JavaScript:void(0)" })?.reason).toBe("javascript:");
  });

  it("refuses one string over 32 KB, whatever it says", () => {
    expect(screenDocument("p/d", { note: bigString(MAX_STRING_BYTES + 1) })?.reason).toBe("oversize");
    expect(screenDocument("p/d", { note: bigString(MAX_STRING_BYTES) })).toBeNull();
  });

  it("screens KEYS as well as values: a key is as much of the request body", () => {
    expect(screenDocument("p/d", { "<script>": "harmless" })?.reason).toBe("<script");
  });

  it("finds it however deep it is buried, and says where", () => {
    const hit = screenDocument("p/d", { plan: { steps: [{ before: "ok", after: "<iframe>" }] } });
    expect(hit?.reason).toBe("<iframe");
    expect(hit?.at).toBe("plan.steps[0].after");
  });

  it("refuses a document it cannot even describe", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(screenDocument("p/d", cyclic)?.reason).toBe("unserialisable");
  });

  it("lets an ordinary document through untouched", () => {
    // The lean memo draft, a cached read slice and an intent all look like this.
    expect(screenDocument("p/d", { storedAt: 1, tool: "Customer360Exposure", payload: { facilities: [] } })).toBeNull();
  });
});

describe("what a refusal does to the page", () => {
  it("stops the write reaching the store at all", async () => {
    await db()!.doc("memos/m1").set({ html: "<html><script>x</script></html>" });
    expect(store.written).toEqual([]);
    expect(dbRefusals().map((r) => r.reason)).toEqual(["<script"]);
  });

  it("is SILENT: it resolves like a write that happened", async () => {
    // The whole store is optional, so a page with one refused document has to
    // behave exactly like a page with no grant. Nothing may reach the room.
    await expect(db()!.doc("memos/m1").update({ body: "<iframe/>" })).resolves.toBeUndefined();
  });

  it("logs once per document, however many times the room writes it", async () => {
    const warn = console.warn as unknown as ReturnType<typeof vi.fn>;
    for (let i = 0; i < 5; i += 1) await db()!.doc("memos/m1").set({ body: "<script/>" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("memos/m1");
    // Every attempt is still counted; only the console is spared.
    expect(dbRefusals()).toHaveLength(5);
    await db()!.doc("memos/m2").set({ body: "<script/>" });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("guards a document reached through a collection, not just a bare path", async () => {
    await db()!.collection("cache/accounts/001X").doc("exposure").set({ payload: "<html>" });
    expect(store.written).toEqual([]);
    expect(dbRefusals()).toHaveLength(1);
  });

  it("leaves reads, queries and deletes alone: they carry no body to mistake", async () => {
    await expect(db()!.doc("memos/m1").get()).resolves.toMatchObject({ exists: false });
    await expect(db()!.collection("cache/accounts/001X").get()).resolves.toMatchObject({ docs: [] });
    await expect(db()!.doc("memos/m1").delete()).resolves.toBeUndefined();
    expect(dbRefusals()).toEqual([]);
  });

  it("lets the writes the cockpit actually makes through", async () => {
    await putLastGood("001X", "exposure", "Customer360Exposure", { facilities: [{ loanId: "a4Z" }] }, 1_700_000_000_000);
    expect(store.written).toHaveLength(1);
    expect(store.written[0].path).toBe("cache/accounts/001X/exposure");
    expect(dbRefusals()).toEqual([]);
  });

  it("refuses a last-good slice whose payload arrived carrying markup", async () => {
    // The org is not the only thing that can put a string in a payload, and a
    // read is written back to the store verbatim on purpose.
    await putLastGood("001X", "snapshot", "Customer360Snapshot", { note: "<script>x</script>" }, 1_700_000_000_000);
    expect(store.written).toEqual([]);
  });
});
