import type { StagedOutput } from "../actions/stagedPlan";

/* =============================================================================
   THE WORKROOM, IN TYPES.

   ONE room, THREE modes. The mode changes the vocabulary, the checks, and what
   the manifest files. It does not change the shell: the entry scene, the step
   spine, the windowed thread, the peek primitive, the manifest rail and the
   approval under it are the same room in all three.

   The blessed design is design/workroom-mock/index.html (v2.2, commit 511b01e).
   Everything here is named after something visible in it.
   ============================================================================= */

/** modify — reshape an existing package (the mock's storyline verbatim).
 *  renew   — compose a renewal on maturing facilities and hand INTO approval.
 *  create  — compose a new package, or add a facility inside an existing one. */
export type WorkroomMode = "modify" | "renew" | "create";

/** TWO DOORS, ONE ROOM (create only, and it only ever changes what is pinned).
 *  `account` composes the package from scratch; `package` adds a member to a
 *  package that is already on the table, so the package arrives pre-pinned. */
export type WorkroomDoor = "account" | "package";

/** What the room is opened ON. Everything the shell needs to name the place it
 *  is working in, resolved by the caller from the cockpit's own read. */
export interface WorkroomContext {
  mode: WorkroomMode;
  door: WorkroomDoor;
  accountId: string;
  accountName: string;
  /** Null on the `account` door of create: there is no package yet. */
  productPackageId: string | null;
  packageName: string;
  /** The banker in the room. The approval names them, so the room must know. */
  approver: string;
}

/** The four columns a credit committee reads a change set in. The manifest
 *  groups by these and in this order, whatever the mode. */
export type ManifestGroupId = "structure" | "terms" | "covenants" | "security";

export const MANIFEST_GROUPS: { id: ManifestGroupId; label: string }[] = [
  { id: "structure", label: "Package structure" },
  { id: "terms", label: "Member terms" },
  { id: "covenants", label: "Package covenants" },
  { id: "security", label: "Security" },
];

/** One member of the package. Loans are chips at package altitude (law 1).
 *  Shared shape: the shell engine reads it off a fixture and the real engine
 *  resolves it from the cockpit's bundle, and the strip cannot tell. */
export interface PackageMember {
  /** THE MEMBER'S OWN IDENTITY, and the only thing that tells two of the same
   *  product apart. `key` is the product word and legitimately repeats across a
   *  deal with two lines of credit, so a click, a React key or an engine lookup
   *  resolves on this and never on the label. */
  id: string;
  key: string;
  /** The product, short enough for a chip that shares its row. */
  short: string;
  /** The org's own stage word, or the honest "stage not staged". */
  tag: string;
  product: string;
  /** Commitment, as the chip prints it. */
  amount: string;
  /** The record line on the member card inside the peek. */
  detail: string;
  /** Drawn percentage, where the read carries both figures. */
  utilisation?: number;
  available?: string;
  /** NOT BOOKED (W4). A proposal member, or one whose stage the read does not
   *  carry, renders dashed: pre-work display must not read as done work. */
  proposed?: boolean;
}

/** One row of a disclosure peek: what the room read, and what it said. */
export interface HaveRow {
  label: string;
  value: string;
  detail: string;
}

/** The check that a confirmed change trips, delivered back into the thread as
 *  an agent message with its verdict on the face. Never a separate tab. */
export interface WorkroomChallenge {
  id: string;
  verdict: string;
  tone: "ok" | "warn";
  /** The provenance line beside the verdict chip. */
  kicker: string;
  line: string;
  /**
   * WHY THIS CHECK MATTERS HERE — one sentence, under the figures.
   *
   * A verdict with no reason is a number a banker has to take on trust. Absent
   * where the engine has nothing state-derived to add, which is what the shell
   * engines leave.
   */
  why?: string;
  /** The arithmetic, opened as a peek. `[label, value, rowClass?]`. */
  rows: [string, string, string?][];
  /** What the banker can say about it, in the agent's own words. */
  say: string;
}

/**
 * A TIER-1 ADVISORY: a sense-check that speaks up BEFORE staging.
 *
 * It is ADVICE, not a verdict, and the distinction is load-bearing everywhere.
 * The org's guards do the blocking — the write allowlist, the drift recompute,
 * the single-use token — so an advisory never gates a chip, never waits to be
 * acknowledged, and never removes the change the banker asked for. It says the
 * thing a credit officer would say across the desk, and the banker decides.
 *
 * `resolution` is the better move where the read carries one, phrased as a line
 * the banker could have typed themselves: it goes back through the same parser,
 * so an advisory can do nothing the banker could not.
 */
export interface WorkroomAdvisory {
  id: string;
  /** Which rule fired, for tests and for the audit of what the room noticed. */
  rule: string;
  /** The advice. One or two sentences, banker language, derived from the read. */
  line: string;
  resolution?: { label: string; say: string };
}

/** ONE proposed change: a delta chip in the thread, a manifest entry once it is
 *  confirmed, and a filed row once the plan runs. */
export interface WorkroomDelta {
  id: string;
  group: ManifestGroupId;
  /** "Term change", "New covenant" — the chip's category badge. */
  kind: string;
  /**
   * WHAT IT DOES TO THE ROLL-OVER BASELINE.
   *
   * A modification carries the parent's record graph onto the clone, so the
   * manifest is a DIFF against that baseline rather than a list of items:
   * everything not named is KEPT, and what is named is changed, added or
   * removed. A removal is destructive and reads differently everywhere it
   * appears. Absent means "change", which is what the shell engines stage.
   */
  op?: "change" | "add" | "remove";
  /** Which badge colour the kind carries. Absent is the accent default. */
  kindTone?: "new" | "collateral" | "refusal";
  /** The line the arrival toast says on the right. */
  badge: string;
  title: string;
  target: string;
  before: string;
  after: string;
  /** The package member this touches, for the "N of M members" count. */
  member?: string;
  /** True when this delta ADDS a member, which moves the member count. */
  newMember?: boolean;
  /** Millions added to the package's committed figure. Walked back on remove. */
  committedDeltaMM?: number;
  /** The org records this writes, `[label, value]`, shown on the chip's info. */
  map: [string, string][];
  /** Wire field names only. Never values: those live in the plan hash. */
  fields: string[];
  /** An org constraint the banker must read before confirming. Verbatim. */
  caveat?: string;
  /** The check this confirm trips, the moment it lands. */
  challenge?: WorkroomChallenge;
  /** What the filed state shows once execution verifies it by re-query. */
  filed: { recordId: string; verification: string };

  /* ---- WIRING (real engines only; the shell engine leaves all four absent) */

  /** TRUE when a deployed tool actually files this. FALSE is not a failure: it
   *  is an amendment the room stages for the record and hands off honestly
   *  (`knowledge/sf-build-v2/wiring-gap-analysis.md`). Absent reads as true, so
   *  the scripted engines are unaffected. */
  fileable?: boolean;
  /** What this contributes to the `stage_*` payload. Present exactly when
   *  `fileable`; staging never re-parses a sentence it already read. */
  wire?: { key: string; value: number | string; facilityId: string };
  /** A NET-NEW COVENANT's contribution (2026-08-30): resolved catalog type,
   *  threshold and operator, targeted at ONE member — the covenant attaches to
   *  that member's CLONE on the new package version. Present exactly when the
   *  delta is a fileable covenant add; `wire` stays absent on such a delta. */
  covenantWire?: { typeName: string; threshold: number; operator: string; frequency: string; facilityId: string };
  /** A BORROWING-STRUCTURE amendment's contribution (2026-08-30): an add is
   *  authored on the member's clone, a remove is a CARRY EXCLUSION — the parent
   *  keeps its row, the clone starts without it, nothing is deleted. */
  involvementWire?: { op: "add" | "remove"; role?: string; accountName: string; ownership?: number; facilityId: string };
  /** A NET-NEW FEE's contribution (2026-08-31): the fee is authored on the
   *  member's CLONE, never on the booked parent. `feeType` is the org's own
   *  legal `LLC_BI__Fee_Type__c` value and `description` is the human label,
   *  because `Name` on a fee is an autonumber. A PERCENTAGE fee carries no
   *  amount: the org's FeeTrigger computes it from the clone's commitment, and
   *  a hand-set figure would be a number nobody derived. */
  feeWire?: {
    feeType: string;
    description: string;
    calculationType: "Percentage" | "Flat Amount";
    percentage?: number;
    amount?: number;
    recordType: string;
    facilityId: string;
  };
  /** A COLLATERAL PLEDGE's contribution (2026-08-31), in one of its two shapes.
   *  `collateralId` pledges an asset the borrower already owns; `newCollateral`
   *  authors the whole chain first — the asset, then the
   *  `LLC_BI__Account_Collateral__c` ownership junction that is the only link
   *  `LLC_BI__Collateral__c` has to an account, then the pledge. Either way the
   *  pledge lands on the member's CLONE and the booked parent keeps exactly the
   *  security it has today. `advanceRate` rides the pledge as
   *  `LLC_BI__Advance_Rate_Override__c`: the plain advance rate is a formula. */
  pledgeWire?: {
    collateralId?: string;
    newCollateral?: { description: string; collateralType: string; value: number };
    advanceRate?: number;
    facilityId: string;
  };
  /** A POLICY EXCEPTION's contribution (2026-08-31). The row is authored on the
   *  member's CLONE (`LLC_BI__Loan__c`) and anchored on the borrower
   *  (`LLC_BI__Relationship__c`), born `LLC_BI__Type__c` = "Policy" like every
   *  row this org holds. `title` rides `Name`, which is plain text here and
   *  REQUIRED in practice: the org's trigger stack backfills an omitted one with
   *  the record's own Id. `reasons` are the three
   *  `LLC_BI__Mitigation_Reason_N__c` fields, 100 characters each. */
  policyExceptionWire?: {
    title: string;
    status: "Waived" | "Mitigated" | "Unmitigated";
    reasons: string[];
    severity?: string;
    facilityId: string;
  };
  /** A CURATED LOAN FIELD's contribution (2026-08-31): the field wave rides
   *  `fieldChangesJson`, and the ORG resolves the name against its own live
   *  describe at stage time rather than trusting a name shipped in this client.
   *  `value` is what travels; `display` is the banker's reading of it, so the
   *  chip and the wire can never drift apart. */
  fieldWire?: { field: string; label: string; value: string | number | boolean; display: string; facilityId: string };
  /** The figure this was composed against, so execution can prove the read has
   *  not moved underneath it (the ConfirmGate recompute, applied to the rail). */
  basis?: { facilityId: string; fieldId: string; before: string };
  /** Why nothing files it, and what would. Present exactly when NOT fileable. */
  handoff?: { reason: string; closes?: string };
  /**
   * CONNECTED CREATION, NEVER ORPHANS.
   *
   * An entry that CREATES a record carries the junction chain that ties it to
   * the deal — the covenant and its loan attachment, the collateral and its
   * ownership and pledge rows, the fee and its aggregate. The chain becomes
   * ordered plan steps, so a create without its junctions cannot be staged.
   */
  chainLinks?: Array<{ object: string; via: string; label: string; note?: string }>;
}

/**
 * THE CONSEQUENCE OF A CONFIRM.
 *
 * A chip that lands in the manifest and says nothing is the failure this type
 * exists to make impossible: the shell knows a chip moved, the ENGINE knows what
 * it did to the package, so the engine is the one that answers. `reply` is not
 * optional — a confirm is never silent — and `challenge` carries the check the
 * new figures trip where the read carries enough to run one.
 */
export interface WorkroomAcknowledgement {
  reply: string;
  challenge?: WorkroomChallenge;
  /** CLICKABLE ANSWERS for the question this confirm's own follow-up asks, on
   *  the same closed-set contract as IntentResult's `options` below: a confirm
   *  is not silent, and where what it asks next has a legal answer set, the
   *  chips ride here too rather than only on the first ask. */
  options?: Array<{ label: string; say: string }>;
}

/** An ask the room will not stage, answered with the reason rather than a
 *  fabricated chip. The mock's refusal beat, generalised. */
export interface WorkroomRefusal {
  id: string;
  target: string;
  title: string;
  /** The org's own account of its own constraint, verbatim. Rendered as the
   *  quote it is, never paraphrased. */
  reason: string;
  /**
   * WHY, AND WHAT WOULD WORK — in credit language, above the quote.
   *
   * A refusal with no route out is a dead end, and the org's own sentence is
   * the wrong thing to lead with: it explains the constraint to an engineer,
   * not the way forward to a banker. Absent on the shell engines.
   */
  why?: string;
  /** The longer account, opened as a peek. */
  detail: string;
}

/** What `parseIntent` gives back. Three outcomes and no fourth: deltas the
 *  banker can confirm, an honest refusal, or "I did not understand that". */
export type IntentResult =
  | {
      kind: "deltas";
      reply: string;
      deltas: WorkroomDelta[];
      /** What the room noticed about these deltas before anything is staged.
       *  Never a gate: the chips arrive open either way. */
      advisories?: WorkroomAdvisory[];
      /** CLICKABLE ANSWERS, same contract as "unparsed" below. A deltas reply
       *  still ends on a question wherever something required is still missing,
       *  and where THAT question has a closed set of legal answers, the chips
       *  ride here too — a banker should never lose the chips just because the
       *  same message also landed a delta. */
      options?: Array<{ label: string; say: string }>;
    }
  | { kind: "refusal"; reply: string; refusal: WorkroomRefusal }
  | {
      kind: "unparsed";
      reply: string;
      /** CLICKABLE ANSWERS. When the question has a closed set of legal answers
       *  (an org picklist, the product catalog), they ride the reply as chips:
       *  clicking one SAYS it, and the said value flows through the same parser
       *  and the same validation as a typed one. Never a gate, never a form. */
      options?: Array<{ label: string; say: string }>;
    };

/**
 * THE STAGED PLAN, AT THE SEAM.
 *
 * `plan` is the cockpit's own `StagedOutput`, so a real engine hands the
 * `stage_*` response straight through with nothing to translate. The three ids
 * beside it are that plan's own, lifted once at the seam so the shell never
 * reaches into a plan to find the token it must not touch.
 */
export interface StagedWorkroomPlan {
  plan: StagedOutput;
  planHash: string;
  stagingId: string;
  decisionToken: string | null;
}

/** The four fields `execute_*` reads, exactly as ConfirmGate passes them. */
export interface WorkroomApproval {
  stagingId: string;
  planHash: string;
  decisionToken: string;
  approverUserId: string;
}

/** One manifest entry after the plan ran, with the id the org gave it and the
 *  re-query that proves it landed. */
export interface FiledEntry {
  deltaId: string;
  recordId: string;
  verification: string;
}

/** The closing move: the reply to the client, drafted, never sent. */
export interface DraftedReply {
  subject: string;
  lede: string;
  body: string;
}

/** An amendment the room staged and did NOT file, with the org's reason. The
 *  filed scene lists these beside what landed: a manifest of five entries where
 *  one files is "1 filed, 4 handed off", never "5 filed". */
export interface HandoffEntry {
  deltaId: string;
  title: string;
  reason: string;
  /** The extension that would close it. Design only — nothing is deployed. */
  closes?: string;
}

/** What `execute` gives back. Verified, or it does not come back. */
export interface WorkroomExecution {
  filed: FiledEntry[];
  /**
   * THE ORG'S OWN WORD FOR HOW THE RUN ENDED, carried rather than dropped.
   *
   * `writeTools` already normalises a malformed execute to "failed"; the engine
   * leg used to throw that away and build `filed` from the MANIFEST it sent,
   * record ids and all, so a failed run reached the room looking exactly like a
   * successful one. It travels now, and a run the org reported failed comes
   * back with an EMPTY `filed` list, the room's unreadable-execution path then
   * takes over and the sheet never lights on a write nobody can see.
   */
  terminalState?: string;
  /**
   * THE PACKAGE VERSION THE FILING PRODUCED, where the org named one: the clone
   * a modification versions into, or the package a creation opened. The filed
   * sheet's "version <v>" clause reads this, and the dossier's deep link points
   * at it rather than at the package the work started on.
   */
  outputPackageId?: string | null;
  /** The single-use token line under the approve button. */
  tokenNote: string;
  /** RENEW: booking runs through the bank's own approval process, and the room
   *  says so rather than implying it booked. Absent where filing is terminal.
   *  MODIFY: the org's own `bookingHandoff` sentence, rendered verbatim. */
  handoff?: string;
  /** Everything the plan carried but no tool files. */
  handoffs?: HandoffEntry[];
  reply?: DraftedReply;
}
