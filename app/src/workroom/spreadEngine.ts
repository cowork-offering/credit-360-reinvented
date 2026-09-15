import { BOOM_MAX_FILE_BYTES } from "../channel/boomUpload";
import { isDeadline, waitedFor, withDeadline } from "../components/workroom/deadline";
import { figuresFromSpread, type PostReadFigures } from "../spread/postRead";
import { onFileBoomFigures } from "../spread/provisional";
import {
  DOOR_ABSENT_NOTE,
  MODEL_FAILED_NOTE,
  sentence,
  unitsStated,
  unitsStatedNote,
  type RelationshipSpreadContext,
} from "../spread/preRead";
import { unitsWord } from "../spread/periods";
import type { Boom } from "../data/contract";
import type {
  BoomAdapter,
  BoomFinancialStatement,
  BoomRatioSupportLine,
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

/** Per file, and it is BOOM'S cap, not one this room chose. `boom_upload_bytes`
 *  takes at most 3 MB of base64, and base64 costs four bytes for every three,
 *  so the largest file that fits is this. One cap, one sentence, one place
 *  (`channel/boomUpload.ts`). */
export const MAX_FILE_BYTES = BOOM_MAX_FILE_BYTES;

/** Per plan. Ten files is a full annual package and then some. */
export const MAX_FILES = 10;

/** One pre-read line to the next. Slow enough to read, quick enough to finish
 *  a card inside three seconds. */
export const PRE_READ_BEAT_MS = 420;

/** How often the room asks Boom where a file has got to. */
export const POLL_EVERY_MS = 1_200;

/**
 * HOW LONG THE ROOM WATCHES ONE FILE BEFORE IT SAYS SO OUT LOUD.
 *
 * TWO MINUTES, AND IT IS THE ROOM'S OWN CLOCK (founder decision D3, 2026-09-15).
 * It used to be `DEADLINES.execute`, 45 seconds, which is the budget for ONE
 * call that has said nothing at all: the wrong instrument entirely. Boom is not
 * silent while it spreads, it is working, and it has been observed taking over
 * six minutes on an 8 KB workbook. A 45-second stall line told a banker
 * something was wrong when nothing was.
 *
 * The total-wait clock is therefore SEPARATE from the per-call deadline: each
 * `boom_await_file` blocks at most 25 seconds by the server's own design, and
 * this is how many of those the room spends before it stops and says so.
 */
export const BOOM_WAIT_BUDGET_MS = 120_000;

/** Seconds handed to ONE `boom_await_file`. Under the server's 25-second
 *  ceiling, so a call that reaches the ceiling is the server answering and not
 *  the page's clock firing. */
export const BOOM_AWAIT_SECONDS = 20;

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

/**
 * ONE FACT ON THE CARD: a label, a value, and at most one qualifier.
 *
 * FOUNDER, 2026-09-13: the card was "a wall of eleven lines with duplicates".
 * It had become a transcript of the pre-read, so the same fact arrived twice
 * (once as a finding, once as a sentence) and the things a banker actually
 * scans for — whose statement is this, which periods, what quality — were
 * buried in prose. A fact is now a ROW; the qualifier that used to be a second
 * sentence is a `tag`, and the report a quality was read from is a `quote`.
 */
export interface SpreadFact {
  /** Stable, so a test names a fact instead of matching its prose. */
  key: "read" | "statements" | "periods" | "company" | "quality" | "units";
  label: string;
  value: string;
  /** A qualifier ON the value. Never a sentence, never a second fact. */
  tag?: string;
  /** The fragment of the file the fact was read from, where there is one. */
  quote?: string;
}

export interface SpreadCard {
  id: string;
  name: string;
  bytes: number;
  kind: SourceKind;
  sha256: string | null;
  phase: "reading" | "read" | "rejected";
  /** The pre-read as facts, released one at a beat. */
  facts: SpreadFact[];
  /** What the read could not do, in its own words. Never a fact restated. */
  warnings: string[];
  /** One muted line, where the desk was not in the path. */
  footnote: string | null;
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
  /** Boom already held these bytes, so nothing was sent a second time. */
  reused?: boolean;
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
  /** Which read of the file the statements above are: Boom's analyst-adjusted
   *  one (its own default, and what is published to the book) or the statement
   *  as given. Changing it is a SERVER RE-READ, never a local filter. */
  adjusted: boolean;
  /** True where the lane behind this engine can serve that re-read. The basis
   *  switch is not drawn at all where it cannot. */
  adjustable: boolean;
  /** `boom_get_ratios` `support.lines` for the spread on the glass: which line
   *  fed which headline figure. Empty where the lane does not serve them. */
  support: BoomRatioSupportLine[];
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
  /** THE FILE HANDLE, ACROSS A SESSION (founder decision D3). Boom can take
   *  longer than a banker will sit in one room, so the moment a file id exists
   *  it is written down and a re-entry resumes the wait from `boom_get_file`
   *  instead of sending the same bytes again. Absent on a lane that cannot
   *  resume, which simply means the wait is not resumable. */
  rememberFile?(handle: BoomFileHandle): void;
  forgetFile?(fileId: string): void;
}

/** What has to survive a closed room for the wait to be picked back up. */
export interface BoomFileHandle {
  fileId: string;
  companyId: string | null;
  fileName: string;
  /** When the room first sent it, so a resumed wait can say how long it has been. */
  startedAt: number;
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
  /** A file left with Boom earlier, picked back up. Reads where it got to and
   *  waits again; nothing is sent. */
  resume(handle: BoomFileHandle): Promise<void>;
  /** Re-read the spread on the other basis. Resolves once Boom has answered and
   *  the register has the figures the server holds; a lane that cannot re-read
   *  does nothing. */
  setAdjusted(next: boolean): Promise<void>;
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
  `${name} is ${mb(bytes)}. The page sends the bytes to Boom base64 encoded and Boom caps that at 3 MB, ` +
  `so the cap for one file here is ${mb(MAX_FILE_BYTES)}. Split it or drop a smaller export.`;

export const duplicateLine = (name: string): string =>
  `${name} is already in this plan, by content. Boom keys on the file's hash, so a second copy would not add a period.`;

export const unreadableLine = (name: string): string =>
  `${name} could not be read in the browser. Boom can still spread it, so drop it again if you want it sent as is.`;

export const busyLine =
  "Boom has this plan. Drop the next files once it has finished with these.";

/** THE FIRST BUDGET: a statement, not a question. Boom is working and the room
 *  says so and carries on; putting two doors in front of a banker two minutes
 *  into a spread that routinely takes six is an interruption, not guidance. */
export const stillProcessingLine = (name: string): string =>
  `Boom is still processing ${name}. I will keep checking.`;

/** THE SECOND: the room stops watching and offers the two real doors. */
export const stallLine = (name: string, waited: string): string =>
  `Boom is still spreading ${name}. I have waited ${waited} and stopped watching the call, not the file. ` +
  "I can keep waiting, or leave it with Boom and read the spread when you come back to it.";

/** The file Boom already held. Said once, on the row, because a banker who
 *  dropped the same file twice is owed the reason nothing new happened. */
export const reusedLine = (name: string): string =>
  `Boom already holds ${name} under the same content. I am reading that file rather than sending a second copy.`;

/** The room reopened on a file Boom still has. */
export const resumedLine = (name: string): string =>
  `${name} is still with Boom from earlier. I am picking the wait back up rather than sending it again.`;

export const leftWithBoomLine = (name: string): string =>
  `${name} is with Boom. The Financials refresh from Boom's own read when it lands.`;

export const postReadDeadlineLine = (waited: string): string =>
  `The desk has not answered on what this changes in ${waited}, so I have stopped waiting on it. The spread itself is Boom's and it is unchanged.`;

export const REREAD_FAILED =
  "Boom did not answer the re-read, so the register is showing the figures it already had.";

export const PROVISIONAL_NOTE =
  "Provisional, read in the browser before anything was sent. Boom's own spread replaces it.";

/* ------------------------------------------------------------- the spine

   FIVE STEPS, AND THE BANKER KNOWS WHICH ONE THEY ARE ON (founder, 2026-09-13:
   "more streamlined, more guidance, more intuitive"). It is the workrooms' own
   step spine — derived from what has happened, never clickable, never a form
   wizard — with this room's five words instead of their four.               */

export type SpreadStep = "drop" | "read" | "confirm" | "boom" | "financials";

export type StepState = "idle" | "on" | "done";

export const SPREAD_STEPS: Array<{ id: SpreadStep; label: string }> = [
  { id: "drop", label: "Drop" },
  { id: "read", label: "Read" },
  { id: "confirm", label: "Confirm" },
  { id: "boom", label: "Boom" },
  { id: "financials", label: "Financials" },
];

/** Which step the room is on, and which it has passed. Reading and asking are
 *  ONE step: they are the same moment to a banker, who is looking at what the
 *  file said and answering the one thing it did not. */
export function spreadSteps(stage: SpreadStage): StepState[] {
  const at: Record<SpreadStage, number> = {
    idle: 0,
    reading: 1,
    asking: 1,
    plan: 2,
    sending: 3,
    spread: 4,
  };
  const here = at[stage];
  return SPREAD_STEPS.map((_, i) => (i < here ? "done" : i === here ? "on" : "idle"));
}

/**
 * THE ONE SENTENCE THAT LEADS EACH STAGE.
 *
 * Golden rule 4, "it takes your hand to the end": at every turn the banker is
 * told where they are and what the next move is, in this room's own terms. One
 * sentence per stage and never more, so the guidance does not become the wall
 * it was written to replace.
 */
export function spreadGuidance(state: { stage: SpreadStage; ask: SpreadAsk | null; company: string }): string {
  switch (state.stage) {
    case "idle":
      return `Drop the statements for ${state.company}. I read them in the browser before anything leaves the cockpit.`;
    case "reading":
    case "asking":
      return state.ask
        ? "I read the file in the browser before anything leaves. Check what it found, then answer the one question below."
        : "I read the file in the browser before anything leaves. Check what it found below.";
    case "plan":
      return "Nothing has left the cockpit yet. Confirm and Boom spreads these statements; the financials here refresh from Boom's own read.";
    case "sending":
      return "Boom is spreading. This usually takes a few seconds.";
    case "spread":
      return `The spread is in. Here is what it changes for ${state.company}.`;
  }
}

/* -------------------------------------------------------------- the card

   WHAT THE PRE-READ'S NOTES ARE ABOUT, so the card can carry each fact ONCE.
   A note whose topic is already a fact is not printed again as a sentence: the
   printed name's tag says it differs, the period's tag says it is on file, the
   quality's quote says what the report said. What is left over is what the read
   could not do, which is a different thing and stays in words.              */

export type NoteTopic = "company" | "periods" | "quality" | "units" | "degrade" | "scan" | "other";

export function noteTopic(text: string, pre: FilePreRead): NoteTopic {
  if (text === DOOR_ABSENT_NOTE || text === MODEL_FAILED_NOTE) return "degrade";
  if (text === unitsStatedNote(pre.unitsMultiplier)) return "units";
  if (/^Read as .+?: "/.test(text)) return "quality";
  if (/^This reads as /.test(text)) return "company";
  if (/already on file from the last spread|^No fiscal period is printed/.test(text)) return "periods";
  if (/reads as a scan|no text layer/i.test(text)) return "scan";
  return "other";
}

/** The one-line footnote a degraded read earns, in banker words. The long
 *  version named the desk and its own machinery, which is not the banker's
 *  problem and read as an apology (founder, 2026-09-13). */
export const DEGRADED_FOOTNOTE = "Lines placed from the text of the file; Boom maps them itself.";

/** At most `max` characters of a quoted report, cut on a word. */
export function fragment(said: string, max = 80): string {
  const clean = said.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[,;:.]$/, "")}…`;
}

const capitalise = (said: string): string => said.replace(/^./, (c) => c.toUpperCase());

/**
 * THE CARD, CURATED: one row per fact, in the order a banker reads a statement.
 *
 * What it is, what it holds, which periods, whose name is on it, what quality,
 * at what scale. Everything else the pre-read said is either a tag on one of
 * those rows or a warning about something the read could not do.
 */
export function cardFacts(args: {
  pre: FilePreRead;
  kind: SourceKind;
  pages: number | null;
  ctx: RelationshipSpreadContext;
}): SpreadFact[] {
  const { pre, ctx } = args;
  const out: SpreadFact[] = [];

  const pages = args.pages && args.pages > 0 ? `, ${args.pages} page${args.pages === 1 ? "" : "s"}` : "";
  out.push({ key: "read", label: "Read as", value: `${KIND_WORD[args.kind]}${pages}` });

  if (pre.statements.length) {
    out.push({
      key: "statements",
      label: "Statements",
      value: capitalise(pre.statements.map((s) => STATEMENT_WORD[s.statementType]).join(", ")),
    });
    const periods = [...new Set(pre.statements.flatMap((s) => s.periods.map((p) => p.key)))];
    if (periods.length) {
      /* THE TAG NAMES ONLY WHAT THE VALUE DOES NOT. Where every period in the
         file is already on file the tag is the bare fact, because repeating
         "FY2025" beside "FY2025" is the duplication this card was cured of. */
      const held = periods.filter((k) => ctx.onFilePeriods.includes(k));
      out.push({
        key: "periods",
        label: "Periods",
        value: periods.join(", "),
        tag: held.length
          ? held.length === periods.length
            ? "already on file"
            : `${held.join(", ")} already on file`
          : undefined,
      });
    }
  }

  out.push(
    pre.company
      ? {
          key: "company",
          label: "Printed name",
          value: pre.company,
          tag: pre.companyMatchesRelationship === false ? "differs from the relationship" : undefined,
        }
      : { key: "company", label: "Printed name", value: "Not printed", tag: `spreads under ${ctx.company}` },
  );

  if (pre.statementQuality) {
    const grounding = pre.quality.find((q) => noteTopic(q.text, pre) === "quality")?.text ?? "";
    const quoted = /"([\s\S]+)"\s*$/.exec(grounding)?.[1];
    out.push({
      key: "quality",
      label: "Quality",
      value: QUALITY_CHIP[pre.statementQuality],
      quote: quoted ? fragment(quoted) : undefined,
    });
  }

  if (pre.statements.length) out.push({ key: "units", label: "Units", value: unitsFactValue(pre) });

  return out;
}

/** The scale, and whether the statement said it or the figures did. Read back
 *  when the banker corrects the units, so the row moves with the answer. */
export function unitsFactValue(pre: FilePreRead): string {
  return `${capitalise(unitsWord(pre.unitsMultiplier))}, as the ${unitsStated(pre) ? "statement says" : "figures read"}`;
}

/** What the read could not do, once per topic, with everything already a fact
 *  left out. A second sentence about the printed name or the periods is the
 *  duplication the founder read as a wall. */
export function cardWarnings(pre: FilePreRead): string[] {
  const seen = new Set<NoteTopic>(["company", "periods", "quality", "units", "degrade"]);
  const out: string[] = [];
  for (const note of pre.quality) {
    const topic = noteTopic(note.text, pre);
    if (topic === "other") {
      if (!out.includes(note.text)) out.push(note.text);
      continue;
    }
    if (seen.has(topic)) continue;
    seen.add(topic);
    out.push(note.text);
  }
  return out;
}

/** The footnote, or null where the desk was in the path. */
export function cardFootnote(pre: FilePreRead): string | null {
  return pre.quality.some((q) => noteTopic(q.text, pre) === "degrade") ? DEGRADED_FOOTNOTE : null;
}

/* -------------------------------------------------------------- the plan

   THE PROVISIONAL READ, CUT TO WHAT THE CONFIRM NEEDS. The full read is a dozen
   sentences and belongs under the spread; what a banker wants BEFORE confirming
   is the top line against the book, the ratio that moves a test, and whether the
   balance sheet foots. Four lines, in that order.                           */

export const PROVISIONAL_BRIEF_MAX = 4;

export function provisionalBrief(read: ProvisionalRead | null): string[] {
  if (!read?.lines.length) return [];
  const want = [/^Revenue\b/i, /coverage/i, /leverage/i, /balance sheet/i];
  const out: string[] = [];
  for (const re of want) {
    const line = read.lines.find((l) => re.test(l) && !out.includes(l));
    if (line) out.push(line);
  }
  for (const line of read.lines) {
    if (out.length >= PROVISIONAL_BRIEF_MAX) break;
    if (!out.includes(line)) out.push(line);
  }
  return out.slice(0, PROVISIONAL_BRIEF_MAX);
}

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
      /* A LEGAL NAME ENDS IN A PERIOD MORE OFTEN THAN NOT, and the lead read
         "Piedmont Precision Components, Inc.. The relationship" until
         2026-09-13. `sentence` is the room's own one-full-stop rule. */
      `${card.name} reads as ${sentence(pre.company)} The relationship in view is ${sentence(ctx.company)}`,
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
    /* BOOM'S OWN DEFAULT, stated rather than assumed: `boom_get_spread` reads
       the analyst-adjusted figures unless told otherwise, so that is what the
       ladder landed and what the register opens on. */
    adjusted: true,
    adjustable: Boolean(deps.adapter.readSpread),
    support: [],
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
  const queued = new Map<string, SpreadFact[]>();
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

  /* THE BEAT. A fact lands the moment it is known and the next waits one beat,
     so a card fills the way a person reads it rather than appearing whole. */
  const pump = (cardId: string) => {
    if (dead || beats.has(cardId)) return;
    const pending = queued.get(cardId);
    if (!pending?.length) return;
    const next = pending.shift() as SpreadFact;
    set({ cards: state.cards.map((c) => (c.id === cardId ? { ...c, facts: [...c.facts, next] } : c)) });
    beats.set(
      cardId,
      setTimeout(() => {
        beats.delete(cardId);
        pump(cardId);
      }, PRE_READ_BEAT_MS),
    );
  };
  const say = (cardId: string, ...facts: SpreadFact[]) => {
    const q = queued.get(cardId) ?? [];
    q.push(...facts);
    queued.set(cardId, q);
    pump(cardId);
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
          facts: [],
          warnings: [],
          footnote: null,
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
    /* NOTHING IS SAID UNTIL THERE IS SOMETHING TO SAY. The card is on the glass
       with its name, its size and the reading state from the frame the file
       lands; the FACTS start once the pre-read has them, and then one to a beat.
       The old card said the kind, then the page count, then each finding as its
       own line, which is how eleven lines happened. */
    try {
      const doc = await deps.extractDocument(dropped);
      const pre = await deps.preReadFile(doc, ctx);
      patchCard(id, { pre, phase: "read", warnings: cardWarnings(pre), footnote: cardFootnote(pre) });
      say(id, ...cardFacts({ pre, kind: dropped.kind, pages: doc.pages ?? null, ctx }));
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

  const row = (fileId: string, patch: Partial<LadderRow>) =>
    set({ rows: state.rows.map((r) => (r.fileId === fileId ? { ...r, ...patch } : r)) });

  /**
   * Wait on one file until Boom has it somewhere terminal.
   *
   * THE SERVER OWNS THE BLOCKING (`boom_await_file`, 25 seconds by its own
   * design) and this owns the TOTAL. Where an adapter offers no bounded wait
   * the room polls `status` on its own clock instead, which is the same shape
   * a beat slower.
   *
   * THE FIRST BUDGET IS A STATEMENT AND THE SECOND IS A QUESTION. Boom
   * routinely takes longer than two minutes; a room that put two doors in
   * front of a banker at the first one would be interrupting work that is
   * going perfectly well. So the first expiry says the room is still checking
   * and re-arms itself, and only the second stops and offers the doors.
   */
  async function watch(
    fileId: string,
    name: string,
    first: BoomUploadResult,
  ): Promise<BoomUploadResult | null> {
    let latest = first;
    const startedAt = Date.now();
    let until = startedAt + BOOM_WAIT_BUDGET_MS;
    let saidStillProcessing = false;
    const waiting = () => latest.status === "processing" || latest.status === "waiting_for_upload";

    while (!dead && waiting()) {
      if (Date.now() >= until) {
        if (!saidStillProcessing) {
          saidStillProcessing = true;
          set({ notice: stillProcessingLine(name) });
          until = Date.now() + BOOM_WAIT_BUDGET_MS;
        } else {
          set({ notice: null, stall: { fileId, name, line: stallLine(name, minutesWaited(startedAt)) } });
          if (!(await waitOnStall())) {
            row(fileId, { stalled: true });
            return null;
          }
          until = Date.now() + BOOM_WAIT_BUDGET_MS;
        }
      }
      if (dead) return null;
      try {
        /* A FLOOR UNDER THE LOOP, WHATEVER THE ADAPTER DOES. The server's own
           wait blocks for up to twenty seconds, so the pause is normally its.
           An adapter that answers instantly - a fixture, a server that
           short-circuits a settled file - would otherwise spin this loop as
           fast as the event loop allows and hammer the connector for the whole
           budget. The floor is paid only while the file is still moving. */
        const askedAt = Date.now();
        latest = deps.adapter.awaitSettled
          ? await withDeadline(
              (signal) => deps.adapter.awaitSettled!(latest.fileId, BOOM_AWAIT_SECONDS, { signal }),
              "stage",
              `${name} at Boom`,
            )
          : await withDeadline((signal) => deps.adapter.status(latest.fileId, { signal }), "read", `${name} at Boom`);
        if (waiting() && Date.now() - askedAt < POLL_EVERY_MS) await sleep(POLL_EVERY_MS);
      } catch (e) {
        if (!isDeadline(e)) {
          row(fileId, { state: "failed", message: messageOf(e) });
          return null;
        }
        continue;
      }
      row(fileId, { state: uploadStateOf(latest.status), message: latest.message ?? null });
    }
    if (dead) return null;
    // Boom's own words, verbatim, where the wait carried any. Boom has no
    // structured failure reason (Q&A tracker #14), so there is nothing else
    // to read and a second round trip would only confirm the rung.
    if (latest.status === "failed") {
      row(fileId, { state: "failed", message: latest.message ?? null });
      return null;
    }
    /* THE WAIT CARRIES NO SPREAD. `boom_await_file` reports a rung and
       nothing else, so the statements are read once, here, off the file that
       has just become readable. */
    try {
      const full = await withDeadline(
        (signal) => deps.adapter.status(latest.fileId, { signal }),
        "read",
        `${name} at Boom`,
      );
      row(fileId, { state: uploadStateOf(full.status), message: full.message ?? null });
      set({ notice: null });
      return full;
    } catch (e) {
      row(fileId, { state: "failed", message: messageOf(e) });
      return null;
    }
  }

  /** The spread is in: the panel, the figures and the post-read prose. Shared by
   *  a confirmed plan and by a wait picked back up on re-entry. */
  async function settleSpread(landed: BoomUploadResult[]): Promise<void> {
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

  /* WHICH LINE FED WHICH FIGURE. Boom names them on the ratio set struck from
     this file, and the register marks the lines behind the headline ratios with
     them. It is one read after the spread has landed, and the room shows the
     grid with or without it: a lane that serves no support lines simply marks
     nothing. */
  const supportFile = landed.find((r) => r.financialStatements?.length)?.fileId;
  if (supportFile && deps.adapter.ratioSupport) {
    try {
      set({ support: await deps.adapter.ratioSupport(supportFile) });
    } catch {
      // A marker is not a figure. Its absence costs the banker nothing.
    }
  }

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

      /* THE HANDLE GOES DOWN THE MOMENT THERE IS A FILE ID, not when the room
         gives up waiting. A session can die at any point in the wait, and the
         one thing that must survive it is the knowledge that these bytes are
         already in Boom: without it a re-entry re-uploads a file Boom is still
         spreading. Cleared when the file settles. */
      deps.rememberFile?.({
        fileId: result.fileId,
        companyId: result.companyId,
        fileName: result.fileName ?? item.name,
        startedAt: Date.now(),
      });
      row(item.fileId, {
        state: uploadStateOf(result.status),
        boomFileId: result.fileId,
        message: result.message ?? null,
        reused: result.reused === true,
      });
      if (result.reused) refuse(reusedLine(item.name));
      const settled = await watch(item.fileId, item.name, result);
      if (settled) landed.push(settled);
      deps.forgetFile?.(result.fileId);
    }

    await settleSpread(landed);
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
          cards: state.cards.map((c) => {
            if (c.id !== ask.fileId || !c.pre) return c;
            const pre = rescale(c.pre, multiplier);
            // The Units row moves with the answer rather than standing there
            // stating the scale the banker has just corrected.
            return { ...c, pre, facts: c.facts.map((f) => (f.key === "units" ? { ...f, value: unitsFactValue(pre) } : f)) };
          }),
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

    /**
     * PICK THE WAIT BACK UP, NEVER SEND AGAIN.
     *
     * The handle says Boom already holds these bytes, so the room reads where
     * the file got to (`boom_get_file`, one call) and rejoins the wait from
     * there. A file that has settled while the room was shut lands its spread
     * on the first read and the banker walks straight into the Financials.
     */
    async resume(handle: BoomFileHandle) {
      if (state.stage === "sending" || state.stage === "spread") return;
      set({
        stage: "sending",
        notice: null,
        refusals: [...state.refusals, resumedLine(handle.fileName)],
        rows: [
          {
            fileId: handle.fileId,
            name: handle.fileName,
            state: "processing" as UploadState,
            boomFileId: handle.fileId,
            message: null,
            stalled: false,
          },
        ],
      });
      let first: BoomUploadResult;
      try {
        first = await withDeadline(
          (signal) => deps.adapter.status(handle.fileId, { signal }),
          "read",
          `${handle.fileName} at Boom`,
        );
      } catch (e) {
        row(handle.fileId, { state: "failed", message: messageOf(e) });
        deps.forgetFile?.(handle.fileId);
        await settleSpread([]);
        return;
      }
      row(handle.fileId, { state: uploadStateOf(first.status), message: first.message ?? null });
      const settled = first.status === "processing" || first.status === "waiting_for_upload"
        ? await watch(handle.fileId, handle.fileName, first)
        : first.status === "failed"
          ? null
          : first;
      deps.forgetFile?.(handle.fileId);
      await settleSpread(settled ? [settled] : []);
    },

    /* THE BASIS IS A RE-READ (design 0.9.28). Boom holds both reads of the same
       file and the register asks for one; deriving an as-given figure from an
       adjusted one here would put a number on the glass no server ever sent.
       THE ROOM'S TILES, TREND AND PROSE DO NOT MOVE WITH IT: they are the spread
       that was FILED, which is Boom's adjusted read and what reached the book.
       The switch inspects the source lines, and the control above the grid says
       which basis is on screen. */
    async setAdjusted(next: boolean): Promise<void> {
      const reRead = deps.adapter.readSpread;
      if (!reRead || next === state.adjusted) return;
      const files = state.rows
        .filter((r) => r.boomFileId && (r.state === "completed" || r.state === "verified"))
        .map((r) => r.boomFileId as string);
      if (!files.length) return;
      try {
        const reads = await Promise.all(files.map((id) => reRead(id, { adjusted: next })));
        if (dead) return;
        set({ adjusted: next, statements: reads.flat(), notice: null });
      } catch {
        set({ notice: REREAD_FAILED });
      }
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

/** How long the room has been waiting, in the unit a banker would say it in. */
function minutesWaited(since: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - since) / 1000));
  if (seconds < 90) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
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
