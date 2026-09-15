#!/usr/bin/env bun
/**
 * Builds the nine tailored financial statement sets and the download caddy.
 *
 *   bun run build.mjs
 *
 * Steps: (1) run the Python model, which re-derives facts.json from the org
 * facts in org-facts/; (2) render the company prepared PDF and the compiled
 * PDF for each relationship with Puppeteer; (3) write the company prepared
 * workbook with openpyxl; (4) write reconciliation.md and reconciliation.html;
 * (5) write the caddy index.html; (6) run the quality gate.
 *
 * Intermediates live in /dev/shm/stmts/work (RAM). Nothing is downloaded: the
 * Puppeteer install and its Chrome come from the uk-companies-house repo.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const WORK = '/dev/shm/stmts/work';
const OUT = join(DIR, '..', '..', 'preview-site', 'builds', 'statements-0915');
const PUPPETEER = '/opt/connectry/projects/uk-companies-house/repo/node_modules/puppeteer';

const log = (...a) => console.log(...a);

/* ------------------------------------------------------------------ format */
const R = (v) => Math.round(v);
const grp = (n) => n.toLocaleString('en-US');
function num(v, { k = false, dollar = false } = {}) {
  if (v === null || v === undefined) return '';
  let x = k ? R(v / 1000) : R(v);
  if (x === 0) return dollar ? '<span class="s">$</span>-' : '-';
  const body = grp(Math.abs(x));
  const inner = x < 0 ? `(${body})` : body;
  return dollar ? `<span class="s">$</span>${inner}` : inner;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CLS = { header: 'h', header2: 'h2', detail: 'd', subtotal: 'sub', total: 'tot', note: 'note' };

/** Two period columns. Marks $ on the first figure of each block and on totals. */
function table(rows, { k = false, headers } = {}) {
  let out = '<table><colgroup><col class="lab"><col class="gap"><col class="fig">' +
            '<col class="gap"><col class="fig"></colgroup>';
  if (headers) {
    out += `<tr><th></th><th></th><th class="hd">${headers[0]}</th>` +
           `<th></th><th class="hd">${headers[1]}</th></tr>`;
  }
  let fresh = true;
  for (const r of rows) {
    const cls = CLS[r.role] || 'd';
    if (r.role === 'header' || r.role === 'header2' || r.role === 'note') {
      out += `<tr class="${cls}"><td class="l" colspan="5">${esc(r.label)}</td></tr>`;
      if (r.role !== 'note') fresh = true;
      continue;
    }
    const d = fresh || r.role === 'total';
    out += `<tr class="${cls}"><td class="l">${esc(r.label)}</td><td></td>` +
           `<td class="f">${num(r.v25, { k, dollar: d })}</td><td></td>` +
           `<td class="f">${num(r.v24, { k, dollar: d })}</td></tr>`;
    fresh = false;
  }
  return out + '</table>';
}

/* -------------------------------------------------- company prepared (4 pp) */
const NOTE_CONF = 'Note: These financial statements are confidential, proprietary, unaudited and subject to change';

function companyPrepared(rel) {
  const cons = rel.consolidated.length ? 'Consolidated ' : '';
  const hd = ['<span>December</span><span class="yr">2025</span>',
              '<span>December</span><span class="yr">2024</span>'];
  const head = (t) => `<h1>${esc(rel.legalName)} ${cons}${t}</h1><div class="unaud">(Unaudited)</div>` +
                      `<div class="units">(Dollars in thousands)</div>`;
  const pg = (t, rows) => `<div class="page">${head(t)}${table(rows, { k: true, headers: hd })}` +
                          `<div class="foot">${NOTE_CONF}</div></div>`;
  const cover = `<div class="page"><div class="cover">` +
    `<div>${esc(rel.legalName)}</div>` +
    `<div>${cons}Financial Statements</div>` +
    `<div>For the period ended December 31, 2025</div></div></div>`;
  return cover +
    pg('Balance Sheet', rel.statements.balance) +
    pg('Statement of Operations Twelve months ended December 31, 2025', rel.statements.income) +
    pg('Statement of Cash Flows Twelve months ended December 31, 2025', rel.statements.cash);
}

/* ------------------------------------------------------- compiled (11-14 pp) */
const MONTHS = ['January','February','March','April','May','June','July','August','September',
                'October','November','December'];
const longDate = (iso) => { const [y,m,d] = iso.split('-'); return `${+d} ${MONTHS[+m-1]} ${y}`; };
const usDate = (iso) => { const [y,m,d] = iso.split('-'); return `${MONTHS[+m-1]} ${+d}, ${y}`; };

function stHead(rel, title, period) {
  const cons = rel.consolidated.length ? 'CONSOLIDATED ' : '';
  return `<div class="sthead"><div class="e">${esc(rel.legalName.toUpperCase())}</div>` +
         `<div class="t">${cons}${title}</div><div class="t">${period}</div>` +
         `<div class="r">(See Accountant's Compilation Report)</div></div>`;
}
const stFoot = (n) => `<div class="pagefoot"><div class="pfoot">See accompanying notes to ` +
  `financial statements.</div><div class="pnum">Page ${n}</div></div>`;

function equityTable(rel) {
  const rows = rel.statements.equity;
  let out = '<table><colgroup><col class="lab"><col class="gap"><col class="fig">' +
            '<col class="gap"><col class="fig"><col class="gap"><col class="fig"></colgroup>';
  out += `<tr><th></th><th></th><th class="hd"><span>${esc(rel.contributedLabel)}</span></th>` +
         `<th></th><th class="hd"><span>${esc(rel.retainedLabel)}</span></th>` +
         `<th></th><th class="hd"><span>Total</span></th></tr>`;
  for (const r of rows) {
    const cls = r.role === 'total' ? 'sub' : 'd';
    const d = r.role === 'total';
    out += `<tr class="${cls}"><td class="l">${esc(r.label)}</td><td></td>` +
           `<td class="f">${num(r.c, { dollar: d })}</td><td></td>` +
           `<td class="f">${num(r.r, { dollar: d })}</td><td></td>` +
           `<td class="f">${num(r.t, { dollar: d })}</td></tr>`;
  }
  return out + '</table>';
}

function noteTable(cols, rows, { cls = '' } = {}) {
  let out = `<table${cls ? ' class="' + cls + '"' : ''}><colgroup><col class="lab">`;
  for (let i = 0; i < cols.length; i++) out += '<col class="gap"><col class="fig">';
  out += '</colgroup>';
  if (cols.some(Boolean)) {
    out += '<tr><th></th>';
    for (const c of cols) out += `<th></th><th class="hd"><span>${c}</span></th>`;
    out += '</tr>';
  }
  for (const r of rows) {
    const cls = r.role === 'total' ? 'tot' : (r.role === 'subtotal' ? 'sub' : 'd');
    out += `<tr class="${cls}"><td class="${r.indent === 0 ? 'l0' : 'l'}">${r.label}</td>`;
    for (const v of r.values) {
      out += `<td></td><td class="f">${typeof v === 'string' ? v : num(v, { dollar: !!r.dollar })}</td>`;
    }
    out += '</tr>';
  }
  return out + '</table>';
}

function compilationReport(rel) {
  const cons = rel.consolidated.length ? 'consolidated ' : '';
  const eq = rel.equityCaption.toLowerCase();
  return `<div class="page">
<div class="letterhead"><div class="fn">${esc(rel.cpa.name.replace(', PLLC', '').toUpperCase())}</div>
<div class="fs">CERTIFIED PUBLIC ACCOUNTANTS</div></div>
<h2 class="rep">INDEPENDENT ACCOUNTANT'S COMPILATION REPORT</h2>
<div class="addr">To ${esc(rel.governingBody)}<br>${esc(rel.legalName)}<br>${esc(rel.city)}, ${esc(rel.state)}</div>
<p>Management is responsible for the accompanying ${cons}financial statements of ${esc(rel.legalName)} (${ARTICLE(rel.state)} ${esc(rel.state)} ${esc(rel.entityWord)}), which comprise the ${cons}balance sheet as of December 31, 2025 and 2024, and the related ${cons}statements of income, changes in ${esc(eq)} and cash flows for the years then ended, and the related notes to the financial statements in accordance with accounting principles generally accepted in the United States of America. We have performed a compilation engagement in accordance with Statements on Standards for Accounting and Review Services promulgated by the Accounting and Review Services Committee of the AICPA. We did not audit or review the financial statements nor were we required to perform any procedures to verify the accuracy or completeness of the information provided by management. We do not express an opinion, a conclusion, nor provide any assurance on these financial statements.</p>
<p>Management has elected to omit substantially all of the disclosures required by accounting principles generally accepted in the United States of America other than those presented in the accompanying notes. If the omitted disclosures were included in the financial statements, they might influence the user's conclusions about the Company's financial position, results of operations and cash flows. Accordingly, these financial statements are not designed for those who are not informed about such matters.</p>
<div class="sig">${esc(rel.cpa.name.replace(', PLLC', ' PLLC'))}</div>
<div style="margin-top:6pt">${esc(rel.cpa.name)}</div>
<div style="margin-top:26pt">${esc(rel.cpa.city)}, ${esc(rel.cpa.state)}<br>${usDate(rel.cpa.date)}</div>
<div class="pagefoot"><div class="pnum">Page 1</div></div></div>`;
}

/* ------------------------------------------------------- notes as flow blocks
   Note content is emitted as an ordered list of blocks. build() measures each
   block in a print-media page at the real content width and packs them into
   pages, so nothing overflows and no page is left half empty. A note that runs
   over a page break picks up a "(Continued)" heading on the new page. */
const PAYWORD = {
  'Installment': 'payable in equal monthly instalments of principal and interest',
  'Balloon': 'payable in monthly instalments of principal and interest on a twenty five year amortisation with a balloon payment at maturity',
  'Revolving Line Of Credit': 'revolving, interest payable monthly',
  'Draw Down Line Of Credit': 'draw down facility, interest payable monthly',
  'Single Pay': 'interest payable monthly, principal due at maturity',
  'Construction Permanent': 'construction facility, interest only during the construction period, converting to a permanent instalment note on completion',
};
const NOTE_TITLES = {
  A: 'NOTE A. ORGANISATION AND NATURE OF ACTIVITIES',
  B: 'NOTE B. SUMMARY OF SIGNIFICANT ACCOUNTING POLICIES',
  C: 'NOTE C. PROPERTY AND EQUIPMENT',
  D: 'NOTE D. LONG TERM DEBT AND CREDIT FACILITIES',
  E: 'NOTE E. REVOLVING CREDIT, BORROWING BASE AND LETTERS OF CREDIT',
  F: 'NOTE F. PLEDGED COLLATERAL',
  G: 'NOTE G. FINANCIAL COVENANTS',
  H: 'NOTE H. COMMITMENTS AND CONTINGENCIES',
  I: 'NOTE I. SUPPLEMENTARY INFORMATION',
  J: 'NOTE J. SUBSEQUENT EVENTS',
};

function noteBlocks(rel) {
  const n = rel.notes, cons = rel.consolidated.length > 0;
  const money = (v) => '$' + grp(R(v));
  const B = [];
  const add = (note, html) => B.push({ note, html });

  add('A', `<p>${esc(rel.nature)}</p>`);
  if (cons) add('A', `<p>The consolidated financial statements include the accounts of the Company and the following wholly owned subsidiaries: ${rel.consolidated.map(esc).join('; ')}. All significant intercompany accounts and transactions have been eliminated in consolidation.</p>`);

  add('B', `<h4>Basis of Accounting</h4><p>The financial statements have been prepared on the accrual basis of accounting in accordance with accounting principles generally accepted in the United States of America and accordingly reflect all significant receivables, payables and other liabilities.</p>`);
  add('B', `<h4>Use of Estimates</h4><p>Management uses estimates and assumptions in preparing financial statements. Those estimates and assumptions affect the reported amounts of assets and liabilities, the disclosure of contingent assets and liabilities, and the reported amounts of revenue and expenses. Actual results could differ from those estimates.</p>`);
  add('B', `<h4>Cash and Cash Equivalents</h4><p>The Company considers all highly liquid investments with an original maturity of three months or less to be cash equivalents. Balances held at financial institutions periodically exceed federally insured limits.</p>`);
  add('B', `<h4>Accounts Receivable</h4><p>Accounts receivable are stated at the amount management expects to collect on balances outstanding at year end. An allowance for doubtful accounts is provided based on a review of the ageing of individual balances and historical loss experience. Receivables are assigned to the bank under a first blanket security interest.</p>`);
  add('B', `<h4>Inventories</h4><p>Inventories are stated at the lower of cost or net realisable value. Cost is determined on the first in, first out basis. Management reviews inventory for obsolescence and slow movement at each reporting date.</p>`);
  add('B', `<h4>Property and Equipment</h4><p>Property and equipment are carried at cost. Depreciation is computed using the straight line method over the estimated useful lives of the assets, ranging between three and thirty nine years. The costs of additions and betterments are capitalised and expenditures for repairs and maintenance are charged to expense as incurred. When assets are sold or retired the related cost and accumulated depreciation are removed from the accounts and any gain or loss is included in income.</p>`);
  add('B', `<h4>Revenue Recognition</h4><p>Revenue is recognised when control of the promised goods or services transfers to the customer, in an amount that reflects the consideration the Company expects to be entitled to in exchange for those goods or services.</p>`);
  add('B', `<h4>Income Taxes</h4><p>${esc(rel.taxPolicy)}</p>`);
  add('B', `<h4>Date of Management's Review</h4><p>Management has evaluated subsequent events through ${usDate(rel.cpa.date)}, the date on which the financial statements were available to be issued.</p>`);

  const ppeRows = n.ppe.components.map((c) => ({ label: esc(c.label), values: [c.v25, c.v24], indent: 1 }));
  ppeRows.push({ label: '', values: [n.ppe.gross[0], n.ppe.gross[1]], role: 'subtotal', indent: 1 });
  ppeRows.push({ label: 'Less accumulated depreciation and amortisation',
                 values: [n.ppe.accum[0], n.ppe.accum[1]], indent: 1 });
  ppeRows.push({ label: '', values: [n.ppe.net[0], n.ppe.net[1]], role: 'total', dollar: true, indent: 1 });
  add('C', `<p>Property and equipment at December 31 consisted of the following:</p>` +
           noteTable(['2025', '2024'], ppeRows));
  let dep = `<p>Depreciation and amortisation expense was ${money(n.ppe.depreciation[0])} for 2025 and ${money(n.ppe.depreciation[1])} for 2024.`;
  if (n.ppe.nonCashAdditions[0]) {
    dep += ` Additions of ${money(n.ppe.additions[0])} were settled in cash and a further ${money(n.ppe.nonCashAdditions[0])} of equipment was acquired directly under notes payable with the lender, a non cash investing and financing activity. Assets with a net book value of ${money(n.ppe.disposals[0])} (cost ${money(n.ppe.disposalCost)}, accumulated depreciation ${money(n.ppe.disposalAccum)}) were retired during 2025 on the recapitalisation of the machining line; the resulting non cash charge is included in changes in operating assets and liabilities, net, in the statement of cash flows.`;
  }
  add('C', dep + '</p>');

  const frows = n.facilities.map((f, i) => {
    const secured = f.secured === 'Real Estate' ? 'Secured by a first mortgage on the financed real estate.'
                                                : 'Secured by a first lien on the financed assets and a blanket lien on all business assets.';
    const mat = f.maturity ? `maturing ${usDate(f.maturity)}` : 'no stated maturity';
    return { label: `<span style="display:inline-block;max-width:4.3in">${esc(f.product)}, original amount ${money(f.original)}, interest at ${f.rate.toFixed(2)} percent, ${PAYWORD[f.paymentType] || 'payable monthly'}, ${mat}. ${secured}</span>`,
             values: [f.balance === null ? 'undrawn' : f.balance], indent: 1, dollar: i === 0 };
  });
  add('D', `<p>Debt outstanding at December 31, 2025 consisted of the following facilities, all with the same bank:</p>` +
           noteTable([''], [frows[0]], { cls: 'tc tc-first' }));
  for (let i = 1; i < frows.length - 1; i++) add('D', noteTable([''], [frows[i]], { cls: 'tc' }));
  add('D', noteTable([''], [frows[frows.length - 1],
      { label: 'Total debt outstanding', values: [n.debtTotal], role: 'subtotal', indent: 1 }],
      { cls: 'tc tc-last' }));
  const mr = n.maturities.map((m, i) => ({ label: String(m[0]), values: [m[1]], indent: 1, dollar: i === 0 }));
  mr.push({ label: '', values: [n.debtTotal], role: 'total', dollar: true, indent: 1 });
  add('D', `<p>Aggregate maturities of debt for each of the five years following December 31, 2025 and thereafter are as follows:</p>` +
           noteTable(['Year ending December 31'], mr) +
           `<p>Scheduled principal payments of ${money(rel.totals.principal[0])} were made during 2025 and interest expense on all facilities was ${money(rel.totals.interest[0])}.</p>`);

  let e1 = `<p>The Company maintains revolving credit commitments of ${money(n.revolverCommitment)}, of which ${money(n.revolverDrawn)} was advanced at December 31, 2025.`;
  if (n.letters) e1 += ` Outstanding letters of credit issued under the facility totalled ${money(n.letters)}.`;
  e1 += '</p>';
  if (!n.borrowingBase && n.revolverCommitment) {
    e1 += `<p>Undrawn availability under the revolving commitments was ${money(n.revolverCommitment - n.revolverDrawn - n.letters)} at December 31, 2025.</p>`;
  }
  add('E', e1);
  if (n.borrowingBase) {
    const bb = n.borrowingBase;
    const gross = R(bb.arEligible * bb.arRate + bb.invEligible * bb.invRate);
    const base = Math.min(gross, bb.cap);
    const br = [
      { label: `Eligible accounts receivable at ${(bb.arRate * 100).toFixed(0)} percent`, values: [R(bb.arEligible * bb.arRate)], indent: 1, dollar: true },
      { label: `Eligible inventory at ${(bb.invRate * 100).toFixed(0)} percent`, values: [R(bb.invEligible * bb.invRate)], indent: 1 },
      { label: 'Gross borrowing base', values: [gross], role: 'subtotal', indent: 1 },
      { label: 'Limited to the revolving commitment', values: [base], indent: 1 },
      { label: 'Less advances outstanding', values: [-n.revolverDrawn], indent: 1 },
    ];
    if (n.letters) br.push({ label: 'Less letters of credit outstanding', values: [-n.letters], indent: 1 });
    br.push({ label: 'Availability at December 31, 2025', values: [base - n.revolverDrawn - n.letters], role: 'total', dollar: true, indent: 1 });
    add('E', `<p>The borrowing base at December 31, 2025 was determined as follows:</p>` + noteTable([''], br) +
             `<p>Eligible accounts receivable of ${money(bb.arEligible)} and eligible inventory of ${money(bb.invEligible)} are stated after the exclusions set out in the loan agreement, being invoices over ninety days past due, cross aged and contra accounts, concentrations above the twenty percent cap, intercompany balances, consigned material and goods in transit.</p>`);
  }
  if (n.undrawnCommitments.length) {
    add('E', `<p>The Company also holds the following committed but undrawn facilities: ` +
      n.undrawnCommitments.map((u) => `${esc(u[0])}, ${money(u[1])}`).join('; ') + '.</p>');
  }

  if (n.collateral.length) {
    const cr = n.collateral.map((c, i) => ({
      label: `<span style="display:inline-block;max-width:4.3in">${esc(c.description)}</span>`,
      values: [c.value], indent: 1, dollar: i === 0 }));
    add('F', `<p>The following assets are pledged to the bank. Values are the lender's most recent approved valuation and are presented for disclosure only; they are not carrying amounts.</p>` +
             noteTable([''], [cr[0]], { cls: 'tc tc-first' }));
    for (let i = 1; i < cr.length - 1; i++) add('F', noteTable([''], [cr[i]], { cls: 'tc' }));
    add('F', noteTable([''], [cr[cr.length - 1],
        { label: 'Total pledged value', values: [n.collateral.reduce((a, c) => a + c.value, 0)],
          role: 'subtotal', indent: 1 }], { cls: 'tc tc-last' }));
  } else {
    add('F', `<p>All obligations to the bank are secured by a first blanket lien on all present and future business assets of the Company, including accounts receivable, inventory, machinery and equipment and general intangibles, together with a first mortgage on the owner occupied plant, and by the pledge of the equity of the Company.</p>`);
  }

  let g = `<p>The loan agreement contains the financial covenants set out below. The measure shown for each is computed from these financial statements at December 31, 2025 and agrees to the value carried in the bank's covenant record.</p>
<table><colgroup><col style="width:1.9in"><col style="width:1.15in"><col style="width:1.15in"><col style="width:1.15in"></colgroup>
<tr><th style="text-align:left;font-weight:bold;padding-bottom:4pt">Covenant</th>
<th style="text-align:right;font-weight:bold">Requirement</th>
<th style="text-align:right;font-weight:bold">Measure</th>
<th style="text-align:right;font-weight:bold">Status</th></tr>`;
  for (const c of rel.covenants) {
    if (c.orgValue === null) continue;
    const f = (v) => c.unit === 'usd' ? '$' + grp(R(v))
                   : c.unit === 'pct' ? v.toFixed(1) + '%'
                   : c.unit === 'usd2' ? '$' + v.toFixed(2)
                   : v.toFixed(2) + 'x';
    g += `<tr><td style="padding:3pt 0;vertical-align:top">${esc(c.type)}</td>` +
         `<td class="f" style="vertical-align:top">${f(c.threshold)}</td>` +
         `<td class="f" style="vertical-align:top">${f(c.computed)}</td>` +
         `<td class="f" style="vertical-align:top">${esc(c.status)}</td></tr>`;
  }
  add('G', g + '</table>');
  const exc = rel.covenants.filter((c) => c.status === 'Exception' || c.status === 'Waived');
  if (exc.length) {
    add('G', `<h4>Exceptions and waivers</h4><p>` + exc.map((c) =>
      `${esc(c.type)}: ${c.status === 'Waived' ? 'the bank has waived the test at this measurement date' : 'the measure is outside the required level and the bank has recorded an exception'}. ${esc(c.definition)}`).join(' ') + '</p>');
  }
  const basis = rel.covenants.filter((c) => c.orgValue !== null);
  basis.forEach((c, i) => add('G', (i === 0 ? `<h4>Basis of computation</h4>` : '') +
    `<p><small>${esc(c.type)} (${c.id}): ${c.formula}.${c.basis ? ' ' + esc(c.basis) : ''}</small></p>`));

  add('H', n.rent
    ? `<p>The Company leases premises and equipment under operating leases expiring at various dates through 2033. Rent expense under these leases was ${money(n.rent)} for the year ended December 31, 2025 and is included in operating expenses.</p>`
    : `<p>The Company is party to various claims and legal actions arising in the ordinary course of business. Management believes the resolution of these matters will not have a material effect on the financial position or results of operations of the Company.</p>`);
  add('H', `<p>The Company maintains property, general liability and business interruption insurance in amounts management considers adequate, with the bank named as lender's loss payee on all policies covering pledged collateral.</p>`);

  if (n.properties) {
    const pr = n.properties.map((p, i) => {
      const ds = p.principal + p.interest;
      return { label: `${esc(p.name)} (${p.units} units)`,
               values: [p.revenue, p.noi, ds, (p.noi / ds).toFixed(2) + 'x'], indent: 0, dollar: i === 0 };
    });
    add('I', `<p>Operating results by property for the year ended December 31, 2025, together with the property level debt service coverage ratio required by the loan agreements, were as follows:</p>` +
             noteTable(['Property revenue', 'Net operating income', 'Debt service', 'Coverage'], pr) +
             `<p>Physical occupancy at December 31, 2025 was ` + n.properties.map((p) => `${esc(p.name)} ${p.occupancy.toFixed(1)} percent`).join(', ') +
             `. The affiliated management company earned fees of ${money(n.managementFee.affiliateRevenue)} from the property entities, which are eliminated in consolidation, and ${money(n.managementFee.thirdPartyRevenue)} from third party owners, which is included in revenue.</p>`);
  }
  if (n.ffeReserve) {
    const noi = rel.totals.ebitda[0] - n.ffeReserve;
    add('I', `<p>The loan agreements require a furniture, fixtures and equipment reserve funded monthly. The reserve charged for the year was ${money(n.ffeReserve)} and net operating income after the reserve, the measure used for the debt yield test, was ${money(noi)}. Loan to value by property, measured against the most recent lender approved appraisals, was ` +
      n.ltv.map((l) => `${esc(l[0])} ${(l[1] / l[2] * 100).toFixed(1)} percent (first mortgage ${money(l[1])} against appraised value ${money(l[2])})`).join(', ') + '.</p>');
  }
  if (n.kpis.length) {
    add('I', `<p>Key operating measures at or for the year ended December 31, 2025:</p>` +
             noteTable([''], n.kpis.map((k) => ({ label: esc(k[0]), values: [k[1]], indent: 1 }))));
  }
  add('J', `<p>Management has evaluated subsequent events through ${usDate(rel.cpa.date)}, the date on which these financial statements were available to be issued, and has concluded that no events have occurred that require recognition or disclosure in the financial statements other than those disclosed in these notes.</p>`);
  return B;
}

/** Greedy packer. `heights` is the measured pixel height of each block. */
function packNotes(blocks, heights, budget = 750, headCost = 48) {
  const pages = []; let cur = [], used = 0, prevNote = null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const needsHeading = b.note !== prevNote;
    const cost = (needsHeading ? headCost : 0) + heights[i];
    if (cur.length && used + cost > budget) {
      pages.push(cur); cur = [];
      cur.push({ ...b, heading: needsHeading ? 'new' : 'cont' });
      used = headCost + heights[i];
    } else {
      cur.push({ ...b, heading: needsHeading ? 'new' : (cur.length === 0 ? 'cont' : null) });
      used += cost;
    }
    prevNote = b.note;
  }
  if (cur.length) pages.push(cur);
  return pages;
}

function notesHtml(rel, packed, startPage) {
  const cons = rel.consolidated.length > 0;
  const nhead = `<div class="sthead"><div class="e">${esc(rel.legalName.toUpperCase())}</div>` +
    `<div class="t">NOTES TO ${cons ? 'CONSOLIDATED ' : ''}FINANCIAL STATEMENTS</div>` +
    `<div class="t">December 31, 2025 and 2024</div></div>`;
  return packed.map((blocks, i) => {
    let body = '';
    for (const b of blocks) {
      if (b.heading === 'new') body += `<h3>${NOTE_TITLES[b.note]}</h3>`;
      else if (b.heading === 'cont') body += `<h3>${NOTE_TITLES[b.note]} (Continued)</h3>`;
      body += b.html;
    }
    return `<div class="page nt">${nhead}${body}` +
           `<div class="pagefoot"><div class="pnum">Page ${startPage + i}</div></div></div>`;
  }).join('');
}

function measuringHtml(rel) {
  const blocks = noteBlocks(rel);
  const body = `<div class="page nt" style="min-height:0">` +
    blocks.map((b, i) => `<div class="blk" data-i="${i}" style="display:flow-root">${b.html}</div>`).join('') +
    `</div>`;
  return { blocks, html: body };
}

const ARTICLE = (w) => (/^[AEIOU]/i.test(w) ? 'an' : 'a');

function compiled(rel, packedNotes) {
  const cons = rel.consolidated.length ? 'CONSOLIDATED ' : '';
  const eqTitle = 'STATEMENT OF CHANGES IN ' + rel.equityCaption.toUpperCase();
  const cover = `<div class="page"><div class="cover">` +
    `<div class="nm">${esc(rel.legalName.toUpperCase())}</div>` +
    `<div class="ti">COMPILED FINANCIAL STATEMENTS</div>` +
    `<div class="dt">DECEMBER 31, 2025</div></div></div>`;
  const toc = `<div class="page"><div class="sthead"><div class="e">${esc(rel.legalName.toUpperCase())}</div>` +
    `<div class="t">TABLE OF CONTENTS</div></div>` +
    `<table class="toc"><tr><td></td><td class="p"><b>Page</b></td></tr>` +
    `<tr><td>INDEPENDENT ACCOUNTANT'S COMPILATION REPORT</td><td class="p">1</td></tr>` +
    `<tr><td style="padding-top:12pt"><b>FINANCIAL STATEMENTS</b></td><td></td></tr>` +
    `<tr><td class="l2">${cons ? 'Consolidated ' : ''}Balance Sheet</td><td class="p">2</td></tr>` +
    `<tr><td class="l2">${cons ? 'Consolidated ' : ''}Statement of Income</td><td class="p">3</td></tr>` +
    `<tr><td class="l2">${cons ? 'Consolidated ' : ''}Statement of Changes in ${esc(rel.equityCaption)}</td><td class="p">4</td></tr>` +
    `<tr><td class="l2">${cons ? 'Consolidated ' : ''}Statement of Cash Flows</td><td class="p">5</td></tr>` +
    `<tr><td class="l2">Notes to Financial Statements</td><td class="p">6</td></tr></table></div>`;
  const hd = ['2025', '2024'];
  const st = (title, period, rows, pageNum, custom) =>
    `<div class="page">${stHead(rel, title, period)}` +
    (custom || table(rows, { headers: hd.map((h) => `<span>${h}</span>`) })) + stFoot(pageNum) + '</div>';
  const bs = st('BALANCE SHEET', 'December 31, 2025 and 2024', rel.statements.balance, 2);
  const is = st('STATEMENT OF INCOME', 'Years Ended December 31, 2025 and 2024', rel.statements.income, 3);
  const eqp = `<div class="page">${stHead(rel, eqTitle, 'Years Ended December 31, 2025 and 2024')}` +
              equityTable(rel) + stFoot(4) + '</div>';
  const cf = st('STATEMENT OF CASH FLOWS', 'Years Ended December 31, 2025 and 2024', rel.statements.cash, 5);
  let html = cover + toc + compilationReport(rel) + bs + is + eqp + cf +
             notesHtml(rel, packedNotes, 6);
  if (rel.entity === 'LP') {
    html = html.replace(/\bthe Company\b/g, 'the Partnership')
               .replace(/\bThe Company\b/g, 'The Partnership')
               .replace(/\bCompany's\b/g, "Partnership's");
  }
  return html;
}

/* ------------------------------------------------------------ reconciliation */
function fmtCov(c, v) {
  if (c.unit === 'usd') return '$' + grp(R(v));
  if (c.unit === 'pct') return v.toFixed(1) + ' percent';
  if (c.unit === 'usd2') return '$' + v.toFixed(2);
  return v.toFixed(2) + 'x';
}
const FILES = (rel) => ([
  { kind: 'Excel workbook',
    name: `${rel.legalName} - Company Prepared Financial Statements FY2025.xlsx`,
    desc: 'Company prepared trial balance view. Two sheets, balance sheet and income statement, whole dollars and cents, FY2025 against FY2024 with an arithmetic change column.' },
  { kind: 'Company prepared PDF',
    name: `${rel.legalName} - Company Prepared Consolidated Financial Statements FY2025 (Unaudited).pdf`,
    desc: 'Four page unaudited management pack in thousands: cover, balance sheet, statement of operations, statement of cash flows.' },
  { kind: 'Compiled PDF',
    name: `${rel.legalName} - Compiled Financial Statements December 31, 2025.pdf`,
    desc: 'CPA compiled set in whole dollars with the compilation report, four statements and the notes, including the debt, collateral and covenant schedules.' },
]);

function reconciliationMd(rel) {
  const t = rel.totals;
  let s = `# ${rel.legalName}\n\n`;
  s += `How the three FY2025 files tie to the facts the bank already holds.\n\n`;
  s += `| | |\n|---|---|\n`;
  s += `| Borrower of record | ${rel.legalName} |\n`;
  s += `| Location | ${rel.city}, ${rel.state} |\n`;
  s += `| Industry (NAICS ${rel.naics}) | ${rel.industry} |\n`;
  s += `| Period | Years ended 31 December 2025 and 2024 |\n`;
  s += `| FY2025 revenue | $${grp(t.revenue[0])} |\n`;
  s += `| FY2025 EBITDA | $${grp(t.ebitda[0])} |\n`;
  s += `| Total booked debt at 31 December 2025 | $${grp(t.totalDebt[0])} |\n`;
  s += `| Total assets | $${grp(t.totalAssets[0])} |\n`;
  s += `| ${rel.equityCaption} | $${grp(t.equity[0])} |\n`;
  if (rel.consolidated.length) s += `| Consolidated subsidiaries | ${rel.consolidated.join('; ')} |\n`;
  s += `| Compilation report | ${rel.cpa.name}, ${rel.cpa.city}, ${rel.cpa.state}, ${longDate(rel.cpa.date)} |\n`;

  s += `\n## 1. Covenant values the bank already holds\n\n`;
  s += `Every row is the last evaluation value carried in the covenant record, next to the same figure computed from the FY2025 statements in this folder.\n\n`;
  s += `| Covenant | Requirement | nCino last evaluation | Computed from these statements | Agrees | Record status |\n`;
  s += `|---|---|---|---|---|---|\n`;
  for (const c of rel.covenants) {
    if (c.orgValue === null) continue;
    s += `| ${c.type} (${c.id}) | ${fmtCov(c, c.threshold)} | ${fmtCov(c, c.orgValue)} | ${fmtCov(c, c.computed)} | ${c.reconciles ? 'yes' : 'see note'} | ${c.status} |\n`;
  }
  s += `\n### How each is computed\n\n`;
  for (const c of rel.covenants) {
    if (c.orgValue === null) continue;
    s += `- **${c.type} (${c.id})**: ${c.formula.replace(/\n/g, ' ')}.\n`;
    if (c.basis) s += `  - Note: ${c.basis}\n`;
  }

  s += `\n## 2. Debt on the balance sheet against the booked loans\n\n`;
  s += `Balance sheet debt at 31 December 2025 is the sum of the booked principal balances, split between the current and long term portions by the amortisation implied by each facility's term and rate.\n\n`;
  s += `| Facility | Original | Rate | Maturity | Balance at 31 Dec 2025 |\n|---|---|---|---|---|\n`;
  for (const f of rel.notes.facilities) {
    s += `| ${f.product}${f.secured === 'Real Estate' ? ', real estate secured' : ''} | $${grp(f.original)} | ${f.rate.toFixed(2)}% | ${f.maturity ? usDate(f.maturity) : 'n/a'} | ${f.balance === null ? 'undrawn commitment' : '$' + grp(f.balance)} |\n`;
  }
  s += `| **Total** | | | | **$${grp(rel.notes.debtTotal)}** |\n\n`;
  s += `On the balance sheet this is carried as revolving lines of credit $${grp(rel.notes.revolverDrawn)}, current portion of long term debt $${grp(rel.notes.scheduledPrincipal)} and long term debt net of current portion $${grp(rel.notes.debtTotal - rel.notes.revolverDrawn - rel.notes.scheduledPrincipal)}. Note D of the compiled set lists every facility; Note F lists the pledged collateral at the lender's approved values.\n`;

  s += `\n## 3. How the three files tie to each other\n\n`;
  s += `The three files are the same set of numbers presented three ways.\n\n`;
  s += `- **The workbook** is the company prepared trial balance view in whole dollars and cents. Ledger accounts roll up to the same subtotals as the two PDFs; for example the cash accounts sum to $${grp(t.cash[0])} and gross receivables less the allowance give the receivable line on both statements.\n`;
  s += `- **The company prepared PDF** is the same balance sheet, statement of operations and statement of cash flows expressed in thousands. Each line is the workbook figure divided by one thousand and rounded, so a line may differ from the workbook by up to one in the last digit shown; subtotals are the sum of the rounded lines.\n`;
  s += `- **The compiled PDF** is the CPA formatted view in whole dollars, with the same four statements plus the statement of changes in ${rel.equityCaption.toLowerCase()} and the notes. Every figure agrees with the workbook to the dollar.\n\n`;
  s += `The statements tie internally: total assets of $${grp(t.totalAssets[0])} equal total liabilities and ${rel.equityCaption.toLowerCase()}; the net change in cash in the cash flow statement equals the movement in cash on the balance sheet; and the equity roll forward ties opening ${rel.equityCaption.toLowerCase()} plus net income less ${rel.distLabel.toLowerCase()} to the closing balance.\n`;
  return s;
}

function reconciliationHtml(rel, md) {
  const lines = md.split('\n');
  let html = '', inTable = false, headerDone = false;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  for (const ln of lines) {
    if (/^\|/.test(ln)) {
      const cells = ln.slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^-*:?-*$/.test(c))) { headerDone = true; continue; }
      if (!inTable) { html += '<table>'; inTable = true; }
      const tag = headerDone ? 'td' : 'th';
      html += '<tr>' + cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join('') + '</tr>';
      continue;
    }
    if (inTable) { html += '</table>'; inTable = false; headerDone = false; }
    if (/^### /.test(ln)) html += `<h3>${inline(ln.slice(4))}</h3>`;
    else if (/^## /.test(ln)) html += `<h2>${inline(ln.slice(3))}</h2>`;
    else if (/^# /.test(ln)) html += `<h1>${inline(ln.slice(2))}</h1>`;
    else if (/^ {2}- /.test(ln)) html += `<p class="sub">${inline(ln.slice(4))}</p>`;
    else if (/^- /.test(ln)) html += `<p class="li">${inline(ln.slice(2))}</p>`;
    else if (ln.trim()) html += `<p>${inline(ln)}</p>`;
  }
  if (inTable) html += '</table>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(rel.legalName)} reconciliation</title>${STYLE}
<style>
  .doc { max-width: 940px; margin: 0 auto; padding: 40px 20px 80px; }
  .doc h1 { font-size: 26px; letter-spacing: -.015em; margin: 0 0 6px; }
  .doc h2 { font-size: 17px; margin: 34px 0 10px; letter-spacing: -.008em; }
  .doc h3 { font-size: 14px; margin: 22px 0 8px; color: var(--ink-muted); }
  .doc p { margin: 0 0 9px; color: var(--ink-body); font-size: 14px; line-height: 1.55; }
  .doc p.li { padding-left: 16px; position: relative; }
  .doc p.li::before { content: ""; position: absolute; left: 3px; top: 9px; width: 4px; height: 4px;
                      border-radius: 50%; background: var(--accent-quiet); }
  .doc p.sub { padding-left: 32px; color: var(--ink-muted); font-size: 13px; }
  .doc table { width: 100%; border-collapse: collapse; margin: 12px 0 18px; font-size: 13px;
               background: var(--card); border: 1px solid var(--border); border-radius: 12px;
               overflow: hidden; }
  .doc th { text-align: left; font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
            color: var(--ink-label); font-weight: 600; padding: 9px 12px;
            border-bottom: 1px solid var(--border); background: var(--wash); }
  .doc td { padding: 8px 12px; border-bottom: 1px solid var(--row-divider); color: var(--ink-body);
            vertical-align: top; }
  .doc tr:last-child td { border-bottom: none; }
  .back { display: inline-block; margin-bottom: 18px; font-size: 13px; color: var(--accent);
          text-decoration: none; font-weight: 600; }
</style></head><body><div class="doc"><a class="back" href="../index.html">Back to all relationships</a>
${html}</div></body></html>`;
}

/* --------------------------------------------------------------- the caddy */
const STYLE = `<style>
  :root {
    --font-sans: Graphik, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, ui-sans-serif,
                 system-ui, sans-serif;
    --surface: #f5f5f7; --card: #ffffff; --wash: #f0f0f2; --border: #e8e8ed;
    --border-strong: #dcdce3; --row-divider: #ececf1;
    --ink: #1a1a1a; --ink-strong: #000000; --ink-body: #43444d; --ink-muted: #5b5c66;
    --ink-label: #80818d;
    --brand: #a100ff; --accent: #7500c0; --accent-quiet: #9a4fd1;
    --accent-tint: #f6efff; --accent-hairline: #e6dcff;
    --positive: #147a46; --positive-bg: #eef7f1;
    --warning: #b15c00; --warning-bg: #fdf4e7;
    --critical: #cc2e2e; --critical-bg: #fdefef;
    --neutral-fg: #5b5c66; --neutral-bg: #f0f0f2;
    --glass-hairline: rgba(0,0,0,.06);
    --shadow: 0 1px 2px rgba(0,0,0,.04), 0 8px 24px -12px rgba(0,0,0,.10);
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; font-family: var(--font-sans); color: var(--ink);
         background: radial-gradient(120% 70% at 50% -10%, #ffffff 0%, var(--surface) 58%)
                     no-repeat, var(--surface);
         background-attachment: fixed; overflow-x: hidden;
         -webkit-font-smoothing: antialiased; }
  a { color: inherit; }
</style>`;

function indexHtml(rels, sizes) {
  const money = (v) => v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : '$' + grp(R(v));
  const kb = (b) => b >= 1024 * 1024 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
  const statusTone = (rel) => {
    const s = rel.covenants.map((c) => c.status);
    if (s.includes('Waived')) return ['warn', 'Waiver on file'];
    if (s.includes('Exception')) return ['warn', 'Exception on file'];
    return ['ok', 'All covenants compliant'];
  };
  const cards = rels.map((rel) => {
    const [tone, toneText] = statusTone(rel);
    const files = FILES(rel).map((f) => {
      const href = `${rel.folder}/${encodeURIComponent(f.name)}`;
      const size = sizes[`${rel.folder}/${f.name}`] || 0;
      return `<li class="file">
        <div class="fmeta"><span class="fkind">${esc(f.kind)}</span><span class="fsize">${kb(size)}</span></div>
        <p class="fdesc">${esc(f.desc)}</p>
        <a class="dl" href="${href}" download>Download</a></li>`;
    }).join('');
    return `<article class="card">
      <header>
        <h2>${esc(rel.legalName)}</h2>
        <p class="loc">${esc(rel.city)}, ${esc(rel.stateAbbr)} &middot; ${esc(rel.industry)}</p>
      </header>
      <dl class="stats">
        <div><dt>FY2025 revenue</dt><dd>${money(rel.totals.revenue[0])}</dd></div>
        <div><dt>Booked debt</dt><dd>${money(rel.totals.totalDebt[0])}</dd></div>
        <div><dt>Facilities</dt><dd>${rel.notes.facilities.length}</dd></div>
      </dl>
      <p class="cov"><span class="dot ${tone}"></span>${esc(rel.headline.text)}</p>
      <p class="tone ${tone}">${esc(toneText)}</p>
      <ul class="files">${files}</ul>
      <a class="tie" href="${rel.folder}/reconciliation.html">How these tie to nCino</a>
    </article>`;
  }).join('');

  const totalFiles = rels.length * 3;
  const totalBytes = Object.values(sizes).reduce((a, b) => a + b, 0);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Client financial statement sets, FY2025</title>${STYLE}
<style>
  .wrap { max-width: 1180px; margin: 0 auto; padding: 48px 20px 90px; }
  header.top { margin-bottom: 34px; }
  header.top h1 { font-size: 30px; letter-spacing: -.02em; margin: 0 0 8px; font-weight: 600; }
  header.top p { margin: 0; color: var(--ink-muted); font-size: 14.5px; line-height: 1.6;
                 max-width: 74ch; }
  header.top .meta { margin-top: 14px; font-size: 12.5px; color: var(--ink-label);
                     letter-spacing: .01em; }
  .grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 18px;
          padding: 20px 20px 18px; box-shadow: var(--shadow); display: flex; flex-direction: column;
          min-width: 0; }
  .card h2 { font-size: 16.5px; margin: 0 0 4px; letter-spacing: -.01em; line-height: 1.3;
             overflow-wrap: anywhere; }
  .loc { margin: 0 0 16px; font-size: 12.5px; color: var(--ink-label); }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0 0 14px;
           padding: 12px; background: var(--wash); border-radius: 12px; }
  .stats div { min-width: 0; }
  .stats dt { font-size: 10px; letter-spacing: .05em; text-transform: uppercase;
              color: var(--ink-label); margin-bottom: 3px; }
  .stats dd { margin: 0; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums;
              color: var(--ink-strong); }
  .cov { margin: 0 0 4px; font-size: 13px; color: var(--ink-body); line-height: 1.45; }
  .dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; margin-right: 7px;
         vertical-align: middle; }
  .dot.ok { background: var(--positive); } .dot.warn { background: var(--warning); }
  .tone { margin: 0 0 14px; font-size: 11.5px; padding-left: 12px; font-weight: 600; }
  .tone.ok { color: var(--positive); } .tone.warn { color: var(--warning); }
  .files { list-style: none; margin: 0 0 14px; padding: 0; border-top: 1px solid var(--row-divider); }
  .file { padding: 11px 0; border-bottom: 1px solid var(--row-divider); }
  .fmeta { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .fkind { font-size: 12.5px; font-weight: 600; color: var(--ink-strong); }
  .fsize { font-size: 11px; color: var(--ink-label); font-variant-numeric: tabular-nums;
           white-space: nowrap; }
  .fdesc { margin: 4px 0 8px; font-size: 12px; color: var(--ink-muted); line-height: 1.5; }
  .dl { display: inline-block; font-size: 12px; font-weight: 600; color: var(--accent);
        text-decoration: none; border: 1px solid var(--accent-hairline); background: var(--accent-tint);
        border-radius: 999px; padding: 5px 13px; }
  .dl:hover { border-color: var(--accent); }
  .tie { margin-top: auto; font-size: 12.5px; font-weight: 600; color: var(--ink-strong);
         text-decoration: none; border-bottom: 1px solid var(--border-strong);
         align-self: flex-start; padding-bottom: 2px; }
  .tie:hover { border-color: var(--accent); color: var(--accent); }
  @media (max-width: 560px) {
    .wrap { padding: 32px 16px 64px; }
    header.top h1 { font-size: 24px; }
    .grid { grid-template-columns: 1fr; }
    .stats { grid-template-columns: 1fr 1fr; }
  }
</style></head><body><div class="wrap">
<header class="top">
  <h1>Client financial statement sets, FY2025</h1>
  <p>One folder per relationship. Each holds the three files a banker drops into the Spreading
  workroom: the company prepared workbook, the company prepared management pack and the CPA compiled
  set. Every figure reconciles to the facts already held in nCino, to the dollar where the book
  carries one, and every covenant last evaluation value is reproducible from the statements.</p>
  <p class="meta">${rels.length} relationships &middot; ${totalFiles} statement files &middot;
  ${kb(totalBytes)} total &middot; periods ended 31 December 2025 and 2024</p>
</header>
<div class="grid">${cards}</div>
</div></body></html>`;
}

/* -------------------------------------------------------------------- main */
function render(templateFile, title, body) {
  return readFileSync(join(DIR, 'templates', templateFile), 'utf8')
    .replace('__TITLE__', esc(title)).replace('<!--BODY-->', body);
}

async function main() {
  const t0 = Date.now();
  mkdirSync(WORK, { recursive: true });
  const env = { ...process.env, STMT_WORK: WORK, PUPPETEER_CACHE_DIR: '/home/fabian/.cache/puppeteer' };
  log('[1/6] deriving the model from org-facts/');
  execFileSync('python3', [join(DIR, 'model', 'loans.py')], { env, stdio: 'pipe' });
  const emitOut = execFileSync('python3', [join(DIR, 'model', 'emit.py')], { env }).toString();
  log(emitOut.trim().split('\n').slice(-2).join('\n'));

  const facts = JSON.parse(readFileSync(join(DIR, 'facts.json'), 'utf8'));
  const rels = facts.relationships;
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  log('[2/6] rendering PDFs with Puppeteer');
  const puppeteer = (await import(join(PUPPETEER, 'lib/esm/puppeteer/puppeteer.js'))).default;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/home/fabian/.cache/puppeteer/chrome/linux-151.0.7922.47/chrome-linux64/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.emulateMediaType('print');
  await page.setViewport({ width: 624, height: 898, deviceScaleFactor: 1 });
  for (const rel of rels) {
    const d = join(OUT, rel.folder); mkdirSync(d, { recursive: true });
    const meas = measuringHtml(rel);
    const mtmp = join(WORK, `${rel.folder}-measure.html`);
    writeFileSync(mtmp, render('compiled.html', 'measure', meas.html));
    await page.goto('file://' + mtmp, { waitUntil: 'load' });
    const heights = await page.evaluate(() =>
      [...document.querySelectorAll('.blk')].map((e) => Math.ceil(e.getBoundingClientRect().height)));
    const packed = packNotes(meas.blocks, heights);
    const jobs = [
      ['company-prepared.html', companyPrepared(rel),
       `${rel.legalName} - Company Prepared Consolidated Financial Statements FY2025 (Unaudited).pdf`],
      ['compiled.html', compiled(rel, packed),
       `${rel.legalName} - Compiled Financial Statements December 31, 2025.pdf`],
    ];
    for (const [tpl, body, outName] of jobs) {
      const html = render(tpl, outName.replace(/\.pdf$/, ''), body);
      const tmp = join(WORK, `${rel.folder}-${tpl}`);
      writeFileSync(tmp, html);
      await page.goto('file://' + tmp, { waitUntil: 'load' });
      await page.pdf({ path: join(d, outName), format: 'Letter', printBackground: true,
                       preferCSSPageSize: true });
    }
    log(`  ${rel.folder} pdfs done (${packed.length} note pages, ${7 + packed.length} total)`);
  }
  await browser.close();

  log('[3/6] writing workbooks with openpyxl');
  log(execFileSync('python3', [join(DIR, 'xlsx_writer.py'), join(DIR, 'facts.json'), OUT],
                   { env }).toString().trim());

  log('[4/6] writing reconciliation.md and reconciliation.html');
  for (const rel of rels) {
    const md = reconciliationMd(rel);
    writeFileSync(join(OUT, rel.folder, 'reconciliation.md'), md);
    writeFileSync(join(OUT, rel.folder, 'reconciliation.html'), reconciliationHtml(rel, md));
  }

  log('[5/6] writing the caddy index.html');
  const sizes = {};
  for (const rel of rels) for (const f of FILES(rel)) {
    sizes[`${rel.folder}/${f.name}`] = statSync(join(OUT, rel.folder, f.name)).size;
  }
  writeFileSync(join(OUT, 'index.html'), indexHtml(rels, sizes));

  log('[6/6] quality gate');
  const fails = [];
  for (const rel of rels) {
    for (const f of FILES(rel)) {
      const p = join(OUT, rel.folder, f.name);
      const size = statSync(p).size;
      if (f.kind === 'Excel workbook') { if (size < 8000) fails.push(`${p}: xlsx too small`); continue; }
      const info = execFileSync('pdfinfo', [p]).toString();
      const pages = +/Pages:\s+(\d+)/.exec(info)[1];
      const want = f.kind === 'Company prepared PDF' ? [4, 4] : [11, 14];
      if (pages < want[0] || pages > want[1]) fails.push(`${p}: ${pages} pages, expected ${want.join('-')}`);
      if (size < 20000) fails.push(`${p}: only ${size} bytes`);
      const txt = execFileSync('pdftotext', ['-layout', p, '-']).toString();
      for (const needle of [rel.legalName, 'December 31, 2025']) {
        if (!txt.includes(needle)) fails.push(`${p}: missing "${needle}"`);
      }
      const ta = grp(rel.totals.totalAssets[0]);
      const taK = grp(R(rel.totals.totalAssets[0] / 1000));
      if (!txt.includes(ta) && !txt.includes(taK)) fails.push(`${p}: total assets ${ta} not found`);
      if (txt.includes('—')) fails.push(`${p}: contains an em dash`);
    }
    for (const n of ['reconciliation.md', 'reconciliation.html']) {
      const s = readFileSync(join(OUT, rel.folder, n), 'utf8');
      if (s.includes('—')) fails.push(`${rel.folder}/${n}: contains an em dash`);
    }
  }
  if (readFileSync(join(OUT, 'index.html'), 'utf8').includes('—')) fails.push('index.html: em dash');
  if (fails.length) { console.error('QUALITY GATE FAILED:'); fails.forEach((f) => console.error('  ' + f)); process.exit(1); }
  log(execFileSync('python3', [join(DIR, 'verify.py')], { env }).toString().trim());
  log(`quality gate passed: ${rels.length} relationships, ${rels.length * 3} files, ` +
      `${Object.values(sizes).reduce((a, b) => a + b, 0).toLocaleString()} bytes`);
  log(`output: ${OUT}`);
  log(`built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
