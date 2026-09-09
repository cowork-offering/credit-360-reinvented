// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadBook, putBook, MAX_AGE_MS, MAX_DOC_BYTES } from "./lastGood";
import {
  __resetDbScreenForTests,
  __setDbForTests,
  type DbCollectionReference,
  type DbDocumentReference,
  type DbNamespace,
} from "./dbDoor";

/* =============================================================================
   THE BOOK CACHE: the org's landing, kept where the next open can find it.

   These are the tests for putBook/loadBook, the one-document store the landing
   seeds from so a returning viewer sees their last book instantly instead of
   the baked samples flashing (channel/useLivePortfolio.ts). Same door, same
   screening, same age ceiling as the per-account store: a stale or malformed
   document is dropped whole, and with no `db` grant every call is a silent
   no-op and the landing renders exactly as it did before this store existed.
   ============================================================================= */

/** A stateful in-memory namespace: unlike the screen tests' write-only fake,
 *  this one gives back what was set, so a put/load round trip can be asserted. */
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

const PORTFOLIO = "Customer360Portfolio";
const BOOK = { accounts: [{ accountId: "A", tce: 10 }], bookTotals: { accountCount: 1 } };

describe("the book cache", () => {
  it("writes the org book to one document and reads it back with its stamp", async () => {
    await putBook(PORTFOLIO, BOOK, 1_000);
    const back = await loadBook(2_000);
    expect(back?.payload).toEqual(BOOK);
    expect(back?.storedAt).toBe(1_000);
    expect(back?.tool).toBe(PORTFOLIO);
    // ONE document, org-wide, not a per-account slice.
    expect([...store.docs.keys()]).toEqual(["cache/book"]);
  });

  it("records the door a backup answer came through, and nothing else can", async () => {
    await putBook(PORTFOLIO, BOOK, 1_000, "gateway");
    expect((await loadBook(2_000))?.via).toBe("gateway");
    await putBook(PORTFOLIO, BOOK, 3_000);
    expect((await loadBook(4_000))?.via).toBeUndefined();
  });

  it("drops a document older than the age ceiling rather than painting it", async () => {
    await putBook(PORTFOLIO, BOOK, 1_000);
    // Now is far enough past the stamp that the stored book is beyond the ceiling.
    expect(await loadBook(1_000 + MAX_AGE_MS + 1)).toBeNull();
  });

  it("drops a malformed document whole", async () => {
    // A document that never went through putBook: someone else's write, or a
    // schema from another build. It is shape-checked on the way out.
    store.docs.set("cache/book", { storedAt: "nope", tool: PORTFOLIO, payload: BOOK });
    expect(await loadBook(2_000)).toBeNull();
  });

  it("is null when the book has never been stored", async () => {
    expect(await loadBook(2_000)).toBeNull();
  });

  it("skips a document past the size ceiling rather than risk a quota error", async () => {
    const huge = { accounts: [{ accountId: "A", note: "x".repeat(MAX_DOC_BYTES) }] };
    await putBook(PORTFOLIO, huge, 1_000);
    expect(store.docs.size).toBe(0);
    expect(await loadBook(2_000)).toBeNull();
  });

  it("is a silent no-op with no db grant, on both doors", async () => {
    __setDbForTests(undefined);
    await expect(putBook(PORTFOLIO, BOOK, 1_000)).resolves.toBeUndefined();
    await expect(loadBook(2_000)).resolves.toBeNull();
  });
});
