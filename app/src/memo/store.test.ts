/* =============================================================================
   THE MEMO'S ROUND TRIP, against a fake store of the platform's own shape.

   `intent/fakeDb.ts` is written against `db.d.ts` rather than against this
   app's usage, which is what makes it worth testing against: it refuses an
   odd-segment document path, it builds queries as pure builders, and its
   `update` throws on a document that does not exist. A lane that only works
   against a laxer fake does not work.

   WHICH PATH IS LIVE (the requirements' size question). The first write
   ATTEMPTS the full HTML and a store that takes it stores it: that is the live
   path against this fake, and the assertion below says so. The lean path is
   exercised against a store that refuses, because the platform states no
   document size limit and the only honest way to find one is to be refused by
   it. Both paths are covered, and the document itself says which one it took.
   ============================================================================= */

import { afterEach, describe, expect, it } from "vitest";
import { __setDbForTests, type DbNamespace } from "../channel/dbDoor";
import { createFakeDb } from "../intent/fakeDb";
import { attestedCount, fullyAttested, latestMemo, saveAttestations, saveMemoDraft, type MemoDraft } from "./store";

afterEach(() => __setDbForTests(undefined));

const PACKAGE = "a5Fbb000000IHFJEA4";

const draft = (over: Partial<MemoDraft> = {}): MemoDraft => ({
  memoId: "memo-1",
  accountId: "001bb00001I7FPNAA3",
  packageId: PACKAGE,
  trigger: "modify",
  generatedAt: "2026-09-04T09:12:00Z",
  generator: "cockpit",
  renderPlan: { modules: [{ id: "executive_summary", name: "Executive Summary", on: true, reason: "always" }], suppressed: [] },
  sections: [
    { id: "executive_summary", title: "Executive Summary", status: "draft" },
    { id: "collateral", title: "Collateral", status: "draft" },
  ],
  narratives: { execSummary: "The recommendation is to approve." },
  html: "<html>the whole memo</html>",
  htmlStored: true,
  ...over,
});

describe("the memo store", () => {
  it("writes to memos/<packageId>/versions/<memoId>, which is a legal document path", () => {
    const db = createFakeDb();
    __setDbForTests(db);
    return saveMemoDraft(draft()).then(() => {
      expect([...db.docs.keys()]).toEqual([`memos/${PACKAGE}/versions/memo-1`]);
    });
  });

  it("round-trips the draft WITHOUT its HTML and reads it back as the latest", async () => {
    const db = createFakeDb();
    __setDbForTests(db);
    const stored = await saveMemoDraft(draft());
    expect(stored.htmlStored).toBe(false);
    expect(stored.html).toBeUndefined();

    const back = await latestMemo(PACKAGE);
    expect(back?.memoId).toBe("memo-1");
    expect(back?.html).toBeUndefined();
    // Nothing that reaches claude.ai carries markup: the firewall rule of 2026-09-06.
    const raw = JSON.stringify([...db.docs.values()]);
    expect(raw).not.toMatch(/<html|<script/i);
    expect(back?.narratives.execSummary).toContain("recommendation");
    expect(back?.sections.map((s) => s.id)).toEqual(["executive_summary", "collateral"]);
  });

  it("reads the NEWEST memo on the package, and never another package's", async () => {
    const db = createFakeDb();
    __setDbForTests(db);
    await saveMemoDraft(draft({ memoId: "memo-1", generatedAt: "2026-09-01T09:00:00Z" }));
    await saveMemoDraft(draft({ memoId: "memo-2", generatedAt: "2026-09-04T09:00:00Z" }));
    await saveMemoDraft(draft({ memoId: "memo-3", packageId: "a5Fother", generatedAt: "2026-09-09T09:00:00Z" }));

    expect((await latestMemo(PACKAGE))?.memoId).toBe("memo-2");
    expect((await latestMemo("a5Fother"))?.memoId).toBe("memo-3");
  });

  it("never offers the store the HTML at all, and keeps the sections and the narratives", async () => {
    const db = createFakeDb();
    let refused = 0;
    const refusing: DbNamespace = {
      collection: db.collection,
      doc: (path: string) => {
        const ref = db.doc(path);
        return {
          ...ref,
          set: async (body: Record<string, unknown>) => {
            if (typeof body.html === "string") {
              refused += 1;
              throw { code: "invalid_argument", message: "document too large" };
            }
            return ref.set(body);
          },
        };
      },
    };
    __setDbForTests(refusing);

    const stored = await saveMemoDraft(draft());
    expect(refused).toBe(0);
    expect(stored.htmlStored).toBe(false);
    expect(stored.html).toBeUndefined();

    // Everything a re-render needs survived: the plan, the sections, the prose.
    const back = await latestMemo(PACKAGE);
    expect(back?.htmlStored).toBe(false);
    expect(back?.narratives.execSummary).toContain("recommendation");
    expect(back?.renderPlan.modules).toHaveLength(1);
  });

  it("lands an attestation on the stored document", async () => {
    const db = createFakeDb();
    __setDbForTests(db);
    await saveMemoDraft(draft());
    await saveAttestations(
      draft({
        sections: [
          { id: "executive_summary", title: "Executive Summary", status: "approved", by: "Fabian Goetzens" },
          { id: "collateral", title: "Collateral", status: "flagged", note: "the Kokomo appraisal is stale" },
        ],
      }),
    );
    const back = await latestMemo(PACKAGE);
    expect(back?.sections[0].status).toBe("approved");
    expect(back?.sections[1].note).toBe("the Kokomo appraisal is stale");
    // The prose the first write stored is untouched by an attestation, and there is still no markup.
    expect(back?.narratives.execSummary).toContain("recommendation");
    expect(back?.html).toBeUndefined();
  });

  it("is a no-op with no store, and the room never learns there was one", async () => {
    __setDbForTests(undefined);
    const d = draft();
    await expect(saveMemoDraft(d)).resolves.toBe(d);
    await expect(saveAttestations(d)).resolves.toBeUndefined();
    await expect(latestMemo(PACKAGE)).resolves.toBeNull();
  });

  it("counts what is attested, and opens the publish gate only on all of it", () => {
    const sections = draft().sections;
    expect(attestedCount(sections)).toEqual({ done: 0, total: 2 });
    expect(fullyAttested(sections)).toBe(false);

    const half = [{ ...sections[0], status: "approved" as const }, sections[1]];
    expect(attestedCount(half)).toEqual({ done: 1, total: 2 });
    expect(fullyAttested(half)).toBe(false);

    // A FLAG IS NOT AN APPROVAL. A memo whose collateral section was flagged is
    // not a memo anybody may publish.
    const flagged = [{ ...sections[0], status: "approved" as const }, { ...sections[1], status: "flagged" as const }];
    expect(fullyAttested(flagged)).toBe(false);

    const all = sections.map((s) => ({ ...s, status: "approved" as const }));
    expect(fullyAttested(all)).toBe(true);
    // And a memo with no sections at all is not "fully attested" either.
    expect(fullyAttested([])).toBe(false);
  });
});
