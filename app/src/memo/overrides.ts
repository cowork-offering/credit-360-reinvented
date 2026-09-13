/* =============================================================================
   THE SUBSTITUTION SEAM: the memo says THIS borrower's facts, not the demo's.

   THE VENDORED RENDERER CARRIES LITERALS. It was written to render one fixture
   for one demo, so values in it are typed into the source rather than read off
   the dossier: the two names on the cover, the prepared date, the memo type,
   two rows naming a specific machine, the guarantor's relationship line, and a
   pro forma fixed-charge figure. Rendering a Hartwell memo through it unchanged
   puts Piedmont's demo furniture under Hartwell's name, which is the one thing
   a credit memo may never do.

   AND IT CARRIES SHAPES, NOT ONLY VALUES (2026-09-13). The Key Metrics table is
   built the way one demo's figures happened to fit: an always-on pro forma
   column that repeats the latest year, an axis capped at three columns, a
   covenant test printed in a fiscal column, and three different words for the
   same absence. None of that is a dossier field either, so the last entry in
   the table below replaces the whole block.

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
import type { MemoChange, MemoDossier, MemoSeries } from "./types";

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
  /**
   * The whole Key Metrics table, rebuilt from the dossier's own period axis.
   *
   * ABSENT LEAVES THE RENDERER'S TABLE ALONE, the same third state
   * `proFormaLeverage` carries, so a caller that has no dossier in hand (the
   * seam's own unit tests) still gets a memo. `keyMetricsFrom` builds it.
   */
  keyMetrics?: KeyMetricsSpec;
}

/* -----------------------------------------------------------------------------
   THE KEY METRICS TABLE, REBUILT (2026-09-13, founder report)

   FOUR THINGS THE RENDERER DOES TO THIS TABLE THAT THE DOSSIER CANNOT FIX.

   1. It prints a Pro Forma column on every memo, and fills the Revenue and
      Adjusted EBITDA cells by REPEATING the latest fiscal column's figure with
      the words "(unchanged)" beside it. On a memo with no executed step there
      is no pro forma to state, and a repeated figure reads as a fourth year.
   2. It caps the axis at three columns (`periodsArr.slice(-3)`), so a book
      carrying four periods loses its oldest one with nothing saying so.
   3. It puts nCino's last covenant test in the LAST FISCAL COLUMN of the Debt
      Service Coverage row. That test has its own date (Hartwell: 2026-07-15)
      and is not a fiscal-year figure; printing it under "LTM" mixes two source
      systems inside one row.
   4. It writes three different words for the same absence in one table:
      "flagged for RM" in a measured cell, "not modeled" in a pro forma one,
      and the doctrine marker through the `pro_forma_leverage` entry above.

   So the seam rebuilds the table. It is the largest entry in this inventory and
   the only one that writes a whole block rather than a cell, which is exactly
   why the shape below is data and not HTML: `keyMetricsFrom` makes every
   judgement against the dossier, and `keyMetricsHtml` only writes it out.
   ----------------------------------------------------------------------------- */

/** One cell: a figure with the unit it is printed in, or null for the gap. */
export type KeyMetricsCell = { value: number; unit: "$" | "x" } | null;

/** One row: the label as the renderer writes it, and one cell per column. */
export interface KeyMetricsRow {
  label: string;
  cells: readonly KeyMetricsCell[];
}

export interface KeyMetricsSpec {
  /** Column headers in order, oldest to newest, pro forma last where present. */
  columns: readonly string[];
  rows: readonly KeyMetricsRow[];
  /** The sentences printed under the table, in order. */
  footnotes: readonly string[];
}

/** The pro forma column's header. Not a fiscal period, and labelled as such. */
const PRO_FORMA = "Pro forma";

/**
 * WHAT AN EMPTY CELL SAYS. One vocabulary for absence in this table, and this
 * is the one, because it is the renderer's own gap word and what every other
 * empty cell in the memo already reads. "not modeled" is dropped: it claims a
 * modelling decision where the only fact is that no source carries the figure.
 * The doctrine marker is dropped from this table too: its cells hold figures or
 * nothing, never a marker string, and the long form is unreadable in a numeric
 * column repeated thirty times.
 */
const KEY_METRICS_GAP = "flagged for RM";

/** The renderer's own money and multiple formatters, so a rebuilt cell and a
 *  rendered cell print the same figure the same way. (render-memo.mjs:69) */
const fmtUSD = (n: number): string => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${n.toLocaleString()}`);
const fmtX = (n: number): string => `${n.toFixed(2)}x`;

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const at = (s: MemoSeries | undefined, p: string): number | null => finite(s?.[p]);
const money = (v: number | null): KeyMetricsCell => (v == null ? null : { value: v, unit: "$" });
const times = (v: number | null): KeyMetricsCell => (v == null ? null : { value: v, unit: "x" });

/** A step that moved a commitment. A step that moved only a maturity or a
 *  covenant changes no debt, so it earns no pro forma column. */
const movesDebt = (c: MemoChange): boolean => {
  const after = finite(c.after?.commitment);
  if (after == null) return false;
  const before = finite(c.before?.commitment);
  return before == null || after !== before;
};

/** "2026-07-15" as the memo writes dates. Deterministic and UTC; the renderer's
 *  own `fmtDate` reads the host locale, which a test cannot pin. */
const longDate = (iso: string | null): string | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
};

/**
 * THE TABLE THE MEMO SHOULD CARRY, decided entirely from the dossier.
 *
 * ONE COLUMN PER PERIOD THE SPREAD CARRIES, oldest to newest, labelled by the
 * book's own fiscal label. No slice: a book carrying four periods prints four.
 *
 * REVENUE, CASH AND FREE CASH FLOW ARE PER PERIOD, off the income statement,
 * the balance sheet and the cash-flow statement. A period the file has no
 * balance sheet or no cash-flow statement for gets the gap, not a carried
 * figure.
 *
 * ADJUSTED EBITDA AND LEVERAGE ARE THE RATIO SET, and the ratio set has one
 * period (`ratios.period`). They are stated in that column and marked in every
 * other, because Boom struck them once and repeating them across the axis
 * claims four measurements where there was one.
 *
 * DEBT SERVICE COVERAGE IS IN NO FISCAL COLUMN. It is nCino's last covenant
 * test, on the covenant's own evaluation date, and it goes under the table as a
 * footnote naming that date.
 *
 * THE PRO FORMA COLUMN EXISTS ONLY WHERE A STEP MOVED A COMMITMENT, and carries
 * only what the step supports: the leverage multiple, from the as of period's
 * total debt plus this action's commitment change over the as of period's
 * Adjusted EBITDA. A step does not change last year's revenue, so every other
 * pro forma cell is the gap.
 */
export function keyMetricsFrom(dossier: MemoDossier, changes: readonly MemoChange[] = []): KeyMetricsSpec {
  const canon = dossier.canon;
  const spread = canon.spread;
  const periods = spread.periods;
  const ratios = canon.ratios;
  const ratioPeriod = ratios?.period ?? null;

  const revenue = spread.incomeStatement.sales_revenue;
  const ebitdaSeries = spread.incomeStatement.adjusted_ebitda;
  const cash = spread.balanceSheet.cash_and_equivalents;
  const totalDebt = spread.balanceSheet.total_debt;
  const ocf = spread.cashFlow.operating_cash_flow;
  // Boom signs capital expenditure negative, so free cash flow is the SUM. The
  // renderer's own arithmetic, kept.
  const capex = spread.cashFlow.capital_expenditures;
  const fcf = (p: string): number | null => {
    const o = at(ocf, p);
    const c = at(capex, p);
    return o == null || c == null ? null : o + c;
  };

  const asOfDebt = ratioPeriod ? at(totalDebt, ratioPeriod) : null;
  const asOfEbitda = ratioPeriod ? (finite(ratios?.ebitda) ?? at(ebitdaSeries, ratioPeriod)) : null;
  // Boom's own multiple where it struck one, else the same arithmetic over the
  // two spread lines it would have used. Never a figure from another period.
  const spreadLeverage = asOfDebt != null && asOfEbitda ? asOfDebt / asOfEbitda : null;
  const asOfLeverage = ratioPeriod ? (finite(ratios?.totalLeverage) ?? spreadLeverage) : null;

  /* A VERSION IN FLIGHT OPENS THE COLUMN TOO (0.9.23, spec 2a.6).
     `movesDebt` reads EXECUTED plan steps, and a modification filed a day ago
     has executed none: the commitment moved when nCino forked the version, and
     the change sits on the unbooked package. So a memo written over a version
     printed no Pro forma column at all, on the one table whose whole job is to
     say what this action does to leverage. The delta is the dossier's own,
     unchanged: `changeInExposure.commitment` is the version's movement where
     there is one and the steps' where there is not. */
  const version = canon.versionInFlight;
  const versionMoves = version != null && (finite(version.commitmentDelta) ?? 0) !== 0;
  const moved = changes.some(movesDebt) || versionMoves;
  const delta = finite(canon.exposureSummary?.changeInExposure?.commitment) ?? 0;
  const proFormaLeverage = moved && asOfDebt != null && asOfEbitda ? (asOfDebt + delta) / asOfEbitda : null;

  const columns = moved ? [...periods, PRO_FORMA] : [...periods];
  /** A row measured per period, with nothing to say in the pro forma column. */
  const perPeriod = (label: string, cell: (p: string) => KeyMetricsCell): KeyMetricsRow => ({
    label,
    cells: moved ? [...periods.map(cell), null] : periods.map(cell),
  });
  /** A row the ratio set owns: its own column, and the gap everywhere else. */
  const atRatioPeriod = (label: string, value: KeyMetricsCell, pro: KeyMetricsCell): KeyMetricsRow => ({
    label,
    cells: moved
      ? [...periods.map((p) => (p === ratioPeriod ? value : null)), pro]
      : periods.map((p) => (p === ratioPeriod ? value : null)),
  });

  const rows: KeyMetricsRow[] = [
    perPeriod("Revenue", (p) => money(at(revenue, p))),
    atRatioPeriod("Adjusted EBITDA", money(asOfEbitda), null),
    atRatioPeriod(`Debt ${DIV} EBITDA`, times(asOfLeverage), times(proFormaLeverage)),
    perPeriod("Cash &amp; Equivalents", (p) => money(at(cash, p))),
    perPeriod("Free Cash Flow", (p) => money(fcf(p))),
    perPeriod("Debt Service Coverage", () => null),
  ];

  return { columns, rows, footnotes: keyMetricsFootnotes(dossier, ratioPeriod, moved, proFormaLeverage != null) };
}

/** The covenant the Debt Service Coverage footnote is written from. */
const dscCovenant = (dossier: MemoDossier) =>
  (dossier.ic?.covenantCompliance ?? []).find((c) => /debt service|fixed charge|coverage/i.test(String(c.name ?? "")));

function keyMetricsFootnotes(
  dossier: MemoDossier,
  ratioPeriod: string | null,
  moved: boolean,
  proFormaStated: boolean,
): string[] {
  const out: string[] = [];
  const version = dossier.canon.versionInFlight;

  const dsc = dscCovenant(dossier);
  const actual = finite(dsc?.actual) ?? finite(dsc?.actuals?.[dsc.actuals.length - 1]);
  const tested = longDate(dsc?.quarters?.[0] ?? null);
  out.push(
    actual != null
      ? `${esc(String(dsc?.name ?? "Debt Service Coverage"))} ${fmtX(actual)}, as nCino last tested it${tested ? ` on ${esc(tested)}` : ""}. A covenant test carries its own evaluation date and is not a fiscal-year figure, so it is stated here rather than in a fiscal column.`
      : "No covenant the cockpit reads carries a debt service coverage actual, so the row is marked in every column rather than filled from another period.",
  );

  const asOf = ratioPeriod ? esc(ratioPeriod) : null;
  out.push(
    `Revenue, Cash and Equivalents and Free Cash Flow (operating cash flow less capital expenditures) are read per period off the Boom spread. ` +
      (asOf
        ? `Adjusted EBITDA and Debt ${DIV} EBITDA are Boom's ratio set for ${asOf} and are stated in that column only, because that is the one period they were computed for. `
        : `Boom's ratio set names no period on this axis, so Adjusted EBITDA and Debt ${DIV} EBITDA are marked in every column. `) +
      `Every cell the spread does not carry reads "${KEY_METRICS_GAP}". Nothing in this table is estimated.`,
  );

  if (moved) {
    /* WHERE THE FIGURES CAME FROM, NAMED. A pro forma struck off a version
       nobody has booked is a different claim from one struck off an executed
       step, and a credit officer reading a leverage multiple is entitled to
       know which. The phrase is the dossier's own, so the callout above the
       table and the footnote under it say it the same way. */
    const source = version
      ? `the version in flight (${esc(version.versionName)}), which nobody has booked`
      : "the executed step";
    out.push(
      proFormaStated
        ? `The Pro forma column carries only what ${source} supports: this action's commitment change added to the as of period's total bank debt, over the as of period's Adjusted EBITDA. It does not restate a prior year, so every other pro forma cell is marked.`
        : `The Pro forma column is marked throughout: the book carries no balance sheet, so this action's effect on leverage cannot be computed from it, and no other line in this table is changed by ${source}.`,
    );
  }

  return out;
}

/** The spec, written out as the renderer would have written it. */
function keyMetricsHtml(spec: KeyMetricsSpec): string {
  const head = spec.columns.map((c) => `<th class="numeric">${esc(c)}</th>`).join("");
  const cell = (c: KeyMetricsCell): string =>
    c == null
      ? `<td class="numeric"><span class="gap">${KEY_METRICS_GAP}</span></td>`
      : `<td class="numeric">${c.unit === "x" ? fmtX(c.value) : fmtUSD(c.value)}</td>`;
  // The row labels are written the way the renderer writes them, entities and
  // all ("Cash &amp; Equivalents"), so they are not escaped a second time.
  const rows = spec.rows.map((r) => `<tr><td>${r.label}</td>${r.cells.map(cell).join("")}</tr>`).join("\n      ");
  const notes = spec.footnotes.map((f) => `<div class="legend">${f}</div>`).join("");
  return (
    `<div class="subhead">Key Metrics</div>\n      ` +
    `<table><thead><tr><th>Metric</th>${head}</tr></thead><tbody>\n      ${rows}\n      </tbody></table>\n      ${notes}`
  );
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
 * THE INVENTORY. Found by reading the vendored renderer in Phase A, re-read
 * against `renderMemo.vendor.mjs` on 2026-09-04, and extended on 2026-09-13
 * with the Key Metrics block (founder report, same date). Applied in this
 * order, which is why `key_metrics_table` is last: it replaces the block the
 * `pro_forma_leverage` entry corrects a cell of.
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
  /* LAST ON PURPOSE. `pro_forma_leverage` above still runs on the renderer's own
     table for a caller that hands over no `keyMetrics`; where one is handed
     over, this replaces the whole block and that correction goes with it. */
  {
    id: "key_metrics_table",
    where: "render-memo.mjs:387 to :419 and :486, the Key Metrics subhead, table and legend",
    why: "The renderer repeats the latest fiscal column into an always-on Pro Forma column and stamps it \"(unchanged)\", caps the axis at three columns however many the book carries, puts nCino's last covenant test in a fiscal column of the Debt Service Coverage row, and writes three different words for the same absence in one table. None of that is a dossier field, so none of it can be fixed by handing the renderer better data.",
    find: /<div class="subhead">Key Metrics[^<]*<\/div>[\s\S]*?<\/table>\s*<div class="legend">[\s\S]*?<\/div>/,
    replace: (o, m) => (o.keyMetrics ? keyMetricsHtml(o.keyMetrics) : (m?.[0] ?? "")),
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
