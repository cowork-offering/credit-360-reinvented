import { describe, expect, it } from "vitest";
import { ENVELOPE_BLOCK_DROP_ORDER, ENVELOPE_CAP_BYTES, composeBrainPrompt } from "./channel/brainLane";
import { deskContext } from "./channel/deskAsk";
import { ALWAYS_BLOCK_IDS, DOCTRINE_BLOCKS } from "./channel/doctrine";
import { CONTEXT_DROP_ORDER, buildRelationshipFacts, notCarriedSentence } from "./channel/relationshipContext";
import { buildEnvelope } from "./components/workroom/brainRoute";
import { buildRelEnvelope } from "./components/relationship/relBrain";
import { relContextFor } from "./components/relationship/reviewFlows";
import type { PackageMember } from "./workroom/types";
import type { BorrowerBundle, C360Data } from "./data/contract";
import live from "../../artifact/live-data.json";

/* =============================================================================
   ONE BUILDER, THREE SURFACES (backlog item 9, golden rule 1).

   Three context builders read one bundle and disagreed. On Hartwell the cockpit
   chat said $57M across 9 facilities and the workroom said $49M across 7 — both
   honest, neither stating its scope. The chat could not state a covenant
   threshold; the envelope could not state a maturity; the obligor group reached
   neither; and each surface refused a different set of things by name.

   THIS SUITE IS THE GUARANTEE. It builds ALL THREE contexts over the same
   relationship and holds them to one another: same totals at the same scope,
   same thresholds, same group rows, same version chain, one drop order and one
   `notCarried`. It goes red the moment a surface starts reading the bundle for
   itself again.
   ============================================================================= */

const data = live as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";
const PACKAGE = "a5Fbb000000IHFJEA4";
const bundle = () => data.borrowers![HARTWELL];
const accountName = () => bundle().snapshot!.name!;

/** The workroom envelope, as the facility room hands it over on this deal. */
const workroomReads = (productPackageId: string | null) => {
  const b = bundle();
  const members: PackageMember[] = (b.exposure?.facilities ?? [])
    .filter((f) => !productPackageId || f.productPackageId === productPackageId)
    .map((f) => ({
      id: f.loanId!,
      key: f.productType ?? "Facility",
      short: f.productType ?? "Facility",
      tag: f.stage ?? "",
      product: f.productType ?? "",
      amount: `$${((f.committed ?? 0) / 1_000_000).toFixed(1)}M`,
      detail: f.name ?? "",
    }));
  return buildEnvelope({
    line: "what is this covenant doing",
    mode: "modify",
    accountName: accountName(),
    packageName: "Hartwell Industrial C&I Credit Package",
    productPackageId,
    members,
    eligible: () => true,
    focused: members[0] ?? null,
    entries: [],
    reads: { bundle: b, accountName: accountName(), productPackageId },
  });
};

/** The relationship room's envelope, over its own five-route vocabulary. */
const relationshipReads = (productPackageId: string | null) => {
  const b = bundle();
  const ctx = relContextFor({
    data,
    bundle: b,
    accountId: HARTWELL,
    accountName: accountName(),
    productPackageId,
  });
  return buildRelEnvelope({
    line: "what is this covenant doing",
    route: "covenant",
    ctx,
    reads: { bundle: b, accountName: accountName(), productPackageId },
    collected: [],
  });
};

describe("the three surfaces read one book", () => {
  const facility = () => workroomReads(PACKAGE);
  const relationship = () => relationshipReads(PACKAGE);
  const desk = () => deskContext(bundle(), accountName());

  /* THE WHOLE OF ITEM 9 IN ONE ASSERTION. The two rooms are anchored on the
     same package, so at that scope their read blocks are not merely consistent:
     they are the same object, block for block, because they are the same call.
     A surface that starts reading the bundle for itself again fails here first,
     before any of the per-block laws below name which fact it got wrong. */
  it("hands the two rooms the SAME blocks, not merely agreeing ones", () => {
    expect(relationship().reads).toEqual(facility().reads);
    // And it is the whole book, not an accidental pair of empties.
    const reads = facility().reads!;
    for (const block of ["facilities", "covenants", "involvements", "group", "collateral", "exposure", "pricing"] as const) {
      expect(reads[block], block).toBeDefined();
    }
    expect(reads.notCarried.length).toBeGreaterThan(0);
  });

  it("quotes ONE committed total per scope, and says which scope it is", () => {
    // The two rooms are anchored on the package and agree, figure for figure.
    expect(facility().reads!.exposure).toEqual(relationship().reads!.exposure);
    expect(facility().reads!.exposure).toEqual({
      committed: "$49M",
      drawn: "$31.03M",
      available: "$17.97M",
      facilities: 7,
      scope: "on this package",
    });
    /* The desk is anchored on nothing, so it totals the WHOLE relationship —
       and the same builder at the same scope produces the same figures, which
       is what makes the two numbers reconcilable instead of contradictory. */
    const wide = buildRelationshipFacts({ bundle: bundle(), accountName: accountName(), productPackageId: null })!;
    expect(wide.exposure).toEqual({
      committed: "$57M",
      drawn: "$38.70M",
      available: "$18.30M",
      facilities: 9,
      scope: "across the relationship",
    });
    expect(desk()).toContain(
      `Facilities across the relationship, every package included: ${wide.exposure!.committed} committed, ${wide.exposure!.drawn} drawn across ${wide.exposure!.facilities}.`,
    );
    // And the workroom total, at the same scope, is the same object again.
    expect(workroomReads(null).reads!.exposure).toEqual(wide.exposure);
  });

  it("writes one covenant test one way, threshold, operator and observed figure", () => {
    const rooms = facility().reads!.covenants!;
    expect(relationship().reads!.covenants).toEqual(rooms);
    const dsc = rooms.find((c) => c.name === "Debt Service Coverage of Borrower")!;
    expect(dsc.threshold).toBe("≥ 1.25×");
    expect(dsc.measured).toBe("1.38×");
    // Every threshold the rooms carry is on the desk, in the same characters.
    const said = desk();
    for (const row of rooms) {
      if (row.threshold === "not carried") continue;
      expect(said, row.name).toContain(`tests ${row.threshold}`);
    }
    expect(said).toContain(`last ${dsc.measured}`);
  });

  it("carries one obligor group, row for row, with the ids the tool is addressed by", () => {
    const group = facility().reads!.group!;
    expect(relationship().reads!.group).toEqual(group);
    expect(group.map((g) => `${g.relation}:${g.name}:${g.counterpartyId}`)).toEqual([
      "parent:Hartwell Industrial Holdings LLC:001bb00001I7NZkAAN",
      "affiliate:Hartwell Logistics LLC:001bb00001I7VCHAA3",
      "owner:James Hartwell:001bb00001I7V2cAAF",
      "owner:Elena Hartwell:001bb00001I7BC0AAN",
    ]);
    // The desk names the same four, with the same relation and the same
    // ownership. The record id stays off that surface: it reaches no tool.
    const said = desk();
    for (const row of group) {
      expect(said).toContain(`${row.name} is the ${row.relation}`);
      if (row.ownership) expect(said).toContain(`${row.ownership} owned`);
      expect(said).not.toContain(row.counterpartyId!);
    }
  });

  it("carries one version chain: the fact that locks a room reaches all three", () => {
    const SOURCE = "a5Fbb000000J6BNEA0";
    const VERSION = "a5Fbb000000JFzREAW";
    const member = (over: Record<string, unknown>) => ({ status: "Open", productPackageId: SOURCE, stage: "Booked", ...over });
    const forked = {
      snapshot: { accountId: HARTWELL, name: "Hartwell Precision Manufacturing LLC" },
      exposure: {
        facilities: [
          member({ loanId: "a4Zbb000002ICnyEAG", name: "Hartwell - Equipment - $1,500,000.00", committed: 1_500_000 }),
          member({ loanId: "a4Zbb000002ICnxEAG", name: "Hartwell - Purchase - $6,500,000.00", committed: 6_500_000 }),
          member({ loanId: "a4Zbb000002KFD3EAO", name: "Hartwell - Equipment - $1,500,000.00", committed: 1_500_000, productPackageId: VERSION, stage: "Qualification" }),
          member({ loanId: "a4Zbb000002KFD4EAO", name: "Hartwell - Purchase - $12,000,000.00", committed: 12_000_000, productPackageId: VERSION, stage: "Qualification" }),
        ],
      },
    } as unknown as BorrowerBundle;
    const src = { bundle: forked, accountName: "Hartwell", productPackageId: SOURCE };
    const locked = buildRelationshipFacts(src)!.inFlight!;
    expect(locked).toEqual({
      version: undefined,
      hasInFlightModification: true,
      versionId: VERSION,
      editable: undefined,
      reason:
        "Modification in Progress - a version of this package is unbooked with the org, and a second one would fork the version chain",
    });
    // The desk, anchored on no package, says the same thing about the same two
    // packages: the version id it names is the one the rooms are locked by.
    const said = deskContext(forked, "Hartwell Precision Manufacturing LLC");
    expect(said).toContain("Modification in Progress");
    expect(said).toContain(locked.versionId!);
    expect(said).toContain("IS the unbooked modification version of another package");
  });

  it("refuses the same things by name on every surface, from one list", () => {
    const rooms = facility().reads!.notCarried;
    expect(relationship().reads!.notCarried).toEqual(rooms);
    /* THE STANDING LIST ON THE CHAT (backlog item 14a). It used to name a gap
       only where its own cut happened to reach one, so a banker asking the desk
       about fees got silence where a room would have refused by name. */
    const said = desk();
    for (const refusal of rooms) expect(said, refusal).toContain(refusal);
    expect(said).toContain(notCarriedSentence(rooms));
  });

  it("gives blocks up in ONE order, and the chat emits its parts in the reverse of it", () => {
    expect(ENVELOPE_BLOCK_DROP_ORDER).toBe(CONTEXT_DROP_ORDER);
    /* The chat cuts from the END of its parts, so the block the envelope
       surrenders FIRST has to be the one furthest down the chat's own context.
       Read the emitted order off the text: the first mention of each block's
       own marker, in the reverse of the drop order. */
    const said = desk();
    const marker: Partial<Record<(typeof CONTEXT_DROP_ORDER)[number], string>> = {
      exposure: "Facilities across the relationship",
      covenants: "Debt Service Coverage of Borrower, Compliant",
      facilities: "Line of Credit ($15M), $15M committed",
      group: "is the parent",
      involvements: "is Borrower on",
      collateral: "pledged",
      pricing: "Pricing as stored",
    };
    const seen = [...CONTEXT_DROP_ORDER]
      .reverse()
      .filter((b) => marker[b])
      .map((b) => ({ block: b, at: said.indexOf(marker[b]!) }));
    for (const row of seen) expect(row.at, row.block).toBeGreaterThan(-1);
    expect(seen.map((r) => r.at)).toEqual([...seen.map((r) => r.at)].sort((a, b) => a - b));
  });

  /* THE BUDGETS, MEASURED. These are the numbers reported with the change, on
     the deepest relationship in the artifact, every surface against its own
     cap (2026-09-12): read blocks 7,979; the facility envelope 9,133 and the
     relationship envelope 9,407 of 10,000, neither omitting anything; the desk
     6,579 of 7,000, uncut. The same facility envelope carrying a two-turn
     thread, which is what `chatGolden.repro.test.ts` measures, is 9,320 against
     8,079 at 0.9.18: the facility block, the action trail and the counterparty
     ids cost 1,241 bytes and 680 remain. THE RELATIONSHIP ENVELOPE IS THE
     TIGHTEST OF THE THREE and it is the one to watch: the next block that
     travels should be costed against 9,407, not against 9,133. */
  it("every surface stays inside its own cap on the deepest book in the artifact", () => {
    const envelope = JSON.stringify(facility()).length;
    expect(envelope).toBeLessThan(ENVELOPE_CAP_BYTES);
    expect(facility().omitted).toBeUndefined();
    expect(JSON.stringify(relationship()).length).toBeLessThan(ENVELOPE_CAP_BYTES);
    expect(relationship().omitted).toBeUndefined();
    // The desk's own cut is 7,000 characters, and the whole book fits under it.
    expect(desk().length).toBeLessThan(7_000);
    expect(desk()).not.toContain("cut to fit");
  });
});

/* =============================================================================
   AND THE DOCTRINE NAMES WHAT THE BUILDER SENDS (backlog items 9 and 14).

   The ladder block states the rule itself: "a block the standing instruction
   never names is a block the model reads as noise." Two blocks arrived with the
   one builder (`facilities`, `history`) and one field with item 14b
   (`group[].counterpartyId`), so this suite is what keeps the pack in step with
   the payload. A block added to the builder and not to the doctrine fails here.
   ============================================================================= */

describe("the doctrine names every block the one builder emits", () => {
  const always = DOCTRINE_BLOCKS.filter((b) => ALWAYS_BLOCK_IDS.includes(b.id))
    .flatMap((b) => b.lines)
    .join("\n");

  it("names each block of the shared drop order, in the always-on pack", () => {
    for (const block of CONTEXT_DROP_ORDER) expect(always, block).toMatch(new RegExp(`\\b${block}\\b`, "i"));
  });

  it("says what the two blocks the one builder added are for", () => {
    expect(always).toContain("CONTEXT.reads.facilities is EACH FACILITY");
    expect(always).toMatch(/maturity, stage and the org's OWN coverage ratio/);
    // And that the name on that block is the join key the other blocks scope by.
    expect(always).toContain("covenants[].scope, collateral[].scope and pricing[].facility join on");
    expect(always).toContain("CONTEXT.reads.history is what this cockpit has already FILED here");
  });

  it("addresses the counterparty's own book by id, not by name alone", () => {
    // The fact, on the block that carries it...
    expect(always).toContain("its counterpartyId (the org's own account id for that party)");
    // ...and when to use it, on the tool it is the handle for.
    expect(always).toContain("Address it by the counterpartyId CONTEXT.reads.group carries for that party");
    expect(always).toContain("fall back to the name that block writes only where the row carries no id");
  });

  it("states the same two facts in the prompt's own grounding contract", () => {
    const prompt = composeBrainPrompt(
      buildEnvelope({
        line: "what is this covenant doing",
        mode: "modify",
        accountName: "Hartwell Precision Manufacturing LLC",
        packageName: "Hartwell Industrial C&I Credit Package",
        productPackageId: null,
        members: [],
        eligible: () => true,
        focused: null,
        entries: [],
      }),
    );
    expect(prompt).toContain("the facilities with their maturities, stages and coverage");
    expect(prompt).toContain("the actions already filed");
  });
});
