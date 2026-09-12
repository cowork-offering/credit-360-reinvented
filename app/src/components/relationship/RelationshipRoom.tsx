import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Portal } from "../Portal";
import { BugCopyButton } from "../BugCopyButton";
import { threadToMarkdown } from "../transcript";
import { isTopmost, pushModal } from "../modalStack";
import { prefersReducedMotion } from "../../data/motion";
import { fmtMoney } from "../../data/format";
import { isActiveFacility } from "../../data/worklist";
import { classifyCovenant } from "../../domain/covenantStatus";
import { resolveBundle } from "../../actions/registry";
import { executedActivityEntry } from "../../actions/executedActivity";
import { useApp } from "../../state/appState";
import type { StagedCovenant, StagedOutput } from "../../actions/stagedPlan";
import type { ExecuteResult, WriteActionId } from "../../channel/writeTools";
import type { C360Data } from "../../data/contract";
import { BrandGlyph } from "../brand";
import { Peek, usePeek } from "../workroom/Peek";
import { GooFilter, LiquidMark, Orbit } from "../workroom/Liquid";
import { TypeIcon, type IconKind } from "../workroom/TypeIcon";
import { ReadCard } from "../workroom/ReadCardView";
import { isQuestion, readRole, readTopic } from "../workroom/ask";
import { buildReadCard, readGap, type ReadCardModel, type ReadSource } from "../workroom/readCard";
import { toReadCardModel } from "../workroom/brainRoute";
import {
  TIER_STAGGER_MS,
  summonLabel,
  tierAttrs,
  useEntryChoreography,
  type EntryTier,
} from "../workroom/entryChoreography";
import {
  expandLabel,
  rowForStep,
  settleAttrs,
  useSettleChoreography,
  type SettledRow,
} from "../workroom/settle";
import { FINALE_SWEEP_MS, finaleAttrs, useFinale, withFinale } from "../workroom/finale";
import { FILED_SECTION_MS, FiledList, type FiledLine } from "../workroom/FiledList";
import type { BrainEnvelope, BrainMail, BrainReply, BrainTurn } from "../../channel/brainLane";
import { UNREADABLE_CLARIFY, askBrain, brainReachable, isDegrade } from "../../channel/brainLane";
import { readCatalog, type OrgCatalog } from "../../channel/catalog";
import { Narration, useNarration } from "../../channel/Narration";
import { subjectFor } from "../../channel/narrate";
import { ManifestRail } from "../rail/ManifestRail";
import { REL_ROUTE_WORDS, buildRelEnvelope } from "./relBrain";
import { NO_COMPLIANCE_ROW_CHIP, relBookFor, type RelBook } from "./relBook";
import { COVENANT_REVIEW, FIELD_EXAM_OFFER, STAGE_A_FIELD_EXAM, asksForFieldExam } from "./fieldExam";
import { buildRelReadCard, readRelTopic, relReadGap } from "./relReads";
import { RoomBoundary } from "../workroom/RoomBoundary";
import {
  KEEP_THE_PLAN,
  TRY_AGAIN,
  byDeadline,
  executeDeadlineLine,
  isDeadline,
  stageDeadlineLine,
} from "../workroom/deadline";
import { useClientMail } from "../workroom/clientMail";
import { useRoomFeed } from "../../intent/feed";
import { intentFor, intentMailNote, noteFiled } from "../../intent/open";
import { sourcePhrase } from "../../intent/contract";
import { stepperState } from "../../workroom/stepper";
import {
  FACILITY_HANDOFF,
  CLIENT_REQUEST_OFFER,
  NEUTRAL_QUESTION,
  RAISE_A_SERVICE_REQUEST,
  REL_ROUTE_CHIPS,
  REL_ROUTE_WORD,
  SOMETHING_ELSE,
  asksForFacilityWork,
  readRelRouteIntent,
  readsAsClientRequest,
  readRelRouteSwitch,
  relOpeningFor,
  type RelOpening,
  type RelRoute,
} from "./relRoute";
import {
  CREATE_GAPS,
  NAME_THE_SURFACE,
  NOT_A_CLASSIFICATION,
  onScale,
  NO_CONNECTOR,
  REL_FLOWS,
  RelFlowError,
  SKIPPED,
  asksForClassification,
  covenantLabel,
  defaultRelDeps,
  dossierFooter,
  dossierHandoff,
  dossierRowsFor,
  executeRelPlan,
  nextStep,
  readCreateAsk,
  relContextFor,
  relReadyLine,
  relPackagePending,
  relRouteBlock,
  reviewableCovenants,
  routeAvailability,
  stageRelPlan,
  valuableCollateral,
  type Answers,
  type CreateGap,
  type DossierRow,
  type RelContext,
  type RelFlowSpec,
  type RelFlowDeps,
  type RelStep,
  type StagedRelPlan,
} from "./reviewFlows";
import { intakeRows } from "./intakeFlows";
import {
  anchorRelPackage,
  bindRelRoute,
  closeRelationshipRoom,
  restartRelRoute,
  useRelationshipRoom,
} from "./relSession";
import { newRequestId } from "../../channel/adapter";
import { ComposerPlus } from "../composer/ComposerPlus";
import { EMPTY_BOOK } from "../workroom/elicit";
import { packagePick, type PackageEntry } from "../../book/packages";
import { awaitFiling, FILED_FAILED, FILING_IN_FLIGHT, LIVE_SETTLE, STILL_WRITING } from "../workroom/settleExecution";
import "../../styles/workroom.css";
import "../../styles/package-anchor.css";
import "../../styles/relationship.css";

/* =============================================================================
   THE RELATIONSHIP ACTIONS ROOM — A GOVERNANCE RITUAL.

   ONE shell, FIVE routes. The second unified room, built on the Facility room's
   visual language 1:1 — the same bubbles, the same option pills, the same
   wk-in arrivals, the same identity chips, the same flow card, the same goo
   loader, the same result dossier under the same halo, the same glass recipe.
   Nothing in the material was reinvented, which is the whole point: a banker
   who has learned one room has learned both.

   WHAT DIFFERS IS THE REGISTER (founder, 2026-08-31: "more steered in
   professional"). The facility room is a conversation about a deal; this one is
   a GOVERNANCE ritual, so it is more formal and more led:

     - every route opens with a STRUCTURED BRIEF — what the review covers, then
       what it produces — before it asks anything. A review states its scope
       before it takes an instruction.
     - the questions are STEPS, numbered and asked one at a time, each carrying
       the org's own legal values as chips.
     - free text still binds. A banker who types the answer answers the step;
       a banker who names a different review moves the room; a banker who asks
       for facility work is told where it lives, in one line.

   THE FLOWS ARE UNTOUCHED. Every route drives the SAME `stage_*`/`execute_*`
   pair the Action Panel drives today, through `reviewFlows.ts`, with the same
   payload shape and the same token discipline. The ActionPanel machinery still
   ships and still works; this room re-clothes the same five flows.

   THE CHANNEL-NONE DOCTRINE HOLDS THROUGHOUT. No connector means no plan,
   nothing simulated, and no token ever burnt. It gets a surface of its own.
   ============================================================================= */

/** VERBATIM SHELL COPY. The review's own package question, and the word for a
 *  relationship that stages none. */
const REL_PACKAGE_QUESTION = "Which package does this review run in?";
const REL_PACKAGE_NONE = "no product package on this relationship";

/* ------------------------------------------------------------- thread model */

interface DossierModel {
  title: string;
  rows: DossierRow[];
  footer: string;
  tokenNote: string;
  handoff?: string;
}

interface Opt {
  label: string;
  /** What the parser hears. A chip does nothing a typed line could not. */
  say: string;
  detail?: string;
  /** The org will not take this one, and the chip says why rather than going. */
  disabled?: boolean;
  reason?: string;
}

type RelItem = { id: string; step: number } & (
  /** The opening read: the greeting, the position or the first question. */
  | { kind: "opening" }
  /** The relationship lookup, running. */
  | { kind: "lookup" }
  /** The route's structured brief: what it covers, what it produces. */
  | { kind: "brief" }
  /** WHICH PACKAGE THIS REVIEW RUNS IN, where the review is anchored on one and
   *  the relationship stages several. Lands with the brief and holds the first
   *  step, because every step below it is scoped to the package. */
  | { kind: "pkgask" }
  | { kind: "banker"; text: string }
  | {
      kind: "agent";
      text: string;
      /** "Step 2 of 6", above the question. The ritual is numbered. */
      kicker?: string;
      options?: Opt[];
      /** The explicit restart offered when a cross-route line lands on a
       *  session that has already collected answers. Never a silent swap. */
      restart?: { route: RelRoute; label: string; say: string };
    }
  /** THE ROOM REACHED NO ORG. Loud, in glass, with the way out of it.
   *  `room` is the narration discriminator: this kind and `dossier` are shared
   *  by NAME AND SHAPE with the facility room, whose own notice and dossier are
   *  chrome that `subjectFor` must keep returning null for. */
  | { kind: "notice"; room: "relationship"; title: string; body: string }
  /** A create this room can compose and cannot file, with the gap named. */
  | { kind: "gap"; gap: CreateGap }
  /** A READ QUESTION, ANSWERED. Not a step and not a gate: nothing on it is
   *  waiting for a decision, and it does not advance the review. */
  | { kind: "read"; card: ReadCardModel }
  | { kind: "dossier"; room: "relationship"; dossier: DossierModel }
  /** AN ANSWERED STEP (the settle choreography). What was recorded and how, in
   *  one row, over the exchange it replaced. The exchange stays mounted under
   *  it and the row brings it back. */
  | { kind: "settled"; row: SettledRow; covers: string[] }
  /** A LINE THE ROOM WAS FED (the intent handoff). One marker, not a bubble. */
  | { kind: "fed"; text: string; from: string }
);

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewRelItem = DistOmit<RelItem, "step">;

/**
 * WHICH ENTRY TIER A THREAD ITEM BELONGS TO (the entry choreography).
 *
 * One grammar with the facility room, in this room's own nouns: the question,
 * then the review's scope as the identity the ritual runs against, then the
 * first collected question as the thing being decided on. `detailId` names the
 * ONE agent bubble that is a tier; every later step is an exchange.
 */
function relTierOf(item: RelItem, detailId: string | null): EntryTier | null {
  if (item.kind === "opening") return "question";
  if (item.kind === "brief") return "identity";
  if (item.kind === "agent" && item.id === detailId) return "detail";
  return null;
}

/** The composed beat. A floor, not a delay: the room waits for the slower of
 *  the flow and the beat. Zero under reduced motion. */
const COMPOSE_FLOOR_MS = 460;
const LOOKUP_MS = 1500;
const STATUS_ROTATE_MS = 1500;
const DOSSIER_HEADER_MS = 140;
const DOSSIER_LINE_MS = 280;
const DOSSIER_ROW_MS = 300;
const DOSSIER_FOOT_MS = 200;
const DOSSIER_CHECK_MS = 180;
const HALO_LIFE_MS = 5600;

/* ---- the finale's two sentences (founder, 2026-09-03). The line under the card
   is the room saying it is FINISHED rather than merely stopped; the prompt is the
   other half of the same claim, and it is the facility room's word for word. */
const REL_AFTERGLOW_LINE = "Next, the review memo is generated and handed into the delegated approval process.";
const REL_FILED_PROMPT = "Anything else on this relationship?";
const WORD_STAGGER_MS = 26;

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

/**
 * THE LINE, AS THE THREAD SHOWS IT.
 *
 * A line the BANKER typed is a banker bubble. A line the room was FED by an
 * intent is not: nobody in this room said it, and drawing it as if they had was
 * one instruction rendered twice.
 */
const relBankerLine = (step: number, text: string, from?: string): RelItem =>
  from
    ? { kind: "fed", id: nextId("fed"), step, text, from }
    : { kind: "banker", id: nextId("banker"), step, text };

/** The chip a banker taps to leave an optional step unanswered. */
const SKIP_LABEL = "Not assessed";

export interface RelRouteChoice {
  label: string;
  route: RelRoute | null;
  covenantId?: string | null;
  /** The line the chip binds WITH, where the chip is confirming a reading of
   *  something the banker already typed. The bound room replays it, so the
   *  client's own words become the case subject instead of being retyped. */
  say?: string;
  /** The staged data cannot support this review. The chip STAYS, disabled,
   *  carrying the registry's own reason verbatim (A27.3): hiding it would take
   *  the map of what exists away from the banker. */
  disabled?: boolean;
  reason?: string;
}

export interface RelRouterQuestion {
  line: string;
  chips: RelRouteChoice[];
}

/**
 * The neutral five-way. NO DATA SIGNAL OPENS ON THIS, never on a fabricated
 * suggestion — the channel-none doctrine, applied to the greeting slot.
 *
 * `data` and `accountId` are optional so a render test can build the question
 * without a snapshot; without them every route reads as available, which is the
 * shell's own default and never a claim about an org.
 */
export function neutralRelAsk(args?: { data: C360Data; accountId: string | null; book?: RelBook | null }): RelRouterQuestion {
  return {
    line: NEUTRAL_QUESTION,
    chips: REL_ROUTE_CHIPS.map((c) => {
      if (!args) return { label: c.label, route: c.route };
      const availability = routeAvailability(c.route, args.data, args.accountId);
      /* THE HONESTY GATE, ON THE CHIP (section 1.5). Where NOT ONE covenant
         carries a compliance row the covenant route can only end in a refusal,
         so the chip says so instead of offering it. It STAYS on the glass,
         disabled, carrying the reason (A27.3): hiding a route takes the map
         away from the banker. */
      const noRows = c.route === "covenant" && args.book?.noComplianceRows === true;
      return {
        label: c.label,
        route: c.route,
        disabled: !availability.available || noRows,
        reason: noRows ? NO_COMPLIANCE_ROW_CHIP : availability.reason,
      };
    }),
  };
}

/** The question a governance signal opens on: the fact the read carries, the
 *  yes it implies, and the way out of it. */
export function smartRelAsk(opening: RelOpening): RelRouterQuestion {
  return {
    line: opening.line,
    chips: [
      { label: opening.yesLabel, route: opening.route, covenantId: opening.covenantId },
      { label: SOMETHING_ELSE, route: null },
    ],
  };
}

export interface RelRouter {
  question: RelRouterQuestion | null;
  say: string | null;
  preselectCovenantId?: string | null;
  /** The five-way "Something else" falls through to. It is the CALLER's, not
   *  the room's, because only the caller can see the snapshot that says which
   *  of the five the staged data can support. */
  neutral: () => RelRouterQuestion;
  onBind: (route: RelRoute, opts?: { say?: string; covenantId?: string | null }) => void;
  onRestart: (route: RelRoute, say: string) => void;
}

/** THE AGENT SPEAKS, NEVER PASTES (rule 65). Each word condenses out of the
 *  glass 26ms after the one before it. Whitespace stays as plain text nodes, so
 *  `textContent` is byte-identical to the sentence handed over. */
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

/** TRUE where the room never reached an org at all. The one failure that earns
 *  a surface of its own: a banker who cannot tell "not connected" from
 *  "something went wrong" will retry a room that can never answer. */
function neverReachedTheOrg(e: unknown): boolean {
  return e instanceof RelFlowError && e.code === "server_not_connected";
}

function readableError(e: unknown): string {
  if (e instanceof RelFlowError) return e.message;
  if (e instanceof Error) return e.message;
  return "The review could not be completed.";
}

/* ------------------------------------------------------ what the room reads */

interface RelBrief {
  greeting: string;
  /** The position, once a route is bound. */
  position: string;
  committed: string;
  covenantCount: string;
  grade: string;
  /** The scope rows behind the Why peek: what the room read to say it. */
  why: Array<{ label: string; detail: string }>;
}

function briefFor(ctx: RelContext): RelBrief {
  const facilities = (ctx.bundle?.exposure?.facilities ?? []).filter(isActiveFacility);
  const committed = ctx.bundle?.exposure?.totalCommitted;
  const covenants = ctx.bundle?.covenants?.covenants ?? [];
  const breaches = covenants.filter((c) => classifyCovenant(c).financialBreach).length;
  const grade = ctx.bundle?.snapshot?.primaryRiskRating;
  return {
    // A LEGAL NAME OFTEN ENDS IN A PERIOD ("Sterling Fabrication Co."), and the
    // greeting must not put a second one after it.
    greeting: `Relationship Actions on ${ctx.accountName}`.replace(/\.?$/, "."),
    position: `${facilities.length} active ${facilities.length === 1 ? "facility" : "facilities"}, ${covenants.length} ${
      covenants.length === 1 ? "covenant" : "covenants"
    }${breaches ? `, ${breaches} in breach` : ""}.`,
    committed: typeof committed === "number" ? fmtMoney(committed) : "not read",
    covenantCount: String(covenants.length),
    grade: grade != null ? String(grade) : "not read",
    why: [
      {
        label: "Facilities",
        detail: `${facilities.length} active on the relationship, read from the exposure the cockpit staged.`,
      },
      {
        label: "Covenants",
        detail: covenants.length
          ? `${covenants.length} recorded${breaches ? `, ${breaches} carrying a financial breach in the org's own words` : ", none in financial breach"}.`
          : "None recorded for this relationship.",
      },
      {
        label: "Package anchor",
        detail: ctx.productPackageId
          ? `The covenant review and the valuation are anchored on ${ctx.productPackageId}.`
          : "The read stages no product package, so the two package-anchored reviews have nothing to stage against.",
      },
      {
        label: "As of",
        detail: ctx.asOf ? `${ctx.asOf}, the snapshot's own clock. Nothing here reaches a live clock.` : "The read stages no clock.",
      },
    ],
  };
}

/** How many steps the route expects, so the spine can count. Derived from the
 *  same machine that asks them, never a second table that would drift. */
function plannedStepCount(route: RelRoute, ctx: RelContext, answers: Answers): number {
  let n = Object.keys(answers).length;
  const probe: Answers = { ...answers };
  // Walk the machine forward on a COPY, answering each step with a sentinel, to
  // count what is still to come. Bounded hard: a machine that never settles is
  // a bug, and a count is not worth hanging the room for.
  for (let guard = 0; guard < 64; guard++) {
    const step = nextStep(route, ctx, probe);
    if (!step) break;
    n += 1;
    assign(probe, step.key, step.kind === "multi" ? [] : SKIPPED);
  }
  return Math.max(n, 1);
}

/** Write an answer, honouring the `group.id` key form the per-record steps use. */
function assign(answers: Answers, key: string, value: unknown): void {
  const dot = key.indexOf(".");
  if (dot === -1) {
    answers[key] = value;
    return;
  }
  const group = key.slice(0, dot);
  const id = key.slice(dot + 1);
  const held = answers[group];
  const next = held && typeof held === "object" && !Array.isArray(held) ? { ...(held as Record<string, unknown>) } : {};
  next[id] = value;
  answers[group] = next;
}

/** The lane rows: everything collected, in the order it was collected. */
interface LaneRow {
  key: string;
  icon: IconKind;
  label: string;
  value: string;
}

function laneRowsFor(route: RelRoute, ctx: RelContext, answers: Answers, order: string[]): LaneRow[] {
  /* THE INTAKE LANE READS AS WHAT IS BEING FILED, one row per covenant and one
     per asset, rather than one row per answer. Eleven rows behind three
     covenants is a transcript; the banker is filing covenants, so the lane says
     covenants. The rows come from the same drafts the payload is built from, so
     the lane and the wire cannot describe different things. */
  if (route === "intake") return intakeRows(ctx, answers);
  const covenants = reviewableCovenants(ctx);
  const assets = valuableCollateral(ctx);
  const rows: LaneRow[] = [];
  for (const key of order) {
    const dot = key.indexOf(".");
    const group = dot === -1 ? key : key.slice(0, dot);
    const id = dot === -1 ? null : key.slice(dot + 1);
    const held = dot === -1 ? answers[key] : (answers[group] as Record<string, unknown> | undefined)?.[id!];
    if (held === undefined) continue;
    const value = Array.isArray(held)
      ? held.length
        ? `${held.length} selected`
        : "none"
      : held === SKIPPED
        ? "not assessed"
        : String(held);
    const named = id
      ? (covenants.find((c) => c.covenantId === id) && covenantLabel(covenants.find((c) => c.covenantId === id)!)) ||
        assets.find((c) => c.collateralId === id)?.collateralDescription ||
        assets.find((c) => c.collateralId === id)?.collateralName ||
        id
      : null;
    rows.push({
      key,
      icon: iconForAnswer(route, group),
      label: named ? `${LANE_LABELS[group] ?? group} · ${named}` : (LANE_LABELS[key] ?? LANE_LABELS[group] ?? key),
      value,
    });
  }
  return rows;
}

/**
 * THE ORG'S OWN ID FOR EACH ANSWER, where the flow returns one per record.
 *
 * The finale wipes the lane, so the card that survives has to carry what the
 * lane was carrying (founder, 2026-09-04), and for a review that files a
 * record per covenant or per asset, the id is the half a banker pastes into a
 * search. Only what the ORG reported: a route that files one record for the
 * whole review names it on the dossier's own rows above and gets nothing here,
 * rather than the same id repeated against every answer that fed it.
 */
function laneOrgIds(route: RelRoute, rows: readonly LaneRow[], result: ExecuteResult): Record<string, string> {
  const items = result.items ?? [];
  const out: Record<string, string> = {};
  /* THE INTAKE FILES ONE RECORD PER LANE ROW, IN ORDER: `intakeDossierRows`
     already reads `items[i]` against `intakeRows(...)[i]`, and this lane IS
     that list, so position is the org's own correspondence and not a guess. */
  if (route === "intake") {
    rows.forEach((row, i) => {
      const id = (items[i]?.recordId ?? "").trim();
      if (id) out[row.key] = id;
    });
    return out;
  }
  /* THE OTHER BULK FLOWS NAME THEIR SOURCE RECORD PER ITEM, so a row is matched
     on the covenant or collateral id its own key already carries. */
  const byRecord = new Map<string, string>();
  for (const item of items) {
    const source = item.covenantId ?? item.collateralId;
    const id = item.covenantComplianceId ?? item.valuationId ?? item.recordId;
    if (source && id) byRecord.set(source, id);
  }
  for (const row of rows) {
    const dot = row.key.indexOf(".");
    const id = dot === -1 ? undefined : byRecord.get(row.key.slice(dot + 1));
    if (id) out[row.key] = id;
  }
  return out;
}

/** The banker-facing word for each answer, in the ONE icon language's register. */
const LANE_LABELS: Record<string, string> = {
  reviewType: "Review type",
  relationshipSummary: "Position",
  recommendation: "Recommendation",
  covenants: "Covenants",
  covenantStatuses: "Assessment",
  covenantObservedValues: "Observed",
  covenantReasons: "Reason",
  assessmentNarrative: "Basis",
  records: "Collateral",
  recordValues: "Value",
  valuationDate: "Valuation date",
  type: "Basis",
  source: "Source",
  primary: "Primary valuation",
  description: "Note",
  cashFlowCoverage: "Cash-flow coverage",
  revenueGrowth: "Revenue growth",
  managementExperience: "Management experience",
  creditScore: "Credit score",
  overrideComment: "Rationale",
  computedRiskGradeValue: "Proposed grade",
  overriddenRiskGradeValue: "Override",
  requestType: "Subject",
  summary: "Request",
  detail: "Detail",
  intakeKind: "Intake",
  intakeKindPick: "Intake",
};

function iconForAnswer(route: RelRoute, group: string): IconKind {
  if (group.startsWith("cov")) return "covenant";
  if (group.startsWith("col")) return "collateral";
  if (group.startsWith("covenant")) return "covenant";
  if (group === "records" || group === "recordValues") return "collateral";
  if (group === "valuationDate" || group === "detail") return "maturity";
  if (group === "type" || group === "source" || group === "primary" || group === "description") return "pricing";
  if (route === "rating") return "pricing";
  return REL_FLOWS[route].icon;
}

/* =============================================================================
   THE ROOM
   ============================================================================= */

export function RelationshipRoom({
  ctx,
  route,
  router,
  onClose,
  onAnchorPackage = () => {},
  brain,
  deps = defaultRelDeps,
  mail = null,
  mailGate = true,
  onFiled,
}: {
  ctx: RelContext;
  /** Null while the room is still asking which review this is. */
  route: RelRoute | null;
  router?: RelRouter;
  onClose: () => void;
  /** THE BANKER CHOSE A PACKAGE. The host writes it into the session and the
   *  context re-derives on it; this room never holds the anchor itself, for the
   *  same reason the facility room does not. */
  onAnchorPackage?: (productPackageId: string) => void;
  /**
   * THE SECOND LANE, IN THIS ROOM TOO.
   *
   * The step machine is the fast lane and it is untouched: a line it can read
   * as the answer to the live step is recorded exactly as it always was. What
   * routes here is what it cannot claim — a question, and a line the step
   * refuses. ABSENT IS NO BRAIN LANE, and the room then behaves exactly as it
   * did before this lane existed: the same re-ask, the same refusals, no wait.
   */
  brain?: (envelope: BrainEnvelope) => Promise<BrainReply>;
  deps?: RelFlowDeps;
  /**
   * THE CLIENT'S OWN MESSAGE, AND THE GATE THE GREETING WAITS ON.
   *
   * Injected rather than read here, exactly as the facility room does it: one
   * `outlook_email_search` per room open, made by the host, and the room asks
   * nothing about where the note came from. ABSENT is the channel-none case and
   * the gate is then open on the first tick.
   */
  mail?: BrainMail | null;
  mailGate?: boolean;
  /**
   * AN EXECUTED REVIEW LANDS IN THE TRAIL (A30).
   *
   * The room's toast has always said "logged to the activity trail" and the
   * room has never written one: it took no onFiled and its host wired none,
   * against Workroom.tsx and WorkroomHost.tsx which have done both since A30.
   * The room hands over what it already holds; the entry is minted in actions/
   * where every other executed action's entry is minted.
   */
  onFiled?: (filed: { actionId: WriteActionId; result: ExecuteResult }) => void;
}) {
  const reduced = prefersReducedMotion();
  const brief = useMemo(() => briefFor(ctx), [ctx]);
  /* THE BOOK, READ ONCE. What this relationship already carries, so a step does
     not ask what the read answers and a route that can only refuse says so
     before it asks anything. */
  const book = useMemo(() => relBookFor(ctx), [ctx]);
  const flowSpec = route ? REL_FLOWS[route] : null;

  const [ask, setAsk] = useState<RelRouterQuestion | null>(() => router?.question ?? null);
  const [items, setItems] = useState<RelItem[]>([]);
  const [step, setStep] = useState(0);
  /* THE THREAD, THE THIRD TIER AND THE LIVE QUESTION'S NUMBER, read through
     refs. The settle names the items it covers without the callbacks that
     settle depending on the thread's identity, which is rebuilt on every word
     of the room's own speech. */
  const itemsRef = useRef<RelItem[]>([]);
  itemsRef.current = items;
  const detailIdRef = useRef<string | null>(null);
  const liveKickerRef = useRef<string | undefined>(undefined);
  /** Where the line currently in flight came from, or null for a typed one. */
  const fedRef = useRef<string | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [answers, setAnswers] = useState<Answers>({});
  /** The order the answers were collected in, so the lane reads as a ledger. */
  const [order, setOrder] = useState<string[]>([]);
  const [awake, setAwake] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [phase, setPhase] = useState<"work" | "filed">("work");
  const [flow, setFlow] = useState<null | { staging: StagedRelPlan | null; running: boolean; status: number }>(null);
  const [filing, setFiling] = useState(false);
  /* THE IN-FLIGHT LOCK, CLOSED IN THE SAME TICK AS THE GESTURE (item 12).
     `filing` is state, and a second click inside the same commit reads what the
     first one saw. The ref cannot be raced that way. */
  const filingRef = useRef(false);
  /** The staging gesture, reachable from `say`, which is built above it. */
  const openFlowRef = useRef<() => Promise<void>>(async () => {});
  const [sealed, setSealed] = useState(false);
  const [draft, setDraft] = useState("");
  /** The composer input, so the plus menu can write into it and land the caret
   *  on the placeholder it left behind. */
  const composerRef = useRef<HTMLInputElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lit, setLit] = useState(false);
  /* THE ENTRY CHOREOGRAPHY, IN THIS ROOM'S VOCABULARY (founder, 2026-09-01).
     One grammar, both rooms: question, then the identity the action runs
     against, then the thing being decided on. Here the identity is the review's
     own scope brief and the detail is the first collected question, because
     that is what this room's tiers ARE. */
  const choreo = useEntryChoreography(reduced);
  const { arrive: tierArrived, retire: retireTiers } = choreo;
  /* THE SETTLE CHOREOGRAPHY, IN THIS ROOM TOO (founder, 2026-09-03). One
     grammar, both rooms: an answered step leaves the stage in the room's own
     exit and one compact row stands for it. */
  const settle = useSettleChoreography(reduced);
  /* THE FILED FINALE, THE SAME ONE (founder, 2026-09-03). One grammar with the
     facility room, down to the class names: the room exhales, the card ascends
     alone, and one quiet line sits under it. See components/workroom/finale.ts.

     THIS ROOM'S CARD CARRIES NO LINK. Its dossier has no `packageHref` - the
     review files against the relationship, not a package record - so the
     afterglow offers the one door there is rather than inventing a second. */
  const finale = useFinale(reduced);
  const { begin: beginFinale, exitOf: finaleExit, state: finaleState } = finale;
  const { settle: settleItems } = settle;
  const { peek, openPeek, closePeek } = usePeek();

  const roomRef = useRef<HTMLDivElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const routerRef = useRef(router);
  routerRef.current = router;
  /** The idempotency key this staging carries. A new key is minted only when
   *  the answers change under a staged plan, never on a second look. */
  const keyRef = useRef<string>(deps.newKey());
  const stagedAnswersRef = useRef<string | null>(null);

  /** Rule 44: the bar carries ONE word. An UNBOUND room has no review to name
   *  yet, and naming one would be a claim about a decision nobody has made. */
  const title = flowSpec ? flowSpec.word : "Relationship Actions";
  const laneHeading = flowSpec ? "This review" : "This relationship";

  /* ---- the page behind the room does not scroll while it is open. */
  useEffect(() => {
    document.body.classList.add("wk-open");
    return () => document.body.classList.remove("wk-open");
  }, []);

  useEffect(() => pushModal("relationship-room"), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isTopmost("relationship-room")) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  /* ---- THE RITUAL OPENS. The agent greets on the relationship, the lookup
          shimmers, and the room states its position. Under reduced motion the
          whole ritual is simply there. */
  const openingIdRef = useRef<string>("");
  useEffect(() => {
    const opening: RelItem[] = [
      { kind: "opening", id: nextId("open"), step: 0 },
      { kind: "lookup", id: nextId("lookup"), step: 0 },
    ];
    // The greeting's own id, so the ONE consent moment can land its remark
    // under the greeting the banker just opened the room for.
    openingIdRef.current = opening[0].id;
    setItems(opening);
    tierArrived("question");
    /* THE LOOKUP LANDS ON THE POSITION, and nothing else. The route's brief is
       pushed by the BIND effect below, which owns it whether the route was bound
       before the room opened or chosen inside it. Landing one here as well put
       two identical briefs in the thread on every already-bound open. */
    const land = () => {
      setItems((prev) => prev.filter((i) => i.kind !== "lookup"));
      setAwake(true);
    };
    if (reduced) {
      land();
      return;
    }
    const t = window.setTimeout(land, LOOKUP_MS);
    return () => clearTimeout(t);
  }, [reduced, tierArrived]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), reduced ? 200 : 2300);
    return () => clearTimeout(t);
  }, [toast, reduced]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, thinking, flow]);

  /* ---- derived. Nothing below is stored twice. */
  const live = useMemo(() => (route ? nextStep(route, ctx, answers) : null), [route, ctx, answers]);
  /* THE ROUTE CANNOT RUN AT ALL. Non-null where the review's own preconditions
     fail on the read the room is holding, and it is the reason there is no
     first question. A blocked route never reaches `ready`: offering "Review &
     file" over a refusal would be the room contradicting itself. */
  const routeBlock = useMemo(() => (route ? relRouteBlock(route, ctx) : null), [route, ctx]);
  /* WHICH PACKAGE THIS REVIEW RUNS IN. The covenant batch and the valuation are
     both anchored on one product package and both refuse a batch without one.
     Where the relationship stages several and none is chosen, the room ASKS -
     `NO_PACKAGE_ANCHOR` says the read stages none, which is false here. */
  const packagePending = useMemo(() => relPackagePending(route, ctx), [route, ctx]);
  const pendingRef = useRef(false);
  pendingRef.current = packagePending;
  const ready = !!route && !live && !routeBlock && !packagePending;
  const approvalOpen = phase === "work" && !thinking && ready;
  const laneRows = useMemo(
    () => (route ? laneRowsFor(route, ctx, answers, order) : []),
    [route, ctx, answers, order],
  );
  /* WHAT THE CARD CARRIES OUT OF THE DRAIN (founder, 2026-09-04). The lane is
     the review's ledger and the finale wipes it, so the card that survives
     lists the same answers, in the same order, with the org's own ids where
     the flow returned them. Built from `laneRows` itself: the lane and the card
     cannot describe different reviews. */
  const [filedIds, setFiledIds] = useState<Record<string, string>>({});
  const filedLines = useMemo<FiledLine[]>(
    () =>
      laneRows.map((row) => ({
        key: row.key,
        icon: row.icon,
        title: row.label,
        after: row.value,
        recordId: filedIds[row.key],
      })),
    [laneRows, filedIds],
  );
  const filedHead = `${laneRows.length} ${laneRows.length === 1 ? "answer" : "answers"}`;
  const planned = useMemo(() => (route ? plannedStepCount(route, ctx, answers) : 1), [route, ctx, answers]);
  const steps = stepperState({
    conversationOpen: awake,
    landed: order.length,
    composeTarget: planned,
    checksArrived: 0,
    checksAcked: 0,
    approvalOpen: approvalOpen || flow !== null,
    filed: phase === "filed",
  });

  /* ------------------------------------------------------------- the moves */

  const push = useCallback((item: NewRelItem) => {
    setItems((prev) => [...prev, { ...item, step: prev.length ? prev[prev.length - 1].step : 0 } as RelItem]);
  }, []);

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

  /* ---- THE BRIEF LANDS WHEN THE ROUTE BINDS, before the first question. A
          governance ritual states its scope before it asks anything. */
  const briefedRef = useRef<RelRoute | null>(null);
  /** The block, read by the brief effect without joining its deps: the brief
   *  lands once per route and must not re-land when the read is re-derived. */
  const blockRef = useRef<string | null>(null);
  blockRef.current = routeBlock;
  useEffect(() => {
    if (!route || !awake || briefedRef.current === route) return;
    briefedRef.current = route;
    setItems((prev) => {
      const mine = prev.length ? prev[prev.length - 1].step : 0;
      const landed: RelItem[] = [...prev, { kind: "brief", id: nextId("brief"), step: mine }];
      /* AND THE PACKAGE QUESTION, WHERE THIS REVIEW IS ANCHORED ON ONE AND THE
         RELATIONSHIP STAGES SEVERAL. It lands with the scope and before the
         first step, because every step below it is scoped to the package. */
      if (pendingRef.current) {
        landed.push({ kind: "pkgask", id: nextId("pkgask"), step: mine });
      }
      /* AND THE REFUSAL LANDS WITH IT, BEFORE THE FIRST QUESTION. The scope,
         then why this review cannot close anything today. Six questions and a
         tool call ahead of the same sentence is the worst moment in the room. */
      if (blockRef.current) {
        landed.push({ kind: "agent", id: nextId("block"), step: mine, text: blockRef.current });
      }
      return landed;
    });
    // THE IDENTITY TIER. The scope blends in and the question above it leaves
    // the stage: the banker is deciding on the review now, not on which one.
    tierArrived("identity");
  }, [awake, route, tierArrived]);

  /* ---- AND THE NEXT QUESTION FOLLOWS IT. The step machine decides; the room
          asks. One question at a time, numbered, and never re-asked. */
  const askedRef = useRef<string | null>(null);
  /** The third tier has been claimed, and the beat it is waiting on. */
  const detailedRef = useRef(false);
  const detailTimer = useRef(0);
  /** The one agent bubble that IS the third tier (the first question). */
  const [detailId, setDetailId] = useState<string | null>(null);
  detailIdRef.current = detailId;
  useEffect(() => () => window.clearTimeout(detailTimer.current), []);
  useEffect(() => {
    if (!route || !awake || !live || thinking || phase === "filed") return;
    // NOTHING IS ASKED UNDER AN UNANSWERED PACKAGE QUESTION: every step is
    // scoped to the package and none is chosen yet.
    if (packagePending) return;
    if (askedRef.current === live.key) return;
    askedRef.current = live.key;
    const kicker = `Step ${order.length + 1} of ${planned}`;
    // The number the row will carry once this question is answered.
    liveKickerRef.current = kicker;
    const push1 = (id: string) =>
      setItems((prev) => {
        const mine = prev.length ? prev[prev.length - 1].step : 0;
        return [
          ...prev,
          {
            kind: "agent",
            id,
            step: mine,
            text: live.ask,
            kicker,
            options: optionsFor(live),
          },
        ];
      });
    /* THE DETAIL TIER, ONE BEAT LATER (the entry choreography). The FIRST
       question is the third tier and it gets its own arrival, so the scope
       above it is read before it retires. Every question after it opens a step
       of its own and is an exchange, not a tier: it lands immediately.

       THE BEAT IS HELD IN A REF, NOT IN A CLEANUP. This effect re-runs on every
       answer; a cleanup that cleared the timer would swallow the first question
       whenever anything moved underneath it. */
    if (detailedRef.current) {
      push1(nextId("step"));
      return;
    }
    detailedRef.current = true;
    const id = nextId("step");
    const land = () => {
      push1(id);
      setDetailId(id);
      tierArrived("detail");
    };
    if (reduced) {
      land();
      return;
    }
    detailTimer.current = window.setTimeout(land, TIER_STAGGER_MS);
  }, [awake, live, order.length, packagePending, phase, planned, reduced, route, thinking, tierArrived]);

  /* ---- the review chip's own beat: once the last step is answered the room
          says so rather than leaving the banker to notice the chip. */
  const readyRef = useRef(false);
  useEffect(() => {
    if (!ready || readyRef.current || phase === "filed" || !flowSpec || routeBlock) return;
    readyRef.current = true;
    setItems((prev) => {
      const mine = prev.length ? prev[prev.length - 1].step : 0;
      return [
        ...prev,
        {
          kind: "agent",
          id: nextId("ready"),
          step: mine,
          text: relReadyLine(flowSpec.route, ctx, answers),
        },
      ];
    });
  }, [answers, ctx, flowSpec, phase, ready, routeBlock]);

  /**
   * THE STEP THAT WAS JUST ANSWERED, OFF THE STAGE, UNDER ONE ROW.
   *
   * The exchange is everything in the step the room was standing on: the
   * question with its number, its chips, and whatever the banker said to it.
   * The ROW lands in the NEW step, so it stays on the glass while the step that
   * produced it collapses behind the history chip as it always has.
   */
  const settleStep = useCallback(
    (row: SettledRow, at: number): boolean => {
      const prev = itemsRef.current;
      if (!prev.length) return false;
      const mine = prev[prev.length - 1].step;
      const covers: string[] = [];
      for (let i = prev.length - 1; i >= 0; i--) {
        const it = prev[i];
        if (it.step !== mine || it.kind === "settled") break;
        // A TIER IS NOT PART OF THE EXCHANGE. The first question is the third
        // entry tier and has its own choreography and its own summon; settling
        // it here would give one node two owners. The walk steps past it.
        if (relTierOf(it, detailIdRef.current)) continue;
        covers.unshift(it.id);
      }
      /* THE ROW LANDS EVEN WHERE IT COVERS NOTHING. The first question is a
         tier, so the step that answers it has no exchange of its own to retire
         - and a ritual that produced a receipt for every step but the first
         would leave the banker wondering what happened to step one. */
      const rowId = nextId("settled");
      if (covers.length) settleItems(covers, rowId);
      setItems((p) => [...p, { kind: "settled", id: rowId, step: at, row, covers }]);
      return true;
    },
    [settleItems],
  );

  /** RECORD AN ANSWER. Every answer starts a STEP (rule 31): the banker line
   *  lands, the steps before it collapse, and the machine asks the next one. */
  const record = useCallback(
    (key: string, value: unknown, said: string) => {
      const mine = step + 1;
      setStep(mine);
      setHistOpen(false);
      setFlow(null);
      /* THE ANSWERED STEP SETTLES INTO ONE ROW (founder, 2026-09-03). "Step 3 of
         6", what the banker answered, and the way back to the question. The
         review's own numbering travels on the row: a banker three questions
         into a six-question ritual should not have to count rows to know it. */
      /* THE ROW IS THE RECEIPT, so the banker's echo under it would be the
         answer printed twice, eight pixels apart. It is dropped where a row
         landed and kept where none did (a room with no thread yet). */
      const receipted = settleStep(rowForStep(liveKickerRef.current, said), mine);
      if (!receipted) setItems((prev) => [...prev, { kind: "banker", id: nextId("banker"), step: mine, text: said }]);
      setAnswers((prev) => {
        const next = { ...prev };
        assign(next, key, value);
        return next;
      });
      setOrder((prev) => (prev.includes(key) ? prev : [...prev, key]));
    },
    [settleStep, step],
  );

  /** UN-ANSWER. A governance ledger is not a manifest of writes, so a row comes
   *  off by being asked again rather than by being deleted: dropping it sends
   *  the machine straight back to that step. */
  const drop = useCallback(
    (key: string) => {
      setAnswers((prev) => {
        const next = { ...prev };
        const dot = key.indexOf(".");
        if (dot === -1) delete next[key];
        else {
          const group = key.slice(0, dot);
          const held = next[group];
          if (held && typeof held === "object" && !Array.isArray(held)) {
            const copy = { ...(held as Record<string, unknown>) };
            delete copy[key.slice(dot + 1)];
            next[group] = copy;
          }
        }
        return next;
      });
      setOrder((prev) => prev.filter((k) => k !== key));
      askedRef.current = null;
      readyRef.current = false;
      setFlow(null);
      setToast("Taken back off the review");
    },
    [],
  );

  const answerLive = useCallback(
    async (raw: string, said?: string) => {
      if (!live) return;
      const text = raw.trim();
      const shown = (said ?? raw).trim();
      const started = Date.now();
      setThinking(true);
      try {
        await beat(started);
        /* THE SKIP IS READ BEFORE THE KIND, and it has to be. An OPTIONAL MULTI
           step offers the skip chip like every other optional step, and the
           multi branch below matched it against the options first: "Not
           assessed" named no option, so the room re-asked a question the banker
           had just answered. The first optional multi step in this room is the
           annual review's section chip set, which is where it surfaced. */
        if (text === SKIP_LABEL || text.toLowerCase() === "skip") {
          if (!live.optional) {
            setThinking(false);
            unreadable(live);
            return;
          }
          record(live.key, live.kind === "multi" ? [] : SKIPPED, SKIP_LABEL);
          return;
        }
        if (live.kind === "multi") {
          // A MULTI STEP TAKES A SET. A chip contributes one id; a typed line
          // is matched against the options by name, and a line that matches
          // nothing is answered with the question again rather than with a
          // selection nobody made.
          const matched = matchOptions(live, text);
          if (!matched.length) {
            setThinking(false);
            unreadable(live);
            return;
          }
          record(live.key, matched, shown);
          return;
        }
        if (live.kind === "number") {
          const n = Number(text.replace(/[$,\s]/g, ""));
          if (!Number.isFinite(n)) {
            setThinking(false);
            unreadable(live);
            return;
          }
          /* A FIGURE OFF A REAL SCALE IS REFUSED BY NAME, not re-asked as
             unreadable. The room read it perfectly well; the org cannot hold
             it. The refusal states the scale, so the banker knows what to say
             next, and the question stays live. */
          if (live.bounds && !onScale(n, live.bounds)) {
            setThinking(false);
            offScale(live);
            return;
          }
          record(live.key, n, shown);
          return;
        }
        if (live.options?.length) {
          const hit = live.options.find((o) => o.value.toLowerCase() === text.toLowerCase());
          if (!hit && live.kind === "chips") {
            setThinking(false);
            unreadable(live);
            return;
          }
          record(live.key, hit ? hit.value : text, shown);
          return;
        }
        record(live.key, text, shown);
      } finally {
        setThinking(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beat, live, record],
  );


  /** THE FIGURE IS OFF THE STEP'S SCALE. Refused with the scale in words, and
   *  the question left standing. */
  const offScale = useCallback(
    (target: RelStep) => {
      setItems((prev) => {
        const mine = prev.length ? prev[prev.length - 1].step : 0;
        return [
          ...prev,
          { kind: "agent", id: nextId("scale"), step: mine, text: target.bounds!.refusal, options: optionsFor(target) },
        ];
      });
    },
    [],
  );

  /** THE ROOM COULD NOT READ THAT. It re-asks with the legal answers rather
   *  than guessing, because guessing here writes a governance record. */
  const unreadable = useCallback(
    (target: RelStep) => {
      setItems((prev) => {
        const mine = prev.length ? prev[prev.length - 1].step : 0;
        return [
          ...prev,
          {
            kind: "agent",
            id: nextId("again"),
            step: mine,
            text: target.options?.length
              ? "I could not read that as one of the values above. Pick one, or say it exactly as it reads."
              : target.kind === "number"
                ? "I need a figure for that one. A number, or skip it."
                : "I could not read that. Say it again.",
            options: optionsFor(target),
          },
        ];
      });
    },
    [],
  );

  /* ==================================================== THE SECOND LANE, HERE

     THE SAME DISPATCH AS THE FACILITY ROOM, in this room's vocabulary. The
     founder's quick test said this room reads "equally mechanical", and it read
     that way for the same reason: every line went to the step machine, so a
     question became an answer and an unreadable line became a re-ask.

     Reads are answered LOCALLY and first. A line the live step can genuinely
     read is still the step's, straight through, so the ritual keeps its pace.
     Everything else goes to the desk with this route's FILEABLE MAP in the
     envelope, so a refusal comes back by name rather than as invented
     capability. And with no bridge, none of this happens at all.             */

  /** The read a question is answered from. The room's own context, handed to
   *  the shared builder so both rooms answer a read the same way. */
  const reads = useMemo<ReadSource>(
    () => ({
      bundle: ctx.bundle,
      accountName: ctx.accountName,
      productPackageId: ctx.productPackageId,
      generatedAt: ctx.asOf ?? undefined,
    }),
    [ctx.accountName, ctx.asOf, ctx.bundle, ctx.productPackageId],
  );

  /** The conversation so far, for the envelope. */
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

  /** THE BOOK, PACKAGED, for whichever lane is asking. One builder, so a remark
   *  under a card stands on exactly the envelope a reply would have stood on. */
  const envelopeFor = useCallback(
    (line: string): BrainEnvelope =>
      buildRelEnvelope({
        line,
        route,
        ctx,
        reads,
        mail,
        book,
        thread: conversation(),
        collected: laneRows.map((r) => ({
          title: r.label,
          target: route ? REL_ROUTE_WORD[route] : "this relationship",
          after: r.value,
        })),
      }),
    [book, conversation, ctx, laneRows, mail, reads, route],
  );

  const askTheDesk = useCallback(
    async (line: string): Promise<BrainReply | null> => {
      if (!brain) return null;
      try {
        return await brain(envelopeFor(line));
      } catch {
        // The lane never throws into the room: a transport that failed past
        // `askBrain`'s own guard degrades exactly as a malformed reply does.
        return null;
      }
    },
    [brain, envelopeFor],
  );

  /* THE PARSER STAGES, THE MODEL SPEAKS. The same rule as the facility room and
     the same single effect: every path in this room ends by appending an item,
     so the remark rides the item rather than each engine. Inert where the
     session door is absent, so channel-none renders exactly today's sentences. */
  const narration = useNarration({ enabled: Boolean(brain), envelopeFor });
  const narrated = useRef(new Set<string>());

  /* THE ONE CONSENT MOMENT, IN THIS ROOM TOO (SAMPLE-CHANNEL spec: consent
     rides the greeting).

     The platform asks the viewer to allow this artifact to use their Claude on
     the FIRST call of a view, and the call waits while they decide. This room
     never made that call from its greeting, so the dialog landed on whatever
     line happened to narrate first, MID-REVIEW. The first call is now the one
     the banker asked for by opening the room.

     ONCE, AND AFTER BOTH GATES. `narration.open` is latched per item id, so a
     second call was already inert; what was NOT inert is the mail ref below,
     which a later pass would overwrite with a note that arrived after the
     greeting had gone. `primeConsent` memoises the PROMISE and ignores every
     later caller's prompt, so a greeting that wants the mail must wait BEFORE
     the first call rather than recompose after it. */
  const greetedWithMail = useRef(false);
  const greeted = useRef(false);
  useEffect(() => {
    if (!brain || !awake || !openingIdRef.current || greeted.current) return;
    if (!mailGate) return;
    const said = `${brief.greeting} ${ask ? ask.line : brief.position}`.trim();
    if (!said) return;
    greetedWithMail.current = Boolean(mail);
    greeted.current = true;
    narration.open(openingIdRef.current, { act: "greeting", sentence: said });
  }, [ask, awake, brain, brief.greeting, brief.position, mail, mailGate, narration]);

  /* MAIL THAT MISSED THE GATE IS A SECOND REMARK, NEVER A REWRITTEN GREETING.
     The greeting is already on the glass and it is the one call that carried
     consent; taking it back would be the room changing its mind in front of the
     banker. `narrate`, not `prime`: no second dialog and no second connector
     call. A declined view deletes the greeting's own view, which silences this
     too. */
  const followedUp = useRef(false);
  useEffect(() => {
    if (!brain || !mail || followedUp.current) return;
    if (!greeted.current || greetedWithMail.current) return;
    const opening = narration.viewFor(openingIdRef.current);
    if (!opening || opening.pending) return;
    followedUp.current = true;
    const who = mail.from ?? "the client";
    const when = mail.received ? ` on ${mail.received}` : "";
    narration.narrate(`${openingIdRef.current}::mail`, {
      act: "mail",
      sentence: `A message from ${who}${when} is open on this relationship.`,
    });
  }, [brain, mail, narration]);

  useEffect(() => {
    const last = items[items.length - 1];
    if (!last || narrated.current.has(last.id)) return;
    narrated.current.add(last.id);
    const prior = items[items.length - 2];
    const said = prior && prior.kind === "agent" ? prior.text : undefined;
    const subject = subjectFor(last as unknown as Parameters<typeof subjectFor>[0], said);
    if (!subject) return;
    const asked = [...items].reverse().find((i) => i.kind === "banker");
    narration.narrate(last.id, subject, asked && asked.kind === "banker" ? asked.text : "");
  }, [items, narration]);

  /**
   * WHAT THE DESK SAID, DRAWN.
   *
   * `degrade` is what the room would have done without the lane. Every failure
   * runs it, so a bad round trip leaves the banker exactly where the
   * deterministic room would have, never worse.
   */
  const landRelReply = useCallback(
    async (
      reply: BrainReply | null,
      line: string,
      mine: number,
      opts: { degrade: () => void; routeOpen?: boolean },
    ) => {
      const answer = (item: NewRelItem) => setItems((prev) => [...prev, { ...item, step: mine } as RelItem]);
      if (!reply || isDegrade(reply)) {
        opts.degrade();
        return;
      }
      /* THE ROUTE, RESOLVED FROM INTENT. Binding still runs through the room's
         own router, so a named review can do nothing a chip could not. An
         ambiguous reply names none, and the five-way stands. */
      if (opts.routeOpen && router && reply.route && REL_ROUTE_WORDS.has(reply.route)) {
        setAsk(null);
        router.onBind(reply.route as RelRoute, { say: line });
        return;
      }
      if (reply.type === "read-card") {
        answer({ kind: "read", id: nextId("read"), card: toReadCardModel(reply) });
        return;
      }
      if (reply.type === "clarify") {
        answer({ kind: "agent", id: nextId("agent"), text: reply.text, options: reply.options });
        return;
      }
      /* A CHANGE TO A FACILITY IS NOT THIS ROOM'S WORK, whoever proposed it.
         The desk gets the same answer a banker does, in one line. */
      answer({ kind: "agent", id: nextId("agent"), text: `${reply.rationale} ${FACILITY_HANDOFF}` });
    },
    [router],
  );

  const runRelBrain = useCallback(
    async (line: string, mine: number, opts: { degrade: () => void; routeOpen?: boolean }) => {
      const started = Date.now();
      setThinking(true);
      let reply: BrainReply | null = null;
      try {
        reply = await askTheDesk(line);
        await beat(started);
      } finally {
        setThinking(false);
      }
      await landRelReply(reply, line, mine, opts);
    },
    [askTheDesk, beat, landRelReply],
  );

  /**
   * The banker said something.
   *
   * FREE TEXT BINDS. While the route is open the line picks the review; once a
   * route is bound the line answers the live step, unless it names a different
   * review, asks for facility work, or asks for a create this room cannot file.
   */
  const say = useCallback(
    async (heard: string, said?: string, opts?: { fed?: string }) => {
      const text = heard.trim();
      if (!text || !awake) return;
      /* WHERE THIS LINE CAME FROM, for the one commit that renders it. The feed
         is serial by construction, so there is exactly one line in flight. */
      fedRef.current = opts?.fed ?? null;

      /* ============ THE FAULT-STATE CHIPS ANSWER HERE, BEFORE THE GRAMMAR

         Two lines the ROOM put in the banker's mouth after a deadline. They are
         gestures, not instructions, and the review grammar would read them as
         neither: "try that again" is not one of the six, and answering it with
         the five-way would be the room forgetting what it just offered. */
      if (text.toLowerCase() === TRY_AGAIN.say) {
        const mine = step + 1;
        setStep(mine);
        setItems((prev) => [...prev, relBankerLine(mine, (said ?? heard).trim(), opts?.fed)]);
        if (!route) {
          push({ kind: "agent", id: nextId("agent"), text: "There is nothing staged to put up again. Pick a review above and I will collect what it needs." });
          return;
        }
        void openFlowRef.current();
        return;
      }
      if (text.toLowerCase() === KEEP_THE_PLAN.say) {
        const mine = step + 1;
        setStep(mine);
        setItems((prev) => [...prev, relBankerLine(mine, (said ?? heard).trim(), opts?.fed)]);
        push({
          kind: "agent",
          id: nextId("agent"),
          text:
            "What you have collected stands exactly as it is. Nothing has been sent to the org and nothing has been filed. " +
            "Put it up whenever you are ready.",
        });
        return;
      }

      /* A READ DOES NOT PICK A REVIEW (F1). The route gate used to intercept
         every line, so a question about the book was answered with the five-way
         rather than with the card the room was already holding. */
      if (ask && router) {
        const preTopic = readTopic(text);
        const preRelTopic = preTopic === null ? readRelTopic(text) : null;
        const preCard =
          preTopic !== null
            ? buildReadCard(preTopic, reads, { role: readRole(text) ?? undefined })
            : preRelTopic
              ? buildRelReadCard(preRelTopic, ctx)
              : null;
        /* A READ DOES NOT PICK A REVIEW, and that holds for this room's own
           three as well: "what is the risk rating" is a question about the
           book, not a request to open the rating review. */
        if (!preCard && !preRelTopic) {
          const picked = readRelRouteIntent(text);
          if (picked) {
            setAsk(null);
            router.onBind(picked, { say: text });
            return;
          }
        }
        const mine = step + 1;
        const five =
          "I can run the annual review, the covenant review, a collateral valuation, the risk-rating review or a service request, and I can put a new covenant or a new asset onto the relationship. Pick one above, or name which of the six this is.";
        setStep(mine);
        setItems((prev) => [...prev, relBankerLine(mine, (said ?? heard).trim(), opts?.fed)]);
        /* FACILITY WORK IS FACILITY WORK BEFORE A ROUTE IS BOUND TOO.

           The handoff lived ONLY in the bound branch, past `if (!route) return`,
           so "pledge the equipment to the 8M loan" typed at the five-way fell
           through to "I can run the annual review, the covenant review, ..." and
           listed four reviews at a banker who had just asked for none of them.
           Caught by the relationship drive on 2026-09-02, line 15, which is
           where the addendum expects the one-line handoff. The room now says
           the same sentence wherever the line arrives. */
        if (!preCard && !preRelTopic && asksForFacilityWork(text)) {
          setItems((prev) => [...prev, { kind: "agent", id: nextId("agent"), step: mine, text: FACILITY_HANDOFF }]);
          return;
        }
        /* A FIELD EXAM IS NOT ONE OF THE FIVE, AND SAYING SO BEATS THE MENU.
           No route word matches "field exam", "collateral audit" or "inventory
           count", so all of them fell to the five-way. One sentence and the two
           chips that actually apply; the service chip carries the banker's own
           line through as the case subject, exactly as the client request one
           does. The covenant chip is disabled with the book's own reason where
           this relationship carries no compliance row to assess. */
        if (!preCard && !preRelTopic && asksForFieldExam(text)) {
          setAsk({
            line: FIELD_EXAM_OFFER,
            chips: [
              { label: STAGE_A_FIELD_EXAM, route: "service", say: text },
              {
                label: COVENANT_REVIEW,
                route: "covenant",
                disabled: book.noComplianceRows,
                reason: book.noComplianceRows ? NO_COMPLIANCE_ROW_CHIP : undefined,
              },
            ],
          });
          return;
        }
        /* THE CLIENT ASKED FOR SOMETHING, AND NAMED NO REVIEW. One line and one
           chip, rather than the five-way read back at a banker who is plainly
           running none of the four reviews. It does not bind: the chip does,
           and it binds WITH the banker's own line, which the service route's
           first step takes as the case subject. */
        if (!preCard && !preRelTopic && readsAsClientRequest(text)) {
          setAsk({
            line: CLIENT_REQUEST_OFFER,
            chips: [
              { label: RAISE_A_SERVICE_REQUEST, route: "service", say: text },
              { label: SOMETHING_ELSE, route: null },
            ],
          });
          return;
        }
        if (preCard) {
          setItems((prev) => [...prev, { kind: "read", id: nextId("read"), step: mine, card: preCard }]);
          return;
        }
        if (preRelTopic) {
          setItems((prev) => [
            ...prev,
            { kind: "agent", id: nextId("agent"), step: mine, text: relReadGap(preRelTopic, ctx) },
          ]);
          return;
        }
        if (brain) {
          await runRelBrain(text, mine, {
            routeOpen: true,
            degrade: () => setItems((prev) => [...prev, { kind: "agent", id: nextId("agent"), step: mine, text: five }]),
          });
          return;
        }
        setItems((prev) => [...prev, { kind: "agent", id: nextId("agent"), step: mine, text: five }]);
        return;
      }
      if (!route) return;

      const mine = step + 1;
      const answer = (item: NewRelItem) => {
        setStep(mine);
        setHistOpen(false);
        setItems((prev) => [
          ...prev,
          relBankerLine(mine, (said ?? heard).trim(), opts?.fed),
          { ...item, step: mine } as RelItem,
        ]);
      };

      /* READS ARE LOCAL, AND THEY ARE FIRST (F1). A topic the bundle answers is
         answered from the bundle, before anything else in this room can act on
         the line. It binds nothing, switches nothing and advances nothing:
         asking what is on the book is not choosing what to do about it, and the
         route-switch reader would otherwise have read "which covenants are on
         this relationship" as a request to change review. */
      /* A QUESTION ABOUT GUARANTORS IS NARROWED HERE TOO. This room stands on
         the relationship rather than on a package, so it names no facility, but
         the ROLE it asks about is in the words either way. */
      const topic = readTopic(text);
      const card = topic !== null ? buildReadCard(topic, reads, { role: readRole(text) ?? undefined }) : null;
      if (card) {
        answer({ kind: "read", id: nextId("read"), card });
        return;
      }

      /* AND THIS ROOM'S OWN THREE, AFTER the shared five have declined the
         line. "what is the risk rating", "when was the last review" and "what
         has the client asked for" fall through every one of the facility
         room's topics and used to reach the desk. The shared reader is
         untouched by design: widening it would answer a FACILITY question that
         reaches the desk today with a card, and that room is the demo. */
      const relTopic = topic === null ? readRelTopic(text) : null;
      if (relTopic) {
        const relCard = buildRelReadCard(relTopic, ctx);
        answer(
          relCard
            ? { kind: "read", id: nextId("read"), card: relCard }
            : { kind: "agent", id: nextId("agent"), text: relReadGap(relTopic, ctx) },
        );
        return;
      }

      /* FACILITY WORK LIVES NEXT DOOR, and the room says so in one line rather
         than routing a pledge into the nearest review. */
      if (asksForFacilityWork(text)) {
        answer({ kind: "agent", id: nextId("agent"), text: FACILITY_HANDOFF });
        return;
      }

      /* A CREATE THIS ROOM CANNOT FILE. It is composed, stated, and the org-side
         gap is named. Nothing unbacked is ever sent. */
      const create = readCreateAsk(text, route);
      if (create) {
        setStep(mine);
        setHistOpen(false);
        setItems((prev) => [
          ...prev,
          relBankerLine(mine, (said ?? heard).trim(), opts?.fed),
          { kind: "gap", id: nextId("gap"), step: mine, gap: CREATE_GAPS[create] },
        ]);
        return;
      }

      /* A REGULATORY CLASSIFICATION IS NOT A GRADE IN THIS ORG. Special
         Mention, Substandard, Doubtful and Loss are the interagency categories
         and this org's rating scale is numeric, so the room refuses to write
         one into a number and then says which scale it IS filing on.

         THE OVERRIDE IS NO LONGER REFUSED HERE. It is on the wire and the
         rating route collects it, with the org's own mandatory reason. */
      if (asksForClassification(text, route)) {
        answer({ kind: "agent", id: nextId("agent"), text: `${NOT_A_CLASSIFICATION} ${NAME_THE_SURFACE}` });
        return;
      }

      /* ROUTE BINDING IS FINAL PER PLAN. On an empty ledger nothing has been
         collected against this review, so the room is simply rebuilt on the
         other one. Once anything is collected the room refuses out loud and
         offers the discard as the explicit gesture it is. */
      /* THE OPEN TEXT STEP GETS ITS ANSWER. A route word inside a subject or a
         narrative is not a request to change review; see readRelRouteSwitch. */
      /* AND SO DOES THE STEP WHOSE OWN CHIP THE BANKER JUST NAMED.

         THE DRIVE CAUGHT THIS ON THE INTAKE. "Appraisal" is one of the fourteen
         values `LLC_BI__Source__c` holds, and it is also the word the valuation
         route's own reader looks for, so answering "where did the figure come
         from" with the org's own value offered on the glass re-routed the room
         to a collateral valuation. The same trap sits under "Real Estate
         Evaluation" and under any picklist value a route word appears in.

         A LINE THAT IS EXACTLY ONE OF THE LIVE STEP'S OWN OPTIONS BELONGS TO
         THAT STEP. It is not a request for anything: it is the answer the room
         put on the glass and the banker took. This narrows the switch reader
         rather than widening it, and it can only ever fire where the room itself
         offered the words. */
      const onTheGlass = (live?.options ?? []).some(
        (o) => !o.disabled && (o.value.toLowerCase() === text.toLowerCase() || o.label.toLowerCase() === text.toLowerCase()),
      );
      const switchTo =
        router && !onTheGlass ? readRelRouteSwitch(text, route, { openTextStep: live?.kind === "text" }) : null;
      if (switchTo && router) {
        if (!order.length) {
          router.onRestart(switchTo, text);
          return;
        }
        answer({
          kind: "agent",
          id: nextId("agent"),
          text: `${order.length} ${order.length === 1 ? "answer is" : "answers are"} collected on this ${
            REL_ROUTE_WORD[route]
          }, so the room is held to it. Starting a ${REL_ROUTE_WORD[switchTo]} means discarding them and opening a fresh room.`,
          restart: {
            route: switchTo,
            label: `Discard and start the ${REL_ROUTE_WORD[switchTo]}`,
            say: text,
          },
        });
        return;
      }

      /* A QUESTION IS NOT AN ANSWER TO A STEP. Without a bridge the line still
         reaches the step machine exactly as it did before this lane existed,
         which is the channel-none contract. */
      if (isQuestion(text) && brain) {
        setStep(mine);
        setHistOpen(false);
        setItems((prev) => [...prev, relBankerLine(mine, (said ?? heard).trim(), opts?.fed)]);
        await runRelBrain(text, mine, {
          degrade: () =>
            setItems((prev) => [
              ...prev,
              {
                kind: "agent",
                id: nextId("agent"),
                step: mine,
                text: topic !== null ? readGap(topic, ctx.accountName) : UNREADABLE_CLARIFY.text,
              },
            ]),
        });
        return;
      }

      if (!live) {
        /* A BLOCKED ROUTE HAS NO LIVE STEP AND NOTHING COLLECTED, and telling
           the banker "everything is collected, the review chip carries the next
           move" over a refusal with no chip under it is the room contradicting
           itself twice in one line. Caught by the headless drive, line 4. */
        answer({
          kind: "agent",
          id: nextId("agent"),
          text:
            routeBlock ??
            `Everything the ${REL_ROUTE_WORD[route]} needs is collected. The review chip below carries the next move.`,
        });
        return;
      }

      /* THE FAST LANE: a line the live step can genuinely read is recorded as
         its answer, straight through, exactly as it always was. A line it
         cannot read used to be met with a re-ask; it now goes to the desk, and
         the re-ask is what a bad round trip degrades to. */
      if (!brain || stepAccepts(live, text)) {
        await answerLive(text, said);
        return;
      }
      setStep(mine);
      setHistOpen(false);
      setItems((prev) => [...prev, relBankerLine(mine, (said ?? heard).trim(), opts?.fed)]);
      await runRelBrain(text, mine, { degrade: () => unreadable(live) });
    },
    [answerLive, ask, awake, book, brain, ctx, live, order.length, reads, route, routeBlock, router, runRelBrain, step, unreadable],
  );

  /** THE QUESTION IS ANSWERED BY A CHIP. "Something else" answers nothing: it
   *  falls through to the neutral five-way, which is the whole point of
   *  offering a suggestion rather than assuming one. */
  const chooseRoute = useCallback(
    (chip: RelRouteChoice) => {
      if (!router || chip.disabled) return;
      if (!chip.route) {
        setAsk(router.neutral());
        return;
      }
      setAsk(null);
      router.onBind(chip.route, { covenantId: chip.covenantId ?? null, say: chip.say });
    },
    [router],
  );

  /* ---- THE LINE THAT BOUND THE ROUTE IS STILL AN INSTRUCTION. It is said once
          the bound room is awake, exactly as if the banker had typed it here. */
  const saidRef = useRef<string | null>(null);
  useEffect(() => {
    const line = router?.say ?? null;
    if (!awake || ask || !line || saidRef.current === line) return;
    saidRef.current = line;
    /* A LINE THAT NAMED THIS REVIEW IS NOT AN INSTRUCTION ON TOP OF THE
       BINDING, and replaying it as one is worse than dropping it.

       THE DRIVE CAUGHT THIS FILING A CASE. "raise a service request" bound the
       route and was then replayed into the bound room, where the first step is
       FREE TEXT, so it was recorded silently as the answer: the case Subject
       read "raise a service request". On the annual and rating routes the same
       replay lands on a chip or a number step and produces a re-ask the banker
       has to read past. Neither is the banker saying anything the router has
       not already acted on.

       A line that names the route AND asks for something else still runs: only
       the bare naming is dropped.

       THE INTAKE IS THE EXCEPTION, AND IT IS NOT A SPECIAL CASE SO MUCH AS THE
       SAME RULE READ PROPERLY. On the five reviews, naming the route and saying
       what to do are two different sentences, so the naming carries nothing the
       binder has not acted on. On the intake they are ONE sentence: "add a
       relationship covenant: minimum liquidity of 5M tested quarterly" names the
       route in its first three words and answers the first four questions in the
       rest, and dropping it would throw the whole instruction away and ask a
       banker who has just said everything to say it again. Its first step takes
       the line as what it is. */
    if (
      route &&
      route !== "intake" &&
      readRelRouteIntent(line) === route &&
      !readCreateAsk(line, route) &&
      !isQuestion(line)
    ) {
      return;
    }
    void say(line);
  }, [ask, awake, route, router?.say, say]);

  /* ================================================= AN INTENT'S OWN LINES

     The mirror of the facility room's feed. This room is a step machine, so a
     fed line answers whatever step is live exactly as a typed one does, and the
     queue holds while the room is composing, while a flow card is open and once
     the review is filed. Nothing is staged on the banker's behalf: the review
     card and its token are where they have always been. */
  const feedReady = awake && !ask && phase === "work" && !thinking && !filing && flow === null;
  /* A FED LINE IS NOT A BANKER BUBBLE (founder, 2026-09-03). It renders as one
     marker naming where it came from; it still travels through the SAME `say`,
     the same steps and the same refusals. */
  const feedFrom = useMemo(() => {
    const intent = intentFor(ctx.accountId);
    return intent ? `From ${sourcePhrase(intent.context.source)}` : null;
  }, [ctx.accountId]);
  const sayFed = useCallback((line: string) => say(line, undefined, { fed: feedFrom ?? undefined }), [feedFrom, say]);
  const feed = useRoomFeed({ room: "relationship", accountId: ctx.accountId, ready: feedReady, say: sayFed });

  /* ============ THE SCOPE LEAVES WHEN THE FIRST STEP SETTLES (founder, 2026-09-03)

     The tiers retire each other in order, so the third one - the first
     collected question - had nothing above it to push it off and stood under
     every later step. The first ANSWER earns its exit: from there the banker is
     working the ritual, and the greeting, the scope and the first question are
     all one summon away in the control that already says so. */
  const answered = order.length > 0;
  useEffect(() => {
    if (answered) retireTiers();
  }, [answered, retireTiers]);

  /* ---- THE SIGNAL'S COVENANT IS PRESELECTED. Where the opening named one, the
          covenant review opens with it already on the list rather than making
          the banker find it again. */
  const preselectedRef = useRef(false);
  useEffect(() => {
    const id = router?.preselectCovenantId;
    if (!id || !awake || route !== "covenant" || preselectedRef.current) return;
    if (!reviewableCovenants(ctx).some((c) => c.covenantId === id)) return;
    preselectedRef.current = true;
    setAnswers((prev) => ({ ...prev, covenants: [id] }));
    setOrder((prev) => (prev.includes("covenants") ? prev : [...prev, "covenants"]));
  }, [awake, ctx, route, router?.preselectCovenantId]);

  /* --------------------------------------------------------- the commit path

     THE FLOW CARD POPS OPEN IN THE THREAD (rule 38). Opening it STAGES: staging
     is zero-DML by contract, and it is the only way the card can show the org's
     real decision token rather than a decoration shaped like one. */

  const openFlow = useCallback(async () => {
    if (!route) return;
    // A REBUILD IS A NEW INTENT. Answers that changed under a staged plan change
    // the plan and its hash, and reusing the key would invite the org to replay
    // the old staging row.
    const signature = JSON.stringify(answers);
    if (stagedAnswersRef.current !== null && stagedAnswersRef.current !== signature) keyRef.current = deps.newKey();
    stagedAnswersRef.current = signature;

    setFlow({ staging: null, running: false, status: 0 });
    try {
      /* THE STAGING CALL CARRIES A CLOCK (2026-09-05), the facility room's own
         budget and for the facility room's own reason: `callTool` has no wall
         clock, so a connector that accepts the call and never answers leaves
         the flow card open on a plan that will never arrive. */
      const staged = await byDeadline(
        stageRelPlan(route, ctx, answers, keyRef.current, deps),
        "stage",
        `staging this ${REL_ROUTE_WORD[route]}`,
      );
      setFlow((f) => (f ? { ...f, staging: staged } : f));
    } catch (e) {
      setFlow(null);
      /* THE ROOM'S CLOCK, NOT THE ORG'S ANSWER. Staging is zero-DML by
         contract, so nothing was filed and the room may say so. */
      if (isDeadline(e)) {
        push({
          kind: "agent",
          id: nextId("agent"),
          text: stageDeadlineLine(e, `staging this ${REL_ROUTE_WORD[route]}`),
          options: [TRY_AGAIN, KEEP_THE_PLAN],
        });
        return;
      }
      if (neverReachedTheOrg(e)) {
        push({
          kind: "notice",
          room: "relationship",
          id: nextId("notice"),
          title: "This view is not connected to the bank's systems.",
          body: NO_CONNECTOR,
        });
        return;
      }
      // A REFUSAL CARRYING THE ORG'S LEGAL LIST IS RE-OFFERED AS CHIPS. The
      // banker guessed once; they should not have to guess twice.
      const legal = e instanceof RelFlowError ? e.legalValues : undefined;
      push({
        kind: "agent",
        id: nextId("agent"),
        text: readableError(e),
        options: legal?.length ? legal.map((v) => ({ label: v, say: v })) : undefined,
      });
    }
  }, [answers, ctx, deps, push, route]);
  openFlowRef.current = openFlow;

  const execute = useCallback(async () => {
    const staging = flow?.staging;
    if (!route || !staging?.decisionToken || filing || filingRef.current || sealed) return;
    if (!ctx.approver) {
      push({
        kind: "agent",
        id: nextId("agent"),
        text: "This view has no Salesforce user id for the signed-in identity, and the org checks the approver against the running identity before it redeems the token. The plan is staged and holds.",
      });
      return;
    }
    filingRef.current = true;
    setFiling(true);
    setFlow((f) => (f ? { ...f, running: true } : f));
    /* ONE CALL, REPLAYABLE. The org answers a spent idempotency key off the
       staging record before any check runs, so asking again after a timeout
       files nothing and produces the executed result the first answer lost. */
    const stagingId = staging.stagingId;
    const planHash = staging.planHash;
    const decisionToken = staging.decisionToken;
    const approverUserId = ctx.approver;
    /* THE WRITE CARRIES A CLOCK, AND THE CLOCK IS NEVER A VERDICT. Past the
       budget the room stops waiting on the socket and reads the org's own
       staging record; it never re-executes on its own and never says failed. */
    const run = () =>
      byDeadline(
        executeRelPlan(route, { idempotencyKey: keyRef.current, stagingId, planHash, decisionToken, approverUserId }, deps),
        "execute",
        "the filing",
      );
    try {
      let result: Awaited<ReturnType<typeof executeRelPlan>>;
      try {
        result = await run();
      } catch (e) {
        /* THE CALL REACHED THE ORG AND THE ANSWER DID NOT COME BACK: a filing
           in progress, not a failure. Wait on the org's own trail, then ask the
           tool again under the same key. Never a second approval. */
        /* A DEADLINE IS AMBIGUOUS BY CONSTRUCTION, so it takes the same road a
           dispatched failure takes: the org's record decides, not the room. */
        if (!isDeadline(e) && !(e instanceof RelFlowError && e.dispatched)) throw e;
        push({ kind: "agent", id: nextId("agent"), text: isDeadline(e) ? executeDeadlineLine(e) : FILING_IN_FLIGHT });
        const verdict = await awaitFiling(ctx.accountId, stagingId, deps.settle ?? LIVE_SETTLE);
        setFlow((f) => (f ? { ...f, running: false } : f));
        if (verdict.kind === "never-ran") throw e;
        if (verdict.kind === "unsettled") {
          setSealed(true);
          push({ kind: "agent", id: nextId("agent"), text: STILL_WRITING });
          return;
        }
        if (verdict.status === "Failed") {
          setSealed(true);
          push({ kind: "agent", id: nextId("agent"), text: FILED_FAILED });
          return;
        }
        setFlow((f) => (f ? { ...f, running: true } : f));
        result = await run();
      }
      const dossier: DossierModel = {
        title: REL_FLOWS[route].word,
        rows: dossierRowsFor(route, ctx, answers, result),
        footer: dossierFooter(result),
        tokenNote: `Single-use decision token redeemed. ${REL_FLOWS[route].filedWord} against ${ctx.accountName}.`,
        handoff: dossierHandoff(route, result),
      };
      /* THE TRAIL, BEFORE THE TOAST THAT CLAIMS IT. The org's own result, its
         own ids and its own sentence; nothing here is composed from what the
         room hoped would happen. */
      onFiled?.({ actionId: REL_FLOWS[route].actionId, result });
      setFiledIds(laneOrgIds(route, laneRows, result));
      setPhase("filed");
      setFlow(null);
      setLit(true);
      setItems((prev) => {
        const mine = prev.length ? prev[prev.length - 1].step : 0;
        return [...prev, { kind: "dossier", room: "relationship", id: nextId("dossier"), step: mine, dossier }];
      });
      setToast(`${REL_FLOWS[route].filedWord} · logged to the activity trail`);
    } catch (e) {
      setFlow((f) => (f ? { ...f, running: false } : f));
      push({ kind: "agent", id: nextId("agent"), text: readableError(e) });
      /* A dispatched call that the wait could not settle has already said so
         above and sealed the approval; anything else is the org's own refusal,
         said in its own words, with the plan still staged. */
      if (isDeadline(e) || (e instanceof RelFlowError && e.dispatched)) setSealed(true);
    } finally {
      filingRef.current = false;
      setFiling(false);
    }
  }, [answers, ctx, deps, filing, flow, laneRows, onFiled, push, route, sealed]);

  /* ---- the room exhales when the card lands. The exit set is everything above
          the dossier, fixed at this instant, so a line that arrives afterwards
          slots under the card instead of joining the drain. */
  useEffect(() => {
    if (phase !== "filed") return;
    beginFinale(itemsRef.current.filter((i) => i.kind !== "dossier").map((i) => i.id));
  }, [beginFinale, phase]);

  /* ---- the halo breathes out ~5s after the dossier lands (rule 69). */
  useEffect(() => {
    if (!lit || reduced) return;
    const t = window.setTimeout(() => setLit(false), HALO_LIFE_MS);
    return () => clearTimeout(t);
  }, [lit, reduced]);

  /* ---- the status line under the execute mark crossfades while it runs. */
  useEffect(() => {
    if (!flow?.running || reduced || !flowSpec) return;
    const t = window.setInterval(
      () => setFlow((f) => (f && f.running ? { ...f, status: (f.status + 1) % flowSpec.loadSteps.length } : f)),
      STATUS_ROTATE_MS,
    );
    return () => clearInterval(t);
  }, [flow?.running, flowSpec, reduced]);

  /* ------------------------------------------------------------- render */

  const liveStep = items.length ? items[items.length - 1].step : 0;
  const grouped = useMemo(() => {
    const out: Array<{ step: number; items: RelItem[] }> = [];
    for (const item of items) {
      const last = out[out.length - 1];
      if (last && last.step === item.step) last.items.push(item);
      else out.push({ step: item.step, items: [item] });
    }
    return out;
  }, [items]);
  /* A ROOM STILL ASKING WHICH REVIEW THIS IS KEEPS THE QUESTION ON SCREEN. The
     question lives in the greeting slot at step 0; a line the room could not
     read as a review starts a step of its own, and collapsing step 0 behind it
     would hide the five chips in the same gesture that said "pick one". */
  const shows = (g: { step: number }) => g.step === liveStep || (!!ask && g.step === 0);
  const hidden = grouped.filter((g) => !shows(g));
  /** The tiers that left the stage, and whether they are back on it. */
  const tiersLeft = choreo.left;
  const tiersShown = choreo.summoned || histOpen;

  /* ---------------------------------------------------- THE PACKAGE LINE

     The facility room's control, in this room's header. Both package-anchored
     reviews scope to one package's facilities, so a banker has to be able to
     read which one that is and to move between them. */
  const anchoredEntry = ctx.packages.find((p) => p.id === ctx.productPackageId) ?? null;
  const packageLineLabel = packagePending
    ? `choose one of ${ctx.packages.length}`
    : (anchoredEntry?.name ?? REL_PACKAGE_NONE);
  const packageStance = packagePending
    ? `${ctx.packages.length} packages on this relationship. None is chosen yet.`
    : !ctx.productPackageId
      ? REL_PACKAGE_NONE
      : ctx.packages.length === 1
        ? "The relationship stages one product package, so the room anchored on it. You were not asked."
        : `Chosen from ${ctx.packages.length} on this relationship.`;

  /** SWITCHING RESTARTS THE COLLECTION. A review's answers are scoped to the
   *  package they were collected against, so they are dropped rather than
   *  carried, and a review already collecting says so before it drops them. */
  const switchPackage = (id: string) => {
    if (id === ctx.productPackageId) return;
    if (order.length) {
      setToast("Finish or restart the review before switching packages");
      return;
    }
    closePeek();
    onAnchorPackage(id);
  };

  const openPackagePeek = (anchor: HTMLElement) =>
    openPeek(anchor, {
      kicker: "Which package this review runs in",
      width: 460,
      content: (
        <>
          <div className="wk-cav">{packageStance}</div>
          {ctx.packages.map((entry) => {
            const here = entry.id === ctx.productPackageId;
            return (
              <button
                type="button"
                key={entry.id}
                className={`wk-pkg ${here ? "wk-sel" : ""}`}
                data-pkgrow={entry.id}
                disabled={here}
                onClick={() => switchPackage(entry.id)}
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

  /* THE GREETING'S OWN REMARK RIDES THE OPENING BUBBLE. Every other item's
     remark is rendered by the thread loop under `Narration`; the opening is a
     tier and is rendered through `opening`, so its view is drawn here. */
  const openingItem = (
    <div className="wk-msg wk-agent" data-who="Agent" key="opening">
      <div className="wk-bub">
        <div className="wk-headline">
          <span className="wk-greet">
            <Words text={brief.greeting} />{" "}
          </span>
          <Words
            text={ask ? ask.line : brief.position}
            offset={brief.greeting.trim().split(/\s+/).length}
          />
        </div>
        {ask && (
          <div className="wk-opts">
            {ask.chips.map((chip) => (
              <button
                type="button"
                className="wk-opt"
                key={chip.label}
                disabled={chip.disabled}
                title={chip.disabled ? chip.reason : undefined}
                onClick={() => chooseRoute(chip)}
              >
                {chip.label}
                {chip.disabled && chip.reason && <span className="rl-opt-d">{chip.reason}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="wk-posfoot">
          <button
            type="button"
            className="wk-dt"
            onClick={(e) =>
              openPeek(e.currentTarget, {
                kicker: "What the room read",
                width: 520,
                content: (
                  <>
                    {brief.why.map((row) => (
                      <div className="wk-have-row" key={row.label}>
                        <div className="wk-l">{row.label}</div>
                        <div className="wk-d">{row.detail}</div>
                      </div>
                    ))}
                    <div className="wk-cav">
                      Everything above is the cockpit's own staged read. Nothing here reaches a live clock, and no
                      signal is raised that the data did not make.
                    </div>
                  </>
                ),
              })
            }
          >
            Why
          </button>
        </div>
      </div>
      <Narration view={narration.viewFor(openingIdRef.current)} />
      <Narration view={narration.viewFor(`${openingIdRef.current}::mail`)} />
    </div>
  );

  return (
    <Portal>
      <div className="wk-root">
        <GooFilter />
        <div className="wk-scrim" onClick={onClose} role="presentation" />
        <div
          ref={roomRef}
          className="wk-room rl-room eg-glass eg-glass-workroom"
          data-finale={finaleState === "off" ? undefined : finaleState}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          data-room="relationship"
        >
          {/* ONE SLIM LINE (rule 44): the mark, one word, four dots, close. */}
          <header className="wk-head">
            <BrandGlyph />
            <span className="wk-title">{title}</span>
            {/* THE PACKAGE LINE. The same control the facility room carries: the
                anchor stated on the glass, and the way between the packages
                where the relationship stages more than one. */}
            <button
              type="button"
              className="wk-pkgline"
              data-pkgline={ctx.productPackageId ?? (packagePending ? "pending" : "none")}
              aria-label={`Package: ${packageLineLabel}`}
              onClick={(e) => openPackagePeek(e.currentTarget)}
            >
              <span className="wk-pkgline-k">Package</span>
              <span className="wk-pkgline-v">{packageLineLabel}</span>
            </button>
            <span className="wk-spacer" />
            <span className="wk-stepper" aria-label="Stage">
              {["Read", "Collect", "Review", "Filed"].map((label, i) => (
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
                  surface: `Relationship — ${ctx.accountName}`,
                  bookAsOf: ctx.asOf ?? undefined,
                })
              }
              surface={`Relationship — ${ctx.accountName}`}
              accountName={ctx.accountName}
              bookAsOf={ctx.asOf ?? undefined}
            />
            <button type="button" className="wk-icobtn" onClick={onClose} aria-label="Close the relationship room">
              ×
            </button>
          </header>

          {hidden.length > 0 && (
            <button type="button" className="wk-hist" onClick={() => setHistOpen((v) => !v)}>
              {histOpen ? `↓ hide earlier steps` : `↑ earlier steps (${hidden.length})`}
            </button>
          )}

          <div className="wk-body">
            <div className="wk-col-l">
              <section
                className={`wk-thread ${hidden.length ? "wk-hashist" : ""} ${histOpen ? "wk-masked" : ""}`}
                /* THE PANE CENTRES WHAT IS LEFT once the drain is over. */
                data-finale={finaleState === "still" ? "still" : undefined}
                ref={threadRef}
              >
                {grouped.map((group) => (
                  <div
                    className={`wk-step ${shows(group) || histOpen ? "" : "wk-gone"}`}
                    key={`step-${group.step}-${group.items[0].id}`}
                  >
                    {/* THE SUMMON (the entry choreography). Earlier tiers are
                        never lost: one quiet control brings back every one that
                        left the stage, in both rooms, with the same words. */}
                    {group.items.some((i) => relTierOf(i, detailId)) && tiersLeft.length > 0 && !histOpen && (
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
                    {group.items.map((item) => {
                      /* ONE BAD ITEM IS ONE BAD ITEM (2026-09-05). Per item,
                         not per room: the rest of the thread really is fine. */
                      const block = (
                        <RoomBoundary what={`this ${item.kind}`}>
                          <RelBlock
                            item={item}
                            opening={openingItem}
                            spec={flowSpec}
                            packages={ctx.packages}
                            onAnchorPackage={onAnchorPackage}
                            lit={lit}
                            hold={item.kind === "dossier" ? finale.hold : 0}
                            /* Only in the finale: while the room is open the lane
                               beside the card is already saying this. */
                            filed={item.kind === "dossier" && finaleState !== "off" ? filedLines : null}
                            filedHead={filedHead}
                            onOpenPeek={openPeek}
                            onOption={(sayText, label) => void say(sayText, label)}
                            expanded={item.kind === "settled" ? settle.isOpen(item.id) : false}
                            onExpand={settle.toggle}
                            onRestart={(restart) => {
                              setAnswers({});
                              setOrder([]);
                              askedRef.current = null;
                              readyRef.current = false;
                              briefedRef.current = null;
                              detailedRef.current = false;
                              setDetailId(null);
                              choreo.reset();
                              routerRef.current?.onRestart(restart.route, restart.say);
                            }}
                          />
                        </RoomBoundary>
                      );
                      const tier = relTierOf(item, detailId);
                      const inWave = finaleExit(item.id);
                      const leaves = inWave === null ? null : finaleAttrs(inWave, finaleState);
                      /* THE CARD IS THE ONE THING THAT ASCENDS, on the wrapper it
                         already had, with the finale's two clocks riding down as
                         custom properties. */
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
                      /* AN ANSWERED STEP LEAVES THE STAGE AND STAYS MOUNTED
                         (rule 1). The wrapper is one shape at every moment, so
                         React never remounts a bubble mid-speech. The settled
                         ROW is never wrapped: it is what replaces the step. */
                      if (!tier)
                        return (
                          <div
                            key={item.id}
                            data-ex-id={item.id}
                            data-finale-card={star ? "" : undefined}
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
                            {/* THE INNER ROW IS WHAT COLLAPSES. See workroom.css:
                                the wrapper animates the track, this holds the
                                overflow that lets the track squeeze it. */}
                            <div className="wk-ex-in">
                              {block}
                              <Narration view={narration.viewFor(item.id)} />
                            </div>
                          </div>
                        );
                      /* A TIER THAT LEFT THE STAGE STAYS MOUNTED, so an absence
                         contract can tell "faded out" from "gone". */
                      return (
                        <div key={item.id} {...withFinale(tierAttrs(tier, choreo.stateOf(tier), tiersShown), leaves)}>
                          {block}
                        </div>
                      );
                    })}
                    {/* THE REVIEW CHIP, in the live exchange. It is the only way
                        to the plan and it never leaves the thread. */}
                    {group.step === liveStep && approvalOpen && !flow && flowSpec && (
                      <button type="button" className="wk-propose" onClick={() => void openFlow()}>
                        <TypeIcon kind={flowSpec.icon} />
                        <span>
                          {order.length} {order.length === 1 ? "answer" : "answers"} collected ·{" "}
                          <b>Review &amp; file</b>
                        </span>
                      </button>
                    )}
                    {group.step === liveStep && flow && flowSpec && (
                      <RelFlowCard
                        flow={flow}
                        spec={flowSpec}
                        accountName={ctx.accountName}
                        approver={ctx.approver}
                        sealed={sealed}
                        filing={filing}
                        onCancel={() => setFlow(null)}
                        onExecute={() => void execute()}
                        onOpenPeek={openPeek}
                      />
                    )}
                  </div>
                ))}
                {thinking && (
                  <div className="wk-compose" role="status" aria-label="Composing an answer">
                    <LiquidMark />
                    <span>Composing…</span>
                  </div>
                )}
                {/* THE QUIET AFTERGLOW. One line, and the one door this room has:
                    its dossier files against the relationship rather than a
                    package record, so there is no nCino link to offer and none is
                    invented. */}
                {finaleState === "still" && (
                  <div className="wk-afterglow" data-finale="afterglow">
                    <button type="button" className="wk-ag-close" onClick={onClose}>
                      Close workroom
                    </button>
                    <span className="wk-ag-note">{REL_AFTERGLOW_LINE}</span>
                  </div>
                )}
              </section>

              <div className="wk-sugg" hidden={phase === "filed"} />

              {/* The composer SLEEPS until the room has read the relationship. */}
              <div className="wk-composer eg-pill" hidden={phase === "filed"}>
                <input
                  ref={composerRef}
                  className="wk-txt"
                  value={draft}
                  disabled={!awake || phase === "filed"}
                  placeholder={
                    phase === "filed"
                      ? // THE ROOM IS STILL ALIVE (founder, 2026-09-03). The card
                        // already says the filing landed; the prompt saying it
                        // again was the room announcing its own end twice.
                        REL_FILED_PROMPT
                      : !awake
                        ? "Reading the relationship…"
                        : ask
                          ? "Name the review, or pick one above."
                          : (live?.placeholder ?? "Answer above, or say what changes.")
                  }
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const text = draft;
                    setDraft("");
                    void say(text);
                  }}
                  aria-label="Answer the review"
                />
                <ComposerPlus room="relationship" members={[]} facilities={[]} book={EMPTY_BOOK} disabled={!awake || phase === "filed"} input={composerRef} onDraft={setDraft} />
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

          {/* ======================== THE RIGHT LANE: position, then the ledger */}
          <aside className="wk-col-r" aria-label={laneHeading} data-finale={finaleState === "off" ? undefined : finaleState}>
            {/* THE FEED'S OWN PROGRESS (rule 3), in the lane head beside the
                ledger. The thread is what was SAID; a queue position is not. */}
            {feed.total > 0 && (
              <div className="wk-feedhead" data-feed="progress">
                <span>From the intent</span>
                <b>
                  {feed.index} of {feed.total} settled
                </b>
              </div>
            )}
            {/* The lane opens empty (founder call, 2026-09-01): content arrives with
              the review, never as furniture. */}
            {laneRows.length === 0 && (
              <div className="wk-empty">
                {flowSpec ? "Nothing collected yet. Answers land here as the review takes them." : "Pick a review to begin."}
              </div>
            )}
            {/* THE SHARED RAIL (design/proposals/rail-scroll-addendum.md, section 4).
                The lane's own fold is gone with it: a fold on top of a scroller is two
                answers to one question, and the fold answered the overflow by removing
                the content. Every answer is on the rail, the head stays outside the
                scroller, and the frame is the ROOM's rather than the content's. */}
            {laneRows.length > 0 && (
              <ManifestRail
                heading={laneHeading}
                count={`${laneRows.length} ${laneRows.length === 1 ? "answer" : "answers"}`}
                label={`${laneHeading} · ${laneRows.length} ${laneRows.length === 1 ? "answer" : "answers"}`}
                newest={laneRows[laneRows.length - 1]?.key ?? null}
                action={
                  <button
                    type="button"
                    className="wk-dt"
                    onClick={(e) =>
                      openPeek(e.currentTarget, {
                        kicker: "What this review writes",
                        width: 480,
                        content: flowSpec ? (
                          <>
                            <div className="wk-prose">{flowSpec.covers}</div>
                            <div className="wk-prose" style={{ marginTop: 10 }}>
                              {flowSpec.produces}
                            </div>
                            <div className="wk-cav">
                              Staged intent only: nothing is written until the single approval, and the plan the banker
                              reads is the plan that executes.
                            </div>
                          </>
                        ) : (
                          <div className="wk-prose">
                            No review is bound yet. Pick one above and this states exactly what it covers and what it
                            files.
                          </div>
                        ),
                      })
                    }
                  >
                    Scope
                  </button>
                }
              >
                {/* THE RAIL DRAINS WITH THE THREAD. The answers stay MOUNTED as
                    they go off stage: they are the review's own record and an
                    absence contract must still be able to read them. */}
                {laneRows.map((row, i) => (
                  <div
                    {...withFinale({ className: "wk-ent" }, finaleState === "off" ? null : finaleAttrs(i, finaleState))}
                    key={row.key}
                  >
                    <TypeIcon kind={row.icon} />
                    <span className="wk-ent-t">
                      <b>{row.label}</b>
                      <span>{row.value}</span>
                    </span>
                    {phase === "work" && (
                      <button
                        type="button"
                        className="wk-ent-x"
                        aria-label={`Take ${row.label} back off the review`}
                        title="Take it back. The room asks again."
                        onClick={() => drop(row.key)}
                      >
                        <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
                          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </ManifestRail>
            )}
          </aside>
        </div>

        <div className={`wk-toast ${toast ? "wk-show" : ""}`} role="status">
          {toast}
        </div>

        {peek && <Peek spec={peek} roomRef={roomRef} onClose={closePeek} />}
      </div>
    </Portal>
  );
}

/* ---------------------------------------------------------- the step's chips */

/** The option pills a step offers. Optional steps carry the skip as a chip,
 *  because "not assessed" is an ANSWER a governance record should hold, not an
 *  absence the banker has to express by silence. */
function optionsFor(step: RelStep): Opt[] | undefined {
  const opts: Opt[] = (step.options ?? []).map((o) => ({
    label: o.label,
    say: o.value,
    detail: o.detail,
    disabled: o.disabled,
    reason: o.reason,
  }));
  if (step.optional) opts.push({ label: SKIP_LABEL, say: SKIP_LABEL });
  return opts.length ? opts : undefined;
}

/** Which options a typed line named. Exact value first, then a contained-word
 *  match; "all" takes the whole set, which is what a banker says when the
 *  package survey is the point. */
/**
 * CAN THE LIVE STEP GENUINELY READ THIS LINE.
 *
 * The same judgement `answerLive` makes when it decides between recording an
 * answer and re-asking, lifted out so the dispatch can consult it BEFORE the
 * line is spent. A line the step can read is the step's and goes straight
 * through; a line it cannot is what the desk is for.
 *
 * It reads SHAPES. It resolves nothing, records nothing and stages nothing.
 */
function stepAccepts(step: RelStep, text: string): boolean {
  const line = text.trim();
  if (!line) return false;
  // The skip is read before the kind, exactly as `answerLive` reads it.
  if (line === SKIP_LABEL || line.toLowerCase() === "skip") return step.optional === true;
  if (step.kind === "multi") return matchOptions(step, line).length > 0;
  if (step.kind === "number") return Number.isFinite(Number(line.replace(/[$,\s]/g, "")));
  if (step.options?.length && step.kind === "chips") {
    return step.options.some((o) => o.value.toLowerCase() === line.toLowerCase());
  }
  return true;
}

function matchOptions(step: RelStep, text: string): string[] {
  /* A DISABLED OPTION IS NOT SELECTABLE BY A TYPED LINE EITHER. The chip is
     refused on the glass and "all" must not quietly pick it up: the org would
     refuse it anyway, and the banker would read the refusal twice. */
  const opts = (step.options ?? []).filter((o) => !o.disabled);
  const line = text.trim().toLowerCase();
  if (!line) return [];
  if (/^(all|all of them|everything|the lot)$/.test(line)) return opts.map((o) => o.value);
  const exact = opts.filter((o) => o.value.toLowerCase() === line || o.label.toLowerCase() === line);
  if (exact.length) return exact.map((o) => o.value);
  return opts.filter((o) => line.includes(o.label.toLowerCase())).map((o) => o.value);
}

/* ----------------------------------------------------------- thread blocks */

function RelBlock({
  item,
  opening,
  spec,
  packages,
  onAnchorPackage,
  lit,
  hold,
  filed,
  filedHead,
  onOpenPeek,
  onOption,
  onRestart,
  expanded,
  onExpand,
}: {
  item: RelItem;
  opening: ReactNode;
  spec: RelFlowSpec | null;
  /** Every package the relationship stages, for the review's own package ask. */
  packages: PackageEntry[];
  onAnchorPackage: (productPackageId: string) => void;
  lit: boolean;
  /** THE FINALE'S DRAIN, in ms, so the card's paced reveal waits it out. */
  hold: number;
  /** The review's own ledger, for the dossier's section. Null outside the
   *  finale, where the lane is still on the glass saying it. */
  filed: FiledLine[] | null;
  filedHead: string;
  onOpenPeek: ReturnType<typeof usePeek>["openPeek"];
  onOption: (say: string, label: string) => void;
  onRestart: (restart: { route: RelRoute; say: string }) => void;
  /** Is this settled row's exchange currently back on the stage? */
  expanded: boolean;
  /** The banker asked for a settled step back, or to put it away. */
  onExpand: (rowId: string) => void;
}) {
  if (item.kind === "opening") return <>{opening}</>;

  /* THE SETTLED ROW (rule 1, this room's nouns). An answered step: its number,
     what was recorded, and the way back to the question. One grammar with the
     facility room, down to the class names. */
  if (item.kind === "settled") {
    const face = (
      <>
        {item.row.kicker && <span className="wk-settled-k">{item.row.kicker}</span>}
        <span className="wk-settled-w">{item.row.what}</span>
        <span className="wk-settled-dot" aria-hidden="true">
          ·
        </span>
        <span className="wk-settled-h">{item.row.how}</span>
      </>
    );
    // NOTHING TO BRING BACK, NO CONTROL. The first question is a tier and the
    // summon already owns it; a second control for the same intent is the
    // busyness this pass exists to remove.
    if (!item.covers.length) {
      return (
        <div className="wk-settled wk-settled-flat" data-settled-row={item.id}>
          {face}
        </div>
      );
    }
    return (
      <button
        type="button"
        className="wk-settled"
        data-settled-row={item.id}
        aria-expanded={expanded}
        onClick={() => onExpand(item.id)}
      >
        {face}
        <span className="wk-settled-x">{expandLabel(expanded)}</span>
      </button>
    );
  }

  /* THE FED LINE MARKER (rule 3). An intent's instruction, said once, in the
     room's quietest type. Nobody in this room typed it. */
  if (item.kind === "fed") {
    return (
      <div className="wk-fed" data-fed="line">
        <span className="wk-fed-src">{item.from}:</span> <span className="wk-fed-line">{item.text}</span>
      </div>
    );
  }

  if (item.kind === "lookup") {
    return (
      <div className="wk-loadchip" role="status" aria-label="Reading the relationship">
        <LiquidMark />
        <span className="wk-bars" aria-hidden="true">
          <i />
          <i />
        </span>
      </div>
    );
  }

  /* THE STRUCTURED BRIEF. A governance ritual states its scope before it asks
     anything: what the review covers, then what it produces. Two lines, read
     once, and never repeated by a later bubble. */
  if (item.kind === "brief") {
    if (!spec) return null;
    return (
      <div className="rl-brief">
        <div className="rl-brief-h">
          <TypeIcon kind={spec.icon} />
          <b>{spec.word}</b>
        </div>
        <div className="rl-brief-r">
          <span className="rl-brief-k">Covers</span>
          <span className="rl-brief-t">{spec.covers}</span>
        </div>
        <div className="rl-brief-r">
          <span className="rl-brief-k">Produces</span>
          <span className="rl-brief-t">{spec.produces}</span>
        </div>
      </div>
    );
  }

  /* WHICH PACKAGE THIS REVIEW RUNS IN. The same block the facility room asks,
     in the same material, because a banker who has learned one room has learned
     both. Route-neutral eligibility does not apply here: the review is already
     chosen, and both package-anchored reviews run against any package. */
  if (item.kind === "pkgask") {
    return (
      <div className="wk-pkgs wk-pkgask" role="radiogroup" aria-label={REL_PACKAGE_QUESTION}>
        <div className="wk-pkgask-h">{REL_PACKAGE_QUESTION}</div>
        {packages.map((entry) => {
          /* THE SAME LOCK THE FACILITY ROOM USES, from the same function (rule
             2). A review cannot run in a package version nobody has booked, and
             a banker who has learned one room's answer to that has learned both.
             A review FORKS NOTHING, so a package with a modification already in
             flight is named but never blocked here. */
          const pick = packagePick(entry, "review");
          return (
            <button
              type="button"
              role="radio"
              aria-checked={false}
              key={entry.id}
              className="wk-pkg"
              data-pkg={entry.id}
              disabled={pick.blocked}
              data-inflight={pick.blocked ? "1" : undefined}
              title={pick.line}
              onClick={() => !pick.blocked && onAnchorPackage(entry.id)}
            >
              <span>
                <b>{entry.name}</b>
                <span>{pick.line}</span>
              </span>
              {!pick.blocked && (
                <span className="wk-go" aria-hidden="true">
                  →
                </span>
              )}
            </button>
          );
        })}
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

  /* A QUESTION, ANSWERED. The SAME card the facility room draws: a banker who
     has learned one room has learned both, and a read that looked different in
     the two rooms would be two answers to one question. */
  if (item.kind === "read") return <ReadCard card={item.card} />;

  /* A CREATE THE ROOM CANNOT FILE. The refusal leads, the org-side gap is named
     under it, and no payload was ever composed. */
  if (item.kind === "gap") {
    return (
      <div className="rl-gap">
        <div className="wk-dl">
          <TypeIcon kind="covenant" />
          <span className="wk-kind wk-refusal">Not filed</span>
          <span className="wk-tgt">{item.gap.what}</span>
        </div>
        <div className="rl-gap-l">{item.gap.line}</div>
        <button
          type="button"
          className="wk-dt"
          style={{ alignSelf: "flex-start" }}
          onClick={(e) =>
            onOpenPeek(e.currentTarget, {
              kicker: "What would close this",
              width: 460,
              content: <div className="wk-prose">{item.gap.orgGap}</div>,
            })
          }
        >
          What would close this
        </button>
      </div>
    );
  }

  if (item.kind === "dossier") {
    const d = item.dossier;
    return (
      <>
        <RelDossier dossier={d} lit={lit} hold={hold} filed={filed} filedHead={filedHead} />
        <div className="wk-tokline">
          <span className="wk-tick">✓</span>
          <span>{d.tokenNote}</span>
        </div>
        {d.handoff && <div className="wk-handoff">{d.handoff}</div>}
      </>
    );
  }

  const who = item.kind === "banker" ? "You" : "Agent";
  return (
    <div className={`wk-msg wk-${item.kind}`} data-who={who}>
      <div className="wk-bub">
        {item.kind === "agent" && item.kicker && <span className="rl-kicker">{item.kicker}</span>}
        {item.kind === "agent" ? <Words text={item.text} /> : item.text}
        {item.kind === "agent" && item.options && item.options.length > 0 && (
          <div className="wk-opts">
            {item.options.map((opt) => (
              <button
                type="button"
                className="wk-opt"
                key={opt.say}
                disabled={opt.disabled}
                title={opt.disabled ? opt.reason : undefined}
                onClick={() => onOption(opt.say, opt.label)}
              >
                {opt.label}
                {(opt.detail || (opt.disabled && opt.reason)) && (
                  <span className="rl-opt-d">{opt.disabled && opt.reason ? opt.reason : opt.detail}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {item.kind === "agent" && item.restart && (
          <div className="wk-opts">
            <button
              type="button"
              className="wk-opt"
              onClick={() => onRestart({ route: item.restart!.route, say: item.restart!.say })}
            >
              {item.restart.label}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the flow card */

function RelFlowCard({
  flow,
  spec,
  accountName,
  approver,
  sealed,
  filing,
  onCancel,
  onExecute,
  onOpenPeek,
}: {
  flow: { staging: StagedRelPlan | null; running: boolean; status: number };
  spec: RelFlowSpec;
  accountName: string;
  approver: string | null;
  sealed: boolean;
  filing: boolean;
  onCancel: () => void;
  onExecute: () => void;
  onOpenPeek: ReturnType<typeof usePeek>["openPeek"];
}) {
  const plan: StagedOutput | null = flow.staging?.plan ?? null;
  const refused = (plan?.covenants ?? []).filter((c) => c.state && c.state !== "planned");
  /* WHAT THE PLAN WOULD NOT TAKE, BY INDEX, IN THE ORG'S OWN WORDS.
     A covenant the org already holds is refused by its id, which is what the
     covenant review reports. A CREATE has no id yet, so the intake reports its
     refusals against the position in the list the room sent, and the room reads
     them out in the same block: an unknown type name, a value at or below zero,
     a date the org cannot hold. Verbatim, and never summarised into a count. */
  const byIndex = plan?.refusals ?? [];
  const held = plan?.executionHeld === true;

  /* ONE CARD, MORPHING (founder, 2026-09-03). The same rule as the facility
     room's: one root node, the orbit circling behind it while the room
     compiles and settling to still when the plan lands, and only the pane
     inside it crossing over. Never a second card appended below the first. */
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
              {spec.loadSteps.map((s, i) => (
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
        <TypeIcon kind={spec.icon} />
        <span>{spec.word}</span>
      </div>
      <div className="wk-s">
        {plan?.summary ? plan.summary : `Staging the ${spec.writeObjectLabel} on ${accountName}…`}
      </div>

      {/* BEFORE YOU FILE. The org's own warnings and its own per-covenant
          refusals, verbatim. Advice, never a gate: the approval below is live
          whether it is read or not. */}
      {(plan?.warnings?.length || refused.length > 0 || byIndex.length > 0) && (
        <div className="rl-warn">
          <div className="rl-warn-k">Before you file</div>
          {(plan?.warnings ?? []).map((w) => (
            <div className="rl-warn-t" key={w}>
              {w}
            </div>
          ))}
          {refused.map((c: StagedCovenant) => (
            <div className="rl-warn-t" key={c.covenantId}>
              {c.covenantName ?? c.covenantType ?? c.covenantId}: {c.reason ?? "not assessable in this plan"}
            </div>
          ))}
          {byIndex.map((r) => (
            <div className="rl-warn-t" key={`refusal-${r.index}-${r.reason}`}>
              {r.index >= 0 ? `Number ${r.index + 1} on the list: ` : ""}
              {r.reason}
            </div>
          ))}
        </div>
      )}

      {held && <div className="rl-warn-h">{plan?.heldReason ?? "The org is holding execution on this plan."}</div>}

      <div className="wk-tokrow">
        <span className="wk-tok tnum">
          {flow.staging?.decisionToken
            ? `decision token · single use · ${flow.staging.decisionToken.slice(0, 4)}…${flow.staging.planHash.slice(-4)}`
            : flow.staging
              ? "no token on this plan"
              : "staging the plan…"}
        </span>
        <button
          type="button"
          className="wk-dt"
          onClick={(e) =>
            onOpenPeek(e.currentTarget, {
              kicker: "Governance",
              width: 440,
              content: (
                <div className="wk-prose">
                  Approver is the running identity: {approver ?? "not resolved in this view"}. Staging performs no
                  domain writes; the plan hash is immutable and the decision token is single use, bound to this plan
                  and this identity. Every step below is re-queried after it runs.
                </div>
              ),
            })
          }
        >
          Governance
        </button>
      </div>

      <div className="wk-acts">
        <button type="button" className="eg-btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="wk-approve eg-btn-ink"
          disabled={!flow.staging?.decisionToken || filing || sealed}
          onClick={onExecute}
        >
          {filing ? "Working…" : sealed ? "Approval closed" : held ? "Held by the org" : spec.approveLabel}
        </button>
      </div>
        </div>
      )}
    </div>
  );
}

/* THE RESULT DOSSIER (rule 69). The card CONSTRUCTS itself: the header lands, a
   hairline draws across, each real row materialises ~300ms apart, a second
   hairline, then the check pops last. The halo behind it is the filing's only
   light and it breathes out on its own. */
function RelDossier({
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
  /* THE CARD CONSTRUCTS ITSELF AFTER THE ROOM HAS CLEARED. `hold` is the
     finale's drain; every delay below is offset by it. Zero outside a finale. */
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
  /* The ledger is the next beat of the card's own clock, never a second
     animation over it. Same handover as the facility room's. */
  const ledger = foot + DOSSIER_CHECK_MS + FILED_SECTION_MS;

  return (
    <div className={`wk-rescard ${lit ? "wk-lit" : ""}`}>
      <span className="aura" aria-hidden="true" />
      <div className="rc-h" style={{ animationDelay: `${header}ms` }}>
        <TypeIcon kind="package" />
        <b>{dossier.title}</b>
      </div>
      <div className="rc-line" style={{ animationDelay: `${firstLine}ms` }} />
      {rows.map((row) => (
        <div className="rc-r" style={{ animationDelay: `${row.at}ms` }} key={`${row.label}-${row.value}`}>
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

/* =============================================================================
   THE ONE MOUNT.

   The mirror of `WorkroomHost`: it sits inside the app provider, so it is the
   only place in this room's tree that can see the read. The room itself takes a
   context and a route and asks nothing about where they came from — which is
   what keeps it testable without a provider above it.
   ============================================================================= */

/** The lane, or nothing. Built once per render rather than per line: the room
 *  takes a function and asks nothing about what is on the other end of it. */
function relBrainLane(): ((envelope: BrainEnvelope) => Promise<BrainReply>) | undefined {
  return brainReachable() ? (envelope: BrainEnvelope) => askBrain(envelope) : undefined;
}

export function RelationshipRoomHost() {
  const session = useRelationshipRoom();
  const { data, state, dispatch } = useApp();
  const generatedAt = data.meta?.generatedAt ?? "";

  const accountId = session?.accountId ?? null;
  const bundle = useMemo(() => {
    if (!accountId) return null;
    const baked = resolveBundle(data, accountId);
    const patch = state.livePatches[accountId];
    return baked && patch ? { ...baked, ...patch } : baked;
  }, [data, state.livePatches, accountId]);

  const accountName = session?.accountName ?? null;

  /* THE ORG'S OWN CHIP SETS, ONE READ PER HOST MOUNT (`Workroom.tsx` does the
     same and `readCatalog` is its own cache, so the two rooms share the round
     trip). Only the INTAKE route reads it: it is the one route that files a
     type by NAME, so the names have to be the org's. Null leaves the intake
     asking the banker to write the name, which is the channel-none doctrine
     applied to a catalog, and every other route is untouched. */
  const [catalog, setCatalog] = useState<OrgCatalog | null>(null);
  useEffect(() => {
    let live = true;
    void readCatalog().then((c) => {
      if (live) setCatalog(c);
    });
    return () => {
      live = false;
    };
  }, []);

  const sessionPackageId = session?.productPackageId ?? null;
  const ctx = useMemo<RelContext | null>(() => {
    if (!accountId || !accountName) return null;
    return relContextFor({
      data,
      bundle,
      accountId,
      accountName,
      catalog,
      productPackageId: sessionPackageId,
      /* THE TRAIL, FOR THE IN-FLIGHT VERSION READING (rule 2). This room runs
         no modification, so a lock never refuses it a route; what it needs the
         trail for is the ASK, which must not offer an unbooked version as a
         package a review can run in. */
      history: state.actionHistory[accountId],
    });
  }, [accountId, accountName, bundle, catalog, data, sessionPackageId, state.actionHistory]);

  /* ONE MAIL READ PER ROOM OPEN, MADE HERE (SAMPLE-CHANNEL spec, and the same
     hook the facility room uses). The founder's "when there is an email
     attached it should be in that first response baked in" did not reach this
     room at all: `buildRelEnvelope` set no `mail` key, so `useClientMail` was
     never called from here and the client's own message was invisible to the
     second room. Net connector traffic for a room open is ONE
     `outlook_email_search`, unchanged from the facility room's. */
  const { note: mail, gate: mailGate } = useClientMail({
    accountName: accountName ?? "",
    bundle,
    generatedAt,
    intentNote: intentMailNote(intentFor(accountId)),
  });

  /* AN EXECUTED REVIEW LANDS IN THE TRAIL (A30), the way WorkroomHost lands a
     filed change set. The entry is minted by `executedActivityEntry`, which is
     where every other executed action's entry is minted: five of its six action
     ids are this room's, so it already knows how to name a covenant batch, a
     valuation, a review, a rating and a case. */
  const onFiled = useCallback(
    (filed: { actionId: WriteActionId; result: ExecuteResult }) => {
      if (!accountId) return;
      const entry = executedActivityEntry({
        actionId: filed.actionId,
        outcome: filed.result,
        target: accountName ?? undefined,
        actor: data.meta?.user,
        instanceUrl: data.meta?.instanceUrl,
      });
      if (entry) dispatch({ type: "LOG_ACTIVITY", accountId, entry });
      /* A REVIEW THAT CAME FROM AN INTENT SPENDS IT. Fire-and-forget; a store
         write that fails never touches what the banker just filed. */
      noteFiled(accountId);
    },
    [accountId, accountName, data.meta?.instanceUrl, data.meta?.user, dispatch],
  );

  const close = useCallback(() => {
    if (accountId) dispatch({ type: "ARM_WASH", accountId });
    closeRelationshipRoom();
  }, [accountId, dispatch]);

  const router = useMemo<RelRouter | undefined>(() => {
    if (!session) return undefined;
    /* THE CHIPS KNOW THE BOOK. A covenant route on a relationship carrying no
       compliance row is offered disabled with that reason rather than taken all
       the way to a six-question refusal. */
    const book = ctx ? relBookFor(ctx) : null;
    const neutral = () => neutralRelAsk({ data, accountId: session.accountId, book });
    return {
      question: session.route ? null : session.opening ? smartRelAsk(session.opening) : neutral(),
      say: session.say,
      preselectCovenantId: session.covenantId,
      neutral,
      onBind: (route, opts) => bindRelRoute(route, opts),
      onRestart: (route, say) => restartRelRoute(route, say),
    };
  }, [ctx, data, session]);

  if (!ctx || !session) return null;
  /* Keyed on the route so binding one REBUILDS the room rather than carrying
     one review's collected answers into another. Route binding is final per
     plan, and this key is what makes that structural rather than a promise. */
  /* THE ROOM'S OUTER BOUNDARY (2026-09-05). It should never fire: every item
     in the thread already has one of its own. If it does, the room says so in
     its own voice, over the cockpit, and the banker still has every way out.
     A component stack on the glass in front of a client is the failure, not
     the diagnosis, so the detail goes to the console and nowhere else. */
  return (
    <RoomBoundary what="the relationship room" scope="room">
      <RelationshipRoom
        key={`${session.accountId}-${session.route ?? "unbound"}`}
        ctx={ctx}
        route={session.route}
        router={router}
        /* THE SECOND LANE, WIRED HERE AND NOWHERE ELSE, on the same capability
           gate the facility room uses: with no mcp capability there is no arm of
           the bridge that returns a reply, so the prop is ABSENT and the room
           keeps the step machine alone. */
        brain={relBrainLane()}
        mail={mail}
        mailGate={mailGate}
        onFiled={onFiled}
        onAnchorPackage={anchorRelPackage}
        onClose={close}
      />
    </RoomBoundary>
  );
}

/* ------------------------------------------------------------ the arc's read

   The opener the FAB calls needs a signal, and deriving it needs the cockpit's
   read. This is the one line the orchestrator wires the arc through, so the
   satellite does not have to know how a governance signal is derived. */
export function relOpeningForAccount(args: {
  data: Parameters<typeof relOpeningFor>[0]["data"];
  accountId: string;
}): RelOpening | null {
  return relOpeningFor({ data: args.data, bundle: resolveBundle(args.data, args.accountId) });
}

/** A stable key for a fresh idempotency key, exported so a test can pin the
 *  room's key discipline without reaching into the module. */
export const newRelKey = newRequestId;
