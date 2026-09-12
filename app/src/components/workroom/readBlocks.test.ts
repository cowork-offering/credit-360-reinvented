import { describe, expect, it } from "vitest";
import { buildReadBlocks, threadDigest } from "./readBlocks";
import {
  ENVELOPE_BLOCK_DROP_ORDER,
  ENVELOPE_CAP_BYTES,
  capEnvelope,
  type BrainEnvelope,
  type BrainTurn,
} from "../../channel/brainLane";
import type { C360Data } from "../../data/contract";
import live from "../../../../artifact/live-data.json";

/* =============================================================================
   THE ENVELOPE IS NO LONGER BLIND (F2).

   Three times in the 2026-09-01 drive the brain reported that the data was not
   carried, over a bundle that was holding it the whole time. These hold the
   other half of that fix: that what the room read travels, that it travels in
   the room's own printed form, that what NO read carries is named rather than
   silently absent, and that a long conversation gives up its history before it
   gives up a covenant threshold.
   ============================================================================= */

const data = live as unknown as C360Data;
const accountId = "001bb00001I7FPNAA3";
const bundle = data.borrowers![accountId];
const src = {
  bundle,
  accountName: bundle.snapshot!.name!,
  productPackageId: bundle.snapshot!.productPackageId ?? null,
};

describe("what the room read travels with the line", () => {
  const blocks = buildReadBlocks(src)!;

  it("carries the covenant tests with thresholds, verdicts and their scope", () => {
    expect(blocks.covenants?.length).toBeGreaterThan(0);
    const row = blocks.covenants![0];
    expect(row.name.length).toBeGreaterThan(0);
    expect(row.status.length).toBeGreaterThan(0);
    expect(row.scope.length).toBeGreaterThan(0);
  });

  /* THE FIGURE IN ITS OWN UNIT (2026-09-02). The envelope carried raw numbers:
     a threshold of "1.25" and a measured value of "5000000". A line item's rail
     printing "5000000" is worse than no rail, so the block now formats through
     the room's OWN covenant helpers, and the card and the remark can no longer
     write the same test two different ways. */
  it("prints every covenant in the unit its type carries, never a raw number", () => {
    const by = new Map(blocks.covenants!.map((c) => [c.name, c]));
    expect(by.get("Debt Service Coverage of Borrower")).toMatchObject({ measured: "1.38×", threshold: "≥ 1.25×" });
    expect(by.get("Maximum Debt to Worth")).toMatchObject({ measured: "2.42×", threshold: "≤ 3.00×" });
    // "≥", not "≤": Accounts Receivable matches neither the cap nor the floor
    // hint list, so `covenantDirection` falls to its magnitude rule and 80
    // against 80 reads as a floor. That is what the room's own card prints
    // beside it, which is the only thing that matters here: one test, one unit,
    // in both places.
    expect(by.get("Accounts Receivable")).toMatchObject({ measured: "80%", threshold: "≤ 80%" });
    expect(by.get("Minimum Liquidity")).toMatchObject({ measured: "$6.20M", threshold: "≥ $5M" });
    expect(by.get("Debt Service Coverage with and without Distributions")).toMatchObject({
      measured: "1.31×",
      threshold: "≥ 1.15×",
    });
    // A test the org carries no threshold for says so, and carries no measure.
    expect(by.get("Term Covenants")).toMatchObject({ threshold: "not carried", measured: undefined });
    for (const row of blocks.covenants!) expect(row.threshold).not.toMatch(/^\d/);
  });

  it("carries the frequency and the verdict's own severity, for the row's colour", () => {
    const dsc = blocks.covenants!.find((c) => c.name === "Debt Service Coverage of Borrower")!;
    expect(dsc.frequency).toBe("Quarterly");
    expect(dsc.severity).toBe("clear");
    for (const row of blocks.covenants!) {
      expect(["breach", "watch", "clear", "neutral", undefined]).toContain(row.severity);
    }
  });

  it("carries who is on the deal, with the role the org wrote", () => {
    expect(blocks.involvements?.length).toBeGreaterThan(0);
    expect(blocks.involvements!.every((r) => r.name.length > 0 && r.role.length > 0)).toBe(true);
    // The corporate/person split is the ORG'S OWN WORD or it is absent. A kind
    // guessed off a name is exactly the invention the pack forbids.
    for (const row of blocks.involvements!) {
      expect(row.kind === undefined || row.kind === "person" || row.kind === "corporate").toBe(true);
    }
  });

  it("sends ONE row per party per role, never the org's row per loan", () => {
    /* The org writes the involvement once per loan: the pinned read carries 26
       rows for 5 parties, 16 of them guaranty rows. Sent raw, the desk answered
       a guarantor question with "16 guaranty rows are on this package", which is
       a sentence about nCino's storage shape and not about the credit. */
    const raw = src.bundle!.graph!.legalEntities!;
    expect(raw.length).toBe(26);
    const rows = blocks.involvements!;
    expect(rows.map((r) => [r.name, r.role, r.facilities])).toEqual([
      ["Hartwell Precision Manufacturing LLC", "Borrower", 9],
      ["Hartwell Industrial Holdings LLC", "Guarantor", 6],
      ["James Hartwell", "Guarantor", 8],
      ["Elena Hartwell", "Limited Guarantor", 2],
      ["Hartwell Logistics LLC", "Related Entity", 1],
    ]);
    // The facilities travel BY NAME, so "who guarantees the construction loan"
    // is answered off this block rather than sent back for another read. Two
    // Lines of Credit and two Equipment loans sit on this package, so the name
    // carries the commitment wherever the product word alone names both.
    expect(rows[3].scope).toBe("Construction, Line of Credit ($15M)");
    expect(rows[1].scope).toContain("Line of Credit ($2.50M)");
  });

  it("carries the exposure and the pricing AS STORED", () => {
    expect(blocks.exposure?.committed).toMatch(/^\$/);
    expect(blocks.exposure?.drawn).toMatch(/^\$/);
    expect((blocks.exposure?.facilities ?? 0) > 0).toBe(true);
    for (const row of blocks.pricing ?? []) expect(row.rate).toMatch(/%$/);
  });

  /* THE TOTAL SAYS WHICH BOOK IT IS OVER. The cockpit chat sums every active
     facility on the relationship ($57M / 9 on Hartwell) and this sums the
     anchored package ($49M / 7). Both are honest; neither said which, so one
     deal read as two figures depending on which surface the banker asked. */
  it("names the scope of its own totals, because the chat totals a different book", () => {
    const anchored = buildReadBlocks({ ...src, productPackageId: "a5Fbb000000IHFJEA4" })!;
    expect(anchored.exposure).toEqual({ committed: "$49M", drawn: "$31.03M", available: "$17.97M", facilities: 7, scope: "on this package" });
    // Unanchored, the same builder is reading the whole relationship, and says so.
    expect(blocks.exposure).toMatchObject({ committed: "$57M", facilities: 9, scope: "across the relationship" });
  });

  /* THE OBLIGOR GROUP (golden rule 1, finding B4). `graph.legalEntities` says
     who is on the DEAL; `graph.connections` says who the borrower IS connected
     to, and only the first travelled. The parent read as a guarantor, the
     affiliate as a role on one loan, and the 60/40 between the two owners was
     dropped outright by the involvement block's own detail rule. */
  it("carries the obligor group: the parent, the affiliate and the owners with their ownership", () => {
    expect(blocks.group).toEqual([
      { name: "Hartwell Industrial Holdings LLC", relation: "parent", role: undefined, ownership: "100%", grade: "4" },
      { name: "Hartwell Logistics LLC", relation: "affiliate", role: "Affiliated Company", ownership: undefined, grade: undefined },
      // "Owner" says exactly what the relation says, so it does not travel twice.
      { name: "James Hartwell", relation: "owner", role: undefined, ownership: "60%", grade: undefined },
      { name: "Elena Hartwell", relation: "owner", role: "Co-Owner", ownership: "40%", grade: undefined },
    ]);
  });

  it("keeps the side of a two-ended link that says the most, never the 0% reverse row", () => {
    // The graph writes the parent twice: `Parent` inbound at 100% and `Child`
    // outbound at 0%. One counterparty, one row, and it is the one that reads.
    const names = blocks.group!.map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
    expect(blocks.group!.every((g) => g.relation !== "subsidiary")).toBe(true);
  });

  it("refuses the downstream book BY NAME, because no read on this cockpit opens it", () => {
    const said = blocks.notCarried.join(" ");
    expect(said).toMatch(/a guarantor's, parent's or affiliate's OWN exposure/);
    expect(said).toMatch(/cross-default/);
    expect(said).toMatch(/depends on one of them/);
  });

  it("names the obligor group itself where the read stages no graph for it", () => {
    const noGraph = buildReadBlocks({ ...src, bundle: { ...bundle, graph: { legalEntities: bundle.graph?.legalEntities } } })!;
    expect(noGraph.group).toBeUndefined();
    expect(noGraph.notCarried.join(" ")).toMatch(/the obligor group - parent, affiliates, subsidiaries and owners/);
    // And it is NOT said where the group actually travels.
    expect(blocks.notCarried.join(" ")).not.toMatch(/the obligor group - parent/);
  });

  it("NEVER carries an index name, because the org does not store one", () => {
    expect(JSON.stringify(blocks)).not.toMatch(/SOFR|LIBOR|Prime rate/i);
    expect(blocks.notCarried.join(" ")).toMatch(/index name/);
  });

  it("names the fees it cannot list rather than reporting none", () => {
    // No read tool puts fee rows on the bundle. An absent block reported as an
    // empty fact is the failure the whole grounding pass exists to end.
    expect(blocks.notCarried.join(" ")).toMatch(/fees/);
  });

  it("refuses the THREAD by name only where the envelope actually carries mail", () => {
    // A connector-less room must not talk about a mailbox it never looked at.
    // A room WITH one must be able to refuse the rest of the exchange by name
    // rather than passing its single search hit off as the whole thing.
    expect(blocks.notCarried.join(" ")).not.toMatch(/correspondence/);
    const withMail = buildReadBlocks(src, true)!;
    expect(withMail.notCarried.join(" ")).toMatch(/correspondence beyond the one message/);
    expect(withMail.notCarried.length).toBe(blocks.notCarried.length + 1);
  });

  it("is absent altogether where the room stands on no read", () => {
    expect(buildReadBlocks(undefined)).toBeUndefined();
    expect(buildReadBlocks({ bundle: null, accountName: "x", productPackageId: null })).toBeUndefined();
  });
});

/* =============================================================================
   WHY THE ROOM IS LOCKED (golden rule 1, finding B5).

   `book/packages.ts` already computes the version chain for the pickers, and the
   room already enforces it. The envelope carried none of it, so a banker asking
   "why can I not modify this" was answered by a model that had never been told a
   version of this package is sitting unbooked with the org. The fixture is
   Hartwell's own live fork, the same shape `book/packages.test.ts` pins.
   ============================================================================= */

describe("the version in flight travels with the read", () => {
  const SOURCE = "a5Fbb000000J6BNEA0";
  const VERSION = "a5Fbb000000JFzREAW";
  const loan = (over: Record<string, unknown>) => ({ status: "Open", productPackageId: SOURCE, stage: "Booked", ...over });
  const forked = (stage = "Qualification") => ({
    snapshot: { accountId: "001bb00001I7FPNAA3", name: "Hartwell Precision Manufacturing LLC" },
    exposure: {
      facilities: [
        loan({ loanId: "a4Zbb000002ICnyEAG", name: "Hartwell - Equipment - $1,500,000.00", committed: 1_500_000 }),
        loan({ loanId: "a4Zbb000002ICnxEAG", name: "Hartwell - Purchase - $6,500,000.00", committed: 6_500_000 }),
        loan({ loanId: "a4Zbb000002KFD3EAO", name: "Hartwell - Equipment - $1,500,000.00", committed: 1_500_000, productPackageId: VERSION, stage }),
        loan({ loanId: "a4Zbb000002KFD4EAO", name: "Hartwell - Purchase - $12,000,000.00", committed: 12_000_000, productPackageId: VERSION, stage }),
      ],
    },
  }) as unknown as typeof bundle;

  it("says the source package is locked, and why, in the words the picker uses", () => {
    const blocks = buildReadBlocks({ bundle: forked(), accountName: "Hartwell", productPackageId: SOURCE })!;
    expect(blocks.inFlight).toEqual({
      version: undefined,
      hasInFlightModification: true,
      versionId: VERSION,
      editable: undefined,
      reason: "Modification in Progress - a version of this package is unbooked with the org, and a second one would fork the version chain",
    });
  });

  it("says the room is standing IN the version, and whether it is still the banker's", () => {
    const open = buildReadBlocks({ bundle: forked(), accountName: "Hartwell", productPackageId: VERSION })!;
    expect(open.inFlight).toMatchObject({ version: true, editable: true });
    expect(open.inFlight!.reason).toContain("editable until approval");
    const taken = buildReadBlocks({ bundle: forked("Approval / Loan Committee"), accountName: "Hartwell", productPackageId: VERSION })!;
    expect(taken.inFlight).toMatchObject({ version: true, editable: false });
    expect(taken.inFlight!.reason).toContain("in approval");
  });

  it("is absent where the roster names no version on either side", () => {
    expect(buildReadBlocks(src)!.inFlight).toBeUndefined();
  });
});

describe("the conversation travels, banker verbatim", () => {
  it("keeps the last exchanges, oldest first, and clips only the room's own words", () => {
    const turns: BrainTurn[] = [
      ...Array.from({ length: 8 }, (_, i) => ({ who: "banker" as const, text: `line ${i}` })),
      { who: "agent" as const, text: "x".repeat(400) },
    ];
    const digest = threadDigest(turns)!;
    expect(digest).toHaveLength(6);
    expect(digest[0].text).toBe("line 3");
    expect(digest[5].text.length).toBeLessThan(200);
    expect(digest[5].text.endsWith("...")).toBe(true);
  });

  it("is absent where nothing has been said", () => {
    expect(threadDigest([])).toBeUndefined();
    expect(threadDigest([{ who: "banker", text: "   " }])).toBeUndefined();
  });
});

describe("the envelope holds to its budget, and says what it dropped", () => {
  const base = (): BrainEnvelope => ({
    v: 2,
    line: "what covenants are on this",
    room: "facility",
    relationship: "Hartwell Precision Manufacturing LLC",
    route: "modify",
    packageName: "Hartwell Industrial C&I Credit Package",
    productPackageId: "a5Fbb000000IHFJEA4",
    selectedFacility: null,
    facilities: [],
    staged: [],
    reads: buildReadBlocks(src),
    grounding: "plugin-skill:workroom-brain",
  });

  it("leaves an envelope inside the budget exactly as it was", () => {
    const envelope = base();
    expect(JSON.stringify(envelope).length).toBeLessThanOrEqual(ENVELOPE_CAP_BYTES);
    expect(capEnvelope(envelope)).toEqual(envelope);
  });

  it("gives up thread history BEFORE it gives up a read block", () => {
    const envelope: BrainEnvelope = {
      ...base(),
      thread: Array.from({ length: 6 }, (_, i) => ({ who: "banker" as const, text: `${i} `.repeat(900) })),
    };
    expect(JSON.stringify(envelope).length).toBeGreaterThan(ENVELOPE_CAP_BYTES);
    const capped = capEnvelope(envelope);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(ENVELOPE_CAP_BYTES);
    expect(capped.omitted).toContain("earlier conversation");
    // The covenants survived: an answer without the last exchanges is a worse
    // conversation; an answer without the thresholds is a wrong one.
    expect(capped.reads?.covenants?.length).toBe(envelope.reads?.covenants?.length);
  });

  it("gives up the client's mail LAST, and names it when it does", () => {
    const mail = {
      source: "mailbox" as const,
      from: "james@hartwellprecision.com",
      received: "Aug 28, 2026",
      subject: "Equipment loan renewal",
      gist: "Asking whether the equipment loan can roll when it matures.",
    };
    // Inside the budget the mail simply travels.
    const fits: BrainEnvelope = { ...base(), mail };
    expect(capEnvelope(fits).mail).toEqual(mail);

    // Over it, every read block goes first and the mail goes after them.
    const over: BrainEnvelope = { ...base(), line: "x".repeat(ENVELOPE_CAP_BYTES), mail };
    const capped = capEnvelope(over);
    expect(capped.mail).toBeUndefined();
    const omitted = capped.omitted ?? [];
    expect(omitted).toContain("mail");
    expect(omitted[omitted.length - 1]).toBe("mail");
  });

  it("gives up read blocks in the declared order, naming every one", () => {
    // THE BANKER'S LINE IS NEVER TRIMMED, so this envelope stays over budget
    // with every block gone. What is asserted is the ORDER of the sacrifice.
    const envelope: BrainEnvelope = { ...base(), line: "x".repeat(ENVELOPE_CAP_BYTES) };
    const capped = capEnvelope(envelope);
    const dropped = (capped.omitted ?? []).filter((n) => n !== "earlier conversation");
    expect(dropped.length).toBeGreaterThan(0);
    // Every block present was given up, in the declared order, and named.
    const present = ENVELOPE_BLOCK_DROP_ORDER.filter((b) => envelope.reads?.[b] !== undefined);
    expect(dropped).toEqual(present);
    // Exposure is the last to go and covenants the second to last: the blocks
    // that ground nearly every question a banker asks.
    expect(present[present.length - 1]).toBe("exposure");
    // `notCarried` never leaves: it is what makes an absent block refusable.
    expect(capped.reads?.notCarried).toBeDefined();
  });
});
