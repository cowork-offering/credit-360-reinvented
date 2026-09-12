import type { BrainReadBlocks, BrainTurn } from "../../channel/brainLane";
import { MODIFICATION_IN_PROGRESS, packageRoster } from "../../book/packages";
import { valuationLine, valuationsOf } from "../../data/collateralValuation";
import type { Connection, Facility } from "../../data/contract";
import { facilityProduct } from "../../data/facilityStage";
import { fmtCovThreshold, fmtCovVal } from "../../data/finance";
import { fmtDate, fmtMoney } from "../../data/format";
import { aggregateInvolvements, involvementRole, type RoleWords } from "../../data/graphAggregate";
import { isActiveFacility } from "../../data/worklist";
import { classifyCovenant } from "../../domain/covenantStatus";
import type { ReadSource } from "./readCard";

/* =============================================================================
   THE READ, PACKED FOR THE DESK (F2).

   The brain answered "the data is not carried" three times in the 2026-09-01
   drive over a bundle that held every one of those facts. Nothing was wrong
   with the brain: the envelope carried a line, some labels and the staged plan,
   and nothing else. This packs what the room ALREADY READ into the envelope.

   IT FORMATS; IT NEVER DERIVES. Every figure here is printed by the same
   helpers the glass prints with (`fmtMoney`, `fmtDate`, `classifyCovenant`), so
   an answer and the card beside it can never disagree about a number. No
   derivation, no roll-up, no ratio that the read does not already carry.

   AND IT SAYS WHAT IT DOES NOT HOLD. `notCarried` is the other half of the
   contract: a topic no read on this cockpit carries must be refusable BY NAME,
   because an absent block reported as an empty fact is the failure the whole
   grounding pass exists to end.
   ============================================================================= */

/** The relationship-wide scope word, used wherever a row hangs off no facility. */
const RELATIONSHIP = "across the relationship";

/** What NO read on this cockpit carries, stated the same way every time.
 *
 *  FEES: no read tool puts fee rows on the bundle (readCard.ts says the same at
 *  the card). PRICING: the org populates a rate, and a spread on floating
 *  facilities, but the INDEX NAME is not stored anywhere and must never be
 *  inferred from a rate (handoff 2026-09-01, decision ledger). */
const NOT_CARRIED = [
  "the fees already charged on these facilities",
  "the rate index name - this org does not store one, so no index may be named",
  "the spread, which no read on this cockpit carries",
  // THE DOWNSTREAM BOOK, REFUSED BY NAME. The obligor group travels (see
  // `groupBlock`), and what CANNOT travel with it is each counterparty's own
  // lending: no read on this cockpit opens another relationship's book.
  "a guarantor's, parent's or affiliate's OWN exposure and facilities - this cockpit reads one relationship's book and never theirs",
  "cross-default links between these facilities, and any facility elsewhere that depends on one of them - no read carries either",
];

/** Said instead of the two downstream lines above where the read stages no
 *  relationship graph at all, so an absent group is refusable rather than
 *  silent (the same contract every other block is held to). */
const NO_GROUP_CARRIED =
  "the obligor group - parent, affiliates, subsidiaries and owners - because this read stages no relationship graph for them";

/** The facilities in the conversation: active, scoped to the anchored package.
 *  The SAME scoping `readCard.ts` uses, so the blocks and the cards agree. */
function scoped(src: ReadSource): Facility[] {
  return (src.bundle?.exposure?.facilities ?? [])
    .filter(isActiveFacility)
    .filter((f) => !src.productPackageId || f.productPackageId === src.productPackageId);
}

/** THE FACILITY, NAMED SO THE DESK CAN TELL TWO OF THEM APART. This package
 *  carries two Lines of Credit and two Equipment loans; the product word alone
 *  names either, and a block that lists facilities by name has to name the right
 *  one. Where the product repeats, the commitment comes with it. */
function nameOf(f: Facility, relationship: string, among: Facility[] = []): string {
  const product = facilityProduct(f, relationship) || "Facility";
  const twins = among.filter((m) => (facilityProduct(m, relationship) || "Facility") === product).length > 1;
  return twins && typeof f.committed === "number" ? `${product} (${fmtMoney(f.committed)})` : product;
}

/**
 * A PERSON OR A COMPANY, only where the ORG'S OWN WORD says so.
 *
 * No read carries an entity-kind flag, so this reads the role words the org
 * wrote and nothing else. ABSENT IS NOT "corporate": guessing a natural person
 * from a name is exactly the kind of invention the pack forbids.
 */
function kindOf(e: RoleWords): "corporate" | "person" | undefined {
  const words = `${e.borrowerType ?? ""} ${e.relationshipType ?? ""}`.toLowerCase();
  if (/\b(individual|person|personal|natural)\b/.test(words)) return "person";
  if (/\b(corporate|corporation|entity|company|llc|business)\b/.test(words)) return "corporate";
  return undefined;
}

function covenantBlock(src: ReadSource): BrainReadBlocks["covenants"] {
  const covenants = src.bundle?.covenants?.covenants ?? [];
  if (!covenants.length) return undefined;
  const facilities = scoped(src);
  const byLoan = new Map(facilities.map((f) => [f.loanId ?? "", nameOf(f, src.accountName, facilities)]));
  return covenants.map((c) => {
    const attached = (c.attachedLoans ?? [])
      .map((a) => (a.loanId ? byLoan.get(a.loanId) : undefined))
      .filter((n): n is string => Boolean(n));
    const verdict = classifyCovenant(c);
    return {
      name: (c.covenantType ?? "").trim() || "Covenant",
      // IN THE COVENANT'S OWN UNIT, through the room's own formatters. A raw
      // 5000000 on the envelope reads as "5000000" in the line item's rail,
      // which is worse than no rail at all.
      threshold:
        typeof c.thresholdValue === "number"
          ? fmtCovThreshold(c.covenantType, c.actualValue, c.thresholdValue)
          : "not carried",
      measured: typeof c.actualValue === "number" ? fmtCovVal(c.actualValue, c.covenantType) : undefined,
      lastEvaluated: c.lastEvaluationDate ? fmtDate(c.lastEvaluationDate) : undefined,
      nextTest: c.nextEvaluationDate ? fmtDate(c.nextEvaluationDate) : undefined,
      frequency: c.frequency,
      status: verdict.label,
      severity: verdict.severity,
      scope: attached.length ? attached.join(", ") : RELATIONSHIP,
    };
  });
}

/**
 * WHO IS ON THE DEAL, ONE ROW PER PARTY PER ROLE.
 *
 * The org writes one involvement row per loan, so the 2026-09-02 read of
 * Hartwell carries 22 rows for 5 parties. Sent raw, the desk answered a
 * guarantor question with "14 guaranty rows are on this package" - a sentence
 * about nCino's storage shape, not about the credit, and one the banker cannot
 * act on. The block carries the SAME aggregation the card and the tab render,
 * so an answer and the glass beside it can never disagree about who is on the
 * deal or how many facilities they are on.
 */
function involvementBlock(src: ReadSource): BrainReadBlocks["involvements"] {
  const entities = src.bundle?.graph?.legalEntities ?? [];
  if (!entities.length) return undefined;
  const facilities = scoped(src);
  const byLoan = new Map(facilities.map((f) => [f.loanId ?? "", nameOf(f, src.accountName, facilities)]));
  return aggregateInvolvements(entities).map((e) => {
    const loans = e.loanIds.map((id) => byLoan.get(id)).filter((n): n is string => Boolean(n));
    return {
      name: e.accountName ?? "Unnamed party",
      role: involvementRole(e),
      kind: kindOf(e),
      // The facilities BY NAME where the read carries them, because "who
      // guarantees the construction loan" is answered off this line. A count
      // with no names would send the desk back for a read it already has.
      scope: loans.length ? loans.join(", ") : RELATIONSHIP,
      facilities: loans.length || undefined,
      detail:
        [
          e.guarantyAmountType ? `${e.guarantyAmountType} guaranty` : null,
          typeof e.ownershipPercent === "number" && !e.guarantyAmountType ? `${e.ownershipPercent}% ownership` : null,
          typeof e.contingentAmount === "number" ? `${fmtMoney(e.contingentAmount)} contingent` : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
    };
  });
}

/* ------------------------------------------------------------ the group

   WHO THE BORROWER IS CONNECTED TO, which is not the same question as who is on
   the deal. `graph.legalEntities` answers the second and was the only one that
   travelled; `graph.connections` answers the first and was read by nobody. On
   Hartwell that cost the desk the parent (100%), the affiliate, and the 60/40
   between the two natural-person owners - every one of them named in rule 1.  */

type GroupRow = NonNullable<BrainReadBlocks["group"]>[number];
type GroupRelation = GroupRow["relation"];

/** The org's own role word, normalised. Ordered: "Co-Owner" is an owner, and
 *  "Affiliated Company" is an affiliate rather than a company. A word that
 *  matches nothing is not a relation and does not travel as one. */
const RELATIONS: Array<[RegExp, GroupRelation]> = [
  [/\b(parent|holding)\b/i, "parent"],
  [/\b(child|subsidiar)/i, "subsidiary"],
  [/affiliat/i, "affiliate"],
  [/(owner|principal|shareholder|partner)/i, "owner"],
  [/guarant/i, "guarantor"],
];

const relationOf = (role: string): GroupRelation | undefined => RELATIONS.find(([rx]) => rx.test(role))?.[1];

/** The grade the structural signals carry for a counterparty, where they carry
 *  one. Matched on the org's own account id, never on a name. */
function gradeOf(src: ReadSource, counterpartyId: string | undefined): string | undefined {
  if (!counterpartyId) return undefined;
  const signals = (src.bundle?.signals?.guarantorSignals ?? []) as Array<{
    guarantorAccountId?: string;
    highestRiskGrade?: string | number | null;
  }>;
  const hit = signals.find((s) => s.guarantorAccountId === counterpartyId && s.highestRiskGrade != null);
  return hit?.highestRiskGrade != null ? String(hit.highestRiskGrade) : undefined;
}

/**
 * ONE ROW PER COUNTERPARTY.
 *
 * The graph writes the link from both ends: the parent arrives as `Parent`
 * inbound and `Child` outbound, and a reverse row carries 0% by construction.
 * So the rows are grouped by counterparty and the one kept is the one that says
 * the most - a recognised relation first, then the larger ownership - which is
 * the same reading the relationship tab renders.
 */
function groupBlock(src: ReadSource): BrainReadBlocks["group"] {
  const connections = (src.bundle?.graph?.connections ?? []).filter((c) => c.isActive !== false && c.counterpartyName);
  if (!connections.length) return undefined;
  const best = new Map<string, Connection>();
  for (const c of connections) {
    const key = c.counterpartyId ?? c.counterpartyName!;
    const held = best.get(key);
    if (!held) {
      best.set(key, c);
      continue;
    }
    const rank = (x: Connection) => (relationOf(x.role ?? "") ? 2 : 0) + (Number(x.totalOwnershipPercent ?? 0) > 0 ? 1 : 0);
    if (rank(c) > rank(held)) best.set(key, c);
  }
  const rows: GroupRow[] = [];
  for (const c of best.values()) {
    const role = (c.role ?? "").trim();
    const relation = relationOf(role);
    if (!relation) continue;
    const owned = Number(c.totalOwnershipPercent ?? 0);
    rows.push({
      name: c.counterpartyName!,
      relation,
      role: role.toLowerCase() === relation ? undefined : role,
      ownership: owned > 0 ? `${owned}%` : undefined,
      grade: gradeOf(src, c.counterpartyId),
    });
  }
  return rows.length ? rows : undefined;
}

/* ---------------------------------------------------------- the version chain

   WHY THE ROOM IS LOCKED. `book/packages.ts` already computes this for the
   pickers and the room already enforces it; the envelope carried none of it, so
   "why can I not modify this" was answered by a model that had never been told
   a version of this package is sitting unbooked with the org.                 */

function inFlightBlock(src: ReadSource): BrainReadBlocks["inFlight"] {
  if (!src.productPackageId) return undefined;
  const entry = packageRoster(src.bundle, src.history).find((e) => e.id === src.productPackageId);
  if (!entry) return undefined;
  if (!entry.inFlightVersion && !entry.hasInFlightModification) return undefined;
  return {
    version: entry.inFlightVersion || undefined,
    hasInFlightModification: entry.hasInFlightModification || undefined,
    versionId: entry.inFlightVersionId ?? undefined,
    editable: entry.inFlightVersion ? entry.inFlightEditable : undefined,
    reason: entry.inFlightVersion
      ? (entry.reason ?? undefined)
      : `${MODIFICATION_IN_PROGRESS} - a version of this package is unbooked with the org, and a second one would fork the version chain`,
  };
}

function collateralBlock(src: ReadSource): BrainReadBlocks["collateral"] {
  const rows: NonNullable<BrainReadBlocks["collateral"]> = [];
  const facilities = scoped(src);
  const valuations = valuationsOf(src.bundle);
  for (const f of facilities) {
    const scope = nameOf(f, src.accountName, facilities);
    for (const c of f.collateral ?? []) {
      rows.push({
        asset: c.collateralDescription ?? c.collateralName ?? c.collateralType ?? "Collateral",
        type: c.collateralType,
        advanceRate: typeof c.advanceRate === "number" ? `${c.advanceRate}%` : undefined,
        pledged: typeof c.amountPledged === "number" ? fmtMoney(c.amountPledged) : undefined,
        lendable: typeof c.currentLendableValue === "number" ? fmtMoney(c.currentLendableValue) : undefined,
        scope,
        valuation: valuationLine(c, valuations),
      });
    }
  }
  return rows.length ? rows : undefined;
}

function exposureBlock(src: ReadSource): BrainReadBlocks["exposure"] {
  const facilities = scoped(src);
  if (!facilities.length) return undefined;
  const sum = (pick: (f: Facility) => number | null | undefined) =>
    facilities.reduce((n, f) => n + (typeof pick(f) === "number" ? (pick(f) as number) : 0), 0);
  return {
    committed: fmtMoney(sum((f) => f.committed)),
    drawn: fmtMoney(sum((f) => f.outstanding)),
    available: fmtMoney(sum((f) => f.available)),
    facilities: facilities.length,
    // WHICH BOOK THESE FIGURES ARE OVER. The cockpit chat totals every active
    // facility on the relationship and this totals the anchored package: on
    // Hartwell that is $57M against $49M, both honest, and neither used to say
    // which. A total with no scope on it is how one deal reads as two.
    scope: src.productPackageId ? "on this package" : RELATIONSHIP,
  };
}

function pricingBlock(src: ReadSource): BrainReadBlocks["pricing"] {
  const facilities = scoped(src);
  const rows = facilities
    .filter((f) => typeof f.interestRate === "number")
    .map((f) => ({ facility: nameOf(f, src.accountName, facilities), rate: `${f.interestRate}%` }));
  return rows.length ? rows : undefined;
}

/** What the cockpit holds of the CORRESPONDENCE, said only where the envelope
 *  actually carries a message. A room with no connector must not talk about a
 *  mailbox it never looked at; a room WITH one must be able to refuse a THREAD
 *  by name rather than passing off its single search hit as the whole
 *  exchange. */
const MAIL_NOT_CARRIED =
  "correspondence beyond the one message in CONTEXT.mail - this cockpit reads one search hit, never a thread, and no attachment";

/** WHAT THE ROOM HAS ALREADY READ, packed. Absent where it stands on no read. */
export function buildReadBlocks(src: ReadSource | undefined, hasMail = false): BrainReadBlocks | undefined {
  if (!src?.bundle) return undefined;
  const group = groupBlock(src);
  const notCarried = [...NOT_CARRIED, ...(group ? [] : [NO_GROUP_CARRIED]), ...(hasMail ? [MAIL_NOT_CARRIED] : [])];
  return {
    covenants: covenantBlock(src),
    involvements: involvementBlock(src),
    group,
    inFlight: inFlightBlock(src),
    collateral: collateralBlock(src),
    exposure: exposureBlock(src),
    pricing: pricingBlock(src),
    notCarried,
  };
}

/* ------------------------------------------------------------ the thread

   WHAT MAKES IT CHAT. A room that hands over one line at a time answers each
   line as if it were the first, which is exactly the "step by step, not
   intuitive" the founder named. The banker's own words travel VERBATIM; the
   room's are clipped, because a room quoting itself at length crowds out the
   reads the answer actually needs.                                          */

/** How many exchanges travel. Six is two or three full turns, which is as far
 *  back as a banker's "it" and "that one" ever reach. */
const THREAD_TURNS = 6;

/** The longest an agent line travels. A clipped line ends on a word. */
const AGENT_CLIP = 180;

function clip(text: string, cap: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= cap) return line;
  const cut = line.slice(0, cap);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > cap / 2 ? cut.slice(0, lastSpace) : cut).trim()}...`;
}

/** The last few exchanges, oldest first. Empty where nothing has been said. */
export function threadDigest(turns: BrainTurn[], limit: number = THREAD_TURNS): BrainTurn[] | undefined {
  const kept = turns
    .filter((t) => t.text.trim().length > 0)
    .slice(-limit)
    .map((t) => ({ who: t.who, text: t.who === "banker" ? t.text.trim() : clip(t.text, AGENT_CLIP) }));
  return kept.length ? kept : undefined;
}
