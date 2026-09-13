/* =============================================================================
   THE SUBSTITUTION SEAM: the memo says THIS borrower's facts, not the demo's.

   THE VENDORED RENDERER CARRIES LITERALS. It was written to render one fixture
   for one demo, so eight values in it are typed into the source rather than
   read off the dossier: the two names on the cover, the prepared date, the memo
   type, two rows naming a specific machine, the guarantor's relationship line,
   and a pro forma fixed-charge figure. Rendering a Hartwell
   memo through it unchanged puts Piedmont's demo furniture under Hartwell's
   name, which is the one thing a credit memo may never do.

   THE FIX IS A POST-RENDER PASS, NOT AN EDIT. `vendor/` is hash-checked and
   `renderMemo.vendor.mjs` is generated from it, so neither can be touched: a
   patched renderer would drift from upstream silently and the golden parity
   test would go red for the wrong reason. Instead the renderer runs exactly as
   the plugin runs it, and every literal is replaced afterwards, on the HTML,
   by an entry in ONE TABLE below. The table is the inventory: a literal that is
   not in it is a literal nobody has looked at.

   THE GAP RULE HOLDS THROUGH THE SEAM (references/conditionality.md). Where the
   cockpit's reads carry no value for a substituted literal, what lands is the
   marker string, never the demo's value and never an estimate. A memo with an
   honest gap in it is a memo a credit officer can work with; a memo carrying
   someone else's figure is not.
   ============================================================================= */

import { NOT_IN_SOURCE } from "./types";
import type { MemoChange, MemoDossier } from "./types";

/** The multiplication sign and the em dash as the vendored source writes them.
 *  Written as escapes so this file carries neither character in its own prose. */
const TIMES = "\u00d7";
const DASH = "\u2014";
/** The division sign, as the Key Metrics row label writes it. */
const DIV = "\u00f7";

/* -----------------------------------------------------------------------------
   WHAT THE ROOM KNOWS WHEN IT ASKS FOR A MEMO
   ----------------------------------------------------------------------------- */

/** One row of the Sources and Uses table, as the executed changes state it. */
export interface UseOfProceeds {
  /** What the money went to: the change's own label. */
  use: string;
  /** The facility that funded it. */
  source: string;
  /** Already formatted. The seam never formats money twice. */
  amount: string;
}

export interface MemoOverrides {
  /** The banker whose session this is. `meta.user`. */
  rmName?: string | null;
  /** The credit officer of record. No read carries one today. */
  creditOfficer?: string | null;
  /** The prepared date, already written the way the cover writes dates. Derived
   *  from `meta.generatedAt`, which is the cockpit's one clock. */
  memoDate?: string | null;
  /** What kind of memo this is, from the trigger that opened the room. */
  memoType?: string | null;
  /** The Sources and Uses rows, from the executed change list. Empty renders
   *  one honest row rather than the demo's machine. */
  uses?: readonly UseOfProceeds[];
  /** The guarantor's relationship to the borrower, from the relationship graph. */
  guarantorRelation?: string | null;
  /** The pro forma fixed-charge cell: a figure the ratios support, or the
   *  marker. Never the demo's "~$2.5M". */
  proFormaFixedCharges?: string | null;
  /**
   * The pro forma leverage cell, WHERE THE DOSSIER CANNOT SUPPORT ONE.
   *
   * The only override with no value side: nothing the cockpit reads could stand
   * in for a leverage multiple, so the choice is the marker or the renderer's
   * own cell. Null writes the marker; ABSENT leaves the cell alone, which is
   * every dossier that carries a balance sheet. See the literal's `why`.
   */
  proFormaLeverage?: null;
}

/* -----------------------------------------------------------------------------
   THE TABLE. Every literal the vendored renderer hardcodes, in one place.
   ----------------------------------------------------------------------------- */

/**
 * ONE HARDCODED VALUE IN THE VENDORED RENDERER.
 *
 * `find` is what appears in the RENDERED html (so a `{{PLACEHOLDER}}` is listed
 * by the value the renderer substituted into it, not by the placeholder name).
 * `replace` returns what should stand there for this dossier.
 */
export interface LiteralSpec {
  id: string;
  /** Where upstream writes it: file and the line it was read at (d975605). */
  where: string;
  /** The literal, as a string or a pattern over the rendered row. */
  find: string | RegExp;
  /** Why it cannot stay. One sentence, for whoever reads this table next. */
  why: string;
  replace: (o: MemoOverrides, matched: RegExpMatchArray | null) => string;
}

/** The marker, wrapped so a substituted cell reads as a gap and not as prose. */
const gap = (): string => NOT_IN_SOURCE;

/** The Sources and Uses body, from the executed changes. */
function usesRows(o: MemoOverrides, amountFallback: string): string {
  const rows = o.uses ?? [];
  if (!rows.length) {
    /* NO EXECUTED CHANGE WAS HANDED TO THIS MEMO. The renderer's own new-money
       total still holds (it is arithmetic over the dossier's loans), so the
       figures stay and only the two LABELS become the marker: what the money
       was for, and which facility funded it, are the two things the plan would
       have said and nothing else in the cockpit carries. */
    return `<tr><td>${gap()}</td><td class="numeric">${amountFallback}</td><td>${gap()}</td><td class="numeric">${amountFallback}</td></tr>`;
  }
  return rows
    .map(
      (r) =>
        `<tr><td>${esc(r.use)}</td><td class="numeric">${esc(r.amount)}</td><td>${esc(r.source)}</td><td class="numeric">${esc(r.amount)}</td></tr>`,
    )
    .join("");
}

/** The four entities the vendored renderer escapes, escaped the same way. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * THE INVENTORY. Eight literals, found by reading the vendored renderer in
 * Phase A and re-read against `renderMemo.vendor.mjs` on 2026-09-04.
 */
export const HARDCODED_LITERALS: readonly LiteralSpec[] = [
  {
    id: "rm_name",
    where: "render-memo.mjs:750, .replaceAll(\"{{RM_NAME}}\", ...)",
    find: "Demo Commercial RM",
    why: "The cover names the relationship manager. The banker in this session is the one who prepared it.",
    replace: (o) => esc(o.rmName?.trim() || gap()),
  },
  {
    id: "credit_officer",
    where: "render-memo.mjs:751, .replaceAll(\"{{CREDIT_OFFICER}}\", ...)",
    find: "Demo Credit Officer",
    why: "The cover names the credit officer of record. No cockpit read carries one, so it is a gap and not a demo name.",
    replace: (o) => esc(o.creditOfficer?.trim() || gap()),
  },
  {
    id: "memo_date",
    where: "render-memo.mjs:752, .replaceAll(\"{{MEMO_DATE}}\", ...)",
    find: "May 30, 2026",
    why: "A memo prepared today that says it was prepared in May is a document nobody can file.",
    replace: (o) => esc(o.memoDate?.trim() || gap()),
  },
  {
    id: "memo_type",
    where: "render-memo.mjs:747, .replaceAll(\"{{MEMO_TYPE}}\", ...)",
    find: `Existing Relationship ${DASH} Material Credit Event`,
    why: "The memo type is the credit event that triggered it, and the room knows which trigger opened it.",
    replace: (o) => esc(o.memoType?.trim() || gap()),
  },
  {
    id: "sources_and_uses",
    where: "render-memo.mjs:296, the Sources and Uses body row",
    find: new RegExp(
      `<tr><td>Equipment ${DASH} 3${TIMES} Mazak INTEGREX CNC</td><td class="numeric">([^<]*)</td><td>[^<]*</td><td class="numeric">[^<]*</td></tr>`,
    ),
    why: "The demo borrower bought three CNC machines. What this borrower did is in the executed plan, and nowhere else.",
    replace: (o, m) => usesRows(o, m?.[1] ?? gap()),
  },
  {
    id: "appendix_equipment_quote",
    where: "render-memo.mjs:594, the appendix's default supporting-document list",
    find: new RegExp(`<tr><td class="cmr-doc-name">Equipment quotes ${DASH} 3${TIMES} Mazak INTEGREX i-450</td>[\\s\\S]*?</tr>`),
    why: "The same demo machine, in the appendix. The cockpit's dossier passes an empty document list so this row does not normally render; it is listed and replaced so a future dossier that omits the list cannot bring it back.",
    replace: () => "",
  },
  {
    id: "guarantor_relation",
    where: "render-memo.mjs:541, the guarantor table's relationship row",
    find: "<tr><td>Relationship to borrower</td><td>Founder &amp; 100% owner</td></tr>",
    why: "How the guarantor relates to the borrower is a fact on the relationship graph, not a sentence about the demo's founder.",
    replace: (o) =>
      `<tr><td>Relationship to borrower</td><td>${esc(o.guarantorRelation?.trim() || gap())}</td></tr>`,
  },
  {
    id: "pro_forma_leverage",
    where: "render-memo.mjs:406 and :413, the Key Metrics pro forma leverage cell",
    why: "The renderer reads a missing total debt as ZERO, divides it into a real EBITDA and prints the result as a leverage multiple: 0.00x on a memo with no executed step, this action's new money alone on one with a step. A Boom book staged in its display form carries figures and no balance sheet, so a live relationship reaches it. Where the dossier does carry the debt the cell is right and is left untouched.",
    // The trailing cell must be a plain figure for this to match at all: where
    // the renderer already wrote its own gap span there is nothing to correct.
    find: new RegExp(`(<tr><td>Debt ${DIV} EBITDA</td>.*?)<td class="numeric">[^<]*</td></tr>`),
    replace: (o, m) =>
      o.proFormaLeverage === undefined ? (m?.[0] ?? "") : `${m?.[1] ?? ""}<td class="numeric">${gap()}</td></tr>`,
  },
  {
    id: "pro_forma_fixed_charges",
    where: "render-memo.mjs:489, the cash-flow block's pro forma row",
    find: /<tr><td>Pro forma fixed charges \(interest \+ scheduled principal\)<\/td><td class="numeric">~\$2\.5M<\/td><\/tr>/,
    why: "A rounded figure for one demo deal, printed as this deal's pro forma coverage. The ratios carry an implied interest expense; scheduled principal is on no read.",
    replace: (o) =>
      `<tr><td>Pro forma fixed charges (interest + scheduled principal)</td><td class="numeric">${esc(
        o.proFormaFixedCharges?.trim() || gap(),
      )}</td></tr>`,
  },
];

/* -----------------------------------------------------------------------------
   THE PASS
   ----------------------------------------------------------------------------- */

/**
 * Apply every substitution to a rendered memo.
 *
 * String replacement over the renderer's output, once per literal, in table
 * order. It is deliberately NOT a DOM pass: the same answer has to come back in
 * node, in jsdom and in the browser, and the memo HTML must survive byte for
 * byte everywhere the table does not touch it.
 */
export function applyMemoOverrides(html: string, overrides: MemoOverrides): string {
  let out = html;
  for (const spec of HARDCODED_LITERALS) {
    if (typeof spec.find === "string") {
      if (!out.includes(spec.find)) continue;
      out = out.split(spec.find).join(spec.replace(overrides, null));
      continue;
    }
    const match = spec.find.exec(out);
    if (!match) continue;
    out = out.slice(0, match.index) + spec.replace(overrides, match) + out.slice(match.index + match[0].length);
  }
  return out;
}

/* -----------------------------------------------------------------------------
   WHAT THE ROOM HANDS THE SEAM
   ----------------------------------------------------------------------------- */

/** The memo type each trigger names. The room's word, not the renderer's. */
export const MEMO_TYPE_FOR: Record<string, string> = {
  modify: "Existing Relationship: Material Credit Event",
  renew: "Existing Relationship: Renewal",
  create: "New Facility Request",
  adhoc: "Existing Relationship: Interim Review",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * The prepared date, as the cover writes dates ("September 4, 2026").
 *
 * Off `meta.generatedAt`, which is the artifact's own snapshot instant and the
 * cockpit's only clock (A10). An unparseable stamp yields null and the cover
 * carries the marker, which is the honest reading of "we do not know when this
 * was prepared".
 */
export function memoDateFrom(generatedAt: string | undefined): string | null {
  if (!generatedAt) return null;
  const ms = Date.parse(generatedAt);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * WHETHER THE PRO FORMA LEVERAGE CELL CAN STAND.
 *
 * The renderer computes it as (latest total debt + this action's new money) over
 * latest EBITDA and reads a MISSING total debt as zero, so a dossier with no
 * balance sheet prints a multiple built out of nothing: 0.00x on a memo with no
 * executed step, this action's new money alone on one with a step. A Boom book
 * staged in its display form carries real revenue and real EBITDA and no balance
 * sheet at all, which is how a live relationship reaches it.
 *
 * Returns null where the dossier cannot support the cell (the seam writes the
 * marker) and undefined where it can (the seam leaves the renderer's own figure
 * alone). It is the only override with a third state, and that is why.
 */
export function proFormaLeverageFrom(dossier: MemoDossier): null | undefined {
  const { periods, balanceSheet } = dossier.canon.spread;
  const latest = periods[periods.length - 1];
  const debt = latest ? balanceSheet.total_debt?.[latest] : null;
  return debt == null ? null : undefined;
}

/**
 * The Sources and Uses rows the executed changes state.
 *
 * ONE ROW PER STEP THAT MOVED MONEY. A step with no commitment on its `after`
 * side moved terms rather than proceeds (a maturity, a covenant, a pledge) and
 * belongs in the memo's own facility tables, not in Sources and Uses. The
 * amount is formatted by the caller's own money formatter, handed in, so the
 * memo and the cockpit print a figure the same way.
 */
export function usesFromChanges(changes: readonly MemoChange[], fmt: (n: number) => string): UseOfProceeds[] {
  const out: UseOfProceeds[] = [];
  for (const c of changes) {
    const after = typeof c.after?.commitment === "number" ? c.after.commitment : null;
    if (after == null) continue;
    const before = typeof c.before?.commitment === "number" ? c.before.commitment : null;
    // A NEW FACILITY IS ITS WHOLE COMMITMENT; a change is what it moved. An
    // increase of $2.5MM on a $5MM line is $2.5MM of proceeds, not $7.5MM.
    const amount = before == null ? after : after - before;
    if (amount <= 0) continue;
    out.push({
      use: c.label,
      source: c.target.name ?? c.target.kind,
      amount: fmt(amount),
    });
  }
  return out;
}
