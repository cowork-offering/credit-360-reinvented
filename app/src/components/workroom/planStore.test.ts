import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_LABEL_CHARS,
  MAX_SAID,
  PLAN_COLLECTION,
  PLAN_TTL_MS,
  RESUMED_NOTE,
  clearPlan,
  isResumeSay,
  isStartOverSay,
  planDocId,
  planIsFresh,
  plannedAt,
  readPlanDoc,
  readStoredPlan,
  resumeOffer,
  savePlan,
  type StagedPlanDoc,
} from "./planStore";

/* =============================================================================
   THE PLAN STORE, ON ITS OWN.

   Two things it has to be right about. First, WHAT IT STORES: a token, a
   staging id or a plan hash in a document any Claude session can read is the
   defect this design exists to avoid, and a test that only checked the happy
   path would never catch one being added. Second, WHAT IT TRUSTS: everything
   read back was written by somebody else, so a document that is wrong in any
   way is a document there is no offer for.
   ============================================================================= */

const ACCOUNT = "001bb00001I7FPNAA3";
const PACKAGE = "a5Fbb000000IHFJEA4";

/** A store the size of one page, with its calls on the record. */
function fakeStore() {
  const docs = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  const ns = {
    doc: () => {
      throw new Error("not used");
    },
    collection: (path: string) => ({
      path,
      doc: (id: string) => ({
        id,
        path: `${path}/${id}`,
        get: async () => {
          calls.push(`get ${path}/${id}`);
          const data = docs.get(`${path}/${id}`);
          return { id, exists: data !== undefined, data: () => data };
        },
        set: async (data: Record<string, unknown>) => {
          calls.push(`set ${path}/${id}`);
          docs.set(`${path}/${id}`, data);
        },
        update: async () => {},
        delete: async () => {
          calls.push(`delete ${path}/${id}`);
          docs.delete(`${path}/${id}`);
        },
      }),
      where: () => ns.collection(path),
      orderBy: () => ns.collection(path),
      limit: () => ns.collection(path),
      get: async () => ({ docs: [] }),
      onSnapshot: () => () => {},
    }),
  };
  return { ns, docs, calls };
}

let store: ReturnType<typeof fakeStore>;

beforeEach(() => {
  store = fakeStore();
  (globalThis as { window?: unknown }).window = globalThis;
  (globalThis as unknown as { claude?: unknown }).claude = { db: store.ns };
});

afterEach(() => {
  delete (globalThis as unknown as { claude?: unknown }).claude;
  vi.useRealTimers();
});

const snapshot = () => ({
  accountId: ACCOUNT,
  accountName: "Hartwell Precision Manufacturing LLC",
  packageId: PACKAGE,
  packageName: "the Hartwell C&I package",
  route: "modify" as const,
  said: ["increase the revolving line of credit to 18 million"],
  cards: [{ title: "Commitment amount", target: "Line of Credit ($15M)", after: "$18M" }],
});

describe("what the document holds", () => {
  it("stores the banker's lines and the cards they made, and nothing else", async () => {
    await savePlan(snapshot());
    const doc = store.docs.get(`${PLAN_COLLECTION}/${planDocId(ACCOUNT, PACKAGE, "modify")}`)!;
    expect(Object.keys(doc).sort()).toEqual(
      ["accountId", "accountName", "cards", "packageId", "packageName", "route", "said", "stagedAt"].sort(),
    );
  });

  it("never writes a decision token, a staging id, a plan hash or a payload", async () => {
    await savePlan(snapshot());
    const written = JSON.stringify([...store.docs.values()]);
    for (const forbidden of ["decisionToken", "stagingId", "planHash", "idempotencyKey", "approverUserId", "payload"]) {
      expect(written).not.toContain(forbidden);
    }
  });

  it("is one document per package per engine, so a second session overwrites", async () => {
    await savePlan(snapshot());
    await savePlan({ ...snapshot(), said: ["extend the maturity to 2031"] });
    expect(store.docs.size).toBe(1);
  });

  it("keeps the newest lines when a banker says more than the cap", async () => {
    const many = Array.from({ length: MAX_SAID + 5 }, (_, i) => `line ${i}`);
    await savePlan({ ...snapshot(), said: many });
    const doc = store.docs.get(`${PLAN_COLLECTION}/${planDocId(ACCOUNT, PACKAGE, "modify")}`)!;
    expect((doc.said as string[]).length).toBe(MAX_SAID);
    expect((doc.said as string[])[MAX_SAID - 1]).toBe(`line ${many.length - 1}`);
  });

  it("writes nothing at all when there is nothing the banker said", async () => {
    await savePlan({ ...snapshot(), said: [] });
    expect(store.docs.size).toBe(0);
  });

  it("does not reach for a store this view does not have", async () => {
    delete (globalThis as unknown as { claude?: unknown }).claude;
    await expect(savePlan(snapshot())).resolves.toBeUndefined();
    await expect(readStoredPlan(ACCOUNT, PACKAGE, "modify")).resolves.toBeNull();
  });
});

describe("what the reader trusts", () => {
  const good = {
    accountId: ACCOUNT,
    accountName: "Hartwell",
    packageId: PACKAGE,
    packageName: "the C&I package",
    route: "modify",
    said: ["a line"],
    cards: [{ title: "Commitment amount", target: "Line of Credit", after: "$18M" }],
    stagedAt: new Date().toISOString(),
  };

  it("reads a well-formed document", () => {
    expect(readPlanDoc("id", good)).not.toBeNull();
  });

  it("drops a document that names no account, package, route or time", () => {
    for (const field of ["accountId", "packageId", "route", "stagedAt"]) {
      expect(readPlanDoc("id", { ...good, [field]: undefined })).toBeNull();
    }
  });

  it("drops a route that is not one of the three engines", () => {
    expect(readPlanDoc("id", { ...good, route: "annual" })).toBeNull();
    expect(readPlanDoc("id", { ...good, route: "../../etc/passwd" })).toBeNull();
  });

  it("drops a document with no lines to re-say, because there is nothing to resume", () => {
    expect(readPlanDoc("id", { ...good, said: [] })).toBeNull();
    expect(readPlanDoc("id", { ...good, said: [42, null] })).toBeNull();
  });

  it("clips a line somebody made very long rather than refusing the plan", () => {
    const doc = readPlanDoc("id", { ...good, said: ["x".repeat(9000)] })!;
    expect(doc.said[0].length).toBe(400);
  });

  it("drops the cards it cannot read and keeps the plan", () => {
    const doc = readPlanDoc("id", { ...good, cards: [{ title: "ok", target: "there" }, "nonsense", { title: 3 }] })!;
    expect(doc.cards).toEqual([{ title: "ok", target: "there", after: "" }]);
  });

  it("names a package it was not told about rather than rendering an empty sentence", () => {
    const doc = readPlanDoc("id", { ...good, packageName: undefined })!;
    expect(doc.packageName).toBe("the package you had open");
    expect(resumeOffer(doc)).toContain("on the package you had open");
  });

  it("refuses a timestamp that is not a time", () => {
    expect(readPlanDoc("id", { ...good, stagedAt: "whenever" })).toBeNull();
  });

  it("stops offering a plan older than a week", () => {
    const old: StagedPlanDoc = { ...readPlanDoc("id", good)!, stagedAt: new Date(Date.now() - PLAN_TTL_MS - 1000).toISOString() };
    expect(planIsFresh(old)).toBe(false);
    expect(planIsFresh(readPlanDoc("id", good)!)).toBe(true);
  });
});

describe("the round trip", () => {
  it("comes back with the lines the banker said", async () => {
    await savePlan(snapshot());
    const back = await readStoredPlan(ACCOUNT, PACKAGE, "modify");
    expect(back?.said).toEqual(["increase the revolving line of credit to 18 million"]);
    expect(back?.cards[0].after).toBe("$18M");
  });

  it("comes back empty for a package nothing was left on", async () => {
    await savePlan(snapshot());
    expect(await readStoredPlan(ACCOUNT, "a5Fbb000000OTHER", "modify")).toBeNull();
  });

  it("is gone once the plan is cleared", async () => {
    await savePlan(snapshot());
    await clearPlan(ACCOUNT, PACKAGE, "modify");
    expect(await readStoredPlan(ACCOUNT, PACKAGE, "modify")).toBeNull();
  });

  it("survives a store that answers slowly, and gives up on one that does not answer", async () => {
    vi.useFakeTimers();
    (globalThis as unknown as { claude?: unknown }).claude = {
      db: {
        doc: () => {},
        collection: () => ({ doc: () => ({ get: () => new Promise(() => {}) }) }),
      },
    };
    const pending = readStoredPlan(ACCOUNT, PACKAGE, "modify");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toBeNull();
  });
});

describe("what the room says", () => {
  const doc = readPlanDoc("id", {
    accountId: ACCOUNT,
    accountName: "Hartwell",
    packageId: PACKAGE,
    packageName: "the Hartwell C&I package",
    route: "modify",
    said: ["a line", "another line"],
    cards: [
      { title: "Commitment amount", target: "Line of Credit", after: "$18M" },
      { title: "Maturity date", target: "Line of Credit", after: "2031-06-30" },
    ],
    stagedAt: new Date(2026, 8, 5, 20, 14).toISOString(),
  })!;

  it("names the package, the time and how much was on the manifest", () => {
    expect(resumeOffer(doc)).toBe(
      "You left a plan on the Hartwell C&I package at 20:14, 2 changes on the manifest. " +
        "I can say those lines again and put the manifest back, or you can start over on an empty rail.",
    );
  });

  it("counts one change as a change", () => {
    expect(resumeOffer({ ...doc, cards: doc.cards.slice(0, 1) })).toContain("1 change on the manifest");
  });

  it("reads the clock as a banker does", () => {
    expect(plannedAt(doc)).toBe("20:14");
  });

  it("says the resumed plan is not staged, because the token from before is spent", () => {
    expect(RESUMED_NOTE).toContain("Nothing is staged yet");
    expect(RESUMED_NOTE).toContain("decision token from before is spent");
  });

  it("keeps every sentence sober: no apology, no exclamation, no em dash", () => {
    for (const line of [resumeOffer(doc), RESUMED_NOTE]) {
      expect(line).not.toMatch(/!/);
      expect(line).not.toMatch(/—/);
      expect(line).not.toMatch(/\bsorry\b|\bapolog/i);
    }
  });

  it("recognises its own two chips and nothing else", () => {
    expect(isResumeSay("resume the plan I left")).toBe(true);
    expect(isResumeSay("  Resume the plan i left  ")).toBe(true);
    expect(isResumeSay("resume the plan I left and file it")).toBe(false);
    expect(isStartOverSay("start over on an empty rail")).toBe(true);
    expect(isStartOverSay("start over")).toBe(false);
  });

  it("clips a package name nobody should have made that long", async () => {
    await savePlan({ ...snapshot(), packageName: "z".repeat(500) });
    const back = await readStoredPlan(ACCOUNT, PACKAGE, "modify");
    expect(back!.packageName.length).toBe(MAX_LABEL_CHARS);
  });
});
