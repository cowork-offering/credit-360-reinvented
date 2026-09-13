/* =============================================================================
   THE SUBSTITUTION SEAM. A HARTWELL MEMO CARRIES NOTHING OF PIEDMONT'S.

   The vendored renderer was written to render one demo, and eight values in it
   are typed into the source rather than read off the dossier. This is the test
   that says so out loud: build a memo for the OTHER borrower on the cockpit's
   live read, run it through the seam, and assert that not one of the demo's
   literals survived.

   IT IS DELIBERATELY BLUNT. The strings below are the demo's own, quoted, so a
   future edit to the renderer that reintroduces one of them fails here and not
   in front of a credit officer.
   ============================================================================= */

import { describe, expect, it } from "vitest";
import live from "../../../artifact/live-data.json";
import type { BorrowerBundle } from "../data/contract";
import { buildMemoDossier } from "./dossier";
import { renderMemo } from "./renderMemo";
import { fmtMoney } from "../data/format";
import {
  applyMemoOverrides,
  HARDCODED_LITERALS,
  MEMO_TYPE_FOR,
  memoDateFrom,
  usesFromChanges,
} from "./overrides";
import { NOT_IN_SOURCE, type MemoChange } from "./types";

const borrowers = live.borrowers as unknown as Record<string, BorrowerBundle>;
const HARTWELL = borrowers["001bb00001I7FPNAA3"];
const PIEDMONT = borrowers["001bb00001DLtRMAA1"];

/**
 * EVERY LITERAL THE DEMO RENDERER PRINTS, as a reader would meet it.
 *
 * NOTE ON "Mazak". The brief asked for a bare "Mazak" assertion, and a bare
 * "Mazak" cannot be one: Hartwell's OWN collateral record in the org names a
 * Mazak tooling cell in Kokomo, so the word legitimately appears in a Hartwell
 * memo through the collateral table. What must not appear is the demo's typed
 * ROW, so the whole row is what is asserted here, twice: the Sources and Uses
 * one and the appendix one.
 */
const PIEDMONT_LITERALS = [
  "Equipment \u2014 3\u00d7 Mazak INTEGREX CNC",
  "Equipment quotes \u2014 3\u00d7 Mazak INTEGREX i-450",
  "Demo Commercial RM",
  "Demo Credit Officer",
  "May 30, 2026",
  "Founder &amp; 100% owner",
  "~$2.5M",
];

/**
 * TWO EXECUTED CHANGES ON HARTWELL, shaped as the trail hands them over: an
 * increase on the line of credit, and a facility the plan CREATED (no `before`,
 * which is how the dossier recognises new money and what switches the Sources
 * and Uses module on in the first place).
 */
const CHANGES: MemoChange[] = [
  {
    id: "write_loan",
    label: "Increase the line of credit to $15.0M",
    target: { kind: "LLC_BI__Loan__c", id: "a4Zbb0000027MaYEAU", name: "Line of Credit" },
    before: { commitment: 12_000_000 },
    after: { commitment: 15_000_000 },
    verification: "Customer360Exposure returned committed 15000000 on a4Zbb0000027MaYEAU",
    orgId: "a4Zbb0000027MaYEAU",
  },
  {
    id: "write_loan_2",
    label: "Book the equipment term loan",
    target: { kind: "LLC_BI__Loan__c", id: "a4Zbb000002CECXEA4", name: "Equipment" },
    after: { commitment: 3_000_000 },
    verification: "Customer360Exposure returned the new facility a4Zbb000002CECXEA4",
    orgId: "a4Zbb000002CECXEA4",
  },
];

const memoFor = (bundle: BorrowerBundle, changes: MemoChange[] = []) => {
  const dossier = buildMemoDossier({ bundle, changes, instanceUrl: live.meta.instanceUrl });
  return applyMemoOverrides(renderMemo(dossier).html, {
    rmName: "Fabian Goetzens",
    creditOfficer: null,
    memoDate: memoDateFrom("2026-09-04T09:12:00Z"),
    memoType: MEMO_TYPE_FOR.modify,
    uses: usesFromChanges(changes, fmtMoney),
    guarantorRelation: "Entity guarantor",
    proFormaFixedCharges: null,
  });
};

describe("the substitution seam", () => {
  it("leaves none of the demo's literals in a Hartwell memo", () => {
    const html = memoFor(HARTWELL, CHANGES);
    for (const literal of PIEDMONT_LITERALS) expect(html).not.toContain(literal);
    expect(html).toContain("Hartwell Precision Manufacturing LLC");
  });

  it("leaves none of them in a Piedmont memo either: the borrower is not the point", () => {
    // The demo's literals are wrong for the borrower they were written about
    // too. "May 30, 2026" is a date the renderer types in, not a date anything
    // happened, and the cover names whoever is in the session.
    const html = memoFor(PIEDMONT, CHANGES);
    for (const literal of PIEDMONT_LITERALS) expect(html).not.toContain(literal);
  });

  it("puts the session's own facts on the cover", () => {
    const html = memoFor(HARTWELL, CHANGES);
    expect(html).toContain("Fabian Goetzens");
    expect(html).toContain("September 4, 2026");
    expect(html).toContain(MEMO_TYPE_FOR.modify);
  });

  it("writes the marker where the cockpit carries nothing, never the demo's value", () => {
    const html = memoFor(HARTWELL, CHANGES);
    // No read carries a credit officer, and none carries scheduled principal.
    expect(html).toContain(NOT_IN_SOURCE);
    expect(html).toContain(`<td>Relationship to borrower</td><td>Entity guarantor</td>`);
  });

  it("builds Sources and Uses from the executed changes", () => {
    const html = memoFor(HARTWELL, CHANGES);
    expect(html).toContain("Sources &amp; Uses");
    expect(html).toContain("Book the equipment term loan");
    expect(html).toContain("Increase the line of credit to $15.0M");
  });

  it("with no executed change, the module the demo's row lives in does not render at all", () => {
    // SUPPRESSED IS NOT A GAP. With nothing created there is no new money, and
    // the conditionality engine switches Sources and Uses off; the demo's row
    // cannot reach the page because the page it is on was never built.
    const html = memoFor(HARTWELL, []);
    expect(html).not.toContain("Sources &amp; Uses");
    for (const literal of PIEDMONT_LITERALS) expect(html).not.toContain(literal);
  });

  it("is applied to a memo the renderer has already finished with", () => {
    // The renderer runs UNTOUCHED, which is what the golden parity test holds
    // it to; the literals are in its output and this is what removes them.
    const raw = renderMemo(buildMemoDossier({ bundle: HARTWELL, changes: CHANGES })).html;
    expect(raw).toContain("Demo Commercial RM");
    expect(applyMemoOverrides(raw, { rmName: "Someone Real" })).not.toContain("Demo Commercial RM");
  });
});

describe("the literal table is the inventory", () => {
  it("names every literal, where it lives and why it cannot stay", () => {
    // 9 to 10 on 2026-09-13: `key_metrics_table` joined the inventory when the
    // founder's report on the Key Metrics table landed (the repeated pro forma
    // column, the capped axis, the covenant test in a fiscal column, and three
    // words for one absence). It is the first entry that replaces a whole block
    // rather than one value; see its `why`.
    expect(HARDCODED_LITERALS.length).toBe(10);
    for (const spec of HARDCODED_LITERALS) {
      expect(spec.id).toBeTruthy();
      expect(spec.where).toMatch(/render-memo\.mjs:\d+/);
      expect(spec.why.length).toBeGreaterThan(20);
    }
    expect(new Set(HARDCODED_LITERALS.map((s) => s.id)).size).toBe(HARDCODED_LITERALS.length);
  });
});

describe("what the room hands the seam", () => {
  it("writes the prepared date the way the cover writes dates, off the one clock", () => {
    expect(memoDateFrom("2026-09-04T09:12:00Z")).toBe("September 4, 2026");
    expect(memoDateFrom(undefined)).toBeNull();
    expect(memoDateFrom("not a date")).toBeNull();
  });

  it("names the memo type from the trigger that opened the room", () => {
    expect(MEMO_TYPE_FOR.renew).toContain("Renewal");
    expect(MEMO_TYPE_FOR.create).toContain("New Facility");
  });

  it("counts a facility increase as its delta and a new facility as its whole commitment", () => {
    const uses = usesFromChanges(
      [
        { id: "a", label: "Increase", target: { kind: "facility", name: "LoC" }, before: { commitment: 5e6 }, after: { commitment: 7.5e6 } },
        { id: "b", label: "Book the term loan", target: { kind: "facility", name: "Equipment" }, after: { commitment: 5e6 } },
        { id: "c", label: "Extend the maturity", target: { kind: "facility", name: "LoC" }, after: { maturity: "2028-01-01" } },
      ],
      fmtMoney,
    );
    expect(uses.map((u) => u.amount)).toEqual(["$2.50M", "$5M"]);
    expect(uses.map((u) => u.source)).toEqual(["LoC", "Equipment"]);
  });
});
