import { describe, it, expect, beforeEach } from "vitest";
import {
  __setDbForTests,
  __resetDbScreenForTests,
  dbRefusals,
  type DbNamespace,
} from "../channel/dbDoor";
import {
  submitBug,
  buildRecord,
  sanitizeForStore,
  clipBytes,
  byteLen,
  MAX_STRING_BYTES,
} from "./bugReport";

/** A minimal store of the db.d.ts shape; __setDbForTests wraps it in the real
 *  guard, so anything that lands in `docs` genuinely passed the door's screen. */
function fakeStore() {
  const docs = new Map<string, Record<string, unknown>>();
  const mkDoc = (path: string) => ({
    id: path,
    path,
    get: async () => ({ id: path, exists: docs.has(path), data: () => docs.get(path) }),
    set: async (d: Record<string, unknown>) => void docs.set(path, d),
    update: async () => {},
    delete: async () => void docs.delete(path),
  });
  const ns: DbNamespace = {
    doc: (path: string) => mkDoc(path),
    collection: (cpath: string) => ({
      path: cpath,
      doc: (id?: string) => mkDoc(`${cpath}/${id ?? "auto"}`),
      where() {
        return this as never;
      },
      orderBy() {
        return this as never;
      },
      limit() {
        return this as never;
      },
      get: async () => ({ docs: [] }),
      onSnapshot: () => () => {},
    }),
  };
  return { ns, docs };
}

beforeEach(() => {
  __resetDbScreenForTests();
  __setDbForTests(undefined);
});

describe("sanitize + clip", () => {
  it("breaks the exact tokens the store's firewall screen rejects", () => {
    const s = sanitizeForStore('<script>x</script> javascript:go onerror= onload =');
    expect(/<script/i.test(s)).toBe(false);
    expect(/javascript:/i.test(s)).toBe(false);
    expect(/onerror\s*=/i.test(s)).toBe(false);
    expect(/onload\s*=/i.test(s)).toBe(false);
  });

  it("clips a huge string well under the 32 KB field cap", () => {
    const huge = "a".repeat(100_000);
    const clipped = clipBytes(huge);
    expect(byteLen(clipped)).toBeLessThan(MAX_STRING_BYTES);
    expect(clipped.endsWith("…(truncated)")).toBe(true);
  });
});

describe("buildRecord", () => {
  it("carries the picks, note and transcript, and stamps status open", () => {
    const r = buildRecord({
      categories: ["Loop / stuck", "Repeating itself"],
      comment: "  it kept asking the same thing  ",
      transcript: "**You:** hi\n\n**Desk:** hi",
      surface: "Modification — Hartwell Precision",
      accountName: "Hartwell Precision",
      bookAsOf: "2026-08-25T04:55:34Z",
    });
    expect(r.categories).toEqual(["Loop / stuck", "Repeating itself"]);
    expect(r.comment).toBe("it kept asking the same thing");
    expect(r.transcript).toContain("Desk");
    expect(r.status).toBe("open");
    expect(r.accountName).toBe("Hartwell Precision");
  });
});

describe("submitBug", () => {
  it("writes to the store and returns 'stored'", async () => {
    const { ns, docs } = fakeStore();
    __setDbForTests(ns);
    const out = await submitBug(
      {
        categories: ["Inaccurate information"],
        comment: "wrong DSCR",
        transcript: "**You:** check\n\n**Desk:** 1.2x",
        surface: "Covenant review — Piedmont",
        accountName: "Piedmont",
      },
      async () => true,
    );
    expect(out).toBe("stored");
    const entries = [...docs.entries()].filter(([k]) => k.startsWith("bugs/"));
    expect(entries).toHaveLength(1);
    expect((entries[0][1] as { categories: string[] }).categories).toEqual(["Inaccurate information"]);
  });

  it("a transcript with markup and a giant body still passes the door (no refusal, doc lands)", async () => {
    const { ns, docs } = fakeStore();
    __setDbForTests(ns);
    const out = await submitBug(
      {
        categories: ["Crash / error"],
        comment: "broke on <iframe> and <script>alert(1)</script>",
        transcript: "start " + "x".repeat(60_000) + " javascript:boom <script>evil</script>",
        surface: "Modification — Hartwell",
      },
      async () => true,
    );
    expect(out).toBe("stored");
    expect([...docs.keys()].some((k) => k.startsWith("bugs/"))).toBe(true);
    expect(dbRefusals()).toHaveLength(0); // the record was clean when it reached the door
  });

  it("no category and no note is a no-op", async () => {
    const { ns } = fakeStore();
    __setDbForTests(ns);
    const out = await submitBug(
      { categories: [], comment: "   ", transcript: "x", surface: "s" },
      async () => true,
    );
    expect(out).toBe("empty");
  });

  it("no store falls back to the clipboard", async () => {
    __setDbForTests(undefined);
    let copied = "";
    const out = await submitBug(
      { categories: ["Other"], comment: "note", transcript: "**You:** hi", surface: "Cockpit chat" },
      async (t) => {
        copied = t;
        return true;
      },
    );
    expect(out).toBe("copied");
    expect(copied).toContain("Cockpit feedback");
    expect(copied).toContain("Other");
  });
});
