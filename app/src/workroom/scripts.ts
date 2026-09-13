import { COMMITTED_MM } from "./fixture";
import type { DraftedReply, HaveRow, WorkroomDelta, WorkroomDoor, WorkroomMode, WorkroomRefusal } from "./types";

/* =============================================================================
   THE THREE STORYLINES.

   A script is DATA, not behaviour: the ScriptedEngine reads it, the shell never
   does. When the real engines land they answer the same questions — what did
   the banker just ask for, what deltas does that become, which check does the
   confirm trip — from a parse and a validation instead of from this file, and
   the shell does not change.

   `modify` is the blessed mock's storyline verbatim, down to the sentences.
   `renew` and `create` are its shape carried onto the other two doors, on the
   same Hartwell figures.
   ============================================================================= */

/** A source the agent read, shown as an icon chip and opened as a peek. Used,
 *  not displayed: the client email is a chip, never a wall of quoted text. */
export interface SourceChip {
  id: string;
  label: string;
  kicker: string;
  icon: "email" | "package" | "collateral" | "covenants" | "calendar" | "account";
  /** Keys into fixture.HAVE. Scripted engines only. */
  rows?: string[];
  /** The rows themselves, where the engine read them from the org rather than
   *  addressing a fixture. Wins over `rows` when both are present. */
  have?: HaveRow[];
  /** The client's own words, with the parsed spans highlighted. */
  email?: true;
}

/** One row of "Why this position". */
export interface WhyRow {
  label: string;
  detail: string;
}

/** One move in the storyline: what the banker says, and what it becomes. */
export interface WorkroomBeat {
  /** The suggested utterance, offered as a pill. */
  pill: string;
  /** What saying it puts in the composer. */
  say: string;
  /** Substrings that make a TYPED line count as this move. Storyline rails, not
   *  a parser — the real engine replaces this with the parse. */
  keys: string[];
  /** The agent's reply before the chips arrive. */
  reply: string;
  /** Delta ids this beat proposes. */
  deltas?: string[];
  /** The refusal id this beat earns instead. */
  refusal?: string;
}

export interface WorkroomScript {
  mode: WorkroomMode;
  /** The name in the package strip. */
  packageName: string;
  /** Where the room starts: committed millions and member count. Every figure
   *  the manifest walks forward or back is derived from these. */
  baselineCommittedMM: number;
  baselineMembers: number;
  /** True when the package strip has members to draw. The account door of
   *  create has none, which is the point of that door. */
  showsMembers: boolean;
  /** The covenant figure in the strip, e.g. "6/6". */
  covenantFigure: string;
  /** The boot lines, in order. The last one is always the ready line. */
  loadSteps: string[];
  /** The pin on the position. */
  askPin: string;
  /** THE ONE SENTENCE IN THE ROOM (law 3). Keep it short enough that the entry
   *  scene stays under sixty visible words. */
  position: string;
  sources: SourceChip[];
  why: WhyRow[];
  whyCaveat: string;
  beats: WorkroomBeat[];
  /** What the Compose step counts up to. */
  composeTarget: number;
  deltas: Record<string, WorkroomDelta>;
  refusals: Record<string, WorkroomRefusal>;
  reply: DraftedReply;
  /** RENEW ONLY. Said at the moment of filing, because a renewal is handed into
   *  the bank's approval process and never booked from here. */
  handoff?: string;
  /** The answer to a line the storyline cannot take. */
  offScript: string;
}

/** The recommendation caveat, identical everywhere: the agent recommends, the
 *  banker decides (SR 26-2). */
const RECOMMENDATION_ONLY =
  "Recommendation only. Nothing is written. The banker decides, and the approval that follows is the banker's own. SR 26-2 framing: the agent recommends, the banker decides.";

const OFF_SCRIPT =
  "This shell runs one storyline per mode against real Hartwell figures, so I can only take the next move here. In the wired workroom this line goes to the parser and comes back as chips, or as an honest refusal. The suggestion below keeps us moving.";

/* ------------------------------------------------------------------ modify */

const MODIFY_DELTAS: Record<string, WorkroomDelta> = {
  amount: {
    id: "amount",
    group: "terms",
    kind: "Term change",
    badge: "Commitment raised to $18.0MM",
    title: "Commitment amount",
    target: "HW1001 · Revolving line of credit",
    before: "$15,000,000",
    after: "$18,000,000",
    member: "HW1001",
    committedDeltaMM: 3,
    map: [
      ["Object", "Loan, proposed revision"],
      ["Record", "Clone of a4Zbb0000027MaYEAU"],
      ["Written as", "Amount 18,000,000 on the clone. The booked facility is untouched until the plan books."],
    ],
    fields: [
      "LLC_BI__Loan__c.LLC_BI__Amount__c = 18000000",
      "LLC_BI__Loan__c.LLC_BI__lookupKey__c = HW1001 (carried on the clone)",
      "LLC_BI__LoanRenewal__c (chain junction, revision number and prior stage)",
    ],
    challenge: {
      id: "coverage",
      verdict: "No shortfall",
      tone: "ok",
      kicker: "Coverage pro forma · live 09:06",
      line: "The increase raises the ceiling, not availability. Base coverage of outstanding stays at 1.30x, and advances remain capped by the monthly borrowing base certificate, so the $18,000,000 face never funds ahead of the base.",
      rows: [
        ["Eligible receivables $12,000,000 at 80%", "$9,600,000"],
        ["Eligible inventory $8,000,000 at 50%", "$4,000,000"],
        ["Borrowing base, gross", "$13,600,000", "sum"],
        ["Less receivables pledged to HW1006", "($1,600,000)"],
        ["Base available to HW1001", "$12,000,000", "sum"],
        ["Outstanding today", "$9,200,000"],
        ["Base coverage of outstanding", "1.30x", "key"],
        ["Commitment after the increase", "$18,000,000"],
        ["Base coverage of commitment, was 0.80x", "0.67x", "key"],
      ],
      say: "The base certificate on HW1001, junction a4Vbb000000pNIjEAM, caps advances at 80% of eligible receivables and 50% of eligible inventory. The receivable build the client describes is what lifts availability, and the base formula picks it up automatically. Unencumbered lendable value in the pool is $3,000,000, all of it the Mazak tooling, which the new equipment facility takes.",
    },
    filed: {
      recordId: "a4Zbb0000027NpMEAU",
      verification: "Re-queried a4Zbb0000027NpMEAU · LLC_BI__Amount__c = 18000000 · Stage = Proposed",
    },
  },
  covenant: {
    id: "covenant",
    group: "covenants",
    kind: "New covenant",
    kindTone: "new",
    badge: "Minimum Liquidity added",
    title: "Minimum Liquidity",
    target: "HW1001 · Revolving line of credit",
    before: "No facility level test",
    after: "≥ $6,000,000, quarterly",
    member: "HW1001",
    map: [
      ["Object", "Covenant plus loan covenant junction"],
      ["Record", "New covenant on Hartwell Precision Manufacturing LLC"],
      ["Written as", "Operator ≥, threshold 6,000,000, next evaluation 2026-09-30, junctioned to the proposed revision."],
    ],
    fields: [
      "LLC_BI__Covenant2__c.Acnpex_Operator__c = >=",
      "LLC_BI__Covenant2__c.Acnpex_Threshold_Value__c = 6000000",
      "LLC_BI__Covenant2__c.Acnpex_Statement_Frequency__c = Not Annual",
      "LLC_BI__Covenant2__c.LLC_BI__Next_Evaluation_Date__c = 2026-09-30",
      "LLC_BI__Loan_Covenant__c (junction to the proposed revision of HW1001)",
    ],
    caveat:
      "Frequency writes as Not Annual. The Financial Ratio record type offers a restricted picklist of Annual and Not Annual only, so the quarterly cadence is carried by the evaluation dates, exactly as the five existing quarterly covenants on this relationship do.",
    challenge: {
      id: "cushion",
      verdict: "Cushion thins",
      tone: "warn",
      kicker: "Fixed charge cushion · live 09:06",
      line: "The thinnest covenant in the package gets thinner, and on today's figures it still clears the September test. Cushion is 7 bps at the 30 June test. Re-test fixed charge coverage against the equipment amortisation schedule before first draw.",
      rows: [
        ["Fixed charge coverage floor", "1.15x"],
        ["Actual at 2026-06-30", "1.22x"],
        ["Cushion", "7 bps", "key"],
        ["Debt service coverage floor", "1.25x"],
        ["Debt service coverage actual", "1.38x"],
        ["Cushion", "13 bps"],
        ["Next evaluation", "2026-09-30", "sum"],
      ],
      say: "The revolver increase adds no scheduled amortisation. Interest follows drawn balances at SOFR+275, 7.60% today, so the $3,000,000 only reaches the fixed charge denominator to the extent it is drawn. The $2,000,000 equipment facility is different: scheduled principal and interest enter the denominator from first draw and land in the 2026-09-30 test. Covenant a3Bbb000000S0ZlEAK carries its evaluation history in its own fields; this relationship has no compliance rows by design.",
    },
    filed: {
      recordId: "a3Bbb000000S1FhEAK",
      verification: "Re-queried a3Bbb000000S1FhEAK · threshold 6000000, operator >= · junction a4Vbb000000pNQzEAM active",
    },
  },
  facility: {
    id: "facility",
    group: "structure",
    kind: "New facility",
    kindTone: "new",
    badge: "Equipment facility added",
    title: "Equipment facility",
    target: "New member of the package",
    before: "7 members",
    after: "8 members, $2,000,000 added",
    newMember: true,
    committedDeltaMM: 2,
    map: [
      ["Object", "Loan"],
      ["Record", "New member of a5Fbb000000IHFJEA4"],
      [
        "Written as",
        "Amount 2,000,000, product Equipment, borrower and guarantor structure copied from HW1002, staged at Proposed.",
      ],
    ],
    fields: [
      "LLC_BI__Loan__c.LLC_BI__Amount__c = 2000000",
      "LLC_BI__Loan__c.LLC_BI__Product_Package__c = a5Fbb000000IHFJEA4",
      "LLC_BI__Legal_Entities__c (borrower, guarantor and limited guarantor rows)",
    ],
    filed: {
      recordId: "a4Zbb0000027NrQEAU",
      verification:
        "Re-queried a4Zbb0000027NrQEAU · Amount 2000000 · package a5Fbb000000IHFJEA4 · 3 entity involvement rows",
    },
  },
  pledge: {
    id: "pledge",
    group: "security",
    kind: "Collateral pledged",
    kindTone: "collateral",
    badge: "Mazak tooling pledged",
    title: "Mazak tooling",
    target: "Pledged to the new equipment facility",
    before: "Appraised, unpledged",
    after: "$2,000,000 pledged, 1st position",
    map: [
      ["Object", "Collateral plus the pledge junction"],
      ["Record", "New collateral and one Collateral Pledged row"],
      [
        "Written as",
        "$4,000,000 appraised, 75% advance rate, $3,000,000 lendable, $2,000,000 pledged, first position lien.",
      ],
    ],
    fields: [
      "LLC_BI__Collateral__c.LLC_BI__Value__c = 4000000",
      "LLC_BI__Loan_Collateral2__c (label “Collateral Pledged”, the live junction)",
      "LLC_BI__Loan_Collateral2__c.LLC_BI__Advance_Rate_Override__c = 75",
      "LLC_BI__Loan_Collateral2__c.LLC_BI__Override_Reason__c (required, written)",
      "LLC_BI__Collateral_Valuation__c (appraisal, flagged Active and Primary)",
    ],
    caveat:
      "The advance rate is an override with a written reason. Every collateral type in this org defaults to 80%, and three of the seven existing Hartwell pledges already carry the same override for the same reason.",
    filed: {
      recordId: "a35bb0000013y5VAAQ",
      verification:
        "Re-queried a35bb0000013y5VAAQ · lendable 3,000,000 · pledge a4Rbb0000026snlEAA amount 2,000,000, override 75 with reason",
    },
  },
};

const MODIFY: WorkroomScript = {
  mode: "modify",
  packageName: "Hartwell Industrial C&I Credit Package",
  baselineCommittedMM: COMMITTED_MM,
  baselineMembers: 7,
  showsMembers: true,
  covenantFigure: "6/6",
  loadSteps: [
    "Reading the request",
    "Re-querying the package, 7 of 7 members",
    "Valuing collateral, 4 positions and 7 pledges",
    "Testing 6 covenants against the ask",
    "Composing a position",
    "Ready",
  ],
  askPin: "Ask $20.0MM",
  position: "Revolver to $18.0MM, plus a $2.0MM equipment facility on the Mazak tooling.",
  sources: [
    {
      id: "email",
      label: "Email",
      kicker: "Client request · James Hartwell · 2026-08-25 08:14",
      icon: "email",
      email: true,
    },
    { id: "package", label: "Package", kicker: "Product package a5Fbb000000IHFJEA4", icon: "package", rows: ["position", "revolver"] },
    { id: "collateral", label: "Collateral", kicker: "Collateral pool · re-queried 09:02", icon: "collateral", rows: ["collateral"] },
    { id: "covenants", label: "Covenants", kicker: "6 covenants · 2 loan junctions", icon: "covenants", rows: ["covenants"] },
  ],
  why: [
    {
      label: "Utilisation",
      detail:
        "The revolver is 61% drawn, $9,200,000 against a $15,000,000 commitment. Taking it to $20,000,000 would put utilisation at 46% and add $5,000,000 of revolving capacity the current borrowing base does not support. HW1001 · a4Zbb0000027MaYEAU · SOFR+275, 7.60%, matures 2027-03-15.",
    },
    {
      label: "Collateral headroom",
      detail:
        "The existing pool is $44,000,000 appraised and $31,600,000 lendable, pledged to the dollar across seven pledge rows. There is no unencumbered lendable value left in it. The Mazak tooling adds $4,000,000 appraised at a 75% advance rate, which is $3,000,000 lendable and unencumbered.",
    },
    {
      label: "Covenant cushion",
      detail:
        "Fixed charge coverage runs 1.22x against a 1.15x floor. That is a cushion of 7 bps and the thinnest number in the package. $5,000,000 of incremental revolver at SOFR+275 loads the fixed charge denominator faster than a $2,000,000 amortising facility sized to the asset that generates the ramp.",
    },
    {
      label: "Alternatives considered",
      detail:
        "Full $20.0MM with additional security needs new collateral or a guarantee enhancement to cover the incremental $5,000,000. The only unencumbered asset is the Mazak tooling at $3,000,000 lendable, which is $2,000,000 short, and Elena Hartwell's limited guarantee is capped at $5,000,000. Hold and revisit after the Q3 test defers the decision to 2026-09-30, and the client states the Mazak cells land in October.",
    },
  ],
  whyCaveat: RECOMMENDATION_ONLY,
  beats: [
    {
      pill: "Go with it, add a $6.0MM liquidity covenant",
      say: "Go with the recommendation, but add a minimum liquidity covenant at 6 million tested quarterly on the increase.",
      keys: ["recommend", "go with", "liquidity", "quarterly", "6 million", "$6", "6.0", "covenant", "proceed", "do it", "yes"],
      reply:
        "Understood. Two changes to the package. The revolver commitment moves from $15,000,000 to $18,000,000, and a facility level minimum liquidity test is added at $6,000,000, measured quarterly, alongside the $5,000,000 relationship test already in force. Reported liquidity was $6,800,000 at 2026-06-30, so the borrower clears the tighter test on today's figures. Neither change is written yet.",
      deltas: ["amount", "covenant"],
    },
    {
      pill: "Put the covenant on the construction loan too",
      say: "Set the covenant on the construction loan too.",
      keys: ["construction", "hw1003"],
      reply: "I cannot stage that one. The org will not accept it in this plan, and here is the reason.",
      refusal: "hw1003-covenant",
    },
    {
      pill: "Add the equipment facility, pledge the Mazak",
      say: "Fine. Add the two million equipment facility for the tooling and pledge the Mazak against it.",
      keys: ["equipment", "mazak", "tooling", "pledge", "facility", "2 million", "$2", "2.0"],
      reply:
        "Staged. The package gains an eighth member, an equipment facility at $2,000,000, and the Mazak tooling is pledged to it at $4,000,000 appraised and a 75% advance rate, which is $3,000,000 lendable against $2,000,000 pledged. The existing pool is untouched, so no member loses coverage.",
      deltas: ["facility", "pledge"],
    },
  ],
  composeTarget: 4,
  deltas: MODIFY_DELTAS,
  refusals: {
    "hw1003-covenant": {
      id: "hw1003-covenant",
      target: "HW1003 · Construction",
      title: "Minimum Liquidity on HW1003",
      reason:
        "HW1003 is not a member of this modification. A covenant junction is written against the proposed revision of a facility, and HW1001 is the only member with one in this plan. HW1003 stays Booked and unchanged.",
      detail:
        "To put the test on the construction facility, stage a separate modification on HW1003. It carries its own clone, its own plan and its own approval. HW1003 already holds the Kokomo completion covenant through junction a4Vbb000000pNKLEA2, one off, 61% complete at the June inspection.",
    },
  },
  reply: {
    subject: "Hartwell Industrial, operating line increase and equipment facility",
    lede: "Confirms $18.0MM, the $2.0MM equipment facility on the Mazak tooling and the $6.0MM quarterly liquidity test.",
    body: `James,

Thank you for the note on the Kokomo tooling. We have taken the request through credit and this is where we landed.

We are increasing the operating line from $15.0 million to $18.0 million rather than to $20.0 million. Advances stay governed by the borrowing base certificate, which is unchanged at 80 percent of eligible receivables and 50 percent of eligible inventory, so the higher commitment gives you room as the receivable build comes through without changing how availability is calculated.

Alongside the increase we are adding a $2.0 million equipment facility secured by the Mazak tooling, appraised at $4.0 million and advanced at 75 percent. Funding the tooling on an amortising facility rather than on the revolver keeps the line available for working capital through the ramp.

One new condition attaches to the increase: a minimum liquidity test of $6.0 million, measured quarterly. Your 30 June position of $6.8 million clears it. The existing $5.0 million relationship test is unchanged, and we will re-measure fixed charge coverage against the equipment amortisation schedule before the first draw.

The structure is approved. Documents are being prepared and booking follows on execution.

Regards,
Relationship Manager, Commercial Banking`,
  },
  offScript: OFF_SCRIPT,
};

/* ------------------------------------------------------------------- renew */

const RENEW_DELTAS: Record<string, WorkroomDelta> = {
  renewTerm: {
    id: "renewTerm",
    group: "terms",
    kind: "Renewal term",
    badge: "Maturity extended to 2027-06-30",
    title: "Maturity date",
    target: "HW1006 · Seasonal line of credit",
    before: "2026-06-30",
    after: "2027-06-30",
    member: "HW1006",
    map: [
      ["Object", "Loan, proposed revision"],
      ["Record", "Clone of a4Zbb0000027MttEAE"],
      ["Written as", "Maturity 2027-06-30 on the clone. The booked facility is untouched until the renewal is approved."],
    ],
    fields: [
      "LLC_BI__Loan__c.LLC_BI__Maturity_Date__c = 2027-06-30",
      "LLC_BI__Loan__c.LLC_BI__lookupKey__c = HW1006 (carried on the clone)",
      "LLC_BI__LoanRenewal__c (chain junction, revision number and prior stage)",
    ],
    filed: {
      recordId: "a4Zbb0000027NsWEAU",
      verification: "Re-queried a4Zbb0000027NsWEAU · LLC_BI__Maturity_Date__c = 2027-06-30 · Stage = Proposed",
    },
  },
  renewPricing: {
    id: "renewPricing",
    group: "terms",
    kind: "Term change",
    badge: "Spread moved to SOFR+325",
    title: "Interest spread",
    target: "HW1006 · Seasonal line of credit",
    before: "SOFR+300, 7.85%",
    after: "SOFR+325, 8.10%",
    member: "HW1006",
    map: [
      ["Object", "Loan revision plus the pricing stream"],
      ["Record", "Clone of a4Zbb0000027MttEAE, pricing stream a50bb00000sVlOXAA0"],
      ["Written as", "Index SOFR carried, spread 325 bps, all-in 8.10% at today's index."],
    ],
    fields: [
      "LLC_BI__Loan__c.LLC_BI__Interest_Rate__c = 8.10",
      "LLC_BI__Loan__c.LLC_BI__Index_Rate__c (SOFR, carried from the booked facility)",
      "LLC_BI__Pricing_Stream__c a50bb00000sVlOXAA0 (revision row on the clone)",
    ],
    challenge: {
      id: "grid",
      verdict: "In grid",
      tone: "ok",
      kicker: "Pricing grid · grade 5 · live 09:06",
      line: "SOFR+325 is the spread this package already prices grade 5 at. The seasonal line has been carrying SOFR+300 since it closed in June 2025, which is a grade 4 spread on a grade 5 facility. The renewal puts it back on the grid.",
      rows: [
        ["Risk grade on HW1006", "5"],
        ["Spread today", "SOFR+300"],
        ["Grade 5 spread on this package, HW1003", "SOFR+325", "key"],
        ["All-in today", "7.85%"],
        ["All-in on renewal", "8.10%", "key"],
        ["Outstanding at 2026-06-30", "$1,150,000"],
        ["Incremental interest at today's balance", "$2,875 a year", "sum"],
      ],
      say: "The grid comparison is against HW1003 on this same package: construction, grade 5, SOFR+325, closed 2024-11-01. Pricing stream a50bb00000sVlOXAA0 carries the seasonal line's own history. The incremental interest line is arithmetic on the current drawn balance and moves with the balance; it is not a forecast.",
    },
    filed: {
      recordId: "a50bb00000sVn2QAAS",
      verification: "Re-queried a50bb00000sVn2QAAS · spread 325 · linked to revision a4Zbb0000027NsWEAU",
    },
  },
  renewPledge: {
    id: "renewPledge",
    group: "security",
    kind: "Collateral carried",
    kindTone: "collateral",
    badge: "Receivables pledge carried",
    title: "Receivables pledge",
    target: "Carried to the renewed facility",
    before: "Pledged to booked HW1006",
    after: "$1,600,000 on the renewal, 1st position",
    map: [
      ["Object", "Collateral Pledged junction"],
      ["Record", "New Loan_Collateral2 row on the proposed revision"],
      ["Written as", "$1,600,000 pledged, first position, copied from the booked junction. The collateral record itself is untouched."],
    ],
    fields: [
      "LLC_BI__Loan_Collateral2__c (new junction to the proposed revision)",
      "LLC_BI__Loan_Collateral2__c.LLC_BI__Amount__c = 1600000",
      "LLC_BI__Loan_Collateral2__c.LLC_BI__Lien_Position__c = 1",
    ],
    filed: {
      recordId: "a4Rbb0000026sqTEAQ",
      verification: "Re-queried a4Rbb0000026sqTEAQ · amount 1,600,000 · lien position 1 · revision a4Zbb0000027NsWEAU",
    },
  },
  renewCovenant: {
    id: "renewCovenant",
    group: "covenants",
    kind: "Covenant carried",
    badge: "Fixed charge coverage carried",
    title: "Fixed charge coverage",
    target: "HW1006 · Seasonal line of credit",
    before: "Junctioned to booked HW1006",
    after: "Carried to the renewal, ≥ 1.15x",
    member: "HW1006",
    map: [
      ["Object", "Loan covenant junction"],
      ["Record", "New junction from covenant a3Bbb000000S0ZlEAK to the proposed revision"],
      ["Written as", "Operator ≥, threshold 1.15, next evaluation 2026-09-30. The covenant record is shared, not cloned."],
    ],
    fields: [
      "LLC_BI__Loan_Covenant__c (junction to the proposed revision of HW1006)",
      "LLC_BI__Covenant2__c a3Bbb000000S0ZlEAK (existing record, not modified)",
      "LLC_BI__Covenant2__c.LLC_BI__Next_Evaluation_Date__c = 2026-09-30 (unchanged)",
    ],
    caveat:
      "The covenant record is shared between the booked facility and its revision until the renewal books. A threshold change here would move the test on both, which is why the renewal carries the junction and leaves the covenant alone.",
    challenge: {
      id: "cushion-renewal",
      verdict: "Cushion thins",
      tone: "warn",
      kicker: "Fixed charge cushion · live 09:06",
      line: "The thinnest covenant in the package gets no easier at the higher spread, and on today's figures it still clears the September test. Cushion is 7 bps at the 30 June test. Re-test fixed charge coverage against the renewed spread before the renewal books.",
      rows: [
        ["Fixed charge coverage floor", "1.15x"],
        ["Actual at 2026-06-30", "1.22x"],
        ["Cushion", "7 bps", "key"],
        ["Incremental interest at today's balance", "$2,875 a year"],
        ["Debt service coverage floor", "1.25x"],
        ["Debt service coverage actual", "1.38x"],
        ["Next evaluation", "2026-09-30", "sum"],
      ],
      say: "The renewal adds no principal, so the denominator moves only by the 25 bps of spread on whatever is drawn. At the 30 June balance that is $2,875 a year against a fixed charge base measured in millions, which does not move the ratio at two decimal places. The line is here because a 7 bps cushion is thin enough that any addition to the denominator is worth stating rather than assuming.",
    },
    filed: {
      recordId: "a4Vbb000000pNTmEAM",
      verification: "Re-queried a4Vbb000000pNTmEAM · covenant a3Bbb000000S0ZlEAK · revision a4Zbb0000027NsWEAU · active",
    },
  },
};

const RENEW: WorkroomScript = {
  mode: "renew",
  packageName: "Hartwell Industrial C&I Credit Package",
  baselineCommittedMM: COMMITTED_MM,
  baselineMembers: 7,
  showsMembers: true,
  covenantFigure: "6/6",
  loadSteps: [
    "Reading the maturity schedule",
    "Re-querying the package, 7 of 7 members",
    "Pricing the grid at grade 5",
    "Testing 6 covenants against the renewal",
    "Composing a position",
    "Ready",
  ],
  askPin: "Matures 2026-06-30",
  position: "Renew the seasonal line at $2.5MM for twelve months, priced to the grid.",
  sources: [
    { id: "package", label: "Package", kicker: "Product package a5Fbb000000IHFJEA4", icon: "package", rows: ["position", "seasonal"] },
    { id: "maturities", label: "Maturities", kicker: "Maturity schedule · re-queried 09:02", icon: "calendar", rows: ["maturities"] },
    { id: "covenants", label: "Covenants", kicker: "6 covenants · 2 loan junctions", icon: "covenants", rows: ["covenants"] },
    { id: "collateral", label: "Collateral", kicker: "Collateral pool · re-queried 09:02", icon: "collateral", rows: ["collateral"] },
  ],
  why: [
    {
      label: "The maturity",
      detail:
        "HW1006 matures 2026-06-30, $2,500,000 committed and $1,150,000 drawn, 46% utilised. It is the seasonal line that funds the receivable build, and it is the only member of the package maturing before November. HW1006 · a4Zbb0000027MttEAE · SOFR+300, 7.85%, grade 5.",
    },
    {
      label: "Pricing",
      detail:
        "The line has carried SOFR+300 since it closed on 2025-06-30. The package prices its other grade 5 facility, HW1003 construction, at SOFR+325. Renewing at SOFR+325 puts the seasonal line back on the grid its own grade sits at, rather than carrying a grade 4 spread through another season.",
    },
    {
      label: "Security",
      detail:
        "Receivables of $1,600,000 are pledged to HW1006 at first position and carry across to the renewal unchanged. The borrowing base certificate junctions to HW1001, not to this line, so nothing about how the operating line calculates availability moves with this renewal.",
    },
    {
      label: "Alternatives considered",
      detail:
        "Let it mature and re-underwrite as a new line, which discards the pledge and the covenant junctions and re-opens the borrowing structure for a facility whose performance has not changed. Or extend at the legacy SOFR+300, which renews a grade 5 facility at a grade 4 spread and would need an exception to the pricing grid.",
    },
  ],
  whyCaveat: RECOMMENDATION_ONLY,
  beats: [
    {
      pill: "Renew at $2.5MM for twelve months",
      say: "Renew the seasonal line at two and a half million for another twelve months and price it at the grid.",
      keys: ["renew", "twelve", "grid", "2.5", "seasonal", "hw1006", "yes", "go with", "proceed"],
      reply:
        "Understood. Two terms on the renewal. Maturity moves from 2026-06-30 to 2027-06-30, and the spread moves from SOFR+300 to SOFR+325, which is the grade 5 spread this package already prices HW1003 at. The commitment is unchanged at $2,500,000. Neither term is written yet.",
      deltas: ["renewTerm", "renewPricing"],
    },
    {
      pill: "Renew the construction facility while we are here",
      say: "Renew the construction facility while we are here.",
      keys: ["construction", "hw1003"],
      reply: "I cannot stage that one in this plan, and here is the reason.",
      refusal: "hw1003-renewal",
    },
    {
      pill: "Carry the pledge and the covenant onto the renewal",
      say: "Carry the receivables pledge and the fixed charge covenant onto the renewed line.",
      keys: ["carry", "pledge", "receivable", "covenant", "fixed charge", "security"],
      reply:
        "Staged. The $1,600,000 receivables pledge copies onto the proposed revision at first position, and the fixed charge coverage covenant junctions to it at the existing 1.15x floor. The collateral record and the covenant record are both shared, not cloned, so nothing about the booked facility changes until the renewal books.",
      deltas: ["renewPledge", "renewCovenant"],
    },
  ],
  composeTarget: 4,
  deltas: RENEW_DELTAS,
  refusals: {
    "hw1003-renewal": {
      id: "hw1003-renewal",
      target: "HW1003 · Construction",
      title: "Renewal of HW1003",
      reason:
        "HW1003 does not mature until 2026-11-01, so it is outside this renewal window, and it carries policy exception a4rbb000003NxldAAC at Major / Mitigated. A renewal that moves a facility under an open exception has to carry that exception through its own approval. HW1003 stays Booked and unchanged.",
      detail:
        "Stage a separate renewal on HW1003 when the window opens. It carries its own clone, its own plan and its own submission, and the Kokomo completion covenant through junction a4Vbb000000pNKLEA2 travels with it, one off, 61% complete at the June inspection. The three mitigation reasons on the exception are re-stated on that plan rather than inherited silently.",
    },
  },
  reply: {
    subject: "Hartwell Industrial, seasonal line renewal",
    lede: "Confirms the twelve month renewal at $2.5MM, the move to SOFR+325 and the pledge and covenant carrying across.",
    body: `James,

Ahead of the 30 June maturity on the seasonal line, here is where the renewal has landed.

We are renewing the line at $2.5 million for a further twelve months, to 30 June 2027. The commitment is unchanged and the way availability is calculated is unchanged.

The spread moves from SOFR plus 300 to SOFR plus 325, which is the pricing your current risk grade carries on the rest of the package. At the 30 June drawn balance that is approximately $2,900 of additional interest a year.

The receivables pledge of $1.6 million carries across at first position, and the fixed charge coverage test continues at 1.15 times with the next measurement at 30 September. Nothing about the operating line or its borrowing base certificate changes.

The renewal has gone to credit committee for approval. We will confirm as soon as it is approved, and documents follow on approval.

Regards,
Relationship Manager, Commercial Banking`,
  },
  handoff:
    "Booking runs through nCino's Submit for Approval process. This room stages the renewal plan and hands it in; it does not book the facility, and no facility is renewed until the committee approves it.",
  offScript: OFF_SCRIPT,
};

/* --------------------------------------------- create, from inside a package */

const CREATE_PACKAGE_DELTAS: Record<string, WorkroomDelta> = {
  facility: MODIFY_DELTAS.facility,
  pledge: MODIFY_DELTAS.pledge,
  newCovenant: {
    id: "newCovenant",
    group: "covenants",
    kind: "New covenant",
    kindTone: "new",
    badge: "Minimum Liquidity added",
    title: "Minimum Liquidity",
    target: "The new equipment facility",
    before: "No facility level test",
    after: "≥ $6,000,000, quarterly",
    map: [
      ["Object", "Covenant plus loan covenant junction"],
      ["Record", "New covenant on Hartwell Precision Manufacturing LLC"],
      ["Written as", "Operator ≥, threshold 6,000,000, next evaluation 2026-09-30, junctioned to the new member."],
    ],
    fields: [
      "LLC_BI__Covenant2__c.Acnpex_Operator__c = >=",
      "LLC_BI__Covenant2__c.Acnpex_Threshold_Value__c = 6000000",
      "LLC_BI__Covenant2__c.Acnpex_Statement_Frequency__c = Not Annual",
      "LLC_BI__Covenant2__c.LLC_BI__Next_Evaluation_Date__c = 2026-09-30",
      "LLC_BI__Loan_Covenant__c (junction to the new member of a5Fbb000000IHFJEA4)",
    ],
    caveat:
      "Frequency writes as Not Annual. The Financial Ratio record type offers a restricted picklist of Annual and Not Annual only, so the quarterly cadence is carried by the evaluation dates, exactly as the five existing quarterly covenants on this relationship do.",
    challenge: {
      id: "cushion-new",
      verdict: "Cushion thins",
      tone: "warn",
      kicker: "Fixed charge cushion · live 09:06",
      line: "A new amortising facility puts scheduled principal and interest into the fixed charge denominator from first draw, and the thinnest covenant in the package is at 7 bps of cushion. It still clears the September test on today's figures. Re-test against the equipment amortisation schedule before first draw.",
      rows: [
        ["Fixed charge coverage floor", "1.15x"],
        ["Actual at 2026-06-30", "1.22x"],
        ["Cushion", "7 bps", "key"],
        ["New facility commitment", "$2,000,000"],
        ["Debt service coverage floor", "1.25x"],
        ["Debt service coverage actual", "1.38x"],
        ["Next evaluation", "2026-09-30", "sum"],
      ],
      say: "Scheduled principal and interest on the $2,000,000 equipment facility enter the fixed charge denominator from first draw and land in the 2026-09-30 test. Covenant a3Bbb000000S0ZlEAK carries its evaluation history in its own fields; this relationship has no compliance rows by design.",
    },
    filed: {
      recordId: "a3Bbb000000S1FhEAK",
      verification: "Re-queried a3Bbb000000S1FhEAK · threshold 6000000, operator >= · junction a4Vbb000000pNQzEAM active",
    },
  },
};

const CREATE_IN_PACKAGE: WorkroomScript = {
  mode: "create",
  packageName: "Hartwell Industrial C&I Credit Package",
  baselineCommittedMM: COMMITTED_MM,
  baselineMembers: 7,
  showsMembers: true,
  covenantFigure: "6/6",
  loadSteps: [
    "Reading the package",
    "Re-querying the package, 7 of 7 members",
    "Valuing collateral, 4 positions and 7 pledges",
    "Checking the product and pricing pick lists",
    "Composing a position",
    "Ready",
  ],
  askPin: "Add a facility",
  position: "A $2.0MM equipment facility on the Mazak tooling, as an eighth member.",
  sources: [
    { id: "package", label: "Package", kicker: "Product package a5Fbb000000IHFJEA4", icon: "package", rows: ["position"] },
    { id: "collateral", label: "Collateral", kicker: "Collateral pool · re-queried 09:02", icon: "collateral", rows: ["collateral"] },
    { id: "covenants", label: "Covenants", kicker: "6 covenants · 2 loan junctions", icon: "covenants", rows: ["covenants"] },
  ],
  why: [
    {
      label: "Why a facility and not a draw",
      detail:
        "The revolver is 61% drawn, $9,200,000 against $15,000,000, and advances are capped by the borrowing base certificate. Funding tooling on the line consumes working capital headroom the receivable build needs. An amortising facility sized to the asset does not.",
    },
    {
      label: "Collateral headroom",
      detail:
        "The existing pool is pledged to the dollar, $31,600,000 lendable against $31,600,000 pledged across seven rows. The Mazak tooling at $4,000,000 appraised and a 75% advance rate is $3,000,000 lendable and unencumbered, and it is the only headroom in the pool.",
    },
    {
      label: "Structure copied, not invented",
      detail:
        "The borrower, guarantor and limited guarantor rows come from HW1002, the package's existing equipment facility. Product Equipment, staged at Proposed. Nothing about the other seven members moves.",
    },
    {
      label: "Alternatives considered",
      detail:
        "Increase the revolver instead, which loads the fixed charge denominator at SOFR+275 against a 7 bps cushion and leaves the tooling unsecured. Or take the tooling on an operating lease, which keeps it off the package entirely and out of the collateral pool the relationship is priced on.",
    },
  ],
  whyCaveat: RECOMMENDATION_ONLY,
  beats: [
    {
      pill: "Add the equipment facility, pledge the Mazak",
      say: "Add the two million equipment facility for the tooling and pledge the Mazak against it.",
      keys: ["equipment", "mazak", "tooling", "pledge", "facility", "2 million", "$2", "2.0", "yes", "go with"],
      reply:
        "Staged. The package gains an eighth member, an equipment facility at $2,000,000, and the Mazak tooling is pledged to it at $4,000,000 appraised and a 75% advance rate, which is $3,000,000 lendable against $2,000,000 pledged. The existing pool is untouched, so no member loses coverage.",
      deltas: ["facility", "pledge"],
    },
    {
      pill: "Put Holdings on it as the borrower",
      say: "Set it up with Hartwell Industrial Holdings as the borrower.",
      keys: ["holdings", "borrower", "parent"],
      reply: "I cannot stage that one here, and here is the reason.",
      refusal: "holdings-borrower",
    },
    {
      pill: "Add a $6.0MM quarterly liquidity test to it",
      say: "Add a minimum liquidity covenant at 6 million tested quarterly on the new facility.",
      keys: ["liquidity", "covenant", "quarterly", "6 million", "$6", "6.0"],
      reply:
        "Staged. A facility level minimum liquidity test at $6,000,000, measured quarterly, junctioned to the new member and alongside the $5,000,000 relationship test already in force. Reported liquidity was $6,800,000 at 2026-06-30, so the borrower clears the tighter test on today's figures.",
      deltas: ["newCovenant"],
    },
  ],
  composeTarget: 3,
  deltas: CREATE_PACKAGE_DELTAS,
  refusals: {
    "holdings-borrower": {
      id: "holdings-borrower",
      target: "Hartwell Industrial Holdings LLC",
      title: "Holdings as the borrower",
      reason:
        "Hartwell Industrial Holdings LLC is the guarantor on this package, not the borrower. Every member of a package carries the package's borrowing structure, so a member with a different borrower is a different package. Holdings stays an unlimited guarantor on this one.",
      detail:
        "To lend to Holdings, open a package on that account. It carries its own borrowing structure, its own collateral pool and its own covenants, and the guarantee running the other way would have to be re-papered. The existing structure on this package is Hartwell Precision Manufacturing LLC as borrower, Hartwell Industrial Holdings LLC and James Hartwell as unlimited guarantors, and Elena Hartwell limited to $5,000,000 on HW1001.",
    },
  },
  reply: {
    subject: "Hartwell Industrial, new equipment facility",
    lede: "Confirms the $2.0MM equipment facility on the Mazak tooling and the $6.0MM quarterly liquidity test.",
    body: `James,

Here is where the tooling request has landed.

We are adding a $2.0 million equipment facility to the package, secured by the Mazak tooling. The tooling is appraised at $4.0 million and advanced at 75 percent, which is $3.0 million of lendable value against the $2.0 million facility.

Funding the tooling on an amortising facility rather than on the operating line keeps the line available for working capital through the ramp. Nothing about the operating line, its commitment or its borrowing base certificate changes.

One condition attaches to the new facility: a minimum liquidity test of $6.0 million, measured quarterly. Your 30 June position of $6.8 million clears it, and the existing $5.0 million relationship test is unchanged.

The facility is approved. Documents are being prepared and booking follows on execution.

Regards,
Relationship Manager, Commercial Banking`,
  },
  offScript: OFF_SCRIPT,
};

/* ------------------------------------------------ create, from an account */

const CREATE_ACCOUNT_DELTAS: Record<string, WorkroomDelta> = {
  newPackage: {
    id: "newPackage",
    group: "structure",
    kind: "New package",
    kindTone: "new",
    badge: "Package opened",
    title: "Product package",
    target: "Hartwell Industrial Holdings LLC",
    before: "No package on the account",
    after: "One package, stage Proposed",
    map: [
      ["Object", "Product Package"],
      ["Record", "New package on account Hartwell Industrial Holdings LLC"],
      ["Written as", "Stage Proposed, status In Progress, risk rating inherited from the account at 4."],
    ],
    fields: [
      "LLC_BI__Product_Package__c.LLC_BI__Account__c (Hartwell Industrial Holdings LLC)",
      "LLC_BI__Product_Package__c.LLC_BI__Stage__c = Proposed",
      "LLC_BI__Product_Package__c.LLC_BI__Status__c = In Progress",
    ],
    filed: {
      recordId: "a5Fbb000000IHKtEAO",
      verification: "Re-queried a5Fbb000000IHKtEAO · Stage = Proposed · 1 member",
    },
  },
  firstFacility: {
    id: "firstFacility",
    group: "structure",
    kind: "New facility",
    kindTone: "new",
    badge: "Equipment facility added",
    title: "Equipment facility",
    target: "First member of the new package",
    before: "0 members",
    after: "1 member, $2,000,000",
    newMember: true,
    committedDeltaMM: 2,
    map: [
      ["Object", "Loan"],
      ["Record", "First member of the new package"],
      ["Written as", "Amount 2,000,000, product Equipment, Holdings as borrower, staged at Proposed."],
    ],
    fields: [
      "LLC_BI__Loan__c.LLC_BI__Amount__c = 2000000",
      "LLC_BI__Loan__c.LLC_BI__Product_Package__c (the package this plan opens)",
      "LLC_BI__Legal_Entities__c (borrower row for Hartwell Industrial Holdings LLC)",
    ],
    challenge: {
      id: "coverage-new",
      verdict: "Covered",
      tone: "ok",
      kicker: "Coverage on the new package · live 09:06",
      line: "The Mazak tooling is the only unencumbered lendable value in the relationship's pool, and it covers the facility with $1,000,000 to spare. Nothing on the operating company's package loses coverage, because nothing on it is being re-pledged.",
      rows: [
        ["Mazak tooling appraised", "$4,000,000"],
        ["Advance rate", "75%"],
        ["Lendable", "$3,000,000", "sum"],
        ["Facility commitment", "$2,000,000"],
        ["Coverage of commitment", "1.50x", "key"],
        ["Unencumbered lendable left in the pool", "$1,000,000"],
      ],
      say: "The operating company's pool is pledged to the dollar, $31,600,000 lendable against $31,600,000 pledged across seven rows. The tooling at $4,000,000 and 75% is the only position with lendable value nothing claims, and this plan claims $2,000,000 of it.",
    },
    filed: {
      recordId: "a4Zbb0000027NuBEAU",
      verification: "Re-queried a4Zbb0000027NuBEAU · Amount 2000000 · package a5Fbb000000IHKtEAO · 1 entity involvement row",
    },
  },
  firstPledge: {
    id: "firstPledge",
    group: "security",
    kind: "Collateral pledged",
    kindTone: "collateral",
    badge: "Mazak tooling pledged",
    title: "Mazak tooling",
    target: "Pledged to the first member",
    before: "Appraised, unpledged",
    after: "$2,000,000 pledged, 1st position",
    map: [
      ["Object", "Collateral plus the pledge junction"],
      ["Record", "New collateral and one Collateral Pledged row"],
      ["Written as", "$4,000,000 appraised, 75% advance rate, $3,000,000 lendable, $2,000,000 pledged, first position lien."],
    ],
    fields: [
      "LLC_BI__Collateral__c.LLC_BI__Value__c = 4000000",
      "LLC_BI__Loan_Collateral2__c (label “Collateral Pledged”, the live junction)",
      "LLC_BI__Loan_Collateral2__c.LLC_BI__Advance_Rate_Override__c = 75",
      "LLC_BI__Loan_Collateral2__c.LLC_BI__Override_Reason__c (required, written)",
    ],
    caveat:
      "The advance rate is an override with a written reason. Every collateral type in this org defaults to 80%, and three of the seven existing Hartwell pledges already carry the same override for the same reason.",
    filed: {
      recordId: "a35bb0000013y7DAAQ",
      verification: "Re-queried a35bb0000013y7DAAQ · lendable 3,000,000 · pledge a4Rbb0000026srMEAQ amount 2,000,000, override 75 with reason",
    },
  },
};

const CREATE_FROM_ACCOUNT: WorkroomScript = {
  mode: "create",
  packageName: "Hartwell Industrial Holdings LLC · no package yet",
  baselineCommittedMM: 0,
  baselineMembers: 0,
  showsMembers: false,
  covenantFigure: "0/0",
  loadSteps: [
    "Reading the account",
    "Checking for an existing package, none found",
    "Valuing collateral, 1 unpledged position",
    "Checking the product and pricing pick lists",
    "Composing a position",
    "Ready",
  ],
  askPin: "Ask $2.0MM",
  position: "Open a package on Holdings with one $2.0MM equipment facility on the Mazak tooling.",
  sources: [
    { id: "account", label: "Account", kicker: "Hartwell Industrial Holdings LLC · re-queried 09:02", icon: "account", rows: ["position"] },
    { id: "collateral", label: "Collateral", kicker: "Collateral pool · re-queried 09:02", icon: "collateral", rows: ["collateral"] },
  ],
  why: [
    {
      label: "The account today",
      detail:
        "Hartwell Industrial Holdings LLC holds no package and no facilities. It is the unlimited guarantor on the operating company's package, which is where all seven current members and all six covenants sit. Opening a package here creates the container; it does not move anything off the operating company.",
    },
    {
      label: "Collateral headroom",
      detail:
        "The relationship's pool is pledged to the dollar, $31,600,000 lendable against $31,600,000 pledged across seven rows. The Mazak tooling at $4,000,000 appraised and a 75% advance rate is $3,000,000 lendable and unencumbered, and it is the only position that can secure anything new.",
    },
    {
      label: "Sizing",
      detail:
        "A $2,000,000 facility against $3,000,000 of lendable value is 1.50x coverage and leaves $1,000,000 of headroom in the pool. Taking the full $3,000,000 would pledge the last unencumbered asset in the relationship to the dollar, which is the position the operating company's pool is already in.",
    },
    {
      label: "Alternatives considered",
      detail:
        "Add the facility to the operating company's package instead, which is one member rather than a new container and keeps the borrowing structure as it stands. Or lend nothing here and take the tooling on the operating line, which consumes working capital headroom against a 7 bps fixed charge cushion.",
    },
  ],
  whyCaveat: RECOMMENDATION_ONLY,
  beats: [
    {
      pill: "Open the package with the equipment facility",
      say: "Open a package on Holdings and put the two million equipment facility on it.",
      keys: ["open", "package", "equipment", "facility", "2 million", "$2", "2.0", "yes", "go with", "proceed"],
      reply:
        "Staged. A package on Hartwell Industrial Holdings LLC at stage Proposed, and one member on it: an equipment facility at $2,000,000 with Holdings as the borrower. Neither record is written yet, and nothing on the operating company's package moves.",
      deltas: ["newPackage", "firstFacility"],
    },
    {
      pill: "Carry the fixed charge covenant across from the operating company",
      say: "Carry the fixed charge coverage covenant across from the operating company.",
      keys: ["fixed charge", "carry", "covenant", "across", "operating"],
      reply: "I cannot stage that one, and here is the reason.",
      refusal: "cross-entity-covenant",
    },
    {
      pill: "Pledge the Mazak tooling to it",
      say: "Pledge the Mazak tooling against the new facility.",
      keys: ["mazak", "tooling", "pledge", "collateral", "security"],
      reply:
        "Staged. The Mazak tooling is pledged to the new member at $4,000,000 appraised and a 75% advance rate, which is $3,000,000 lendable against $2,000,000 pledged, first position. The operating company's seven pledge rows are untouched, so no member of that package loses coverage.",
      deltas: ["firstPledge"],
    },
  ],
  composeTarget: 3,
  deltas: CREATE_ACCOUNT_DELTAS,
  refusals: {
    "cross-entity-covenant": {
      id: "cross-entity-covenant",
      target: "Hartwell Precision Manufacturing LLC",
      title: "Fixed charge coverage on Holdings",
      reason:
        "Covenant a3Bbb000000S0ZlEAK is written against Hartwell Precision Manufacturing LLC and tests that borrower's figures. Junctioning it to a facility on a different borrower would test the wrong entity. A new test on Holdings can be staged instead, against Holdings' own reported figures.",
      detail:
        "A covenant record names the borrower it tests, and the loan covenant junction only says which facilities it attaches to. The operating company's six covenants stay where they are. If a fixed charge test on Holdings is wanted, it is a new covenant record with its own threshold, its own frequency and its own evaluation dates, and the figures behind it are Holdings' own, which this account has not staged.",
    },
  },
  reply: {
    subject: "Hartwell Industrial Holdings, new equipment facility",
    lede: "Confirms the new package on Holdings and the $2.0MM equipment facility on the Mazak tooling.",
    body: `James,

Here is where the Holdings request has landed.

We are opening a credit package on Hartwell Industrial Holdings LLC with one facility on it: a $2.0 million equipment facility secured by the Mazak tooling. The tooling is appraised at $4.0 million and advanced at 75 percent, which is $3.0 million of lendable value against the $2.0 million facility.

Nothing on the operating company's package changes. Its seven members, its covenants and its existing pledges are all unaffected, and the guarantees running from Holdings to the operating company stay as they are.

The facility carries no new financial covenant at this stage. Holdings' own reported figures will drive whatever test we set at the first annual review.

The structure is approved. Documents are being prepared and booking follows on execution.

Regards,
Relationship Manager, Commercial Banking`,
  },
  offScript: OFF_SCRIPT,
};

/* ------------------------------------------------------------------ lookup */

/** The scripted storyline for a mode and door. The door only ever branches
 *  `create`: modify and renew are package-anchored by definition. */
export function scriptFor(mode: WorkroomMode, door: WorkroomDoor): WorkroomScript {
  /* AMEND HAS NO STORYLINE, AND MUST NOT INVENT ONE. The scripted engine exists
     for demos of the three original routes; shaping a version in place is wired
     only, so a scripted amend falls back to the modification's beats rather
     than telling a story about a version nobody read. Nothing in the shipped
     app reaches this: `WorkroomHost` builds a wired engine for every mode. */
  if (mode === "modify" || mode === "amend") return MODIFY;
  if (mode === "renew") return RENEW;
  return door === "account" ? CREATE_FROM_ACCOUNT : CREATE_IN_PACKAGE;
}
