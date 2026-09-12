import { fmtDate, fmtMoney } from "../data/format";
import type { Covenant, Facility, LegalEntity } from "../data/contract";
import type { Amendment, ParsedValue } from "./parseModify";
import type { WorkroomAdvisory, WorkroomDelta } from "./types";

/* =============================================================================
   TIER-1 ADVISORY RULES.

   Deterministic sense-checks that speak up BEFORE the banker stages anything,
   computed from what the engine already holds: the package baseline, the deltas
   the parse produced, and the org's own describes behind the catalog.

   THEY NEVER BLOCK. The org's guards do the blocking — the write allowlist, the
   transition allowlist, the drift recompute, the single-use token. An advisory
   is the thing a good credit officer would say across the desk before you sign,
   and the banker can go ahead anyway. So:

     - no advisory is a live gate: the room does not wait to be told it was read;
     - no advisory removes a chip: the change the banker asked for is still on
       the table with its Confirm on it;
     - an advisory that can name a better move offers it as ONE resolution, said
       in the banker's own grammar, which goes back through the same parser as a
       typed line and can therefore do nothing a banker could not have said.

   SIX RULES, and each one is a fact the read already carries rather than a
   judgement the room is making:

     1  a new limit under what is already drawn;
     2  a create where something of the same kind is already on the facility;
     3  a maturity in the past, or before a test the facility still owes;
     4  a covenant threshold that would not bind against today's actuals;
     5  a pledge release that takes the cover under the org's own ratio;
     6  an entity that is already involved on the package.

   WHERE A RULE CANNOT BE SURE, IT SAYS NOTHING. Every rule below returns early
   on a fact the read does not carry — an absent outstanding, an unnamed pledge,
   a covenant with no actual. Silence is correct; a guess is not.
   ============================================================================= */

/** One proposal, as the engine holds it: the amendment the parser resolved and
 *  the delta chip it became. The rules need both — the amendment carries the
 *  catalog field and the member, the delta carries what will travel. */
export interface AdvisoryProposal {
  amendment: Amendment;
  delta: WorkroomDelta;
}

export interface AdvisoryInput {
  proposals: AdvisoryProposal[];
  /** The banker's own line. Rules that have to resolve WHICH covenant or WHICH
   *  pledge was meant read it, and stay quiet when it names none. */
  said: string;
  /** Covenants the package reads, with their thresholds and actuals. */
  covenants: Covenant[];
  /** Involvement rows the deal reads. */
  entities: LegalEntity[];
  /** The package's committed total today. */
  committed: number;
  /** The org's distinct lendable collateral pool. Absent where no read carries it. */
  lendable?: number;
  /** THE ORG'S OWN COVERAGE RATIO, used as a baseline and never re-derived. */
  orgCoverageRatio?: number;
  /** The client's own target, where the read stages a request. */
  clientAskTo?: number;
  /** Today, as an ISO date. Injected so a date rule is testable rather than
   *  quietly dependent on the machine it runs on. */
  today: string;
  /** How the room names a member in a sentence: the product, never the org's
   *  loan name — that name carries the member's current commitment inside it. */
  memberName: (f: Facility) => string;
  /** The scope a suggestion has to carry to resolve one member out of several. */
  identity: (f: Facility) => string;
}

export function runAdvisories(input: AdvisoryInput): WorkroomAdvisory[] {
  const out: WorkroomAdvisory[] = [];
  for (const proposal of input.proposals) {
    for (const rule of RULES) {
      const hit = rule(proposal, input);
      if (hit) out.push(hit);
    }
  }
  return out;
}

type Rule = (proposal: AdvisoryProposal, input: AdvisoryInput) => WorkroomAdvisory | null;

/* ------------------------------------------------- 1. under what is drawn */

/**
 * A LIMIT BELOW THE BALANCE.
 *
 * The facility cannot be reduced under what is already lent without the money
 * coming back first, so a commitment change that lands under `outstanding` is
 * either a paydown that has not been said, or a figure that came out wrong. The
 * room states both and offers the client's own ask where the read carries one,
 * because that is the only alternative figure it can point at honestly.
 */
const commitmentBelowOutstanding: Rule = ({ amendment, delta }, input) => {
  if (delta.wire?.key !== "requestedAmount" || typeof delta.wire.value !== "number") return null;
  const facility = amendment.facility;
  const drawn = facility?.outstanding;
  if (!facility || typeof drawn !== "number") return null;
  const limit = delta.wire.value;
  if (limit >= drawn) return null;

  const name = input.memberName(facility);
  const ask = input.clientAskTo;
  return {
    id: `advice:below-drawn:${facility.loanId ?? name}:${limit}`,
    rule: "commitment-below-outstanding",
    // "a $8M limit" / "an $18M limit" — the article a figure takes depends on
    // how it is READ aloud, not on its first character. Naming the limit after
    // the noun sidesteps the whole question and reads the way a banker speaks.
    line: `${fmtMoney(drawn)} is already drawn on the ${name}, so a limit of ${fmtMoney(limit)} does not work as stated. The balance comes down first, or the figure is not the one you meant.`,
    resolution:
      typeof ask === "number" && ask >= drawn && ask !== limit
        ? {
            label: `Make it ${fmtMoney(ask)}, the client's own ask`,
            say: `change the commitment on the ${input.identity(facility)} to ${ask}`,
          }
        : undefined,
  };
};

/* --------------------------------------------------- 2. amend, or add a second */

/**
 * SOMETHING OF THIS KIND IS ALREADY THERE.
 *
 * A modification carries the parent's record graph forward, so a create lands
 * BESIDE what is already on the facility rather than replacing it. Where the
 * banker's line names the existing record outright the engine asks first and
 * nothing is staged; this is the quieter case — a different covenant, a second
 * pledge — where the add is legitimate and the banker still deserves to know
 * what it is joining.
 *
 * Parties are rule 6's, and fees are nobody's: this org holds none.
 */
const amendOrAddSecond: Rule = ({ amendment, delta }, input) => {
  if (amendment.op !== "add") return null;
  const scope = amendment.field.associationScope;
  if (scope !== "loan-covenants" && scope !== "pledges") return null;
  const facility = amendment.facility;
  if (!facility) return null;

  const existing =
    scope === "loan-covenants"
      ? (facility.loanCovenants ?? []).map((j) => j.covenantType ?? j.name ?? "").filter(Boolean)
      : (facility.collateral ?? []).map((c) => c.collateralName ?? c.collateralType ?? "").filter(Boolean);
  if (!existing.length) return null;

  const name = input.memberName(facility);
  const noun = scope === "loan-covenants" ? (existing.length === 1 ? "covenant" : "covenants") : existing.length === 1 ? "pledge" : "pledges";
  const them = existing.length === 1 ? "it" : "them";
  return {
    id: `advice:second:${delta.id}`,
    rule: "amend-or-add",
    line: `The ${name} already carries ${existing.length} ${noun} (${existing.join(", ")}), and the modification carries ${them} forward. This stages a new one beside ${them} rather than changing what is there.`,
    // THE RESOLUTION IS A LINE THE BANKER COULD HAVE TYPED, and it is read back
    // by the same parser — so it names the test rather than saying "covenant",
    // which would resolve a second field and stage two changes for one click.
    resolution:
      scope === "loan-covenants"
        ? {
            label: `Change the ${existing[0]} test instead`,
            say: `change the ${existing[0]} threshold on the ${input.identity(facility)}`,
          }
        : {
            label: `Change the ${existing[0]} pledge instead`,
            say: `change the advance rate on ${existing[0]} on the ${input.identity(facility)}`,
          },
  };
};

/* ------------------------------------------------------ 3. dates out of order */

/**
 * A MATURITY THAT CANNOT STAND.
 *
 * Two arms, and both are facts rather than opinions. A date behind today would
 * file a facility that matured before it was approved. A date ahead of today but
 * BEFORE a test the facility still owes leaves a covenant due on a facility that
 * has already matured, which the credit file will not survive.
 */
const maturityOutOfOrder: Rule = ({ amendment, delta }, input) => {
  if (delta.wire?.key !== "requestedMaturityDate" || typeof delta.wire.value !== "string") return null;
  const facility = amendment.facility;
  if (!facility) return null;
  const iso = delta.wire.value;
  const name = input.memberName(facility);

  if (iso < input.today) {
    return {
      id: `advice:past-maturity:${iso}`,
      rule: "maturity-out-of-order",
      line: `${fmtDate(iso)} is behind today, so the ${name} would file already matured. A maturity the bank can approve sits ahead of the approval, not behind it.`,
    };
  }

  const test = nextTestOn(facility, input.covenants).find((t) => t.due > iso);
  if (!test) return null;
  return {
    id: `advice:maturity-before-test:${iso}`,
    rule: "maturity-out-of-order",
    line: `The ${test.type} test on the ${name} is next measured ${fmtDate(test.due)}, which falls after the ${fmtDate(iso)} maturity: the facility would mature owing a test nobody can take.`,
    // The test date is the EARLIEST maturity that does not strand the test, so
    // it is what the room can offer honestly. Anything later is the banker's.
    resolution: {
      label: `Take it to ${fmtDate(test.due)}, the test date`,
      say: `change the maturity on the ${input.identity(facility)} to ${test.due}`,
    },
  };
};

/** The covenants this facility actually owes a test on, with their due dates.
 *  Attachment is read the way the room reads it everywhere else: the facility's
 *  own attachments first, then the covenant's own list of facilities. */
function nextTestOn(facility: Facility, covenants: Covenant[]): Array<{ type: string; due: string }> {
  const attached = new Set((facility.loanCovenants ?? []).map((j) => j.covenantId).filter(Boolean));
  return covenants
    .filter((c) => {
      if (c.covenantId && attached.has(c.covenantId)) return true;
      return (c.attachedLoans ?? []).some((a) => a.loanId && a.loanId === facility.loanId);
    })
    .flatMap((c) => (c.nextEvaluationDate ? [{ type: c.covenantType ?? "covenant", due: c.nextEvaluationDate }] : []))
    .sort((a, b) => (a.due < b.due ? -1 : 1));
}

/* ------------------------------------------------ 4. a test that never binds */

/**
 * A THRESHOLD ON THE WRONG SIDE OF THE ACTUALS.
 *
 * A covenant is a promise that bites when performance slips. A threshold set so
 * far clear of what the borrower reads today that nothing short of a collapse
 * would trip it is a covenant in name only, and the credit file will read it
 * that way at the next review.
 *
 * THE DIRECTION IS DERIVED, NEVER ASSUMED. No read carries the operator, so the
 * room works it out from the org's own row: a compliant covenant whose actual
 * sits ABOVE its threshold is a floor, one whose actual sits below it is a
 * ceiling. Where the row does not settle it — not compliant, no actual, no
 * threshold — the rule says nothing.
 */
const covenantNeverBinds: Rule = ({ amendment }, input) => {
  if (amendment.field.id !== "covenant.threshold") return null;
  const proposed = thresholdNumber(amendment.value);
  if (proposed === null) return null;

  const covenant = covenantNamedIn(input.said, input.covenants);
  if (!covenant) return null;
  const { thresholdValue: today, actualValue: actual, covenantType } = covenant;
  if (typeof today !== "number" || typeof actual !== "number" || actual === 0) return null;

  const compliant = (covenant.latestComplianceStatus ?? covenant.covenantStatus ?? "").toLowerCase() === "compliant";
  if (!compliant) return null;
  // A floor sits under the actual, a ceiling above it. A row where the two are
  // equal settles nothing, so it is left alone.
  const floor = actual > today;
  if (actual === today) return null;

  // "Never binds" is the proposed level giving MORE slack than the one on the
  // record, in the direction the test already runs.
  const slacker = floor ? proposed < today : proposed > today;
  const met = floor ? proposed < actual : proposed > actual;
  if (!slacker || !met) return null;

  const move = Math.round((Math.abs(actual - proposed) / Math.abs(actual)) * 100);
  const word = floor ? "floor" : "ceiling";
  const direction = floor ? "falls" : "rises";
  return {
    id: `advice:never-binds:${covenant.covenantId ?? covenantType}:${proposed}`,
    rule: "covenant-never-binds",
    line: `${covenantType ?? "That test"} reads ${actual} today against a ${today} ${word}. At ${proposed} it only bites once the ratio ${direction} ${move}%, so on the numbers this read carries it would not bind at all.`,
  };
};

/** A threshold as a number, however the line carried it. The catalog types the
 *  field as a number, but a banker writes "to 1.15" and the parser keeps the
 *  tail — so the digits are read back out rather than refused. */
function thresholdNumber(value: ParsedValue | null): number | null {
  if (!value) return null;
  if (value.kind === "percent") return value.rate;
  if (value.kind === "currency") return value.amount;
  if (value.kind === "text") {
    const m = value.text.match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  return null;
}

/** WHICH covenant the line meant, matched on the significant words of its type.
 *  Two words have to land, so "the fixed charge test" finds "Fixed Charge
 *  Coverage" and a bare "the covenant" finds nothing — which is correct, because
 *  a package with two covenants would otherwise be advised about the wrong one. */
function covenantNamedIn(said: string, covenants: Covenant[]): Covenant | undefined {
  const lower = said.toLowerCase();
  const hits = covenants.filter((c) => {
    const words = (c.covenantType ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    return words.length > 1 && words.filter((w) => lower.includes(w)).length >= 2;
  });
  return hits.length === 1 ? hits[0] : undefined;
}

/* ------------------------------------------- 5. a release that thins the cover */

/**
 * A RELEASE THAT TAKES THE COVER UNDER THE BANK'S OWN LINE.
 *
 * The org publishes a coverage ratio for this relationship, computed over its
 * distinct collateral pool. This room NEVER re-derives that figure — the "why"
 * peek promises as much — so the rule uses it as the line to measure against and
 * says plainly that its own arithmetic is its own: the pool it is left with,
 * over what the package has committed.
 *
 * It fires only on a release that CROSSES that line. A release inside a package
 * that was already under it is not news.
 */
const releaseThinsCover: Rule = ({ amendment, delta }, input) => {
  if (amendment.field.id !== "collateral.release") return null;
  const facility = amendment.facility;
  const pool = input.lendable;
  if (!facility || typeof pool !== "number" || pool <= 0 || input.committed <= 0) return null;

  const pledge = pledgeNamedIn(input.said, facility);
  const released = pledge?.amountPledged;
  if (!pledge || typeof released !== "number" || released <= 0) return null;

  const baseline = input.orgCoverageRatio;
  if (typeof baseline !== "number" || baseline <= 0) return null;
  const before = pool / input.committed;
  const after = (pool - released) / input.committed;
  if (!(before >= baseline && after < baseline)) return null;

  const name = pledge.collateralName ?? pledge.collateralType ?? "that pledge";
  return {
    id: `advice:thin-cover:${delta.id}`,
    rule: "release-thins-cover",
    line: `Releasing ${name} takes ${fmtMoney(released)} out of the ${fmtMoney(pool)} pledged pool, leaving ${after.toFixed(2)}x against the ${fmtMoney(input.committed)} committed, under the ${baseline.toFixed(2)}x the org reads on this relationship today.`,
  };
};

/** The pledge the line named, or the only one there is. A facility with several
 *  and a line that names none is left alone: releasing the wrong one is the
 *  mistake this rule exists to prevent, not one to make in its advice. */
function pledgeNamedIn(said: string, facility: Facility) {
  const pledges = facility.collateral ?? [];
  const lower = said.toLowerCase();
  const named = pledges.filter((c) =>
    [c.collateralName, c.collateralDescription, c.collateralType]
      .filter((t): t is string => Boolean(t))
      .some((t) => t.length > 3 && lower.includes(t.toLowerCase())),
  );
  if (named.length === 1) return named[0];
  return named.length === 0 && pledges.length === 1 ? pledges[0] : undefined;
}

/* ------------------------------------------------- 6. already on the deal */

const ROLES = ["limited guarantor", "co-borrower", "related entity", "contractor", "guarantor", "borrower", "grantor"];

/**
 * THE ENTITY IS ALREADY INVOLVED.
 *
 * The org holds involvement as rows, so adding a party that is already on the
 * package stages a SECOND row for the same name rather than correcting the one
 * that is there. Where the line asks for a different role than the one on
 * record, the move the banker almost certainly meant is a role change, and the
 * room offers exactly that.
 */
const entityAlreadyInvolved: Rule = ({ amendment, delta }, input) => {
  if (amendment.field.category !== "party" || amendment.op !== "add") return null;
  const party = amendment.party;
  if (!party) return null;
  const hit = input.entities.find((e) => (e.accountName ?? "").toLowerCase() === party.toLowerCase());
  if (!hit) return null;

  const role = (hit.borrowerType ?? "").trim();
  const asked = ROLES.find((r) => input.said.toLowerCase().includes(r));
  const same = Boolean(role) && asked !== undefined && role.toLowerCase() === asked;
  // A full legal name reads once in a sentence and never twice, so the second
  // mention is "them" — which is also how a banker would say it.
  const held = role ? `already ${article(role)} ${role.toLowerCase()}` : "already on the deal";
  return {
    id: `advice:already-involved:${delta.id}`,
    rule: "entity-already-involved",
    line: same
      ? `${party} is ${held} on this package, so this stages a second involvement for the same name rather than a new party.`
      : `${party} is ${held} on this package. Adding them again stages a second involvement rather than a new party; a role change is the move if that is what you meant.`,
    resolution:
      asked && !same
        ? { label: `Change the role to ${asked} instead`, say: `change the role of ${party} to ${asked}` }
        : undefined,
  };
};

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

/* --------------------------------------------------------------- the set */

const RULES: Rule[] = [
  commitmentBelowOutstanding,
  amendOrAddSecond,
  maturityOutOfOrder,
  covenantNeverBinds,
  releaseThinsCover,
  entityAlreadyInvolved,
];
