import type { StagedAssociation } from "../../actions/stagedPlan";
import { assetValuation, valuationLine, valuationsOf } from "../../data/collateralValuation";
import type { Collateral, Covenant } from "../../data/contract";
import { fmtCovThreshold, fmtCovVal } from "../../data/finance";
import { fmtMoney } from "../../data/format";
import { dayDiff } from "../../data/time";
import { classifyCovenant } from "../../domain/covenantStatus";
import {
  collateralAssociationLine,
  collateralAssociations,
  covenantAssociationLine,
  covenantAssociations,
} from "./relAssociations";
import { collateralLabel, covenantLabel, reviewableCovenants, valuableCollateral, type RelContext } from "./reviewFlows";

/* =============================================================================
   THE BOOK THIS RELATIONSHIP ALREADY CARRIES.

   THE ROOM READS THE PLAN AND THE BOOK (CREATE-GRAMMAR spec, applied to the
   second room). The facility room learned not to ask for what the manifest
   already holds; this room has the same problem one level up. It was asking
   which covenants to assess without saying which ones can be assessed, asking
   for a figure the read already proposes, and offering a route that can only
   end in a refusal.

   IT REMOVES QUESTIONS. IT NEVER REMOVES A DECISION. Every verdict, every
   figure and every grade below is OFFERED with the org's own reading beside it;
   not one of them is answered on the banker's behalf. A governance record filed
   under a default nobody chose is the failure this whole room exists to avoid.

   VALUATION DATES ARE NOW CARRIED, AND STILL ONLY WHERE THE READ HOLDS THEM.
   The bundle stages the latest `LLC_BI__Collateral_Valuation__c` row per asset
   (date, basis, source, cycle, next due), so `lastValued` is a date on an asset
   the read holds one for and the book can say when a figure is due again. An
   asset the read stages no valuation for still says so BY NAME: absent is "the
   read does not carry it", never "never valued". Every string below comes from
   `data/collateralValuation.ts`, which the collateral card and the envelope
   also print through, so no two surfaces can date one asset differently.

   EVERY ABSENCE IS HONEST AND NAMED. One thing a banker would expect here is
   deliberately missing because the READ DOES NOT CARRY IT, not because it was
   forgotten:

     - REVIEWS ALREADY FILED. No read on this cockpit carries
       `LLC_BI__Review__c`, so `reviews.carried` is false and the annual route
       says it CANNOT see whether one is already open rather than implying there
       is none. Those are different facts and a banker acts differently on each.
   ============================================================================= */

/** One covenant, as the book holds it and as the room offers it. */
export interface BookCovenant {
  covenantId: string;
  name: string;
  /** The shared classifier's own verdict. Never a second opinion. */
  verdict: ReturnType<typeof classifyCovenant>;
  /** `1.38x vs >= 1.25x`, in the room's own glyphs, or null. */
  rail: string | null;
  /** The org's own latest compliance row, or null where it holds none. */
  complianceId: string | null;
  complianceStatus: string | null;
  /** TRUE where the org holds a compliance row at all, by EITHER signal. */
  hasRow: boolean;
  /** Days to the next test on the snapshot's clock. Negative is overdue. */
  daysToTest: number | null;
  frequency: string | null;
  /** FALSE where the covenant review can only end in a refusal on this row. */
  assessable: boolean;
  /** The org's own reason, where it is not assessable. */
  reason: string | null;
  /** TRUE where a write onto this row is stored and the schedule does NOT
   *  advance. The `allowNonPending` opt-in exists for exactly these. */
  needsNonPendingOptIn: boolean;
  /** THE FACILITIES AND PACKAGES THIS COVENANT IS TIED TO (0.9.24, backlog row
   *  49). A fact the row carries, never a control: nothing reads it to narrow
   *  the list. An EMPTY array is a relationship-level covenant. */
  associations: StagedAssociation[];
  /** The same fact as one short line, for the row that prints it. */
  associationLine: string;
}

/** One pledged asset, as the book holds it. */
export interface BookAsset {
  collateralId: string;
  name: string;
  type: string | null;
  /** THE PLEDGE FIGURE, which is the credit figure. The asset's own formula
   *  lendable value ignores the pledge override and is never presented as the
   *  bank's: on Hartwell inventory the asset says $6.4MM at the 80 percent type
   *  rate and the pledge says $4.0MM at the 50 percent policy rate. */
  lendable: string | null;
  value: string | null;
  advanceRateSource: string | null;
  /** The last valuation date as the glass prints dates, or null where the read
   *  stages no valuation on this asset. Was `null` on every asset until the
   *  bundle started carrying the valuation read. */
  lastValued: string | null;
  /** The whole clock as one line: when it was struck, on what basis, and when
   *  it falls due. The card, the chooser and the envelope all print THIS, so no
   *  two surfaces can date one asset differently. */
  valuation: string;
  /** THE FACILITIES AND PACKAGES THIS ASSET IS PLEDGED TO (0.9.24). Shown on
   *  the row; never used to narrow the list the row sits in. */
  associations: StagedAssociation[];
  associationLine: string;
}

export interface RelBook {
  covenants: BookCovenant[];
  assets: BookAsset[];
  /** The grade on file, WITH ITS SURFACE NAMED. Four scales are live in this
   *  org and they do not agree, so a grade with no surface is not a grade. */
  grade: { value: string; surface: string } | null;
  /** Reviews already on file. `carried` is false because no read holds them. */
  reviews: { carried: false; open: [] };
  /** TRUE where NOT ONE covenant has a compliance row. The covenant route can
   *  then only end in a refusal, and the room says so before it asks. */
  noComplianceRows: boolean;
  /** How many covenants can actually be assessed. */
  assessableCount: number;
}

/** A row that is open and NOT Pending. A write onto it is stored and the
 *  covenant schedule does not advance; an UNKNOWN status is not claimed to be
 *  one of those, so it needs no opt-in. */
const NOT_PENDING = (status: string | null): boolean => status !== null && status !== "Pending";



/**
 * `1.38x vs >= 1.25x`, built from the SAME classifier the card uses.
 *
 * THE DIRECTION IS INFERRED, AND THAT IS A KNOWN SINGLE DEFECT. The org stores
 * the answer in `Acnpex_Operator__c` ("Actual Must Be") and states the formula
 * in `Calculation_Logic__c`, and the bundle carries neither. Until they are
 * carried, the rail and the card agree with each other because they are the
 * same source; they may both be wrong about an advance-rate covenant, which is
 * one defect rather than two surfaces disagreeing.
 */
function railFor(c: Covenant): string | null {
  if (typeof c.actualValue !== "number" || typeof c.thresholdValue !== "number") return null;
  /* BUILT EXACTLY AS `readBlocks.covenantBlock` builds it, glyph for glyph.
     `fmtCovThreshold` already carries the operator, so the rail on a step and
     the rail on the greeting are the same string from the same formatters. Two
     constructions of one figure is how two surfaces come to disagree. */
  return `${fmtCovVal(c.actualValue, c.covenantType)} vs ${fmtCovThreshold(c.covenantType, c.actualValue, c.thresholdValue)}`;
}

/**
 * THE BOOK, READ ONCE PER ROOM.
 *
 * `today` is `meta.generatedAt` through the context. Nothing here reaches a
 * clock, exactly as `relRoute.ts` does not.
 */
export function relBookFor(ctx: RelContext): RelBook {
  const today = ctx.asOf ?? "";
  const covenants: BookCovenant[] = reviewableCovenants(ctx).map((c: Covenant) => {
    const verdict = classifyCovenant(c);
    const complianceId = c.latestComplianceId ?? null;
    const complianceStatus = c.latestComplianceStatus ?? null;
    const inactive = c.covenantStatus !== undefined && /inactive/i.test(String(c.covenantStatus));
    /* EITHER SIGNAL IS A ROW. `latestComplianceId` is the anchor and
       `latestComplianceStatus` is that row's own status, and a read that
       carries one without the other still carries a row. Hartwell carries
       NEITHER on all six covenants, which is the case this predicate exists
       for; reading only the id would call a staged status a missing row. */
    const hasRow = Boolean(complianceId) || Boolean(complianceStatus);
    return {
      covenantId: c.covenantId as string,
      name: covenantLabel(c),
      verdict,
      rail: railFor(c),
      complianceId,
      complianceStatus,
      hasRow,
      daysToTest: today ? dayDiff(c.nextEvaluationDate, today) : null,
      frequency: c.frequency ?? null,
      assessable: hasRow && !inactive,
      reason: !hasRow
        ? "Salesforce holds no compliance row on this covenant, so there is no open test period to close."
        : inactive
          ? "The covenant is not active, so Salesforce will not accept an assessment on it."
          : null,
      needsNonPendingOptIn: hasRow && NOT_PENDING(complianceStatus),
      associations: covenantAssociations(ctx, c),
      associationLine: covenantAssociationLine(ctx, c),
    };
  });

  const valuations = valuationsOf(ctx.bundle);
  const assets: BookAsset[] = valuableCollateral(ctx).map((c: Collateral) => ({
    collateralId: c.collateralId as string,
    name: collateralLabel(c),
    type: c.collateralType ?? null,
    lendable: typeof c.currentLendableValue === "number" ? fmtMoney(c.currentLendableValue) : null,
    value: typeof c.collateralValue === "number" ? fmtMoney(c.collateralValue) : null,
    advanceRateSource: c.advanceRateSource ?? null,
    lastValued: assetValuation(c, valuations).lastValued,
    valuation: valuationLine(c, valuations),
    associations: collateralAssociations(ctx, c.collateralId as string),
    associationLine: collateralAssociationLine(ctx, c.collateralId as string),
  }));

  const grade = ctx.bundle?.snapshot?.primaryRiskRating;
  return {
    covenants,
    assets,
    grade:
      grade != null && String(grade).trim()
        ? { value: String(grade).trim(), surface: "the relationship's grade on file" }
        : null,
    reviews: { carried: false, open: [] },
    noComplianceRows: covenants.length > 0 && covenants.every((c) => !c.hasRow),
    assessableCount: covenants.filter((c) => c.assessable).length,
  };
}

/* ------------------------------------------------------- what the room says */

/**
 * THE HONEST REFUSAL, BEFORE ANY QUESTION.
 *
 * Hartwell carries ZERO covenant compliance rows. Today the room asks which
 * covenants, then a verdict each, then a figure each, then a narrative, and only
 * then does the org refuse all six. That is the single worst moment in the room.
 */
export const NO_COMPLIANCE_ROW = (count: number): string =>
  `Salesforce holds no open test period on any of the ${count} ${count === 1 ? "covenant" : "covenants"} on this relationship, so there is nothing for a covenant review to close. The tests and their thresholds are on the book and I can read them out; recording an assessment needs a compliance row that Salesforce has not raised.`;

/** The chip's own sub-line, where the covenant route cannot run at all. */
export const NO_COMPLIANCE_ROW_CHIP =
  "No covenant on this relationship carries an open test period, so there is nothing to assess.";

/**
 * THE ENTITIES THE GREETING RAIL NEEDS AND NO READ BLOCK CARRIES.
 *
 * The last rank of `resolveEntities`. Covenants, facilities, involvements and
 * collateral all resolve out of the read blocks already; the grade on file does
 * not, and it is the one row the greeting writes about that the book has no
 * table for.
 */
export function relEntities(book: RelBook): Array<{ name: string; value: string; tone?: "warn" | "bad" }> {
  const out: Array<{ name: string; value: string; tone?: "warn" | "bad" }> = [];
  if (book.grade) {
    const value = `grade ${book.grade.value}`;
    out.push({ name: "Risk grade", value });
    out.push({ name: "Grade on file", value });
  }
  return out;
}
