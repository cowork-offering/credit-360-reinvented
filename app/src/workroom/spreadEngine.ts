import { DEADLINES, isDeadline, waitedFor, withDeadline } from "../components/workroom/deadline";
import { figuresFromSpread, type PostReadFigures } from "../spread/postRead";
import { onFileBoomFigures } from "../spread/provisional";
import { unitsStated, type RelationshipSpreadContext } from "../spread/preRead";
import { unitsWord } from "../spread/periods";
import type { Boom } from "../data/contract";
import type {
  BoomAdapter,
  BoomFinancialStatement,
  BoomUploadRequest,
  BoomUploadResult,
  DroppedFile,
  ExtractedDocument,
  FilePreRead,
  PeriodRead,
  ProvisionalRead,
  SourceKind,
  SpreadPlan,
  StatementQuality,
  StatementType,
  UploadState,
} from "../spread/types";

/* =============================================================================
   THE SPREADING ROOM'S ENGINE.

   Files in, a governed plan out, Boom's own ladder in the middle, the spread
   and what it means at the end. Pure logic: no React, no DOM, no connector.
   Everything it cannot do itself it is HANDED (`SpreadDeps`) — the extraction
   and the two reads from the analysis modules, the transport from the Boom
   adapter — so the room wires the real ones and the suite wires fakes.

   THE STAGES, AND WHY THEY ARE IN THIS ORDER (BOOM-UPLOAD-SPEC §3):

     idle     the drop zone, painted on the first frame. Nothing is fetched to
              open: the relationship, its periods and its covenant thresholds
              are already in the cockpit's book and arrive as `ctx`.
     reading  a dropped file is a card IMMEDIATELY (name, size, kind) and the
              pre-read fills that card IN PLACE, one line at a beat: kind,
              pages, statements, periods, quality, provisional read.
     asking   what the pre-read could not settle, ONE ask at a time, with chips.
              The pre-read's own proposal is the recommended chip and says what
              grounds it; where nothing grounds a preference there is no
              recommendation (recommendation doctrine C).
     plan     one governed sentence naming exactly what goes to Boom. The
              banker confirms it; nothing leaves the room before that.
     sending  Boom's ladder, one row per file: pending, sending, processing,
              completed, verified or failed. Bounded by the room's own clock —
              a stall SAYS it is a stall and offers the next real option.
     spread   the live financials panel and the post-read prose.

   WHAT THIS LAYER IS NOT. It does not classify, extract or map a statement:
   Boom does that and stays the system of record. The pre-read figures it holds
   are PROVISIONAL and every caller is expected to label them so.

   THE CAPS ARE ENFORCED HERE, in sober words, before a byte is read: five
   megabytes for one file, ten files for one plan. Identity is the sha256, so a
   re-drop of the same file is RECOGNISED rather than duplicated — the same key
   Boom is asked to dedupe on (`File.externalUniqueId`).
   ============================================================================= */

/** Per file. The artifact-to-connector bridge is fragile on large payloads. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Per plan. Ten files is a full annual package and then some. */
export const MAX_FILES = 10;

/** One pre-read line to the next. Slow enough to read, quick enough to finish
 *  a card inside three seconds. */
export const PRE_READ_BEAT_MS = 420;

/** How often the room asks Boom where a file has got to. */
export const POLL_EVERY_MS = 1_200;

/** How long the room will watch one file settle before it says so out loud.
 *  The same budget a filing gets, for the same reason: past it the room is not
 *  learning anything by waiting in silence. */
export const SETTLE_BUDGET_MS = DEADLINES.execute;

/* ------------------------------------------------------------------ shapes */

export type SpreadStage = "idle" | "reading" | "asking" | "plan" | "sending" | "spread";

export type AskField = "statementType" | "periods" | "company" | "units" | "statementQuality";

export interface SpreadChip {
  value: string;
  label: string;
  /** Set on at most one chip, and only where the book or the file grounds it. */
  recommended?: boolean;
  /** What grounds it, in one clause. Rendered beside the recommended chip. */
  why?: string;
}

export interface SpreadAsk {
  id: string;
  fileId: string;
  fileName: string;
  field: AskField;
  /** Leads with what was detected. Never a bare question. */
  lead: string;
  chips: SpreadChip[];
}

export interface SpreadCard {
  id: string;
  name: string;
  bytes: number;
  kind: SourceKind;
  sha256: string | null;
  phase: "reading" | "read" | "rejected";
  /** The pre-read, released one line at a beat. */
  lines: string[];
  pre: FilePreRead | null;
  dropped: DroppedFile | null;
  /** Why this file is out, in the room's own words. */
  refusal: string | null;
  /** The banker left it out at the company ask. */
  excluded: boolean;
}

export interface LadderRow {
  fileId: string;
  name: string;
  state: UploadState;
  boomFileId: string | null;
  /** Boom's own words on a failure, shown verbatim. */
  message: string | null;
  /** The room stopped waiting. Boom still has the file. */
  stalled: boolean;
}

/** What the panel's tiles read. Null is a figure nothing supports yet. */
export interface SpreadFigures {
  revenue: number | null;
  ebitda: number | null;
  marginPct: number | null;
  leverage: number | null;
  coverage: number | null;
}

export interface SpreadState {
  stage: SpreadStage;
  company: string;
  cards: SpreadCard[];
  /** The whole queue, for the count. Only `ask` is ever put in front of anyone. */
  asks: SpreadAsk[];
  /** THE one ask. */
  ask: SpreadAsk | null;
  answers: Record<string, string>;
  plan: SpreadPlan | null;
  rows: LadderRow[];
  /** The room stopped waiting on this file and is asking what to do. */
  stall: { fileId: string; name: string; line: string } | null;
  provisional: ProvisionalRead | null;
  statements: BoomFinancialStatement[];
  /** Boom's own figures once it has spread, else the provisional read, else
   *  the last good ones on file. The panel never flashes empty. */
  figures: SpreadFigures;
  /** True while `figures` is not yet Boom's own. */
  figuresProvisional: boolean;
  newPeriod: string | null;
  validationStatus: "not_validated" | "validated" | null;
  validationUrl: string | null;
  postRead: string[];
  /** Caps, duplicates and unreadable files, said once each. */
  refusals: string[];
  /** One line about the room's own clock, when it has one to say. */
  notice: string | null;
}

export interface SpreadDeps {
  readDroppedFile(file: File): Promise<DroppedFile>;
  extractDocument(dropped: DroppedFile): Promise<ExtractedDocument>;
  preReadFile(doc: ExtractedDocument, ctx: RelationshipSpreadContext): Promise<FilePreRead>;
  provisionalRead(
    files: FilePreRead[],
    onFile: Boom | null | undefined,
    covenants?: RelationshipSpreadContext["covenants"],
  ): ProvisionalRead | null;
  postRead(args: {
    company: string;
    before: Boom | null | undefined;
    after: BoomFinancialStatement[];
    covenants: RelationshipSpreadContext["covenants"];
    validationStatus: "not_validated" | "validated";
  }): Promise<string[]>;
  adapter: BoomAdapter;
  /** Which adapter is behind `adapter`. The stub's spread is built from the
   *  pre-read and is NOT Boom's, so the panel keeps its provisional label until
   *  this says "live". */
  lane?: "stub" | "live";
  /** STUB-ONLY, and documented as such in `channel/boomUpload.ts`: the stub
   *  builds its Boom-shaped spread from the pre-read, so the room hands it over
   *  beside the upload. Absent on the live lane, where nothing reads it. */
  registerPreRead?(sha256: string, preRead: FilePreRead): void;
  /** STUB-ONLY: forget what the stub was told, on room teardown. */
  resetStub?(): void;
}

export interface SpreadEngineArgs {
  ctx: RelationshipSpreadContext;
  deps: SpreadDeps;
  /** `bundle.boom`, the spread already on file. It is the last-good figures the
   *  panel opens on AND what both analysis modules compare against. */
  onFileBoom?: Boom | null;
}

export interface SpreadEngine {
  getState(): SpreadState;
  subscribe(listener: () => void): () => void;
  /** Drop or browse. Returns once every card has its pre-read. */
  drop(files: File[]): Promise<void>;
  /** Answer the ONE ask. A stale id is ignored, which is how the room never loops. */
  answer(askId: string, value: string): void;
  /** The banker confirmed the plan. Runs the ladder and the post-read. */
  confirm(): Promise<void>;
  /** The stall's two doors. */
  keepWaiting(): void;
  leaveWithBoom(): void;
  dispose(): void;
}

/* ----------------------------------------------------------------- the copy

   EVERY SENTENCE THE ROOM SAYS THAT IS NOT A PRE-READ FINDING LIVES HERE, so
   the voice can be read in one place: active, specific, no marketing, no
   exclamation, no em dash.                                                  */

const STATEMENT_WORD: Record<StatementType, string> = {
  income_statement: "income statement",
  balance_sheet: "balance sheet",
  cash_flow_statement: "cash flow",
  shareholders_equity: "shareholders equity",
  personal_statement: "personal statement",
};

const QUALITY_WORD: Record<StatementQuality, string> = {
  cpa_audited: "audited",
  cpa_reviewed: "reviewed",
  cpa_compiled: "compiled",
  internal: "internal",
};

const QUALITY_CHIP: Record<StatementQuality, string> = {
  cpa_audited: "CPA audited",
  cpa_reviewed: "CPA reviewed",
  cpa_compiled: "CPA compiled",
  internal: "Prepared by management",
};

const KIND_WORD: Record<SourceKind, string> = {
  "pdf-text": "PDF with a text layer",
  "pdf-scan": "scanned PDF, no text layer",
  xlsx: "spreadsheet",
  csv: "CSV",
  image: "image",
  unknown: "unrecognised file type",
};

export const CAP_FILES_LINE =
  `This plan already holds ${MAX_FILES} files, which is the cap. File these, then drop the rest into a second plan.`;

export const tooBigLine = (name: string, bytes: number): string =>
  `${name} is ${mb(bytes)}. The cap for one file is 5 MB, so it stays out of this plan. Split it or drop a smaller export.`;

export const duplicateLine = (name: string): string =>
  `${name} is already in this plan, by content. Boom keys on the file's hash, so a second copy would not add a period.`;

export const unreadableLine = (name: string): string =>
  `${name} could not be read in the browser. Boom can still spread it, so drop it again if you want it sent as is.`;

export const busyLine =
  "Boom has this plan. Drop the next files once it has finished with these.";

export const stallLine = (name: string, waited: string): string =>
  `Boom is still spreading ${name}. I have waited ${waited} and stopped watching the call, not the file. ` +
  "I can keep waiting, or leave it with Boom and read the spread when you come back to it.";

export const leftWithBoomLine = (name: string): string =>
  `${name} is with Boom. The Financials refresh from Boom's own read when it lands.`;

export const postReadDeadlineLine = (waited: string): string =>
  `The desk has not answered on what this changes in ${waited}, so I have stopped waiting on it. The spread itself is Boom's and it is unchanged.`;

export const PROVISIONAL_NOTE =
  "Provisional, read in the browser before anything was sent. Boom's own spread replaces it.";

/* ------------------------------------------------------------------ helpers */

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function periodLabel(periods: PeriodRead[]): string {
  return periods.map((p) => p.key).join(", ");
}

/** Boom's own figures for the new period, over the provisional read, over the
 *  last good ones on file. Nothing ever falls back to a blank tile, which is
 *  what "last-good stays visible" means in practice.
 *
 *  THE TWO READS ARE S2'S, NOT A SECOND COPY. `figuresFromSpread` derives
 *  EBITDA from the depreciation row Boom's spread carries and the cockpit's
 *  chart-level read does not; `onFileBoomFigures` reads `bundle.boom` the way
 *  the assembler normalised it. This function only decides which of the three
 *  a tile is showing. */
export function mergeFigures(
  after: PostReadFigures | null,
  provisional: ProvisionalRead | null,
  onFile: Record<string, number | null>,
): SpreadFigures {
  const p = provisional?.figures ?? {};
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const of = (a: number | null | undefined, key: string): number | null =>
    a ?? num(p[key]) ?? num(onFile[key]);

  const revenue = of(after?.revenue, "revenue");
  const ebitda = of(after?.ebitda, "ebitda");
  const marginPct =
    after && after.ebitda != null && after.revenue ? (after.ebitda / after.revenue) * 100 : of(null, "ebitdaMarginPct");
  const totalDebt = of(after?.totalDebt, "totalDebt");
  const leverage = after?.leverage ?? (totalDebt != null && ebitda ? totalDebt / ebitda : num(onFile.leverage));
  const coverage = of(after?.interestCoverage, "interestCoverage");
  return { revenue, ebitda, marginPct, leverage, coverage };
}

/* ------------------------------------------------------------------ the asks

   ORDER IS THE GOLDEN RULE'S "DIGESTIBLE ORDER": whose it is, then what it is,
   then which period, then the units, then the quality. A banker reads a
   statement in that order and the room asks in it.

   QUALITY IS ASKED ONLY WHEN THE FILE DOES NOT SAY. Where an auditor's report
   is in the text the pre-read has named it, the plan card states it, and the
   plan confirmation is the confirmation. A second question about something
   already grounded is the wall rule 6 forbids. */

const ASK_ORDER: AskField[] = ["company", "statementType", "periods", "units", "statementQuality"];

/** What the OTHER files in the same drop settled. An annual package puts the
 *  period end and the auditor's opinion on one PDF and the schedules on the
 *  rest, so a fact read off a sibling is grounded and may be recommended. The
 *  book's own periods are offered but never recommended: Boom carrying FY2024
 *  is not a reason to think this file is FY2024. */
export interface DropGrounding {
  period: { key: string; from: string } | null;
  quality: { value: StatementQuality; from: string } | null;
}

export function groundingOf(cards: SpreadCard[], exceptId: string): DropGrounding {
  let period: DropGrounding["period"] = null;
  let quality: DropGrounding["quality"] = null;
  for (const c of cards) {
    if (c.id === exceptId || c.excluded || !c.pre) continue;
    if (!period) {
      const key = c.pre.statements.flatMap((s) => s.periods)[0]?.key;
      if (key) period = { key, from: c.name };
    }
    if (!quality && c.pre.statementQuality) quality = { value: c.pre.statementQuality, from: c.name };
  }
  return { period, quality };
}

function asksForCard(card: SpreadCard, ctx: RelationshipSpreadContext, ground: DropGrounding): SpreadAsk[] {
  const pre = card.pre;
  if (!pre) return [];
  const out: SpreadAsk[] = [];
  const ask = (field: AskField, lead: string, chips: SpreadChip[]) =>
    out.push({ id: `${card.id}:${field}`, fileId: card.id, fileName: card.name, field, lead, chips });

  if (pre.companyMatchesRelationship === false && pre.company) {
    /* NOTHING GROUNDS A PREFERENCE HERE. The file names one borrower and the
       book names another; the room states both and stays silent, per the
       recommendation doctrine. Filing it under the other name needs that
       relationship's own anchor, which this room does not hold. */
    ask(
      "company",
      `${card.name} reads as ${pre.company}. The relationship in view is ${ctx.company}.`,
      [
        { value: "anchor", label: `Spread under ${ctx.company}` },
        { value: "exclude", label: "Leave this file out" },
      ],
    );
  }

  if (pre.statements.length === 0) {
    const scanned = card.kind === "pdf-scan" || card.kind === "image";
    ask(
      "statementType",
      scanned
        ? `${card.name} has no text layer, so nothing could be read from it here. Boom will read it; it needs to know what it is.`
        : `Nothing in ${card.name} named a statement type.`,
      (Object.keys(STATEMENT_WORD) as StatementType[]).map((t) => ({
        value: t,
        label: STATEMENT_WORD[t].replace(/^./, (c) => c.toUpperCase()),
      })),
    );
  }

  const hasPeriods = pre.statements.some((s) => s.periods.length > 0);
  if (!hasPeriods) {
    const chips: SpreadChip[] = [];
    if (ground.period) {
      chips.push({
        value: ground.period.key,
        label: ground.period.key,
        recommended: true,
        why: `read from ${ground.period.from}`,
      });
    }
    for (const k of ctx.onFilePeriods) if (!chips.some((c) => c.value === k)) chips.push({ value: k, label: k });
    ask(
      "periods",
      `No period end was printed in ${card.name}. ${
        ctx.onFilePeriods.length
          ? `Boom carries ${ctx.onFilePeriods.join(", ")} for ${ctx.company}.`
          : `Boom carries no period for ${ctx.company} yet.`
      }`,
      chips,
    );
  }

  /* ASKED ONLY WHERE THE STATEMENT IS SILENT. A file that prints "(in
     thousands)" has answered this question already, and the room says so on the
     card instead of asking it again. Where nothing states the scale, the
     magnitudes decide: figures a borrower's statement could plausibly print
     either way are worth one question, and figures already in dollar scale are
     not. */
  if (pre.statements.length > 0 && !unitsStated(pre) && unitsAmbiguous(pre)) {
    const printed = String(pre.unitsMultiplier);
    ask(
      "units",
      `The figures in ${card.name} read as ${unitsWord(pre.unitsMultiplier)}, but the statement does not say so plainly.`,
      [
        { value: "1", label: "Dollars" },
        { value: "1000", label: "Thousands" },
        { value: "1000000", label: "Millions" },
      ].map((c) => (c.value === printed ? { ...c, recommended: true, why: "how the figures read in the file" } : c)),
    );
  }

  /* ALWAYS ASKED WHEN THE FILE DOES NOT SAY, scan included: a scan gives the
     room nothing, so it asks the banker the three facts Boom needs (what it is,
     which period, what quality) rather than filing "internal" on their behalf.
     Where the file DOES say, the pre-read has named it, the plan card states it
     and the plan confirmation is the confirmation. */
  if (pre.statementQuality === null) {
    ask(
      "statementQuality",
      `No auditor's or accountant's report was found in ${card.name}. Boom files the quality with the spread.`,
      (Object.keys(QUALITY_CHIP) as StatementQuality[]).map((q) =>
        ground.quality?.value === q
          ? { value: q, label: QUALITY_CHIP[q], recommended: true, why: `the report in ${ground.quality.from}` }
          : { value: q, label: QUALITY_CHIP[q] },
      ),
    );
  }

  return out.sort((a, b) => ASK_ORDER.indexOf(a.field) - ASK_ORDER.indexOf(b.field));
}

/** Where a statement prints figures under this, in its own scale, thousands and
 *  dollars are both readings a commercial borrower's statement supports. Over
 *  it the figures are already at dollar scale and there is nothing to ask. */
export const UNITS_AMBIGUOUS_BELOW = 1_000_000;

/** The largest figure the read placed, taken back to the scale it was PRINTED
 *  at. Nothing placed means nothing to rescale and so nothing to ask. */
export function unitsAmbiguous(pre: FilePreRead): boolean {
  const scale = pre.unitsMultiplier || 1;
  let largest = 0;
  for (const statement of pre.statements) {
    for (const line of statement.lines) {
      for (const value of Object.values(line.values)) {
        if (typeof value === "number" && Number.isFinite(value)) largest = Math.max(largest, Math.abs(value) / scale);
      }
    }
  }
  return largest > 0 && largest < UNITS_AMBIGUOUS_BELOW;
}

/**
 * NEVER SILENT ON THE COMPANY.
 *
 * A file whose printed name cannot be read raises no mismatch and therefore no
 * ask, and until 2026-09-12 the card simply said nothing: the statement went
 * under the relationship in view without a word about whose name was on it.
 * The banker is told instead. The plan sentence names the relationship too
 * ({@link planSummary}), so the fact is on the glass at the moment of the
 * confirm as well as at the moment of the read.
 */
export function noPrintedNameLine(company: string): string {
  return `Printed name not found in this file; it spreads under ${company} unless you say otherwise.`;
}

/* ------------------------------------------------------------------ the plan */

/** The one sentence the banker confirms. Counts the statements, names the
 *  relationship, then says period, quality and what the statements are. */
export function planSummary(items: SpreadPlan["items"], company: string): string {
  const count = items.reduce((n, i) => n + i.statementTypes.length, 0);
  const head = `${count} statement${count === 1 ? "" : "s"} to Boom, ${company}`;
  const parts = items.map((i) => {
    const period = periodLabel(i.periods);
    const quality = QUALITY_WORD[i.statementQuality];
    const types = i.statementTypes.map((t) => STATEMENT_WORD[t]).join(", ");
    return [period, quality, types].filter(Boolean).join(" ");
  });
  const unique = [...new Set(parts)].filter((p) => p.length > 0);
  return unique.length ? `${head}: ${unique.join("; ")}.` : `${head}.`;
}

function planFrom(state: SpreadState, ctx: RelationshipSpreadContext): SpreadPlan | null {
  const items: SpreadPlan["items"] = [];
  for (const card of state.cards) {
    if (card.phase !== "read" || card.excluded || !card.dropped || !card.pre) continue;
    const answered = (field: AskField) => state.answers[`${card.id}:${field}`];
    const typeAnswer = answered("statementType") as StatementType | undefined;
    const periodAnswer = answered("periods");
    const qualityAnswer = answered("statementQuality") as StatementQuality | undefined;

    const statementTypes = card.pre.statements.length
      ? card.pre.statements.map((s) => s.statementType)
      : typeAnswer
        ? [typeAnswer]
        : [];
    /* ONE ENTRY PER PERIOD, NOT ONE PER STATEMENT. An annual package prints the
       same fiscal year on the income statement, the balance sheet and the cash
       flow, so the flat list carries FY2025 three times and the plan sentence
       read "FY2025, FY2025, FY2025 audited". A period is a period however many
       statements print it. */
    const seen = new Set<string>();
    const periods = card.pre.statements
      .flatMap((s) => s.periods)
      .filter((p) => (seen.has(p.key) ? false : (seen.add(p.key), true)));
    const resolved: PeriodRead[] = periods.length
      ? periods
      : periodAnswer
        ? [{ key: periodAnswer, endDate: null, periodType: "annual" }]
        : [];
    const quality = card.pre.statementQuality ?? qualityAnswer ?? "internal";
    if (!statementTypes.length) continue;
    items.push({
      fileId: card.id,
      name: card.name,
      mime: card.dropped.mime,
      base64: card.dropped.base64,
      sha256: card.dropped.sha256,
      statementTypes,
      periods: resolved,
      statementQuality: quality,
    });
  }
  if (!items.length) return null;
  return {
    accountId: ctx.accountId,
    company: ctx.company,
    /* ONE FILE GROUP PER PLAN where more than one file is going: a set of
       statements dropped together is one filing, and Boom aggregates a group. */
    consolidate: items.length > 1,
    items,
    summary: planSummary(items, ctx.company),
  };
}

/* ---------------------------------------------------------------- the engine */

export function createSpreadEngine(args: SpreadEngineArgs): SpreadEngine {
  const { ctx, deps } = args;
  const onFileRead = onFileBoomFigures(args.onFileBoom);
  const onFile = onFileRead.figures;

  let state: SpreadState = {
    stage: "idle",
    company: ctx.company,
    cards: [],
    asks: [],
    ask: null,
    answers: {},
    plan: null,
    rows: [],
    stall: null,
    provisional: null,
    statements: [],
    figures: mergeFigures(null, null, onFile),
    figuresProvisional: true,
    newPeriod: onFileRead.period,
    validationStatus: null,
    validationUrl: null,
    postRead: [],
    refusals: [],
    notice: null,
  };

  const listeners = new Set<() => void>();
  const beats = new Map<string, ReturnType<typeof setTimeout>>();
  const queued = new Map<string, string[]>();
  let stallDecision: ((keep: boolean) => void) | null = null;
  let seq = 0;
  let dead = false;

  const emit = () => {
    for (const l of listeners) l();
  };
  const set = (patch: Partial<SpreadState>) => {
    if (dead) return;
    state = { ...state, ...patch };
    emit();
  };
  const patchCard = (id: string, patch: Partial<SpreadCard>) =>
    set({ cards: state.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const refuse = (line: string) => {
    if (state.refusals.includes(line)) return;
    set({ refusals: [...state.refusals, line] });
  };

  /* THE BEAT. A line lands the moment it is known and the next waits one beat,
     so a card fills the way a person reads it rather than appearing whole. */
  const pump = (cardId: string) => {
    if (dead || beats.has(cardId)) return;
    const pendingLines = queued.get(cardId);
    if (!pendingLines?.length) return;
    const next = pendingLines.shift() as string;
    set({ cards: state.cards.map((c) => (c.id === cardId ? { ...c, lines: [...c.lines, next] } : c)) });
    beats.set(
      cardId,
      setTimeout(() => {
        beats.delete(cardId);
        pump(cardId);
      }, PRE_READ_BEAT_MS),
    );
  };
  const say = (cardId: string, ...lines: string[]) => {
    const q = queued.get(cardId) ?? [];
    q.push(...lines.filter(Boolean));
    queued.set(cardId, q);
    pump(cardId);
  };

  const preReadLines = (pre: FilePreRead): string[] => {
    const out: string[] = [];
    if (pre.statements.length) {
      out.push(
        `${pre.statements.length} statement${pre.statements.length === 1 ? "" : "s"}: ` +
          pre.statements.map((s) => STATEMENT_WORD[s.statementType]).join(", "),
      );
      const periods = [...new Set(pre.statements.flatMap((s) => s.periods.map((p) => p.key)))];
      if (periods.length) out.push(`Periods: ${periods.join(", ")}`);
    }
    if (pre.company) {
      out.push(
        pre.companyMatchesRelationship === false
          ? `Printed name: ${pre.company}, which is not ${ctx.company}`
          : `Printed name: ${pre.company}`,
      );
    } else {
      out.push(noPrintedNameLine(ctx.company));
    }
    if (pre.statementQuality) {
      out.push(`Quality: ${QUALITY_CHIP[pre.statementQuality]}, from the report in the file`);
    }
    for (const q of pre.quality) out.push(q.text);
    return out;
  };

  async function readOne(file: File): Promise<void> {
    /* THE CARD IS PAINTED BEFORE THE HASH EXISTS, so it opens under a counter
       and ADOPTS the sha256-derived id `readDroppedFile` mints the instant the
       bytes are read. Everything downstream is then keyed on the CONTENT —
       the ask ids, the plan item's `fileId`, the ladder row — which is the key
       Boom is asked to dedupe on (`File.externalUniqueId`). Nothing is queued
       against the placeholder: the first line is said after the adoption. */
    const placeholder = `drop${++seq}`;
    set({
      cards: [
        ...state.cards,
        {
          id: placeholder,
          name: file.name,
          bytes: file.size,
          kind: "unknown",
          sha256: null,
          phase: "reading",
          lines: [],
          pre: null,
          dropped: null,
          refusal: null,
          excluded: false,
        },
      ],
    });

    let dropped: DroppedFile;
    try {
      dropped = await deps.readDroppedFile(file);
    } catch {
      patchCard(placeholder, { phase: "rejected", refusal: unreadableLine(file.name) });
      return;
    }

    /* IDENTITY IS THE CONTENT. A banker who drops the same PDF twice gets one
       card, and Boom is asked to dedupe on the same key. */
    if (state.cards.some((c) => c.id !== placeholder && c.sha256 === dropped.sha256)) {
      set({ cards: state.cards.filter((c) => c.id !== placeholder) });
      refuse(duplicateLine(file.name));
      return;
    }

    const id = dropped.id;
    set({
      cards: state.cards.map((c) =>
        c.id === placeholder ? { ...c, id, kind: dropped.kind, sha256: dropped.sha256, dropped } : c,
      ),
    });
    say(id, `${KIND_WORD[dropped.kind]}, ${mb(dropped.bytes)}`);

    try {
      const doc = await deps.extractDocument(dropped);
      if (doc.pages) say(id, `${doc.pages} page${doc.pages === 1 ? "" : "s"}`);
      for (const w of doc.warnings) say(id, w);
      const pre = await deps.preReadFile(doc, ctx);
      patchCard(id, { pre, phase: "read" });
      say(id, ...preReadLines(pre));
    } catch {
      patchCard(id, { phase: "rejected", refusal: unreadableLine(file.name) });
    }
  }

  /** After a read, after an answer: rebuild the queue, the read and the plan. */
  function settle(): void {
    const answered = state.answers;
    const asks = state.cards
      .filter((c) => c.phase === "read" && !c.excluded)
      .flatMap((c) => asksForCard(c, ctx, groundingOf(state.cards, c.id)))
      .filter((a) => !(a.id in answered));
    const pres = state.cards.filter((c) => c.pre && !c.excluded).map((c) => c.pre as FilePreRead);
    const provisional = pres.length ? deps.provisionalRead(pres, args.onFileBoom, ctx.covenants) : null;
    const figures = mergeFigures(null, provisional, onFile);

    if (asks.length) {
      set({ stage: "asking", asks, ask: asks[0], provisional, figures, plan: null });
      return;
    }
    const next = { ...state, asks: [], ask: null, provisional, figures };
    const plan = planFrom(next, ctx);
    set({
      stage: plan ? "plan" : state.cards.length ? "reading" : "idle",
      asks: [],
      ask: null,
      provisional,
      figures,
      plan,
    });
  }

  async function runLadder(plan: SpreadPlan): Promise<void> {
    set({
      stage: "sending",
      notice: null,
      rows: plan.items.map((i) => ({
        fileId: i.fileId,
        name: i.name,
        state: "pending" as UploadState,
        boomFileId: null,
        message: null,
        stalled: false,
      })),
    });

    const row = (fileId: string, patch: Partial<LadderRow>) =>
      set({ rows: state.rows.map((r) => (r.fileId === fileId ? { ...r, ...patch } : r)) });

    const landed: BoomUploadResult[] = [];

    /* ONE GROUP PER PLAN, and only where the server offers one. Statements
       dropped together are one filing, and Boom aggregates a file group. An
       adapter without the capability files them singly, which is a smaller
       result and not a failure. */
    let fileGroupId: string | null = null;
    if (plan.consolidate && deps.adapter.createGroup) {
      try {
        fileGroupId = (await deps.adapter.createGroup(plan.accountId)).fileGroupId;
      } catch {
        fileGroupId = null;
      }
    }

    for (const item of plan.items) {
      row(item.fileId, { state: "sending" });
      const req: BoomUploadRequest = {
        accountId: plan.accountId,
        company: { externalUniqueId: plan.accountId, name: plan.company },
        file: { name: item.name, mime: item.mime, base64: item.base64, sha256: item.sha256 },
        externalUniqueId: item.sha256,
        statementQuality: item.statementQuality,
        fileGroupId,
      };
      /* TODO — THE ASSET STORE (BOOM-UPLOAD-SPEC §2, "the dropped files are
         kept in the artifact's asset store"). Nothing is written today, and
         deliberately: this page declares three capabilities and `assets` is not
         one of them (client-360/assets/capabilities.json, generated by
         client-360/render/capabilities.mjs, carries `mcp`, `sample` and `db`),
         and there is no `upload_asset` door in this tree to call — `channel/`
         has `mcp`, `sampleDoor` and `dbDoor` and no fourth.

         TWO THINGS ARE NEEDED, in this order: the artifact must DECLARE the
         `assets` capability, and `channel/` needs an asset door acquired the
         way the other three are (`claude.use("assets")`, once, bounded, absent
         is not an error). Then the write goes HERE, beside the send: fire and
         forget, never awaited, and a failure never touches the plan. The bytes
         are already in hand (`item.base64`) and the audit key is already the
         file's sha256. */

      /* THE STUB IS TOLD WHAT THE FILE SAID, so the spread it walks back is
         this borrower's own numbers rather than a fixture's. The live lane has
         no such channel and never sees this. */
      const pre = state.cards.find((c) => c.id === item.fileId)?.pre;
      if (pre) deps.registerPreRead?.(item.sha256, pre);

      let result: BoomUploadResult;
      try {
        result = await withDeadline(
          (signal) => deps.adapter.upload(req, { signal }),
          "execute",
          `${item.name} going to Boom`,
        );
      } catch (e) {
        row(item.fileId, {
          state: isDeadline(e) ? "processing" : "failed",
          stalled: isDeadline(e),
          message: isDeadline(e) ? null : messageOf(e),
        });
        if (!isDeadline(e)) continue;
        set({ stall: { fileId: item.fileId, name: item.name, line: stallLine(item.name, waitedFor(e)) } });
        if (!(await waitOnStall())) continue;
        result = { fileId: item.sha256, companyId: null, fileGroupId: null, status: "processing" };
      }

      row(item.fileId, { state: uploadStateOf(result.status), boomFileId: result.fileId, message: result.message ?? null });
      const settled = await watch(item.fileId, item.name, result);
      if (settled) landed.push(settled);
    }

    /** Ask Boom where the file is until it is somewhere terminal, or until the
     *  room's own clock runs out and it says so. */
    async function watch(
      fileId: string,
      name: string,
      first: BoomUploadResult,
    ): Promise<BoomUploadResult | null> {
      let latest = first;
      let until = Date.now() + SETTLE_BUDGET_MS;
      while (!dead && latest.status === "processing") {
        if (Date.now() >= until) {
          set({ stall: { fileId, name, line: stallLine(name, `${Math.round(SETTLE_BUDGET_MS / 1000)} seconds`) } });
          if (!(await waitOnStall())) {
            row(fileId, { stalled: true });
            return null;
          }
          until = Date.now() + SETTLE_BUDGET_MS;
        }
        await sleep(POLL_EVERY_MS);
        if (dead) return null;
        try {
          latest = await withDeadline(
            (signal) => deps.adapter.status(latest.fileId, { signal }),
            "read",
            `${name} at Boom`,
          );
        } catch (e) {
          if (!isDeadline(e)) {
            row(fileId, { state: "failed", message: messageOf(e) });
            return null;
          }
          continue;
        }
        row(fileId, { state: uploadStateOf(latest.status), message: latest.message ?? null });
      }
      if (latest.status === "failed") return null;
      return latest;
    }

    const statements = landed.flatMap((r) => r.financialStatements ?? []);
    const validationUrl = landed.find((r) => r.validationUrl)?.validationUrl ?? null;
    const validationStatus = statements.length
      ? statements.every((s) => s.validationStatus === "validated")
        ? ("validated" as const)
        : ("not_validated" as const)
      : null;
    const after = figuresFromSpread(statements);
    set({
      stage: "spread",
      stall: null,
      statements,
      validationUrl,
      validationStatus,
      figures: mergeFigures(after, state.provisional, onFile),
      /* THE STUB'S SPREAD IS NOT BOOM'S. It is built from the pre-read, so the
         panel keeps the provisional label until the live lane is behind the
         adapter and has actually returned something. */
      figuresProvisional: statements.length === 0 || deps.lane !== "live",
      newPeriod: after?.period ?? state.provisional?.period ?? state.newPeriod,
    });

    try {
      const lines = await withDeadline(
        () =>
          deps.postRead({
            company: ctx.company,
            before: args.onFileBoom,
            after: statements,
            covenants: ctx.covenants,
            validationStatus: validationStatus ?? "not_validated",
          }),
        "narrate",
        "what this changes",
      );
      set({ postRead: lines });
    } catch (e) {
      set({ notice: isDeadline(e) ? postReadDeadlineLine(waitedFor(e)) : null });
    }
  }

  function waitOnStall(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      stallDecision = (keep: boolean) => {
        stallDecision = null;
        set({ stall: null });
        resolve(keep);
      };
    });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async drop(files) {
      if (state.stage === "sending" || state.stage === "spread") {
        refuse(busyLine);
        return;
      }
      const accepted: File[] = [];
      for (const f of files) {
        if (state.cards.length + accepted.length >= MAX_FILES) {
          refuse(CAP_FILES_LINE);
          break;
        }
        if (f.size > MAX_FILE_BYTES) {
          refuse(tooBigLine(f.name, f.size));
          continue;
        }
        accepted.push(f);
      }
      if (!accepted.length) return;
      set({ stage: "reading" });
      /* SEQUENTIAL ON PURPOSE: the dedupe reads the cards already in state, and
         two files hashing in parallel could both pass the check. */
      for (const f of accepted) await readOne(f);
      settle();
    },

    answer(askId, value) {
      /* ONLY THE HEAD OF THE QUEUE IS ANSWERABLE. A late click on a question
         that has already been answered lands nowhere, which is the mechanism
         behind "no loops, no double answers". */
      if (!state.ask || state.ask.id !== askId) return;
      const ask = state.ask;
      const answers = { ...state.answers, [askId]: value };

      if (ask.field === "company" && value === "exclude") {
        set({
          answers,
          cards: state.cards.map((c) => (c.id === ask.fileId ? { ...c, excluded: true } : c)),
        });
        settle();
        return;
      }

      if (ask.field === "units") {
        /* THE UNITS ANSWER CORRECTS THE PROVISIONAL READ AND NOTHING ELSE.
           Boom reads the units off the statement itself; what the banker fixes
           here is the figure the room shows them before Boom has it. */
        const multiplier = Number(value);
        set({
          answers,
          cards: state.cards.map((c) =>
            c.id === ask.fileId && c.pre ? { ...c, pre: rescale(c.pre, multiplier) } : c,
          ),
        });
        settle();
        return;
      }

      set({ answers });
      settle();
    },

    async confirm() {
      const plan = state.plan;
      if (!plan || state.stage !== "plan") return;
      await runLadder(plan);
    },

    keepWaiting() {
      stallDecision?.(true);
    },

    leaveWithBoom() {
      const stalled = state.stall;
      if (stalled) refuse(leftWithBoomLine(stalled.name));
      stallDecision?.(false);
    },

    dispose() {
      dead = true;
      deps.resetStub?.();
      for (const t of beats.values()) clearTimeout(t);
      beats.clear();
      queued.clear();
      listeners.clear();
      stallDecision?.(false);
    },
  };
}

/* ------------------------------------------------------------------ the small */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uploadStateOf(status: BoomUploadResult["status"]): UploadState {
  switch (status) {
    case "waiting_for_upload":
      return "sending";
    case "processing":
      return "processing";
    case "completed":
      return "completed";
    case "verified":
      return "verified";
    case "failed":
      return "failed";
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The banker corrected the units. Every figure the pre-read placed moves with
 *  them; the multiplier it was read at is replaced, never stacked. */
function rescale(pre: FilePreRead, multiplier: number): FilePreRead {
  const factor = multiplier / (pre.unitsMultiplier || 1);
  if (!Number.isFinite(factor) || factor === 1) return { ...pre, unitsMultiplier: multiplier };
  return {
    ...pre,
    unitsMultiplier: multiplier,
    statements: pre.statements.map((s) => ({
      ...s,
      lines: s.lines.map((l) => ({
        ...l,
        values: Object.fromEntries(
          Object.entries(l.values).map(([k, v]) => [k, v == null ? v : v * factor]),
        ),
      })),
    })),
  };
}
