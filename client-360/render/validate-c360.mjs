#!/usr/bin/env node
// VALIDATE the Credit 360 cockpit data — the deterministic "effective challenge" stage (SR 11-7).
//
// This module recomputes covenant figures from the Boom spread and runs a data-quality sweep. It is
// the ONLY source of the challenge/dataQuality numbers: LLMs never compute these figures. Everything
// here is pure arithmetic over data already fetched into C360_DATA.
//
// It reads the NORMALISED Boom shape (client-360/render/boom-normalise.mjs): the raw
// boom_get_spread payload under `boom.spread.file`, and boom_get_ratios `raw` under
// `boom.ratios.raw`. The assemblers normalise before this runs, so this stage and the Financials
// tab read ONE shape.
//
// It augments the data object IN PLACE (and returns it) with two new surfaces:
//
//   • <bundle>.covenantChallenge[] — per covenant, the Boom-implied value beside the nCino actual,
//     with a corroborated / diverges / not-computable verdict. Divergence is a REVIEW FLAG, never a
//     breach determination — the bank's contractual covenant definitions are nCino-owned and may
//     differ from these standard ratio definitions.
//   • data.dataQuality[] — deterministic data-integrity findings across the staged book.
//
// Idempotent: re-running rebuilds both surfaces from scratch (no double-append).
//
//   node validate-c360.mjs --data <c360-data.json> [--out <out.json>]
//
// With --out it writes the augmented JSON; without, it prints a human summary and writes nothing.
// No dependencies beyond node built-ins. Node 18+.
import { readFileSync, writeFileSync } from "node:fs";
import { indexSpreadFile, ratiosAsOf, REVENUE_CODES } from "./boom-normalise.mjs";

// ---------------------------------------------------------------- formula registry
// covenantType → standard-definition recompute. Matched case-insensitively by substring, in order.
// `unit`: "ratio" rounds to 2dp, "dollars" rounds to whole dollars.
//
// EVERY INPUT NAMES THE CODES BOOM ACTUALLY EMITS, as `{ key, codes[], abs?, derive? }`:
//
//   codes[]  spread accountCodes, tried in order. A `ratios:<field>` entry reads boom_get_ratios
//            `raw` instead of the chart, and is offered ONLY when the ratios' `asOf` is the period
//            being recomputed. That is the only way EBITDA reaches this table: Boom's accountCode
//            chart carries no depreciation and amortisation line at all (the cash-flow D&A row has
//            no accountCode), so no spread code can produce an EBITDA.
//   abs      the spread signs expenses negative (interest_expense arrives as -1,076,000). A
//            coverage definition ADDS an expense to the denominator; taking the sign as given
//            would subtract it and print a coverage ratio nothing in the deal supports.
//   derive   last resort: sum whichever of the listed codes the period carries. Total debt needs
//            it, because Boom emits the facility lines and not a total_debt row.
//
// A CODE BOOM DOES NOT EMIT IS NEVER SWAPPED FOR A LOOKALIKE. CPLTD is the case that matters:
// `st_loans_payable_bank` is "Line of Credit and Current Portion of Long-Term Debt", so reading it
// as CPLTD would load the whole revolver into debt service and report a DSC that is not the
// covenant's. Missing stays missing, and the note names every code that was tried.
const FORMULAS = [
  {
    match: ["debt service coverage"],
    direction: "min",
    unit: "ratio",
    formula: "Adjusted EBITDA / (Interest Expense + CPLTD)",
    inputs: [
      { key: "adjusted_ebitda", codes: ["adjusted_ebitda", "ratios:ebitda"] },
      { key: "interest_expense", codes: ["interest_expense"], abs: true },
      { key: "current_portion_ltd", codes: ["current_portion_ltd", "cpltd_bank", "current_maturities_ltd"] },
    ],
    compute: (v) => v.adjusted_ebitda / (v.interest_expense + v.current_portion_ltd),
  },
  {
    match: ["debt to worth", "debt to equity", "leverage"],
    direction: "max",
    unit: "ratio",
    formula: "Total Debt / Total Equity",
    inputs: [
      {
        key: "total_debt",
        codes: ["total_debt", "ratios:totalDebt"],
        derive: ["st_loans_payable_bank", "current_portion_ltd", "long_term_debt_bank"],
      },
      { key: "total_equity", codes: ["total_equity", "total_stockholders_equity"] },
    ],
    compute: (v) => v.total_debt / v.total_equity,
  },
  {
    match: ["liquidity"],
    direction: "min",
    unit: "dollars",
    formula: "Cash & Equivalents",
    inputs: [{ key: "cash_and_equivalents", codes: ["cash_and_equivalents", "cash"] }],
    compute: (v) => v.cash_and_equivalents,
  },
  {
    match: ["fixed asset purchases"],
    direction: "max",
    unit: "dollars",
    formula: "Capital Expenditures (FY)",
    inputs: [{ key: "capital_expenditures", codes: ["capital_expenditures", "purchases_of_ppe"], abs: true }],
    compute: (v) => v.capital_expenditures,
  },
];

const CHECK_TYPES = [
  "rollup-gap", "missing-rating", "stale-covenant-eval", "covenant-overdue",
  "boom-period-mismatch", "coverage-null", "util-null",
];

const isNum = (n) => typeof n === "number" && Number.isFinite(n);
const round2 = (n) => Math.round(n * 100) / 100;
const roundBy = (n, unit) => (unit === "ratio" ? round2(n) : Math.round(n));

// Flatten a boom.spread onto the RAW payload it keeps under `spread.file`, indexed
// accountCode → period end date → value. The end date is the only period identity that means
// anything: `periodValues` is keyed by the period's UUID, and reading a year out of a UUID is
// exactly how "the latest period" used to resolve to a random one.
function indexSpread(spread) {
  const flat = indexSpreadFile(spread && spread.file);
  return flat ? { index: flat.index, period: flat.latest } : null;
}

/** boom_get_ratios `raw`, but ONLY when its asOf is the period being recomputed. A ratio computed
 *  for another year is a different fact, not a fallback. */
function ratiosFor(boom, period) {
  const ratios = boom && boom.ratios;
  if (!ratios || !period || ratiosAsOf(ratios) !== period) return null;
  return ratios.raw && typeof ratios.raw === "object" ? ratios.raw : null;
}

/**
 * Resolve one formula input for a period.
 *
 * Returns `{ value, source, tried }`, where `source` is the code that satisfied it (or
 * "derived: a + b"), and `tried` is every code that was looked for, so a not-computable covenant
 * can say what was missing instead of naming one code the spread never had.
 */
function resolveInput(spec, index, period, ratiosRaw) {
  const tried = [];
  const signed = (v) => (spec.abs ? Math.abs(v) : v);

  for (const code of spec.codes || []) {
    tried.push(code);
    if (code.startsWith("ratios:")) {
      const v = ratiosRaw ? ratiosRaw[code.slice("ratios:".length)] : undefined;
      if (isNum(v)) return { value: signed(v), source: code, tried };
      continue;
    }
    const row = index[code];
    const v = row ? row[period] : undefined;
    if (isNum(v)) return { value: signed(v), source: code, tried };
  }

  if (spec.derive) {
    const parts = [];
    let sum = 0;
    for (const code of spec.derive) {
      tried.push(code);
      const row = index[code];
      const v = row ? row[period] : undefined;
      if (isNum(v)) { sum += signed(v); parts.push(code); }
    }
    if (parts.length) return { value: sum, source: `derived: ${parts.join(" + ")}`, tried };
  }

  return { value: null, source: null, tried };
}

function matchFormula(covenantType) {
  const t = String(covenantType || "").toLowerCase();
  return FORMULAS.find((f) => f.match.some((m) => t.includes(m))) || null;
}

const nCinoCompliant = (cov) => {
  const s = String(cov.covenantStatus ?? cov.lastEvaluationStatus ?? "").toLowerCase();
  if (s) return s === "compliant";
  return cov.breached === false;
};

// ---------------------------------------------------------------- AUGMENTATION 1: covenant challenge
function buildChallenge(bundle) {
  const covenants = (bundle && bundle.covenants && Array.isArray(bundle.covenants.covenants))
    ? bundle.covenants.covenants : [];
  const boom = (bundle && bundle.boom) ? bundle.boom : null;
  const flat = boom && boom.spread ? indexSpread(boom.spread) : null;
  const period = flat ? flat.period : null;
  const ratiosRaw = ratiosFor(boom, period);

  const noteFor = (p) =>
    `Boom-implied value uses standard ratio definitions over the latest spread period (${p}); ` +
    `the bank's contractual definitions are nCino-owned and may differ. ` +
    `Divergence is a review flag, not a breach determination.`;

  const out = [];
  for (const cov of covenants) {
    const spec = matchFormula(cov.covenantType);
    const entry = {
      covenantId: cov.covenantId ?? null,
      covenantType: cov.covenantType ?? null,
      nCinoActual: cov.actualValue ?? null,
      threshold: cov.thresholdValue ?? null,
      direction: spec ? spec.direction : null,
      boomImplied: null,
      delta: null,
      status: "not-computable",
      note: "",
    };

    if (!boom) {
      entry.note = "Boom spread not on file for this borrower — no source to recompute the covenant.";
      out.push(entry); continue;
    }
    if (!spec) {
      entry.note = `Covenant type "${cov.covenantType}" has no standard-definition mapping — not recomputed.`;
      out.push(entry); continue;
    }
    if (!flat) {
      entry.note = "Boom spread carries no raw line items under spread.file, so nothing can be recomputed.";
      out.push(entry); continue;
    }

    const inputs = {};
    const sources = {};
    let missing = null;
    for (const input of spec.inputs) {
      const got = resolveInput(input, flat.index, period, ratiosRaw);
      if (got.value === null) { missing = { key: input.key, tried: got.tried }; break; }
      inputs[input.key] = got.value;
      sources[input.key] = got.source;
    }
    if (missing) {
      entry.note =
        `Boom carries no "${missing.key}" for period ${period}. Tried ${missing.tried.join(", ")}. ` +
        `Not recomputed; the covenant stands on the nCino actual alone.`;
      out.push(entry); continue;
    }

    const raw = spec.compute(inputs);
    if (!Number.isFinite(raw)) {
      entry.note = `Recompute produced a non-finite value (check denominators) for period ${period}.`;
      out.push(entry); continue;
    }

    const value = roundBy(raw, spec.unit);
    entry.boomImplied = { value, formula: spec.formula, inputs, sources, period };
    entry.delta = roundBy(value - Number(entry.nCinoActual), spec.unit);
    entry.note = noteFor(period);

    // status: crossing (opposite compliance side vs nCino) ALWAYS wins → diverges + breachRiskFlag.
    const boomCompliant = spec.direction === "min"
      ? value >= Number(entry.threshold)
      : value <= Number(entry.threshold);
    const crossing = entry.threshold != null && (nCinoCompliant(cov) !== boomCompliant);
    const base = Math.abs(Number(entry.nCinoActual));
    const relDelta = base > 0 ? Math.abs(value - Number(entry.nCinoActual)) / base : Infinity;

    if (crossing) { entry.status = "diverges"; entry.breachRiskFlag = true; }
    else if (relDelta > 0.15) { entry.status = "diverges"; }
    else { entry.status = "corroborated"; }

    out.push(entry);
  }
  bundle.covenantChallenge = out;
  return out;
}

// ---------------------------------------------------------------- AUGMENTATION 2: data quality sweep
function daysBetween(aISO, bISO) {
  const a = Date.parse(aISO), b = Date.parse(bISO);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

function buildDataQuality(data) {
  const findings = [];
  const dateISO = data.meta && data.meta.dateISO;

  // Unique account bundles: the staged book keyed by accountId, plus the anchor alias if distinct.
  const bundles = new Map();
  if (data.borrowers && typeof data.borrowers === "object") {
    for (const [id, b] of Object.entries(data.borrowers)) if (b) bundles.set(id, b);
  }
  if (data.borrower && data.borrower.snapshot) {
    const id = data.borrower.snapshot.accountId;
    if (id && !bundles.has(id)) bundles.set(id, data.borrower);
  }

  for (const b of bundles.values()) {
    const snap = b.snapshot || {};
    const exp = b.exposure || {};
    const committed = Number(exp.totalCommitted) || 0;
    const acct = { accountId: snap.accountId, accountName: snap.name };

    // rollup-gap (warn): package rollup is 0 while facility-level commitments exist.
    if (snap.totalCreditExposure === 0 && committed > 0) {
      findings.push({
        severity: "warn", code: "rollup-gap", ...acct,
        message: `Package snapshot totalCreditExposure is $0 but facility-level totalCommitted is $${committed.toLocaleString()} — package rollup has not been computed.`,
      });
    }
    // missing-rating (warn): committed exposure with no primary risk rating.
    if (committed > 0 && (snap.primaryRiskRating == null || snap.primaryRiskRating === "")) {
      findings.push({
        severity: "warn", code: "missing-rating", ...acct,
        message: `Account carries $${committed.toLocaleString()} committed but has no primaryRiskRating on file.`,
      });
    }
    // stale-covenant-eval (warn): covenant last evaluated > 90 days before the report date.
    const covs = (b.covenants && Array.isArray(b.covenants.covenants)) ? b.covenants.covenants : [];
    for (const cov of covs) {
      if (!cov.lastEvaluationDate || !dateISO) continue;
      const age = daysBetween(dateISO, cov.lastEvaluationDate);
      if (age != null && age > 90) {
        findings.push({
          severity: "warn", code: "stale-covenant-eval", ...acct,
          message: `Covenant "${cov.covenantType}" last evaluated ${cov.lastEvaluationDate} — ${age} days before report date ${dateISO} (>90).`,
        });
      }
    }
    // coverage-null (info): secured facility with no coverage ratio computed
    // AND no reason given. A facility carrying `coverageNote` has already been
    // explained by the org — an undrawn facility has nothing to cover, and that
    // is a fact, not a finding to chase.
    for (const f of (exp.facilities || [])) {
      const collat = f && f.collateral;
      const hasCollateral = Array.isArray(collat) ? collat.length > 0 : Number(collat) > 0;
      if (hasCollateral && (f.coverageRatio == null) && !f.coverageNote) {
        findings.push({
          severity: "info", code: "coverage-null", ...acct,
          message: `Facility "${f.name || f.loanId}" has pledged collateral but coverageRatio is null.`,
        });
      }
    }
    // boom-period-mismatch (warn): ratios revenue vs spread latest sales_revenue > 1%.
    if (b.boom && b.boom.ratios && b.boom.spread) {
      const rawRev = b.boom.ratios.raw && b.boom.ratios.raw.revenue;
      const flat = indexSpread(b.boom.spread);
      // Boom's income statement names revenue net_sales_revenue; the older code looked only for
      // sales_revenue, so the cross-check never had a figure to compare and never fired.
      let revCode = null, spreadRev;
      for (const code of REVENUE_CODES) {
        const v = flat && flat.index[code] ? flat.index[code][flat.period] : undefined;
        if (typeof v === "number") { revCode = code; spreadRev = v; break; }
      }
      if (typeof rawRev === "number" && typeof spreadRev === "number" && spreadRev !== 0) {
        const pct = Math.abs(rawRev - spreadRev) / Math.abs(spreadRev);
        if (pct > 0.01) {
          const asOf = b.boom.ratios.asOf || "ratios period";
          findings.push({
            severity: "warn", code: "boom-period-mismatch", ...acct,
            message: `Boom ratios revenue $${rawRev.toLocaleString()} (asOf ${asOf}) differs from spread ${revCode} $${spreadRev.toLocaleString()} (${flat.period}) by ${(pct * 100).toFixed(1)}%.`,
          });
        }
      }
    }
  }

  // covenant-overdue (critical): ONE aggregated finding over the portfolio-wide EWS signal.
  const dueSoon = (data.portfolio && data.portfolio.signals && Array.isArray(data.portfolio.signals.covenantsDueSoon))
    ? data.portfolio.signals.covenantsDueSoon : [];
  const overdue = dueSoon.filter((c) => c && c.overdue === true);
  if (overdue.length > 0) {
    const top3 = [...overdue]
      .sort((a, b) => (a.daysUntilNextEvaluation ?? 0) - (b.daysUntilNextEvaluation ?? 0))
      .slice(0, 3)
      .map((c) => c.accountName)
      .filter(Boolean);
    findings.push({
      severity: "critical", code: "covenant-overdue",
      message: `${overdue.length} covenant evaluation(s) past due but still active in nCino. Most overdue: ${top3.join(", ")}.`,
    });
  }

  // util-null (info): book-wide utilization could not be computed.
  const util = data.portfolio && data.portfolio.bookTotals ? data.portfolio.bookTotals.utilizationPct : undefined;
  if (util === null) {
    findings.push({
      severity: "info", code: "util-null",
      message: "Portfolio bookTotals.utilizationPct is null (Σtce = 0) — utilization cannot be computed.",
    });
  }

  const rank = { critical: 0, warn: 1, info: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return findings;
}

// ---------------------------------------------------------------- public entry
export function validateC360(data) {
  if (!data || typeof data !== "object") throw new Error("validateC360: data must be an object");

  // Augment every staged bundle + the anchor alias. Dedup by object reference so that when
  // data.borrower and data.borrowers[anchorId] are the SAME object we augment it once.
  const seen = new Set();
  if (data.borrower && typeof data.borrower === "object") seen.add(data.borrower);
  if (data.borrowers && typeof data.borrowers === "object") {
    for (const b of Object.values(data.borrowers)) if (b && typeof b === "object") seen.add(b);
  }
  for (const bundle of seen) buildChallenge(bundle);

  const dataQuality = buildDataQuality(data);
  data.dataQuality = dataQuality;

  data.meta = data.meta || {};
  data.meta.validation = {
    ranAt: data.meta.generatedAt ?? null,
    checks: CHECK_TYPES.length,
    findings: dataQuality.length,
  };
  return data;
}

// count challenges over unique accounts (staged book, else the anchor alias) — for summaries.
export function challengeCount(data) {
  if (data.borrowers && typeof data.borrowers === "object") {
    let n = 0;
    for (const b of Object.values(data.borrowers)) n += (b && b.covenantChallenge ? b.covenantChallenge.length : 0);
    return n;
  }
  return data.borrower && data.borrower.covenantChallenge ? data.borrower.covenantChallenge.length : 0;
}

// ---------------------------------------------------------------- CLI
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
  const die = (m) => { console.error(`ERROR: ${m}`); process.exit(1); };
  const dataPath = arg("--data");
  const outPath = arg("--out");
  if (!dataPath) die("missing --data <path/to/c360-data.json>  (usage: node validate-c360.mjs --data <data.json> [--out <out.json>])");

  let data;
  try { data = JSON.parse(readFileSync(dataPath, "utf8")); }
  catch (e) { die(`cannot read/parse --data ${dataPath}: ${e.message}`); }

  validateC360(data);

  if (outPath) {
    try { writeFileSync(outPath, JSON.stringify(data, null, 2)); }
    catch (e) { die(`cannot write --out ${outPath}: ${e.message}`); }
    console.log(`OK — wrote ${outPath} · challenge ${challengeCount(data)} covenants · DQ ${data.dataQuality.length} findings`);
  } else {
    const lines = [];
    lines.push(`Credit 360 validation — anchor ${data.meta && data.meta.anchorAccountId}`);
    lines.push(`  challenge: ${challengeCount(data)} covenant(s) recomputed`);
    const anchor = data.borrowers && data.meta ? data.borrowers[data.meta.anchorAccountId] : null;
    for (const c of (anchor && anchor.covenantChallenge) || []) {
      const bi = c.boomImplied ? c.boomImplied.value : "n/a";
      const flag = c.breachRiskFlag ? " ⚠ breach-risk" : "";
      lines.push(`    · ${c.covenantType}: nCino ${c.nCinoActual} vs boom ${bi} → ${c.status}${flag}`);
    }
    lines.push(`  dataQuality: ${data.dataQuality.length} finding(s)`);
    for (const f of data.dataQuality) {
      lines.push(`    [${f.severity}] ${f.code}${f.accountName ? " · " + f.accountName : ""}: ${f.message}`);
    }
    console.log(lines.join("\n"));
  }
}
