/* =============================================================================
   THE PROSE THE MEMO EXPECTS, AND THE RULES IT IS WRITTEN UNDER.

   THE RENDERER IS DETERMINISTIC AND THE NARRATIVE IS NOT. Every table, every
   figure, every chip in the memo is arithmetic over the dossier: the renderer
   produces the whole document instantly and it would produce it with no model
   in the room at all. What it CANNOT produce is the prose the manifest expects
   in each module, which is why `narr(key, fallback)` exists and why a memo with
   no narratives renders the plugin's own placeholder line in every one of those
   slots.

   SO THE BRAIN WRITES AROUND THE FIGURES, NEVER THE FIGURES. The prompt below
   carries a FIGURES block built from the dossier and one rule about it: use
   these, never compute another. A model that cannot find a number it wants is
   told to say the memo does not carry it, which is the same gap rule the
   renderer follows in its cells (`references/conditionality.md`).

   THE VOICE IS THE PLUGIN'S OWN (`references/memo-sections.md`, the style rules
   at the head of the file): active voice, specific quantities, no marketing
   language, no exclamation points, no hedging, lead with the conclusion. It is
   inlined here rather than imported from the vendored markdown because a
   prompt is code and a reference is documentation; the sentence below is the
   one the model actually reads, so it belongs where a reviewer will find it.
   ============================================================================= */

import type { MemoDossier, MemoNarratives } from "./types";
import { NOT_IN_SOURCE } from "./types";

/* -----------------------------------------------------------------------------
   WHICH MODULES CARRY PROSE
   ----------------------------------------------------------------------------- */

/** One module's narrative work: the keys it fills and what each one is for. */
export interface NarrativeSpec {
  /** Manifest module id. The same id `sectionsFrom()` anchors on. */
  module: string;
  /** The `narr()` keys this module reads, in the order they appear in it. */
  keys: string[];
  /** What the model is asked for, one topic per key, in the same order. */
  topics: string[];
}

/**
 * EVERY `narr()` CALL IN THE VENDORED RENDERER, grouped by the module it sits
 * in. Read off `renderMemo.vendor.mjs` on 2026-09-04; a key that stops being
 * read simply stops being filled, and the memo renders its placeholder.
 */
export const NARRATIVE_SPECS: readonly NarrativeSpec[] = [
  {
    module: "executive_summary",
    keys: ["execSummary"],
    topics: [
      "The recommendation, the proposed risk rating and how it moves against the rating on file; then the headline metrics; then covenant compliance; then the two or three risks that matter with their mitigants. Four short paragraphs, 250 to 350 words, each leading with its conclusion.",
    ],
  },
  {
    module: "request_details",
    keys: ["requestDetails"],
    topics: [
      "What is being asked for and what the proceeds do. Name each facility, what changed on it, and why the structure fits the use. Two short paragraphs.",
    ],
  },
  {
    module: "borrower_description",
    keys: ["borrowerDescription"],
    topics: [
      "What the borrower does, its markets and its customers, and how long the bank has known it. One paragraph.",
    ],
  },
  {
    module: "industry_analysis",
    keys: ["industryChanges"],
    topics: [
      "What has changed in this industry since the last memo and what it does to this borrower specifically. One paragraph.",
    ],
  },
  {
    module: "management_ownership",
    keys: ["managementOwnership"],
    topics: ["Who runs the company, who owns it, and what depth sits behind the principal. One paragraph."],
  },
  {
    module: "financial_commentary",
    keys: ["financialCommentary", "spreadingReadDollars", "spreadingReadMargin", "globalCashFlow", "financialFutureOutlook"],
    topics: [
      "How the borrower performed over the spread periods and what drove it. One paragraph.",
      "What the dollar trend in the spread shows. Two sentences.",
      "What the margin trend shows. Two sentences.",
      "Global cash flow: how operating cash flow and guarantor support cover fixed charges, and where the coverage is thin. One paragraph.",
      "What the next twelve months look like on these figures, and what would change the read. One paragraph.",
    ],
  },
  {
    module: "covenant_conditions",
    keys: ["covenantConditions", "conditionsMonitoring"],
    topics: [
      "The covenant package: what is tested, where the cushion sits, and which test is the binding one. One paragraph.",
      "How compliance is monitored and reported, and what happens on a miss. Two sentences.",
    ],
  },
  {
    module: "collateral",
    keys: ["collateralBlanket", "collateralEquipment", "collateralRealEstate"],
    topics: [
      "The blanket lien position and what it actually covers. Two sentences.",
      "The equipment collateral, its valuation basis and its advance rate. Two sentences.",
      "The real estate collateral, its valuation basis and its lien position. Two sentences.",
    ],
  },
  {
    module: "guarantor_profile",
    keys: ["guarantorProfile"],
    topics: [
      "The guarantor, the strength behind the guaranty and what the bank has on file to support it. One paragraph.",
    ],
  },
  {
    module: "risk_rating_internal",
    keys: ["riskRatingRationale"],
    topics: [
      "Why the proposed rating is the right one: the factors that carry it, and the factor that would move it. One paragraph.",
    ],
  },
  {
    module: "risk_mitigants",
    keys: ["riskMitigantsNarrative"],
    topics: ["The residual risk once the mitigants are applied, in the bank's own terms. One paragraph."],
  },
  {
    module: "forward_looking_recommendation",
    keys: ["recommendation"],
    topics: [
      "The recommendation, the conditions it is subject to, and what the bank watches next. One paragraph, leading with the recommendation.",
    ],
  },
];

/** The narrative work for one module, or undefined where a module carries none. */
export const specFor = (module: string): NarrativeSpec | undefined =>
  NARRATIVE_SPECS.find((s) => s.module === module);

/* -----------------------------------------------------------------------------
   THE DOCTRINE
   ----------------------------------------------------------------------------- */

/** The voice, in the plugin's own style rules, plus the two rules the cockpit
 *  adds: trace every figure, and surface a gap rather than filling it. */
const MEMO_DOCTRINE = [
  "You are drafting one section of a commercial credit memo for a bank credit committee.",
  "Voice: active, specific, sober. No marketing language, no exclamation points, no emoji, no hedging.",
  "Lead every paragraph with its conclusion. Plain prose only: no headings, no bullet characters, no markdown.",
  "EVERY FIGURE YOU USE MUST APPEAR VERBATIM IN THE FIGURES BLOCK BELOW. Never compute, round or estimate a number.",
  `Where the memo does not carry a figure you want, write that the memo does not carry it, in one clause, and move on. The memo's own marker for that is "${NOT_IN_SOURCE}".`,
  "The memo is a DRAFT until a credit officer attests it. Never write as though it has been approved.",
].join(" ");

/* -----------------------------------------------------------------------------
   THE FIGURES THE MODEL IS ALLOWED TO USE
   ----------------------------------------------------------------------------- */

const money = (n: unknown): string | null =>
  typeof n === "number" && Number.isFinite(n) ? `$${(n / 1_000_000).toFixed(1)}MM` : null;

/**
 * THE DOSSIER, AS A FIGURES BLOCK.
 *
 * Deterministic, and deliberately narrow: the borrower, the facility table, the
 * exposure sides, the ratios and the covenant actuals. It is the same data the
 * renderer put in the memo's own tables, which is why prose written against it
 * can never disagree with the document it sits inside.
 */
function figuresBlock(dossier: MemoDossier): string {
  const c = dossier.canon;
  const lines: string[] = [];
  lines.push(
    [
      `Borrower: ${c.borrower.name}`,
      c.borrower.currentRiskRating ? `risk rating on file ${c.borrower.currentRiskRating}` : null,
      c.borrower.naics ? `NAICS ${c.borrower.naics}` : null,
    ]
      .filter(Boolean)
      .join(", ") + ".",
  );
  lines.push(`Credit action: ${c.creditAction.productPackageName}, event ${c.creditAction.creditEvent}, tier ${c.creditAction.tier}.`);

  for (const l of c.loans) {
    lines.push(
      [
        `Facility ${l.name}`,
        l.purpose ? `purpose ${l.purpose}` : null,
        money(l.existing.commitment) ? `existing commitment ${money(l.existing.commitment)}` : null,
        money(l.proposed.commitment) ? `proposed commitment ${money(l.proposed.commitment)}` : null,
        money(l.proposed.outstanding) ? `outstanding ${money(l.proposed.outstanding)}` : null,
        l.proposed.maturity ? `matures ${l.proposed.maturity}` : null,
        l.riskRating ? `risk rating ${l.riskRating}` : null,
        l.isNewMoney ? "new money" : null,
      ]
        .filter(Boolean)
        .join(", ") + ".",
    );
  }

  const ex = c.exposureSummary;
  lines.push(
    `Exposure: existing commitment ${money(ex.existing.commitment) ?? NOT_IN_SOURCE}, proposed commitment ${
      money(ex.proposed.commitment) ?? NOT_IN_SOURCE
    }, change ${money(ex.changeInExposure.commitment) ?? NOT_IN_SOURCE}. ${ex.changeInExposure.note}`,
  );

  const r = c.ratios;
  if (r) {
    lines.push(
      [
        "Ratios:",
        money(r.revenue) ? `revenue ${money(r.revenue)}` : null,
        r.revenueYoYPct != null ? `revenue YoY ${r.revenueYoYPct.toFixed(1)}%` : null,
        money(r.ebitda) ? `EBITDA ${money(r.ebitda)}` : null,
        r.ebitdaMarginPct != null ? `EBITDA margin ${r.ebitdaMarginPct.toFixed(1)}%` : null,
        r.totalLeverage != null ? `total leverage ${r.totalLeverage.toFixed(2)}x` : null,
        r.interestCoverage != null ? `interest coverage ${r.interestCoverage.toFixed(2)}x` : null,
        r.asOf ? `as of ${r.asOf}` : null,
      ]
        .filter(Boolean)
        .join(", ") + ".",
    );
  }

  for (const cov of dossier.ic.covenantCompliance ?? []) {
    lines.push(
      [
        `Covenant ${cov.name}`,
        cov.operator && cov.trigger != null ? `trigger ${cov.operator} ${cov.trigger}` : null,
        cov.actual != null ? `actual ${cov.actual}` : null,
        cov.currentFlag ? `flag ${cov.currentFlag}` : null,
      ]
        .filter(Boolean)
        .join(", ") + ".",
    );
  }

  for (const col of c.collateral ?? []) {
    lines.push(
      [
        `Collateral ${col.description ?? col.loan ?? "record"}`,
        money(col.value) ? `value ${money(col.value)}` : null,
        col.lienPosition ? `lien ${col.lienPosition}` : null,
      ]
        .filter(Boolean)
        .join(", ") + ".",
    );
  }

  if (c.guarantor) lines.push(`Guarantor: ${c.guarantor.name}, ${c.guarantor.type}, ${c.guarantor.guarantyType ?? NOT_IN_SOURCE}.`);

  if (dossier.peers.peers?.medians) {
    const m = dossier.peers.peers.medians;
    lines.push(`Peer medians (stub source): ${Object.entries(m).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  }

  return lines.join("\n");
}

/* -----------------------------------------------------------------------------
   THE PROMPT
   ----------------------------------------------------------------------------- */

/** The paragraph separator the reply is split on. Blank line, nothing exotic:
 *  a model that ignores a rare sentinel still writes paragraphs. */
const SPLIT = /\n\s*\n/;

/**
 * Ask for one module's prose.
 *
 * `steer` is the banker's own line where they asked for a section again
 * ("tighten the covenant paragraph", "mention the Kokomo appraisal"). It rides
 * at the end so it outranks the topic list without replacing the doctrine.
 */
export function narrativePrompt(args: {
  spec: NarrativeSpec;
  dossier: MemoDossier;
  sectionTitle: string;
  steer?: string | null;
  /** What has already been written elsewhere in the memo, so sections do not
   *  restate each other. Keyed as `narr()` reads them. */
  written?: MemoNarratives;
}): string {
  const { spec, dossier, sectionTitle, steer } = args;
  const topics = spec.topics.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const already = Object.entries(args.written ?? {})
    .filter(([, v]) => typeof v === "string" && v.trim())
    .map(([k, v]) => `${k}: ${String(v).slice(0, 400)}`)
    .join("\n");
  return [
    MEMO_DOCTRINE,
    `\nSection: ${sectionTitle}.`,
    `\nWrite ${spec.keys.length} paragraph${spec.keys.length === 1 ? "" : "s"}, separated by a blank line, one for each topic below, in this order. Write nothing else: no titles, no numbering, no preamble.`,
    `\n${topics}`,
    `\nFIGURES (the memo's own; use these and no others):\n${figuresBlock(dossier)}`,
    already ? `\nAlready written elsewhere in this memo, do not restate it:\n${already}` : "",
    steer ? `\nThe banker asked for this specifically: ${steer}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * SPLIT ONE REPLY ACROSS ITS MODULE'S KEYS.
 *
 * Fewer paragraphs than keys leaves the remaining keys UNFILLED, and the memo
 * renders the plugin's own placeholder in them: a section the model half wrote
 * says so on the glass rather than borrowing the paragraph above it. More
 * paragraphs than keys fold into the last key, because the extra prose belongs
 * to the last topic asked for.
 */
export function narrativesFromReply(spec: NarrativeSpec, reply: string): MemoNarratives {
  const paras = reply
    .split(SPLIT)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: MemoNarratives = {};
  spec.keys.forEach((key, i) => {
    if (i >= paras.length) return;
    out[key] = i === spec.keys.length - 1 ? paras.slice(i).join("\n\n") : paras[i];
  });
  return out;
}
