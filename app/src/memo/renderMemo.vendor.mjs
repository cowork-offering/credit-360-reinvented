/* =========================================================================
   DERIVED FILE — DO NOT EDIT. Regenerate with:
     node scripts/memo-vendor-check.mjs --write

   This is src/memo/vendor/render/render-memo.mjs (the credit-memo plugin's
   renderer, vendored verbatim — see src/memo/vendor/VENDOR.md) with exactly
   three line ranges removed so vite can bundle it for the browser:

     lines 1-1 — the `#!/usr/bin/env node` shebang. Legal only as the first bytes of a file, and this copy is a bundled module rather than an executable.
     lines 17-19 — node:fs / node:path / node:url imports at module top. Vite cannot resolve them for a browser bundle. They are used ONLY by the CLI block below, never by renderMemo itself.
     lines 748-771 — the `node render-memo.mjs --dossier ...` CLI entry. It reads argv and the filesystem; the browser has neither. renderMemo (lines 21-747) is untouched.

   Nothing else differs. scripts/memo-vendor-check.mjs re-derives this file
   from the vendored original on every run and fails on any byte of drift.
   ========================================================================= */
// Shared, data-driven renderer for the modular Acme Bank credit memo.
//
// THE MODEL NEVER AUTHORS MEMO HTML. The memo-writer agent assembles the deal
// dossier as JSON, then runs this script — deterministic code resolves the render
// plan (conditionality engine), builds the inline-SVG charts, and emits the full
// Acme Bank-branded HTML. This is the single renderer; test/build-memo.mjs imports the
// same `renderMemo` so the verification harness and the live agent can never drift.
//
// As a library:   import { renderMemo } from ".../render-memo.mjs"
//                  const { html, plan, suppressed, flags } = renderMemo({ manifest, shell, canon, boom, afs, iris, peers, flagOverrides })
//
// As a CLI:        node render-memo.mjs --dossier <dossier.json> [--out <out.html>]
//                  dossier.json = { canon, boom, afs, iris, peers, flagOverrides? }
//                  (manifest + shell are loaded from this skill's own folder)


export function renderMemo({ manifest, shell, canon, boom, afs, iris, peers, flagOverrides, attestation, chartVariants }) {
  const cv = chartVariants || {};
  // ---------------------------------------------------- flags
  const flags = structuredClone(canon.creditAction.flags);
  flags.credit_event = canon.creditAction.creditEvent;
  flags.tier = canon.creditAction.tier;
  if (flagOverrides && typeof flagOverrides === "object") {
    for (const [k, v] of Object.entries(flagOverrides)) flags[k] = v;
    flags.tier = (flags.is_syndicated || flags.is_peg || flags.is_lft || flags.is_public || flags.exposure_total > 250000000) ? "enhanced" : flags.tier;
  }

  // ---------------------------------------------------- predicate evaluator
  function evalPred(pred, f) {
    if (pred === "always" || pred == null) return true;
    if (Array.isArray(pred)) return pred.every((p) => evalPred(p, f));
    if (typeof pred === "object") {
      if (pred.any) return pred.any.some((p) => evalPred(p, f));
      if (pred.all) return pred.all.every((p) => evalPred(p, f));
      return true;
    }
    const s = String(pred).trim();
    let m;
    if ((m = s.match(/^(\w+)\s*==\s*(.+)$/))) return String(f[m[1]]) === m[2].trim();
    if ((m = s.match(/^(\w+)\s*!=\s*(.+)$/))) return String(f[m[1]]) !== m[2].trim();
    if ((m = s.match(/^(\w+)\s+includes\s+'(.+)'$/))) return Array.isArray(f[m[1]]) && f[m[1]].includes(m[2]);
    if ((m = s.match(/^!(\w+)$/))) return !f[m[1]];
    if ((m = s.match(/^(\w+)$/))) return !!f[m[1]];
    return false;
  }

  // ---------------------------------------------------- resolve render plan
  const plan = [];
  const suppressed = [];
  for (const mod of [...manifest.modules].sort((a, b) => a.order - b.order)) {
    const on = evalPred(mod.renderWhen, flags);
    const comps = (mod.components ?? []).map((c) => ({ ...c, on: on && evalPred(c.renderWhen, flags) }));
    const anyComp = comps.length ? comps.some((c) => c.on) : on;
    if (on && (comps.length === 0 || anyComp)) {
      plan.push({ ...mod, components: comps.filter((c) => c.on) });
      comps.filter((c) => !c.on).forEach((c) => suppressed.push(`${mod.id}/${c.id}`));
    } else {
      suppressed.push(mod.id);
    }
  }

  // ---------------------------------------------------- helpers
  const fmtUSD = (n) => n == null ? "—" : (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${n.toLocaleString()}`);
  const fmtX = (n) => n == null ? "—" : `${n.toFixed(2)}x`;
  const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
  const firstFile = () => Object.values(boom.files)[0];
  const li = (type, code) => firstFile().financialStatements.find((s) => s.statementType === type)?.lineItems.find((l) => l.accountCode === code)?.periodValues ?? {};
  const src = (text) => `<div class="source-line">${text}</div>`;

  // ---------------------------------------------------- provenance chips (data-lineage)
  // Every section traces to its source(s): LIVE → vendor chip hyperlinked to the record;
  // STUB → same chip, subtly dashed + "stub" tag (honest about intent). Logo slot = the
  // colored dot today; swap for a vendor mark when assets land.
  const VENDORS = {
    ncino: { label: "nCino", color: "#1798C1", i: "n" },
    boom: { label: "Boom", color: "#5B3FA0", i: "B" },
    afs: { label: "AFS", color: "#5B6470", i: "AF" },
    iris: { label: "AFS", color: "#0B6BCB", i: "IR" },
    snowflake: { label: "Snowflake", color: "#29B5E8", i: "SF" },
    capiq: { label: "S&P Capital IQ", color: "#C8102E", i: "IQ" },
    ibis: { label: "IBISWorld", color: "#00833E", i: "IB" },
    moodys: { label: "Moody's", color: "#0B5AA2", i: "M" },
    lexisnexis: { label: "LexisNexis", color: "#9E1B32", i: "LN" },
  };
  // Build a proper Salesforce Lightning deep-link: /lightning/r/<Object>/<id>/view. A bare {instanceUrl}/{id}
  // only reliably redirects for STANDARD objects (Account) — custom objects (LLC_BI__Loan__c, etc.) dead-end
  // in Lightning, which is why the facility links weren't working. Mirrors the Experience MCP's lightningUrl().
  const instUrl = canon.borrower?.instanceUrl || null;
  const lr = (obj, id) => (instUrl && id) ? `${instUrl}/lightning/r/${obj}/${id}/view` : null;
  const sfBase = lr("Account", canon.borrower?.salesforceAccountId);
  // inline record links: wrap a record name in a deep-link to its nCino/Salesforce record (row-level traceability)
  const recLink = (id, text, obj = "LLC_BI__Loan__c") => {
    const u = lr(obj, id);
    return u ? `<a class="rec-link" href="${u}" target="_blank" rel="noopener">${text}</a>` : text;
  };
  function prov(items) {
    const chips = items.map(({ v, status = "stub", href }) => {
      const m = VENDORS[v] || { label: v, color: "#5B6470", i: String(v).slice(0, 2) };
      const dot = `<span class="prov-mark" style="background:${m.color}">${esc(m.i || "")}</span>`;
      const live = status === "live";
      if (live && href) {
        return `<a class="prov-chip live" style="color:${m.color}" href="${href}" target="_blank" rel="noopener">${dot}<span>${esc(m.label)}</span><span class="prov-ext">↗</span></a>`;
      }
      // Uniform chips — vendor-colored, no integration-status tag (provenance, not plumbing).
      return `<span class="prov-chip live" style="color:${m.color}">${dot}<span>${esc(m.label)}</span></span>`;
    }).join("");
    return `<div class="provenance"><span class="prov-label">Sources</span>${chips}</div>`;
  }
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // ---------------------------------------------------- per-section attestation (human-in-the-loop)
  // Attestation is keyed by module id. Each entry: { status, approvedBy, approvedRole, approvedDate, editNote }.
  // status: "ai-drafted" (default/pending) | "approved" (reviewed as-is) | "edited" (edited & approved).
  // Identity (approvedBy/Role) comes from the authenticated session (getUserInfo) — never free-typed.
  // Section attestation = preparer/reviewer verification; it is NOT credit-committee approval.
  const att = attestation ?? canon.attestation ?? {};
  function attestationBadge(modId) {
    const a = att[modId] ?? {};
    const status = a.status ?? "ai-drafted";
    if (status === "approved" || status === "edited") {
      const verb = status === "edited" ? "Edited &amp; reviewed" : "Reviewed";
      const who = [a.approvedBy, a.approvedRole].filter(Boolean).map(esc).join(", ");
      const when = a.approvedDate ? fmtDate(a.approvedDate) : "";
      const note = a.editNote ? `<span class="att-meta">— ${esc(a.editNote)}</span>` : "";
      return `<div class="attestation att-${status === "edited" ? "edited" : "approved"}"><span class="att-dot"></span><span><strong>AI-drafted</strong> · ${verb}${who ? " by " + who : ""}${when ? " · " + when : ""}</span>${note}</div>`;
    }
    return `<div class="attestation att-pending"><span class="att-dot"></span><span><strong>AI-drafted</strong> · Pending reviewer verification</span></div>`;
  }

  // ---------------------------------------------------- chart builders (inline SVG)
  function svgRevolver(r) {
    const W = 520, H = 170, padL = 36, padR = 70, padT = 14, padB = 26;
    const pts = r.utilizationPct;
    const max = Math.max(...pts) * 1.1, min = Math.min(...pts) * 0.85;
    const x = (i) => padL + (i / (pts.length - 1)) * (W - padL - padR);
    const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    const poly = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const ref = (v, label, color) => `<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" stroke="${color}" stroke-width="1" stroke-dasharray="3 3"/><text x="${W - padR + 4}" y="${y(v) + 3}" font-size="7.5" fill="${color}">${label} ${v}%</text>`;
    const ticks = r.months.map((m, i) => i % 2 === 0 ? `<text x="${x(i)}" y="${H - 8}" font-size="6.5" fill="#6B6B6B" text-anchor="middle">${m}</text>` : "").join("");
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;border:1px solid #D6D3D1;border-radius:6px;background:#fff">
      ${ref(r.highPct, "High", "#A8211B")}${ref(r.averagePct, "Avg", "#2E0A4F")}${ref(r.lowPct, "Low", "#1F7A3A")}
      <polyline points="${poly}" fill="none" stroke="#A100FF" stroke-width="2"/>
      ${pts.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="2.5" fill="#A100FF" data-tip="${r.months[i]}: ${v}%"/>`).join("")}
      ${ticks}
      <text x="${W - padR}" y="${padT}" font-size="7.5" fill="#2E0A4F" text-anchor="end">Days at zero: ${r.daysAtZero}</text>
    </svg>`;
  }
  function svgBars(periods, series) {
    const W = 520, H = 170, padL = 40, padR = 12, padT = 16, padB = 26;
    const all = series.flatMap((s) => s.data);
    const max = Math.max(...all) * 1.12;
    const groups = periods.length, gw = (W - padL - padR) / groups, bw = gw / (series.length + 1);
    const y = (v) => padT + (1 - v / max) * (H - padT - padB);
    let bars = "";
    periods.forEach((p, gi) => {
      series.forEach((s, si) => {
        const bx = padL + gi * gw + si * bw + bw * 0.5;
        const by = y(s.data[gi]), bh = H - padB - by;
        bars += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${(bw * 0.8).toFixed(1)}" height="${bh.toFixed(1)}" fill="${s.color}" data-tip="${s.name} · ${p}: ${s.data[gi].toFixed(1)}"/>`;
      });
      bars += `<text x="${(padL + gi * gw + gw / 2).toFixed(1)}" y="${H - 8}" font-size="6.5" fill="#6B6B6B" text-anchor="middle">${p}</text>`;
    });
    const legend = series.map((s, i) => `<rect x="${padL + i * 120}" y="3" width="9" height="9" fill="${s.color}"/><text x="${padL + i * 120 + 13}" y="11" font-size="7.5" fill="#1A1A1A">${s.name}</text>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;border:1px solid #D6D3D1;border-radius:6px;background:#fff">${legend}${bars}</svg>`;
  }
  // percent-axis multi-line chart (the spreading "margin %" variant) with hover tooltips
  function svgLinePct(periods, series) {
    const W = 520, H = 180, padL = 42, padR = 12, padT = 18, padB = 26;
    const all = series.flatMap((s) => s.data).filter((v) => v != null);
    if (!all.length) return `<p class="gap">[no margin data to chart]</p>`;
    const rawMax = Math.max(...all, 0), rawMin = Math.min(...all, 0);
    const max = rawMax + Math.max(2, (rawMax - rawMin) * 0.15), min = rawMin - Math.max(2, (rawMax - rawMin) * 0.15);
    const span = (max - min) || 1;
    const x = (i) => padL + (i / Math.max(1, periods.length - 1)) * (W - padL - padR);
    const y = (v) => padT + (1 - (v - min) / span) * (H - padT - padB);
    const zeroY = y(0);
    let body = `<line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W - padR}" y2="${zeroY.toFixed(1)}" stroke="#D6D3D1" stroke-width="1"/><text x="${padL - 4}" y="${zeroY + 3}" font-size="6.5" fill="#9b9b9b" text-anchor="end">0%</text>`;
    for (const s of series) {
      const poly = s.data.map((v, i) => v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean).join(" ");
      body += `<polyline points="${poly}" fill="none" stroke="${s.color}" stroke-width="2.5"/>`;
      s.data.forEach((v, i) => { if (v == null) return; body += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="${s.color}" data-tip="${s.name} · ${periods[i]}: ${v.toFixed(1)}%"/>`; });
    }
    const ticks = periods.map((p, i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" font-size="6.5" fill="#6B6B6B" text-anchor="middle">${p}</text>`).join("");
    const legend = series.map((s, i) => `<rect x="${padL + i * 140}" y="3" width="9" height="9" fill="${s.color}"/><text x="${padL + i * 140 + 13}" y="11" font-size="7.5" fill="#1A1A1A">${s.name}</text>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;border:1px solid #D6D3D1;border-radius:6px;background:#fff">${legend}${body}${ticks}</svg>`;
  }

  // ---------------------------------------------------- robustness helpers
  // Never crash on a missing covenant / period / ratio, and never hard-code borrower prose.
  // Narrative blocks read canon.narratives[key] if supplied, else a clean review placeholder —
  // so the memo NEVER leaks another borrower's story.
  // Narrative prose is wrapped in a marker so the review shell makes ONLY narrative editable on "Edit"
  // — data (tables, KPI tiles, charts, figures) traces to a system of record and is changed by the agent
  // re-rendering from source, never hand-edited in the artifact (SR 11-7 lineage: System/Experience tiers
  // own the figures; the Agent/narrative tier is the human-attested layer).
  const narr = (key, fallback) => `<div class="rte-narrative" data-editable>${(canon.narratives && canon.narratives[key]) || fallback}</div>`;
  const placeholder = (label) => `<p class="gap">[${label} — pending; complete in the per-section review.]</p>`;
  const periodsArr = canon.spread?.periods ?? [];
  const latestPeriod = periodsArr[periodsArr.length - 1];
  const ratioAt = (p) => (iris.ratios ?? []).find((r) => r.period === p) ?? (iris.ratios ?? []).at(-1) ?? {};
  const covByRole = (re) => (iris.covenantCompliance ?? []).find((c) => re.test(c.name || ""));
  const covLatestVal = (c) => {
    if (!c) return null;
    if (Array.isArray(c.perPeriod)) { const v = [...c.perPeriod].reverse().find((p) => p && p.value != null); if (v) return v.value; }
    if (Array.isArray(c.actuals)) { const v = [...c.actuals].reverse().find((x) => x != null); if (v != null) return v; }
    return c.actual ?? null;
  };
  const fmtTrig = (c) => c == null ? "" : (c.unit === "$" ? `${c.operator} ${fmtUSD(c.trigger)}` : `${c.operator} ${fmtX(c.trigger)}`);
  // The most recent REAL test result — as opposed to covLatestVal(), which (by design, for the
  // Executive-Summary KPI strip) picks the last non-null perPeriod entry and so picks up the
  // synthetic "Proposed" pro-forma projection when one is present. A column or table explicitly
  // labeled "Actual" (Covenant Compliance, the Key Metrics table) must show the latest ACTUAL test,
  // not a forward-looking pro forma estimate — so walk back past a trailing "Proposed" quarter.
  const covRealActual = (c) => {
    if (!c) return null;
    const idx = (c.quarters || []).indexOf("Proposed");
    if (idx > 0 && Array.isArray(c.perPeriod)) {
      for (let i = idx - 1; i >= 0; i--) { if (c.perPeriod[i] && c.perPeriod[i].value != null) return c.perPeriod[i].value; }
    }
    return covLatestVal(c);
  };

  // ---------------------------------------------------- module renderers
  const R = {};

  R.executive_summary = (comps) => {
    const has = (id) => comps.some((c) => c.id === id);
    const exposureRow = (l, which) => {
      const e = l[which];
      const changed = which === "proposed" && (l.isNewMoney || l.isIncrease);
      return `<tr${changed ? ' class="changed"' : ""}><td>${recLink(l.ncinoId, l.name.replace(" (New Money)", ""))}</td><td>${canon.borrower.name}</td><td>${l.purpose.slice(0, 40)}…</td><td class="numeric">${fmtUSD(e.commitment)}</td><td class="numeric">${fmtUSD(e.outstanding)}</td><td>${e.maturity ? fmtDate(e.maturity) : "—"}</td><td>${l.riskRating}</td></tr>`;
    };
    const existing = canon.loans.filter((l) => !l.isNewMoney).map((l) => exposureRow(l, "existing")).join("");
    const proposed = canon.loans.map((l) => exposureRow(l, "proposed")).join("");
    const ca = canon.creditApprovalSummary;
    // Headline KPIs prefer the Boom RATIOS payload (canon.ratios) — the same source the widgets read —
    // so the memo's revenue/YoY/EBITDA/margin/leverage MATCH the deal-summary + Boom widgets exactly.
    // Fall back to spread-derived values when no ratios payload is present.
    const RT = canon.ratios ?? {};
    const isr = li("income_statement", "sales_revenue");
    const ebitdaLTM = RT.ebitda ?? li("income_statement", "adjusted_ebitda")[latestPeriod];
    const revLTM = RT.revenue ?? isr[latestPeriod];
    const lev = RT.totalLeverage ?? ratioAt(latestPeriod).totalLeverage ?? null;
    const levCov = covByRole(/leverage/i);
    const covCov = covByRole(/fixed charge|debt service|coverage/i);
    const fccr = covLatestVal(covCov);
    const covAbbr = covCov ? (/fixed charge/i.test(covCov.name) ? "FCCR" : /debt service/i.test(covCov.name) ? "DSCR" : "Coverage") : "Coverage";
    const revYoY = RT.revenueYoYPct != null ? `${RT.revenueYoYPct.toFixed(1)}% YoY`
      : (periodsArr.length >= 2 && isr[periodsArr.at(-1)] != null && isr[periodsArr.at(-2)]) ? `${(((isr[periodsArr.at(-1)] - isr[periodsArr.at(-2)]) / Math.abs(isr[periodsArr.at(-2)])) * 100).toFixed(1)}% YoY` : "";
    const ebMargin = RT.ebitdaMarginPct != null ? `${RT.ebitdaMarginPct.toFixed(1)}% margin`
      : (ebitdaLTM != null && revLTM) ? `${((ebitdaLTM / revLTM) * 100).toFixed(1)}% margin` : "";
    return `
    <div class="kpi-strip">
      <div class="kpi-card"><div class="kpi-label">Revenue</div><div class="kpi-value">${fmtUSD(revLTM)}</div><div class="kpi-sub">${revYoY}</div></div>
      <div class="kpi-card"><div class="kpi-label">Adj. EBITDA</div><div class="kpi-value">${fmtUSD(ebitdaLTM)}</div><div class="kpi-sub">${ebMargin}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Leverage</div><div class="kpi-value">${fmtX(lev)}</div><div class="kpi-sub">${fmtTrig(levCov) ? fmtTrig(levCov) + " covenant" : ""}</div></div>
      <div class="kpi-card"><div class="kpi-label">${covAbbr}</div><div class="kpi-value">${fmtX(fccr)}</div><div class="kpi-sub">${fmtTrig(covCov) ? fmtTrig(covCov) + " covenant" : ""}</div></div>
    </div>
    ${has("existing_exposure_table") ? `<div class="subhead">Existing Exposure</div><table><thead><tr><th>Facility</th><th>Borrower</th><th>Purpose</th><th class="numeric">Bank Exposure</th><th class="numeric">Outstanding</th><th>Maturity</th><th>PRISM</th></tr></thead><tbody>${existing}<tr><td colspan="3"><strong>Total</strong></td><td class="numeric"><strong>${fmtUSD(canon.exposureSummary.existing.commitment)}</strong></td><td class="numeric"><strong>${fmtUSD(canon.exposureSummary.existing.outstanding)}</strong></td><td colspan="2"></td></tr></tbody></table>` : ""}
    ${has("proposed_exposure_table") ? `<div class="subhead">Proposed Exposure</div><table><thead><tr><th>Facility</th><th>Borrower</th><th>Purpose</th><th class="numeric">Bank Exposure</th><th class="numeric">Outstanding</th><th>Maturity</th><th>PRISM</th></tr></thead><tbody>${proposed}<tr><td colspan="3"><strong>Total</strong></td><td class="numeric"><strong>${fmtUSD(canon.exposureSummary.proposed.commitment)}</strong></td><td class="numeric"><strong>${fmtUSD(canon.exposureSummary.proposed.outstanding)}</strong></td><td colspan="2"></td></tr></tbody></table>` : ""}
    ${has("change_in_exposure") ? `<div class="callout"><strong>Change in Exposure:</strong> Bank commitment +${fmtUSD(canon.exposureSummary.changeInExposure.commitment)} — ${canon.exposureSummary.changeInExposure.note}</div>` : ""}
    ${has("global_exposure") ? `<div class="callout"><strong>Global Exposure (Enhanced):</strong> [rendered because tier=enhanced — would carry CLG global exposure / outstanding columns]</div>` : ""}
    ${has("sbe_inclusion") ? `<div class="callout"><strong>SBE Inclusion (Enhanced):</strong> [Single-Borrower-Exposure consolidation — rendered because tier=enhanced]</div>` : ""}
    <div class="two-col">
      ${has("credit_approval_summary") ? `<div><div class="subhead">Credit Approval Summary</div><table><tbody><tr><td>HRB Designation</td><td>${ca.hrbDesignation}</td></tr><tr><td>HVCRE Applicable?</td><td>${ca.hvcreApplicable ? "Yes" : "No"}</td></tr><tr><td>Underwriting Requirement Exceptions</td><td>${ca.ureExceptions}</td></tr><tr><td>Past-Due Financial Statements</td><td>${ca.pastDueFinancialStatements}</td></tr></tbody></table></div>` : ""}
      ${has("compliance_due_diligence") ? `<div><div class="subhead">Compliance &amp; Due Diligence</div><table><tbody><tr><td>CSG Feedback Complete?</td><td>${ca.csgFeedbackComplete ? '<span class="badge badge-pass">Yes</span>' : "No"}</td></tr><tr><td>CSG Flags?</td><td>${ca.csgFlags ? '<span class="badge badge-breach">Yes</span>' : '<span class="badge badge-pass">None</span>'}</td></tr></tbody></table></div>` : ""}
    </div>
    ${has("commentary") ? `<div class="subhead">Executive Summary Commentary</div>${narr("execSummary", placeholder("Executive summary commentary"))}` : ""}
    ${prov([{ v: "ncino", status: "live", href: sfBase }, { v: "boom", status: "live", href: "https://app.boom.build" }, { v: "iris", status: "stub" }])}`;
  };

  R.request_details = () => {
    const terms = canon.loans.map((l) => `<tr><td>${recLink(l.ncinoId, l.name.replace(" (New Money)", ""))}</td><td>${l.purpose}</td><td class="numeric">${fmtUSD(l.proposed.commitment)}</td><td>${l.proposed.maturity ? fmtDate(l.proposed.maturity) : "—"}</td><td>${l.isNewMoney ? '<span class="badge badge-watch">New money</span>' : "Renewal"}</td></tr>`).join("");
    const newMoney = canon.loans.filter((l) => l.isNewMoney).reduce((s, l) => s + (l.proposed.commitment || 0), 0);
    return `<div class="subhead">Purpose / Request Summary</div>
    ${narr("requestDetails", placeholder("Request summary &amp; sources/uses"))}
    <div class="subhead">Facility Terms</div>
    <table><thead><tr><th>Facility</th><th>Purpose</th><th class="numeric">Commitment</th><th>Maturity</th><th>Action</th></tr></thead><tbody>${terms}</tbody></table>
    <div class="subhead">Sources &amp; Uses</div>
    <table><thead><tr><th>Uses</th><th class="numeric">Amount</th><th>Sources</th><th class="numeric">Amount</th></tr></thead><tbody>
      <tr><td>Equipment — 3× Mazak INTEGREX CNC</td><td class="numeric">${fmtUSD(newMoney)}</td><td>bank equipment term loan</td><td class="numeric">${fmtUSD(newMoney)}</td></tr>
      <tr><td><strong>Total uses</strong></td><td class="numeric"><strong>${fmtUSD(newMoney)}</strong></td><td><strong>Total sources</strong></td><td class="numeric"><strong>${fmtUSD(newMoney)}</strong></td></tr>
    </tbody></table>
    ${prov([{ v: "ncino", status: "live", href: sfBase }])}`;
  };

  // Optional borrower subsection: renders the subhead only when its narrative key has content,
  // so the section can be tightened/restructured purely from the narratives file (empty key → dropped).
  const optSub = (label, key, callout) => {
    const v = (canon.narratives && canon.narratives[key]) || "";
    if (!String(v).trim()) return "";
    const inner = narr(key, "");
    return `<div class="subhead">${label}</div>${callout ? `<div class="callout">${inner}</div>` : inner}`;
  };
  R.borrower_description = () => `
    <div class="subhead">General Summary</div>
    ${narr("borrowerDescription", canon.borrower.profile ? `<p>${canon.borrower.profile}</p>` : placeholder("Borrower description"))}
    ${optSub("Business Segments", "borrowerSegments", false)}
    ${optSub("Geographic Presence", "borrowerGeography", false)}
    ${optSub("Key Customer Segments", "borrowerCustomers", false)}
    ${optSub("Business Model — Material Changes Since Last Credit Event", "borrowerChanges", true)}
    ${prov([{ v: "ncino", status: "live", href: sfBase }])}`;

  R.industry_analysis = () => {
    const set = peers.peers?.set ?? [];
    const medians = peers.peers?.medians ?? {};
    const peerRows = set.map((p) => `<tr><td>${esc(p.name)}${p.ticker ? ` <span style="color:var(--muted)">(${esc(p.ticker)})</span>` : ""}</td><td class="numeric">${fmtUSD(p.revenueLTM)}</td><td class="numeric">${p.ebitdaMarginPct != null ? p.ebitdaMarginPct.toFixed(1) + "%" : "—"}</td><td class="numeric">${p.leverage != null ? fmtX(p.leverage) : "—"}</td><td class="numeric">${p.dsc != null ? fmtX(p.dsc) : "—"}</td></tr>`).join("");
    return `
    <div class="subhead">Market Outlook</div>
    <p>${peers.industryOutlook?.outlook ?? ""} ${peers.industryOutlook?.marketSize ? `Market size ${peers.industryOutlook.marketSize};` : ""} ${peers.industryOutlook?.cagrPct != null ? `~${peers.industryOutlook.cagrPct}% CAGR;` : ""} ${peers.industryOutlook?.cyclicality ? `cyclicality: ${peers.industryOutlook.cyclicality}` : ""}</p>
    ${narr("industryChanges", "")}
    ${set.length ? `<div class="subhead">Peer Comparison</div><table><thead><tr><th>Peer</th><th class="numeric">Revenue (LTM)</th><th class="numeric">EBITDA Margin</th><th class="numeric">Leverage</th><th class="numeric">DSC</th></tr></thead><tbody>${peerRows}<tr><td><strong>Peer median</strong></td><td></td><td class="numeric"><strong>${medians.ebitdaMarginPct != null ? medians.ebitdaMarginPct.toFixed(1) + "%" : "—"}</strong></td><td class="numeric"><strong>${medians.leverage != null ? fmtX(medians.leverage) : "—"}</strong></td><td class="numeric"><strong>${medians.dsc != null ? fmtX(medians.dsc) : "—"}</strong></td></tr></tbody></table><div class="legend">Peer set: same NAICS (${peers.peers?.naics ?? "—"}), revenue band ${peers.peers?.revenueBand ?? "—"}.</div>` : placeholder("Peer comparison")}
    ${prov([{ v: "capiq", status: "stub" }, { v: "ibis", status: "stub" }])}`;
  };

  R.management_ownership = () => `
    <div class="subhead">Overview</div>
    ${narr("managementOwnership", placeholder("Management &amp; ownership"))}
    ${prov([{ v: "ncino", status: "live", href: sfBase }])}`;

  // ---- Covenant and Conditions (2026-08-21 restructure): covenant compliance table + terms +
  // Conditions & Monitoring (moved here from the Recommendation section — conditions of approval
  // belong beside the covenant package they're conditioning, not the recommendation narrative).
  R.covenant_conditions = (comps) => {
    const has = (id) => comps.some((c) => c.id === id);
    const covs = iris.covenantCompliance ?? [];
    const cushionPct = (c, actual) => {
      if (actual == null || !c.trigger) return null;
      const gte = String(c.operator ?? ">=").includes(">");
      return gte ? ((actual - c.trigger) / c.trigger) * 100 : ((c.trigger - actual) / c.trigger) * 100;
    };
    const rows = covs.map((c) => {
      const actual = covRealActual(c);
      const cp = cushionPct(c, actual);
      const flag = actual == null ? "n/a" : cp < 0 ? "breach" : cp < 10 ? "caution" : "compliant";
      const badge = flag === "breach" ? '<span class="badge badge-breach">Breach</span>' : flag === "caution" ? '<span class="badge badge-watch">Watch</span>' : flag === "n/a" ? '<span class="badge">—</span>' : '<span class="badge badge-pass">Compliant</span>';
      const fmtVal = (v) => v == null ? "—" : (c.unit === "$" ? fmtUSD(v) : fmtX(v));
      return `<tr><td>${esc(c.name)}</td><td>${c.operator} ${fmtVal(c.trigger)}</td><td class="numeric">${fmtVal(actual)}</td><td class="numeric">${cp != null ? cp.toFixed(0) + "%" : "—"}</td><td>${badge}</td></tr>`;
    }).join("");
    return `
    ${has("covenant_compliance_table") ? `<div class="subhead">Covenant Compliance</div>${covs.length ? `<table><thead><tr><th>Covenant</th><th>Trigger</th><th class="numeric">Actual</th><th class="numeric">Cushion</th><th>Flag</th></tr></thead><tbody>${rows}</tbody></table>` : placeholder("Covenant compliance table")}` : ""}
    ${narr("covenantConditions", placeholder("Covenant terms &amp; headroom commentary"))}
    ${has("conditions_and_monitoring") ? `<div class="subhead">Conditions &amp; Monitoring</div>${narr("conditionsMonitoring", placeholder("Conditions &amp; monitoring"))}` : ""}
    ${prov([{ v: "ncino", status: "live", href: sfBase }, { v: "iris", status: "stub" }])}`;
  };

  // ---- Risk Rating (internal) (new 2026-08-21): current/proposed grade, the rating-factor grid,
  // the rating trend (moved here from the old Trend Reporting module), and the rationale narrative.
  R.risk_rating_internal = () => {
    const rating = canon.borrower.currentRiskRating ?? "—";
    const trend = iris.riskRatingTrend?.events ?? [];
    const trendRows = trend.map((e) => `<tr><td>${esc(e.period)}</td><td>${esc(e.rating)}${e.band ? ` — ${esc(e.band)}` : ""}${e.proposed ? " (Proposed)" : ""}</td><td class="numeric">${e.pdPct != null ? e.pdPct.toFixed(2) + "%" : "—"}</td></tr>`).join("");
    const factors = canon.riskRatingFactors ?? [
      { factor: "Financial strength", grade: "Watch" },
      { factor: "Collateral coverage", grade: "Pass" },
      { factor: "Guarantor support", grade: "Pass" },
      { factor: "Management &amp; ownership", grade: "Watch" },
      { factor: "Industry / market position", grade: "Pass" },
    ];
    const gradeBadge = (g) => g === "Pass" ? '<span class="badge badge-pass">Pass</span>' : g === "Breach" ? '<span class="badge badge-breach">Breach</span>' : '<span class="badge badge-watch">Watch</span>';
    const factorRows = factors.map((f) => `<tr><td>${f.factor}</td><td>${gradeBadge(f.grade)}</td></tr>`).join("");
    return `
    <div class="kpi-strip">
      <div class="kpi-card"><div class="kpi-label">Current Rating</div><div class="kpi-value">${esc(rating)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Proposed Rating</div><div class="kpi-value">${esc(rating)}</div><div class="kpi-sub">No change</div></div>
      <div class="kpi-card"><div class="kpi-label">Direction</div><div class="kpi-value">Stable</div></div>
    </div>
    ${trend.length ? `<div class="subhead">Risk Rating Trend</div><table><thead><tr><th>Period</th><th>Rating</th><th class="numeric">PD</th></tr></thead><tbody>${trendRows}</tbody></table>` : ""}
    <div class="subhead">Rating Factors</div>
    <table><thead><tr><th>Factor</th><th>Assessment</th></tr></thead><tbody>${factorRows}</tbody></table>
    <div class="subhead">Rating Rationale</div>
    ${narr("riskRatingRationale", placeholder("Risk rating rationale"))}
    ${prov([{ v: "ncino", status: "live", href: sfBase }, { v: "iris", status: "stub" }, { v: "moodys", status: "stub" }])}`;
  };

  // ---- Financial Analysis (restructured 2026-08-21, formerly "Financial Commentary"): Current
  // Performance + a 3-year-plus-pro-forma Key Metrics table + spreading trend (folded in from the
  // retired Trend Reporting module) as sub-section 1; Future Outlook with Sensitivity Analysis nested
  // beneath it as sub-section 2; Cash Flow Analysis (folded in from the retired Global Cash Flow
  // module) as sub-section 3. Payment Performance is dropped — not relevant to this analysis.
  R.financial_commentary = (comps) => {
    const has = (id) => comps.some((c) => c.id === id);
    const per3 = periodsArr.length ? periodsArr.slice(-3) : [];
    const revF = (p) => li("income_statement", "sales_revenue")[p];
    const ebdF = (p) => li("income_statement", "adjusted_ebitda")[p];
    const debtF = (p) => li("balance_sheet", "total_debt")[p];
    const cashF = (p) => li("balance_sheet", "cash_and_equivalents")[p];
    const ocfF = (p) => li("cash_flow_statement", "operating_cash_flow")[p];
    const capexF = (p) => li("cash_flow_statement", "capital_expenditures")[p];
    const fcfF = (p) => (ocfF(p) != null && capexF(p) != null) ? ocfF(p) + capexF(p) : null;
    const debtToEbitdaF = (p) => (debtF(p) != null && ebdF(p)) ? debtF(p) / ebdF(p) : null;

    const gapCell = (label) => `<td class="numeric"><span class="gap">${label}</span></td>`;
    const valCell = (v, unit) => v == null ? gapCell("flagged for RM") : `<td class="numeric">${unit === "x" ? fmtX(v) : fmtUSD(v)}</td>`;
    const metricRow = (label, fn, pfCell) => `<tr><td>${label}</td>${per3.map((p) => valCell(fn(p))).join("")}${pfCell}</tr>`;
    const metricRowX = (label, fn, pfCell) => `<tr><td>${label}</td>${per3.map((p) => valCell(fn(p), "x")).join("")}${pfCell}</tr>`;

    let keyMetricsTable = placeholder("Key metrics table");
    if (per3.length) {
      const proFormaDebt = (debtF(latestPeriod) ?? 0) + (canon.exposureSummary?.changeInExposure?.commitment ?? 0);
      const proFormaEbitda = ebdF(latestPeriod);
      const proFormaLev = proFormaEbitda ? proFormaDebt / proFormaEbitda : null;
      const dscCov = covByRole(/debt service|fixed charge|coverage/i);
      const dscLatest = covRealActual(dscCov);
      keyMetricsTable = `
      <table><thead><tr><th>Metric</th>${per3.map((p) => `<th class="numeric">${p}</th>`).join("")}<th class="numeric">Pro Forma</th></tr></thead><tbody>
      ${metricRow("Revenue", revF, `<td class="numeric">${fmtUSD(revF(latestPeriod))} <span class="legend">(unchanged)</span></td>`)}
      ${metricRow("Adjusted EBITDA", ebdF, `<td class="numeric">${fmtUSD(ebdF(latestPeriod))} <span class="legend">(unchanged)</span></td>`)}
      ${metricRowX("Debt ÷ EBITDA", debtToEbitdaF, valCell(proFormaLev, "x"))}
      ${metricRow("Cash &amp; Equivalents", cashF, gapCell("not modeled"))}
      ${metricRow("Free Cash Flow", fcfF, gapCell("not modeled"))}
      <tr><td>Debt Service Coverage</td>${per3.map((p, i) => i === per3.length - 1 ? valCell(dscLatest, "x") : gapCell("flagged for RM")).join("")}${gapCell("not modeled")}</tr>
      </tbody></table>
      <div class="legend">Revenue, Adjusted EBITDA, and Free Cash Flow (operating cash flow less capital expenditures) trace to the Boom spread. Debt ÷ EBITDA is computed (total bank debt ÷ Adjusted EBITDA); the Pro Forma column adds this action's new money to the latest period's debt. Debt Service Coverage is the most recent covenant-test actual — prior-period DSC and all Pro Forma figures are not separately modeled and are flagged for RM completion rather than estimated.</div>`;
    }

    const spreadingBlock = () => {
      if (!periodsArr.length) return "";
      const periods = periodsArr;
      const revRaw = periods.map((p) => li("income_statement", "sales_revenue")[p]);
      const gpRaw = periods.map((p) => li("income_statement", "gross_profit")[p]);
      const ebRaw = periods.map((p) => li("income_statement", "adjusted_ebitda")[p]);
      const gm = periods.map((p, i) => (revRaw[i]) ? (gpRaw[i] / revRaw[i]) * 100 : null);
      const em = periods.map((p, i) => (revRaw[i] && ebRaw[i] != null) ? (ebRaw[i] / revRaw[i]) * 100 : null);
      const rev = revRaw.map((v) => (v ?? 0) / 1e6);
      const eb = ebRaw.map((v) => (v ?? 0) / 1e6);
      const dollarsHtml = `<div class="subhead">Spreading Trends — Revenue &amp; Adjusted EBITDA ($M)</div>${svgBars(periods, [{ name: "Revenue", color: "#2E0A4F", data: rev }, { name: "Adj. EBITDA", color: "#A100FF", data: eb }])}${narr("spreadingReadDollars", "")}`;
      const marginHtml = `<div class="subhead">Spreading Trends — Margin % (Gross &amp; EBITDA)</div>${svgLinePct(periods, [{ name: "Gross Margin %", color: "#2E0A4F", data: gm }, { name: "EBITDA Margin %", color: "#A100FF", data: em }])}<div class="legend">View: margin % — surfaces EBITDA-margin compression toward breakeven (the core finding the $-view hides).</div>${narr("spreadingReadMargin", "")}`;
      const def = cv.spreading === "margin" ? "margin" : "dollars";
      const altize = (h) => h.replace(/class="rte-narrative"/g, 'class="rte-narrative alt-view"');
      return `<div class="chart-views" data-default="${def}">
        <div class="chart-toggle"><span class="cv-lbl">Chart view</span><button class="cv-btn${def === "dollars" ? " active" : ""}" data-cv="dollars">$ Revenue / EBITDA</button><button class="cv-btn${def === "margin" ? " active" : ""}" data-cv="margin">Margin %</button></div>
        <div class="chart-view" data-view="dollars"${def !== "dollars" ? " hidden" : ""}>${def === "dollars" ? dollarsHtml : altize(dollarsHtml)}</div>
        <div class="chart-view" data-view="margin"${def !== "margin" ? " hidden" : ""}>${def === "margin" ? marginHtml : altize(marginHtml)}</div>
      </div>`;
    };

    const revolverBlock = () => {
      if (!has("revolver_usage_trend") || !afs.revolverUsage) return "";
      const r = afs.revolverUsage;
      return `<div class="subhead">Revolver Usage Trend — Existing ${fmtUSD(r.commitment)} RCF</div>${svgRevolver(r)}<div class="stat-row"><span>Commitment <b>${fmtUSD(r.commitment)}</b></span><span>High <b>${r.highPct}%</b></span><span>Avg <b>${r.averagePct}%</b></span><span>Low <b>${r.lowPct}%</b></span><span>Days at zero <b>${r.daysAtZero}</b></span></div><div class="legend">12-month utilization trend from AFS servicing.</div>`;
    };

    const currentBalanceBlock = () => has("current_balance_trend") ? `<div class="subhead">Current Balance Trend</div><p>[rendered because has_deposits=true — would show 18-mo deposit balance line from AFS/Client Central]</p>` : "";

    const sensitivityBlock = () => {
      if (!has("sensitivity_analysis")) return "";
      const scen = iris.sensitivity?.scenarios ?? [];
      if (!scen.length) return "";
      const TRIG = 1.25; // DSC covenant floor
      const rows = scen.map((s) => {
        const hasL = s.leverage != null, hasD = s.dsc != null;
        const cov = (s.covenantBreaches?.length) ? `<span class="badge badge-breach">${s.covenantBreaches.length} breach</span>`
          : (hasD && s.dsc < TRIG) ? `<span class="badge badge-breach">DSC</span>`
          : `<span class="badge badge-pass">Pass</span>`;
        const dCls = hasD ? (s.dsc < TRIG ? "cell-breach" : s.dsc < TRIG * 1.08 ? "cell-watch" : "") : "";
        const rev = s.revenueDelta ? `${(s.revenueDelta * 100).toFixed(0)}%` : "—";
        const gm = s.gmDeltaBps ? `${s.gmDeltaBps} bps` : "—";
        return `<tr><td>${s.name}</td><td class="numeric">${rev}</td><td class="numeric">${gm}</td><td class="numeric ${dCls}">${hasD ? fmtX(s.dsc) : hasL ? fmtX(s.leverage) : "—"}</td><td>${cov}</td></tr>`;
      }).join("");
      return `<div class="subhead">Sensitivity Analysis</div><table><thead><tr><th>Scenario</th><th class="numeric">Revenue Δ</th><th class="numeric">GM Δ</th><th class="numeric">DSC</th><th>Covenant</th></tr></thead><tbody>${rows}</tbody></table><div class="legend">A revenue −5% / gross-margin −100bps stress pressures debt-service coverage toward the 1.25x floor — the deal's key sensitivity.</div>`;
    };

    const cashFlowBlock = () => {
      if (!has("cash_flow_analysis")) return "";
      const eb = ebdF(latestPeriod);
      const dscCov = covByRole(/debt service|coverage/i);
      const dsc = dscCov ? covRealActual(dscCov) : null;
      return `<div class="subhead">Cash Flow Analysis</div>
      ${narr("globalCashFlow", placeholder("Global cash flow — combined borrower + guarantor coverage (operating CF, fixed charges, global DSC)"))}
      <table><tbody>
        <tr><td>Borrower adjusted EBITDA (${latestPeriod ?? "latest"})</td><td class="numeric">${fmtUSD(eb)}</td></tr>
        <tr><td>Guarantor cash-flow support</td><td class="numeric">[PFS — flagged for RM]</td></tr>
        <tr><td>Pro forma fixed charges (interest + scheduled principal)</td><td class="numeric">~$2.5M</td></tr>
        <tr><td>Global debt-service coverage</td><td class="numeric">${dsc != null ? fmtX(dsc) : "—"}</td></tr>
      </tbody></table>`;
    };

    return `
    <div class="subhead">Current Performance</div>
    ${narr("financialCommentary", placeholder("Financial commentary"))}
    ${has("key_metrics_table") ? `<div class="subhead">Key Metrics — Last 3 Fiscal Years + Pro Forma</div>${keyMetricsTable}` : ""}
    ${has("spreading_trends") ? spreadingBlock() : ""}
    ${revolverBlock()}
    ${currentBalanceBlock()}
    <div class="subhead">Future Outlook</div>
    ${narr("financialFutureOutlook", placeholder("Future outlook"))}
    ${sensitivityBlock()}
    ${cashFlowBlock()}
    ${prov([{ v: "boom", status: "live", href: "https://app.boom.build" }, { v: "iris", status: "stub" }])}`;
  };

  R.collateral = (comps) => {
    const has = (id) => comps.some((c) => c.id === id);
    const recs = canon.collateral ?? [];
    let out = "";
    if (recs.length) {
      out += `<table><thead><tr><th>Collateral</th><th class="numeric">Value</th><th class="numeric">Coverage</th><th>Lien</th></tr></thead><tbody>` +
        recs.map((r) => `<tr><td>${r.description ?? r.type ?? "—"}${r.loan ? ` <span style="color:var(--muted)">(${r.loan})</span>` : ""}</td><td class="numeric">${r.value != null ? fmtUSD(r.value) : "—"}</td><td class="numeric">${r.coveragePct != null ? r.coveragePct + "%" : "—"}</td><td>${r.lienPosition ?? "—"}</td></tr>`).join("") +
        `</tbody></table>`;
    } else {
      if (has("blanket_lien")) out += `<div class="subhead">Blanket Lien</div>${narr("collateralBlanket", placeholder("Blanket-lien collateral"))}`;
      if (has("equipment")) out += `<div class="subhead">Equipment</div>${narr("collateralEquipment", placeholder("Equipment collateral"))}`;
    }
    if (has("real_estate")) out += `<div class="subhead">Real Estate</div>${narr("collateralRealEstate", placeholder("Real-estate collateral"))}`;
    return out + prov([{ v: "ncino", status: "live", href: sfBase }]);
  };

  R.guarantor_profile = () => {
    const g = canon.guarantor ?? {};
    const isIndividual = (g.type || "").toLowerCase() === "individual";
    const kind = isIndividual ? "Individual (principal)" : "Corporate";
    // "Joint & several" describes a MULTI-guarantor obligation and does not apply to a single
    // individual guarantor — normalize rather than surface a mismatched guaranty type verbatim
    // (2026-08-21: caught on the Piedmont file, where a lone individual guarantor was labeled
    // "Joint & Several"; fixed at the source in ncino-demo-data.json, and defended here so the
    // same class of upstream data error can never reach the rendered memo again).
    const rawGuaranty = g.guarantyType ?? "";
    const guaranty = (isIndividual && /joint\s*&?\s*several/i.test(rawGuaranty))
      ? "Unlimited, Continuing (individual guarantor — joint &amp; several not applicable)"
      : (rawGuaranty || "Unlimited continuing guaranty");
    return `<table><tbody>
      <tr><td>Guarantor</td><td>${recLink(g.ncinoId, g.name ?? "[Guarantor]", "LLC_BI__Legal_Entities__c")}</td></tr>
      <tr><td>Type</td><td>${kind}</td></tr>
      <tr><td>Guaranty</td><td>${guaranty}</td></tr>
      <tr><td>Relationship to borrower</td><td>Founder &amp; 100% owner</td></tr>
    </tbody></table>
    ${narr("guarantorProfile", placeholder("Guarantor profile"))}
    ${prov([{ v: "ncino", status: "live", href: sfBase }])}`;
  };

  // ---- Risk and Mitigants (new 2026-08-21): the risk/mitigant/residual grid the rating and
  // covenant sections point back to.
  R.risk_mitigants = () => {
    const rows = canon.riskMitigants ?? [
      { risk: "Margin compression", mitigant: "Contracted price escalators; backlog conversion; qualification-cost roll-off underway", residual: "Watch" },
      { risk: "Customer / program concentration", mitigant: "Long program lifecycles; growing medical-device diversification (~20% of revenue)", residual: "Low" },
      { risk: "Key-man concentration (principal)", mitigant: "Unlimited personal guaranty; stable senior team (12+ yr avg. tenure)", residual: "Watch" },
      { risk: "Leverage above peer median", mitigant: "Tangible equipment &amp; blanket-lien collateral coverage (112%–185%)", residual: "Watch" },
      { risk: "Thin working-capital coverage during ramp", mitigant: "Revolver increase to $7.5M; borrowing-base monitoring via periodic field exams", residual: "Low" },
    ];
    const badge = (r) => r === "Breach" ? '<span class="badge badge-breach">Elevated</span>' : r === "Watch" ? '<span class="badge badge-watch">Watch</span>' : '<span class="badge badge-pass">Low</span>';
    const trs = rows.map((r) => `<tr><td>${r.risk}</td><td>${r.mitigant}</td><td>${badge(r.residual)}</td></tr>`).join("");
    return `
    <table><thead><tr><th>Risk</th><th>Mitigant</th><th>Residual</th></tr></thead><tbody>${trs}</tbody></table>
    ${narr("riskMitigantsNarrative", placeholder("Risk and mitigants summary"))}
    ${prov([{ v: "ncino", status: "live", href: sfBase }])}`;
  };

  R.forward_looking_recommendation = () => `
    ${narr("recommendation", placeholder("Recommendation &amp; proposed risk rating"))}
    ${prov([{ v: "ncino", status: "live", href: sfBase }, { v: "boom", status: "live", href: "https://app.boom.build" }, { v: "iris", status: "stub" }, { v: "afs", status: "stub" }])}`;

  R.leading_indicators = (comps) => {
    const has = (id) => comps.some((c) => c.id === id);
    const labels = {
      ews_summary: "Early Warning Signals (EWS) Summary",
      entity_verification: "Entity Verification (Secretary of State)",
      internet_search: "Internet Search",
      lexisnexis: "LexisNexis",
      credit_bureau: "Credit Bureau",
      sbfe: "Small Business Financial Exchange (SBFE)",
      public_debt_ratings: "Public Debt Ratings (Moody's / S&P / Fitch / Kroll)",
      real_estate_taxes: "Real Estate Taxes",
      leading_indicators_commentary: "Leading Indicators Commentary",
    };
    let out = "";
    for (const [id, label] of Object.entries(labels)) {
      if (has(id)) out += `<div class="subhead">${label}</div>${narr(id, placeholder(label))}`;
    }
    return out + prov([{ v: "lexisnexis", status: "stub" }, { v: "moodys", status: "stub" }, { v: "capiq", status: "stub" }]);
  };

  // ---- Appendix (new 2026-08-21): supporting-document placeholder index with lightweight
  // add/rename/remove — illustrative only; not yet wired to nCino DocMan attachment storage.
  R.appendix = () => {
    const docs = canon.supportingDocuments ?? [
      { name: "Personal Financial Statement — Margaret Holloway", status: "Outstanding" },
      { name: "Equipment quotes — 3× Mazak INTEGREX i-450", status: "On file" },
      { name: "UCC-1 filing confirmation", status: "On file" },
      { name: "CPA-reviewed FY2025 financial statements", status: "On file" },
    ];
    const rows = docs.map((d) => `<tr><td class="cmr-doc-name">${esc(d.name)}</td><td class="cmr-doc-status">${esc(d.status ?? "On file")}</td><td style="white-space:nowrap"><button type="button" data-cmr-rename style="margin-right:6px">Rename</button><button type="button" data-cmr-delete>Remove</button></td></tr>`).join("");
    return `
    <div class="subhead">Supporting Documents</div>
    <table id="cmr-appendix-table"><thead><tr><th>Document</th><th>Status</th><th></th></tr></thead><tbody id="cmr-appendix-rows">${rows}</tbody></table>
    <div class="two-col" style="margin-top:8px">
      <div><input type="text" id="cmr-appendix-new-name" placeholder="Document name" style="width:100%;padding:5px 8px;border:1px solid var(--slate);border-radius:4px"></div>
      <div style="display:flex;gap:8px">
        <select id="cmr-appendix-new-status" style="padding:5px 8px;border:1px solid var(--slate);border-radius:4px"><option>On file</option><option>Outstanding</option><option>Pending review</option></select>
        <button type="button" id="cmr-appendix-add">+ Add document</button>
      </div>
    </div>
    <div class="legend">Illustrative supporting-document index — not yet wired to nCino DocMan attachment storage.</div>
    <script>(function(){
      var tbody = document.getElementById('cmr-appendix-rows');
      if (!tbody) return;
      function wireRow(row) {
        var ren = row.querySelector('[data-cmr-rename]');
        var del = row.querySelector('[data-cmr-delete]');
        if (ren) ren.addEventListener('click', function () {
          var cell = row.querySelector('.cmr-doc-name');
          var v = prompt('Rename document', cell.textContent);
          if (v) cell.textContent = v;
        });
        if (del) del.addEventListener('click', function () { row.remove(); });
      }
      Array.prototype.forEach.call(tbody.querySelectorAll('tr'), wireRow);
      var addBtn = document.getElementById('cmr-appendix-add');
      if (addBtn) addBtn.addEventListener('click', function () {
        var nameInput = document.getElementById('cmr-appendix-new-name');
        var statusSel = document.getElementById('cmr-appendix-new-status');
        var name = (nameInput.value || '').trim();
        if (!name) return;
        var tr = document.createElement('tr');
        tr.innerHTML = '<td class="cmr-doc-name"></td><td class="cmr-doc-status"></td><td style="white-space:nowrap"><button type="button" data-cmr-rename style="margin-right:6px">Rename</button><button type="button" data-cmr-delete>Remove</button></td>';
        tr.querySelector('.cmr-doc-name').textContent = name;
        tr.querySelector('.cmr-doc-status').textContent = statusSel.value;
        tbody.appendChild(tr);
        wireRow(tr);
        nameInput.value = '';
      });
    })();</script>`;
  };

  R.syndications = () => `<p>[rendered because is_syndicated=true — Left Lead / Participation structure, voting rights, hold size]</p>`;
  R.peg_assessment = () => `<p>[rendered because is_peg=true — PEG ownership analysis]</p>`;
  R.leveraged_finance_ev = () => `<p>[rendered because is_lft=true — Enterprise Value memo per WHL-103]</p>`;

  const renderModule = (mod) => (R[mod.id] ? R[mod.id](mod.components ?? []) : `<p class="gap">[module body pending: ${mod.id}]</p>`);

  // ---------------------------------------------------- assemble
  const CLASS = "INTERNAL — DRAFT, PENDING CREDIT COMMITTEE REVIEW";
  let modulesHtml = "";
  let tocHtml = "";
  let pageNo = 2;
  const skipChrome = new Set(["relationship_name_tbe", "table_of_contents"]);
  let attTotal = 0, attReviewed = 0, attEdited = 0;
  for (const mod of plan) {
    if (skipChrome.has(mod.id)) continue;
    pageNo++;
    attTotal++;
    const aStatus = (att[mod.id] ?? {}).status ?? "ai-drafted";
    if (aStatus === "approved" || aStatus === "edited") attReviewed++;
    if (aStatus === "edited") attEdited++;
    tocHtml += `<li>${mod.name}${mod.components?.length ? ` <span class="muted">— ${mod.components.map((c) => c.id.replace(/_/g, " ")).join(", ")}</span>` : ""}</li>`;
    modulesHtml += `
<section class="page" data-mod="${mod.id}" data-modname="${esc(mod.name)}">
  <div class="classification">${CLASS}</div>
  <div class="section-header"><span class="section-eyebrow">${mod.name}</span><span class="section-title">${mod.name}</span></div>
  ${attestationBadge(mod.id)}
  ${renderModule(mod)}
  <div class="page-footer"><span>${CLASS}</span><span>Page ${pageNo}</span></div>
</section>`;
  }

  // cover attestation summary (section review ≠ committee approval)
  const attPct = attTotal ? Math.round((attReviewed / attTotal) * 100) : 0;
  const attestationSummary = `
    <div class="attest-summary">
      <div><strong>Section review:</strong> ${attReviewed} of ${attTotal} sections reviewed${attEdited ? ` (${attEdited} edited)` : ""} · ${attTotal - attReviewed} pending</div>
      <div class="note">Section-level attestation records preparer/reviewer verification of the AI-drafted content. It is not credit-committee approval, which remains a separate gate (see classification banner).</div>
    </div>`;
  modulesHtml += "\n<!-- ===== CONDITIONALITY ENGINE: SUPPRESSED =====\n" +
    suppressed.map((s) => `  SUPPRESSED: ${s}`).join("\n") + "\n===== END SUPPRESSED ===== -->\n";

  // ---------------------------------------------------- nCino RTE-safe section variant
  // Same render pass, second target: the 7 nCino cm_* rich-text fields (ncino_sync_memo_sections).
  // We transform our OWN rich module HTML — a known, bounded vocabulary — into the STRICT Salesforce
  // rich-text subset: semantic tags only (p/strong/em/ul/ol/li/a + plain tables), NO class/style/SVG/div.
  // Safest variant by design: nCino's RTE accepts it with zero special handling. The Experience MCP
  // owns the bucket-id → cm_* field-API-name map; here we only group + emit per bucket.
  function toRte(fragment) {
    let s = fragment;
    // 1. drop inline-SVG charts (not RTE-renderable); adjacent data tables/stat rows carry the numbers
    s = s.replace(/<svg[\s\S]*?<\/svg>/g, "");
    // 2. KPI strip → table: nested cards become rows, then the wrapper becomes a table
    s = s.replace(/<div class="kpi-card"><div class="kpi-label">([\s\S]*?)<\/div><div class="kpi-value">([\s\S]*?)<\/div><div class="kpi-sub">([\s\S]*?)<\/div><\/div>/g,
      (_m, label, val, sub) => `<tr><td><strong>${label}</strong></td><td>${val}${sub.trim() ? ` (${sub.trim()})` : ""}</td></tr>`);
    s = s.replace(/<div class="kpi-strip">([\s\S]*?)<\/div>/g, "<table><tbody>$1</tbody></table>");
    // 3. semantic divs → semantic tags
    s = s.replace(/<div class="subhead"[^>]*>([\s\S]*?)<\/div>/g, "<p><strong>$1</strong></p>");
    s = s.replace(/<div class="callout"[^>]*>([\s\S]*?)<\/div>/g, "<p>$1</p>");
    s = s.replace(/<div class="(?:legend|source-line|stat-row|note|att-meta|gap)"[^>]*>([\s\S]*?)<\/div>/g, "<p><em>$1</em></p>");
    // 4. join adjacent spans with separators (stat rows), then unwrap remaining layout divs
    s = s.replace(/<\/span>\s*<span[^>]*>/g, " · ");
    s = s.replace(/<\/?div[^>]*>/g, "");
    // 5. spans → text; b/i → strong/em
    s = s.replace(/<\/?span[^>]*>/g, "");
    s = s.replace(/<b>/g, "<strong>").replace(/<\/b>/g, "</strong>").replace(/<i>/g, "<em>").replace(/<\/i>/g, "</em>");
    // 6. strip class/style/data-* everywhere (href, colspan, rowspan survive)
    s = s.replace(/\s(?:class|style|data-[\w-]+)="[^"]*"/g, "");
    // 6b. normalize comparison operators → real glyphs so no stray "<"/">" can confuse the RTE parser
    s = s.replace(/<=/g, "≤").replace(/>=/g, "≥");
    // 7. tidy: drop empty paragraphs + collapse blank lines
    s = s.replace(/<p>\s*(?:<em>\s*<\/em>|<strong>\s*<\/strong>)?\s*<\/p>/g, "");
    // 7b. normalize the half-written "[ … — pending; complete in the per-section review.]" stubs into
    //     a clean, intentional workflow note (the bracketed text reads as broken in nCino's RTE).
    s = s.replace(/<p>\s*\[[^\]]*\bpending\b[^\]]*\]\s*<\/p>/gi, '<p><em>Pending preparer completion.</em></p>');
    s = s.replace(/\n{2,}/g, "\n").trim();
    return s;
  }

  // The nCino cm_* fields carry NARRATIVE PROSE ONLY — the figures (exposure/covenant/KPI tables, charts)
  // live in the systems of record (nCino loans, Snowflake/AFS), so the narrative field must not duplicate
  // them. Extract just the [data-editable] narrative blocks from each module before RTE-sanitizing.
  function narrativeOnly(fragment) {
    const out = [];
    const re = /<div class="rte-narrative"[^>]*>([\s\S]*?)<\/div>/g;
    let m;
    while ((m = re.exec(fragment)) !== null) out.push(m[1]);
    return out.join("\n");
  }
  const NCINO_SECTION_ORDER = ["executive_summary", "product_request_overview", "background", "financial_analysis", "covenant_analysis", "collateral_analysis", "risk_assessment"];
  const rteBuckets = {};
  for (const mod of plan) {
    if (!mod.ncinoSection) continue; // chrome (relationship_name_tbe, table_of_contents) → not synced
    const body = toRte(narrativeOnly(renderModule(mod)));
    if (!body.trim()) continue; // a pure-data module (no narrative) contributes nothing to the field
    (rteBuckets[mod.ncinoSection] ??= []).push(`<p><strong>${esc(mod.name)}</strong></p>\n${body}`);
  }
  const rteSections = {};
  for (const sec of NCINO_SECTION_ORDER) {
    if (rteBuckets[sec]?.length) rteSections[sec] = rteBuckets[sec].join("\n");
  }

  const html = shell
    .replaceAll("{{TITLE}}", `Commercial Credit Memo — ${canon.borrower.name}`)
    .replaceAll("{{CLASSIFICATION}}", CLASS)
    .replaceAll("{{BORROWER_NAME}}", canon.borrower.name)
    .replaceAll("{{CREDIT_ACTION}}", canon.creditAction.productPackageName)
    .replaceAll("{{MEMO_TYPE}}", "Existing Relationship — Material Credit Event")
    .replaceAll("{{NAICS}}", canon.borrower.naics)
    .replaceAll("{{NAICS_DESC}}", canon.borrower.naicsDesc)
    .replaceAll("{{RM_NAME}}", "Demo Commercial RM")
    .replaceAll("{{CREDIT_OFFICER}}", "Demo Credit Officer")
    .replaceAll("{{MEMO_DATE}}", "May 30, 2026")
    .replaceAll("{{TOC}}", tocHtml)
    .replaceAll("{{ATTESTATION_SUMMARY}}", attestationSummary)
    .replaceAll("{{MODULES}}", modulesHtml);

  return { html, plan, suppressed, flags, rteSections };
}
