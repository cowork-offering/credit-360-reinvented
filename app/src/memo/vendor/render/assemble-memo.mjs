#!/usr/bin/env node
// ASSEMBLE + RENDER the credit memo in ONE step — the call-count optimizer.
//
// BUNDLED-DEFAULT, LIVE-ON-ASK. By default this renders entirely from BUNDLED data shipped in the
// plugin assets/ — nCino stub + a captured Boom snapshot (spread + ratios) + the written narratives —
// so the standard draft renders in ONE command with ZERO MCP calls (no cold-start, instant). To
// refresh from live Boom, pass --boom <boom_get_spread.json> and/or --ratios <boom_get_ratios.json>;
// those override the bundled snapshots. Everything not in a source system is clearly derived, never
// fabricated; ratios that can't compute render NS/—.
//
//   node assemble-memo.mjs --out <memo.html>                       # instant, bundled snapshot
//   node assemble-memo.mjs --out <memo.html> --boom <spread.json> --ratios <ratios.json>   # live refresh
//   [--ncino <stub.json>] [--narratives <json>] [--reviewer <json>] [--static]
//
// Headline KPIs (revenue, YoY, EBITDA, margin, leverage) come from the Boom RATIOS payload — the same
// source the widgets read — so the memo numbers MATCH the deal-summary / Boom widgets exactly.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMemo } from "./render-memo.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
const SKILL = join(here, "..");

const ASSETS = join(SKILL, "..", "..", "assets");
const ncinoPath = arg("--ncino") ?? join(ASSETS, "ncino-demo-data.json");
const nc = JSON.parse(readFileSync(ncinoPath, "utf8"));
// Written narratives (the analyst prose) — bundled so the memo is pre-populated, never blank placeholders.
const narrPath = arg("--narratives") ?? join(ASSETS, "piedmont-narratives.json");
let narratives = {}; try { narratives = JSON.parse(readFileSync(narrPath, "utf8")); } catch (e) { console.error("narratives skipped:", e.message); }

// ---------------------------------------------------------------- canon (from nCino stub)
const a = nc.account ?? {}, pkg = nc.productPackage ?? {}, loans = nc.loans ?? [];
const guar = (nc.guarantors ?? [])[0] ?? null;
const isRevolver = (l) => /revolv|rcf|working capital/i.test(`${l.product} ${l.name}`);
const canon = {
  borrower: {
    name: a.name, naics: a.naics, naicsDesc: a.naicsDesc, segment: "C&I",
    currentRiskRating: a.riskRating, profile: a.profile, salesforceAccountId: nc.externalUniqueId,
    instanceUrl: nc.instanceUrl ?? a.instanceUrl ?? null   // → enables inline record deep-links (dynamic, from the nCino source)
  },
  creditAction: {
    productPackageName: pkg.name, creditEvent: "existing_material", tier: "core",
    flags: {
      has_new_money: loans.some((l) => l.isNewMoney),
      has_revolver: loans.some(isRevolver),
      has_revolver_increase: loans.some((l) => l.isIncrease),
      has_guarantor: !!guar,
      guarantor_types: guar ? [(guar.entityType || "individual").toLowerCase()] : [],
      has_financial_covenants: (nc.covenants ?? []).length > 0,
      collateral_types: [...new Set((nc.collateral ?? []).map((c) => /equip|mazak|cnc/i.test(c.description || "") ? "equipment" : "blanket_lien"))],
      has_real_estate: false, has_deposits: false, is_syndicated: false, is_peg: false,
      is_lft: false, is_public: false, exposure_total: pkg.totalCommitment ?? 0, sbe_threshold_breached: false
    }
  },
  loans: loans.map((l) => ({
    id: isRevolver(l) ? "RCF" : "TLA", ncinoId: l.ncinoId ?? l.id ?? null, name: l.name, purpose: l.product, riskRating: l.riskRating,
    isNewMoney: !!l.isNewMoney, isIncrease: !!l.isIncrease,
    existing: l.isNewMoney ? { commitment: 0, outstanding: 0, maturity: null }
      : { commitment: l.commitment, outstanding: l.outstanding ?? 0, maturity: l.maturity },
    proposed: { commitment: l.commitment, outstanding: l.outstanding ?? (l.fundingAtClose ?? 0), maturity: l.maturity }
  })),
  exposureSummary: {
    existing: { commitment: loans.filter((l) => !l.isNewMoney).reduce((s, l) => s + (l.commitment || 0), 0), outstanding: pkg.outstanding ?? 0 },
    proposed: { commitment: pkg.totalCommitment ?? 0, outstanding: pkg.outstanding ?? 0 },
    changeInExposure: { commitment: pkg.newMoney ?? 0, outstanding: 0, note: `New money ${usd(pkg.newMoney ?? 0)}.` }
  },
  creditApprovalSummary: { hrbDesignation: "Not HRB", hvcreApplicable: false, ureExceptions: 0, pastDueFinancialStatements: "0 of 4", csgFeedbackComplete: true, csgFlags: false },
  collateral: (nc.collateral ?? []).map((c) => ({ loan: c.loan, description: c.description, value: c.value, coveragePct: c.coveragePct, lienPosition: c.lienPosition })),
  guarantor: guar ? { type: (guar.entityType || "individual").toLowerCase(), name: guar.name, guarantyType: guar.guarantyType } : null,
  narratives,
  spread: { periods: [], incomeStatement: {}, balanceSheet: {}, cashFlow: {} }
};
function usd(n) { return n == null ? "—" : (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${n.toLocaleString()}`); }

// ---------------------------------------------------------------- Boom adapter (UUID periods + scale → FY labels + US$)
// Defaults to the bundled Boom snapshot (assets/boom-spread.json); --boom overrides with a live fetch.
const boomPath = arg("--boom") ?? join(ASSETS, "boom-spread.json");
if (boomPath) {
  try {
    const raw = JSON.parse(readFileSync(boomPath, "utf8"));
    // Resolve the spread envelope from whatever the agent saved:
    //   boom_get_spread → { file: {...} } ; boom_show_spread (widget) → { spread/data: {...} } or the
    //   raw object; some tool results nest under content[0].text. Be permissive about the wrapper.
    let env = raw.file ?? raw.spread ?? raw.data ?? raw.result ?? raw;
    if (env && !env.financialStatements && Array.isArray(env.content) && env.content[0]?.text) {
      try { env = JSON.parse(env.content[0].text); env = env.file ?? env.spread ?? env.data ?? env; } catch {}
    }
    const file = env;
    // Normalize each statement to the get_spread shape the rest of this adapter expects:
    //   periods: [{ id, endDate }] ; lineItems: [{ accountCode, name, periodValues: { [id]: n } }].
    // The widget shape instead carries periods as date strings and lineItems with parallel `values`
    // arrays — normalize that to the same structure so EITHER saved shape renders on the first try.
    const normStmt = (st) => {
      if (!st) return st;
      const pr = st.periods ?? [];
      const objPeriods = pr.length && typeof pr[0] === "object" && pr[0] !== null;
      const hasPV = (st.lineItems ?? []).some((li) => li && li.periodValues && typeof li.periodValues === "object" && !Array.isArray(li.periodValues));
      if (objPeriods && hasPV) return st;                 // already get_spread shape
      const periods = pr.map((p, i) => {
        const endDate = typeof p === "string" ? p : (p?.endDate ?? p?.date ?? p?.label ?? String(p));
        const id = (typeof p === "object" && p && p.id != null) ? p.id : `p${i}`;
        return { id, endDate };
      });
      const lineItems = (st.lineItems ?? []).map((li) => {
        if (li?.periodValues && !Array.isArray(li.periodValues)) return li;
        const vals = li?.values ?? li?.periodValues ?? [];
        const periodValues = {};
        if (Array.isArray(vals)) vals.forEach((v, i) => { if (periods[i]) periodValues[periods[i].id] = v; });
        return { ...li, periodValues };
      });
      return { ...st, periods, lineItems };
    };
    const sts = (file.financialStatements ?? []).map(normStmt);
    const pick = (type) => sts.filter((s) => s.statementType === type).sort((x, y) => (y.lineItems?.length ?? 0) - (x.lineItems?.length ?? 0))[0];
    const isStmt = pick("income_statement"), bs = pick("balance_sheet"), cf = pick("cash_flow_statement");
    // label EACH statement by its OWN period dates (UUIDs differ per statement), oldest→newest → "FY<year>"
    // tolerate already-labeled periods ("FY2023") and ISO dates ("2023-12-31") alike.
    const fy = (endDate) => { const m = String(endDate).match(/(\d{4})/); return m ? "FY" + m[1] : String(endDate); };
    const stPeriods = (st) => [...(st?.periods ?? [])].sort((p, q) => new Date(p.endDate) - new Date(q.endDate));
    const periods = stPeriods(isStmt ?? bs ?? cf).map((p) => fy(p.endDate));   // global period labels (from the income statement)
    // per-statement scale: if the biggest abs value < 1e6, the statement is in thousands → ×1000
    const scaleOf = (st) => {
      const vals = (st?.lineItems ?? []).flatMap((li) => Object.values(li.periodValues ?? {})).map(Math.abs).filter((v) => v > 0);
      const max = vals.length ? Math.max(...vals) : 0;
      return max && max < 1e6 ? 1000 : 1;
    };
    // accountCode may be a single code or a list of candidates (Boom's codes vary, e.g. revenue is
    // "net_sales_revenue"); match the first lineItem whose code is in the list, else fall back to nameRe.
    const series = (st, accountCode, nameRe) => {
      if (!st) return {};
      const codes = Array.isArray(accountCode) ? accountCode : (accountCode ? [accountCode] : []);
      const li = (st.lineItems ?? []).find((x) => (codes.length && codes.includes(x.accountCode)) || (nameRe && nameRe.test(x.name || "")));
      if (!li) return {};
      const k = scaleOf(st), out = {};
      for (const p of stPeriods(st)) out[fy(p.endDate)] = li.periodValues?.[p.id] != null ? li.periodValues[p.id] * k : null;
      return out;
    };
    const isS = (ac, re) => series(isStmt, ac, re);
    const da = (() => { for (const st of [cf, isStmt, bs]) { const s = series(st, null, /deprecia|amortiz/i); if (Object.keys(s).length) return s; } return {}; })();
    const op = isS("operating_profit", /income from operations|operating (income|profit)/i);
    const ebitda = {}; for (const p of periods) { const o = op[p], d = da[p]; ebitda[p] = (o != null) ? o + (d ?? 0) : null; }
    // total debt = short-term/current portion + long-term bank debt (Boom keys both separately)
    const stDebt = series(bs, ["st_loans_payable_bank", "short_term_debt"], /line of credit|current portion/i);
    const ltDebt = series(bs, ["long_term_debt_bank", "long_term_debt"], /long.?term debt/i);
    const totalDebt = {}; for (const p of periods) { const x = stDebt[p], y = ltDebt[p]; if (x != null || y != null) totalDebt[p] = (x ?? 0) + (y ?? 0); }
    canon.spread = {
      periods,
      incomeStatement: {
        sales_revenue: isS(["net_sales_revenue", "sales_revenue", "total_revenue"], /net sales|sales revenue|^revenue$|total revenue/i),
        cost_of_sales: isS(["cost_of_sales"], /cost of (sales|goods)/i), gross_profit: isS("gross_profit", /gross profit/i),
        operating_profit: op, depreciation_amortization: da, adjusted_ebitda: ebitda,
        interest_expense: isS("interest_expense", /interest expense/i), net_income: isS("net_income", /^net income$/i)
      },
      balanceSheet: {
        cash_and_equivalents: series(bs, "cash_and_equivalents"), accounts_receivable: series(bs, "accounts_receivable_trade"),
        inventory: series(bs, "total_inventory"), total_assets: series(bs, "total_assets"),
        total_debt: totalDebt, total_equity: series(bs, "total_equity")
      },
      cashFlow: {
        operating_cash_flow: series(cf, null, /net cash.*operating/i),
        capital_expenditures: series(cf, null, /purchase[s]? of property|capital expenditure/i)
      }
    };
  } catch (e) { console.error("Boom adapt skipped:", e.message); }
}

// Build the Boom payload the renderer's li() reads — from the adapted (label-keyed) spread.
const boomStmt = (type, section) => ({
  statementType: type, endDate: "", periods: canon.spread.periods,
  lineItems: Object.entries(section || {}).map(([accountCode, values]) => ({
    accountCode, name: accountCode,
    hierarchy: /total|gross_profit|ebit|net_income|free_cash_flow/.test(accountCode) ? "subtotal" : "line_item",
    periodValues: values || {}
  }))
});
const boom = { files: { f: { _source: "BOOM-ADAPTED", financialStatements: [
  boomStmt("income_statement", canon.spread.incomeStatement),
  boomStmt("balance_sheet", canon.spread.balanceSheet),
  boomStmt("cash_flow_statement", canon.spread.cashFlow)
] } } };

// ---------------------------------------------------------------- Boom ratios (the canonical KPI source — same as the widgets)
// Defaults to the bundled ratios snapshot (assets/boom-ratios.json); --ratios overrides with a live fetch.
const ratiosPath = arg("--ratios") ?? join(ASSETS, "boom-ratios.json");
let boomRatios = null; try { boomRatios = JSON.parse(readFileSync(ratiosPath, "utf8")); } catch (e) { console.error("ratios skipped:", e.message); }
const rr = boomRatios?.raw ?? boomRatios ?? null;   // tolerate either {raw:{…}} or a bare raw object
if (rr && typeof rr === "object") {
  canon.ratios = {
    revenue: rr.revenue ?? null,
    revenueYoYPct: rr.revenueYoY != null ? rr.revenueYoY * 100 : null,
    ebitda: rr.ebitda ?? null,
    ebitdaMarginPct: rr.ebitdaMargin != null ? rr.ebitdaMargin * 100 : null,
    grossMarginPct: rr.grossMargin != null ? rr.grossMargin * 100 : null,
    totalLeverage: rr.leverage ?? null,
    totalDebt: rr.totalDebt ?? null,
    interestCoverage: rr.interestCoverage ?? null,
    asOf: boomRatios?.asOf ?? null
  };
}

// ---------------------------------------------------------------- AFS / peers (synth from the deal — clearly derived)
const periods = canon.spread.periods;
const latest = periods.at(-1);
const rev = canon.spread.incomeStatement.sales_revenue ?? {};
const ebd = canon.spread.incomeStatement.adjusted_ebitda ?? {};
const debt = canon.ratios?.totalDebt ?? (canon.spread.balanceSheet.total_debt ?? {})[latest] ?? null;
const ebL = ebd[latest];
// prefer Boom's own leverage (matches the widgets); else derive from the spread
const lev = canon.ratios?.totalLeverage ?? ((ebL != null && ebL > 0 && debt != null) ? Math.round((debt / ebL) * 100) / 100 : null);
const qtrs = [...periods, "Proposed"];
// Risk-rating migration (DEMO synth, clearly derived): the rating drifts 4 → 4 → 5 as margins soften,
// with rising PD — this is the visual evidence for the Pass/Watch call. Band stays "Pass" (rating ≤ 12
// is a regulatory Pass; "Watch" is the sub-label), so the trend table doesn't false-flag the cells red.
const ratingArc = [
  { rating: "4", band: "Pass", pdPct: 0.85 },
  { rating: "4", band: "Pass", pdPct: 1.10 },
  { rating: "5", band: "Pass", pdPct: 1.95 },
  { rating: "5", band: "Pass", pdPct: 2.20 }, // Proposed (pro forma this action)
];
const iris = {
  _source: "AFS-PLACEHOLDER",
  ratios: [{ period: latest, totalLeverage: lev }],
  riskRatingTrend: { events: qtrs.map((p, i) => ({ period: p, ...(ratingArc[i] ?? ratingArc.at(-1)), proposed: p === "Proposed" })) },
  covenantCompliance: (nc.covenants ?? []).map((c) => {
    const actual = c.actual ?? null;
    // Per-covenant history arc (DEMO synth, anchored to the REAL latest actual from nCino; history
    // derived consistent with the softening-margin story; final column = Proposed pro forma this action).
    const arcFor = (name) => {
      if (/debt service|fixed charge|coverage/i.test(name)) return [1.78, 1.61, actual ?? 1.42, 1.35];
      if (/worth|leverage/i.test(name))                     return [2.65, 2.41, actual ?? 2.18, 2.46];
      if (/liquidity/i.test(name))                          return [6_100_000, 7_400_000, actual ?? 8_200_000, 7_600_000];
      if (/cap\s?ex|capital expend/i.test(name))            return [900_000, 1_100_000, actual ?? 1_250_000, 6_250_000];
      return qtrs.map(() => actual);
    };
    let arc = arcFor(c.name ?? "");
    if (arc.length !== qtrs.length) arc = qtrs.map((_, i) => arc[Math.min(i, arc.length - 1)]);
    const gte = String(c.operator ?? ">=").includes(">");
    const flagOf = (v) => {
      if (v == null) return "n/a";
      const trig = c.threshold;
      if (gte) { if (v < trig) return "breach"; return v < trig * 1.1 ? "caution" : "compliant"; }
      if (v > trig) return "breach"; return v > trig * 0.9 ? "caution" : "compliant";
    };
    const arrowOf = (v, prev) => (v == null || prev == null || prev === 0) ? "" : (v - prev) / Math.abs(prev) >= 0.10 ? "▲" : (v - prev) / Math.abs(prev) <= -0.10 ? "▼" : "";
    const perPeriod = arc.map((v, i) => ({ value: c.unit === "$" ? v : v == null ? null : Math.round(v * 100) / 100, flag: flagOf(v), arrow: arrowOf(v, i ? arc[i - 1] : null) }));
    return { name: c.name, type: "Financial", unit: c.unit, operator: c.operator, trigger: c.threshold, frequency: c.frequency, quarters: qtrs, actuals: arc, perPeriod, currentFlag: c.status === "Compliant" ? "compliant" : "caution" };
  }),
  // Sensitivity — DSC vs the 1.25x covenant floor (DEMO synth). Base 1.42x has headroom; a moderate
  // revenue/margin stress pushes coverage through the floor (the deal's key sensitivity), while the
  // FY2026 management-recovery plan restores it. Renderer reads s.dsc / revenueDelta / gmDeltaBps.
  sensitivity: { scenarios: [
    { name: "Base — FY2025 actual",                         dsc: 1.42, revenueDelta: 0,     gmDeltaBps: 0,    covenantBreaches: [] },
    { name: "Mild stress — Revenue −5% / GM −100 bps",      dsc: 1.21, revenueDelta: -0.05, gmDeltaBps: -100, covenantBreaches: ["DSC"] },
    { name: "Severe stress — Revenue −10% / GM −150 bps",   dsc: 1.02, revenueDelta: -0.10, gmDeltaBps: -150, covenantBreaches: ["DSC"] },
    { name: "Management plan — FY2026 margin recovery",     dsc: 1.63, revenueDelta: 0.06,  gmDeltaBps: 120,  covenantBreaches: [] },
  ] }
};
const wc = loans.find(isRevolver) ?? {};
// Revolver utilization (DEMO synth from AFS-stub): a rising 12-month trend on the EXISTING $5.0M line —
// the operational evidence that the borrower has outgrown the limit and supports the $2.5M increase.
const rcfMonths = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const rcfUtil = [52, 58, 55, 63, 68, 66, 74, 79, 77, 84, 88, 86];
const rcfCommit = 5_000_000; // existing facility (the increase takes it to $7.5M)
const rcfBal = rcfUtil.map((p) => Math.round((p / 100) * rcfCommit));
const pctStat = (fn) => Math[fn](...rcfUtil);
const afs = {
  _source: "AFS-STUB",
  revolverUsage: {
    facility: wc.name ?? "RCF", commitment: rcfCommit, months: rcfMonths, fundedBalance: rcfBal, utilizationPct: rcfUtil,
    high: Math.max(...rcfBal), low: Math.min(...rcfBal), average: Math.round(rcfBal.reduce((s, v) => s + v, 0) / rcfBal.length),
    highPct: pctStat("max"), lowPct: pctStat("min"), averagePct: Math.round(rcfUtil.reduce((s, v) => s + v, 0) / rcfUtil.length),
    daysAtZero: 0, consecutiveDaysAtZero: 0,
  },
  paymentHistory: { buckets: { current: true, d30_60: 0, d60_90: 0, d90_plus: 0 }, events: [] }
};
// Industry outlook + peer comparison set — bundled CapIQ/IBIS placeholder (assets/peers_placeholder.json);
// --peers overrides with a live fetch. Loaded here (rather than hard-coded) so the peer_comparison
// component in Industry & Peer Analysis has a real set + medians to render (2026-08-21).
const peersPath = arg("--peers") ?? join(ASSETS, "peers_placeholder.json");
let peerData = null; try { peerData = JSON.parse(readFileSync(peersPath, "utf8")); } catch (e) { console.error("peers skipped:", e.message); }
const peers = {
  _source: "CAPIQ-IBIS-PLACEHOLDER",
  peers: peerData?.peers ? { naics: peerData.peers.naics, revenueBand: peerData.peers.revenueBand, set: peerData.peers.set, medians: peerData.peers.medians } : undefined,
  industryOutlook: peerData?.industryOutlook ?? {
    naics: a.naics,
    outlook: "Stable-to-improving demand across aerospace & defense precision machining, underpinned by elevated U.S. defense budgets and a multi-year commercial-aero build-rate recovery.",
    marketSize: "$41B U.S. machine-shop market",
    cagrPct: 4.2,
    cyclicality: "Moderate",
  }
};

// ---------------------------------------------------------------- render (+ optional review shell)
const manifest = JSON.parse(readFileSync(join(SKILL, "references", "module-manifest.json"), "utf8"));
const shell = readFileSync(join(SKILL, "assets", "memo-shell.html"), "utf8");
// chart view variants — agent directive, e.g. --chart spreading:margin  (comma-separated key:variant)
const chartVariants = {};
if (arg("--chart")) for (const kv of arg("--chart").split(",")) { const [k, v] = kv.split(":"); if (k && v) chartVariants[k.trim()] = v.trim(); }

const { html, plan, suppressed, rteSections } = renderMemo({ manifest, shell, canon, boom, afs, iris, peers, chartVariants });

let outHtml = html;
if (process.argv.includes("--review")) {
  // READ-ONLY CREDIT REVIEW copy — what the credit officer opens to READ the committed memo (the
  // validation half, SR 11-7). No per-section Approve/Edit controls (those are the preparer's); a
  // banner marks it read-only and frames it as a recall of the committed work product, not a redraft.
  let reviewer = { name: "Credit Officer", role: "", date: "Jun 1, 2026", iso: "2026-06-01" };
  try { if (arg("--reviewer")) reviewer = { ...reviewer, ...JSON.parse(arg("--reviewer")) }; } catch {}
  const bar =
    `<style>.rv-ro-bar{position:sticky;top:0;z-index:60;background:#2E0A4F;color:#fff;` +
    `font:600 12px "DM Sans","Inter",system-ui,sans-serif;padding:9px 18px;display:flex;gap:8px;` +
    `align-items:center;box-shadow:0 1px 6px rgba(0,0,0,.18)}.rv-ro-bar b{font-weight:800}` +
    `.rv-ro-bar .ro-tag{margin-left:auto;font-weight:700;opacity:.9}@media print{.rv-ro-bar{display:none}}</style>` +
    `<div class="rv-ro-bar">Credit Review · Reviewing as <b>${reviewer.name}</b>${reviewer.role ? ", " + reviewer.role : ""}` +
    `<span class="ro-tag">READ-ONLY · recall of the committed memo</span></div>`;
  outHtml = html.replace("<body>", `<body>${bar}`);
} else if (!process.argv.includes("--static")) {
  let reviewer = { name: "Reviewer", role: "", date: "Jun 1, 2026", iso: "2026-06-01" };
  try { if (arg("--reviewer")) reviewer = { ...reviewer, ...JSON.parse(arg("--reviewer")) }; } catch {}
  // Prior per-section sign-offs carried forward across re-renders (chart swap, narrative edit, …) so a
  // re-render never wipes the checklist. The agent owns this map (source of truth) and replays it on
  // every re-render via --attestation '<json>' (or --attestation-file <path>). Shape: { modId: {status,
  // approvedBy?, approvedRole?, approvedDate?, editNote?} } — the same shape the shell exports.
  let attestation = {};
  try { if (arg("--attestation")) attestation = JSON.parse(arg("--attestation")); } catch (e) { console.error("attestation arg skipped:", e.message); }
  try { if (arg("--attestation-file")) attestation = JSON.parse(readFileSync(arg("--attestation-file"), "utf8")); } catch (e) { console.error("attestation-file skipped:", e.message); }
  const css = readFileSync(join(SKILL, "assets", "review-shell.css"), "utf8");
  const js = readFileSync(join(SKILL, "assets", "review-shell.js"), "utf8");
  outHtml = html.replace("</body>", `<style>${css}</style>\n<script>window.RV_REVIEWER=${JSON.stringify(reviewer)};window.RV_ATTESTATION_IN=${JSON.stringify(attestation)};</script>\n<script>${js}</script>\n</body>`);
}
const outPath = arg("--out") ?? join(here, "memo.html");
writeFileSync(outPath, outHtml);

// nCino RTE-safe section payload — the sidecar the finalize-and-writeback skill feeds to
// ncino_sync_memo_sections (keyed by nCino section id; the Experience MCP maps id → cm_* field).
const rtePath = arg("--rte-out") ?? outPath.replace(/\.html?$/i, "") + ".rte-sections.json";
// Emit the sidecar keyed by ncino_sync_memo_sections' CANONICAL ids so the finalize skill can
// `cat` it and pass it straight through — no remap, no skipped sections on write-back.
const RTE_KEY_MAP = { executive_summary: "deal_summary", product_request_overview: "relationship_overview" };
const rteCanonical = Object.fromEntries(Object.entries(rteSections).map(([k, v]) => [RTE_KEY_MAP[k] ?? k, v]));
writeFileSync(rtePath, JSON.stringify(rteCanonical, null, 2));

// Compact nFORMS-safe HTML sidecar (<out>.nforms.html) — the SMALL, inline-styled document the finalize
// skill publishes via ncino_publish_credit_memo. Built from the RTE-safe narrative buckets (semantic
// tags + inline styles only). nFORMS strips <style>/SVG/grid anyway, so the full styled memo (~70KB)
// is both un-renderable there AND a multi-minute payload for the agent to emit. This is a fraction of
// the size → fast to pass to publish, and renders cleanly in nCino. Always written alongside the memo.
{
  const nfTitles = { executive_summary: "Executive Summary", product_request_overview: "Relationship & Product Request Overview", background: "Background", financial_analysis: "Financial Analysis", covenant_analysis: "Covenant Analysis", collateral_analysis: "Collateral Analysis", risk_assessment: "Risk Assessment" };
  const nfOrder = ["executive_summary", "product_request_overview", "background", "financial_analysis", "covenant_analysis", "collateral_analysis", "risk_assessment"];
  const nfBody = nfOrder.filter((k) => rteSections[k]).map((k) =>
    `<h2 style="color:#2E0A4F;font-size:15px;border-bottom:1px solid #D6D3D1;padding-bottom:3px;margin:18px 0 6px">${nfTitles[k]}</h2>\n${rteSections[k]}`
  ).join("\n");
  const band = `<div style="background:#2E0A4F;color:#fff;padding:7px 12px;font-weight:bold;font-size:10px;letter-spacing:.05em">INTERNAL — DRAFT, PENDING CREDIT COMMITTEE REVIEW</div>`;
  const nfHtml =
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#1A1A1A;font-size:12px;line-height:1.45;max-width:7.5in;margin:0 auto">` +
    band +
    `<h1 style="color:#2E0A4F;font-size:20px;margin:14px 0 2px">Commercial Credit Memorandum</h1>` +
    `<div style="font-size:14px;font-weight:bold">${canon.borrower.name}</div>` +
    `<div style="color:#6B6B6B;margin-bottom:6px">${canon.creditAction.productPackageName} · NAICS ${canon.borrower.naics} — ${canon.borrower.naicsDesc}</div>` +
    nfBody +
    `<div style="margin-top:18px">${band}</div></div>`;
  const nfPath = arg("--nforms-out") ?? outPath.replace(/\.html?$/i, "") + ".nforms.html";
  writeFileSync(nfPath, nfHtml);
  console.error(`Wrote ${nfPath} (${nfHtml.length} chars — compact nFORMS-safe memo for ncino_publish_credit_memo)`);
}

console.error(`RENDER PLAN (${plan.length} ON): ${plan.map((m) => m.id).join(", ")}`);
console.error(`SUPPRESSED (${suppressed.length})`);
console.error(`spread periods: ${periods.join(", ") || "(none — financial sections render —)"}`);
console.error(`nCino RTE sections (${Object.keys(rteSections).length}/7): ${Object.keys(rteSections).join(", ")}`);
console.error(`Wrote ${outPath}`);
console.error(`Wrote ${rtePath}`);
