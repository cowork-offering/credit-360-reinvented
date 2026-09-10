import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Portal } from "../Portal";
import { isTopmost, pushModal } from "../modalStack";
import { prefersReducedMotion, staggerDelay } from "../../data/motion";
import { shortFacilityName } from "../../data/facilityStage";
import { CLIENT_EMAIL, GOVERNANCE, HAVE } from "../../workroom/fixture";
import { readableError, type PackageChoice, type WorkroomEngine, type WorkroomSuggestion } from "../../workroom/engine";
import { addEntry, addressManifest, figuresFor, removeEntry } from "../../workroom/manifest";
import { vocabularyFor } from "../../workroom/modes";
import { stepperState } from "../../workroom/stepper";
import {
  awaitFiling,
  CONFIRM_BUDGET_MS,
  FILED_FAILED,
  FILING_IN_FLIGHT,
  LIVE_SETTLE,
  STILL_WRITING,
  type SettleDeps,
} from "./settleExecution";
import {
  KEEP_THE_PLAN,
  TRY_AGAIN,
  byDeadline,
  executeDeadlineLine,
  isDeadline,
  stageDeadlineLine,
} from "./deadline";
import {
  RESUMED_NOTE,
  RESUME_CHIP,
  START_OVER_CHIP,
  clearPlan,
  isResumeSay,
  isStartOverSay,
  readStoredPlan,
  resumeOffer,
  savePlan,
  type PlanRoute,
  type StagedPlanDoc,
} from "./planStore";
import type {
  DraftedReply,
  HaveRow,
  IntentResult,
  PackageMember,
  StagedWorkroomPlan,
  WorkroomAdvisory,
  WorkroomChallenge,
  WorkroomContext,
  WorkroomDelta,
  WorkroomExecution,
  WorkroomMode,
  WorkroomRefusal,
} from "../../workroom/types";
import type { SourceChip } from "../../workroom/scripts";
import { BrandGlyph } from "../brand";
import { odoRoll } from "../Odometer";
import { Peek, usePeek } from "./Peek";
import { RoomBoundary } from "./RoomBoundary";
import { GooFilter, LiquidMark, Orbit } from "./Liquid";
import { TypeIcon, iconForDelta, iconForMember, type IconKind } from "./TypeIcon";
import {
  NEUTRAL_QUESTION,
  ROUTE_CHIPS,
  ROUTE_WORD,
  SOMETHING_ELSE,
  readRouteIntent,
  readRouteSwitch,
  type SmartOpening,
} from "./route";
import { bankerly, isQuestion, readRole, readTopic, unsoundFieldChange, whatICanDo, type ReadTopic } from "./ask";
import { buildEnvelope, clarifyOffWire, facilityLabel, politeCommand, toReadCardModel } from "./brainRoute";
import type { BrainEnvelope, BrainReply, BrainTurn } from "../../channel/brainLane";
import { UNREADABLE_CLARIFY, isDegrade, restateProposal } from "../../channel/brainLane";
import { Narration, useNarration, type NarrationView } from "../../channel/Narration";
import type { Facility } from "../../data/contract";
import {
  facilitiesInPackage,
  IN_FLIGHT_REFUSAL,
  lockedSourcePackage,
  mustChoosePackage,
  packageRoster,
  type PackageEntry,
} from "../../book/packages";
import { exceptionAsk, exceptionSay, readExceptionOpen } from "./exception";
import { feeAsk, feePercentageNote, feeSay, readFeeOpen } from "./fee";
import {
  PRICING_FIELD,
  PRICING_SKIPPED,
  PRICING_WHY,
  movesPricing,
  pricingAsk,
  pricingDeclinedLine,
  pricingLanded,
  pricingNeed,
  pricingSay,
  readPricingAnother,
  readPricingDecline,
  readPricingFreeText,
  readPricingLine,
  readPricingOther,
  type PricingNeed,
} from "./pricingGate";
import { subjectFor } from "../../channel/narrate";
import {
  committedSentence,
  fenceRefusal,
  focusQualifier,
  magnitudeAdvisories,
  misreadCommitments,
  provablyClean,
  qualifierFilter,
  shortenPledgeTitles,
  stagedAddress,
  readRemove,
  readPartyRemoval,
  readsThePlan,
  readTypeChoice,
  readTypeRefusal,
  reconcileNarrative,
  retypeEntry,
  stampRemovalRoles,
  typeChoiceSay,
  type MisreadMember,
} from "./dispatch";
import {
  advance,
  amendedPlanLine,
  associateGap,
  awarenessFor,
  amendmentOf,
  buildBook,
  changedLine,
  compose,
  handoffEntry,
  openCreate,
  planAmendmentFor,
  pledgeAlreadySettled,
  readInto,
  readScope,
  restateEntry,
  routeGap,
  verify,
  type Draft,
  type ElicitContext,
  type ElicitMember,
  type PlanAmendment,
  type PlanEntry,
  type Slots,
} from "./elicit";
import {
  armConfirmSentence,
  armOf,
  armPlanLines,
  armStageRefusal,
  armStepPairs,
  armSummary,
  armTrailSummary,
  pledgeExistingDelta,
  readArmRemoval,
  readCovenantAttach,
} from "./orgArms";
import {
  newFacilityCreateEntry,
  newFacilityDelta,
  newFacilityFeeEntry,
  newFacilityMember,
  newFacilityRemovalRefusal,
  readNewFacility,
  stagedNewFacilities,
  stagedNewFacilitySpecs,
} from "./newFacilityArm";
import { completeNewFacilityDetail } from "../../channel/writeTools";
import { readCatalog, reconcileChips, type OrgCatalog } from "../../channel/catalog";
import { bareMemberPick, readSteer } from "./steer";
import {
  TIER_STAGGER_MS,
  summonLabel,
  tierAttrs,
  useEntryChoreography,
  type EntryTier,
} from "./entryChoreography";
import {
  asksRateOptions,
  rateAsk,
  rateFigureAsk,
  rateHeldLine,
  rateIndexAsk,
  rateIndexNote,
  rateOnFile,
  rateSay,
  readRateFreeText,
  readRateHold,
  readRateKeepWord,
  readRateIndexOpen,
  readRateIndexPick,
  readRateNew,
  type RateIndex,
} from "./rateGate";
import {
  capSentences,
  cardFigures,
  cutCloneCount,
  cutFigureEcho,
  cutPricingWhy,
  cutTail,
  cutVersionParagraph,
  carriesVersionParagraph,
  focusPrompt,
  preambleFor,
  VERSION_LINE,
} from "./hygiene";
import {
  expandLabel,
  rowForChallenge,
  rowForDelta,
  rowForRead,
  settleAttrs,
  useSettleChoreography,
  type SettledRow,
} from "./settle";
import { useStageGate } from "./stage";
import { FINALE_SWEEP_MS, finaleAttrs, finaleCardHoldMs, useFinale, withFinale } from "./finale";
import { FILED_SECTION_MS, FiledList, filedLinesFor, type FiledLine } from "./FiledList";
import { FiledSheet } from "./FiledSheet";
import {
  filedStamp,
  filedTitle,
  renewedTo,
  shortRecordId,
  sheetExposure,
  sheetCoverage,
  whoActsNext,
  type FiledSheetModel,
  type SheetConfirmation,
} from "./filedSheet";
import { CARD_ASCEND_MS, CARD_HELD_MS, useCardMorph } from "./morph";
import { countPhrase, countSplit, derivedReasonOf, splitClause, withDerivedSplit } from "./derivedDelta";
import { buildReadCard, planReadCard, readGap, type ReadCardModel, type ReadOptions, type ReadSource } from "./readCard";
import { ReadCard } from "./ReadCardView";
import { packageDeepLink } from "../DeepLink";
import { executionFailed } from "../../channel/writeTools";
import { NEW_PACKAGE, NEW_PACKAGE_CHOICE } from "../../workroom/modes";
import { mailTipFrom, overdueCovenantTip } from "./tips";
import { useClientMail } from "./clientMail";
import { useRoomFeed } from "../../intent/feed";
import { intentFor, intentMailNote } from "../../intent/open";
import { carriedMailFor } from "../../actions/mailCarry";
import { sourcePhrase } from "../../intent/contract";
import { ComposerPlus } from "../composer/ComposerPlus";
import { BugCopyButton } from "../BugCopyButton";
import { threadToMarkdown } from "../transcript";
import "../../styles/workroom.css";
import "../../styles/package-anchor.css";
import { ManifestRail } from "../rail/ManifestRail";

/* =============================================================================
   THE WORKROOM — A GUIDED RITUAL.

   ONE shell, THREE modes. Everything mode-specific arrives through the engine
   (what the room read, what a line becomes, what a plan files) and the mode
   vocabulary (what the room calls things). Nothing in this file knows what a
   modification is, which is why renew and create are the same room.

   THE RITUAL (rule 30). The agent greets by name on the client, looks the
   package up behind a shimmer chip, and briefs what it found with the members
   as uniform rows. The composer and the suggestion sleep until the brief lands,
   because an input offered before the room has read anything invites a
   sentence the room cannot yet answer.

   ONE LIVE EXCHANGE (rule 31). Every send starts a STEP; the steps before it
   collapse behind an "earlier steps" chip. That, and not a fold model, is what
   keeps the room to one decision on screen — and it is why the thread is
   allowed to scroll as long as its scrollbar is never seen.

   EVERY DECISION LIVES IN THE CHAT (rule 38). The island is retired: a confirm
   puts a glass review chip in the thread, the chip pops the flow card open
   where it stands, execution runs inline, and the card MORPHS into the result
   dossier (rules 43 + 69). Nothing floats over the composer.

   THE ENGINES ARE UNTOUCHED. This file re-choreographs the room over the states
   and events they already emit; not one engine call, argument or return shape
   changed for this design.
   ============================================================================= */

/* ------------------------------------------------------------ thread model */

type ChipState = "open" | "confirmed" | "discarded";

interface ChipModel {
  key: string;
  delta?: WorkroomDelta;
  refusal?: WorkroomRefusal;
  state: ChipState;
}

/**
 * FIELDS THE SHELL ADAPTER CARRIES AT RUNTIME AND THE ENGINE'S OWN TYPE DOES NOT.
 *
 * `writeTools` reads both off the org's answer; `WorkroomExecution` predates them
 * and lives behind a byte fence in this wave, so the room widens locally rather
 * than editing a type it may not touch. Both are optional and both are absent on
 * every scripted engine, which is exactly how the sheet omits what it does not
 * know instead of inventing it.
 */
/** The one execute field the room reads that no engine declares yet: the queue
 *  a filing lands in. `outputPackageId` and `terminalState` are on
 *  `WorkroomExecution` proper now, so this widening is down to its last member
 *  and goes when an engine carries the queue. */
type ExecutionExtras = { approvalQueue?: string };

/** The dossier the finale constructs, from the REAL manifest and the REAL
 *  execution result. Held as an item so it lands in the live exchange and the
 *  confirmation lands under it in the same step (rule 43). */
interface DossierModel {
  packageName: string;
  rows: Array<{ icon: IconKind; label: string; value: string }>;
  /** The card's own last line: the org's verification claim, not a slogan. */
  footer: string;
  /** The single-use token, said once, under the card. */
  tokenNote: string;
  /**
   * THE PACKAGE THE PLAN FILED AGAINST, in nCino.
   *
   * Null where the view carries no org address (`meta.instanceUrl`) or no
   * package anchor. NO LINK IS RENDERED IN THAT STATE: a guessed My Domain host
   * is the one failure worse than no link at all (A29, and DeepLink.tsx says it
   * at the helper). Never hardcoded, never reconstructed from an org id.
   */
  packageHref: string | null;
  /** What the filing did NOT do. A renewal is handed into the bank's own
   *  approval process and never booked by this room, and it says so here. */
  handoff?: string;
  handoffs?: Array<{ title: string; reason: string; closes?: string }>;
}

/* ------------------------------------------------------------- the router

   ONE ROOM, THREE ROUTES (founder, 2026-08-31). The room can be opened WITHOUT
   a route — the FAB's Facility Actions satellite does exactly that — and its
   first question decides which engine takes the session. The question rides in
   the greeting slot (rule 30), never in a modal, and it retires the moment a
   route is bound whether a chip or a typed line bound it.

   The shell owns the QUESTION. The caller owns the CONSEQUENCE: `onBind` and
   `onRestart` rebuild the room on the chosen engine, because the room cannot
   swap its own engine mid-session and must never look as if it had. */

export interface RouterQuestion {
  /** The sentence in the greeting slot. The smart opening's is the deal signal
   *  verbatim; the neutral one names the three routes. */
  line: string;
  chips: RouteOption[];
}

export interface RouteOption {
  label: string;
  /** Null on "Something else": it answers nothing and falls through to the
   *  neutral three-way rather than binding a route the banker did not pick. */
  route: WorkroomMode | null;
  memberId?: string | null;
}

export interface WorkroomRouter {
  /** The question to open on. Null where the caller already bound a route. */
  question: RouterQuestion | null;
  /** A line that bound the route and still has to be ACTED ON. A banker who
   *  typed "renew the revolver" asked for something; the bound room says it
   *  through the parser rather than echoing it and dropping it. */
  say: string | null;
  /** The member the binding preselected, where the signal named one. */
  preselectMemberId?: string | null;
  onBind: (route: WorkroomMode, opts?: { say?: string; memberId?: string | null }) => void;
  /** The banker asked for a different route with a manifest already staged and
   *  then took the discard. The room is REBUILT, never quietly re-engined. */
  onRestart: (route: WorkroomMode, say: string) => void;
  /**
   * THE CREDIT MEMO DOOR, under the three routes.
   *
   * NOT A FOURTH CHIP, and deliberately not one. The three routes pick the
   * ENGINE this session runs on: each one stages a plan and writes to the org.
   * Writing the memo binds no engine, stages nothing and writes nothing; it is
   * a different kind of act on the same package, so it gets its own quiet door
   * under the row rather than a seat in it. It also opens the MEMO room and
   * closes this one, which no chip in that row does.
   *
   * Absent leaves the room byte-identical to the room before this door existed.
   */
  onMemo?: () => void;
}

type ThreadItem = { id: string; step: number } & (
  | { kind: "banker"; text: string }
  | {
      kind: "agent";
      text: string;
      /** ONE SENTENCE THE SHELL OWNS about this parse, kept apart from the
       *  engine's own account so it SURVIVES the paragraph stepping back to the
       *  address where a remark lands. The percentage fee's "the org works the
       *  money out itself" is the only one today. */
      note?: string;
      options?: Array<{ label: string; say: string }>;
      /** The explicit restart offered when a cross-route line lands on a staged
       *  manifest. Never a silent engine swap. */
      restart?: { route: WorkroomMode; label: string; say: string };
      /** THIS MOMENT IS CHROME (founder, 2026-09-03). A line that answers a
       *  SELECTION rather than an instruction: the banker pointed at a facility
       *  and the room said what it holds. `subjectFor` reads it and the model is
       *  never asked, so a focus click puts ONE bubble on the glass. */
      routine?: boolean;
      /** THE ONE CHIP THAT IS NOT A SENTENCE. Every other chip in this room SAYS
       *  something and rides the parser; this one asks the ORG what a filing
       *  already with it finally did. It exists because the alternative offer —
       *  approve again — is the one gesture that must never be made twice. */
      statusChip?: boolean;
      /** THE RECORD THE SENTENCE IS ABOUT, in nCino. A refusal that names a
       *  version the banker has to go and deal with hands them the door to it.
       *  Null-safe by construction: the caller resolves the href and omits the
       *  field where the view carries no org address (A29). */
      link?: { href: string; label: string };
    }
  /** The opening read: the greeting, the position, the ask it arrived on, and
   *  what the room read to say it. One bubble, because it is one sentence. */
  | { kind: "opening" }
  /** The package brief: the figures, and the members as uniform rows. */
  | { kind: "brief" }
  /** The packages to choose between, when the relationship carries more than
   *  one. Ineligible ones stay visible and disabled. */
  | { kind: "packages" }
  /** WHICH PACKAGE DOES THIS RUN IN — asked BEFORE anything binds, when the
   *  relationship stages more than one and none is anchored. Not a tier: it is
   *  a question waiting on the banker, and a tier fades when the next one
   *  lands. Nothing lands until it is answered. */
  | { kind: "pkgask" }
  /** The lookup, running. */
  | { kind: "lookup" }
  /** A READ QUESTION, ANSWERED FROM THE PACKAGE. Not a proposal and not a
   *  gate: nothing on it is waiting for a decision. */
  | { kind: "read"; card: ReadCardModel }
  /** THE ADVICE TRAVELS WITH THE CHIPS IT IS ABOUT. It is not a block of its
   *  own: an advisory that could collapse while the change it warns about
   *  stayed on screen would be worse than no advisory. */
  | { kind: "chips"; chips: ChipModel[]; advisories?: WorkroomAdvisory[] }
  | { kind: "challenge"; challenge: WorkroomChallenge; acked: boolean }
  | { kind: "reply"; reply: DraftedReply }
  /** THE ROOM REACHED NO ORG. Loud, in glass, with the way out of it. */
  | { kind: "notice"; title: string; body: string }
  | { kind: "dossier"; dossier: DossierModel }
  /** AN EXCHANGE THAT IS OVER (the settle choreography). What settled and how,
   *  in one row, over the exchange it replaced. The exchange is still mounted
   *  under it and the row brings it back. */
  | { kind: "settled"; row: SettledRow; covers: string[] }
  /** A LINE THE ROOM WAS FED (the intent handoff). Not a banker bubble and not
   *  a parse: one marker line saying where the instruction came from. */
  | { kind: "fed"; text: string; from: string }
  /** THE RUNTIME GOT IN THE WAY. Not the org and not the room: the page's own
   *  host refused the call. One quiet line, a way out of it, and NO remark. */
  | { kind: "trouble"; text: string; reload: boolean }
);

/**
 * THE COMPOSED BEAT.
 *
 * An answer that snaps in the same frame as the question reads as a lookup; one
 * that arrives after a held beat of the brand glyph reads as a room composing an
 * answer. A FLOOR, NOT A DELAY: the room waits for the slower of the engine and
 * the beat, so a wired parse that takes two seconds is not made to take two and
 * a half. Under reduced motion the floor is zero and the answer is simply there.
 */
const COMPOSE_FLOOR_MS = 460;
/** How long the package lookup shimmers before the brief lands. */
const LOOKUP_MS = 1500;

/* ------------------------------------------------------ the package question

   VERBATIM SHELL COPY, and the room's answer to the founder's question of
   2026-09-02. One package is not a choice, so the room binds it and says so on
   the header line. Several is a choice, and this is it, asked before the route
   and before a single figure is quoted at package altitude. */
const PACKAGE_QUESTION = "Which package does this run in?";
/** THE MENU TOPICS A LOCKED PACKAGE DROPS (rule 2). Facility Terms is every
 *  line that reshapes a booked facility, which is exactly what an unbooked
 *  version already in flight has claimed. */
const LOCKED_TOPICS = ["terms"] as const;
const PACKAGE_QUESTION_NOTE = "One package is one plan under one approval.";
/** The header's own word for the anchor, in each of the three states. */
const PACKAGE_ONLY = "the relationship's only package";
const PACKAGE_NONE = "no product package on this relationship yet";
/** The status line rotation under the execute mark. */
const STATUS_ROTATE_MS = 1500;
/** The dossier's construction beats (rule 69). */
const DOSSIER_HEADER_MS = 140;
const DOSSIER_LINE_MS = 280;
const DOSSIER_ROW_MS = 300;
const DOSSIER_FOOT_MS = 200;
const DOSSIER_CHECK_MS = 180;
/** ~5s after the card lands, the light breathes out over 1.4s. */
const HALO_LIFE_MS = 5600;

/** THE LONGEST THE HANDOVER MAY TAKE. The slide itself is 520ms; past this the
 *  room hands over regardless of what the compositor did with the transition. */
const HANDOFF_CEILING_MS = 700;

/* ---- the finale's one remaining sentence (founder, 2026-09-03, and 2026-09-06).

   The line that used to sit under the card said what happens NEXT, and the sheet
   says that itself now, under "Who acts next", in the org's own words rather than
   the room's. What is left is the composer's prompt: the change set is closed and
   the room is still here. */
const FILED_PROMPT = "Anything else on this relationship?";
/** The word stagger of the agent's speech (rule 65). */
const WORD_STAGGER_MS = 26;

/**
 * WHICH ENTRY TIER A THREAD ITEM BELONGS TO (the entry choreography).
 *
 * Only the three entry blocks are tiers. Everything the conversation puts in
 * the thread afterwards is an exchange, and an exchange never leaves the stage
 * on a tier's account.
 */
function tierOf(item: ThreadItem): EntryTier | null {
  if (item.kind === "opening") return "question";
  if (item.kind === "packages") return "identity";
  if (item.kind === "brief") return "detail";
  return null;
}

/* ================================================ ONE VOICE PER MOMENT (A)

   FOUNDER, DRIVING THE THIRD PUBLISH: "a lot of chat coming through, like two
   chats simultaneously". Under a staged card he read the room's own paragraph
   AND the model's remark, saying the same thing twice.

   THE CARD IS THE FACT AND THE SENTENCE IS THE JUDGEMENT. Where the model
   speaks under the chips this agent line announced, the agent line steps back
   to the address: what is staged, on which facility, before and after. The
   Before-you-confirm advisory is not part of it and never was - it renders on
   the chip block, it is a CHECK rather than a comment, and it stays.

   AND WHERE THE MODEL DOES NOT SPEAK, NOTHING MOVES. No remark, a decline, a
   rate limit or a timeout leaves the room's own paragraph exactly as it reads
   today. That is why this is keyed on the REMARK and not on the feature. */
function speaksFor(item: ThreadItem, next: ThreadItem | undefined, view: NarrationView | undefined): ThreadItem {
  if (item.kind !== "agent" || next?.kind !== "chips") return item;
  if (!view || (!view.pending && !view.spoke)) return item;
  const address = stagedAddress(next.chips.map((c) => c.delta).filter((d): d is WorkroomDelta => Boolean(d)));
  if (!address) return item;
  return { ...item, text: [address, item.note].filter(Boolean).join(" ") };
}

/** Omit that DISTRIBUTES over the union. A plain `Omit<ThreadItem, "step">`
 *  collapses the discriminated union to its common keys, which makes every
 *  `push` of an agent line an excess-property error. */
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewItem = DistOmit<ThreadItem, "step">;

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

/**
 * THE LINE, AS THE THREAD SHOWS IT.
 *
 * A line the BANKER typed is a banker bubble, as it has always been. A line the
 * room was FED by an intent is not: nobody in this room said it, and drawing it
 * as if they had, then parsing it back at them, was one instruction rendered
 * three times. It becomes one marker line naming where it came from, and the
 * card under it is the room's answer to it.
 */
const bankerLine = (step: number, text: string, from?: string): ThreadItem =>
  from
    ? { kind: "fed", id: nextId("fed"), step, text, from }
    : { kind: "banker", id: nextId("banker"), step, text };

/** The verbs that make a line a REMOVAL, for the one check that has to run before
 *  any removal lane: a removal aimed at a facility this plan is CREATING has no
 *  referent at all, on the org and here. Mirrors `dispatch.ts`'s own list. */
const REMOVAL_ON_CREATED =
  /\b(remove|removing|drop|dropping|delete|detach|unpledge|strike|take\s+off|take\s+out|scrap|exclude|excluding)\b/i;

/** The three routes, as words a reply may NAME while the question is open. The
 *  room is the authority on which words are legal, never the validator. */
const ROUTE_WORDS = new Set<string>(["modify", "renew", "create"]);

/**
 * THE COMMITMENT A MEMBER CHIP PRINTS, read back as a figure.
 *
 * The chip says "$15.0MM". The safety layers need the number behind it, and a
 * room standing on no bundle has nowhere else to get it. A chip carrying no
 * figure ("—") reads as null, and a member with no figure never qualifies.
 */
function printedAmount(text: string): number | null {
  const match = /\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(MM|M|K|B)?/i.exec(text ?? "");
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const suffix = (match[2] ?? "").toUpperCase();
  return base * (suffix === "K" ? 1e3 : suffix === "B" ? 1e9 : suffix ? 1e6 : 1);
}

/** The neutral three-way, built once. It is what "Something else" falls through
 *  to and what a room with no data signal opens on. */
const NEUTRAL_ASK: RouterQuestion = {
  line: NEUTRAL_QUESTION,
  chips: ROUTE_CHIPS.map((c) => ({ label: c.label, route: c.route })),
};

/** The neutral three-way. NO DATA SIGNAL OPENS ON THIS, never on a fabricated
 *  suggestion — the channel-none doctrine, applied to the greeting slot. */
export const neutralAsk = (): RouterQuestion => NEUTRAL_ASK;

/** The question a deal signal opens on: the insight the engine derived, the yes
 *  it implies, and the way out of it. */
export function smartAsk(opening: SmartOpening): RouterQuestion {
  return {
    line: opening.line,
    chips: [
      { label: opening.yesLabel, route: opening.route, memberId: opening.memberId },
      { label: SOMETHING_ELSE, route: null },
    ],
  };
}

/**
 * WHY A MEMBER CANNOT BE WORKED ON, in the strip's own words.
 *
 * The member already carries the org's stage as its tag, so this states that
 * rather than inventing a second vocabulary for it. The one tag that is not a
 * stage is the honest "Stage not staged" fallback, which reads as a sentence on
 * its own and must not be suffixed into "Stage not staged stage".
 */
function ineligibleReason(m: PackageMember): string {
  return /not staged/i.test(m.tag) ? `${m.tag} in this read - not modifiable` : `${m.tag} stage - not modifiable`;
}

/**
 * A block is LIVE while something in it is still waiting on a DECISION.
 *
 * A PROPOSAL IS A GATE; A REFUSAL IS AN ANSWER (founder, 2026-09-01). An open
 * delta card is holding Confirm and Discard and the room genuinely cannot take
 * a new instruction past it. A refusal card holds neither — it staged nothing,
 * it says why, and its "Understood" is a courtesy. Counting it as a gate meant
 * one unreadable line poisoned everything after it: the room answered every
 * subsequent question with "one decision at a time" over a card that was never
 * a decision, and pinned that step open while the thread grew underneath it.
 * That is the accumulation the founder saw.
 */
/* ============ THE RUNTIME IS NOT THE BANK (founder, 2026-09-03)

   He clicked Review and execute and read: an error line from the artifact
   runtime saying the call was outside the scope he had consented to, and then
   TWO model remarks underneath it, each explaining the repricing as if nothing
   had gone wrong.

   THE ROOM HAD NO WAY TO TELL THE THREE VOICES APART. An org refusal, a runtime
   failure and the room's own sentence were all `agent` bubbles, so the runtime's
   failure was narratable like any other line and a retry produced a second one.

   A RUNTIME FAILURE IS NOT A SENTENCE A COLLEAGUE COMMENTS ON. It is the host
   saying it will not carry the call, and the only useful thing beside it is the
   way out. It gets its own kind, it is never narrated, and it HUSHES the model
   for the rest of the exchange: the banker has one thing to do and a paragraph
   about credit is in the way of it.

   AN ORG REFUSAL IS THE BANK TALKING and stays exactly where it was. The test
   is the message, because the codes reach this room already rendered into it. */
const RUNTIME_TROUBLE =
  /outside the scope|consented to|reload the cockpit|reload to review|paused ai chat|not authorised to call|needs? per-call approval|reconnect .* in claude\.ai|add .* in claude\.ai|running without connector access|too many connector calls|rate.?limit/i;

/** Does this error come from the page's own host rather than from the org? */
export function isRuntimeTrouble(said: string): boolean {
  return RUNTIME_TROUBLE.test(said ?? "");
}

/** Does the way out of it involve reloading the view? */
const RELOADABLE = /reload|consented to|outside the scope|paused ai chat/i;

function isLive(item: ThreadItem): boolean {
  if (item.kind === "chips") return item.chips.some((c) => c.state === "open" && !!c.delta);
  if (item.kind === "challenge") return !item.acked;
  return false;
}

/**
 * SOMETHING WAITING ON THE BANKER (the stage cap, founder 2026-09-03).
 *
 * Wider than {@link isLive}, which is about GATES - what stops a new
 * instruction. This is about WEIGHT: a question with its answers on the table
 * is not a gate (the banker may type past it) and it is absolutely something
 * they still have to deal with. At most two of these are ever on the stage.
 */
function asksSomething(item: ThreadItem): boolean {
  if (item.kind === "chips") return item.chips.some((c) => c.state === "open");
  if (item.kind === "challenge") return !item.acked;
  if (item.kind === "agent") return !!item.options?.length;
  return false;
}

/** THE AGENT SPEAKS, NEVER PASTES (rule 65). Each word condenses out of the
 *  glass 26ms after the one before it. Whitespace stays as plain text nodes, so
 *  `textContent` is byte-identical to the sentence the engine handed over. */
function Words({ text, offset = 0 }: { text: string; offset?: number }) {
  const parts = useMemo(() => text.split(/(\s+)/).filter((p) => p !== ""), [text]);
  let n = offset - 1;
  return (
    <>
      {parts.map((part, i) => {
        if (/^\s+$/.test(part)) return part;
        n += 1;
        return (
          <span className="wk-w" style={{ animationDelay: `${n * WORD_STAGGER_MS}ms` }} key={i}>
            {part}
          </span>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------- the acknowledgment */

const ACKNOWLEDGMENT = /^(acknowledged|acknowledge|accepted|understood|noted|ack)\b[\s,.;:!\u2014-]*/i;

/** Words that mean "carry on" and name no change. A courtesy after an
 *  acknowledgment has said everything it came to say once the checks settle;
 *  sending it to the parser would answer it with "I could not read that". */
const CARRY_ON = ["proceed", "go ahead", "go on", "continue", "carry on", "next", "please", "thanks", "thank you", "ok", "okay"];

/** An acknowledgment, and whatever the banker went on to say after it. Null
 *  where the line is not one. */
function readAcknowledgment(text: string): { rest: string } | null {
  const line = text.trim();
  const match = ACKNOWLEDGMENT.exec(line);
  if (!match) return null;
  const rest = line.slice(match[0].length).trim();
  return { rest: CARRY_ON.includes(rest.toLowerCase().replace(/[.!,]+$/, "")) ? "" : rest };
}

/**
 * Did the plan leave the room before this failed?
 *
 * The engine stamps the refusal it raises once the execute call is away; a token
 * the org reports as already redeemed says so in its own words. Either way the
 * write may have landed and the approval must not be offered again.
 */
function reachedTheOrg(e: unknown): boolean {
  if ((e as { dispatched?: unknown } | null | undefined)?.dispatched === true) return true;
  const code = (e as { code?: unknown } | null | undefined)?.code;
  const text = `${typeof code === "string" ? code : ""} ${readableError(e)}`.toLowerCase();
  return /token_refused|already been used|already redeemed/.test(text);
}

/**
 * TRUE where nothing can have been written, so there is nothing to wait for.
 *
 * Two shapes qualify and no others. A refusal the engine raised BEFORE it
 * dispatched carries `dispatched: false` — it says so about itself. And a room
 * that never had an org to reach carries the channel-none codes. Anything else,
 * a timeout above all, may have filed: `undefined` is not `false`, and the whole
 * point of the wait is that an ambiguous transport outcome is not evidence.
 */
function nothingWasFiled(e: unknown): boolean {
  return neverReachedTheOrg(e) || (e as { dispatched?: unknown } | null | undefined)?.dispatched === false;
}

/* =============== IS THIS A PLAN, OR ONLY THE SHAPE OF ONE? (2026-09-05)

   FOUND BY THE CHAOS PROBE, garbage-on-stage. A connector that answers the
   staging call with a payload of the wrong shape produced a staging object the
   room accepted: the compile card resolved, the approve control rendered
   (disabled, because there was no token in it), and the room said NOTHING. A
   banker looking at that sees a plan that will not go, with no reason given.

   A PLAN IS A DECISION TOKEN AND AT LEAST ONE STEP. Both come off the org and
   neither can be inferred, so their absence is the whole test. Checked in the
   room rather than in the engine because the engine is byte-fenced, and checked
   after staging rather than at render because a control that is quietly dead is
   the defect this closes. */
const isReadablePlan = (staged: StagedWorkroomPlan | null | undefined): boolean =>
  Boolean(staged?.decisionToken) && Array.isArray(staged?.plan?.steps) && (staged?.plan?.steps?.length ?? 0) > 0;

/** WHAT THE ROOM SAYS TO A PLAN IT CANNOT READ. It names the two things that
 *  were missing, states the one fact staging's zero-DML contract makes safe,
 *  and offers the two moves. No stack, no code, no apology. */
const UNREADABLE_PLAN =
  "The org answered the staging call with something I could not read: there is no decision token and no steps in it, " +
  "so there is no plan here to put up. Staging writes nothing, so nothing has been filed and the manifest is exactly as you left it.";

/* =============== IS THIS A FILING, OR ONLY THE SHAPE OF ONE? (2026-09-05)

   FOUND BY THE SAME PROBE, garbage-on-execute. A malformed execute result
   carried an empty `filed` list through to the dossier, and the room lit the
   afterglow: "Close workroom / Draft the credit memo", which is the room
   claiming a write the org never confirmed. That is the one thing this cockpit
   may never do.

   AN EXECUTION IS A `filed` LIST. Not a long one, necessarily: a plan can file
   one row. But a result with no list at all is a result the room cannot read,
   and an unreadable result is not evidence of a filing. */
const isReadableExecution = (landed: WorkroomExecution | null | undefined): boolean =>
  Array.isArray(landed?.filed) && landed.filed.length > 0 && landed.filed.some((f) => Boolean(f.recordId));

/** WHAT THE ROOM SAYS TO A RESULT IT CANNOT READ. It claims nothing either way
 *  and it sends the banker to the record that knows. */
const UNREADABLE_EXECUTION =
  "The org answered the filing call with something I could not read, so I will not tell you what it did. " +
  "The staging record holds the outcome: ask me to check it and I will read it back. Nothing needs approving again.";

/** TRUE where the room never reached an org at all. THE CHANNEL-NONE DOCTRINE:
 *  no connector means no plan, nothing simulated, and no token ever burnt. This
 *  is the one failure that earns a surface of its own rather than a sentence in
 *  the flow of the conversation — a banker who cannot tell "not connected" from
 *  "something went wrong" will retry a room that can never answer. */
function neverReachedTheOrg(e: unknown): boolean {
  const code = (e as { code?: unknown } | null | undefined)?.code;
  if (code === "server_not_connected") return true;
  return /not connected to the bank's systems|no connector|no org to stage against/i.test(readableError(e));
}

/* ------------------------------------------------------------- peek bodies */

function SourceIcon({ icon }: { icon: SourceChip["icon"] }) {
  const paths: Record<SourceChip["icon"], ReactNode> = {
    email: (
      <>
        <path d="M1.2 2.6h9.6v6.8H1.2z" stroke="currentColor" strokeWidth="1.1" fill="none" />
        <path d="M1.4 3l4.6 3.4L10.6 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" fill="none" />
      </>
    ),
    package: (
      <>
        <path d="M6 1.2l4.4 2.3v5L6 10.8 1.6 8.5v-5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" fill="none" />
        <path d="M1.8 3.6L6 5.9l4.2-2.3M6 5.9v4.7" stroke="currentColor" strokeWidth="1.1" fill="none" />
      </>
    ),
    collateral: (
      <>
        <path d="M1.6 4.2h8.8v5.2H1.6z" stroke="currentColor" strokeWidth="1.1" fill="none" />
        <path d="M3.6 4.2V2.6h4.8v1.6" stroke="currentColor" strokeWidth="1.1" fill="none" />
      </>
    ),
    covenants: (
      <>
        <path d="M6 1.6v8.8M2.2 3.6h7.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" fill="none" />
        <path d="M2.2 3.6L.9 6.6h2.6zM9.8 3.6L8.5 6.6h2.6z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" fill="none" />
      </>
    ),
    calendar: (
      <>
        <path d="M1.6 2.8h8.8v7.2H1.6z" stroke="currentColor" strokeWidth="1.1" fill="none" />
        <path d="M1.6 5h8.8M4 1.6v2.2M8 1.6v2.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" fill="none" />
      </>
    ),
    account: (
      <>
        <circle cx="6" cy="4.2" r="2.1" stroke="currentColor" strokeWidth="1.1" fill="none" />
        <path d="M1.9 10.4c0-2.3 1.8-3.6 4.1-3.6s4.1 1.3 4.1 3.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" fill="none" />
      </>
    ),
  };
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      {paths[icon]}
    </svg>
  );
}
function HaveRows({ rows }: { rows: HaveRow[] }) {
  return (
    <>
      {rows.map((row, i) => (
        <div className="wk-have-row" key={`${row.label}-${i}`}>
          <div className="wk-l">{row.label}</div>
          <div className="wk-v">{row.value}</div>
          <div className="wk-d">{row.detail}</div>
        </div>
      ))}
    </>
  );
}
/** A source chip's rows, whether the engine read them from the org or the shell
 *  engine addressed them by key in the fixture. */
function sourceRows(chip: SourceChip): HaveRow[] {
  return chip.have ?? (chip.rows ?? []).map((k) => HAVE[k]).filter(Boolean);
}
function OrgMap({ delta, filedNote }: { delta: WorkroomDelta; filedNote?: string }) {
  return (
    <>
      <div className="wk-mapbox">
        <div className="wk-h">The org records this writes</div>
        {delta.map.map(([k, v]) => (
          <div className="wk-r" key={k}>
            <span className="wk-k">{k}</span>
            <span className="wk-v">{v}</span>
          </div>
        ))}
        <div className="wk-fields">
          {delta.fields.map((f) => (
            <code key={f}>{f}</code>
          ))}
        </div>
      </div>
      {delta.caveat && <div className="wk-cav">{delta.caveat}</div>}
      {filedNote && <div className="wk-saynote">{filedNote}</div>}
    </>
  );
}
function ChallengeMath({ challenge }: { challenge: WorkroomChallenge }) {
  return (
    <>
      <div className="wk-math">
        {challenge.rows.map(([label, value, cls], i) => (
          <div className={`wk-mrow ${cls ? `wk-${cls}` : ""}`} key={i}>
            <span className="wk-l">{label}</span>
            <span className="wk-v tnum">{value}</span>
          </div>
        ))}
      </div>
      <div className="wk-saynote">{bankerly(challenge.say)}</div>
    </>
  );
}
function MemberCards({ members }: { members: PackageMember[] }) {
  return (
    <div className="wk-mgrid">
      {members.map((m) => (
        <div className={`wk-mcard ${m.proposed ? "wk-prop" : ""}`} key={m.key}>
          <span className="wk-tag">{m.tag}</span>
          <div className="wk-k">{m.key}</div>
          <div className="wk-p">{m.product}</div>
          <div className="wk-a tnum">{m.amount}</div>
          <div className="wk-o">{m.detail}</div>
          {m.utilisation !== undefined && (
            <>
              <div className="wk-meter">
                <i style={{ width: `${m.utilisation}%` }} />
              </div>
              <div className="wk-util">
                <span>{m.utilisation}% drawn</span>
                <span>{m.available}</span>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function ClientEmail() {
  return (
    <>
      <div className="wk-prov">Interpreted on entry. Package re-queried and the analysis pre-run at 09:02.</div>
      <div className="wk-prose">
        {CLIENT_EMAIL.map((seg, i) =>
          seg.parsed ? (
            <span className="wk-hl" key={i}>
              {seg.text}
            </span>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </div>
    </>
  );
}

/* ================================================================= the room */

export function Workroom({
  context,
  engine,
  router,
  eligibleMemberIds,
  reads,
  onOpenAssist,
  brain,
  instanceUrl,
  approverUserId,
  onFiled,
  onClose,
  onDraftMemo,
  onDraftMemoLanded,
  onAnchor,
  onExecuted,
  settleDeps = LIVE_SETTLE,
}: {
  context: WorkroomContext;
  /** The Salesforce USER ID for the writes. Resolved by the host from
   *  `meta.userId`; `context.approver` is the display name in this seat. */
  approverUserId?: string;
  /**
   * THE MEMBERS A CREDIT ACTION CAN RUN AGAINST, by loan id.
   *
   * Read from the SAME `bookedFacilities` the engines gate on (data/
   * facilityStage.ts), resolved by WorkroomHost where the bundle lives — not
   * re-derived here. A second copy of "what is eligible" in the presentation
   * layer is the next thing to drift out of step with the engine that refuses.
   *
   * Absent for callers with no bundle behind them (the render tests, the shell
   * engine), and the strip then falls back to the member's OWN `proposed` flag,
   * which the engine set from the org's stage on the same rule.
   */
  eligibleMemberIds?: ReadonlySet<string>;
  /**
   * THE READ A QUESTION IS ANSWERED FROM.
   *
   * The bundle the room is already standing on, handed down so a read question
   * is answered from what the room HOLDS rather than sent to a parser that can
   * only propose changes. Absent means the room has no read behind it and every
   * read question gets the honest account of what it can do instead — which is
   * the shell engines, and is still better than a refusal about members.
   */
  reads?: ReadSource;
  /**
   * OPEN THE ASSIST, WITH THE QUESTION ALREADY IN IT.
   *
   * The mail tier's chip hands the correspondence to the desk rather than
   * pretending the workroom can read a thread. Absent for callers with no app
   * provider above them, and the chip then does not render: a control that
   * cannot do its one thing has no business being on screen.
   */
  onOpenAssist?: (prompt: string) => void;
  /**
   * THE BRAIN LANE — the room's second lane.
   *
   * The deterministic parser is the FAST LANE and it is untouched. This is
   * where a line the fast lane cannot claim goes: every question the guard
   * catches, and every line the parser hands back unparsed. It is the
   * artifact<->session bridge, and it answers in exactly one of the three
   * contract shapes (channel/brainLane.ts).
   *
   * ABSENT IS NO BRAIN LANE, and that is a real state, not a degraded one: with
   * no connector the composer keeps the fast lane, the loud notice stands, and
   * a routed question is answered honestly rather than left hanging on a bridge
   * that was never there.
   */
  brain?: (envelope: BrainEnvelope) => Promise<BrainReply>;
  /** The org's own Lightning host, for the dossier's link to the package the
   *  plan filed against. Absent renders NO link (A29), never a guessed host. */
  instanceUrl?: string;
  /**
   * A PLAN FILED. The room hands over what it holds at dossier time — nothing
   * is read back from the org for this — and the caller writes the Activity
   * trail entry, exactly as the Action Panel does for a panel action (A30).
   */
  onFiled?: (filed: {
    execution: WorkroomExecution;
    changeCount: number;
    /** Of `changeCount`, what the banker typed vs what the pricing gate
     *  added on its own (Cowork feedback, 2026-09-03). See `derivedDelta.ts`. */
    requestedCount?: number;
    derivedCount?: number;
    packageHref: string | null;
    /** What the org arms did, in banker language, or null where none rode. */
    arms: string | null;
    /** What the plan says about the four fields nCino prices on, or null where
     *  every facility that moved carries the amortised term and the first
     *  payment date. A facility left for later writes no record, so this is the
     *  only place the trail can carry that decision. */
    pricing: string | null;
  }) => void;
  /** Present only for the UNIFIED entry, where the room was opened on a
   *  relationship rather than on a route. Absent for every caller that already
   *  named a mode — the command palette, a deep link, a render test — and the
   *  room then behaves exactly as it always has. */
  router?: WorkroomRouter;
  /** The room talks to ONE interface and never to a script, a tool or a parser.
   *  Which implementation arrives is WorkroomHost's decision, not the shell's. */
  engine: WorkroomEngine;
  onClose: () => void;
  /**
   * THE MEMO DOOR ON THE FILED SHEET, and the two things it carries.
   *
   * The room hands over the SAME filed lines the sheet is showing AND the sheet
   * itself, so the memo room can state the exact change set - and redraw the
   * sheet as its own first timeline row - in the seconds before the org read
   * catches up. Absent leaves the sheet with the way back and nothing hollow.
   */
  onDraftMemo?: (filed: readonly FiledLine[], sheet: FiledSheetModel) => void;
  /**
   * THE HANDOFF GLASS HAS SETTLED.
   *
   * `onDraftMemo` MOUNTS the memo room under the sheet; this says the sheet has
   * finished sliding off it, which is the moment the memo may start drafting and
   * the moment this room may close. Two calls rather than one because the slide
   * belongs to this room and the drafting belongs to the other, and a room that
   * closed itself on the first call would take the slide with it.
   */
  onDraftMemoLanded?: () => void;
  /** The banker chose which package to work in. The room does not anchor
   *  itself: it is REOPENED on the chosen package, which rebuilds the engine and
   *  the manifest with it. */
  onAnchor?: (choice: PackageChoice) => void;
  /**
   * WRITE-BACK THROUGH THE GLASS (rule 62). The room hands the executed
   * commitment delta to the cockpit, which rolls its own figures behind the
   * blur while the room is still open. The room does NOT reach into the
   * cockpit's state itself: it has no provider above it in the render test, and
   * a room that dispatched would also rebuild its own engine mid-scene.
   */
  /** `newPackage` is true where the filing OPENED one rather than adding to a
   *  package that already existed: the cockpit's pending chip says which. */
  onExecuted?: (committedDeltaMM: number, newPackage: boolean) => void;
  /** THE WAIT, INJECTED, for the same reason the engine is: the room is testable
   *  against a scripted org and ships against the live action trail. */
  settleDeps?: SettleDeps;
}) {
  const brief = useMemo(() => engine.brief(context), [engine, context]);
  const packageChoiceCount = brief.packageChoices.length;
  /* CHIPS ARE NOT ALWAYS A QUESTION (founder, 2026-09-06). A modification on a
     relationship staging several packages genuinely cannot compose until one is
     picked, and that beat is untouched. A CREATE's chips are an OFFER: the plan
     already stands on a new package, so the composer wakes, the facilities land
     and the offer sits open beside them. The engine owns which of the two this
     is, because the engine is what knows where the plan stands. */
  const packageChoiceBlocks = packageChoiceCount > 0 && brief.packageChoiceRequired;
  /* ---- WHICH PACKAGE DOES THIS RUN IN (founder, 2026-09-02: "why does it know
          that we are talking about this package... what happens on multiple
          ones?").

          THE ROSTER IS ROUTE-NEUTRAL AND IT IS ASKED FIRST. The engines' own
          `packageChoices` marks a package ineligible when no member of it is
          booked, which is the right rule for a modification and the wrong one
          for a question asked before the route is picked: a package no
          modification can touch still takes a new facility. So the ask lists
          every package the relationship stages, and eligibility stays on the
          route's own card where it always was.

          ONE PACKAGE BINDS SILENTLY, exactly as it does today. `mustChoosePackage`
          is false for the whole shipped book, so the room the founder demos is
          byte-identical through this beat. */
  const roster = useMemo(() => packageRoster(reads?.bundle ?? null, reads?.history), [reads?.bundle, reads?.history]);
  /* AND A CREATE NEVER ASKS IT AT ALL. The pre-route question exists because a
     modification has to know which package it is versioning; a new facility
     creates a new package, so the relationship's existing ones are an offer the
     create engine makes further down and never a gate at the door. */
  const packagePending =
    context.mode !== "create" && mustChoosePackage(reads?.bundle ?? null, context.productPackageId);
  /* ONE MODIFICATION IN FLIGHT PER PACKAGE (rule 2, founder 2026-09-03). The
     package this room stands in already has an unbooked modification version
     with the org, so a second one would fork the version chain. Null wherever
     the room is free to run, which is every relationship in the shipped book. */
  const locked = useMemo(() => lockedSourcePackage(roster, context.productPackageId), [roster, context.productPackageId]);
  /** The version's own nCino record, for the chip on the refusal. Null with no
   *  org address on the view — a guessed host is worse than no link (A29). */
  const lockedHref = locked?.inFlightVersionId ? packageDeepLink(instanceUrl, locked.inFlightVersionId) : null;
  /** THE TWO ROUTES A LOCK REFUSES. A new facility of its own forks nothing —
   *  it joins a package rather than versioning it — and the relationship room's
   *  reviews write no package version at all. */
  const lockedRoute = useCallback(
    (route: WorkroomMode) => !!locked && (route === "modify" || route === "renew"),
    [locked],
  );
  /** The facility read, narrowed to the anchor. Everything that scopes to
   *  facilities reads this rather than the relationship's whole exposure. */
  const scopedFacilities = useMemo(
    () => facilitiesInPackage(reads?.bundle?.exposure?.facilities ?? [], context.productPackageId),
    [context.productPackageId, reads?.bundle],
  );
  const vocabulary = useMemo(() => vocabularyFor(context), [context]);
  const reduced = prefersReducedMotion();
  const isEligible = useCallback(
    (m: PackageMember) => (eligibleMemberIds ? eligibleMemberIds.has(m.id) : !m.proposed),
    [eligibleMemberIds],
  );

  /* ---- THE TWO QUIET TIERS (founder, 2026-09-01). The overdue test is
          derived from the covenant rows the room already holds; the mail is
          asked of the channel once, in the background, and stays null through
          every failure. Both render NOTHING where there is nothing to say. */
  const overdue = useMemo(
    () => overdueCovenantTip({ bundle: reads?.bundle ?? null, today: reads?.generatedAt ?? "" }),
    [reads?.bundle, reads?.generatedAt],
  );
  /* ONE MAIL READ, TWO CONSUMERS (founder, 2026-09-02: the client's mail is
     baked into the greeting). `useClientMail` makes the SAME single
     `outlook_email_search` the tier used to make on its own, and hands back
     both the note the envelope carries and the hits this tier is shaped from.
     Net connector traffic for a room open is unchanged. */
  const {
    note: mailNote,
    hits: mailHits,
    gate: mailGate,
  } = useClientMail({
    accountName: context.accountName,
    bundle: reads?.bundle ?? null,
    generatedAt: reads?.generatedAt ?? "",
    /* THE ROOM SAYS WHERE THE WORK CAME FROM. An intent carried in from another
       conversation, or the trail's own message the banker just opened the room
       on: both are the reason the room is open, so both outrank the mailbox
       contest. Null for every room the banker opened themselves, and the
       greeting is then byte-identical to the one it has always composed. */
    intentNote: carriedMailFor(context.accountId) ?? intentMailNote(intentFor(context.accountId)),
  });
  const mail = useMemo(
    () => mailTipFrom({ hits: mailHits, accountName: context.accountName, today: reads?.generatedAt ?? "" }),
    [mailHits, context.accountName, reads?.generatedAt],
  );

  /** THE ROUTE IS STILL OPEN. Non-null while the room is asking which of the
   *  three this is; the answer clears it and nothing puts it back. */
  const [ask, setAsk] = useState<RouterQuestion | null>(() => router?.question ?? null);

  /** Rule 44: the bar carries ONE word. The room's own name minus the noun the
   *  room already is; the app bar carries the brand. An UNBOUND room has no
   *  mode to name yet, and naming the provisional one would be a claim about a
   *  decision the banker has not made. */
  const title = ask ? "Facility Actions" : vocabulary.title;
  const roomWord = title.replace(/\s*Workroom$/i, "");
  /** The lane's kicker. It names the change set, and an unbound room does not
   *  know yet what kind of change set this is — "This modification" over an
   *  empty rail in a room still asking would answer its own question. */
  const manifestHeading = ask ? "This package" : vocabulary.manifestHeading;

  const roomRef = useRef<HTMLDivElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  /** The router, reachable from the ritual effect without putting a prop object
   *  that is rebuilt on every parent render into that effect's deps — which
   *  would restart the ritual mid-conversation. */
  const routerRef = useRef(router);
  routerRef.current = router;

  const [items, setItems] = useState<ThreadItem[]>([]);
  const [step, setStep] = useState(0);

  /**
   * THE ROUTE IS REFUSED, OUT LOUD, WITH THE VERSION NAMED (rule 2).
   *
   * ONE SENTENCE AND ONE DOOR. The room does not offer a way to proceed,
   * because there is no honest one: the fork has to be resolved in nCino, by
   * booking the version or discarding it. The question STAYS on the glass, so
   * the banker can still take the routes a lock does not close — a new facility
   * of its own, or a relationship review.
   *
   * Returns true when it refused, so every caller reads as a guard.
   */
  const sayInFlightRefusal = useCallback(() => {
    const mine = step + 1;
    setStep(mine);
    setItems((prev) => [
      ...prev,
      {
        kind: "agent",
        id: nextId("locked"),
        step: mine,
        text: IN_FLIGHT_REFUSAL,
        link: lockedHref ? { href: lockedHref, label: "Open the version in Salesforce" } : undefined,
      },
    ]);
  }, [lockedHref, step]);

  const refuseLockedRoute = useCallback(
    (route: WorkroomMode): boolean => {
      if (!lockedRoute(route)) return false;
      sayInFlightRefusal();
      return true;
    },
    [lockedRoute, sayInFlightRefusal],
  );

  const [histOpen, setHistOpen] = useState(false);
  const [entries, setEntries] = useState<WorkroomDelta[]>([]);
  const [execution, setExecution] = useState<WorkroomExecution | null>(null);
  const [suggestion, setSuggestion] = useState<WorkroomSuggestion | null>(null);
  /** The brief has landed; the composer and the suggestion wake (rule 30). */
  const [awake, setAwake] = useState(false);
  const [phase, setPhase] = useState<"work" | "filed">("work");
  /** The member the conversation is standing on, so the lane can show it. */
  const [focused, setFocused] = useState<PackageMember | null>(null);
  /**
   * THE CREATE BEING GATHERED. Non-null while the room is asking what a create
   * still needs; it becomes chips the moment nothing is missing and it is never
   * a form. A create that has not resolved never reaches a chip (D1), so this
   * is where an underspecified one waits instead.
   */
  const [creating, setCreating] = useState<Draft | null>(null);
  /**
   * WHICH CREATE PRODUCED WHICH CHIP.
   *
   * A card is amendable, and a staged entry is amendable, so the room has to be
   * able to get back from a delta to the create that composed it. Held in a ref
   * rather than in state because it is a lookup, never a render input.
   */
  const draftsRef = useRef(new Map<string, Draft>());
  /** The room just offered the facilities as chips, so a bare facility name is
   *  the answer to that question rather than an instruction with nothing on it. */
  const [steerPending, setSteerPending] = useState(false);
  /* ================== THE FOUR FIELDS nCINO PRICES ON (founder, 2026-09-02)

     A modification that moves the amount or the term leaves a version nobody
     can price unless the amortised term and the first payment date are set too.
     `pricingPending` is the slot the room asked the banker to type a figure
     for; `pricingDeclined` is the facilities they chose to leave for later, and
     that choice is recorded on the plan rather than asked again every turn. */
  const [pricingPending, setPricingPending] = useState<PricingNeed | null>(null);
  const [pricingDeclined, setPricingDeclined] = useState<ReadonlySet<string>>(() => new Set<string>());
  /* THE RATE GATE'S OWN STATE (founder, 2026-09-03). `rateHeld` is the
     facilities whose rate the banker chose to KEEP - an answer that stages
     nothing, so nothing on the plan can record it and the room has to remember
     that it asked and was answered. `rateIndex` is the index a banker said they
     price off, held until the all-in figure lands so the card can note it. */
  const [rateHeld, setRateHeld] = useState<ReadonlySet<string>>(() => new Set<string>());
  /* ============ THE MANIFEST, READ SYNCHRONOUSLY (founder, 2026-09-03)

     "It kind of forgets to add the commitment to the modification sometimes."
     THE CAUSE: `confirmChip` built the next manifest from the `entries` it had
     CLOSED OVER and set the whole array, so two confirms landing from the same
     render - the commitment card and the pricing card the same gesture raised,
     which the settle choreography now lands a beat apart - both started from
     the manifest as it stood BEFORE either of them, and the second one's array
     replaced the first one's entry with nothing.

     Every path that adds to the manifest reads and writes THIS ref, which is
     updated in the same statement as the state, so a second confirm in the same
     tick composes with the first instead of overwriting it. */
  const entriesRef = useRef<WorkroomDelta[]>([]);

  /* ===================================== THE PLAN OUTLIVES THE PAGE (2026-09-05)

     The engine already remembers a CLOSE: `engine.resume()` hands the manifest
     back when the room reopens on the same package. It cannot remember a
     RELOAD, because that memory is a module in this page. These three refs are
     the half that can.

     `planSaidRef` is the banker's own instructions, and only the ones that put
     something on the manifest: a question, a chip and a refused line are not
     plan. `lastSaidRef` is the line in flight, held until the manifest moves,
     which is the only honest way to know which line earned which card without
     asking every composer to report itself. `planOfferRef` is the document the
     store handed back, so the offer's two chips can act on it. */
  const planSaidRef = useRef<string[]>([]);
  const lastSaidRef = useRef<string | null>(null);
  const planOfferRef = useRef<StagedPlanDoc | null>(null);
  const openFlowRef = useRef<() => void>(() => {});
  /* THE IN-FLIGHT LOCK, SET IN THE SAME TICK AS THE GESTURE (feedback item 12).
     `filing` is React state and a second click inside the same commit reads the
     value the first one saw. A ref is set synchronously, so the second click
     lands on a lock that is already closed. */
  const filingRef = useRef(false);
  /** WHY THE PRICING GATE RAN, by facility: the entry that made it necessary.
   *  Checked again at approve time, because a plan that lost the change the
   *  pricing was FOR is a version nobody meant to file. */
  const pricingCause = useRef(new Map<string, { id: string; title: string; target: string }>());
  /* ============ AND WHAT THE GATE PRODUCED (founder, 2026-09-03, 12:15)

     Staging record a8abb00001O2gwGAAR: twenty two steps and NO rate anywhere in
     them. He had answered the rate ask by typing "Yes, 7.25% all-in", the card
     had shown 7.25%, and the $20M clone read 7.6 in the org afterwards.

     THE WIRE WAS NEVER THE PROBLEM. `ratePlan.render.test.ts` holds it: the
     composed sentence parses to `requestedRate`, and `requestedRate` reaches the
     payload beside the two pricing FIELDS. What happened is simpler and worse -
     THE CARD WAS NEVER CONFIRMED. A pricing answer stages a card like any other
     line, the card waits for a Confirm, and nothing anywhere checked that the
     answer the banker gave had actually become an entry.

     SO EVERY CARD THE GATE PRODUCES IS REMEMBERED HERE, and approve refuses
     until each of them is on the plan or off the glass. An answer that reached a
     card and then went missing is the one failure this room may not have: the
     banker answered, the room drew the figure, and the org filed without it. */
  const pricingAnswered = useRef(new Map<string, { id: string; title: string; target: string }>());
  const rateIndexOf = useRef(new Map<string, RateIndex>());
  /** Which facilities have already heard the "no index name" aside. Once each. */
  const rateIndexSaid = useRef(new Set<string>());
  /** The room is composing an answer. It drives the beat, and it holds the
   *  review chip closed: a chip that appeared for one frame between a confirm
   *  landing and the check it trips is an approval offered too early. */
  const [thinking, setThinking] = useState(false);
  /** The review card is open, and what it is holding. */
  /* `held` NAMES THE STAGED ARMS THE ORG'S PLAN DOES NOT CARRY A STEP FOR, and
     it is a GATE rather than a sentence: while it is non-empty the approval is
     closed and `execute` refuses, because a plan that does not contain the
     banker's exclusion must never be executable from the card that claims it. */
  const [flow, setFlow] = useState<null | {
    staging: StagedWorkroomPlan | null;
    running: boolean;
    status: number;
    held: string[];
  }>(null);
  /** The approval is in flight; a second click would stage behind the first. */
  const [filing, setFiling] = useState(false);
  /** THE APPROVAL IS CLOSED FOR THIS PLAN. The call reached the org and the
   *  answer did not come back clean, so the token may be spent and the write may
   *  have landed. The honest move is to stop offering the gesture and say why. */
  const [sealed, setSealed] = useState(false);
  const [draft, setDraft] = useState("");
  /** The composer input, so the plus menu can write into it and land the caret
   *  on the placeholder it left behind. */
  const composerRef = useRef<HTMLInputElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** The halo is execute's ONLY light, and it breathes out ~5s after landing. */
  const [lit, setLit] = useState(false);
  /** THE LOOKUP CAME BACK. The tiers below it are earned one at a time from
   *  here; before it the stage carries the question and nothing else. */
  const [lookedUp, setLookedUp] = useState(false);
  /** The tiers under the question have been claimed for this ritual. */
  const tieredRef = useRef(false);
  /** THE CAPABILITY LIST IS SAID ONCE PER ROOM OPEN (founder, 2026-09-03). What
   *  this room can file is orientation, and orientation is a thing you need the
   *  first time. It rides the first focus prompt and never appears again. */
  const capabilitiesSaid = useRef(false);
  /** WHICH FACILITIES HAVE ALREADY HEARD WHY nCINO WANTS THE PRICING FIELDS.
   *  The reason is the same reason on both of a facility's two questions. */
  const pricingWhySaid = useRef(new Set<string>());
  /** HAS THE VERSION PARAGRAPH BEEN SAID ON THIS PLAN? Once, under the first
   *  card, in one sentence. */
  const versionSaid = useRef(false);
  const choreo = useEntryChoreography(reduced);
  const { arrive: tierArrived, retire: retireTiers, reset: resetTiers } = choreo;
  /* ================================================ THE SETTLE CHOREOGRAPHY

     An exchange that has been decided leaves the stage in the room's own exit
     and one compact row takes its place (founder, 2026-09-03). The room keeps a
     ref of the thread so the settle can name the items it covers WITHOUT the
     callbacks that settle depending on the thread's identity: they are rebuilt
     on every commit as it is, and a settle that re-created `confirmChip` on
     every item would be the whole thread re-rendered per word of speech. */
  const settle = useSettleChoreography(reduced);
  /* ================================================== THE FILED FINALE (rule 69)

     The filing is the END of the change set, and until 2026-09-03 the room read
     like the middle of one: the card was appended and the settled rows, the
     greeting remnants, the staged cards in the rail and the composer all held
     their place. The room exhales now, the card ascends alone, and one quiet
     line with two doors sits under it. See ./finale.ts for the beats.

     IT IS DRIVEN OFF THE PHASE AND NOTHING ELSE. Execute is untouched: the
     effect below reads the thread the commit that set `filed` produced, which
     is also what makes a line arriving LATER - the purpose footnote - land
     under the card instead of inside the drain. */
  const finale = useFinale(reduced);
  const { begin: beginFinale, exitOf: finaleExit, state: finaleState } = finale;
  /* ================================================= THE CARD BECOMES THE SHEET

     FOUNDER, 2026-09-06: "I liked the rainbow card morphing into this but I need
     a clean room at the end when it's done with a clean Summary screen."

     The card is the moment; the sheet is the place. `./morph.ts` grows one into
     the other on transform and opacity alone, and holds the phase this room
     renders off. */
  const morph = useCardMorph(reduced);
  const { arm: armMorph, phase: morphPhase } = morph;
  /** What the filing itself was, kept for the sheet: the org's own clock, the
   *  version it created, the queue it named, and the record it can be read back
   *  from. Set once, on the commit that lands the card. */
  const [filedMeta, setFiledMeta] = useState<{
    at: Date;
    /** THE PACKAGE AS THE ORG LEFT IT, where the filing made one the room could
     *  not name when it opened. Null everywhere else, and the sheet then names
     *  the package the plan was composed against. */
    packageName: string | null;
    version: string | null;
    queue: string | null;
    stagingId: string | null;
  } | null>(null);
  /** WHERE THE ORG STANDS ON THE FIGURES. `pending` until the staging record
   *  goes terminal; `unconfirmed` when it did not inside the room's budget,
   *  which is a line on the sheet and never a spinner. */
  const [confirmation, setConfirmation] = useState<SheetConfirmation>("pending");
  /** The sheet is sliding off to the memo room. */
  const [leaving, setLeaving] = useState(false);
  /** The sheet element, for the slide's own `transitionend`. */
  const sheetEl = useRef<HTMLDivElement | null>(null);
  const { sheetRef: bindSheet } = morph;
  const sheetRef = useCallback(
    (el: HTMLDivElement | null) => {
      sheetEl.current = el;
      bindSheet(el);
    },
    [bindSheet],
  );
  /** The sheet is on the glass from the moment the morph starts: it IS the
   *  morph's destination, so there is no state in which it is mounted and not
   *  meant to be seen. */
  const sheetOn = morphPhase === "morph" || morphPhase === "sheet";
  const cardMorph = morphPhase === "morph" ? "ghost" : morphPhase === "sheet" ? "gone" : undefined;
  const itemsRef = useRef<ThreadItem[]>([]);
  itemsRef.current = items;
  entriesRef.current = entries;
  /* THE STAGE CAP (founder, 2026-09-03). At most two things waiting on the
     banker; what does not fit waits its turn and lands as the stage clears. An
     item that has SETTLED is off the stage and does not count, which is what
     makes the settle choreography and the cap one mechanism rather than two. */
  const liveOnStage = items.reduce(
    (n, item) => (asksSomething(item) && settle.stateOf(item.id) !== "settled" ? n + 1 : n),
    0,
  );
  const gate = useStageGate({ live: liveOnStage, reduced });
  const { enqueue } = gate;
  const { settle: settleItems } = settle;

  /**
   * THE EXCHANGE THAT JUST ENDED, OFF THE STAGE, UNDER ONE ROW.
   *
   * The exchange is everything in the live step back to the last settled row
   * (or to the top of the step): the banker's line, the room's parse, the card,
   * the sentence, the remark and the chips. Tiers are never part of it - they
   * have their own choreography and their own summon.
   *
   * RETURNS how long the caller must wait before landing what comes next. The
   * next step arrives AFTER the exit, never on top of it, and under reduced
   * motion that wait is zero.
   */
  const settleExchange = useCallback(
    (row: SettledRow, opts: { upTo?: string; land?: () => void; instant?: boolean } = {}): void => {
      const { upTo, land } = opts;
      const prev = itemsRef.current;
      if (!prev.length) {
        land?.();
        return;
      }
      /* ============ THE ANCHOR IS WHAT SETTLED (founder, 2026-09-03)

         "The coverage thins warning is bundled to the amortisation terms card:
         when I click it, it closes that action and I need to open it up again."

         THE WALK USED TO START AT THE END OF THE THREAD, so acknowledging a
         check swept up everything that had landed AFTER it - the pricing
         question the same confirm had raised - and the banker lost a live
         question to a gesture about something else.

         IT STARTS AT THE THING THAT SETTLED NOW. `upTo` is the item the
         decision was about; the exchange is that item and the run of items
         leading up to it, and anything the room put on the glass afterwards is
         a different exchange and stays exactly where it is. */
      const at = upTo ? prev.findIndex((i) => i.id === upTo) : prev.length - 1;
      if (at < 0) {
        land?.();
        return;
      }
      const mine = prev[at].step;
      const covers: string[] = [];
      for (let i = at; i >= 0; i--) {
        const it = prev[i];
        if (it.step !== mine || it.kind === "settled" || tierOf(it)) break;
        covers.unshift(it.id);
      }
      if (!covers.length) {
        land?.();
        return;
      }
      const rowId = nextId("settled");
      settleItems(covers, rowId, land, opts.instant === true);
      /* THE ROW STANDS WHERE THE EXCHANGE STOOD. Appending it at the end would
         put a receipt for the check UNDER the question the check interrupted,
         which reads as the question having been answered. */
      setItems((p) => {
        const to = p.findIndex((i) => i.id === covers[covers.length - 1]);
        const rowItem: ThreadItem = { kind: "settled", id: rowId, step: mine, row, covers };
        if (to < 0) return [...p, rowItem];
        return [...p.slice(0, to + 1), rowItem, ...p.slice(to + 1)];
      });
    },
    [settleItems],
  );

  /* ------------------------------------------ THE "ANYTHING ELSE" TAIL (rule d)

     "Anything else on this facility, or shall I stage it?" keeps the
     conversation open, which is worth saying to a banker who now has the room's
     attention. With a fed line already queued behind it the room is asking a
     question it is about to answer itself, one beat later, out loud. The ref is
     written from the feed's own state, below, so this callback is stable. */
  const queuedRef = useRef(false);
  /* THE TAIL IS RETIRED (founder, 2026-09-03: "no tails"). "Anything else on
     this facility, or shall I stage it?" was the room keeping the conversation
     open, and the composer under it has been doing that on its own since the
     room had one. It survives as a parameter only so the fenced engines' own
     sentences can still be cut out of. */
  const tailNow = useCallback((_nextMove: string) => "", []);
  /** Where the line currently in flight came from, or null for a typed one. */
  const fedRef = useRef<string | null>(null);
  /** THE HUSH, held through a ref because the error relay is built before the
   *  narration hook is. A room with the channel off has none and needs none. */
  const hushRef = useRef<(() => void) | null>(null);
  const unhushRef = useRef<(() => void) | null>(null);

  /**
   * THE ROOM'S OWN PARAGRAPH, UNDER A CARD (rules d, e and f).
   *
   * Where the model speaks, `speaksFor` replaces this with the one-line address
   * and the remark is the prose. Where it does not - a decline, a rate limit,
   * the channel off - this IS the room's answer, and it is allowed to be a
   * paragraph of exactly two sentences.
   *
   * d  the "anything else" tail goes while a fed line is queued;
   * f  a sentence that reprints the card's own before and after is the room
   *    reading its own card out loud, and goes whatever else is true;
   * e  what is left is capped at two sentences.
   */
  const roomSentence = useCallback(
    (text: string, staged: readonly WorkroomDelta[]): string => {
      const withoutTail = cutTail(text, vocabulary.nextMove, true);
      const withoutCount = cutCloneCount(withoutTail, staged.length);
      return capSentences(cutFigureEcho(withoutCount, cardFigures(staged)));
    },
    [vocabulary.nextMove],
  );
  const { peek, openPeek, closePeek } = usePeek();

  /* ---- the page behind the room does not scroll while it is open. */
  useEffect(() => {
    document.body.classList.add("wk-open");
    return () => document.body.classList.remove("wk-open");
  }, []);

  useEffect(() => pushModal("workroom"), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isTopmost("workroom")) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  /* ---- THE RITUAL OPENS. The agent greets, the lookup shimmers, the brief
          lands with the members under it, and only then does the room take an
          instruction. Under reduced motion the whole ritual is simply there. */
  useEffect(() => {
    const choosing = packageChoiceBlocks;
    const pending = packagePending;
    const opening: ThreadItem[] = [
      { kind: "opening", id: nextId("open"), step: 0 },
      { kind: "lookup", id: nextId("lookup"), step: 0 },
    ];
    // The greeting's own id, so the ONE consent moment can land its remark
    // under the greeting the banker just opened the room for.
    openingIdRef.current = opening[0].id;
    setItems(opening);
    // THE STAGE IS CALM AGAIN. A bound route rebuilds this room on a new
    // engine and replays the ritual, so the tiers start over with it. The tier
    // effect below does not re-run on this pass - none of its deps moved yet -
    // so clearing the latch here cannot land the tiers ahead of the lookup.
    setLookedUp(false);
    tieredRef.current = false;
    resetTiers();
    tierArrived("question");
    const land = () => {
      // THE LOOKUP COMES BACK, AND NOTHING ELSE DOES YET (the entry
      // choreography, founder 2026-09-01). The package card and the facilities
      // are the two tiers below the question and they are earned in turn by the
      // effect underneath this one, which is also what keeps them off a stage
      // that is still asking which room this is.
      setItems((prev) => prev.filter((i) => i.kind !== "lookup"));
      setLookedUp(true);
      /* WHICH PACKAGE, BEFORE ANYTHING BINDS. On a relationship staging more
         than one the room asks first and nothing else lands: no route chips, no
         package card, no facilities, no greeting remark. One package is not a
         choice and this branch is never taken for it. */
      if (pending) {
        setItems((prev) => [...prev, { kind: "pkgask", id: nextId("pkgask"), step: 0 }]);
        return;
      }
      // A room still waiting for a package to be chosen has nothing to take an
      // instruction about, so the composer stays asleep through that beat.
      if (choosing) return;
      setAwake(true);
      setSuggestion(engine.suggest());
      // THE ROOM CLOSED; THE WORK DID NOT. Entries live in the engine, against
      // the package they were composed for, and the room says what it picked up
      // rather than presenting the lane as if it had always been there.
      const resumed = engine.resume();
      if (!resumed.length) {
        /* ============ AND WHAT A RELOAD TOOK (2026-09-05)

           The engine remembers a close; it cannot remember a reload. Where the
           store holds a plan for this package and the engine holds nothing, the
           room OFFERS it rather than restaging on its own: a banker who came
           back to start over should not find yesterday's manifest putting
           itself back up. The read carries the ordinary read deadline, and
           every kind of absence, no store, no document, a document that did
           not survive its reader, a read that ran out of clock, is the same
           silence, which is exactly the room as it was before this existed. */
        if (context.productPackageId) {
          void readStoredPlan(context.accountId, context.productPackageId, context.mode as PlanRoute).then((doc) => {
            if (!doc || !doc.said.length) return;
            planOfferRef.current = doc;
            setItems((prev) => [
              ...prev,
              { kind: "agent", id: nextId("agent"), step: 0, text: resumeOffer(doc), options: [RESUME_CHIP, START_OVER_CHIP] },
            ]);
          });
        }
        return;
      }
      const [one, many] = vocabulary.changeWord;
      setEntries(resumed);
      // A MANIFEST THAT SURVIVED THE LAST CLOSE HAS ALREADY BOUND THE ROUTE.
      // Rule 4: once anything is staged the room is locked to that engine, so
      // asking which route this is over a rail that is already full would be
      // offering a decision that was made in the previous session.
      setAsk(null);
      routerRef.current?.onBind(context.mode);
      setItems((prev) => [
        ...prev,
        {
          kind: "agent",
          id: nextId("agent"),
          step: 0,
          text: `Picking up where you left off: ${countPhrase(resumed.length, resumed.length === 1 ? one : many, resumed)} on the manifest.`,
        },
      ]);
    };
    if (reduced) {
      land();
      return;
    }
    const t = window.setTimeout(land, LOOKUP_MS);
    return () => clearTimeout(t);
  }, [context.mode, engine, packageChoiceBlocks, packagePending, reduced, resetTiers, tierArrived, vocabulary.changeWord]);

  /* ---- THE TWO TIERS UNDER THE QUESTION (the entry choreography, founder
          2026-09-01).

          The identity blends in FIRST: which package this action runs against
          is the anchor, and it is the one thing a banker needs before the
          facilities mean anything. The facilities follow a beat later, and as
          each tier lands the tier above it leaves the stage.

          NEITHER LANDS WHILE THE ROUTE IS OPEN. A package card and six
          facilities beside three route chips is exactly the dump the founder
          asked us to take apart: the question stands alone until it is
          answered, which is also the only moment the tiers below it are worth
          reading. */
  /** THE BEAT IS HELD IN A REF, NOT IN A CLEANUP. A cleanup would clear the
   *  facilities' own beat every time anything under this effect moved. */
  const openingIdRef = useRef<string>("");
  const tierTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(tierTimer.current), []);
  useEffect(() => {
    if (!lookedUp || ask) return;
    // NOTHING UNDER AN UNANSWERED PACKAGE QUESTION. The package card and the
    // facilities both belong to a package, and none is chosen yet.
    if (packagePending) return;
    if (tieredRef.current) return;
    tieredRef.current = true;
    const choosing = packageChoiceBlocks;
    // A tier lands with the entry blocks, never after the conversation: the
    // room reads question, then package, then facilities, top to bottom.
    const afterTiers = (prev: ThreadItem[], item: ThreadItem): ThreadItem[] => {
      let at = 0;
      for (let i = 0; i < prev.length; i += 1) if (tierOf(prev[i])) at = i + 1;
      return [...prev.slice(0, at), item, ...prev.slice(at)];
    };
    setItems((prev) => afterTiers(prev, { kind: "packages", id: nextId("pkgs"), step: 0 }));
    tierArrived("identity");
    // A book with several packages stops here: the banker has a card to choose
    // from and the facilities belong to whichever one they take.
    if (choosing) return;
    const facilities = () => {
      setItems((prev) => afterTiers(prev, { kind: "brief", id: nextId("brief"), step: 0 }));
      tierArrived("detail");
    };
    if (reduced) {
      facilities();
      return;
    }
    tierTimer.current = window.setTimeout(facilities, TIER_STAGGER_MS);
  }, [ask, lookedUp, packageChoiceBlocks, packagePending, reduced, tierArrived]);

  /* ---- and the room hands the manifest back. Every landing and every removal,
          so a close at any moment loses nothing. Not once it has FILED. */
  useEffect(() => {
    if (phase !== "work") return;
    engine.hold(entries);
  }, [engine, entries, phase]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), reduced ? 200 : 2300);
    return () => clearTimeout(t);
  }, [toast, reduced]);

  /* ---- the thread follows the conversation down. */
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, thinking, flow]);

  /* ---- derived state. Nothing below is stored twice. */
  const openGates = items.reduce((n, item) => (isLive(item) ? n + 1 : n), 0);
  const checksArrived = items.filter((i) => i.kind === "challenge").length;
  const checksAcked = items.filter((i) => i.kind === "challenge" && i.acked).length;
  /**
   * THE REVIEW IS OPEN WHEN THERE IS SOMETHING TO REVIEW and nothing is waiting
   * on the banker. It does not also require the suggestions to be SPENT: the
   * suggestions are an offer, never a gate, and a banker who confirmed the one
   * change they came in for must be able to file it.
   */
  const approvalOpen = phase === "work" && !thinking && openGates === 0 && entries.length > 0;
  /* THE FINALE'S DOOR IS THE CARD'S OWN. Read off the dossier in the thread
     rather than recomputed, so "View in nCino" and the card's header can never
     point at two different records - and where the card has no link, because the
     view carries no org address, neither does this (A29). */

  const baseline = useMemo(
    () => ({
      committedMM: brief.baselineCommittedMM,
      members: brief.baselineMembers,
      changeWord: vocabulary.changeWord,
    }),
    [brief.baselineCommittedMM, brief.baselineMembers, vocabulary.changeWord],
  );
  const figures = useMemo(() => figuresFor(entries, baseline), [entries, baseline]);
  /** How much of the manifest a deployed tool actually files. An entry that says
   *  nothing about it is fileable — that is the shell engines, unchanged. */
  const fileable = entries.filter((e) => e.fileable !== false).length;
  const handedOff = entries.length - fileable;
  const steps = stepperState({
    conversationOpen: awake,
    landed: entries.length,
    composeTarget: brief.composeTarget,
    checksArrived,
    checksAcked,
    approvalOpen: approvalOpen || flow !== null,
    filed: phase === "filed",
  });
  const filedById = useMemo(() => new Map((execution?.filed ?? []).map((f) => [f.deltaId, f])), [execution]);
  /* WHAT THE CARD CARRIES OUT OF THE DRAIN (founder, 2026-09-04). The rail is
     the only surface that listed the writes with their org ids, and the finale
     wipes it; this is that ledger, moved onto the card that survives. Built
     from the SAME manifest the rail drew and the SAME verification execute
     came back with, so the two can never disagree about what filed. */
  const handoffById = useMemo(
    () => new Map((execution?.handoffs ?? []).map((h) => [h.deltaId, h])),
    [execution],
  );
  const filedLines = useMemo(
    () => (execution ? filedLinesFor(entries, filedById, handoffById) : null),
    [entries, execution, filedById, handoffById],
  );
  /* The rail head's own sentence, over the set the card is listing. The split
     is `countSplit`'s, never a second count of the same thing. */
  const filedHead = useMemo(
    () => countPhrase(entries.length, entries.length === 1 ? vocabulary.changeWord[0] : vocabulary.changeWord[1], entries),
    [entries, vocabulary.changeWord],
  );

  /* ------------------------------------------------------------- the sheet

     THE CLEAN SUMMARY THE ROOM ENDS ON (founder, 2026-09-06). Built from what
     the room ALREADY HOLDS at the instant execute answered: the manifest it
     staged, the ledger execute verified, the baseline it opened on, and the
     check it put in front of the banker. Nothing below reads the org, which is
     why the sheet is whole on its first commit and can never spin. */
  const filedSheet = useMemo<FiledSheetModel | null>(() => {
    if (!execution || !filedLines || !filedMeta) return null;
    return {
      title: filedTitle({
        mode: context.mode,
        accountName: context.accountName,
        packageName: filedMeta.packageName ?? brief.packageName,
        version: filedMeta.version,
        renewedTo: renewedTo(filedLines),
      }),
      stamp: filedStamp(filedMeta.at, context.approver),
      version: filedMeta.version,
      lines: filedLines,
      head: filedHead,
      exposure: sheetExposure(brief.baselineCommittedMM, figures.committedMM, confirmation),
      coverage: sheetCoverage(itemsRef.current.flatMap((i) => (i.kind === "challenge" ? [i.challenge] : []))),
      next: whoActsNext(filedMeta.queue, execution.handoff),
      accountName: context.accountName,
      unconfirmed: confirmation === "unconfirmed",
    };
  }, [
    brief.baselineCommittedMM,
    brief.packageName,
    confirmation,
    context.accountName,
    context.approver,
    context.mode,
    entries,
    execution,
    figures.committedMM,
    filedById,
    filedHead,
    filedLines,
    filedMeta,
  ]);

  /* ------------------------------------------------------------ the moves */

  const push = useCallback((item: NewItem) => {
    setItems((prev) => [...prev, { ...item, step: prev.length ? prev[prev.length - 1].step : 0 } as ThreadItem]);
  }, []);
  const agent = useCallback(
    (text: string, options?: Array<{ label: string; say: string }>) =>
      push({ kind: "agent", id: nextId("agent"), text, options }),
    [push],
  );

  /**
   * THE ROOM RELAYS AN ERROR.
   *
   * A RUNTIME failure - the page's own host refusing the call - becomes one
   * quiet line with the way out of it, and the model is HUSHED for the rest of
   * the exchange: a paragraph about credit under "reload to continue" is in the
   * way of the one thing the banker has to do, and on the founder's drive there
   * were two of them.
   *
   * AN ORG REFUSAL IS THE BANK TALKING and stays an ordinary sentence, because
   * it is one, and because the model's comment on a precondition the bank named
   * is often the most useful thing on the glass.
   */
  const relayError = useCallback(
    (said: string) => {
      if (!isRuntimeTrouble(said)) {
        agent(said);
        return false;
      }
      hushRef.current?.();
      push({ kind: "trouble", id: nextId("trouble"), text: said, reload: RELOADABLE.test(said) });
      return true;
    },
    [agent, push],
  );

  /** Hold the composed beat, then let the answer settle in. Zero under reduced
   *  motion, so a test and a banker who asked for stillness get it on the same
   *  tick. */
  const beat = useCallback(
    (started: number) =>
      new Promise<void>((resolve) => {
        const left = reduced ? 0 : Math.max(0, COMPOSE_FLOOR_MS - (Date.now() - started));
        if (!left) {
          resolve();
          return;
        }
        window.setTimeout(resolve, left);
      }),
    [reduced],
  );

  /* ---- THE MEMBERS, AS THE SAFETY LAYERS READ THEM. The commitment comes from
          the same read the strip prints and is never re-derived: the bundle's
          own figure where the room stands on one, and the member chip's own
          printed figure read back where it does not. */
  /* THE DRAWN BALANCE RIDES ALONG (founder drive, 2026-09-02). A commitment
     under what is already outstanding is not a decision the bank could take, so
     the misread rule needs the same read the coverage advisory stands on. Null
     where no read carries it, and the rule then says nothing. */
  const qualifierMembers = useMemo<MisreadMember[]>(() => {
    const committed = new Map<string, number>();
    const drawn = new Map<string, number>();
    for (const f of reads?.bundle?.exposure?.facilities ?? []) {
      if (!f.loanId) continue;
      if (typeof f.committed === "number") committed.set(f.loanId, f.committed);
      if (typeof f.outstanding === "number") drawn.set(f.loanId, f.outstanding);
    }
    return brief.members.map((m) => ({
      id: m.id,
      label: m.key,
      committed: committed.get(m.id) ?? printedAmount(m.amount),
      drawn: drawn.get(m.id) ?? null,
    }));
  }, [brief.members, reads?.bundle]);

  /** The relationship's committed total, in dollars, for the magnitude bound. */
  const committedTotal = brief.baselineCommittedMM * 1e6;

  /* ---- THE MEMBERS, AS THE CREATE GRAMMAR READS THEM. The org's own loan name
          rides along because a product word lands on every facility of that
          product and a composed sentence has to be exact rather than narrowed
          afterwards. Null where the read carries no name, and the composition
          then falls back to the label with verification behind it. */
  const elicitMembers = useMemo<ElicitMember[]>(() => {
    const named = new Map<string, string>();
    for (const f of reads?.bundle?.exposure?.facilities ?? []) {
      if (f.loanId && f.name) named.set(f.loanId, f.name);
    }
    const committed = new Map(qualifierMembers.map((q) => [q.id, q.committed]));
    return brief.members
      .filter(isEligible)
      .map((m) => ({
        id: m.id,
        key: m.key,
        label: facilityLabel(m, brief.members),
        orgName: named.get(m.id) ?? null,
        // The same rule the parser's own identity tokens use, so a composed
        // sentence carrying this resolves exactly one member and carries no
        // account name for the party reader to trip over.
        shortName: shortFacilityName(named.get(m.id), context.accountName) || null,
        committed: committed.get(m.id) ?? null,
      }));
  }, [brief.members, context.accountName, isEligible, qualifierMembers, reads?.bundle]);

  /* ---- AND THE FACILITIES THIS PLAN IS CREATING (founder, 2026-09-03).

          A net-new facility on the manifest is a member of the PLAN before it is
          a member of anything in the org, and every later line that names it
          ("on the new equipment loan") resolves a facility through `readScope`.
          So it joins the scope as a synthetic member whose id IS its label, and
          the covenant, borrowing-structure, collateral and fee lanes all reach
          it through the reader they already use. Booked members come first, so
          nothing about an existing facility's reading moves. */
  const newFacilitySpecs = useMemo(() => stagedNewFacilitySpecs(entries), [entries]);
  const scopeMembers = useMemo<ElicitMember[]>(
    () => [...elicitMembers, ...newFacilitySpecs.map(newFacilityMember)],
    [elicitMembers, newFacilitySpecs],
  );
  const specFor = useCallback(
    (memberId: string) => newFacilitySpecs.find((spec) => spec.label === memberId) ?? null,
    [newFacilitySpecs],
  );

  /** A member's own display label, for every sentence the room says about one.
   *  Reads the plan's own members, so a facility this plan is creating is named
   *  by its title rather than by "that facility". */
  const memberLabel = useCallback(
    (id: string) => scopeMembers.find((m) => m.id === id)?.label ?? "that facility",
    [scopeMembers],
  );

  /**
   * WHAT THE QUESTION NARROWED THE READ CARD TO.
   *
   * A ROLE, which has always been read here, and now a FACILITY. "who
   * guarantees the construction loan" is a question about one loan, and a card
   * answering it with every guarantor on the package has answered a different
   * question. The facility is resolved by `readScope`, the SAME reader the
   * parser resolves a member on, so the card and a staged change can never
   * disagree about which facility a line named. An ambiguous or absent scope
   * word narrows nothing, which is the package-wide answer as before.
   */
  const readNarrowing = useCallback(
    (topic: ReadTopic, line: string): ReadOptions => {
      if (topic !== "structure") return {};
      return { role: readRole(line) ?? undefined, loanIds: readScope(line, elicitMembers).ids };
    },
    [elicitMembers],
  );

  /* THE ORG'S OWN CHIP SETS, READ ONCE PER VIEW (`Customer360Catalog`).

     The one read this room issues that is not the bundle, and it is issued for
     the chips rather than for the facts: the create grammar drew its picklists
     from a shell MIRROR, and a mirror drifts silently until a refusal at the
     confirm gate says so. Null is a state, not an error - no connector, or a
     connector whose tool-schema cache has not seen the 25th tool yet - and every
     chip set then falls back to the mirror it has always had. */
  const [catalog, setCatalog] = useState<OrgCatalog | null>(null);
  useEffect(() => {
    let live = true;
    void readCatalog().then((c) => {
      if (live && c) setCatalog(c);
    });
    return () => {
      live = false;
    };
  }, []);

  /** THE BOOK: what the relationship already carries, read off the bundle the
   *  room is already holding. No read is issued for it. */
  const book = useMemo(
    () => buildBook(reads?.bundle ?? null, elicitMembers.map((m) => m.id)),
    [elicitMembers, reads?.bundle],
  );

  /** THE FACILITIES AS THE READ CARRIES THEM, by loan id. The pricing gate asks
   *  this read what it holds for the amortised term and the first payment date,
   *  and absent is UNKNOWN rather than fine. */
  const facilityRead = useMemo(() => {
    const out = new Map<string, Facility>();
    for (const f of reads?.bundle?.exposure?.facilities ?? []) if (f.loanId) out.set(f.loanId, f);
    return out;
  }, [reads?.bundle]);

  /** THE ONE PRICING FIELD THE PLAN STILL NEEDS, or null. Derived from the
   *  manifest and the read, exactly like every other figure in this room. */
  const pricingOutstanding = useCallback(
    (staged: WorkroomDelta[]) =>
      pricingNeed({ entries: staged, facilities: facilityRead, declined: pricingDeclined, held: rateHeld }),
    [facilityRead, pricingDeclined, rateHeld],
  );

  /** THE PLAN: what this session already put up, open on a chip or staged on
   *  the manifest, read back as context rather than only written. */
  const plan = useMemo<PlanEntry[]>(() => {
    const out: PlanEntry[] = [];
    const add = (d: WorkroomDelta, open: boolean) => {
      const held = draftsRef.current.get(d.id);
      const surface =
        held?.surface ??
        (d.covenantWire ? "covenant" : d.pledgeWire ? "collateral" : d.involvementWire?.op === "add" ? "involvement" : null);
      if (!surface) return;
      const fromWire: Slots = d.covenantWire
        ? { test: d.covenantWire.typeName, threshold: d.covenantWire.threshold, frequency: d.covenantWire.frequency }
        : d.involvementWire
          ? { party: d.involvementWire.accountName, role: d.involvementWire.role }
          : /* A NET-NEW PLEDGE IS IDENTIFIED BY ITS DESCRIPTION, not by a record
               id it does not have yet, so the plan-awareness rule can still see
               it where no elicited draft is held beside the delta. */
            d.pledgeWire?.newCollateral
            ? {
                isNew: true,
                assetDescription: d.pledgeWire.newCollateral.description,
                assetKind: d.pledgeWire.newCollateral.collateralType,
                assetValue: d.pledgeWire.newCollateral.value,
                advanceRate: d.pledgeWire.advanceRate,
              }
            : { assetId: d.pledgeWire?.collateralId };
      out.push({
        deltaId: d.id,
        surface,
        memberId: d.member ?? d.covenantWire?.facilityId ?? d.pledgeWire?.facilityId ?? d.involvementWire?.facilityId ?? null,
        title: d.title,
        target: d.target,
        slots: held?.slots ?? fromWire,
        open,
      });
    };
    for (const e of entries) add(e, false);
    for (const item of items) {
      if (item.kind !== "chips") continue;
      for (const c of item.chips) if (c.state === "open" && c.delta) add(c.delta, true);
    }
    return out;
  }, [entries, items]);

  /** THE ASSOCIATE, RESOLVED AGAINST THE BOOK AND THE ROUTE (P1). Null is every
   *  create that is not an associate, and every route whose tool does not carry
   *  the junction arm; there the handoff still says which route does. */
  const attachFor = useCallback(
    (draft: Draft, memberId: string) =>
      draft.surface === "covenant" && draft.slots.associate
        ? readCovenantAttach({
            covenantId: draft.slots.existingCovenantId,
            test: draft.slots.test,
            book,
            facilityId: memberId,
            facilityLabel: memberLabel(memberId),
            mode: context.mode,
          })
        : null,
    [book, context.mode, memberLabel],
  );

  /**
   * AN EXISTING ASSET, PLEDGED ONTO A KNOWN FACILITY, WITHOUT RE-PARSING
   * (founder finding, 2026-09-03). The asset was already resolved against the
   * book before the create reached this function, and the facility is the
   * fan-out's own `memberId`, so there is nothing left for the parser to
   * settle. Null on every other surface, and on a net-new asset: that one
   * still composes a sentence, because the fenced engine authors the whole
   * chain (the asset, the ownership, the pledge) and this room does not.
   */
  const pledgeFor = useCallback(
    (draft: Draft, memberId: string) => {
      if (draft.surface !== "collateral" || draft.slots.isNew || !draft.slots.assetId) return null;
      const asset = book.assets.find((a) => a.id === draft.slots.assetId);
      if (!asset) return null;
      return pledgeExistingDelta(asset, {
        facilityId: memberId,
        facilityLabel: memberLabel(memberId),
        second: draft.slots.second,
      });
    },
    [book, memberLabel],
  );

  const elicitCtx = useMemo<ElicitContext>(
    () => ({
      /* THE FACILITIES THIS PLAN IS CREATING ARE IN SCOPE. Every create the
         grammar gathers resolves its members here, so "add a DSC covenant on the
         new loan" settles on the staged facility rather than asking. */
      members: scopeMembers,
      focused: focused ? (scopeMembers.find((m) => m.id === focused.id) ?? null) : null,
      book,
      plan,
      relationship: context.accountName,
      catalog,
    }),
    [book, catalog, context.accountName, focused, plan, scopeMembers],
  );

  /** THE CONVERSATION SO FAR, for the envelope. The banker's words verbatim,
   *  the room's clipped: this is what makes the second lane a conversation
   *  rather than a series of first questions. */
  const conversation = useCallback(
    (): BrainTurn[] =>
      items.flatMap<BrainTurn>((item) =>
        item.kind === "banker"
          ? [{ who: "banker", text: item.text }]
          : item.kind === "agent"
            ? [{ who: "agent", text: item.text }]
            : item.kind === "read"
              ? [{ who: "agent", text: `Answered a read on ${item.card.topic}. ${item.card.lede}` }]
              : [],
      ),
    [items],
  );

  /**
   * A PARSE, DRAWN. The reply, the two safety layers, and whatever chips the
   * parse puts on the table, landing together in the step that owns them.
   *
   * Split out of `runParser` so the BRAIN lane can draw the same reply on a
   * degrade: a bad round trip must never leave the room worse than the fast
   * lane alone would have been.
   */
  const renderParse = useCallback(
    /** `note` is one sentence the SHELL owns about this parse, said in the same
     *  bubble as the engine's own account. The percentage fee's "the org works
     *  the money out itself" is the only one today. */
    (instruction: string, result: IntentResult, mine: number, note = "") => {
      /* ------------------------------------------------ THE VALUE BOUNDS

         A STAGED VALUE HAS TO LOOK LIKE A VALUE (founder repro 11b). The
         free-field wave takes everything after the label it matched, with no
         shape check of its own, and staged a fifteen-word question tail as
         the new value of "Product". The room refuses to draw a chip like
         that: the delta is dropped and the room says WHY, because a delta
         silently swallowed is the same silence from the other direction.

         Scoped to the FIELD WAVE (`fieldWire`). Commitments, rates and
         maturities are parsed into typed values by their own waves. */
      const unsound =
        result.kind === "deltas"
          ? result.deltas
              .map((d) => ({ d, why: unsoundFieldChange(instruction, d) }))
              .filter((x): x is { d: WorkroomDelta; why: string } => !!x.why)
          : [];
      const sound = result.kind === "deltas" ? result.deltas.filter((d) => !unsound.some((u) => u.d.id === d.id)) : [];
      const allDropped = unsound.length > 0 && sound.length === 0;

      /* ------------------------------------------ THE QUALIFIER FILTER (F4)

         "the 2.5M line of credit to 4M" resolved BOTH lines of credit and
         staged a 15M to 4M reduction beside the change the banker asked for.
         Resolution lives in the fenced engine, so the correction is here and
         it is post-parse: the siblings come off the table BEFORE a chip is
         drawn, and the room says which member it read. */
      const qualifier = qualifierFilter(instruction, sound, qualifierMembers);
      const shown = qualifier.keep;

      /* -------------------------------------- THE ROLE ON AN EXCLUSION (E8)

         The role a carry exclusion carries decides which ROW the org takes off
         the clone, and the engine takes it from whatever word the line happened
         to use. "take Elena Hartwell off the 15M line of credit" staged it as
         Guarantor when the book holds her as LIMITED Guarantor there, the org
         found no such row and refused the whole plan. The book has the answer
         and the room is already holding it. */
      const roleRead = stampRemovalRoles({ deltas: shown, book, label: memberLabel });

      /* --------------------------- THE FIGURE THAT CAME OUT WRONG (B)

         A commitment under what is already drawn on the facility, or under a
         hundredth of what it carries today, is not a decision: it is a
         mistyped figure, and the drive proved what staging one costs. The
         magnitude rule stages and warns because too big can still be meant;
         this one refuses, by name, and says how to put it right. */
      const misread = misreadCommitments({ deltas: roleRead.deltas, members: qualifierMembers });
      /* AND THE SHELL'S OWN NOTE RIDES THE ENTRY, not only the sentence. The
         percentage fee's "the org works the money out itself" is the reason the
         room asks for no amount, and where the model is speaking the sentence
         steps back to the address: a note that lived only there would be lost
         exactly when it is being explained. Same idiom as the pricing gate's. */
      const notedStaged = note
        ? misread.keep.map((d) => ({ ...d, caveat: [d.caveat, note].filter(Boolean).join(" ") }))
        : misread.keep;
      /* THE SHORT TITLE ON A PLEDGE (founder finding, 2026-09-03). A line
         typed straight through and resolved cleanly never reaches the guided
         lane's own fix (`restateEntry`), so this is the direct lane's: see
         `shortenPledgeTitles` in `dispatch.ts`. */
      const staged = shortenPledgeTitles(notedStaged, book);

      /* ------------------------------------------ THE MAGNITUDE BOUND (F5)

         Staged, and challenged. Same tier as the drawn-balance advisory: the
         chip still arrives open with its Confirm on it, and the room says the
         thing a credit officer would say across the desk. */
      const kept = new Set<string>();
      for (const d of staged) {
        kept.add(d.id);
        const loan = d.member ?? d.wire?.facilityId;
        if (loan) kept.add(loan);
      }
      const engineAdvice = qualifier.dropped.length
        ? (result.kind === "deltas" ? (result.advisories ?? []) : []).filter((a) => [...kept].some((k) => a.id.includes(k)))
        : result.kind === "deltas"
          ? (result.advisories ?? [])
          : [];
      /* AND ITS ADVISORY COMES OFF WITH IT. An advisory under a card the room
         refused to stage is the drive's own defect from the other side: the
         warning stayed on screen beside a chip that no longer existed. */
      const refused = new Set(misread.refusals.map((r) => r.id.slice("misread:".length)));
      const advisories = [
        ...engineAdvice.filter((a) => ![...refused].some((id) => a.id.includes(id))),
        ...magnitudeAdvisories({ deltas: staged, members: qualifierMembers, committed: committedTotal }),
      ];

      /* ------------------------------- THE FENCED CHIP SET, HELD TO THE ORG'S

         The policy-exception statuses are composed behind the engine fence, so
         the room cannot build them from the catalog. It can CHECK them: where
         every label the engine offered is a value the org's own picklist holds,
         the live set wins. A value the org gained is added; a value the write
         path refuses comes off AND IS SAID, because that is the only difference
         a banker can act on. With no catalog nothing moves. */
      const engineOptions = result.kind === "unparsed" || result.kind === "deltas" ? result.options : undefined;
      const statusChips = reconcileChips(engineOptions, catalog, "exceptionStatus", (label) => label);

      /* ================================ THE ROOM SAYS IT ONCE (founder, 2026-09-03)

         Three cuts, all of them on sentences the FENCED engines composed and the
         shell renders. `app/src/workroom/` is not opened by any of them.

         a. THE PARSER PREAMBLE ("Read that as the $15M Line of Credit. The other
            facility that line could have named is left alone.") is worth its
            words only where the room actually NARROWED between two members. It
            is dropped everywhere else.
         b. THE VERSION PARAGRAPH ("Confirming stages the next VERSION of the
            package: every eligible member rolls into it ...") is the fact that
            makes a confirm safe to press, and a banker needs it once. It is
            shortened to one sentence and said under the FIRST card of a plan.
         d. THE "ANYTHING ELSE" TAIL is dropped while a fed line is queued. */
      const preamble = preambleFor(qualifier);
      const engineAccount = preamble
        ? `${preamble} ${reconcileNarrative(result.reply, qualifier.keep, qualifier.dropped)}`
        : result.reply;
      /* THE VERSION LINE IS NOT SUBJECT TO THE TWO-SENTENCE CAP, and that is
         deliberate: the cap is on what the room says ABOUT this parse, and this
         is the one fact that makes the Confirm under it safe to press. It is
         taken out before the cap runs and put back after it, once per plan. */
      const versionFirst = carriesVersionParagraph(engineAccount) && !versionSaid.current;
      if (carriesVersionParagraph(engineAccount)) versionSaid.current = true;
      const account = cutVersionParagraph(engineAccount, false);
      const withVersion = (said: string) => (versionFirst ? `${said} ${VERSION_LINE}`.trim() : said);

      // The reply and the chips it puts on the table land TOGETHER, in one
      // commit, so there is no frame in between where the room looks finished
      // and the chips have not arrived.
      const landed: ThreadItem[] = [
        {
          kind: "agent",
          id: nextId("agent"),
          step: mine,
          note,
          // THE SENTENCE AND THE CHIPS AGREE (D3). Where the qualifier narrowed,
          // the room says what it read FIRST and the engine's own account
          // follows it with the members it no longer reaches taken out of it.
          // A reply that announced a fan-out the filter had just undone was the
          // room contradicting itself over a card the banker was about to sign.
          // AND THE ROLE READ OWNS THE SENTENCE WHERE IT REFUSED TO STAGE: a
          // removal the book cannot ground puts no chip on the table, so the
          // engine's own "staged on the clone" account must not survive it.
          text: allDropped
            ? `I read "${unsound[0].d.title}" in that, but ${unsound[0].why}, so I am not putting it up as a change. ${whatICanDo(context.accountName)}`
            : roleRead.ask
              ? roleRead.ask.text
              /* A MISREAD OWNS THE SENTENCE where nothing survived it. The
                 engine composed its account before this rule ran and cannot
                 know it did, so "1 of these goes on the clone" must not stand
                 over a card that is a refusal. */
              : !staged.length && misread.refusals.length
                ? misread.refusals.map((r) => r.why).join(" ")
                : !staged.length && roleRead.said.length
                  ? roleRead.said.join(" ")
                  : withVersion(
                      roomSentence(
                        [
                          misread.refusals.map((r) => r.why).join(" "),
                          roleRead.said.join(" "),
                          note,
                          account,
                          statusChips.said ?? "",
                        ]
                          .filter(Boolean)
                          .join(" "),
                        staged,
                      ),
                    ),
          // CLICKABLE ANSWERS ride BOTH reply kinds: an "unparsed" clarify and
          // a "deltas" reply that still ends on a closed-set question.
          options: allDropped
            ? undefined
            : (roleRead.ask?.options ?? statusChips.options),
        },
      ];
      const chips: ChipModel[] =
        result.kind === "deltas"
          ? [
              ...staged.map((d) => ({ key: nextId("chip"), delta: d, state: "open" as const })),
              ...misread.refusals.map((r) => ({ key: nextId("chip"), refusal: r, state: "open" as const })),
            ]
          : result.kind === "refusal"
            ? [{ key: nextId("chip"), refusal: result.refusal, state: "open" }]
            : [];
      if (chips.length) {
        landed.push({
          kind: "chips",
          id: nextId("chips"),
          step: mine,
          chips,
          advisories: advisories.length ? advisories : undefined,
        });
      }
      setItems((prev) => [...prev, ...landed]);
      setSuggestion(engine.suggest());
    },
    [book, catalog, committedTotal, context.accountName, engine, memberLabel, qualifierMembers, roomSentence],
  );

  /**
   * THE FAST LANE, RUN. The deterministic parser reads the line, the safety
   * layers hold, and the reply lands in the step that owns it.
   *
   * A validated delta-proposal is restated as the sentence a banker could have
   * typed and comes through here — the same parse, the same org-side
   * re-validation, the same plan, confirm and single-use token. The brain has
   * no path to the org that does not run through this function.
   */
  const runParser = useCallback(
    async (instruction: string, mine: number, note = "") => {
      // THE COMPOSED BEAT. The glyph fills while the engine reads the line — and
      // on a wired room the engine may be waiting on the gateway, so this is
      // also the only thing standing between the banker and a blank pause.
      const started = Date.now();
      setThinking(true);
      try {
        const result = await engine.parseIntent(instruction, context);
        await beat(started);
        renderParse(instruction, result, mine, note);
      } finally {
        setThinking(false);
      }
    },
    [beat, context, engine, renderParse],
  );

  /**
   * THE ENVELOPE, SENT. One round trip over the artifact<->session bridge.
   *
   * It is built from what the room is already holding — the package, the READ
   * BLOCKS the bundle carries, the conversation so far, the staged plan and
   * what this route can and cannot file. No read is issued for it, and the
   * budget is enforced at the wire (`capEnvelope`).
   */
  /** THE BOOK, PACKAGED, for whichever lane is asking. One builder, so a remark
   *  under a card stands on exactly the envelope a reply would have stood on. */
  const envelopeFor = useCallback(
    (instruction: string, routeOpen = false): BrainEnvelope =>
      buildEnvelope({
        line: instruction,
        mode: context.mode,
        accountName: context.accountName,
        packageName: brief.packageName,
        productPackageId: context.productPackageId,
        members: brief.members,
        eligible: isEligible,
        focused,
        entries,
        reads,
        thread: conversation(),
        routeOpen,
        mail: mailNote ?? undefined,
      }),
    [brief.members, brief.packageName, context, conversation, entries, focused, isEligible, mailNote, reads],
  );

  const askTheDesk = useCallback(
    async (instruction: string, routeOpen: boolean): Promise<BrainReply | null> => {
      if (!brain) return null;
      try {
        return await brain(envelopeFor(instruction, routeOpen));
      } catch {
        // The lane never throws into the room. A transport that failed past
        // `askBrain`'s own guard degrades exactly as a malformed reply does.
        return null;
      }
    },
    [brain, envelopeFor],
  );

  /* ============================================ THE PARSER STAGES, THE MODEL SPEAKS

     The card is deterministic and instant, exactly as it is today. The SENTENCE
     under it is the model's, streaming in a second or two later with the whole
     book, the plan and the doctrine in view.

     ONE EFFECT, NOT TWENTY CALL SITES. Every staging path in this room ends by
     appending a thread item, so the remark is driven from the item rather than
     from each engine: `subjectFor` decides what is worth remarking on and
     `shouldNarrate` refuses the chrome. Where narration is off or unavailable
     this is inert and the room renders precisely what it renders today. */
  /* ROUTE-NEUTRAL UNTIL THE ROUTE IS BOUND (founder, 2026-09-02). The room
     stands on the PROVISIONAL modify engine while the route question is open,
     so an envelope built with routeOpen defaulted to false told the model this
     was a modification before the banker had said any such thing. That is
     exactly what he read in the greeting: "which facility or facilities move
     and what changes follow". The reply lane has always passed this; the
     narration lane now passes the same thing. */
  const narration = useNarration({
    enabled: Boolean(brain),
    envelopeFor: (line) => envelopeFor(line, ask !== null),
  });
  hushRef.current = narration.hush;
  unhushRef.current = narration.unhush;
  const narrated = useRef(new Set<string>());

  /* THE ONE CONSENT MOMENT (founder, 2026-09-02). The platform asks the viewer
     to allow this artifact to use their Claude on the FIRST call of a view, and
     the call waits while they decide. So the first call is the one the banker
     just asked for by opening the room: the greeting. The dialog arrives framed
     by a sentence that explains itself, never mid-plan and never between a card
     and its sentence. `primeConsent` is memoised, so this can only happen once
     however many times the room re-renders or is re-opened. */
  /** TRUE where the greeting went out WITH the client's mail on the envelope.
   *  Captured at the instant it fires, because the note may land afterwards and
   *  the greeting is not rewritten when it does. */
  const greetedWithMail = useRef(false);
  const greeted = useRef(false);
  useEffect(() => {
    if (!brain || !lookedUp || !openingIdRef.current) return;
    /* AND NOT BEFORE THE PACKAGE IS CHOSEN (founder, 2026-09-02). The greeting
       is the one call that carries the consent dialog and it is composed from
       an envelope; an envelope built while several packages stand unanchored
       names no package and carries relationship-wide figures, which is exactly
       the "$46MM package across six facilities" the founder read. The pick
       remounts this room, and the greeting is composed then, once, against the
       package the banker chose. */
    if (packagePending) return;
    /* ONCE. `narration.open` is latched per item id, so a second call was
       already inert; what was NOT inert is the ref below, which a later pass
       would overwrite with a mail that arrived after the greeting had gone. */
    if (greeted.current) return;
    /* AND THE MAILBOX HAS ANSWERED, OR RUN OUT OF TIME. At most MAIL_GATE_MS,
       and zero added latency with no connector. The prompt is composed at this
       instant and never again: `primeConsent` memoises the PROMISE and ignores
       the prompt of every later caller, so a greeting that waits for the mail
       must wait BEFORE the first call rather than recompose after it. */
    if (!mailGate) return;
    const said = `${brief.greeting ?? ""} ${ask ? ask.line : brief.position}`.trim();
    if (!said) return;
    greetedWithMail.current = Boolean(mailNote);
    greeted.current = true;
    narration.open(openingIdRef.current, { act: "greeting", sentence: said });
  }, [ask, brain, brief.greeting, brief.position, lookedUp, mailGate, mailNote, narration, packagePending]);

  /* MAIL THAT MISSED THE GATE IS A SECOND REMARK, NEVER A REWRITTEN GREETING.
     The greeting is already on the glass and it is the one call that carried
     consent; taking it back would be the room changing its mind in front of the
     banker. So the room says one more thing, under it, in its own bubble.

     `narrate`, not `prime`: there is no second consent dialog, and no second
     connector call either. A declined view deletes the greeting's own view in
     `settle()`, which is also what silences this. */
  const followedUp = useRef(false);
  useEffect(() => {
    if (!brain || !mailNote || followedUp.current) return;
    if (!greeted.current || greetedWithMail.current) return;
    const opening = narration.viewFor(openingIdRef.current);
    if (!opening || opening.pending) return;
    followedUp.current = true;
    const who = mailNote.from ?? "the client";
    const when = mailNote.received ? ` on ${mailNote.received}` : "";
    narration.narrate(`${openingIdRef.current}::mail`, {
      act: "mail",
      sentence: `A message from ${who}${when} is open on this relationship.`,
    });
  }, [brain, mailNote, narration]);

  useEffect(() => {
    const last = items[items.length - 1];
    if (!last || narrated.current.has(last.id)) return;
    narrated.current.add(last.id);
    // The sentence the room put up just before this item is what the model is
    // writing beside, so a chip block inherits the line that announced it.
    const prior = items[items.length - 2];
    const said = prior && prior.kind === "agent" ? prior.text : undefined;
    /* A RIDER ON A FACILITY SAYS THE WHOLE OF ITSELF ON ITS CARD (founder,
       2026-09-03). The label lanes stage a covenant association, a party, a
       pledge and a fee as arm entries; each card carries the record, the
       facility and what it authors, and on the sixteenth build the model added a
       paragraph under one of them with two figures nobody had read. Only the
       room knows what an arm is, so the room is what says so. */
    const rider =
      last.kind === "chips" &&
      last.chips.length > 0 &&
      last.chips.every((c) => !c.delta || !!armOf(c.delta));
    const subject = subjectFor(last as unknown as Parameters<typeof subjectFor>[0], said, { routine: rider });
    if (!subject) return;
    /* ============ THE REVIEW MOMENT IS A STAGED MOMENT (founder, 2026-09-03)

       Under the review card the room narrated at the ANSWERED budget - seventy
       five words, the budget for a read the banker asked a question to get -
       and put two paragraphs of credit commentary in front of a man who had
       clicked Review and execute. From the moment a plan is on the table the
       facts are on the cards and the rail, so the remark is held to the STAGED
       budget: two short sentences of consequence, and nothing that repeats a
       figure already on the glass. */
    const tightened =
      flow !== null && subject.act === "answered" ? { ...subject, act: "staged" as const } : subject;
    const asked = [...items].reverse().find((i) => i.kind === "banker");
    narration.narrate(last.id, tightened, asked && asked.kind === "banker" ? asked.text : "");
  }, [flow, items, narration]);

  /**
   * WHAT THE DESK SAID, DRAWN.
   *
   * `fallback` is the parse the room already holds for this line. A DEGRADE
   * falls back to it: the second lane having a bad round trip must never leave
   * the banker with less than the fast lane alone would have given them.
   */
  const landBrainReply = useCallback(
    async (
      reply: BrainReply | null,
      instruction: string,
      mine: number,
      opts: { fallback?: IntentResult | null; routeOpen?: boolean } = {},
    ) => {
      const answer = (item: NewItem) => setItems((prev) => [...prev, { ...item, step: mine } as ThreadItem]);
      const fallback = opts.fallback ?? null;

      if (!reply || (isDegrade(reply) && fallback)) {
        if (fallback) {
          renderParse(instruction, fallback, mine);
          return;
        }
        answer({ kind: "agent", id: nextId("agent"), text: UNREADABLE_CLARIFY.text });
        return;
      }

      /* THE ROUTE, RESOLVED FROM INTENT (spec 4). The brain may NAME the route
         while the question is open; binding still runs through `router.onBind`,
         so a named route can do nothing a chip could not. An ambiguous reply
         names none, and the question stands. */
      if (opts.routeOpen && router) {
        const named = reply.route ?? (reply.type === "delta-proposal" ? "modify" : undefined);
        if (named && ROUTE_WORDS.has(named)) {
          // A LOCK IS NOT A LANE CONCERN (rule 2). The desk may name the route
          // the banker meant; it cannot name one the org has already forked.
          if (refuseLockedRoute(named as WorkroomMode)) return;
          setAsk(null);
          router.onBind(named as WorkroomMode, { say: instruction });
          return;
        }
      }

      if (reply.type === "read-card") {
        // THE ROOM HAS ONE CARD LANGUAGE. A brain answer renders through the
        // same component a locally built read does; nothing is forked for it.
        answer({ kind: "read", id: nextId("read"), card: toReadCardModel(reply) });
        return;
      }
      if (reply.type === "clarify") {
        /* A CLARIFY IS HELD TO THE WIRE (C, the drive). A fee create whose
           question is about a basis, a payment method or a paid-by is asking
           about fields `feeAddsJson` does not carry, so it can only cost the
           banker a round trip. The room falls back to its own parse, which is
           where the fast lane was going to answer this line anyway. */
        if (fallback && clarifyOffWire(reply, instruction)) {
          renderParse(instruction, fallback, mine);
          return;
        }
        answer({ kind: "agent", id: nextId("agent"), text: reply.text, options: reply.options });
        return;
      }

      /* A DELTA-PROPOSAL RE-ENTERS THE FAST LANE. It is restated as the
         sentence a banker could have typed and goes through `runParser`, which
         is the only path this room has to a staged change. The brain never
         reaches a tool, never mints a token and never sees the approval.

         ONE change goes straight through, because the banker asked for
         something and is owed the chip rather than a second gesture. SEVERAL
         arrive as chips: the room takes one decision at a time (rule 2), and a
         tap says exactly the sentence shown on it. */
      /* THE RESTATED LINE MUST NAME A FACILITY, NOT A PRODUCT (2026-09-01
         evening drive). Where two members share a key, `facilityLabel` puts the
         commitment in front, so the sentence the desk's proposal becomes reads
         "take the $15.0MM Line of Credit to $20,000,000" and the qualifier the
         room already trusts resolves it to that one member. Without it the desk
         resolved correctly and the room still staged both, which is the same
         wrong reduction the direct lane was fixed for. */
      const { lines, dropped } = restateProposal(reply, (loanId) => {
        const member = loanId ? (brief.members.find((m) => m.id === loanId) ?? null) : focused;
        return member ? facilityLabel(member, brief.members) : null;
      });
      if (!lines.length) {
        answer({
          kind: "agent",
          id: nextId("agent"),
          text: `${reply.rationale} I could not put that up as a change from here. Say it the way you would write it and I will stage it.`,
        });
        return;
      }
      const held = dropped
        ? ` ${dropped} other ${dropped === 1 ? "part" : "parts"} of that could not be put up from here.`
        : "";
      if (lines.length === 1) {
        answer({ kind: "agent", id: nextId("agent"), text: `${reply.rationale} Reading that as: ${lines[0].say}.${held}` });
        await runParser(lines[0].say, mine);
        return;
      }
      answer({
        kind: "agent",
        id: nextId("agent"),
        text: `${reply.rationale} That is ${lines.length} changes. One at a time.${held}`,
        options: lines.map((l) => ({ label: l.label, say: l.say })),
      });
    },
    [brief.members, focused, refuseLockedRoute, renderParse, router, runParser],
  );

  /**
   * THE BRAIN LANE, RUN, for a line the room does not act on: a question, or a
   * line arriving while the route is still open.
   *
   * THE THINKING PULSE RIDES THE ROUND TRIP, and the composed beat is the same
   * floor the fast lane holds: an answer that snaps back reads as a lookup.
   */
  const runBrain = useCallback(
    async (instruction: string, mine: number, routeOpen = false) => {
      if (!brain) return;
      const started = Date.now();
      setThinking(true);
      let reply: BrainReply | null;
      try {
        reply = await askTheDesk(instruction, routeOpen);
        await beat(started);
      } finally {
        setThinking(false);
      }
      await landBrainReply(reply, instruction, mine, { routeOpen });
    },
    [askTheDesk, beat, brain, landBrainReply],
  );

  /**
   * THE INVERTED DISPATCH, for a line the room has to ACT on.
   *
   * The parser runs FIRST and it runs silently. Its result is accepted without
   * the brain only where it is PROVABLY CLEAN: it staged at least one sound
   * delta, off a single clause, with no dollar qualifier contradicting the
   * member set it resolved. That keeps the instant card for every phrasing the
   * parser's own suite proves. EVERYTHING ELSE GOES TO THE DESK, carrying the
   * parse behind it as the degrade — so the room is never worse than the fast
   * lane alone, and is better wherever the desk answers.
   *
   * WITH NO BRIDGE THIS IS THE FAST LANE AND NOTHING ELSE. Channel-none parity
   * is a contract, not a fallback: no wait, no notice, no changed behaviour.
   */
  const runLine = useCallback(
    async (instruction: string, mine: number, note = "") => {
      if (!brain) {
        await runParser(instruction, mine, note);
        return;
      }
      const started = Date.now();
      setThinking(true);
      let result: IntentResult | null = null;
      let reply: BrainReply | null = null;
      try {
        try {
          result = await engine.parseIntent(instruction, context);
        } catch {
          result = null;
        }
        const sound =
          result?.kind === "deltas" ? result.deltas.filter((d) => !unsoundFieldChange(instruction, d)) : [];
        /* AN EXCEPTION CREATE'S QUESTION IS THIS ROOM'S OWN (E7, 2026-09-02).
           `provablyClean` reads anything that is not deltas as a failed parse,
           and an exception create legitimately comes back asking what mitigates
           it: the fenced reader will not default a credit judgement. Sending
           that to the desk is how "log a policy exception for leverage above
           policy" was answered as a question about the exception already on
           file, with nothing staged. A REFUSAL still goes to the desk, because
           a refusal is not a question. */
        const ownAsk =
          result !== null &&
          result.kind !== "refusal" &&
          (readExceptionOpen(instruction, elicitMembers) !== null || readFeeOpen(instruction, elicitMembers) !== null);
        const clean =
          result !== null &&
          (ownAsk ||
            provablyClean({
              line: instruction,
              result,
              sound,
              qualifier: qualifierFilter(instruction, sound, qualifierMembers),
            }));
        if (!clean) reply = await askTheDesk(instruction, false);
        await beat(started);
        if (clean && result) {
          renderParse(instruction, result, mine, note);
          return;
        }
      } finally {
        setThinking(false);
      }
      await landBrainReply(reply, instruction, mine, { fallback: result });
    },
    [askTheDesk, beat, brain, context, elicitMembers, engine, landBrainReply, qualifierMembers, renderParse, runParser],
  );

  /* ========================================================= THE CREATE GRAMMAR

     A create that has not resolved never reaches a chip (D1). It is gathered
     for, one question at a time, with what the room can already ground offered
     as the answers; only when nothing the human owns is missing is a sentence
     composed, run through the SAME parser every typed line goes through, and
     VERIFIED against what was elicited before a chip is drawn.

     NOTHING HERE IS A NEW WRITE PATH. Everything it composes is a sentence the
     engines already file, and `app/src/workroom/` is untouched by all of it. */

  /**
   * AN ENTRY ALREADY ON THE PLAN IS MOVED, NEVER DOUBLED.
   *
   * The banker said the same test on the same facility again with a different
   * figure. That is the entry he already confirmed, corrected, so it takes the
   * new figure in the manifest position it already holds. Two entries moving
   * the same test would be a contradiction he has to reconcile by hand, which
   * is the work this room exists to remove.
   */
  const amendPlanEntry = useCallback(
    async (d: Draft, onPlan: PlanAmendment, mine: number) => {
      const answer = (item: NewItem) => setItems((prev) => [...prev, { ...item, step: mine } as ThreadItem]);
      // ONE MEMBER, ONE SENTENCE. `planAmendmentFor` only fires on a line that
      // lands on exactly one facility, so the composition is exactly one line.
      const composition = compose(d, elicitCtx);
      const composed = composition.lines[0];

      // A ROUTE THAT COULD NOT FILE IT CANNOT FILE THE CORRECTION EITHER, and
      // the corrected handoff is what belongs on the plan.
      const routeSaid = routeGap(d.surface, context.mode);
      const started = Date.now();
      setThinking(true);
      let taken: WorkroomDelta | null = null;
      try {
        if (routeSaid) {
          taken = handoffEntry(d, elicitCtx, composed.memberId, routeSaid, 0);
        } else {
          let result: IntentResult | null = null;
          try {
            result = await engine.parseIntent(composed.say, context);
          } catch {
            result = null;
          }
          const verdict =
            result?.kind === "deltas"
              ? verify(d, composed.memberId, result.deltas)
              : { ok: false as const, why: "it did not come back as a change" };
          if (verdict.ok) taken = restateEntry(d, elicitCtx, verdict.delta);
          else engine.pick(composed.memberId);
        }
        await beat(started);
      } finally {
        setThinking(false);
      }

      if (!taken) {
        answer({
          kind: "agent",
          id: nextId("agent"),
          text: "That correction does not resolve against the bank's own catalog, so the entry on the plan is unchanged and nothing has been staged beside it.",
        });
        return;
      }

      const replacement = composition.gaps.length
        ? { ...taken, caveat: [taken.caveat, ...composition.gaps].filter(Boolean).join(" ") }
        : taken;
      draftsRef.current.delete(onPlan.entry.deltaId);
      draftsRef.current.set(replacement.id, d);
      setEntries((prev) => prev.map((e) => (e.id === onPlan.entry.deltaId ? replacement : e)));
      /* THE CARD THE BANKER ALREADY SIGNED IS THE CARD THAT MOVED. Leaving the
         old delta on the settled chip would leave it reading "removed" against
         a manifest it is still in, which is the room telling him something
         untrue about a decision he made. */
      setItems((prev) =>
        prev.map((item) =>
          item.kind === "chips"
            ? {
                ...item,
                chips: item.chips.map((c) => (c.delta?.id === onPlan.entry.deltaId ? { ...c, delta: replacement } : c)),
              }
            : item,
        ),
      );
      setToast(replacement.badge);
      answer({ kind: "agent", id: nextId("agent"), text: amendedPlanLine(onPlan.changed) });
    },
    [beat, context, elicitCtx, engine],
  );

  /**
   * A COMPLETE CREATE, PUT UP.
   *
   * One composed sentence per member, each verified before it is allowed to
   * become a chip. What could not be composed is said BY NAME, and what a
   * complete create still cannot file rides the entry's own caveat so it
   * travels with the entry onto the plan rather than living in one sentence
   * that scrolls away.
   */
  const landCreate = useCallback(
    async (d: Draft, mine: number): Promise<WorkroomDelta[]> => {
      const answer = (item: NewItem) => setItems((prev) => [...prev, { ...item, step: mine } as ThreadItem]);

      /* THE PLAN IS ACTED ON, NOT DUPLICATED. A line that lands on a facility
         this session has already staged this very test on is a CORRECTION of
         that entry, so it moves the entry rather than putting a second,
         contradicting one beside it. Book-level duplication is different and is
         answered below: the book is the bank's record and this room does not
         edit it. */
      const onPlan = planAmendmentFor(d, elicitCtx);
      if (onPlan) {
        await amendPlanEntry(d, onPlan, mine);
        return [];
      }

      /* THE BOOK AND THE PLAN, READ BACK BEFORE ANYTHING GOES UP. A create the
         relationship already carries is NAMED and offered rather than staged a
         second time in silence. */
      const aware = awarenessFor(d, elicitCtx);
      /* A PLEDGE FANNED OUT OVER SEVERAL FACILITIES SETTLES THE ALREADY-
         PLEDGED ONES AS ROWS, NOT AS ONE PROSE SENTENCE NAMING THEM TOGETHER
         (founder finding, 2026-09-03). `aware.onTheBook` still carries that
         sentence for the room's OTHER surfaces, and for a collateral create
         that skips EVERY facility it names (the early return just below,
         unchanged): there `alreadyRows` would have nothing to sit beside.
         Only where some facilities are fresh and some are already on the
         book does the sentence give way to a card per skipped facility. */
      const alreadyRows =
        d.surface === "collateral" && d.slots.assetId && aware.alreadyOn?.length && aware.fresh.length
          ? (() => {
              const asset = book.assets.find((a) => a.id === d.slots.assetId);
              return asset
                ? aware.alreadyOn!.map((id) => pledgeAlreadySettled(asset, { facilityId: id, facilityLabel: memberLabel(id) }))
                : [];
            })()
          : [];
      const notes = [aware.onThePlan, alreadyRows.length ? null : aware.onTheBook].filter((n): n is string => Boolean(n));
      if (!aware.fresh.length) {
        // THE CREATE STAYS ALIVE. The banker was offered a way through it, so
        // the next line is an answer to that offer rather than a new sentence
        // that has to say everything again.
        setCreating(d);
        answer({
          kind: "agent",
          id: nextId("agent"),
          text: `${notes.join(" ")} ${aware.close ?? "Nothing here needs putting up twice."}`,
          options: aware.options.length ? aware.options : undefined,
        });
        return [];
      }
      const scoped: Draft = { ...d, scope: aware.fresh };
      const composition = compose(scoped, elicitCtx);

      /* THIS ROUTE FILES SOMETHING ELSE, AND THE ROOM SAYS SO BY NAME.
         A renewal files a maturity and a repricing; a new facility files four
         scalars against the package anchor. Neither carries a covenant or a
         pledge, so there is no sentence worth composing for either engine and
         none is: the create goes on the plan as a HANDOFF, which is the honest
         record and writes nothing anywhere. A room that gathered all of it and
         then went quiet would be dropping the whole thing silently (rule 8). */
      const routeSaid = associateGap(scoped, context.mode) ?? routeGap(scoped.surface, context.mode);

      const started = Date.now();
      setThinking(true);
      const got: WorkroomDelta[] = [];
      const refused: string[] = [];
      try {
        for (const [seq, line] of composition.lines.entries()) {
          /* ============ THE THIRD INSTRUMENT IS A REAL CARD NOW (P1, 2026-09-02)

             `covenantAttachesJson` files a junction for the covenant the book
             already carries, so the associate chip stages instead of handing off.
             It never goes through the parser: there is no sentence to compose,
             because the covenant already exists and what this authors is the
             junction alone. The two refusals the org would give are given HERE,
             by name, rather than at the confirm gate after the banker signed. */
          /* ========== A CREATE ON A FACILITY THIS PLAN IS CREATING (2026-09-03)

             It never goes through the parser, for the reason the associate does
             not: there is nothing worth composing. The fenced engine resolves a
             facility against the PACKAGE and this one is not on it, so a composed
             sentence would come back unresolved or, worse, resolved onto a booked
             member that happens to share the product word. Everything the card
             carries was already settled by the create grammar above; the wire
             carries the LABEL and the org resolves it to the loan it just wrote. */
          const creatingSpec = specFor(line.memberId);
          if (creatingSpec && !scoped.slots.associate) {
            const made = newFacilityCreateEntry({ draft: scoped, ctx: elicitCtx, spec: creatingSpec, seq: seq });
            if (made) {
              got.push(made);
              continue;
            }
            refused.push(
              `on the ${memberLabel(line.memberId)}, the create did not carry everything the org needs for a facility this plan has not filed yet`,
            );
            continue;
          }

          const attach = attachFor(scoped, line.memberId);
          if (attach?.kind === "refusal") {
            refused.push(`on the ${memberLabel(line.memberId)}, ${attach.why}`);
            continue;
          }
          if (attach?.kind === "attach") {
            got.push(attach.delta);
            continue;
          }
          /* AN EXISTING ASSET, KEYED TO THIS FACILITY DIRECTLY, NEVER RE-
             PARSED (founder finding, 2026-09-03). The asset was resolved
             against the book before this create was composed, and the
             facility is this line's own `memberId`: there is nothing left
             for a re-sent sentence to settle, and two facilities that share
             a product word cannot defeat a resolution this room never asks
             the parser to redo. */
          const pledge = pledgeFor(scoped, line.memberId);
          if (pledge) {
            got.push(pledge);
            continue;
          }
          if (routeSaid) {
            got.push(handoffEntry(scoped, elicitCtx, line.memberId, routeSaid, seq));
            continue;
          }
          let result: IntentResult | null = null;
          try {
            result = await engine.parseIntent(line.say, context);
          } catch {
            result = null;
          }
          const verdict =
            result?.kind === "deltas"
              ? verify(scoped, line.memberId, result.deltas)
              : { ok: false as const, why: "the sentence did not come back as a change at all" };
          if (!verdict.ok) {
            refused.push(`on the ${memberLabel(line.memberId)}, ${verdict.why}`);
            // THE ENGINE'S OWN QUESTION STATE IS LEFT CLEAN. A composed sentence
            // that ended in a clarify would make the banker's NEXT line an
            // answer to a question they never saw. `pick` is the engine's own
            // documented way back to a settled state, and it lands the room on
            // the member the create was about, which is where it belongs.
            engine.pick(line.memberId);
            continue;
          }
          got.push(restateEntry(scoped, elicitCtx, verdict.delta));
        }
        await beat(started);
      } finally {
        setThinking(false);
      }

      if (!got.length) {
        answer({
          kind: "agent",
          id: nextId("agent"),
          text:
            `I gathered all of that and I am not putting it up, because ${refused[0] ?? "it did not resolve"}. ` +
            "Nothing is staged and the package has not moved. Name a test the bank's catalog carries and I will compose it again.",
        });
        return [];
      }

      /* WHAT A COMPLETE CREATE STILL CANNOT FILE rides the entry, so it reaches
         the plan with the entry rather than only the conversation. */
      const withGaps = composition.gaps.length
        ? got.map((x) => ({ ...x, caveat: [x.caveat, ...composition.gaps].filter(Boolean).join(" ") }))
        : got;
      for (const x of withGaps) draftsRef.current.set(x.id, scoped);

      const said = [
        notes.join(" "),
        composition.lede,
        routeSaid ?? "",
        composition.gaps.length ? `Not all of that reaches the bank's systems. ${composition.gaps.join(" ")}` : "",
        refused.length ? `What I could not put up: ${refused.join("; ")}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      setItems((prev) => [
        ...prev,
        { kind: "agent", id: nextId("agent"), step: mine, text: said },
        {
          kind: "chips",
          id: nextId("chips"),
          step: mine,
          chips: [
            ...withGaps.map((x) => ({ key: nextId("chip"), delta: x, state: "open" as ChipState })),
            // THE SETTLED ROWS. A facility already carrying the pledge reads
            // as one of these, beside the cards that actually stage.
            ...alreadyRows.map((r) => ({ key: nextId("chip"), refusal: r, state: "open" as ChipState })),
          ],
        },
      ]);
      setSuggestion(engine.suggest());
      return withGaps;
    },
    [amendPlanEntry, beat, book, context, elicitCtx, engine, memberLabel, pledgeFor],
  );

  /**
   * A PRICING FIELD, PUT UP AS ITS OWN CHIP ON THE FACILITY THAT MOVED.
   *
   * The sentence goes through the SAME parser every typed line goes through, and
   * what comes back is filtered to the ONE delta carrying the API name the room
   * asked for. That filter is load-bearing: "set the amortisation term to 240
   * months" also matches the TERM scalar inside the fenced parser, so the reply
   * carries a `requestedTermMonths` delta beside the field change, and staging
   * it would move a term nobody asked to move.
   */
  /**
   * THE GATE'S QUESTION, WHICHEVER SLOT IT IS ON.
   *
   * The two field slots are the pricing gate's own; the rate is `rateGate`'s,
   * because a rate question is not a blank to fill in - it offers the figure the
   * book already holds, the two ways of changing it, and an example of the
   * answer. ONE builder so the confirm site, the re-ask and the "what are my
   * options" answer cannot drift apart.
   */
  const gateAsk = useCallback(
    (need: PricingNeed, staged: WorkroomDelta[]): { text: string; options: Array<{ label: string; say: string }> } | null => {
      const member = elicitMembers.find((m) => m.id === need.memberId);
      if (!member) return null;
      if (need.slot !== "rate") {
        const ask = pricingAsk(need, member, { entries: staged, generatedAt: reads?.generatedAt });
        return { text: ask.text, options: ask.options };
      }
      const said = rateIndexSaid.current.has(need.memberId);
      rateIndexSaid.current.add(need.memberId);
      const ask = rateAsk(member, rateOnFile(facilityRead.get(need.memberId)), said);
      return { text: ask.text, options: ask.options };
    },
    [elicitMembers, facilityRead, reads?.generatedAt],
  );

  const landPricing = useCallback(
    async (need: PricingNeed, value: string, mine: number) => {
      const member = elicitMembers.find((m) => m.id === need.memberId);
      if (!member) return;
      const composed = need.slot === "rate" ? rateSay(member, value) : pricingSay(member, need.slot, value);
      const started = Date.now();
      setThinking(true);
      let taken: WorkroomDelta | null = null;
      try {
        let result: IntentResult | null = null;
        try {
          result = await engine.parseIntent(composed, context);
        } catch {
          result = null;
        }
        if (result?.kind === "deltas") {
          /* THE RATE IS A SCALAR, NOT A FIELD-WAVE FIELD. `requestedRate` is one
             of the four the modification has always filed, so the filter reads
             the WIRE for it and the field name for the other two. */
          taken =
            result.deltas.find((d) =>
              d.member === need.memberId &&
              (need.slot === "rate"
                ? d.wire?.key === "requestedRate"
                : d.fieldWire?.field === PRICING_FIELD[need.slot]),
            ) ?? null;
        }
        await beat(started);
      } finally {
        setThinking(false);
      }
      if (!taken) {
        // THE ENGINE'S OWN QUESTION STATE IS LEFT CLEAN, exactly as a composed
        // create does when its sentence does not come back as a change.
        engine.pick(need.memberId);
        setItems((prev) => [
          ...prev,
          {
            kind: "agent",
            id: nextId("agent"),
            step: mine,
            text: `That did not come back as a change to the ${member.label}, so nothing is on the plan for it. Say the figure again and I will put it up.`,
          },
        ]);
        return;
      }
      /* THE REASON RIDES THE ENTRY. A field change on a plan with no sentence
         beside it reads as a field somebody touched; this one is the reason the
         version can be priced at all, and that travels onto the plan with it. */
      /* THE REASON, OR THE INDEX. A field change gets the pricing reason; a RATE
         gets the composition the banker said it off, because the org stores the
         all-in figure and the index is the only part of their thinking that
         would otherwise be lost. */
      const index = need.slot === "rate" ? (rateIndexOf.current.get(need.memberId) ?? null) : null;
      if (index) rateIndexOf.current.delete(need.memberId);
      const rider = need.slot === "rate" ? (index ? rateIndexNote(index) : "") : PRICING_WHY;
      const carded: WorkroomDelta = { ...taken, caveat: [taken.caveat, rider].filter(Boolean).join(" ") };
      /* THE ANSWER REACHED A CARD. From here it is on the plan or the room says
         so at approve; it is never quietly absent. */
      pricingAnswered.current.set(carded.id, { id: carded.id, title: carded.title, target: carded.target });
      setItems((prev) => [
        ...prev,
        {
          kind: "agent",
          id: nextId("agent"),
          step: mine,
          /* THE FIGURE IS ON THE SENTENCE AND ON THE CARD. "The banker has
             supplied an all-in rate" with no number in it was the dead end this
             gate replaced; a rate that landed says what it landed at. */
          text:
            need.slot === "rate"
              ? `The ${member.label} moves to ${carded.after}${index ? `, priced off ${index}` : ""}. Confirm it and it goes on the plan.`
              : pricingLanded(need.slot, member, carded.after),
        },
        {
          kind: "chips",
          id: nextId("chips"),
          step: mine,
          chips: [{ key: nextId("chip"), delta: carded, state: "open" as ChipState }],
        },
      ]);
    },
    [beat, context, elicitMembers, engine],
  );

  /**
   * THE ONE QUESTION THIS CREATE STILL NEEDS, or the create itself.
   *
   * One question at a time, in chips, in the room's own vocabulary. Free text
   * always wins: the chips are an offer and a banker who types the whole answer
   * skips every one of them.
   */
  const askCreate = useCallback(
    async (d: Draft, mine: number) => {
      const answer = (item: NewItem) => setItems((prev) => [...prev, { ...item, step: mine } as ThreadItem]);

      const step = advance(d, elicitCtx);
      if (step.ask) {
        setCreating(step.draft);
        answer({ kind: "agent", id: nextId("agent"), text: step.ask.text, options: step.ask.options });
        return;
      }
      setCreating(null);
      await landCreate(step.draft, mine);
    },
    [elicitCtx, landCreate],
  );

  /**
   * THE CARD IS AMENDED IN PLACE.
   *
   * "actually make it 1.30x" corrects the open card and says what changed. It
   * never stages a second, contradicting chip: amending the open card IS the
   * one decision, so this does not violate one decision at a time. The old
   * chips come out of the block and the new ones go into the SAME block, in the
   * same step, so the card the banker is reading is the card that moved.
   */
  const amendOpenCard = useCallback(
    async (line: string, mine: number): Promise<boolean> => {
      const block = [...items].reverse().find(
        (i) => i.kind === "chips" && i.chips.some((c) => c.state === "open" && c.delta && draftsRef.current.has(c.delta.id)),
      );
      if (!block || block.kind !== "chips") return false;
      const mineChips = block.chips.filter((c) => c.state === "open" && c.delta && draftsRef.current.has(c.delta.id));
      const held = draftsRef.current.get(mineChips[0].delta!.id)!;
      const amend = amendmentOf(line, held, elicitCtx);
      if (!amend) return false;

      const answer = (item: NewItem) => setItems((prev) => [...prev, { ...item, step: mine } as ThreadItem]);
      const aware = awarenessFor(amend.draft, elicitCtx);
      const scoped: Draft = { ...amend.draft, scope: aware.fresh.length ? aware.fresh : amend.draft.scope };
      const composition = compose(scoped, elicitCtx);

      // A ROUTE THAT COULD NOT FILE IT CANNOT FILE THE CORRECTION EITHER. The
      // card is still amendable; what it corrects is the handoff on the plan.
      const routeSaid = associateGap(scoped, context.mode) ?? routeGap(scoped.surface, context.mode);
      const started = Date.now();
      setThinking(true);
      const got: WorkroomDelta[] = [];
      try {
        for (const [seq, composed] of composition.lines.entries()) {
          /* ========== A CREATE ON A FACILITY THIS PLAN IS CREATING (2026-09-03)

             It never goes through the parser, for the reason the associate does
             not: there is nothing worth composing. The fenced engine resolves a
             facility against the PACKAGE and this one is not on it, so a composed
             sentence would come back unresolved or, worse, resolved onto a booked
             member that happens to share the product word. Everything the card
             carries was already settled by the create grammar above; the wire
             carries the LABEL and the org resolves it to the loan it just wrote. */
          const creatingSpec = specFor(composed.memberId);
          if (creatingSpec && !scoped.slots.associate) {
            const made = newFacilityCreateEntry({ draft: scoped, ctx: elicitCtx, spec: creatingSpec, seq: seq });
            if (made) {
              got.push(made);
              continue;
            }
            // The amend lane has no refusal list: an amendment that does not
            // resolve leaves the card exactly as it was, and the sentence below
            // says so once for the whole block.
            continue;
          }

          const attach = attachFor(scoped, composed.memberId);
          if (attach?.kind === "attach") {
            got.push(attach.delta);
            continue;
          }
          if (attach?.kind === "refusal") continue;
          if (routeSaid) {
            got.push(handoffEntry(scoped, elicitCtx, composed.memberId, routeSaid, seq));
            continue;
          }
          let result: IntentResult | null = null;
          try {
            result = await engine.parseIntent(composed.say, context);
          } catch {
            result = null;
          }
          const verdict =
            result?.kind === "deltas"
              ? verify(scoped, composed.memberId, result.deltas)
              : { ok: false as const, why: "it did not come back as a change" };
          if (verdict.ok) got.push(restateEntry(scoped, elicitCtx, verdict.delta));
          else engine.pick(composed.memberId);
        }
        await beat(started);
      } finally {
        setThinking(false);
      }

      if (!got.length) {
        answer({
          kind: "agent",
          id: nextId("agent"),
          text: "That correction does not resolve against the bank's own catalog, so the card is unchanged and nothing has been staged beside it.",
        });
        return true;
      }

      const replacements = composition.gaps.length
        ? got.map((x) => ({ ...x, caveat: [x.caveat, ...composition.gaps].filter(Boolean).join(" ") }))
        : got;
      for (const x of replacements) draftsRef.current.set(x.id, scoped);
      const oldIds = new Set(mineChips.map((c) => c.delta!.id));
      setItems((prev) =>
        prev.map((item) => {
          if (item.kind !== "chips" || item.id !== block.id) return item;
          const keys = mineChips.map((c) => c.key);
          const fresh: ChipModel[] = replacements.map((delta, i) => ({
            key: keys[i] ?? nextId("chip"),
            delta,
            state: "open" as ChipState,
          }));
          const rest = item.chips.filter((c) => !c.delta || !oldIds.has(c.delta.id));
          return { ...item, chips: [...rest, ...fresh] };
        }),
      );
      answer({ kind: "agent", id: nextId("agent"), text: changedLine(amend.changed) });
      return true;
    },
    [beat, context, elicitCtx, engine, items],
  );

  /**
   * The banker said something. EVERY SEND STARTS A STEP (rule 31).
   *
   * `heard` is what the engine parses; `said` is what the thread shows. They
   * differ for a suggestion pill, whose label is banker grammar and whose
   * instruction has to be precise enough to resolve one member out of six.
   */
  const say = useCallback(
    async (heard: string, said?: string, opts?: { settled?: boolean; fed?: string }) => {
      const trimmed = heard.trim();
      if (!trimmed || !awake) return;
      /* WHERE THIS LINE CAME FROM, for the one commit that renders it. The feed
         is serial by construction (`useRoomFeed` holds a busy latch and awaits
         `say`), so there is exactly one line in flight and a ref is the honest
         carrier: threading a marker through six composers would put an intent's
         vocabulary into every one of them. */
      fedRef.current = opts?.fed ?? null;
      /* THE EXCHANGE MOVED ON. A hush lasts as long as the trouble it was
         about: the banker saying something next is the room's signal that they
         have dealt with it, whether by reloading or by carrying on. */
      unhushRef.current?.();

      /* ============ THE FAULT-STATE CHIPS ANSWER HERE, BEFORE THE GRAMMAR

         Four lines the ROOM put in the banker's mouth, and each is a gesture
         rather than an instruction: they are what a deadline and a resume offer
         leave behind. They are intercepted ahead of the parser because a parser
         that met "try that again" would answer it as a change to a facility
         called "that", which is the room misreading its own words back.

         Each lands the banker's own bubble first, on the same rule every other
         refusal in this room follows: an answer with nothing visible above it
         reads as the room talking to itself. */
      if (trimmed.toLowerCase() === TRY_AGAIN.say) {
        const mine = step + 1;
        setStep(mine);
        setItems((prev) => [...prev, bankerLine(mine, (said ?? heard).trim(), opts?.fed)]);
        if (!entriesRef.current.length) {
          agent("There is nothing on the manifest to put up. Say the change you want and I will stage it.");
          return;
        }
        openFlowRef.current();
        return;
      }
      if (trimmed.toLowerCase() === KEEP_THE_PLAN.say) {
        const mine = step + 1;
        setStep(mine);
        setItems((prev) => [...prev, bankerLine(mine, (said ?? heard).trim(), opts?.fed)]);
        agent(
          "The manifest stands exactly as it is. Nothing has been sent to the org and nothing has been filed. " +
            "Put it up whenever you are ready.",
        );
        return;
      }
      if (isResumeSay(trimmed) && planOfferRef.current) {
        const doc = planOfferRef.current;
        planOfferRef.current = null;
        // The record rebuilds from the replay, so the room does not end up
        // holding two copies of a line the banker said once.
        planSaidRef.current = [];
        const mine = step + 1;
        setStep(mine);
        setItems((prev) => [...prev, bankerLine(mine, (said ?? heard).trim(), opts?.fed)]);
        /* THE ROUTE THE PLAN WAS BUILT ON, BOUND BEFORE ITS LINES GO BACK IN.
           The stored plan is read by route, so this is always the route the
           room already carries: the bind closes the three-way question rather
           than changing engine, exactly as picking the manifest up after a
           close does. Without it the first replayed line would meet the route
           gate and be answered with the question again. */
        setAsk(null);
        routerRef.current?.onBind(context.mode);
        /* THE LINES GO BACK THROUGH THE FRONT DOOR, one at a time, in the order
           they were said. Nothing is restored: every gate, every question and
           every refusal runs again, and the org stages afresh. */
        for (const line of doc.said) await sayRef.current(line);
        /* AND THE RE-STAGE NOTE COMES LAST, WHERE IT CAN BE READ (2026-09-05).
           Said before the replay it was true, on the glass, and gone: each
           replayed line advances the step, and the room folds every earlier
           step into "earlier steps" within a second. A warning about a spent
           token that the banker never sees is not a warning. */
        agent(RESUMED_NOTE);
        return;
      }
      if (isStartOverSay(trimmed) && planOfferRef.current) {
        const doc = planOfferRef.current;
        planOfferRef.current = null;
        planSaidRef.current = [];
        void clearPlan(doc.accountId, doc.packageId, doc.route);
        const mine = step + 1;
        setStep(mine);
        setItems((prev) => [...prev, bankerLine(mine, (said ?? heard).trim(), opts?.fed)]);
        agent("Starting over. The rail is empty and the plan you left is discarded. Say the first change whenever you like.");
        return;
      }
      /* THE LINE IN FLIGHT, held until the manifest moves. See `planSaidRef`. */
      lastSaidRef.current = trimmed;

      /* FREE TEXT ALWAYS WINS (founder, 2026-08-31). While the route is open the
         line does not go to the engine — it decides WHICH engine hears it. A
         line that names no route is answered by the question again, because
         guessing here would pick an engine on the banker's behalf.

         A READ DOES NOT PICK AN ENGINE (F1, 2026-09-01). The route gate used to
         intercept EVERY line, so "which borrowers are on this package" was
         answered with the three-way rather than with the card the room was
         already holding. A read is answered where it stands, and it binds
         nothing: asking what is on a package is not choosing what to do to it. */
      if (ask && router) {
        const readAsk = readTopic(trimmed);
        const preCard = readAsk !== null && reads ? buildReadCard(readAsk, reads, readNarrowing(readAsk, trimmed)) : null;
        if (!preCard) {
          const route = readRouteIntent(trimmed);
          if (route) {
            /* A TYPED LINE IS REFUSED THE SAME WAY A CHIP IS (rule 2). The
               banker's own bubble lands first, because a refusal answering
               nothing visible reads as the room talking to itself; the refusal
               owns the step, so both land in the same exchange. */
            if (lockedRoute(route)) {
              setItems((prev) => [...prev, bankerLine(step + 1, (said ?? heard).trim(), opts?.fed)]);
              refuseLockedRoute(route);
              return;
            }
            setAsk(null);
            router.onBind(route, { say: trimmed });
            return;
          }
        }
        const mine = step + 1;
        setStep(mine);
        setItems((prev) => [...prev, bankerLine(mine, (said ?? heard).trim(), opts?.fed)]);
        if (preCard) {
          setItems((prev) => [...prev, { kind: "read", id: nextId("read"), step: mine, card: preCard }]);
          return;
        }
        // THE DESK MAY RESOLVE THE ROUTE. It names one from intent where the
        // intent is plain; where it is not, it clarifies and the question stands.
        if (brain) {
          await runBrain(trimmed, mine, true);
          return;
        }
        setItems((prev) => [
          ...prev,
          {
            kind: "agent",
            id: nextId("agent"),
            step: mine,
            text: "I can take a modification, a renewal or a new facility from here. Pick one above, or say which of the three this is.",
          },
        ]);
        return;
      }

      /* ONE DECISION PER VIEW, AND IT IS DECIDED BEFORE THE STEP OPENS.
         (founder, 2026-09-01 — tweak 8, the compactness gap.)

         While a gate is open the room does not take a new instruction; it says
         so rather than quietly queueing one. What it must NOT do is open a
         STEP for the line it just refused: a refused line is not an exchange,
         and a step that starts on one pushes the still-open card into history's
         territory while rule 31 keeps it on screen — which is how the thread
         grew instead of collapsing. The refusal lands IN the step that owns the
         card it is about, so the room is never showing more than the live
         exchange plus the one decision it is waiting on.

         `settled` is the one exception and it is not a loophole: taking an
         advisory's resolution settles the cards it is about IN THE SAME
         GESTURE. A TYPED ACKNOWLEDGMENT is the second — "acknowledged" is the
         same decision the Acknowledge button makes, and where the only thing
         waiting is a CHECK, the word settles it exactly as the button does. */
      let instruction = trimmed;
      /** ONE SENTENCE THE SHELL OWNS about the parse this line becomes, where a
       *  lane composed the line itself and knows something the engine cannot.
       *  Empty for every ordinary line. */
      let feeNote = "";
      /** How many checks the line settled on its way in, where it was an
       *  acknowledgment. Zero for every other line. */
      let acknowledged = 0;
      /* AND THE THIRD EXCEPTION IS THE ROOM'S OWN FOLLOW-UP QUESTION (founder,
         2026-09-02). The pricing gate asks for the amortised term in the SAME
         commit as the confirm that made it matter, and a commitment change
         routinely trips a coverage check in that same commit. Refusing the
         answer to the room's own question with "one decision at a time" would
         leave the banker holding chips the room will not take. It is the same
         decision, continued: nothing new is being proposed by these lines and
         each of them is a sentence this room composed. */
      /* THE GATE THE ROOM IS ACTUALLY STANDING ON (founder drive, 2026-09-02).
         `pricingPending` is only set where the banker took the "Another date"
         chip. The gate the room ASKED is derived from the plan and the read, and
         a free-text answer belongs to it whether or not a chip was pressed:
         that is how "actually change it to Oct 1, 2026" fell through to the
         general parser and staged a $1 commitment. */
      const openGate = pricingPending ?? pricingOutstanding(entries);
      /* AND THE RATE GATE'S ANSWERS ARE ANSWERS TOO (founder, 2026-09-03). A
         line the open rate question can take is the SAME decision continued, so
         it must not meet "one decision at a time" over the card that raised it.
         Every form the gate reads is listed here, the courtesy in front of a
         figure included, which is the one that was re-asked on the drive. */
      const answersRate =
        openGate?.slot === "rate" &&
        (readRateFreeText(trimmed, { onFile: rateOnFile(facilityRead.get(openGate.memberId))?.pct ?? null }) !== null ||
          readRateHold(trimmed, elicitMembers) !== null ||
          readRateKeepWord(trimmed) ||
          readRateNew(trimmed, elicitMembers) !== null ||
          readRateIndexOpen(trimmed, elicitMembers) !== null ||
          readRateIndexPick(trimmed, elicitMembers) !== null ||
          asksRateOptions(trimmed));
      const answersPricing =
        answersRate ||
        readPricingLine(trimmed, elicitMembers) !== null ||
        readPricingDecline(trimmed, elicitMembers) !== null ||
        readPricingOther(trimmed, elicitMembers) !== null ||
        (openGate !== null &&
          openGate.slot !== "rate" &&
          (readPricingFreeText(trimmed, openGate.slot) !== null || readPricingAnother(trimmed, openGate.slot)));
      if (openGates > 0 && !opts?.settled && !answersPricing) {
        const ack = readAcknowledgment(trimmed);
        const checks = items.filter((i) => i.kind === "challenge" && !i.acked);
        if (!ack || !checks.length || checks.length !== openGates) {
          const here = items.length ? items[items.length - 1].step : 0;
          setItems((prev) => [...prev, bankerLine(here, (said ?? heard).trim(), opts?.fed)]);
          /* THE OPEN CARD IS AMENDABLE, AND THAT IS NOT A SECOND DECISION.
             "actually make it 1.30x" is the SAME decision, corrected, so it
             lands on the card that is already open instead of being refused
             with "one decision at a time" over a figure the banker has just
             told the room is wrong. */
          if (await amendOpenCard(trimmed, here)) return;
          setItems((prev) => [
            ...prev,
            {
              kind: "agent",
              id: nextId("agent"),
              step: here,
              text: "One decision at a time. The open card above, or the review chip under it, carries the next move.",
            },
          ]);
          return;
        }
        setItems((prev) => prev.map((i) => (i.kind === "challenge" && !i.acked ? { ...i, acked: true } : i)));
        instruction = ack.rest;
        acknowledged = checks.length;
      }

      const mine = step + 1;
      setStep(mine);
      setHistOpen(false);
      setFlow(null);
      setItems((prev) => [...prev, bankerLine(mine, (said ?? heard).trim(), opts?.fed)]);
      const answer = (item: NewItem) => setItems((prev) => [...prev, { ...item, step: mine } as ThreadItem]);

      /* A COURTESY IN FRONT OF AN IMPERATIVE IS A COMMAND (2026-09-01). Read
         once, here, because every lane below it acts on the line without the
         courtesy: the create grammar, the steer and the parser alike. */
      const commanded = politeCommand(instruction);

      /* ================================ "TAKE X OFF Y" IS TWO DIFFERENT MOVES
         (E5, fenced engine, shell workaround at rung 0.)

         parseModify.ts puts `take off` in the collateral verb class AND in the
         party verb class, and collateral wins the race, so "take Elena Hartwell
         off the 15M line" was read as an unpledge. The engine is fenced. So
         BEFORE it sees the line: where the object of the phrase is a PARTY on
         this book, the line is restated with the verb the engine already stages
         a carry exclusion on. Where it is an ASSET it is left alone, because
         there the collateral reading is the right one, and where it is both the
         room asks rather than picking.

         THE REWRITE IS SILENT. Same party, same facility, same op; only the verb
         moves, and every layer below it still runs. */
      /* A REMOVAL NEVER NAMES A FACILITY THIS PLAN IS CREATING, and the room
         says so by name rather than sending a plan up to be refused. A removal
         on a modification is a CARRY EXCLUSION: the booked facility keeps its own
         row and the new version starts without it. A facility being created holds
         nothing, so everything on it is an ADD. The Apex refuses this for the
         same reason; saying it here means the banker reads it before signing. */
      const removalLine = commanded ?? instruction;
      const onCreated =
        REMOVAL_ON_CREATED.test(removalLine)
          ? (() => {
              const ids = readScope(removalLine, scopeMembers).ids;
              return ids.length === 1 ? specFor(ids[0]) : null;
            })()
          : null;
      if (onCreated) {
        answer({
          kind: "agent",
          id: nextId("agent"),
          text: newFacilityRemovalRefusal(
            memberLabel(onCreated.label),
            /\bcovenants?\b/i.test(removalLine)
              ? "covenant"
              : /\b(pledges?|collateral|security)\b/i.test(removalLine)
                ? "pledge"
                : "row",
          ),
        });
        return;
      }

      const removalOf = readPartyRemoval({ line: commanded ?? instruction, book, members: elicitMembers });
      if (removalOf?.kind === "ask") {
        answer({ kind: "agent", id: nextId("agent"), text: removalOf.text, options: removalOf.options });
        return;
      }
      if (removalOf?.kind === "refusal") {
        answer({ kind: "agent", id: nextId("agent"), text: removalOf.text });
        return;
      }
      let line = removalOf?.line ?? commanded ?? instruction;

      // The acknowledgment said everything it came to say. The checks are
      // settled above; there is no instruction left in the line to parse.
      if (acknowledged && !instruction) {
        answer({
          kind: "agent",
          id: nextId("agent"),
          text: `${acknowledged === 1 ? "That check is" : `Those ${acknowledged} checks are`} acknowledged. ${vocabulary.nextMove}`,
        });
        return;
      }


      /* THE GRAMMAR STANDS ON A READ, OR IT STANDS DOWN. Every proposal the
         create grammar makes is grounded in the book and every scope it
         resolves is grounded in the org's own loan names, so a room holding no
         bundle has neither and keeps exactly the lane it always had. The
         channel-none doctrine, applied to awareness. */
      if (reads?.bundle) {
        /* A READ BINDS NOTHING AND SETTLES NOTHING. Asking what is on the book
           while a create is being gathered is not an answer to the question the
           room asked, and it must not drop the create either. The read lanes
           below take it and the create waits where it stands. */
        const reading = !commanded && (readTopic(instruction) !== null || isQuestion(instruction));

        /* ============================ THE DOLLAR QUALIFIER IS A FOCUS (N3)

           "on the 15M line of credit" on a FEE line was read by the fenced
           engine as a $15,000,000 fee. The phrase is a facility name, not a
           figure, so the room resolves it to the member, stands on that member
           and takes the phrase out of the line before the engine sees it - and
           says nothing extra, because the card names the facility exactly as it
           does after a click on the strip.

           NOT WHILE A CREATE IS BEING GATHERED. There the scope reader already
           handles the qualifier correctly and owns the answer to its own
           question, and stripping the phrase out of an answer would leave the
           room holding nothing. */
        const focusOn = reading || creating ? null : focusQualifier(line, qualifierMembers);
        const focusMember = focusOn ? (brief.members.find((m) => m.id === focusOn.memberId) ?? null) : null;
        if (focusOn && focusMember && elicitMembers.some((m) => m.id === focusMember.id)) {
          setFocused(focusMember);
          engine.pick(focusMember.id);
          line = focusOn.line;
        }
        /* THE FOCUS THIS TURN. `focused` is React state and does not move until
           the next render, so the create grammar is handed the member the line
           just named rather than the one the room was standing on before it. */
        const turnCtx: ElicitContext =
          focusOn && focusMember
            ? { ...elicitCtx, focused: elicitMembers.find((m) => m.id === focusMember.id) ?? elicitCtx.focused }
            : elicitCtx;

        /* ====================================== THE CREATE BEING GATHERED FOR

           A create in flight owns the next line: it is the answer to the one
           question the room asked. FREE TEXT ALWAYS WINS, so the whole line is
           read for every slot rather than only for the slot just asked about, and
           a line that settles nothing at all is not trapped here - the room says
           it is leaving the create where it stands and the ordinary lanes take
           it, because a room that swallowed every following sentence would be a
           form wearing a conversation's clothes. */
        if (creating && !reading) {
          const next = readInto(creating, line, elicitCtx);
          const moved =
            JSON.stringify(next.slots) !== JSON.stringify(creating.slots) ||
            next.scope.join("|") !== creating.scope.join("|") ||
            // NAMING A SECOND TEST THE CATALOG DOES NOT CARRY IS STILL AN
            // ANSWER. It settles no slot, and dropping the create over it would
            // make the room look like it stopped listening.
            next.notInCatalog !== creating.notInCatalog;
          if (moved) {
            await askCreate(next, mine);
            return;
          }
          setCreating(null);
          answer({
            kind: "agent",
            id: nextId("agent"),
            text: "Nothing in that answered what the new one still needs, so I am leaving it where it stands and taking the line as it reads.",
          });
        }

        /* =========== A FEE ON A FACILITY THIS PLAN IS CREATING (2026-09-03)

           IT RUNS BEFORE `openCreate`, and the reason is specific rather than
           general: "add a 1% origination fee on the new equipment loan" carries
           the word EQUIPMENT, which the collateral surface reads as an asset
           KIND, and the 1% as an advance rate. On a booked line of credit that
           collision never fired; a net-new EQUIPMENT facility makes it
           reachable. Only the new-facility case is lifted, so every fee on a
           booked member reads exactly where it always did.

           The card never reaches the parser either. The fenced engine resolves a
           facility against the PACKAGE and this one is not on it, so a composed
           sentence would come back unresolved or resolved onto a booked member
           sharing the product word. It is built from what the fee lane settled,
           and its wire carries the label. */
        const newFee = reading ? null : readFeeOpen(line, scopeMembers, turnCtx.focused);
        const newFeeSpec = newFee?.memberId ? specFor(newFee.memberId) : null;
        if (newFee && newFeeSpec) {
          const needs = feeAsk(newFee, scopeMembers);
          if (needs) {
            setSteerPending(false);
            answer({
              kind: "agent",
              id: nextId("agent"),
              text: needs.text,
              options: needs.options.length ? needs.options : undefined,
            });
            return;
          }
          const feeDelta = newFacilityFeeEntry(newFee, newFeeSpec, entries.length);
          if (feeDelta) {
            setSteerPending(false);
            setItems((prev) => [
              ...prev,
              {
                kind: "agent",
                id: nextId("agent"),
                step: mine,
                text:
                  `${feeDelta.title} goes onto the ${feeDelta.target}, the facility this plan is creating. ` +
                  "The org files it on that loan once the version exists.",
              },
              { kind: "chips", id: nextId("chips"), step: mine, chips: [{ key: nextId("chip"), delta: feeDelta, state: "open" }] },
            ]);
            return;
          }
        }

        /* ========================= A NEW FACILITY ON THE VERSION BEING APPROVED

           (Founder, 2026-09-03: "Do we allow new loans to be created as part of
           the modification and renewal? This should be fully possible.")

           This runs IN FRONT of the steer, because the steer's answer to "add a
           new equipment loan" was to restart the room in the create route, and a
           restart throws away the manifest the banker has been building. On a
           modification the line is not navigation at all: the credit action
           versions the whole PACKAGE, and a new loan on the version being
           approved is where new money belongs.

           The elicitation is stateless. Each question's chips type back the whole
           sentence with one more answer in it, so the room re-reads the line and
           reaches the same place rather than holding a half-built facility
           between turns. The pricing gate is two of those questions, on the same
           terms a commitment change gets them. */
        const newFacility = reading ? null : readNewFacility({
          line,
          mode: context.mode,
          members: elicitMembers,
          staged: stagedNewFacilities(entries).length,
          generatedAt: reads?.generatedAt,
        });
        if (newFacility) {
          if (newFacility.kind === "ask") {
            answer({ kind: "agent", id: nextId("agent"), text: newFacility.text, options: newFacility.options });
            return;
          }
          if (newFacility.kind === "handoff") {
            answer({ kind: "agent", id: nextId("agent"), text: newFacility.text });
            return;
          }
          const anchor = focused ?? brief.members.find(isEligible) ?? brief.members[0] ?? null;
          if (!anchor) {
            answer({
              kind: "agent",
              id: nextId("agent"),
              text: "This package carries no booked member to anchor the credit action on, so there is no version for a new facility to land on.",
            });
            return;
          }
          const delta = newFacilityDelta(newFacility.spec, {
            anchorId: anchor.id,
            anchorLabel: facilityLabel(anchor, brief.members),
          });
          setItems((prev) => [
            ...prev,
            { kind: "agent", id: nextId("agent"), step: mine, text: newFacility.said },
            {
              kind: "chips",
              id: nextId("chips"),
              step: mine,
              chips: [{ key: nextId("chip"), delta, state: "open" }],
            },
          ]);
          return;
        }

        /* ==================================================== A CREATE OPENS

           An underspecified create does not become a chip. It becomes the room
           asking, with what it can already ground offered as the answers.

           IT RUNS BEFORE THE STEER, and that order is load-bearing: "add another
           covenant to all of the loans" carries "another" and "loans", which read
           as navigation if nothing looks at the noun in between. A create is what
           the banker asked for; where to put it is the create's own first
           question. */
        const opened = reading ? null : openCreate(line, turnCtx);
        if (opened) {
          setSteerPending(false);
          await askCreate(opened, mine);
          return;
        }

        /* ============================ A POLICY EXCEPTION CREATE IS THE FAST
           LANE'S (E7, founder drive 2026-09-02).

           The status is a credit judgement the fenced reader refuses to default,
           so an exception create legitimately comes back from the parser as a
           QUESTION - and `provablyClean` reads a question as a failed parse and
           sends it to the desk, which answered it as a question about the
           exception already on file and staged nothing. The room elicits it
           here instead: the NAME is what is out of policy, the aside about who
           approved it is a NOTE, the status is asked with the org's own three,
           and the facility is named by the org's own loan name so the parser
           resolves one member rather than the focused one. */
        const exceptionOpen = reading ? null : readExceptionOpen(line, elicitMembers, turnCtx.focused);
        if (exceptionOpen) {
          const exceptionNeeds = exceptionAsk(exceptionOpen, elicitMembers);
          if (exceptionNeeds) {
            setSteerPending(false);
            answer({
              kind: "agent",
              id: nextId("agent"),
              text: exceptionNeeds.text,
              options: exceptionNeeds.options,
            });
            return;
          }
          const on = elicitMembers.find((m) => m.id === exceptionOpen.memberId);
          if (on) line = exceptionSay(exceptionOpen, on);
        }

        /* ================================ A FEE CREATE IS THE FAST LANE'S TOO
           (C, founder drive 2026-09-02).

           "add a 1% origination fee to LOC" names a product this package
           carries two of, so the parser came back with a QUESTION, and a
           question is not a failed parse: the desk took it and invented five
           rounds of its own about a basis, a payment method and a paid-by, none
           of which is a field on the wire this room files. The room asks the
           wire's own questions instead: which facility, what kind, how much. */
        const feeOpen = reading ? null : readFeeOpen(line, scopeMembers, turnCtx.focused);
        if (feeOpen) {
          const feeNeeds = feeAsk(feeOpen, scopeMembers);
          if (feeNeeds) {
            setSteerPending(false);
            answer({
              kind: "agent",
              id: nextId("agent"),
              text: feeNeeds.text,
              options: feeNeeds.options.length ? feeNeeds.options : undefined,
            });
            return;
          }
          const onFee = scopeMembers.find((m) => m.id === feeOpen.memberId);
          if (onFee) {
            line = feeSay(feeOpen, onFee);
            /* AND A PERCENTAGE FEE IS NEVER ASKED FOR A FIGURE. The org derives
               the money from the moved commitment, so the room says so once
               rather than asking a question it already knows the answer to. */
            if (feeOpen.percentage !== undefined) feeNote = feePercentageNote(onFee);
          }
        }

        /* ================================================ NAVIGATIONAL INTENT

           "let's modify a new loan" and "a different facility" are the banker
           saying WHERE to work, and they are answered with the choice rather than
           with a capability lecture. This runs after the route switch, so "renew
           instead" still moves the room, and it keeps "modify a new loan" out of
           the origination room over a line that asked to change something that is
           already booked. */
        const steer = reading ? null : readSteer(line, elicitMembers);
        if (steer) {
          if (steer.kind === "new-facility") {
            if (router) {
              router.onRestart("create", line);
              return;
            }
            answer({
              kind: "agent",
              id: nextId("agent"),
              text: `${steer.text} This room is already bound to a route, so start a new facility from the actions above.`,
            });
            return;
          }
          setSteerPending(true);
          answer({ kind: "agent", id: nextId("agent"), text: steer.text, options: steer.options });
          return;
        }

        if (steerPending && !reading) {
          const picked = bareMemberPick(line, elicitMembers);
          const member = picked ? brief.members.find((m) => m.id === picked) : null;
          if (member) {
            setSteerPending(false);
            setFocused(member);
            const result = engine.pick(member.id);
            answer({
              kind: "agent",
              id: nextId("agent"),
              text: result?.reply ?? `Standing on the ${facilityLabel(member, brief.members)}. What should change on it?`,
            });
            return;
          }
        }
      }

      /* ROUTE BINDING IS FINAL PER PLAN (rule 4, founder 2026-08-31).
         "Actually let's renew instead" is a real thing a banker says, and it
         means two different things either side of the first confirm. On an EMPTY
         manifest nothing has been composed against this engine, so the room is
         simply rebuilt on the other one. Once anything is staged the plan hash
         and the single-use token are the governance boundary — a silent engine
         swap under a composed manifest would carry one route's changes into
         another route's approval — so the room refuses out loud and offers the
         discard as the explicit gesture it is. */
      const switchTo = router ? readRouteSwitch(instruction, context.mode) : null;
      if (switchTo && router) {
        if (!entries.length) {
          router.onRestart(switchTo, instruction);
          return;
        }
        const [one, many] = vocabulary.changeWord;
        answer({
          kind: "agent",
          id: nextId("agent"),
          text: `${countPhrase(entries.length, entries.length === 1 ? one : many, entries)} ${
            entries.length === 1 ? "is" : "are"
          } staged on this ${ROUTE_WORD[context.mode]}, so the room is locked to it. Starting a ${
            ROUTE_WORD[switchTo]
          } means discarding the manifest and opening a fresh room.`,
          restart: {
            route: switchTo,
            label: `Discard and start the ${ROUTE_WORD[switchTo]}`,
            say: instruction,
          },
        });
        return;
      }

      /* ================ THE FOUR FIELDS nCINO PRICES ON (founder, 2026-09-02)

         Four answers and they are all sentences, so nothing about this lane is
         held between turns except the slot the room asked the banker to type a
         figure for and the facilities they left for later. */
      /* AN ANSWER TO THE OPEN GATE IS AN ANSWER, however it is written. A date
         in any of the four forms a banker uses, with or without a correction
         opener in front of it, lands on the entry the room asked about. It is
         never a new instruction: that reading is what staged a $1 commitment on
         a $15M line and then had a model claim the date had moved. */
      const gate = pricingPending ?? pricingOutstanding(entries);
      /* ============ THE PRICING ASK NEVER BLOCKS A LINE (founder, 2026-09-03)

         A banker who types a new instruction over an open pricing question has
         answered it: they are not setting the amortised term today. The ask
         settles as SKIPPED, the room says the consequence once in the row, and
         the line goes through to the parser exactly as it would have if the
         question had never been asked. */
      if (gate && !answersPricing) {
        setPricingDeclined((prev) => new Set([...prev, gate.memberId]));
        setPricingPending(null);
        const asked = [...itemsRef.current].reverse().find((i) => i.kind === "agent" && !!i.options?.length);
        if (asked) settleExchange({ what: PRICING_SKIPPED, how: "skipped" }, { upTo: asked.id });
      }
      /* ============ THE RATE GATE'S OWN ANSWERS (founder, 2026-09-03)

         Read BEFORE the field slots, because the rate's forms are the loosest
         and its failure was the worst: "Yes, 7.25% all-in" was re-asked, and
         "I have a new all-in rate" was reported as a supplied rate with no
         figure anywhere. Every branch below either stages a FIGURE or asks for
         one; none of them reports success without a number. */
      if (gate?.slot === "rate") {
        const on = elicitMembers.find((m) => m.id === gate.memberId);
        /* THE FIGURE, IN ANY FORM A BANKER WRITES IT (founder, 2026-09-03).
           "Yes, 7.25% all-in", "7.25", "7.25 percent", "up 25 bps", "prime plus
           1": an affirmation in front of a rate is still the rate, and a line
           that CARRIES the figure is never answered with the question again. */
        const figure = readRateFreeText(instruction, {
          onFile: rateOnFile(facilityRead.get(gate.memberId))?.pct ?? null,
        });
        if (figure) {
          if (figure.index) rateIndexOf.current.set(gate.memberId, figure.index);
          if (figure.pct) {
            setPricingPending(null);
            await landPricing(gate, figure.pct, mine);
            return;
          }
          /* AN INDEX WITH NO FIGURE IS HALF AN ANSWER. The room takes the half
             it was given and asks for the other one, naming the index back so
             the banker can see it was heard. */
          setPricingPending(gate);
          answer({ kind: "agent", id: nextId("agent"), text: rateFigureAsk(on ?? elicitMembers[0], figure.index) });
          return;
        }
        // The chip says the whole sentence; a banker who just types "hold" or
        // "keep it" at this FORCED ask means the same, on the member the gate is
        // already standing on. Both land here, so a word and a click agree.
        const held = readRateHold(instruction, elicitMembers) ?? (readRateKeepWord(instruction) ? gate.memberId : null);
        if (held) {
          setRateHeld((prev) => new Set([...prev, held]));
          setPricingPending(null);
          answer({
            kind: "agent",
            id: nextId("agent"),
            text: rateHeldLine(on ?? elicitMembers[0], rateOnFile(facilityRead.get(held))),
          });
          return;
        }
        if (readRateNew(instruction, elicitMembers)) {
          /* SAYING "I HAVE A NEW RATE" IS NOT A RATE. The gate stays open and
             the room asks for the figure, with the example on it. */
          setPricingPending(gate);
          answer({ kind: "agent", id: nextId("agent"), text: rateFigureAsk(on ?? elicitMembers[0], null) });
          return;
        }
        if (readRateIndexOpen(instruction, elicitMembers)) {
          setPricingPending(gate);
          const ask = rateIndexAsk(on ?? elicitMembers[0]);
          answer({ kind: "agent", id: nextId("agent"), text: ask.text, options: ask.options });
          return;
        }
        const picked = readRateIndexPick(instruction, elicitMembers);
        if (picked) {
          rateIndexOf.current.set(picked.memberId, picked.index);
          setPricingPending(gate);
          answer({ kind: "agent", id: nextId("agent"), text: rateFigureAsk(on ?? elicitMembers[0], picked.index) });
          return;
        }
        /* "WHAT INDEX AND RATE OPTIONS DO I HAVE?" IS ANSWERED BY THE OPTIONS.
           It was answered with the no-index aside a second time, which is prose
           where a list was asked for. */
        if (asksRateOptions(instruction)) {
          setPricingPending(gate);
          const ask = gateAsk(gate, entries);
          if (ask) {
            answer({ kind: "agent", id: nextId("agent"), text: ask.text, options: ask.options });
            return;
          }
        }
      }
      if (gate) {
        const said = readPricingFreeText(instruction, gate.slot);
        if (said) {
          setPricingPending(null);
          await landPricing(gate, said, mine);
          return;
        }
        if (readPricingAnother(instruction, gate.slot)) {
          const on = elicitMembers.find((m) => m.id === gate.memberId);
          setPricingPending(gate);
          answer({
            kind: "agent",
            id: nextId("agent"),
            text:
              gate.slot === "amortisedTerm"
                ? `Say the amortisation in months and I will put it on the ${on?.label ?? "facility"}. A number on its own is enough.`
                : `Say the first payment date and I will put it on the ${on?.label ?? "facility"}. "Oct 1, 2026" reads the same as 2026-10-01.`,
          });
          return;
        }
      }
      const pricingLater = readPricingDecline(instruction, elicitMembers);
      if (pricingLater) {
        const on = elicitMembers.find((m) => m.id === pricingLater);
        setPricingDeclined((prev) => new Set([...prev, pricingLater]));
        setPricingPending(null);
        answer({
          kind: "agent",
          id: nextId("agent"),
          text: on ? pricingDeclinedLine(on) : PRICING_WHY,
        });
        return;
      }
      const pricingOther = readPricingOther(instruction, elicitMembers);
      if (pricingOther) {
        const on = elicitMembers.find((m) => m.id === pricingOther.memberId);
        setPricingPending(pricingOther);
        answer({
          kind: "agent",
          id: nextId("agent"),
          text:
            pricingOther.slot === "amortisedTerm"
              ? `Say the amortisation in months and I will put it on the ${on?.label ?? "facility"}. A number on its own is enough.`
              : `Say the first payment date as YYYY-MM-DD and I will put it on the ${on?.label ?? "facility"}.`,
        });
        return;
      }
      const pricingAnswer = readPricingLine(instruction, elicitMembers);
      if (pricingAnswer) {
        setPricingPending(null);
        await landPricing({ memberId: pricingAnswer.memberId, slot: pricingAnswer.slot }, pricingAnswer.value, mine);
        return;
      }

      /* THE ORG'S OWN TYPE NAME, TAKEN OFF ITS REFUSAL (E6). The chip re-types
         the entry that was refused and nothing else: the plan is untouched, the
         figures do not move, and the next staging carries the name the org
         asked for. */
      const retyped = readTypeChoice(instruction, entries);
      if (retyped) {
        const next = retypeEntry(retyped.entry, retyped.type);
        setEntries((prev) => prev.map((e) => (e.id === next.id ? next : e)));
        setItems((prev) =>
          prev.map((item) =>
            item.kind === "chips"
              ? { ...item, chips: item.chips.map((c) => (c.delta?.id === next.id ? { ...c, delta: next } : c)) }
              : item,
          ),
        );
        setToast("Collateral type set");
        answer({
          kind: "agent",
          id: nextId("agent"),
          text: `${next.title} on ${next.target} carries the collateral type ${retyped.type}, which is the org's own name for it. Nothing else on the manifest moved. Stage it again when you are ready.`,
        });
        return;
      }

      // THE LANE IS ADDRESSABLE IN THE CONVERSATION. "what is staged" is
      // answered here, before the parser sees it: it is a move on the manifest,
      // not a new amendment.
      const address = addressManifest(instruction, entries);
      if (address?.kind === "list" || readsThePlan(instruction)) {
        const staged = address?.kind === "list" ? address.entries : entries;
        /* ONE ROW PER ENTRY, GROUPED BY FACILITY (founder drive 2026-09-02).
           Fifteen entries as one semicolon-separated paragraph is not a
           read-back, and the model's remark underneath was left doing the
           structuring the deterministic layer should have done. The count line
           is the card's lede, so the card and the rail state the same figure. */
        if (staged.length) {
          const card = planReadCard(
            staged,
            `The manifest holds ${countPhrase(staged.length, staged.length === 1 ? vocabulary.changeWord[0] : vocabulary.changeWord[1], staged)}.`,
            vocabulary.nextMove,
          );
          /* AND A FACILITY WHOSE PRICING WAS LEFT FOR LATER SAYS SO ON THE PLAN
             (founder, 2026-09-02). Nothing is staged for it, so it is not an
             entry; it IS a decision the banker made about that facility, and a
             plan read-back that did not carry it would let a version go up that
             nobody can price with nobody having been told twice. */
          /* THE HEADING IS THE ENTRY'S OWN TARGET, which is the engine's label
             for the facility and not the room's, so the group is matched back
             through the entries rather than by comparing two labels that were
             never the same string. */
          const memberOfHeading = new Map<string, string>();
          for (const e of staged) if (e.member && e.target) memberOfHeading.set(e.target, e.member);
          for (const group of card.groups) {
            const memberId = memberOfHeading.get(group.heading);
            if (!memberId || !pricingDeclined.has(memberId)) continue;
            group.rows.push({
              icon: "pricing",
              label: "Pricing fields",
              value: "",
              detail: "left for later, so no rate or payment stream on the new version",
            });
          }
          answer({ kind: "read", id: nextId("read"), card });
          return;
        }
        answer({
          kind: "agent",
          id: nextId("agent"),
          text: "Nothing is staged yet. Confirmed changes land here, grouped.",
        });
        return;
      }

      /* ================================================ WHAT A REMOVE IS ABOUT
         (E1, the destructive one, founder drive 2026-09-01.)

         "remove the Minimum Liquidity covenant from the 15M line of credit" was
         claimed by the manifest address on the bare word "covenant" and took the
         banker's OWN staged covenant off Equipment ($8M) - a different covenant
         on a different facility, un-staged in silence. So a removal is ROUTED
         now: it un-stages only where the line names a staged entry by title AND
         target, it goes to the fence where the line names something the BOOK
         carries, and it goes to the parser otherwise, where an involvement
         removal files as the carry exclusion it is. */
      const removal = readRemove(instruction, entries, book, elicitMembers);
      if (removal?.kind === "manifest") {
        setEntries((prev) => removeEntry(prev, removal.entry.id));
        setToast("Removed from the manifest");
        /* AND THE WAY BACK IS THE ENTRY'S OWN. "Say it again with the figure
           you want" is a TERM CHANGE's sentence, and a carry exclusion has no
           figure: what putting it back means is that the new version carries
           the junction again, exactly as the booked facility holds it. */
        answer({
          kind: "agent",
          id: nextId("agent"),
          text: armOf(removal.entry)
            ? `${removal.entry.title} on ${removal.entry.target} is out of the manifest. The new version carries it again, exactly as the booked facility holds it today. Say it again to leave it off.`
            : `${removal.entry.title} on ${removal.entry.target} is out of the manifest. Say it again to put it back, with the figure you want.`,
        });
        return;
      }
      if (removal?.kind === "ambiguous") {
        answer({ kind: "agent", id: nextId("agent"), text: removal.reason });
        return;
      }
      if (removal?.kind === "ask") {
        answer({ kind: "agent", id: nextId("agent"), text: removal.text, options: removal.options });
        return;
      }
      if (removal?.kind === "gap") {
        answer({ kind: "agent", id: nextId("agent"), text: removal.text });
        return;
      }
      if (removal?.kind === "fence") {
        /* ================================== THE ARM THAT FILES IT (P2, 2026-09-02)

           The org arms deployed, so "remove the Minimum Liquidity covenant from
           the 15M line of credit" is no longer a refusal on a MODIFICATION: it
           is a CARRY EXCLUSION, and the room stages one. The booked loan keeps
           the junction and the new version starts without it, which is the same
           mechanism the borrowing structure has used since August.

           THE BOOK IS CHECKED FIRST. Where the facility does not carry that
           covenant or that pledge there is nothing for the new version to leave
           behind, and the room says where it actually is rather than sending a
           plan up to be refused by name. On renew and new-facility the arm does
           not exist on those tools, so the honest fence refusal stands. */
        const armed = readArmRemoval({
          line: instruction,
          scope: removal.scope,
          name: removal.name,
          book,
          members: elicitMembers,
          focused: focused ? (elicitMembers.find((m) => m.id === focused.id) ?? null) : null,
          mode: context.mode,
        });
        if (armed?.kind === "ask") {
          answer({ kind: "agent", id: nextId("agent"), text: armed.text, options: armed.options });
          return;
        }
        if (armed?.kind === "refusal") {
          answer({ kind: "agent", id: nextId("agent"), text: armed.text });
          return;
        }
        if (armed?.kind === "exclusion") {
          setItems((prev) => [
            ...prev,
            { kind: "agent", id: nextId("agent"), step: mine, text: armed.said },
            {
              kind: "chips",
              id: nextId("chips"),
              step: mine,
              chips: [{ key: nextId("chip"), delta: armed.delta, state: "open" }],
            },
          ]);
          return;
        }
        const fence = fenceRefusal(removal.scope, removal.name);
        setItems((prev) => [
          ...prev,
          { kind: "agent", id: nextId("agent"), step: mine, text: fence.why },
          { kind: "chips", id: nextId("chips"), step: mine, chips: [{ key: nextId("chip"), refusal: fence, state: "open" }] },
        ]);
        return;
      }

      /* ============================================ THE POLITE COMMAND (2026-09-01)

         A courtesy in front of an imperative is a COMMAND: the prefix is
         stripped and the line is acted on exactly as if the courtesy had never
         been typed. The asymmetry is narrow on purpose (see brainRoute.ts): the
         remainder must open on an action verb the parser already stages on.
         "can you tell me what covenants are on this" opens on `tell`, and stays
         a question. The verb list is a list and never a pattern. */
      /* ================================================ READS ARE LOCAL, AND FIRST

         (F1 + F2 read half, founder 2026-09-01.) A topic the bundle answers is
         answered from the bundle, immediately, whether or not there is a desk to
         ask. The drive proved the cost of the other order three times: the brain
         reported "data not carried" over covenants, guarantors and pricing that
         the room was holding the whole time.

         A polite COMMAND is never a read: it asked for a change. */
      const topic = commanded ? null : readTopic(instruction);
      const localCard = topic !== null && reads ? buildReadCard(topic, reads, readNarrowing(topic, instruction)) : null;
      if (localCard) {
        answer({ kind: "read", id: nextId("read"), card: localCard });
        return;
      }

      /* ===================================================== THE QUESTION GUARD

         A question is not an instruction, and the parser has no way to tell: it
         matched field="Product" value="Package" out of "what covenants are
         against this Product Package" and staged a term change. So a question
         never reaches it — it goes to the desk, which is the component built to
         answer it, or it is answered honestly where there is no desk. */
      if (!commanded && (topic !== null || isQuestion(instruction))) {
        if (brain) {
          await runBrain(instruction, mine);
          return;
        }
        if (topic !== null) {
          answer({ kind: "agent", id: nextId("agent"), text: readGap(topic, context.accountName) });
          return;
        }
        answer({
          kind: "agent",
          id: nextId("agent"),
          text: `${whatICanDo(context.accountName)} This view is not connected to the bank's systems, so I cannot take the question itself any further than that.`,
        });
        return;
      }

      await runLine(line, mine, feeNote);
    },
    [
      amendOpenCard,
      ask,
      askCreate,
      awake,
      book,
      brain,
      brief.members,
      context.accountName,
      context.mode,
      creating,
      elicitCtx,
      elicitMembers,
      engine,
      entries,
      items,
      landPricing,
      openGates,
      lockedRoute,
      pricingDeclined,
      pricingOutstanding,
      pricingPending,
      reads,
      refuseLockedRoute,
      router,
      runBrain,
      runLine,
      steerPending,
      step,
      vocabulary.changeWord,
      vocabulary.nextMove,
    ],
  );

  /** THE ROOM SAYING A LINE TO ITSELF. Only the resume path uses it, and only
   *  to put the banker's own recorded instructions back through the same front
   *  door they came in by. A ref because `say` cannot depend on itself. */
  const sayRef = useRef(say);
  sayRef.current = say;

  /** THE QUESTION IS ANSWERED BY A CHIP. "Something else" answers nothing: it
   *  falls through to the neutral three-way, which is the whole point of
   *  offering a suggestion rather than assuming one. */
  const chooseRoute = useCallback(
    (option: RouteOption) => {
      if (!router) return;
      if (!option.route) {
        setAsk(NEUTRAL_ASK);
        return;
      }
      if (refuseLockedRoute(option.route)) return;
      setAsk(null);
      router.onBind(option.route, { memberId: option.memberId ?? null });
    },
    [refuseLockedRoute, router],
  );

  /** The banker took the discard and asked for the other route. The hold is what
   *  survives a close, so a restart that left it behind would resume the
   *  discarded manifest in the next room. */
  const restartRoute = useCallback(
    (restart: { route: WorkroomMode; say: string }) => {
      if (!router) return;
      engine.release();
      setEntries([]);
      router.onRestart(restart.route, restart.say);
    },
    [engine, router],
  );

  /* ---- THE LINE THAT BOUND THE ROUTE IS STILL AN INSTRUCTION. It is said once
          the bound room is awake, through the parser, exactly as if the banker
          had typed it into this room in the first place. */
  const saidRef = useRef<string | null>(null);
  useEffect(() => {
    const line = router?.say ?? null;
    if (!awake || ask || !line || saidRef.current === line) return;
    saidRef.current = line;
    void say(line);
  }, [ask, awake, router?.say, say]);

  /* ================================================= AN INTENT'S OWN LINES

     THE SAME DOOR, AND THE SAME QUEUE DISCIPLINE THE BANKER GETS. An intent
     carried in from a conversation elsewhere is a list of instructions, and each
     of them goes through `say` exactly as if it had been typed here — same
     parser, same brain lane, same refusals.

     THE FEED ONLY MOVES WHEN THE ROOM IS HOLDING NOTHING. A staged card, an
     open check, a set of chips, a pricing question, a create being gathered, a
     flow in flight: any of them stops the queue where it stands and the banker
     answers. That is not politeness, it is the same rule the composer enforces
     on a typed line — one decision per view — applied to a line the room did
     not have to wait for someone to type.

     WITH NO FEED STAGED (every room the banker opened themselves) `useRoomFeed`
     subscribes, finds nothing for this relationship, and does nothing at all. */
  const lastItem = items[items.length - 1];
  const awaitingChoice =
    !!lastItem && lastItem.kind === "agent" && (!!lastItem.options?.length || !!lastItem.restart);
  /* AND A SETTLE IN FLIGHT IS THE ROOM HOLDING SOMETHING (founder drive,
     2026-09-03). The exit takes 520ms and what follows it - the answer, the
     check it tripped, the question the version needs - lands after it. For
     that half second the room has no open gate and looked free, so the feed
     said its next line straight over the top of the confirm the banker had
     just made. `settle.leaving` closes it, and the STAGE CAP closes the wider
     case: nothing is fed while anything is already waiting on the banker or
     waiting its turn to be asked. */
  const feedReady =
    awake &&
    !ask &&
    phase === "work" &&
    !thinking &&
    !filing &&
    openGates === 0 &&
    liveOnStage === 0 &&
    gate.queued === 0 &&
    !settle.leaving &&
    flow === null &&
    creating === null &&
    pricingPending === null &&
    !steerPending &&
    !awaitingChoice;
  /* ============================ A FED LINE IS NOT A BANKER BUBBLE (founder, 2026-09-03)

     An intent's instruction went in through `say` as if somebody had typed it,
     so the thread showed a banker bubble carrying the line, then the room's
     parse of it, then the card - three renderings of one instruction, for a
     line nobody in this room actually said.

     IT RENDERS AS ONE MARKER. "From the meeting of 3 Sep: increase the 15M line
     of credit to 20M", above its card, in the room's quietest type. The line
     still travels through the SAME `say`, the same parser, the same gates: only
     the way it is drawn changes. */
  const feedFrom = useMemo(() => {
    const intent = intentFor(context.accountId);
    return intent ? `From ${sourcePhrase(intent.context.source)}` : null;
  }, [context.accountId]);
  const sayFed = useCallback((line: string) => say(line, undefined, { fed: feedFrom ?? undefined }), [feedFrom, say]);
  const feed = useRoomFeed({ room: "facility", accountId: context.accountId, ready: feedReady, say: sayFed });
  /* THE TAIL DROPS WHILE THE QUEUE HOLDS A LINE (rule d). Read through a ref by
     `tailNow`, which every sentence composer calls. */
  queuedRef.current = feed.active;

  /* ============ THE STRIP LEAVES WHEN THE FIRST CARD LANDS (founder, 2026-09-03)

     The entry choreography retires each tier as the NEXT one arrives, so the
     last of them - the facility strip - had nothing above it to push it off and
     stood under every card the banker went on to stage. The first card is what
     earns its exit: from that moment the banker is deciding on the card. The
     greeting, the package and the facilities are all one summon away, in the
     control that is already there and already says so. */
  const carded = items.some((i) => i.kind === "chips");
  useEffect(() => {
    if (carded) retireTiers();
  }, [carded, retireTiers]);

  /* ============ ONLY THE LATEST ACTION IS ON THE STAGE (founder, 2026-09-03)

     "It should only show the latest action; as I was testing right now it
     showed basically the full end."

     THE SETTLE ONLY EVER FIRED ON A DECISION. A confirm, a discard, an
     acknowledge, an answered step - each of those retires its own exchange, and
     every other kind of exchange stayed on the glass: a read the room answered,
     a line it refused, a fed line that staged nothing, and every exchange a
     restored session mounts at once. Four paths, one omission.

     THE RULE IS ABOUT THE STAGE AND NOT ABOUT THE GESTURE. At any moment the
     stage carries the current exchange and AT MOST ONE earlier one, and that
     earlier one only while it is still holding a gate open. Everything older is
     a settled row. It is swept here rather than at each of the four call sites,
     because the omission was that there is no fifth site to add.

     A RESTORED SESSION MOUNTS ALREADY SETTLED. Those exchanges were never on
     this stage and animating them out would be the room performing a history
     the banker did not watch happen. */
  const sweptRef = useRef(false);
  useEffect(() => {
    const list = itemsRef.current;
    if (!list.length) return;
    /* THE EXCHANGES, NEWEST LAST. A boundary is a line somebody said or a row
       that already settled; tiers have their own choreography and are skipped. */
    const groups: Array<{ ids: string[]; live: boolean; row: SettledRow | null }> = [];
    for (const item of list) {
      if (tierOf(item)) continue;
      if (item.kind === "settled") {
        groups.length = 0;
        continue;
      }
      const opens = item.kind === "banker" || item.kind === "fed";
      if (opens || !groups.length) groups.push({ ids: [], live: false, row: null });
      const at = groups[groups.length - 1];
      if (settle.stateOf(item.id) !== "on") continue;
      at.ids.push(item.id);
      if (isLive(item)) at.live = true;
      if (item.kind === "chips") {
        const held = item.chips.find((c) => c.delta);
        if (held?.delta) at.row = rowForDelta(held.delta, held.state === "discarded" ? "discarded" : "confirmed");
      } else if (item.kind === "challenge") {
        at.row = rowForChallenge(item.challenge);
      } else if (item.kind === "read" && !at.row) {
        at.row = rowForRead(item.card.lede, "answered");
      } else if ((item.kind === "banker" || item.kind === "fed") && !at.row) {
        at.row = rowForRead(item.text, "read");
      }
    }
    const alive = groups.filter((g) => g.ids.length);
    /* THE CURRENT EXCHANGE STAYS, and so does ONE earlier one while it is still
       waiting on the banker: that is the cap, and it is the same two the stage
       cap counts. Everything before them is history. */
    const keep = new Set<number>();
    if (alive.length) keep.add(alive.length - 1);
    for (let i = alive.length - 2; i >= 0; i--) {
      if (alive[i].live && keep.size < 2) keep.add(i);
    }
    const stale = alive.map((g, i) => ({ g, i })).filter(({ g, i }) => !keep.has(i) && !g.live);
    if (!stale.length) return;
    /* THE FIRST SWEEP OF A ROOM IS THE RESTORED SESSION. Nothing on that stage
       was watched arriving, so nothing on it is watched leaving. */
    const instant = !sweptRef.current;
    sweptRef.current = true;
    for (const { g } of stale) {
      settleExchange(g.row ?? rowForRead("Earlier", "read"), { upTo: g.ids[g.ids.length - 1], instant });
    }
  }, [items, settle, settleExchange]);

  /* ============ THE ROOM EXHALES WHEN THE CARD LANDS (founder, 2026-09-03)

     "Can we gently and elegantly clean up the room, a cinematic kind of
     creation success with that card."

     THE EXIT SET IS EVERYTHING BUT THE DOSSIER, fixed at this instant
     (founder, 2026-09-03, second pass: "the card which glows is basically only
     in there"). The reply beside the card drains with the thread; a footnote
     that arrives later is kept off the glass by the still state's own rule. */
  useEffect(() => {
    if (phase !== "filed") return;
    const leaves = itemsRef.current.filter((i) => i.kind !== "dossier").map((i) => i.id);
    beginFinale(leaves);
    /* AND THE MORPH IS ARMED ON THE SAME COMMIT. The card ascends after the
       drain's tail and takes {@link CARD_ASCEND_MS} doing it; it is held whole
       for a beat after that, and then it grows. All three numbers are the
       finale's own, so the card's landing is untouched and the sheet begins
       exactly where the landing ends. */
    armMorph(finaleCardHoldMs(leaves.length) + CARD_ASCEND_MS + CARD_HELD_MS);
  }, [armMorph, beginFinale, phase]);

  /* ---- AND THE ORG IS ASKED TO CONFIRM, BEHIND THE SHEET.

     The exposure figure on the sheet is the room's own arithmetic over the
     manifest: real, and pro forma until the staging record goes terminal. So the
     room reads the record once the sheet is up, on its own short clock, and the
     sheet NEVER waits for it: it is already whole, and what the read changes is
     one word. A read that does not answer inside the budget adds one honest line
     and takes nothing away.

     A SCRIPTED ROOM IS NOT ASKED. There is no staging record behind it, so
     "pending" stands as the plain truth and no deadline is ever missed. */
  useEffect(() => {
    const stagingId = filedMeta?.stagingId;
    if (!stagingId) return;
    let alive = true;
    /* TWO CLOCKS, BECAUSE ONE OF THEM CAN BE HELD OPEN. `budgetMs` stops the
       poll LOOP, which is the right instrument while the reads are answering.
       A read that accepts the call and never comes back is the other case, and
       an `await` on it would sit there for the life of the page with the sheet
       carrying "pending" forever - the exact shape of the founder's "it gets
       stuck". So the whole wait is raced against the same budget from the
       outside, and the sheet always gets an answer even when the org never
       gives one. */
    const capped = Promise.race([
      awaitFiling(context.accountId, stagingId, { ...settleDeps, budgetMs: CONFIRM_BUDGET_MS }),
      settleDeps.wait(CONFIRM_BUDGET_MS).then(() => ({ kind: "unsettled" }) as const),
    ]);
    void capped
      .then((verdict) => {
        if (!alive) return;
        setConfirmation(verdict.kind === "terminal" && verdict.status === "Completed" ? "confirmed" : "unconfirmed");
      })
      .catch(() => {
        if (alive) setConfirmation("unconfirmed");
      });
    return () => {
      alive = false;
    };
  }, [context.accountId, filedMeta?.stagingId, settleDeps]);

  /* ---- THE HAND TO THE MEMO (founder, 2026-09-06).

     "This then directs you to the Credit memo workroom where it inserts all the
     information, but all super super gentle, no hangers."

     TWO MOVES, IN THIS ORDER. The memo room MOUNTS first, under the sheet, so
     the glass it slides onto is already the memo's; then the sheet slides left
     off it. Only when the slide is over does this room close and the memo start
     drafting, which is what keeps the handover one motion rather than a room
     disappearing and another appearing where it was. */
  const handOff = useCallback(() => {
    if (!filedSheet || !filedLines || leaving) return;
    setLeaving(true);
    onDraftMemo?.(filedLines, filedSheet);
  }, [filedLines, filedSheet, leaving, onDraftMemo]);

  useEffect(() => {
    if (!leaving) return;
    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      onDraftMemoLanded?.();
      onClose();
    };
    const el = sheetEl.current;
    const ended = (e: TransitionEvent) => {
      if (e.propertyName === "transform") land();
    };
    el?.addEventListener("transitionend", ended);
    /* THE CEILING IS THE POINT, NOT THE FALLBACK. A `transitionend` that never
       fires - reduced motion, a backgrounded tab, a compositor that dropped the
       animation - must not leave the banker looking at a room that is on its way
       somewhere. Whichever comes first wins, and nothing here can hang. */
    const cap = window.setTimeout(land, HANDOFF_CEILING_MS);
    return () => {
      el?.removeEventListener("transitionend", ended);
      window.clearTimeout(cap);
    };
  }, [leaving, onClose, onDraftMemoLanded]);

  /* ---- and the member the signal named is the one the lane opens on. */
  useEffect(() => {
    const id = router?.preselectMemberId;
    if (!id || !awake || focused) return;
    const member = brief.members.find((m) => m.id === id);
    if (member) setFocused(member);
  }, [awake, brief.members, focused, router?.preselectMemberId]);

  /**
   * The banker picked a member off the package strip.
   *
   * The strip is the room's list of what is eligible, so it is also the room's
   * way in. Where the engine has a read behind that member it answers and the
   * conversation continues on it; where it does not — the shell engines, whose
   * strip is a fixture — the member detail opens instead, which is the honest
   * answer rather than a question the engine could not then take an answer to.
   */
  const pickMember = useCallback(
    async (member: PackageMember, fallback: () => void) => {
      const result = engine.pick(member.id);
      setFocused(member);
      if (!result) {
        fallback();
        return;
      }
      const mine = step + 1;
      setStep(mine);
      setHistOpen(false);
      setItems((prev) => [...prev, { kind: "banker", id: nextId("banker"), step: mine, text: member.key }]);
      const started = Date.now();
      setThinking(true);
      try {
        await beat(started);
        /* ============ ONE LINE, AND ONE VOICE (founder paste, 2026-09-03)

           Clicking a facility chip put TWO bubbles up at once: this prompt, and
           the model narrating the whole staged plan under it. The model's half
           is silenced by `routine` below (a selection is chrome, and a question
           gets no remark either way). This half is shortened: the commitment
           becomes the facility's NAME rather than a third figure in a list, and
           the capability list rides the FIRST focus of a room open and no other.
           The engine composes both; the cut is made here, on the way to glass. */
        const prompt = focusPrompt(result.reply, capabilitiesSaid.current);
        if (prompt.saidCapabilities) capabilitiesSaid.current = true;
        setItems((prev) => [
          ...prev,
          { kind: "agent", id: nextId("agent"), step: mine, text: prompt.text, routine: true },
        ]);
        setSuggestion(engine.suggest());
      } finally {
        setThinking(false);
      }
    },
    [beat, engine, step],
  );

  const settleChip = useCallback((blockId: string, chipKey: string, state: ChipState) => {
    setItems((prev) =>
      prev.map((item) =>
        item.kind === "chips" && item.id === blockId
          ? { ...item, chips: item.chips.map((c) => (c.key === chipKey ? { ...c, state } : c)) }
          : item,
      ),
    );
  }, []);

  /**
   * THE CONFIRM, AND ITS CONSEQUENCE.
   *
   * A confirm lands as ONE event: the entry, the receipt on the card, the
   * agent's answer and any check the new figures trip all arrive in a single
   * commit. One motion, one settle, and no frame in between where the review
   * chip could flicker on and off again.
   *
   * NOTHING FLIES INTO THE LANE (rule 40). The chip pops in place and the detail
   * card takes the new value inline with its "was" note; a puck travelling
   * across the room was the island's grammar and the island is retired.
   */
  const confirmChip = useCallback(
    (blockId: string, chipKey: string, delta: WorkroomDelta) => {
      /* THE MANIFEST AS IT STANDS RIGHT NOW, not as it stood when this handler
         was built. See `entriesRef`: this is the commitment drop. */
      const before = entriesRef.current;
      const staged = addEntry(before, delta);
      entriesRef.current = staged;
      const { reply, challenge, options } = engine.acknowledge(delta, staged);
      /* ------------------------------- THE COMMITTED TOTAL IS THIS ENTRY'S (E4c)

         The engines close every confirm on the package figure, composed over the
         WHOLE manifest — so a legal-entity add confirmed after a commitment
         change said "that takes the package from $49M to $54M" about a change
         that moved no money at all. Reproduced twice in the drive. The sentence
         is about the entry the banker just confirmed, so it is composed here
         from the room's own figures: what the package read at before this entry
         landed, and what it reads at now. */
      /* ------------------------------- AND AN ARM SAYS WHAT AN ARM DOES (P2)

         The engine closes every confirm on "staged on the clone", which is true
         of an add and says nothing at all about a removal. A banker signing a
         carry exclusion is entitled to read on the confirm itself that the
         booked loan is untouched and that the clone is what starts without it. */
      /* ============ THE TOTAL IS THE STAGED TOTAL (founder, 2026-09-03)

         "The package total holds at $54M" under a rate card, on a plan that had
         already taken the $15M line to $20M. $54M was the total as the LAST
         RENDER saw it, not as the manifest stands: `figures` is memoised on the
         `entries` state, and a confirm that lands from the same render as the
         one before it reads the total from before either of them. Same closed-
         over read as the commitment drop, one line further on.

         It is computed here from the manifest as it stands RIGHT NOW - the
         baseline plus every committed move on it - so a rate card confirmed
         after a commitment card says what the package actually reads at. */
      /* ONE COMPUTATION, ONE PLACE. `figuresFor` is what the rail prints and
         what the plan summarises, so the confirm sentence reads the same
         function around the entry landing rather than doing its own sum. A new
         facility, a rider, a scalar and a carry exclusion all move the total
         through the same field, and all four are counted the same way. */
      const totalBefore = figuresFor(before, baseline).committedMM * 1e6;
      const totalAfter = figuresFor(staged, baseline).committedMM * 1e6;
      const said = cutTail(
        committedSentence({
          reply: armConfirmSentence(delta, reply),
          delta,
          before: totalBefore,
          after: totalAfter,
        }),
        vocabulary.nextMove,
        true,
      );
      /* ============ THE FOUR FIELDS nCINO PRICES ON (founder, 2026-09-02)

         A confirmed amount or term change leaves a version nobody can price
         unless the amortised term and the first payment date are set on the same
         facility. The read carries neither, and the org holds both blank on this
         relationship, so the room ASKS - one question, in the same commit as the
         confirm, so the banker reads the consequence of what they just did
         beside it rather than a turn later. */
      const gateNeed = pricingOutstanding(staged);
      const gate = gateNeed ? gateAsk(gateNeed, staged) : null;
      /* AND WHY IT RAN IS REMEMBERED. The gate exists because an amount or a
         term moved on this facility; if that entry is not on the plan at
         approve time, the plan is not the one the banker built. */
      if (gateNeed && !pricingCause.current.has(gateNeed.memberId)) {
        const cause = staged.find((e) => e.member === gateNeed.memberId && movesPricing(e));
        if (cause) {
          pricingCause.current.set(gateNeed.memberId, { id: cause.id, title: cause.title, target: cause.target });
        }
      }
      setEntries(staged);
      settleChip(blockId, chipKey, "confirmed");
      setToast(delta.badge);
      /* ============ THE EXCHANGE RESOLVES ITSELF (founder, 2026-09-03)

         The confirm is the moment this exchange is over. Everything that
         belonged to it - the line, the parse, the card, the sentence, the
         remark, the chips - shimmers out together and one row takes its place:
         what settled and how. WHAT COMES NEXT WAITS FOR THAT EXIT. A check or a
         pricing question landing over an exchange that is still fading is
         exactly the pile-up this pass exists to remove. */
      /* THE PRICING REASON IS SAID ONCE PER FACILITY. Both of a facility's two
         questions carry it from the fenced composer; the second one has already
         been told. */
      const whySaid = gateNeed ? pricingWhySaid.current.has(gateNeed.memberId) : false;
      if (gateNeed && gateNeed.slot !== "rate") pricingWhySaid.current.add(gateNeed.memberId);
      /* WHAT COMES NEXT, LANDING IN THE SAME TASK AS THE EXIT COMPLETING. Two
         timers at the same delay are two tasks with a render between them, and
         in that render the room holds no gate and no exit - which is the window
         the intent feed used to say its next line straight over this confirm. */
      const landAfterExit = () => {
        setItems((prev) => {
          const mine = prev.length ? prev[prev.length - 1].step : 0;
          return [
            ...prev,
            { kind: "agent", id: nextId("agent"), step: mine, text: said, options },
            // CHECKS COME TO YOU. The check a confirm trips arrives back in the
            // conversation the moment it becomes true, never in a separate tab.
            ...(challenge ? [{ kind: "challenge" as const, id: nextId("check"), step: mine, challenge, acked: false }] : []),
          ];
        });
        /* AND THE PRICING QUESTION WAITS ITS TURN (the stage cap). A confirm
           that tripped a check has already put one thing in front of the
           banker; the question the version needs lands when they have dealt
           with it. Nothing is lost: it is queued, in order, and released the
           moment the stage clears. */
        if (gate) {
          /* WHAT THE STAGE WILL HOLD ONCE THIS COMMIT HAS LANDED: the check, if
             the confirm tripped one, and the answer's own chips where the engine
             put a question on it. Two is the cap, so a confirm that raised both
             holds the pricing question back until one of them is dealt with. */
          const liveAfter = (challenge ? 1 : 0) + (options?.length ? 1 : 0);
          enqueue(() =>
            setItems((prev) => {
              const mine = prev.length ? prev[prev.length - 1].step : 0;
              return [
                ...prev,
                {
                  kind: "agent",
                  id: nextId("agent"),
                  step: mine,
                  text: gateNeed?.slot === "rate" ? gate.text : cutPricingWhy(gate.text, PRICING_WHY, whySaid),
                  options: gate.options,
                },
              ];
            }),
            liveAfter,
          );
        }
      };
      settleExchange(rowForDelta(delta, "confirmed"), { upTo: blockId, land: landAfterExit });
      setSuggestion(engine.suggest());
    },
    [
      elicitMembers,
      engine,
      enqueue,
      entries,
      baseline.committedMM,
      pricingOutstanding,
      vocabulary.nextMove,
      reads?.generatedAt,
      settleChip,
      settleExchange,
    ],
  );

  /**
   * SETTLING A CHIP WITHOUT STAGING IT is a decision too, so it gets an answer.
   *
   * A discarded proposal LEAVES — there is nothing left to read on it. A refusal
   * that has been understood STAYS, settled: its reason is the answer and taking
   * it off the screen would take the answer with it.
   */
  const settleOpenChip = useCallback(
    (blockId: string, chip: ChipModel) => {
      /* THE DISCARD SETTLES TOO. "Dropped" is a decision, and an exchange that
         ended in one has exactly as little left to read on it as one that ended
         in a confirm. The row says which it was. */
      if (chip.delta) {
        /* A DISCARD IS AN ANSWER TOO. The banker looked at the figure the gate
           drew and said no; approve must not then hold the plan hostage to a
           card they deliberately dropped. */
        pricingAnswered.current.delete(chip.delta.id);
        settleChip(blockId, chip.key, "discarded");
        const line = `Dropped. ${chip.delta.title} on ${chip.delta.target} is not staged and the package has not moved. ${tailNow(vocabulary.nextMove)}`.trim();
        settleExchange(rowForDelta(chip.delta, "discarded"), { upTo: blockId, land: () => agent(line) });
      } else {
        settleChip(blockId, chip.key, "confirmed");
        const line = `That one stays off the manifest, for the reason above. ${tailNow(vocabulary.nextMove)}`.trim();
        settleExchange({ what: chip.refusal?.title ?? "Refused", how: "understood" }, { upTo: blockId, land: () => agent(line) });
      }
      setSuggestion(engine.suggest());
    },
    [agent, engine, settleChip, settleExchange, tailNow, vocabulary.nextMove],
  );

  /**
   * THE BANKER TOOK THE ADVICE.
   *
   * An advisory never blocked the change it warned about, so taking its
   * resolution has to REPLACE that change rather than sit beside it: the open
   * cards in the block are settled by the same gesture, and the resolution goes
   * back through the parser exactly as a typed line does. An advisory can
   * therefore do nothing the banker could not have said themselves.
   */
  const takeAdvice = useCallback(
    (blockId: string, advisory: WorkroomAdvisory) => {
      if (!advisory.resolution) return;
      setItems((prev) =>
        prev.map((item) =>
          item.kind === "chips" && item.id === blockId
            ? { ...item, chips: item.chips.map((c) => (c.state === "open" ? { ...c, state: "discarded" as ChipState } : c)) }
            : item,
        ),
      );
      void say(advisory.resolution.say, advisory.resolution.label, { settled: true });
    },
    [say],
  );

  const drop = useCallback(
    (delta: WorkroomDelta) => {
      // Taking it off the rail is the same decision as discarding the card.
      pricingAnswered.current.delete(delta.id);
      setEntries((prev) => removeEntry(prev, delta.id));
      setToast("Removed from the manifest");
      agent(`${delta.title} on ${delta.target} is out of the manifest. The package reads as it did before it landed.`);
    },
    [agent],
  );

  const acknowledge = useCallback(
    (id: string) => {
      const check = itemsRef.current.find((i) => i.kind === "challenge" && i.id === id);
      setItems((prev) => prev.map((i) => (i.kind === "challenge" && i.id === id ? { ...i, acked: true } : i)));
      /* AN ACKNOWLEDGED CHECK IS A SETTLED EXCHANGE. The verdict becomes the
         row; the arithmetic behind it stays mounted under it and one click
         away, which is the whole reason the check was worth reading. */
      /* THE CHECK IS ITS OWN EXCHANGE. Acknowledging it settles the check and
         the sentence that raised it, and NOTHING the room put up afterwards:
         the pricing question the same confirm raised is a live question the
         banker still has to answer, and it stays on the stage. */
      if (check?.kind === "challenge") settleExchange(rowForChallenge(check.challenge), { upTo: id });
    },
    [settleExchange],
  );

  /* --------------------------------------------------------- the commit path

     THE FLOW CARD POPS OPEN IN THE THREAD (rule 38). Opening it STAGES: staging
     is zero-DML by contract, and it is the only way the card can show the org's
     real decision token rather than a decoration shaped like one. Execute
     redeems that token; Cancel drops the card and the review chip comes back. */

  /**
   * THE PLAN STILL CARRIES WHAT THE PRICING WAS FOR.
   *
   * FOUNDER, 2026-09-03: "it kind of forgets to add the commitment to the
   * modification sometimes." The stale-manifest read that caused it is fixed at
   * `entriesRef`; this is the INVARIANT that says so out loud if it ever comes
   * back by another road - a settle that retired the wrong card, a feed line
   * that re-staged the facility, an amendment that replaced the entry.
   *
   * THE RULE: the pricing gate only ever runs because an amount or a term moved
   * on a facility. If that entry is not on the plan when the banker asks to
   * approve, the plan is not the one they built, and the room says WHICH
   * facility lost its change rather than filing a version nobody meant.
   */
  const lostPricingCause = useCallback((): { title: string; target: string; answer: boolean } | null => {
    for (const [, cause] of pricingCause.current) {
      if (!entriesRef.current.some((e) => e.id === cause.id)) {
        return { title: cause.title, target: cause.target, answer: false };
      }
    }
    /* AND EVERY ANSWER THE GATE DREW A CARD FOR. A card the banker never
       confirmed is not on the plan, and the room asked the question: it does not
       get to forget that it was answered. */
    for (const [, given] of pricingAnswered.current) {
      if (!entriesRef.current.some((e) => e.id === given.id)) {
        return { title: given.title, target: given.target, answer: true };
      }
    }
    return null;
  }, []);

  const openFlow = useCallback(async () => {
    /* A NEW PACKAGE FORKS NOTHING; JOINING ONE DOES (rule 2, extended
       2026-09-06). The in-flight lock does not reach a create on its default
       path: the plan opens a package of its own and the version chain of every
       existing package is untouched. Filing INTO a package that already carries
       an unbooked version is the same fork a modification would make. It is
       refused HERE rather than at the route, because the route is bound long
       before the banker has chosen a package to join. */
    if (context.mode === "create" && context.productPackageId && locked) {
      setFlow(null);
      sayInFlightRefusal();
      return;
    }
    /* THE INVARIANT, BEFORE ANYTHING IS STAGED. A plan that lost the change its
       pricing questions were about is refused here, by name, rather than filed
       as a version of the package nobody asked for. */
    const lost = lostPricingCause();
    if (lost) {
      agent(
        lost.answer
          ? `${lost.title} on ${lost.target} is on the glass and not on the plan: the card I drew for your answer was never confirmed. ` +
              `Confirm it and it files with the rest, or discard it and I will put the plan up without it.`
          : `${lost.title} on ${lost.target} is not on the plan any more, and the pricing I asked about was for it. ` +
              `I will not put this up until that change is back on the manifest: say it again and confirm it, or discard the pricing rows that belong to it.`,
      );
      setFlow(null);
      return;
    }
    setFlow({ staging: null, running: false, status: 0, held: [] });
    try {
      /* THE STAGING CALL CARRIES A CLOCK (2026-09-05). `callTool` normalises
         every failure the platform REPORTS but has no wall clock of its own, so
         a connector that accepts the call and never answers used to leave this
         await pending for the life of the page, with the flow card open and a
         chevron filling behind it. Twenty-five seconds is one Apex round trip
         with room to spare; past it the room says so and the rail is untouched. */
      const staged = await byDeadline(engine.stagePlan(entries, context), "stage", "staging this plan");
      /* ================== THE PLAN HAS TO NAME EVERY ARM IT WAS SENT (2026-09-02)

         An exclusion writes no record, so there is no id to check afterwards and
         the PLAN STEP is the only thing that says the org took it. A manifest
         entry that reached the tool and produced no step is an entry the banker
         would sign for and never get.

         SO IT IS A GATE, NOT A SENTENCE (2026-09-02, second pass). Saying it
         while the staging sat on the card with its decision token left approve
         live, and a banker who read the line and pressed the ink button anyway
         executed a plan that does not contain their exclusion. The staging is
         stored with the arms it is missing NAMED, and while that list is not
         empty the approval is closed and `execute` refuses: the only ways on are
         to take the entry off the manifest, or to discard the plan and stage
         again. Nothing has been written either way. */
      /* A PLAN THE ROOM CANNOT READ IS NOT A PLAN, and it never becomes a
         compile card with a dead button on it. */
      if (!isReadablePlan(staged)) {
        setFlow(null);
        agent(UNREADABLE_PLAN, [TRY_AGAIN, KEEP_THE_PLAN]);
        return;
      }
      const planned = new Set((staged.plan.steps ?? []).map((s) => s.id));
      const missing = armStepPairs(entries).filter((a) => !planned.has(a.writeStepId));
      setFlow((f) => (f ? { ...f, staging: staged, held: missing.map((m) => `${m.title} on ${m.target}`) } : f));
      if (missing.length) {
        agent(
          `The plan came back without a step for ${missing.map((m) => `${m.title} on ${m.target}`).join(", ")}. ` +
            "That is the org saying it did not plan it, so I will not tell you it is going to happen, and the approval stays closed. " +
            "Nothing has been written; take it off the manifest and say it again, or discard the plan and stage once the connector is on the deployed tool list.",
        );
      }
    } catch (e) {
      setFlow(null);
      /* THE ROOM'S OWN CLOCK RAN OUT, which is a fact about the room and not
         about the org. Staging is zero-DML by contract, so "nothing was filed"
         is the one thing that CAN be stated here, and the two chips are the two
         real moves: say it again, or leave the manifest alone. */
      if (isDeadline(e)) {
        agent(stageDeadlineLine(e, "staging this plan"), [TRY_AGAIN, KEEP_THE_PLAN]);
        return;
      }
      // NO CONNECTOR IS NOT A SENTENCE IN THE FLOW, it is the reason nothing can
      // happen. It gets a glass surface of its own and says what to do next, and
      // no token was ever burnt getting here.
      if (neverReachedTheOrg(e)) {
        push({
          kind: "notice",
          id: nextId("notice"),
          title: "This view is not connected to the bank's systems.",
          body: readableError(e),
        });
        return;
      }
      /* AND A REFUSAL IS THE ORG'S OWN SENTENCE, ATTACHED TO THE ENTRY IT IS
         ABOUT. The org names a covenant or an asset; only the room knows which
         manifest entry that is and that the rest of the plan is untouched. */
      /* AND WHERE THE REFUSAL CARRIES ITS OWN ANSWER SET, THE ANSWERS ARE CHIPS
         (E6). The org lists the collateral types it holds and ends "Name one of
         them exactly"; relaying that with nothing to press leaves the banker
         typing a word the room maps straight back onto the one the org just
         refused. */
      const said = readableError(e);
      const retype = readTypeRefusal(said, entries);
      if (retype) {
        agent(
          `${said} That is ${retype.entry.title} on ${retype.entry.target}. Pick the one it is and I will put the org's own name on that entry. ` +
            "Staging writes nothing, so nothing has been filed and nothing has come off the manifest.",
          retype.values.map((v) => ({ label: v, say: typeChoiceSay(retype.entry, v) })),
        );
        return;
      }
      /* THE RUNTIME'S OWN FAILURE IS NOT AN ARM REFUSAL. `armStageRefusal`
         dresses an ORG precondition with the entry it is about; a host that
         would not carry the call has no entry and no arm. */
      if (isRuntimeTrouble(said)) {
        relayError(said);
        return;
      }
      agent(armStageRefusal(said, entries));
    }
  }, [agent, context, engine, entries, locked, lostPricingCause, push, relayError, sayInFlightRefusal]);

  openFlowRef.current = openFlow;

  /* ================== THE MANIFEST IS WRITTEN DOWN WHERE A RELOAD CANNOT REACH

     The banker's own lines, and only the ones that put something on the rail.
     `lastSaidRef` holds the line in flight; when the manifest GROWS, that line
     is what earned the card, and it joins the record. Nothing else is stored:
     no token, no staging id, no plan hash, no payload. See planStore.ts.

     FIRE AND FORGET, ALWAYS. The rail is already on the glass; a room that
     awaited its own bookkeeping would be the stuck room this wave is about. */
  const manifestCount = useRef(0);
  useEffect(() => {
    const grew = entries.length > manifestCount.current;
    const discarded = manifestCount.current > 0 && entries.length === 0;
    manifestCount.current = entries.length;
    if (grew && lastSaidRef.current) {
      if (planSaidRef.current[planSaidRef.current.length - 1] !== lastSaidRef.current) planSaidRef.current.push(lastSaidRef.current);
      lastSaidRef.current = null;
    }
    if (!context.productPackageId) return;
    if (!entries.length) {
      /* AN EMPTY RAIL IS NOT A DISCARD (2026-09-05). Every room opens on one,
         so clearing here unconditionally deleted the stored plan on the way IN,
         a moment before the read that would have offered it. Only a manifest
         that went from something to nothing is the banker throwing it away. */
      if (discarded && context.productPackageId) {
        void clearPlan(context.accountId, context.productPackageId, context.mode as PlanRoute);
      }
      return;
    }
    if (!planSaidRef.current.length) return;
    void savePlan({
      accountId: context.accountId,
      accountName: context.accountName,
      packageId: context.productPackageId,
      packageName: brief.packageName,
      route: context.mode as PlanRoute,
      said: planSaidRef.current,
      cards: entries.map((e) => ({ title: e.title, target: e.target, after: e.after })),
    });
  }, [brief.packageName, context.accountId, context.accountName, context.mode, context.productPackageId, entries]);

  /* `resume` is the STATUS RE-READ, and only the status chip passes it. It is
     not a second approval and it cannot become one: the engine answers a resume
     off the staging record, and the approve control stays sealed throughout. */
  const execute = useCallback(async (resume = false) => {
    const staging = flow?.staging;
    /* THE LOCK IS THE REF, AND IT IS CLOSED IN THIS TICK (feedback item 12).
       `filing` is state: a second click, a second Enter or a chip pressed
       inside the same commit all read the value the first gesture saw, and the
       second one would spend a token the first one is already spending. */
    if (!staging?.decisionToken || filing || filingRef.current) return;
    if (!resume && sealed) return;
    // THE GATE, CHECKED WHERE THE TOKEN WOULD BE SPENT. The button is already
    // closed; this is the half that does not depend on a rendered control.
    if (!resume && flow?.held.length) {
      agent(
        `The plan carries no step for ${flow.held.join(", ")}, so there is nothing to approve here. ` +
          "Take it off the manifest and say it again, or discard the plan and stage again. Nothing has been written.",
      );
      return;
    }
    filingRef.current = true;
    setFiling(true);
    setFlow((f) => (f ? { ...f, running: true } : f));
    try {
      const approval = {
        stagingId: staging.stagingId,
        planHash: staging.planHash,
        decisionToken: staging.decisionToken,
        approverUserId: context.approver,
      };

      /* WAIT ON THE ORG, THEN ASK THE TOOL WHAT IT DID.

         Both halves matter. The wait is the only thing that can tell a filing
         still running from one that finished; asking the tool again under the
         SAME idempotency key is the only thing that can produce the executed
         card, and it files nothing — the Apex answers a known key off the
         staging record before any check runs.

         Null means the room has already said what happened and there is no card
         to land. */
      const waitOut = async (refusal: unknown): Promise<WorkroomExecution | null> => {
        const verdict = await awaitFiling(context.accountId, staging.stagingId, settleDeps);
        setFlow((f) => (f ? { ...f, running: false } : f));
        /* THE TOKEN WAS NEVER REDEEMED, so the refusal the room is already
           holding is the whole truth. Re-raised to the ordinary catch, which
           says the org's own words and closes the approval. */
        if (verdict.kind === "never-ran") throw refusal;
        if (verdict.kind === "unsettled") {
          setSealed(true);
          push({ kind: "agent", id: nextId("agent"), text: STILL_WRITING, statusChip: true });
          return null;
        }
        if (verdict.status === "Failed") {
          setSealed(true);
          agent(FILED_FAILED);
          return null;
        }
        setFlow((f) => (f ? { ...f, running: true } : f));
        /* THE SECOND ASK, UNDER THE SAME KEY, ALSO CARRIES A CLOCK. The org
           answers a spent key off the staging record before any check runs and
           has been measured at 0.27s doing it, so a call that has not answered
           in the execute budget is a call that will not. */
        return byDeadline(engine.execute(approval), "execute", "the filing");
      };

      let landed: WorkroomExecution | null;
      if (resume) {
        // THE STATUS CHIP. The plan is already with the org under a spent token,
        // so this re-enters the wait and never the approval.
        agent(FILING_IN_FLIGHT);
        landed = await waitOut(new Error(STILL_WRITING));
      } else {
        try {
          /* THE WRITE CARRIES A CLOCK TOO, AND THE CLOCK IS NOT A VERDICT
             (2026-09-05). Forty-five seconds is the room deciding to stop
             waiting on a socket; it is never the room deciding what the org
             did. A deadline here falls into exactly the same wait a lost
             answer does, and the org's own staging record says what happened.
             `nothingWasFiled` cannot claim a deadline: it has no `dispatched`
             stamp and no channel-none code, which is the whole design. */
          landed = await byDeadline(engine.execute(approval), "execute", "the filing");
        } catch (e) {
          /* THE ANSWER WAS LOST, NOT THE FILING. Only a failure that PROVES
             nothing was written skips the wait; everything else is ambiguous,
             and the room reads the org rather than guessing at it. Waiting costs
             one read a second and can never write. */
          if (nothingWasFiled(e)) throw e;
          agent(isDeadline(e) ? executeDeadlineLine(e) : FILING_IN_FLIGHT);
          landed = await waitOut(e);
        }
      }
      if (!landed) return;
      /* AND A RESULT THE ROOM CANNOT READ IS NOT A FILING. The approval is
         sealed either way: the call reached the org and the token may be spent,
         so re-offering it would be the room guessing about a write it just said
         it could not see. */
      if (!isReadableExecution(landed)) {
        setFlow(null);
        setSealed(true);
        /* AND THE TWO ARE DIFFERENT FACTS. The engine now carries the org's own
           `terminalState`, so a run the org REPORTED as failed is said as that
           rather than as an answer the room could not read. Both close the
           approval; only one of them is a claim about what the org did. */
        push({
          kind: "agent",
          id: nextId("agent"),
          text: executionFailed(landed) ? FILED_FAILED : UNREADABLE_EXECUTION,
          statusChip: true,
        });
        return;
      }
      const result = landed;

      // THE DOSSIER IS BUILT FROM THE REAL MANIFEST AND THE REAL RESULT, before
      // anything is cleared. Every row is a change that actually filed.
      const filed = new Map(result.filed.map((f) => [f.deltaId, f]));
      const filedEntries = entries.filter((e) => filed.has(e.id));
      // THE FILED SET'S OWN SPLIT, for the trail entry below (Cowork feedback,
      // 2026-09-03): the dossier already only counts what was actually
      // written, and the requested/derived split rides the same set rather
      // than the whole manifest, so a handed-off entry never inflates either
      // side of it.
      const filedSplit = countSplit(filedEntries);
      const dossier: DossierModel = {
        packageName: brief.packageName,
        rows: filedEntries.map((e) => ({ icon: iconForDelta(e), label: `${e.target} · ${e.title.toLowerCase()}`, value: e.after })),
        // The card's last line is the ORG'S OWN verification claim where the
        // result carries one. It is never a slogan the room made up about a
        // write it cannot see.
        footer: result.filed[0]?.verification ?? result.tokenNote,
        tokenNote: result.tokenNote,
        // THE VERSION THE FILING CREATED, when the org returned one; the source
        // package only as the fallback (founder, 2026-09-03: the card linked
        // the old package while the work sat on the new version). Host from the
        // bundle's own `meta.instanceUrl`; null where the view carries none,
        // and the card then states the filing without offering a link it would
        // have had to invent a host for.
        packageHref: packageDeepLink(instanceUrl, result.outputPackageId ?? context.productPackageId ?? undefined),
        handoff: result.handoff,
        handoffs: result.handoffs,
      };
      const committedDeltaMM = figures.committedMM - brief.baselineCommittedMM;

      const extras = result as typeof result & ExecutionExtras;
      setExecution(result);
      /* THE PACKAGE THE FILING LANDED ON, NAMED AS THE ORG LEFT IT.

         A create on the default path opened a package that did not exist when
         the room opened, so `brief.packageName` still reads "New package". The
         name to say is the ORG'S: `plannedPackageName` is computed server-side
         by `StageNewFacility` to the org's own convention and written unchanged
         by the execute, so it is a read rather than an invention, and it is
         only read where the execute came back naming a package at all. Failing
         that, the id, shortened. Never a label this room composed.
         Every other filing keeps the package it was composed against. */
      const opened = context.mode === "create" && !context.productPackageId ? (result.outputPackageId ?? null) : null;
      const openedName = opened
        ? (staging.plan.plannedPackageName ?? `${NEW_PACKAGE.toLowerCase()} ${shortRecordId(opened)}`)
        : null;
      /* THE FILING'S OWN FACTS, TAKEN HERE AND NOWHERE ELSE. The clock is the
         room's at the moment the org answered, which is when the filing
         happened; the version and the queue are the org's own words for what it
         made and who has it. Absent stays absent: the sheet omits a block it
         cannot fill. */
      setFiledMeta({
        at: new Date(),
        packageName: openedName,
        version: result.outputPackageId ?? null,
        queue: typeof extras.approvalQueue === "string" ? extras.approvalQueue : null,
        stagingId: engine.scripted ? null : staging.stagingId,
      });
      setPhase("filed");
      setFlow(null);
      setLit(true);
      // The change set is finished. Nothing is left to pick up on a reopen, and
      // the next room on this package starts on an empty lane.
      engine.release();
      // AND THE STORE IS TOLD. A plan that outlived its own filing would be
      // offered back on the next load as work still to do.
      planSaidRef.current = [];
      if (context.productPackageId) void clearPlan(context.accountId, context.productPackageId, context.mode as PlanRoute);
      setItems((prev) => {
        const mine = prev.length ? prev[prev.length - 1].step : 0;
        const tail: ThreadItem[] = [{ kind: "dossier", id: nextId("dossier"), step: mine, dossier }];
        if (result.reply) tail.push({ kind: "reply", id: nextId("reply"), step: mine, reply: result.reply });
        return [...prev, ...tail];
      });
      setToast(`${vocabulary.filedWord} · logged to the activity trail`);
      // AND THE TRAIL IS TOLD (A30, extended to the room). The toast has said
      // "logged to the activity trail" since the room shipped; this is the
      // entry it was promising. Built from what the room ALREADY HOLDS — the
      // execution result and its own manifest — so nothing is read back from
      // the org to write it.
      onFiled?.({
        execution: result,
        changeCount: dossier.rows.length,
        requestedCount: filedSplit.requested,
        derivedCount: filedSplit.derived,
        packageHref: dossier.packageHref,
        // THE ARMS' OWN ACCOUNT, READ OFF THE ORG'S PLAN STEPS. `filed` is built
        // inside the engine from the deltas that carry a wire, so an arm is on
        // it whether or not the org ever planned the arm: counting the manifest
        // here made the trail assert a covenant was left off a version the org
        // never planned to leave it off. The steps are the only witness there is.
        arms: armTrailSummary(entries, staging.plan.steps ?? []),
        /* AND THE PRICING DECISION. A facility whose amortised term and first
           payment date were SET rides the filed list like any other field
           change; one the banker left for later writes nothing, so the trail
           would otherwise carry no sign that a version went up unpriceable. */
        pricing:
          [...pricingDeclined]
            .map((id) => elicitMembers.find((m) => m.id === id))
            .filter((m): m is ElicitMember => Boolean(m))
            .map((m) => pricingDeclinedLine(m))
            .join(" ") || null,
      });
      /* ============ THE SECOND HOP, FOR A PLAN THAT FILED A NEW FACILITY

         The primary loan purpose lives on `LLC_BI__Loan_Detail__c`, which Salesforce
         creates from an AFTER-COMMIT flow of its own. Nothing inside the
         transaction that filed the facility could see it, so the org reported
         the purpose as pending and `complete_new_facility_detail` finishes it.

         IT IS ITS OWN HOP, and it runs HERE rather than inside either execute
         leg: the 2026-08-31 governor fix exists to keep writes out of the engine
         leg, and a third write pass bolted onto it would put the same
         transaction back under the pressure that fix removed.

         IT NEVER FAILS THE FILING. The plan is executed and the money is on the
         version whatever this returns; what it decides is only which sentence
         the executed card carries about the purpose. A plan that filed no new
         facility never calls it at all. */
      if (stagedNewFacilities(entries).length) {
        /* The org wants the USER ID here, and `context.approver` is the display
           name in this seat (the fenced opener stages it for the greeting; the
           engine's own execute re-resolves quietly, which is why the filing
           works). Resolve the same way, and never send a name (founder,
           2026-09-03: "Invalid id: Fabian Goetzens"). */
        const approverId = approverUserId ?? context.approver;
        /* A purpose miss is a runtime footnote, not a moment: one quiet line,
           model hushed, never a remark that could out-claim the card (the model
           narrated "the facility remains unfiled", which was false). */
        const quiet = (text: string) => {
          hushRef.current?.();
          push({ kind: "agent", id: nextId("agent"), text, statusChip: true });
        };
        try {
          const finished = await byDeadline(
            completeNewFacilityDetail(staging.stagingId, approverId),
            "execute",
            "the facility's purpose",
          );
          if (finished.ok) {
            quiet(finished.result.outcome);
          } else {
            quiet(
              `The facility is filed and its purpose is not: ${finished.error.message} ` +
                "Nothing else is affected, and the purpose can be set in Salesforce or by running the same step again.",
            );
          }
        } catch (e) {
          quiet(
            `The facility is filed and its purpose is not: ${readableError(e)} ` +
              "Nothing else is affected, and the purpose can be set in Salesforce or by running the same step again.",
          );
        }
      }

      // WRITE-BACK THROUGH THE GLASS: the cockpit moves BEHIND the blur, while
      // the room is still open on the confirmation.
      if (committedDeltaMM) onExecuted?.(committedDeltaMM, Boolean(opened));
    } catch (e) {
      // A REAL ENGINE REFUSES OUT LOUD. The org's precondition, a moved figure,
      // a manifest that files nothing — each comes back as a sentence with the
      // approval still where the banker left it, rather than as a dead button.
      setFlow((f) => (f ? { ...f, running: false } : f));
      relayError(readableError(e));
      /* AND ONLY WHERE A RETRY IS HONEST. Once the call has reached the org the
         token may be spent and the write may have landed, so the room stops
         offering the gesture rather than arming a retry that would bounce on a
         burnt single-use token and tell the banker nothing about what the org did.

         WHAT THE ROOM NO LONGER ADDS HERE (2026-09-03) is "the filing may have
         completed despite the error. Do not approve again; check the staging
         record." It was a guess dressed as a warning, and on the founder's live
         run the filing HAD completed. A lost answer never reaches this catch any
         more: it is waited out above, against the record that knows. */
      if (reachedTheOrg(e)) setSealed(true);
    } finally {
      filingRef.current = false;
      setFiling(false);
    }
  }, [agent, brief.baselineCommittedMM, brief.packageName, context.approver, context.productPackageId, elicitMembers, engine, entries, figures.committedMM, filing, flow, instanceUrl, onExecuted, onFiled, pricingDeclined, push, relayError, sealed, vocabulary.filedWord]);

  /* ---- the halo breathes out ~5s after the dossier lands (rule 69). */
  useEffect(() => {
    if (!lit || reduced) return;
    const t = window.setTimeout(() => setLit(false), HALO_LIFE_MS);
    return () => clearTimeout(t);
  }, [lit, reduced]);

  /* ---- the status line under the execute mark crossfades while it runs. */
  useEffect(() => {
    if (!flow?.running || reduced) return;
    const t = window.setInterval(
      () => setFlow((f) => (f && f.running ? { ...f, status: (f.status + 1) % brief.loadSteps.length } : f)),
      STATUS_ROTATE_MS,
    );
    return () => clearInterval(t);
  }, [flow?.running, reduced, brief.loadSteps.length]);

  /* ---- A PROPOSED VALUE ROLLS INTO THE LANE (rule 65.2). The detail card is
          the state (rule 40): a committed delta lands on it inline, with the old
          figure struck through beside it, and the figure ROLLS rather than
          swapping. The roll runs on the DOM the card just rendered, which is why
          it is an effect over the entry list and not a render-time decision. */
  const laneRows = useMemo(() => {
    if (!focused) return [];
    const hit = entries.filter((e) => e.member === focused.id || e.target === focused.key);
    const base: Array<{ label: string; value: string; was?: string }> = [
      { label: "Commitment", value: focused.amount },
    ];
    if (focused.available) base.push({ label: "Available", value: focused.available });
    for (const e of hit) {
      const row = base.find((r) => r.label.toLowerCase() === e.title.toLowerCase());
      if (row) {
        row.was = e.before;
        row.value = e.after;
      } else {
        base.push({ label: e.title, value: e.after, was: e.before });
      }
    }
    return base;
  }, [entries, focused]);

  const rolled = useRef(new Set<string>());
  useEffect(() => {
    const card = detailRef.current;
    if (!card) return;
    card.querySelectorAll<HTMLElement>("b[data-roll]").forEach((el) => {
      const key = `${el.dataset.rollKey}:${el.dataset.roll}`;
      if (rolled.current.has(key)) return;
      rolled.current.add(key);
      odoRoll(el, el.dataset.roll ?? "");
    });
  }, [laneRows]);

  /* ------------------------------------------------------------- render */

  const liveStep = items.length ? items[items.length - 1].step : 0;
  const grouped = useMemo(() => {
    const out: Array<{ step: number; items: ThreadItem[] }> = [];
    for (const item of items) {
      const last = out[out.length - 1];
      if (last && last.step === item.step) last.items.push(item);
      else out.push({ step: item.step, items: [item] });
    }
    return out;
  }, [items]);
  /* A STEP THAT STILL HOLDS A GATE IS NEVER COLLAPSED. Rule 31 collapses the
     steps behind the live exchange, and rule 2 says the room takes one decision
     at a time — so a room that refused a new instruction BECAUSE a card is open
     and then hid that card would have refused and hidden the reason in the same
     gesture. An open gate keeps its step on screen until it is settled. */
  /* AND A ROOM STILL ASKING WHICH ROUTE THIS IS KEEPS THE QUESTION ON SCREEN.
     The question lives in the greeting slot at step 0; a line the room could
     not read as a route starts a step of its own, and collapsing step 0 behind
     it would hide the three chips in the same gesture that said "pick one". */
  const shows = (g: { step: number; items: ThreadItem[] }) =>
    g.step === liveStep || g.items.some(isLive) || (!!ask && g.step === 0);
  const hidden = grouped.filter((g) => !shows(g));
  /** The tiers that left the stage, and whether they are back on it. Opening
   *  the earlier steps brings them with it: one gesture for "show me what I
   *  already read", never two competing ones. */
  const tiersLeft = choreo.left;
  const tiersShown = choreo.summoned || histOpen;
  /** The card a single-package book shows: the room's own anchor, stated. */
  const anchoredPackage = {
    id: context.productPackageId ?? "anchored",
    label: brief.packageName,
    figure: `${brief.baselineMembers} members · $${brief.baselineCommittedMM.toFixed(1)}MM committed · ${brief.covenantFigure} covenants`,
  };

  /* ---------------------------------------------------- THE PACKAGE LINE

     WHAT THE ROOM IS ANCHORED ON, AND HOW IT GOT THERE. The founder's question
     of 2026-09-02 was literally "why does it know that we are talking about
     this package", and the cheapest honest answer is the room saying so on the
     glass rather than the model being trusted to. It is on the header from the
     first frame in every state, including the single-package room the demo
     runs, where the stance is "the relationship's only package". */
  const anchoredEntry = roster.find((p) => p.id === context.productPackageId) ?? null;
  /* A CREATE ON ITS DEFAULT PATH IS FILING INTO A PACKAGE THAT DOES NOT EXIST
     YET, and the line says so rather than reporting an absence. "No product
     package on this relationship yet" was true of the room and false of the
     plan: the plan has a package, it is simply one the org has not made. */
  const openingNewPackage = context.mode === "create" && !context.productPackageId;
  const joinOnOffer = brief.packageChoices.filter((c) => c.id !== NEW_PACKAGE_CHOICE).length;
  const packageLineLabel = packagePending
    ? `choose one of ${roster.length}`
    : openingNewPackage
      ? NEW_PACKAGE
      : (anchoredEntry?.name ?? (context.productPackageId ? brief.packageName : PACKAGE_NONE));
  const packageStance = packagePending
    ? `${roster.length} packages on this relationship. None is chosen yet, so nothing below is scoped to one.`
    : openingNewPackage
      ? `A new facility creates a new package. The plan makes one and files the facility into it${
          joinOnOffer
            ? `, unless you take one of the ${joinOnOffer} on this relationship still before approval.`
            : `; nothing on this relationship is still before approval, so nothing else could take it.`
        }`
      : !context.productPackageId
        ? PACKAGE_NONE
        : context.mode === "create"
          ? `Chosen over a new package: it is still before approval, so it can take the facility.`
          : roster.length === 1
            ? `${PACKAGE_ONLY}. The room anchored on it and you were not asked.`
            : `Chosen from ${roster.length} on this relationship.`;

  /** SWITCHING IS A REBUILD, NEVER A SWAP. One session is one package is one
   *  plan is one approval, so a manifest composed against one package must be
   *  confirmed or dropped before the room can stand in another. The anchor call
   *  re-keys the host, which rebuilds the engine and replays the ritual. */
  const switchPackage = (entry: PackageEntry) => {
    if (entry.id === context.productPackageId) return;
    if (entries.length) {
      setToast("Confirm or drop the staged plan before switching packages");
      return;
    }
    closePeek();
    onAnchor?.({ id: entry.id, label: entry.name, figure: entry.line, eligible: true });
  };

  const openPackagePeek = (anchor: HTMLElement) =>
    openPeek(anchor, {
      kicker: "Which package this runs in",
      width: 460,
      content: (
        <>
          <div className="wk-cav">{packageStance}</div>
          {roster.map((entry) => {
            const here = entry.id === context.productPackageId;
            return (
              <button
                type="button"
                key={entry.id}
                className={`wk-pkg ${here ? "wk-sel" : ""}`}
                data-pkgrow={entry.id}
                disabled={here}
                onClick={() => switchPackage(entry)}
              >
                <span>
                  <b>{entry.name}</b>
                  <span>{here ? `${entry.line} · you are here` : entry.line}</span>
                </span>
                {!here && (
                  <span className="wk-go" aria-hidden="true">
                    →
                  </span>
                )}
              </button>
            );
          })}
        </>
      ),
    });

  /** WHY THE ROOM IS SAYING THIS. One quiet control, and it opens the same read
   *  whether the bubble is carrying the routing question or the position. */
  const openWhy = (anchor: HTMLElement) =>
    openPeek(anchor, {
      kicker: "Why this position",
      width: 520,
      content: (
        <>
          {brief.why.map((row) => (
            <div className="wk-have-row" key={row.label}>
              <div className="wk-l">{row.label}</div>
              <div className="wk-d">{row.detail}</div>
            </div>
          ))}
          <div className="wk-cav">{brief.whyCaveat}</div>
        </>
      ),
    });

  const openingItem = (
    <div className="wk-msg wk-agent" data-who="Agent" key="opening">
      <div className="wk-bub wk-openbub">
        {/* THE EXPLAINER LEAVES THE ROW (founder, 2026-09-01). It used to be a
            "Why" pill sitting under the option chips, which put three kinds of
            control in one band and made the question read busy. It is a quiet
            "?" in the bubble's own top-right corner now: available to anyone
            who wants it, and out of the way of the decision. */}
        <button type="button" className="wk-whybtn" aria-label="Why this position" onClick={(e) => openWhy(e.currentTarget)}>
          ?
        </button>
        {/* THE PIN IS A PACKAGE FIGURE, so it waits for the package. "$10M →
            $13M" over an unanswered package question is the founder's own
            complaint in miniature: a figure at package altitude on a room that
            has not been told which package. */}
        {brief.askPin && !packagePending && <span className="wk-askpin tnum">{brief.askPin}</span>}
        {/* THE ROOM OPENS BY NAME. The greeting is a real read or it is absent;
            it is never a label, and it is never a record id. */}
        <div className="wk-headline">
          {/* The greeting is its own span so the room can be read as opening BY
              NAME, but the stagger runs straight through it: two <Words> that
              both start at zero would speak the position over the greeting. */}
          {brief.greeting && (
            <span className="wk-greet">
              <Words text={brief.greeting} />{" "}
            </span>
          )}
          {/* THE FIRST QUESTION ROUTES. While the route is open this slot
              carries the question instead of the position — the position is
              what the room says once it knows which room it is. */}
          <Words
            text={packagePending ? PACKAGE_QUESTION : ask ? ask.line : brief.position}
            offset={brief.greeting ? brief.greeting.trim().split(/\s+/).length : 0}
          />
        </div>
        {/* The routes, in the room's own option-pill style. A chip does nothing
            a typed line could not: both land in `readRouteIntent`'s answer. */}
        {/* ONE ROW, tighter (founder, 2026-09-01): the three routes are one
            decision, so they read as one line rather than a wrapping field of
            pills. Two or three one-word labels always fit. */}
        {/* THE ROUTE WAITS ON THE PACKAGE. Three route chips over an unanswered
            package question would be two decisions on one line, and the second
            of them is the one the whole session is anchored on. */}
        {ask && !packagePending && (
          <div className="wk-opts wk-routes">
            {ask.chips.map((chip) => (
              <button type="button" className="wk-opt" key={chip.label} onClick={() => chooseRoute(chip)}>
                {chip.label}
              </button>
            ))}
          </div>
        )}
        {/* THE MEMO DOOR. It waits on the package exactly as the routes do,
            because a memo is about one package version and nothing else, and it
            sits UNDER the row so the three-route decision keeps its own line. */}
        {ask && !packagePending && router?.onMemo && (
          <div className="wk-memodoor">
            <button type="button" className="wk-memobtn" data-door="memo" onClick={() => router.onMemo?.()}>
              Credit memo
            </button>
            <span className="wk-memonote">Draft the memo for this package. Nothing is staged.</span>
          </div>
        )}
        <div className="wk-posfoot">
          <div className="wk-srctray">
            {brief.sources.map((s) => (
              <button
                type="button"
                key={s.id}
                className="wk-srcchip"
                title={s.kicker}
                onClick={(e) =>
                  openPeek(e.currentTarget, {
                    kicker: s.kicker,
                    width: 440,
                    content: s.email ? <ClientEmail /> : <HaveRows rows={sourceRows(s)} />,
                  })
                }
              >
                <SourceIcon icon={s.icon} />
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const membersItem = brief.showsMembers ? (
    <div className="wk-mchips" key="members">
      {brief.members.map((m, i) => {
        const ineligible = !isEligible(m);
        return (
          <button
            type="button"
            /* THE FACILITIES BLEND IN, STAGGERED (the entry choreography). The
               rows condense one after the other rather than appearing as a
               block, which is the same 45ms cadence the odometer's columns and
               the pane anchors already use. */
            style={{ animationDelay: staggerDelay(i, 45, 320) }}
            /* The org's loan id, because two members of one package legitimately
               share a product word and a label cannot tell them apart. */
            key={m.id}
            /* A member that is NOT booked renders dashed. Pre-work display must
               never read as done work, and unknown is not booked. */
            className={`wk-mchip ${m.proposed ? "wk-prop" : ""} ${focused?.id === m.id ? "wk-sel" : ""}`}
            /* VISIBLE BUT NOT SELECTABLE (founder, 2026-09-01 + rule 30's own
               "ineligible ones visible but disabled"). A member no credit
               action can run against was still offering the hover lift and
               still taking the click, which made the room look as if it could
               work on a proposal it then refused in words. The disabled state
               and the strip's dashed border now say the same thing. */
            disabled={ineligible}
            title={ineligible ? ineligibleReason(m) : `${m.product} · ${m.tag}`}
            /* THE STRIP IS THE WAY IN. Clicking a member starts the conversation
               on it; where the engine has no read behind the strip, the member
               detail opens instead. */
            onClick={(e) => {
              const anchor = e.currentTarget;
              void pickMember(m, () =>
                openPeek(anchor, {
                  kicker: "Members of the package",
                  width: 760,
                  content: <MemberCards members={brief.members} />,
                }),
              );
            }}
          >
            <TypeIcon kind={iconForMember(m)} />
            <b>{m.key}</b>
            <span className="wk-amt tnum">{m.amount}</span>
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <Portal>
      {/* THE HANDOVER RIDES THE ROOT (founder, 2026-09-06). The memo room mounts
          underneath while this is set, so the room's glass fading is what reveals
          it; the lift keeps the sliding sheet above a room that mounted after it. */}
      <div className="wk-root" data-handoff={leaving ? "out" : undefined}>
        <GooFilter />
        <div className="wk-scrim" onClick={onClose} role="presentation" />
        <div
          ref={roomRef}
          className="wk-room eg-glass eg-glass-workroom"
          data-finale={finaleState === "off" ? undefined : finaleState}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          {/* THE PANE'S OWN GLASS, ON ITS OWN LAYER (founder, 2026-09-03: input
              latency on liquid, worst in this room). The pane used to carry its
              backdrop-filter on the same element as its streaming content, so
              every narration repaint re-ran Chromium's CPU rasterisation of the
              url() lens over the WHOLE pane. This childless sheet is the only
              thing that paints the tint, the blur and the rim now; the pane
              itself keeps layout, overflow, the drop shadow and the bevel, and
              its content sits in its own stacking layer above the sheet. See
              electric-glass.css / workroom.css for the recipe. */}
          <div className="wk-glass-sheet" aria-hidden="true" />
          {/* ONE SLIM LINE (rule 44): the mark, one word, four dots, close. */}
          <header className="wk-head">
            <BrandGlyph />
            <span className="wk-title">{roomWord}</span>
            {/* THE PACKAGE LINE (founder, 2026-09-02). The room states its
                anchor from the first frame, in every state including the
                single-package one, and where the relationship stages more than
                one this is also the way back out of the one that was chosen. */}
            <button
              type="button"
              className="wk-pkgline"
              data-pkgline={context.productPackageId ?? (packagePending ? "pending" : openingNewPackage ? "new" : "none")}
              aria-label={`Package: ${packageLineLabel}`}
              onClick={(e) => openPackagePeek(e.currentTarget)}
            >
              <span className="wk-pkgline-k">Package</span>
              <span className="wk-pkgline-v">{packageLineLabel}</span>
            </button>
            <span className="wk-spacer" />
            {/* A SCRIPTED room says so: nothing in it reaches a tool, and no
                plan it stages is the org's. A wired room shows no badge, which
                is the only honest way round — the absence of the word is a
                claim, so it is driven by the engine and not by the mode. */}
            {engine.scripted && <span className="wk-badge">Scripted</span>}
            <span className="wk-stepper" aria-label="Stage">
              {vocabulary.steps.map((label, i) => (
                <i
                  key={label}
                  className={`wk-stg ${steps.stages[i] === "on" ? "wk-on" : steps.stages[i] === "done" ? "wk-done" : ""}`}
                  title={i === 1 && steps.composeCount ? `${label} ${steps.composeCount}` : label}
                />
              ))}
            </span>
            <BugCopyButton
              build={() =>
                threadToMarkdown(items, {
                  surface: `${roomWord} — ${context.accountName}`,
                  bookAsOf: reads?.generatedAt,
                })
              }
            />
            <button type="button" className="wk-icobtn" onClick={onClose} aria-label="Close the workroom">
              ×
            </button>
          </header>

          {/* EARLIER STEPS. The live exchange is the room; everything before it
              collapses behind this chip, which floats clear of the thread's own
              58px of clearance (rule 39). */}
          {hidden.length > 0 && (
            <button type="button" className="wk-hist" onClick={() => setHistOpen((v) => !v)}>
              {histOpen ? `↓ hide earlier steps` : `↑ earlier steps (${hidden.length})`}
            </button>
          )}

          <div className="wk-body">
            <div className="wk-col-l">
              <section
                className={`wk-thread ${hidden.length ? "wk-hashist" : ""} ${histOpen ? "wk-masked" : ""}`}
                /* THE PANE CENTRES WHAT IS LEFT. Once the drain is over the card
                   is the only thing in the thread, and a lone card pinned to the
                   top edge of an empty column is the "nothing happened" the
                   finale exists to answer. */
                data-finale={finaleState === "still" ? "still" : undefined}
                ref={threadRef}
              >
                {/* THE PAST COLLAPSES, IT DOES NOT UNMOUNT. A step behind the
                    live exchange keeps its place in the thread and is hidden,
                    so opening the history is a class change rather than a
                    re-render of everything the banker already read. */}
                {grouped.map((group) => (
                  <div
                    className={`wk-step ${shows(group) || histOpen ? "" : "wk-gone"}`}
                    /* THE STEP THE CARD IS IN SURVIVES THE FINALE (2026-09-06).
                       The finale's "still" state hides every direct child of the
                       thread that is not the card - and the card is not a direct
                       child, it is inside its step, so the rule was hiding the
                       card with everything else. It has been laying the finale
                       out over an empty room since the day it shipped, on any
                       conversation long enough to have two steps; the sheet only
                       made it visible because a FLIP cannot measure a box that
                       is `display: none`. The step says it carries the star and
                       the stylesheet spares that one. */
                    data-star={group.items.some((i) => i.kind === "dossier") ? "" : undefined}
                    key={`step-${group.step}-${group.items[0].id}`}
                  >
                    {/* THE SUMMON (the entry choreography). Earlier tiers are
                        never lost: this brings back every one that left the
                        stage, and it is the only control that does. It rides
                        ABOVE the tiers, so with the faded ones collapsed it
                        sits directly over whatever is on stage. */}
                    {group.items.some((i) => tierOf(i)) && tiersLeft.length > 0 && !histOpen && (
                      <button
                        type="button"
                        className="wk-summon"
                        data-summon="tiers"
                        aria-expanded={tiersShown}
                        onClick={() => choreo.setSummoned(!choreo.summoned)}
                      >
                        {summonLabel(tiersLeft.length, tiersShown)}
                      </button>
                    )}
                    {group.items.map((item, at) => {
                      /* ONE VOICE PER MOMENT (founder drive, 2026-09-02). Where
                         the model is speaking under the card this agent line
                         announced, the room's own explanation steps back to the
                         address and the remark is the prose. A remark that never
                         arrived, declined or failed leaves the paragraph exactly
                         where it was: degrade parity is a contract. */
                      const spoken = speaksFor(item, group.items[at + 1], narration.viewFor(group.items[at + 1]?.id ?? ""));
                      /* ============ ONE BAD ITEM IS ONE BAD ITEM (2026-09-05)

                         A malformed payload reaching a card used to unmount the
                         whole React tree and leave a white page over the
                         cockpit. The boundary is per ITEM rather than per room
                         because that is the honest render: the rest of the
                         thread really is fine, and it keeps working. */
                      const block = (
                        <RoomBoundary what={`this ${item.kind}`}>
                          <ThreadBlock
                            item={spoken}
                            entries={entries}
                            filedWord={vocabulary.filedWord}
                            opening={openingItem}
                            members={membersItem}
                            packages={brief.packageChoices}
                            roster={roster}
                            anchored={anchoredPackage}
                            lit={lit}
                            hold={item.kind === "dossier" ? finale.hold : 0}
                            /* THE LEDGER RIDES THE CARD, AND ONLY IN THE FINALE.
                               Before the room drains, the rail is still on the
                               glass saying exactly this; the card repeats it only
                               once the rail is gone. */
                            filed={item.kind === "dossier" && finaleState !== "off" ? filedLines : null}
                            filedHead={filedHead}
                            onAnchor={onAnchor}
                            onOpenPeek={openPeek}
                            onConfirm={confirmChip}
                            onDiscard={settleOpenChip}
                            onAcknowledge={acknowledge}
                            onTakeAdvice={takeAdvice}
                            onOption={(sayText, label) => void say(sayText, label)}
                            onStatus={() => void execute(true)}
                            onRestartRoute={restartRoute}
                            expanded={item.kind === "settled" ? settle.isOpen(item.id) : false}
                            onExpand={settle.toggle}
                          />
                        </RoomBoundary>
                      );
                      const tier = tierOf(item);
                      /* WHERE THIS ITEM STANDS IN THE FINALE. Null on every item
                         the finale does not cover: everything before a filing,
                         and the card and its own lines after one. */
                      const inWave = finaleExit(item.id);
                      const leaves = inWave === null ? null : finaleAttrs(inWave, finaleState);
                      /* THE CARD IS THE ONE THING THAT ASCENDS, and it does it on
                         the wrapper it already had rather than in a new node: a
                         second wrapper would remount the card and restart the
                         paced reveal it is in the middle of. The two clocks it
                         needs ride down as custom properties, so the stylesheet
                         and finale.ts hold one number each. */
                      const star =
                        item.kind === "dossier"
                          ? ({ "--wk-fin-hold": `${finale.hold}ms`, "--wk-fin-sweep": `${FINALE_SWEEP_MS}ms` } as CSSProperties)
                          : null;
                      /* AND WHAT LANDED BESIDE THE CARD WAITS FOR IT. The drafted
                         reply rides the filing's own tail and the purpose
                         footnote arrives seconds later; both were appearing at
                         full strength while the star was still on its way in,
                         which put the secondary content on the glass first. They
                         hold until the card has finished arriving and then slide
                         in under it. */
                      const after =
                        finaleState !== "off" && inWave === null && item.kind !== "dossier"
                          ? ({ "--wk-fin-hold": `${finale.hold}ms` } as CSSProperties)
                          : null;
                      /* AN EXCHANGE THAT SETTLED LEAVES THE STAGE AND STAYS
                         MOUNTED (rule 1). The wrapper is the same shape at every
                         moment, so React never remounts the bubble and its word
                         speech is never restarted mid-conversation. The settled
                         ROW itself is never wrapped: it is the thing that
                         replaces the exchange, not part of it. */
                      if (!tier)
                        return (
                          <div
                            key={item.id}
                            ref={star ? morph.cardRef : undefined}
                            data-ex-id={item.id}
                            data-finale-card={star ? "" : undefined}
                            /* THE CARD'S PLACE IN THE MORPH. `ghost` lifts it out
                               of flow at the box it was already occupying and
                               fades it under the growing sheet; `gone` is off
                               stage, mounted, once the sheet is the room. */
                            data-morph={star ? cardMorph : undefined}
                            data-finale-after={after ? "" : undefined}
                            {...withFinale(
                              settleAttrs(
                                item.kind === "settled" ? "on" : settle.stateOf(item.id),
                                settle.heightOf(item.id),
                              ),
                              leaves,
                              star ?? after,
                            )}
                          >
                            {/* THE INNER ROW IS WHAT COLLAPSES. A grid track can
                                only squeeze a child that will let it, so the row
                                owns the overflow and the min-height and the
                                wrapper owns the height transition. */}
                            <div className="wk-ex-in">
                              {block}
                              <Narration view={narration.viewFor(item.id)} />
                              <Narration view={narration.viewFor(`${item.id}::mail`)} />
                            </div>
                          </div>
                        );
                      /* A TIER THAT LEFT THE STAGE STAYS MOUNTED. The wrapper
                         carries its state, so "faded out" and "gone" are two
                         different readings and an absence contract can tell
                         them apart. */
                      return (
                        <div key={item.id} {...withFinale(tierAttrs(tier, choreo.stateOf(tier), tiersShown), leaves)}>
                          {block}
                          <Narration view={narration.viewFor(item.id)} />
                          {/* THE LATE MAIL, under the greeting it missed. Every
                              other item's ::mail view is undefined and this
                              renders nothing at all. */}
                          <Narration view={narration.viewFor(`${item.id}::mail`)} />
                        </div>
                      );
                    })}
                    {/* THE REVIEW CHIP, in the live exchange. It is the only way
                        to the plan and it never leaves the thread. */}
                    {group.step === liveStep && approvalOpen && !flow && (
                      <button type="button" className="wk-propose" onClick={() => void openFlow()}>
                        <TypeIcon kind="commit" />
                        <span>
                          {countPhrase(entries.length, entries.length === 1 ? vocabulary.changeWord[0] : vocabulary.changeWord[1], entries)}{" "}
                          on the manifest · <b>Review &amp; execute</b>
                        </span>
                      </button>
                    )}
                    {group.step === liveStep && flow && (
                      <FlowCard
                        flow={flow}
                        approver={context.approver}
                        loadSteps={brief.loadSteps}
                        packageName={brief.packageName}
                        planTitle={vocabulary.planTitle}
                        planSummary={figures.planSummary}
                        /* THE SAME SPLIT THE RAIL HEAD NOW CARRIES, on the card
                           that sits right above the Execute button, the room's
                           own "review/execute summary" (Cowork feedback,
                           2026-09-03). Null on an ordinary plan, so this reads
                           exactly as it always has. */
                        derivedNote={splitClause(entries)}
                        /* WHAT THE ARMS DO, ON THE CARD THE BANKER SIGNS. A
                           plan carrying none reads exactly as it always has. */
                        armSaid={armSummary(entries)}
                        /* AND WHAT THE PLAN SAYS IT WILL DO ABOUT EACH ONE.
                           An exclusion writes no record, so its step is the
                           only proof there is, and it belongs in front of the
                           approval rather than behind it. */
                        armSteps={flow.staging ? armPlanLines(entries, flow.staging.plan.steps ?? []) : []}
                        /* AND THE ARMS THE PLAN DOES NOT CARRY A STEP FOR
                           CLOSE THE APPROVAL. A banker cannot be offered an
                           ink button for a plan that does not contain their
                           exclusion. */
                        held={flow.held}
                        approveLabel={vocabulary.approveLabel(fileable)}
                        fileable={fileable}
                        handedOff={handedOff}
                        count={figures.count}
                        sealed={sealed}
                        filing={filing}
                        onCancel={() => setFlow(null)}
                        onExecute={() => void execute()}
                        onOpenPeek={openPeek}
                      />
                    )}
                  </div>
                ))}
                {/* THE ROOM IS COMPOSING. One beat, the app's own: the ">"
                    breathing inside the goo, and nothing else to read. */}
                {/* ONE LOADER AT A TIME (founder, 2026-09-03: "the > loader
                    appears below a card, then it fills out a bubble above a
                    card, there is a lot going on in the order of execution").

                    There were two marks: the ROOM's own compose beat, at the
                    foot of the thread, and the REMARK's pending mark, which
                    lives in the slot the remark itself will fill. They took
                    turns, in different places, and read as one loader jumping.

                    The remark's mark is the one that becomes a bubble, and it is
                    already in the right position. So while a remark is pending
                    the room's own beat stands down: whatever is breathing on the
                    glass is where the sentence will land. */}
                {thinking && !narration.pending && (
                  <div className="wk-compose" role="status" aria-label="Composing an answer">
                    <LiquidMark />
                    <span>Composing…</span>
                  </div>
                )}
                {/* ============ THE SHEET THE CARD GREW INTO (founder, 2026-09-06)

                    "I need a clean room at the end when it's done with a clean
                    Summary screen."

                    IT REPLACED THE AFTERGLOW, and it took the afterglow's two
                    doors with it. A line of prose and a pair of buttons under a
                    card said what happened NEXT and never said what the
                    relationship now IS; the sheet says both, in the room's own
                    tokens, and no button sits on the card at any moment. */}
                {sheetOn && filedSheet && (
                  <FiledSheet
                    ref={sheetRef}
                    sheet={filedSheet}
                    morph={morphPhase === "morph" ? "from" : null}
                    leaving={leaving}
                    onDraftMemo={onDraftMemo ? handOff : undefined}
                    onBack={onClose}
                  />
                )}
              </section>

              {/* THE TWO QUIET TIERS (founder, 2026-09-01), under the
                  conversation and above the offer.

                  WHAT THE DEAL ALREADY SAYS leads: an overdue covenant test is
                  a fact the room was holding and not saying, because the
                  opener's own tier deliberately leads on what is coming rather
                  than on what was missed. The mail is the second voice, and it
                  is silent unless the channel actually answered with something.

                  BOTH WAIT FOR THE ROUTE. Law 3 governs the opening view and
                  the routing question owns it; a tip beside three chips
                  answering a different question is the fourth chip rule 30
                  bans. They arrive the moment the room knows which room it is,
                  which is also when they are of any use. */}
              {awake && !ask && openGates === 0 && phase === "work" && (overdue || (mail && onOpenAssist)) && (
                <div className="wk-tips">
                  {overdue && (
                    <div className="wk-tip">
                      <span className="wk-tip-l">{overdue.line}</span>
                      <button type="button" className="wk-tip-b" onClick={() => void say(overdue.chip.say, overdue.chip.label)}>
                        {overdue.chip.label}
                      </button>
                    </div>
                  )}
                  {mail && onOpenAssist && (
                    <div className="wk-tip">
                      <span className="wk-tip-l">{mail.line}</span>
                      <button type="button" className="wk-tip-b" onClick={() => onOpenAssist(mail.chip.say)}>
                        {mail.chip.label}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* THE OFFER SLEEPS WITH THE COMPOSER (rule 30), and it is gone
                  entirely while a gate is open: a next move offered beside an
                  open card is a second decision on the table. */}
              <div className="wk-sugg" hidden={phase === "filed"}>
                {/* A next move offered while the ROUTE is still open would be a
                    fourth chip answering a different question. */}
                {awake && suggestion && !ask && openGates === 0 && !thinking && phase === "work" && (
                  <button
                    type="button"
                    className="wk-pill"
                    /* The pill a banker READS and the instruction the parser
                       HEARS are not the same sentence; the second one rides
                       here, where it is inspectable rather than implied. */
                    data-say={suggestion.say}
                    onClick={() => void say(suggestion.say, suggestion.label)}
                  >
                    {suggestion.label}
                  </button>
                )}
              </div>

              {/* The composer SLEEPS until the brief lands (rule 30). */}
              <div className="wk-composer eg-pill" hidden={phase === "filed"}>
                <input
                  ref={composerRef}
                  className="wk-txt"
                  value={draft}
                  disabled={!awake || phase === "filed"}
                  placeholder={
                    phase === "filed"
                      ? // THE ROOM IS STILL ALIVE (founder, 2026-09-03). "Filed.
                        // The workroom holds." was the room announcing its own
                        // end twice: the card already says the filing landed.
                        FILED_PROMPT
                      : !awake
                        ? // THE ROOM HAS FINISHED READING; IT IS WAITING ON THE
                          // BANKER, and it should say which of the two it is.
                          packagePending
                          ? "Pick the package this runs in."
                          : "Reading the package…"
                        : ask
                          ? "Say what we are doing, or pick one above."
                          : "Say what changes on this package."
                  }
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const text = draft;
                    setDraft("");
                    void say(text);
                  }}
                  aria-label="Say what should change"
                />
                {/* THE MENU FOLLOWS THE ANCHOR. `members` and `book` are already
                    package scoped (the engine's own members, and `buildBook`
                    over their ids); the FACILITY read behind the rows was not,
                    so on a two-package relationship the plus listed the other
                    package's facilities beside this one's. */}
                {/* THE MENU NEVER OFFERS WHAT THE ROOM REFUSES (rule 2). A
                    package with a modification already in flight cannot take
                    another change of terms, so the Facility Terms topic is not
                    listed — at any level, and in the search, because
                    `hideTopics` is filtered at the one place both read. */}
                <ComposerPlus
                  room="facility"
                  members={elicitMembers}
                  facilities={scopedFacilities}
                  book={book}
                  hideTopics={locked ? LOCKED_TOPICS : undefined}
                  disabled={!awake || phase === "filed"}
                  input={composerRef}
                  onDraft={setDraft}
                />
                <button
                  type="button"
                  className="wk-send"
                  aria-label="Send"
                  onClick={() => {
                    const text = draft;
                    setDraft("");
                    void say(text);
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
                    <path
                      d="M1.6 7h9.4M7.2 3.2L11 7l-3.8 3.8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* ============================= THE RIGHT LANE: detail, then manifest */}
          <aside className="wk-col-r" aria-label={manifestHeading} data-finale={finaleState === "off" ? undefined : finaleState}>
            {/* THE FEED'S OWN PROGRESS (rule 3). How far through an intent's
                instructions the room is belongs in the lane's head beside the
                ledger, not in the thread: the thread is what was SAID, and a
                queue position is not something anybody said. */}
            {feed.total > 0 && (
              <div className="wk-feedhead" data-feed="progress">
                <span>From the intent</span>
                <b>
                  {feed.index} of {feed.total} settled
                </b>
              </div>
            )}
            {/* THE LANE OPENS EMPTY (founder call, 2026-09-01 morning, matching the
                dummy): no at-rest figures strip, no placeholder furniture. The lane
                earns its content - the detail card on focus, the ledger as changes
                confirm. The position lives in the greeting and the hero. */}
                        {focused && laneRows.length > 0 && (
              <div className="wk-detail" ref={detailRef}>
                <div className="wk-dh">
                  <TypeIcon kind={iconForMember(focused)} />
                  <span>
                    {focused.key}
                    {laneRows.some((r) => r.was) ? " · proposed" : ""}
                  </span>
                </div>
                {laneRows.map((row) => (
                  <div className="wk-drow" key={row.label}>
                    <span>{row.label}</span>
                    {row.was ? (
                      <b data-roll={row.value} data-roll-key={row.label}>
                        {row.was}
                        <span className="wk-was">was {row.was}</span>
                      </b>
                    ) : (
                      <b>{row.value}</b>
                    )}
                  </div>
                ))}
              </div>
            )}

            {entries.length > 0 && (
              <ManifestRail
                heading={manifestHeading}
                /* THE RAIL HEAD SAYS WHAT IT SAID BEFORE, WIDENED. Whisper feedback,
                   2026-09-03: two lines landed four cards and the head said "4
                   changes" with no word for the two the pricing gate added on its
                   own. `figuresFor`'s own count line is never re-derived, only
                   split, right after its leading clause and before the member
                   counts it already carries. */
                count={withDerivedSplit(figures.countLine, entries)}
                label={`${manifestHeading} · ${withDerivedSplit(figures.countLine, entries)}`}
                newest={entries[entries.length - 1]?.id ?? null}
                action={
                  <button
                    type="button"
                    className="wk-dt"
                    onClick={(e) =>
                      openPeek(e.currentTarget, {
                        kicker: "What the package holds today",
                        width: 460,
                        content: <HaveRows rows={brief.have} />,
                      })
                    }
                  >
                    Package today
                  </button>
                }
              >
                {/* ============ THE RAIL DRAINS WITH THE THREAD (founder, 2026-09-03)

                    The staged cards are the ledger of what is ABOUT to be
                    written, and after the filing nothing is: they sink on the
                    same wave the exchanges do and one quiet line takes their
                    place.

                    THEY STAY MOUNTED, exactly as a settled exchange does. Each
                    card carries the org record id that PROVES its write, and
                    that proof does not stop being true because the room is
                    finished with it: it goes off stage, aria-hidden, one class
                    from coming back, and an absence contract can still tell
                    "drained" from "never filed". */}
                {entries.map((delta, i) => {
                  const filed = filedById.get(delta.id);
                  const drains = finaleState === "off" ? null : finaleAttrs(i, finaleState);
                  const derivedReason = derivedReasonOf(delta);
                  return (
                    <div
                      {...withFinale({ className: `wk-ent ${filed ? "wk-filed" : ""}`.trim() }, drains)}
                      key={delta.id}
                    >
                      <TypeIcon kind={iconForDelta(delta)} />
                      <button
                        type="button"
                        className="wk-ent-t"
                        onClick={(e) =>
                          openPeek(e.currentTarget, {
                            kicker: `${delta.title} · what this writes`,
                            width: 460,
                            content: <OrgMap delta={delta} filedNote={filed?.verification} />,
                          })
                        }
                      >
                        <b>
                          {delta.title}
                          {derivedReason && (
                            <span className="wk-derived" title={derivedReason}>
                              Derived
                            </span>
                          )}
                        </b>
                        <span>
                          {delta.target} · {delta.before} → {delta.after}
                        </span>
                        {filed && (
                          <span className="wk-filedbar">
                            <span className="wk-st">{vocabulary.filedWord}</span>
                            <span className="wk-id">{filed.recordId}</span>
                          </span>
                        )}
                      </button>
                      {!filed && (
                        <button
                          type="button"
                          className="wk-ent-x"
                          aria-label={`Remove ${delta.title} from the manifest`}
                          title="Remove. To change it, say it again in the chat."
                          onClick={() => drop(delta)}
                        >
                          <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
                            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </ManifestRail>
            )}
          </aside>
        </div>

        {/* A GLASS WHISPER, never an ink slab (rule 70.1). */}
        <div className={`wk-toast ${toast ? "wk-show" : ""}`} role="status">
          {toast}
        </div>

        {peek && <Peek spec={peek} roomRef={roomRef} onClose={closePeek} />}
      </div>
    </Portal>
  );
}

/* ------------------------------------------------------------- the flow card

   Token + Cancel + ink Execute, IN THE THREAD (rule 38). While it runs it
   becomes the structured `.wk-flowload` (rule 42): the goo mark and the
   crossfading status on one line, full-width shimmer bars beneath, under the
   halo that is execute's only light. */

function FlowCard({
  flow,
  approver,
  loadSteps,
  packageName,
  planTitle,
  planSummary,
  derivedNote,
  armSaid,
  armSteps,
  held,
  approveLabel,
  fileable,
  handedOff,
  count,
  sealed,
  filing,
  onCancel,
  onExecute,
  onOpenPeek,
}: {
  flow: { staging: StagedWorkroomPlan | null; running: boolean; status: number; held: string[] };
  approver: string;
  loadSteps: string[];
  packageName: string;
  planTitle: string;
  planSummary: string;
  /** "2 requested · 2 derived", or null on a plan the pricing gate did not
   *  touch. Read alongside `planSummary` rather than folded into it, so the
   *  fenced sentence `figuresFor` composed never has to be re-parsed. */
  derivedNote: string | null;
  armSaid: string | null;
  armSteps: string[];
  /** Staged arms the org's plan carries no write step for. Non-empty closes the
   *  approval: the plan on this card does not contain them. */
  held: string[];
  approveLabel: string;
  fileable: number;
  handedOff: number;
  count: number;
  sealed: boolean;
  filing: boolean;
  onCancel: () => void;
  onExecute: () => void;
  onOpenPeek: ReturnType<typeof usePeek>["openPeek"];
}) {
  /* ============ ONE CARD, MORPHING (founder, 2026-09-03)

     The room used to swap a "compiling" card for a "confirmation" card. Two
     cards for one moment, and the second one read as a new thing arriving
     rather than as the first one finishing.

     IT IS ONE ROOT NODE NOW. `data-compile-state` says where it stands, the
     ORBIT circles behind it through the room's own metaball filter while it
     works and SETTLES TO STILL when the plan lands, and only the pane inside it
     crosses over - keyed, so React fades the new content in where the old one
     stood. Nothing is appended below anything. */
  /* COMPILING IS "THE PLAN IS NOT HERE YET", not "a tool is in flight". The
     room opens this card the moment the banker asks for the plan and the org
     is asked for it a frame later, so `running` alone would leave the card
     showing a confirmation with nothing to confirm for the length of a round
     trip. `staging` arriving IS the plan being ready. */
  const compiling = flow.running || !flow.staging;
  return (
    <div
      className={`wk-flowcard wk-compile${compiling ? " wk-flowload wk-lit" : " wk-compiled"}`}
      data-card="compile"
      data-compile-state={compiling ? "compiling" : "ready"}
    >
      <Orbit still={!compiling} />
      <span className="aura" aria-hidden="true" />
      {compiling ? (
        <div className="wk-pane" key="compiling">
          <div className="wk-top">
            <LiquidMark />
            <div className="wk-lstat">
              {loadSteps.map((s, i) => (
                <span className={i === flow.status ? "wk-on" : ""} key={s}>
                  {s}
                </span>
              ))}
            </div>
          </div>
          <div className="skel" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </div>
      ) : (
        <div className="wk-pane" key="ready">
      <div className="wk-t">
        <TypeIcon kind="package" />
        <span>{planTitle}</span>
      </div>
      <div className="wk-s">
        {planSummary} on {packageName}
        {derivedNote && <> · {derivedNote}</>}
        {armSaid && <> {armSaid}</>}
        {armSteps.length > 0 && (
          <ul className="wk-armsteps">
            {armSteps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {handedOff > 0 && (
          <>
            {" "}
            {fileable} of {count} {fileable === 1 ? "files" : "file"}; {handedOff} {handedOff === 1 ? "is" : "are"} handed
            off.
          </>
        )}
      </div>
      {/* The token and what governs it read together, ABOVE the controls. The
          action row holds actions only, and the ink Execute is the last thing
          in the card because it is the last thing that happens. */}
      <div className="wk-tokrow">
        <span className="wk-tok tnum">
          {flow.staging
            ? `decision token · single use · ${flow.staging.decisionToken?.slice(0, 4)}…${flow.staging.planHash.slice(-4)}`
            : "staging the plan…"}
        </span>
        <button
          type="button"
          className="wk-dt"
          onClick={(e) =>
            onOpenPeek(e.currentTarget, {
              kicker: "Governance",
              width: 420,
              content: (
                <div className="wk-prose">
                  Approver is the running identity: {approver}. {GOVERNANCE}
                </div>
              ),
            })
          }
        >
          Governance
        </button>
      </div>
      {held.length > 0 && (
        <div className="wk-armheld" role="status">
          This plan carries no step for {held.join(", ")}. The approval is closed: the org did not plan it, so approving
          here would file a version that still carries it. Take it off the manifest and say it again, or discard the plan.
        </div>
      )}
      <div className="wk-acts">
        <button type="button" className="eg-btn-quiet" onClick={onCancel}>
          {held.length > 0 ? "Discard the plan" : "Cancel"}
        </button>
        <button
          type="button"
          className="wk-approve eg-btn-ink"
          disabled={!flow.staging?.decisionToken || filing || sealed || held.length > 0}
          onClick={onExecute}
        >
          {filing ? "Working…" : sealed || held.length > 0 ? "Approval closed" : approveLabel}
        </button>
      </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- thread blocks */

function ThreadBlock({
  item,
  entries,
  filedWord,
  filed,
  filedHead,
  opening,
  members,
  packages,
  roster,
  anchored,
  lit,
  hold,
  onAnchor,
  onOpenPeek,
  onConfirm,
  onDiscard,
  onAcknowledge,
  onTakeAdvice,
  onOption,
  onStatus,
  onRestartRoute,
  expanded,
  onExpand,
}: {
  item: ThreadItem;
  entries: WorkroomDelta[];
  filedWord: string;
  /** WHAT WAS FILED, for the dossier's own section. Null outside the finale:
   *  while the room is still open the rail is saying this, and the card saying
   *  it too would be one fact on the glass twice. */
  filed: FiledLine[] | null;
  filedHead: string;
  opening: ReactNode;
  members: ReactNode;
  packages: PackageChoice[];
  /** EVERY package the relationship stages, for the ask that runs before the
   *  route. Route-neutral: see the `pkgask` branch. */
  roster: PackageEntry[];
  /** The package the room is already standing in, for the single-package card. */
  anchored: { id: string; label: string; figure: string };
  lit: boolean;
  /** THE FINALE'S DRAIN, in ms. The dossier's paced reveal waits it out so the
   *  card constructs itself into a room that has already cleared, rather than
   *  over the top of one that is still leaving. Zero everywhere else. */
  hold: number;
  onAnchor?: (choice: PackageChoice) => void;
  onOpenPeek: ReturnType<typeof usePeek>["openPeek"];
  onConfirm: (blockId: string, chipKey: string, delta: WorkroomDelta) => void;
  onDiscard: (blockId: string, chip: ChipModel) => void;
  onAcknowledge: (id: string) => void;
  onTakeAdvice: (blockId: string, advisory: WorkroomAdvisory) => void;
  onOption: (say: string, label: string) => void;
  /** Ask the org what a filing already with it finally did. Reads, never writes. */
  onStatus: () => void;
  onRestartRoute: (restart: { route: WorkroomMode; say: string }) => void;
  /** Is this settled row's exchange currently back on the stage? */
  expanded: boolean;
  /** The banker asked for a settled exchange back, or to put it away. */
  onExpand: (rowId: string) => void;
}) {
  if (item.kind === "opening") return <>{opening}</>;

  // THE BRIEF IS THE MEMBERS (rule 30 + rule 36). What the package carries is
  // stated once, on the card above; saying it again in a bubble would spend
  // law 3's budget restating the line the banker just read.
  if (item.kind === "brief") return <>{members}</>;

  if (item.kind === "lookup") {
    return (
      <div className="wk-loadchip" role="status" aria-label="Looking the package up">
        <LiquidMark />
        <span className="wk-bars" aria-hidden="true">
          <i />
          <i />
        </span>
      </div>
    );
  }

  /* THE PACKAGE ASK. Every package the relationship stages, as a line item the
     banker reads before picking: the deal's name, its stage, how many
     facilities it holds and what is committed across them. ROUTE-NEUTRAL, so
     nothing is offered hollow here: a package no modification can run against
     still takes a new facility, and the route has not been picked yet. */
  if (item.kind === "pkgask") {
    return (
      <div className="wk-pkgs wk-pkgask" role="radiogroup" aria-label={PACKAGE_QUESTION}>
        <div className="wk-pkgask-h">{PACKAGE_QUESTION_NOTE}</div>
        {roster.map((entry) => (
          /* AN IN-FLIGHT VERSION IS LISTED AND DISABLED (rule 2 + rule 30, the
             same treatment the ineligible package already gets). It is a real
             package on this relationship, so hiding it would leave the banker
             wondering where the version they just filed went; it is also not a
             room anyone can work in, so it carries its reason instead of its
             figures and nothing about it is clickable. */
          <button
            type="button"
            role="radio"
            aria-checked={false}
            key={entry.id}
            className="wk-pkg"
            data-pkg={entry.id}
            disabled={entry.inFlightVersion}
            data-inflight={entry.inFlightVersion ? "1" : undefined}
            title={entry.reason ?? entry.line}
            onClick={() =>
              !entry.inFlightVersion &&
              onAnchor?.({ id: entry.id, label: entry.name, figure: entry.line, eligible: true })
            }
          >
            <span>
              <b>{entry.name}</b>
              <span>{entry.reason ?? entry.line}</span>
            </span>
            {!entry.inFlightVersion && (
              <span className="wk-go" aria-hidden="true">
                →
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  if (item.kind === "packages") {
    // A book with ONE package still shows it, selected: which package the room
    // is anchored on is part of what the room read, not an assumption.
    const cards: PackageChoice[] = packages.length
      ? packages
      : [{ id: anchored.id, label: anchored.label, figure: anchored.figure, eligible: true, selected: true }];
    const choosing = packages.length > 0;
    return (
      <div className="wk-pkgs">
        {cards.map((choice) => (
          /* WHERE THE PLAN STANDS IS MARKED; NOTHING ELSE IS. A create's offer
             marks "New package", because that is where the plan already is, and
             an existing package is never pre-selected: taking one is a decision
             the banker makes, not one the room makes for them. */
          <button
            type="button"
            key={choice.id}
            className={`wk-pkg ${choosing ? (choice.selected ? "wk-sel" : "") : "wk-sel"}`}
            data-pkg={choice.id}
            aria-pressed={choosing ? Boolean(choice.selected) : undefined}
            disabled={!choice.eligible || !choosing}
            title={choice.eligible ? choice.figure : choice.reason}
            onClick={() => choosing && onAnchor?.(choice)}
          >
            <span>
              <b>{choice.label}</b>
              <span>{choice.eligible ? choice.figure : choice.reason}</span>
            </span>
            {choice.eligible && choosing && (
              <span className="wk-go" aria-hidden="true">
                →
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  if (item.kind === "notice") {
    return (
      <div className="wk-notice" role="alert">
        <TypeIcon kind="collateral" />
        <div>
          <div className="wk-nt">{item.title}</div>
          <div className="wk-nb">{item.body}</div>
        </div>
      </div>
    );
  }

  if (item.kind === "read") return <ReadCard card={item.card} />;

  /* ------------------------------------------------ THE SETTLED ROW (rule 1)

     What an exchange becomes once it is decided. Two facts and a control: what
     settled, how, and the way back to the whole thing. It is a BUTTON rather
     than a row with a button in it, because the whole row is the affordance and
     a keyboard reaches it in one tab either way. */
  if (item.kind === "settled") {
    return (
      <button
        type="button"
        className="wk-settled"
        data-settled-row={item.id}
        aria-expanded={expanded}
        onClick={() => onExpand(item.id)}
      >
        {item.row.kicker && <span className="wk-settled-k">{item.row.kicker}</span>}
        <span className="wk-settled-w">{item.row.what}</span>
        <span className="wk-settled-dot" aria-hidden="true">
          ·
        </span>
        <span className="wk-settled-h">{item.row.how}</span>
        <span className="wk-settled-x">{expandLabel(expanded)}</span>
      </button>
    );
  }

  /* -------------------------------------------- THE FED LINE MARKER (rule 3)

     An intent's instruction, said once, in the quietest type the room has.
     Nobody in this room typed it, so it is not a banker bubble; the room's
     answer to it is the card under it and not a second rendering of the line. */
  if (item.kind === "fed") {
    return (
      <div className="wk-fed" data-fed="line">
        <span className="wk-fed-src">{item.from}:</span> <span className="wk-fed-line">{item.text}</span>
      </div>
    );
  }

  /* THE RUNTIME GOT IN THE WAY. One quiet line and the way out of it. No red,
     no card, and never a remark under it: the banker has one thing to do. */
  if (item.kind === "trouble") {
    return (
      <div className="wk-trouble" data-trouble="line" role="status">
        <span>{item.text}</span>
        {item.reload && (
          <button type="button" className="wk-trouble-x" onClick={() => window.location.reload()}>
            Reload
          </button>
        )}
      </div>
    );
  }

  if (item.kind === "banker" || item.kind === "agent") {
    const who = item.kind === "banker" ? "You" : "Agent";
    return (
      <div className={`wk-msg wk-${item.kind}`} data-who={who}>
        <div className="wk-bub">
          {/* THE ROOM TALKS LIKE A BANKER. The engines compose in their own
              machinery's vocabulary; `bankerly` rewrites the handful of phrases
              that never belonged in front of a credit officer, on the way to
              the glass and nowhere else (the engine strings are untouched). */}
          {item.kind === "agent" ? <Words text={bankerly(item.text)} /> : item.text}
          {/* CLICKABLE ANSWERS. The org's own legal values, offered as chips a
              banker can tap instead of typing. A tap SAYS the value — it rides
              the same parser, the same staging and the same validation as a
              typed answer, so a chip can do nothing a sentence could not. */}
          {item.kind === "agent" && item.options && item.options.length > 0 && (
            <div className="wk-opts">
              {item.options.map((opt) => (
                <button type="button" className="wk-opt" key={opt.say} onClick={() => onOption(opt.say, opt.label)}>
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          {/* ASK THE ORG AGAIN. The wait budget ran out with the filing still in
              flight; this re-reads the staging record and lands the executed
              card the moment the org finishes. It spends nothing: the token was
              spent by the approval this is waiting on. */}
          {item.kind === "agent" && item.statusChip && (
            <div className="wk-opts">
              <button type="button" className="wk-opt" onClick={onStatus}>
                Check the filing
              </button>
            </div>
          )}
          {/* THE DOOR TO THE RECORD THE REFUSAL NAMED. An anchor, not a button:
              it goes somewhere, and it says nothing to the parser. */}
          {item.kind === "agent" && item.link && (
            <div className="wk-opts">
              <a className="wk-opt" href={item.link.href} target="_blank" rel="noreferrer">
                {item.link.label}
              </a>
            </div>
          )}
          {/* THE EXPLICIT RESTART. It is a chip and not an ink button on
              purpose: discarding a composed manifest is the banker's decision
              to make, never the one the room leans on. */}
          {item.kind === "agent" && item.restart && (
            <div className="wk-opts">
              <button
                type="button"
                className="wk-opt"
                onClick={() => onRestartRoute({ route: item.restart!.route, say: item.restart!.say })}
              >
                {item.restart.label}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (item.kind === "chips") {
    const open = item.chips.some((c) => c.state === "open");
    return (
      <div className="wk-chips">
        {/* ADVICE COMES BEFORE THE DECISION, and it stops being advice once the
            decision is made. It is never a gate: the Confirm below is live
            whether it is read or not. */}
        {open && (item.advisories?.length ?? 0) > 0 && (
          <div className="wk-advice-set">
            {item.advisories!.map((advisory) => (
              <div className="wk-advice" key={advisory.id} data-rule={advisory.rule}>
                <div className="wk-advice-k">Before you confirm</div>
                <div className="wk-advice-t">{advisory.line}</div>
                {advisory.resolution && (
                  <button type="button" className="wk-advice-b" onClick={() => onTakeAdvice(item.id, advisory)}>
                    {advisory.resolution.label}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {item.chips.map((chip) => {
          if (chip.state === "discarded") return null;
          if (chip.refusal) {
            return (
              <RefusalCard
                key={chip.key}
                chip={chip}
                onOpenPeek={onOpenPeek}
                onUnderstood={() => onDiscard(item.id, chip)}
              />
            );
          }
          const delta = chip.delta!;
          const inManifest = entries.some((e) => e.id === delta.id);
          return (
            <DeltaCard
              key={chip.key}
              delta={delta}
              confirmed={chip.state === "confirmed"}
              inManifest={inManifest}
              onOpenPeek={onOpenPeek}
              onConfirm={() => onConfirm(item.id, chip.key, delta)}
              onDiscard={() => onDiscard(item.id, chip)}
            />
          );
        })}
      </div>
    );
  }

  if (item.kind === "challenge") {
    return (
      <div className="wk-msg wk-agent" data-who="Agent">
        <div className="wk-bub">
          <div className="wk-vhead">
            <span className={`wk-vchip ${item.challenge.tone === "warn" ? "wk-warn" : ""}`}>{item.challenge.verdict}</span>
            <span className="wk-vk">{item.challenge.kicker}</span>
          </div>
          <div className="wk-vtxt">{bankerly(item.challenge.line)}</div>
          {/* WHY THIS CHECK MATTERS HERE. The figures above are what moved; this
              is the one sentence that says why they moved that way. */}
          {item.challenge.why && <div className="wk-vwhy">{bankerly(item.challenge.why)}</div>}
          <div className="wk-vact">
            {item.acked ? (
              <span className="wk-acked">
                <span className="wk-tick">✓</span>Acknowledged
              </span>
            ) : (
              <button type="button" className="eg-btn-ink" onClick={() => onAcknowledge(item.id)}>
                Acknowledge
              </button>
            )}
            <button
              type="button"
              className="wk-dt"
              style={{ marginLeft: "auto" }}
              onClick={(e) =>
                onOpenPeek(e.currentTarget, {
                  kicker: item.challenge.kicker,
                  width: 440,
                  content: <ChallengeMath challenge={item.challenge} />,
                })
              }
            >
              Show the math
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (item.kind === "dossier") {
    const d = item.dossier;
    return (
      <>
        <Dossier dossier={d} lit={lit} hold={hold} filed={filed} filedHead={filedHead} />
        <div className="wk-tokline">
          <span className="wk-tick">✓</span>
          <span>{d.tokenNote}</span>
        </div>
        {d.handoff && <div className="wk-handoff">{d.handoff}</div>}
        {/* WHAT WAS NOT FILED, NAMED. The room stages the whole ask and files
            the part a tool covers; the rest leaves with the banker rather than
            disappearing. */}
        {(d.handoffs?.length ?? 0) > 0 && (
          <button
            type="button"
            className="wk-dt"
            style={{ alignSelf: "flex-start" }}
            onClick={(e) =>
              onOpenPeek(e.currentTarget, {
                kicker: "Handed off, not filed",
                width: 480,
                content: (
                  <HaveRows
                    rows={d.handoffs!.map((h) => ({
                      label: h.title,
                      value: "Not filed",
                      detail: [h.reason, h.closes].filter(Boolean).join(" "),
                    }))}
                  />
                ),
              })
            }
          >
            {d.handoffs!.length} handed off, not filed
          </button>
        )}
      </>
    );
  }

  return (
    <section className="wk-reply">
      <div className="wk-vhead">
        <span className="wk-vchip">Drafted reply</span>
        <span className="wk-vk">{filedWord} · composed 09:07</span>
      </div>
      <div className="wk-subj">{item.reply.subject}</div>
      <div className="wk-lede">{item.reply.lede}</div>
      <div className="wk-ft">
        <button
          type="button"
          className="wk-dt"
          onClick={(e) =>
            onOpenPeek(e.currentTarget, {
              kicker: "Drafted client reply · 09:07",
              width: 520,
              content: (
                <>
                  <div className="wk-subj">Subject: {item.reply.subject}</div>
                  <div className="wk-replybody">{item.reply.body}</div>
                </>
              ),
            })
          }
        >
          Read it
        </button>
        <span className="wk-lede" style={{ marginLeft: "auto" }}>
          Draft only. Nothing leaves the workroom.
        </span>
      </div>
    </section>
  );
}

/* THE RESULT DOSSIER (rule 69). The card CONSTRUCTS itself: the header lands, a
   hairline draws across, each real change row materialises ~300ms apart, a
   second hairline, then the check pops last. The halo behind it is execute's
   only light and it breathes out on its own. */
function Dossier({
  dossier,
  lit,
  hold = 0,
  filed,
  filedHead,
}: {
  dossier: DossierModel;
  lit: boolean;
  hold?: number;
  filed?: FiledLine[] | null;
  filedHead?: string;
}) {
  /* THE CARD CONSTRUCTS ITSELF AFTER THE ROOM HAS CLEARED (founder, 2026-09-03).
     `hold` is the finale's drain: every delay below is offset by it, so the
     header lands as the last settled row finishes sinking rather than during it.
     Zero outside a finale, which is every other caller and every jsdom test. */
  let t = hold + DOSSIER_HEADER_MS;
  const header = t;
  t += DOSSIER_LINE_MS;
  const firstLine = t;
  t += 220;
  const rows = dossier.rows.map((row) => {
    const at = t;
    t += DOSSIER_ROW_MS;
    return { ...row, at };
  });
  const secondLine = t;
  t += DOSSIER_FOOT_MS;
  const foot = t;
  /* AND THE LEDGER IS THE NEXT BEAT OF THE SAME CLOCK (founder, 2026-09-04).
     Not a second animation laid over the card: the section starts where the
     card's own reveal ends, after the check has popped, so the whole thing
     reads as one construction that simply has more to say. */
  const ledger = foot + DOSSIER_CHECK_MS + FILED_SECTION_MS;

  return (
    <div className={`wk-rescard ${lit ? "wk-lit" : ""}`}>
      <span className="aura" aria-hidden="true" />
      {/* THE PACKAGE REFERENCE IS THE LINK (founder, 2026-09-01). The card used
          to name the package at the top and then offer an "Open the package in
          Salesforce" affordance on its last line — two mentions of one record, and
          the affordance was the louder of them. The NAME carries the href now:
          the banker reads what was filed against and opens it in the same
          gesture, and the last line goes back to being the org's own
          verification claim and nothing else.

          NO HOST, NO LINK. `packageHref` is null where the view carries no
          `meta.instanceUrl`, and the header stays plain text — a guessed My
          Domain is worse than no link at all (A29). */}
      <div className="rc-h" style={{ animationDelay: `${header}ms` }}>
        <TypeIcon kind="package" />
        {dossier.packageHref ? (
          <a
            className="wk-reslink"
            href={dossier.packageHref}
            target="_blank"
            rel="noopener noreferrer"
            data-deeplink="workroom-package"
          >
            {dossier.packageName}
          </a>
        ) : (
          <b>{dossier.packageName}</b>
        )}
      </div>
      <div className="rc-line" style={{ animationDelay: `${firstLine}ms` }} />
      {rows.map((row) => (
        <div className="rc-r" style={{ animationDelay: `${row.at}ms` }} key={row.label}>
          <TypeIcon kind={row.icon} />
          <span>{row.label}</span>
          <b>{row.value}</b>
        </div>
      ))}
      <div className="rc-line" style={{ animationDelay: `${secondLine}ms` }} />
      <div className="rc-f" style={{ animationDelay: `${foot}ms` }}>
        <span className="ok" style={{ animationDelay: `${foot + DOSSIER_CHECK_MS}ms` }}>
          ✓
        </span>
        {dossier.footer}
      </div>
      {filed && <FiledList head={filedHead ?? ""} lines={filed} at={ledger} />}
    </div>
  );
}

function DeltaCard({
  delta,
  confirmed,
  inManifest,
  onOpenPeek,
  onConfirm,
  onDiscard,
}: {
  delta: WorkroomDelta;
  confirmed: boolean;
  inManifest: boolean;
  onOpenPeek: ReturnType<typeof usePeek>["openPeek"];
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  /* THE DERIVED BADGE (Cowork feedback, 2026-09-03). A change the ROOM added,
     never the banker (today, the pricing gate's amortised term and first
     payment date). The one-line reason rides the native title tooltip so
     nothing here spends the thread's word budget; see derivedDelta.ts. */
  const derivedReason = derivedReasonOf(delta);
  return (
    <div className={`wk-chip tnum ${confirmed ? "wk-confirmed" : ""}`}>
      <div className="wk-dl">
        <TypeIcon kind={iconForDelta(delta)} />
        <span className={`wk-kind ${delta.kindTone ? `wk-${delta.kindTone}` : ""}`}>{delta.kind}</span>
        {derivedReason && (
          <span className="wk-derived" title={derivedReason}>
            Derived
          </span>
        )}
        <span className="wk-tgt">{delta.target}</span>
      </div>
      <div className="wk-line">
        <span className="wk-fld">{delta.title}</span>
        <span className="wk-was">{delta.before}</span>
        <span className="wk-arw">→</span>
        <span className="wk-now">{delta.after}</span>
      </div>
      {confirmed ? (
        <div className={`wk-receipt ${inManifest ? "" : "wk-removed"}`}>
          <span className="wk-tick">✓</span>
          <span className="wk-what">{inManifest ? "in the manifest" : "removed · say it again to restage"}</span>
        </div>
      ) : (
        <div className="wk-acts">
          <button type="button" className="eg-btn-ink" onClick={onConfirm}>
            Confirm
          </button>
          <button type="button" className="eg-btn-quiet" onClick={onDiscard}>
            Discard
          </button>
          <button
            type="button"
            className="wk-dt"
            aria-label="How this was validated"
            onClick={(e) =>
              onOpenPeek(e.currentTarget, {
                kicker: "How this was validated",
                width: 460,
                content: (
                  <>
                    <div className="wk-prose">
                      Parsed from the message, then validated deterministically against the org before it was offered.
                      Staged intent only: nothing is written until the single approval.
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <OrgMap delta={delta} />
                    </div>
                  </>
                ),
              })
            }
          >
            i
          </button>
        </div>
      )}
    </div>
  );
}

function RefusalCard({
  chip,
  onOpenPeek,
  onUnderstood,
}: {
  chip: ChipModel;
  onOpenPeek: ReturnType<typeof usePeek>["openPeek"];
  onUnderstood: () => void;
}) {
  const refusal = chip.refusal!;
  const settled = chip.state !== "open";
  return (
    <div className="wk-chip wk-refuse">
      <div className="wk-dl">
        <TypeIcon kind="covenant" />
        <span className="wk-kind wk-refusal">Not staged</span>
        <span className="wk-tgt">{refusal.target}</span>
      </div>
      <div className="wk-line">
        <span className="wk-fld">{refusal.title}</span>
      </div>
      {/* THE BANKER'S READING LEADS. Why the answer is no and what would work,
          then the org's own account of its constraint as the quote it is. Both
          go through the copy filter: a refusal is the one place a banker most
          needs plain words, and it was the worst offender. */}
      {refusal.why && <div className="wk-refuse-why">{bankerly(refusal.why)}</div>}
      <div className="wk-quote">{bankerly(refusal.reason)}</div>
      {!settled && (
        <div className="wk-acts">
          <button type="button" className="eg-btn-ink" onClick={onUnderstood}>
            Understood
          </button>
          <button
            type="button"
            className="wk-dt"
            aria-label="More on this refusal"
            onClick={(e) =>
              onOpenPeek(e.currentTarget, {
                kicker: "Why this cannot be staged here",
                width: 420,
                content: <div className="wk-prose">{bankerly(refusal.detail)}</div>,
              })
            }
          >
            i
          </button>
        </div>
      )}
    </div>
  );
}
