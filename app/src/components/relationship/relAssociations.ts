import type { StagedAssociation } from "../../actions/stagedPlan";
import type { Covenant, Facility } from "../../data/contract";
import { facilityProduct, shortFacilityName } from "../../data/facilityStage";
import { fmtMoney } from "../../data/format";
import { isActiveFacility } from "../../data/worklist";
import type { RelContext } from "./reviewFlows";

/* =============================================================================
   WHAT A COVENANT OR AN ASSET IS TIED TO: SHOWN, NEVER USED TO NARROW.

   Founder, 2026-09-13: "covenants and collaterals should be driven from the
   relationship perspective. A package is an association the row shows, which PPs
   and facilities it is tied to, never a filter or a narrowing control."

   So this module has exactly one job: turn the junctions the book already
   carries (`Covenant.attachedLoans` and the pledge rows hanging off each
   facility) into a short line the row can print. NOTHING HERE FILTERS. There is
   no predicate that takes a package id and returns a subset, and there must
   never be one: the moment an association can hide a covenant it has become the
   control the founder ruled out.

   TWO SOURCES, ONE SHAPE. Before the plan is staged the associations are
   derived from the bundle; once the org answers, `StagedCovenant.associations`
   and `StagedItem.associations` carry the org's own reading of the same fact
   (`stage_covenant_review` / `stage_collateral_valuation`, 0.9.24 contract). The
   org's wins where it has spoken, because it read the junctions at plan time and
   this read is a snapshot; both are `StagedAssociation[]`, so no surface has to
   know which one it got.

   EVERY ABSENCE IS A FACT. A covenant whose `attachedLoans` is an EMPTY array is
   relationship-level and says so; a covenant whose read does not carry the field
   at all is a gap and says THAT instead. The two are not the same and the line
   never conflates them.
   ============================================================================= */

/** The short word for a relationship-level covenant: tied to no facility. */
export const RELATIONSHIP_LEVEL = "Relationship level, on no facility";

/** The read does not carry the junction at all, which is not the same fact. */
export const JUNCTION_NOT_CARRIED = "The read does not carry this covenant's facility junctions";

/** The word for one package, short enough to sit on a row.
 *
 *  `packageRoster` names a deal `<relationship> credit package · <products>`,
 *  which is the right headline for a picker and far too long for a row that
 *  already names two facilities. The relationship is the headline of the screen
 *  either way, so it comes off, and what is left is the products the package
 *  actually holds, in the bank's own shorthand. */
export function packageWord(name: string | null | undefined, relationship?: string | null): string {
  const full = (name ?? "").trim();
  if (!full) return "the package";
  const rel = (relationship ?? "").trim();
  const stripped =
    rel && full.toLowerCase().startsWith(rel.toLowerCase()) ? full.slice(rel.length).trim() : full;
  const cut = stripped.indexOf(" · ");
  if (cut < 0) return stripped || "the package";
  const products = stripped.slice(cut + 3).trim();
  if (!products) return stripped;
  return products.replace(/Non-Real Estate/g, "Non-RE").replace(/Real Estate/g, "RE").replace(/ and /g, "/");
}

/** The short word for one facility: the product and what is committed on it.
 *  "Line of Credit $15M", never the org's forty-character loan name. */
export function facilityWord(f: Facility, relationship?: string | null): string {
  const product = facilityProduct(f, relationship);
  return typeof f.committed === "number" ? `${product} ${fmtMoney(f.committed)}` : product;
}

/** The same word off a junction's NAME alone, for a loan the exposure read does
 *  not carry. nCino writes `<Borrower> - <Product> - <$Amount>`, so the product
 *  is the middle segment and the amount is the last; anything that does not fit
 *  the convention keeps the whole short name rather than being guessed at. */
function facilityWordFromName(name: string | null | undefined, relationship?: string | null): string {
  const short = shortFacilityName(name, relationship);
  if (!short) return "";
  const money = short.match(/^(.*?)\s*[-–—]\s*\$([\d,]+(?:\.\d+)?)\s*$/);
  if (!money) return short;
  const amount = Number(money[2].replace(/,/g, ""));
  return Number.isFinite(amount) ? `${money[1].trim()} ${fmtMoney(amount)}` : short;
}

/** Every ACTIVE facility on the relationship, keyed by its loan id. */
function facilitiesById(ctx: RelContext): Map<string, Facility> {
  const out = new Map<string, Facility>();
  for (const f of (ctx.bundle?.exposure?.facilities ?? []).filter(isActiveFacility)) {
    if (f.loanId) out.set(f.loanId, f);
  }
  return out;
}

/** The package a facility names, as the roster names it. */
function packageNameFor(ctx: RelContext | undefined, productPackageId: string | null | undefined): string | undefined {
  if (!ctx || !productPackageId) return undefined;
  return ctx.packages.find((p) => p.id === productPackageId)?.name;
}

/**
 * THE FACILITIES AND PACKAGES A COVENANT IS TIED TO, off the book.
 *
 * `attachedLoans` is the junction nCino writes between a covenant and a loan.
 * An entry the exposure read also carries is resolved to the facility, so the
 * row can print the commitment; one it does not is printed off the junction's
 * own name rather than dropped, because a covenant tied to a facility this view
 * cannot see is still tied to it.
 */
export function covenantAssociations(ctx: RelContext, covenant: Covenant): StagedAssociation[] {
  const byId = facilitiesById(ctx);
  return (covenant.attachedLoans ?? []).map((j) => {
    const f = j.loanId ? byId.get(j.loanId) : undefined;
    const productPackageId = f?.productPackageId ?? undefined;
    return {
      loanId: j.loanId ?? undefined,
      loanName: f?.name ?? j.loanName ?? undefined,
      productPackageId,
      packageName: packageNameFor(ctx, productPackageId),
    };
  });
}

/** TRUE where the read carries no junction field at all on this covenant, which
 *  is a gap rather than a relationship-level covenant. */
function junctionCarried(covenant: Covenant): boolean {
  return Array.isArray(covenant.attachedLoans);
}

/**
 * THE FACILITIES AND PACKAGES AN ASSET IS PLEDGED TO, off the book.
 *
 * A pledge row hangs off a facility, so one asset cross-pledged to three
 * facilities appears on three of them and this walks all of them. Deduplicated
 * by loan id: the same asset pledged twice to one facility is one pledge to the
 * banker reading the row.
 */
export function collateralAssociations(ctx: RelContext, collateralId: string): StagedAssociation[] {
  const out = new Map<string, StagedAssociation>();
  for (const f of (ctx.bundle?.exposure?.facilities ?? []).filter(isActiveFacility)) {
    if (!(f.collateral ?? []).some((c) => c.collateralId === collateralId)) continue;
    const key = f.loanId ?? f.name ?? String(out.size);
    if (out.has(key)) continue;
    out.set(key, {
      loanId: f.loanId ?? undefined,
      loanName: f.name ?? undefined,
      productPackageId: f.productPackageId ?? undefined,
      packageName: packageNameFor(ctx, f.productPackageId),
    });
  }
  return [...out.values()];
}

/**
 * THE ASSOCIATION LINE A ROW PRINTS.
 *
 * "Line of Credit $15M, Construction $12M; Non-RE package". The facilities
 * first, because that is what a banker places a covenant by, then the packages
 * behind them. It is a STATEMENT: nothing on the row is clickable and nothing
 * about it narrows the list it sits in.
 */
export function associationLine(
  associations: readonly StagedAssociation[] | undefined,
  relationship?: string | null,
  ctx?: RelContext,
): string {
  if (!associations) return "";
  if (!associations.length) return RELATIONSHIP_LEVEL;
  const byId = ctx ? facilitiesById(ctx) : new Map<string, Facility>();
  const facilities: string[] = [];
  for (const a of associations) {
    const f = a.loanId ? byId.get(a.loanId) : undefined;
    const word = f ? facilityWord(f, relationship) : facilityWordFromName(a.loanName, relationship);
    if (word && !facilities.includes(word)) facilities.push(word);
  }
  const packages: string[] = [];
  for (const a of associations) {
    const named = a.packageName ?? packageNameFor(ctx, a.productPackageId);
    if (!named) continue;
    const word = packageWord(named, relationship);
    if (word && !packages.includes(word)) packages.push(word);
  }
  /* A ROW WITH ASSOCIATIONS NAMES WHAT IT CAN. Where the junctions resolved to
     no facility the packages stand alone, and where they resolved to nothing at
     all the line is blank: "the row named a package I cannot read" is not the
     same statement as "this covenant is relationship-level". */
  const left = facilities.join(", ");
  const right = packages.length ? withPackageWord(packages) : "";
  if (left && right) return `${left}; ${right}`;
  return left || right;
}

/** The package words, with the noun added ONCE. A relationship staging one
 *  package is named "credit package" by the roster and already carries the
 *  noun; a mixed-product package is named by its products and does not. */
function withPackageWord(packages: readonly string[]): string {
  const joined = packages.join(", ");
  if (/\bpackages?\b/i.test(joined)) return joined;
  return `${joined} ${packages.length === 1 ? "package" : "packages"}`;
}

/** The association line for one covenant, straight off the book. Empty string
 *  where the read carries no junction field, so a caller can tell the gap from
 *  a relationship-level covenant without a second call. */
export function covenantAssociationLine(ctx: RelContext, covenant: Covenant): string {
  if (!junctionCarried(covenant)) return JUNCTION_NOT_CARRIED;
  return associationLine(covenantAssociations(ctx, covenant), ctx.accountName, ctx);
}

/** The association line for one asset, straight off the book. */
export function collateralAssociationLine(ctx: RelContext, collateralId: string): string {
  const pledges = collateralAssociations(ctx, collateralId);
  if (!pledges.length) return "Owned by the borrower, pledged to no active facility";
  return associationLine(pledges, ctx.accountName, ctx);
}

/**
 * THE PACKAGES ONE EXERCISE TOUCHED, in the room's own short words.
 *
 * What the trail row names (backlog row 49: "staging + trail rows anchor on the
 * account naming the packages touched"). The org's own `productPackageId` on the
 * plan leads where it set one; otherwise the associations of the rows the plan
 * carries are read, which is the whole point of carrying them.
 */
export function packagesTouched(
  associations: readonly StagedAssociation[],
  relationship?: string | null,
): string[] {
  const out: string[] = [];
  for (const a of associations) {
    const word = packageWord(a.packageName, relationship);
    if (a.packageName && !out.includes(word)) out.push(word);
  }
  return out;
}
