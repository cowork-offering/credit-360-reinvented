import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Portal } from "../Portal";
import { BrandGlyph } from "../brand";
import { TypeIcon } from "../workroom/TypeIcon";
import { finaleAttrs, useFinale, withFinale, FINALE_SWEEP_MS } from "../workroom/finale";
import { GooFilter, LiquidMark } from "../workroom/Liquid";
import { expandLabel, rowForRead, settleAttrs, useSettleChoreography, type SettledRow } from "../workroom/settle";
import { STAGE_CAP } from "../workroom/stage";
import { Words } from "../workroom/Words";
import { renderMemo, renderPlanFor, sectionsFrom, type MemoSection, type RenderPlan } from "../../memo/renderMemo";
import { applyMemoOverrides, memoDateFrom, usesFromChanges, MEMO_TYPE_FOR, type MemoOverrides } from "../../memo/overrides";
import { NARRATIVE_SPECS, narrativePrompt, narrativesFromReply, specFor, type NarrativeSpec } from "../../memo/narrative";
import { attestedCount, fullyAttested, type MemoDraft, type MemoSectionRecord } from "../../memo/store";
import { reviewerFor, withReviewShell } from "../../memo/reviewShell";
import {
  applyEditedSections,
  attestationFrom,
  bindReviewBridge,
  liftReview,
  type ReviewFrame,
  type ReviewFrameWindow,
} from "../../memo/reviewBridge";
import { NOT_WIRED_LINE, notWired } from "../../memo/publish";
import type { RoomPublication as MemoPublication } from "../../memo/publishAdapter";
import type { MemoAttestation, MemoChange, MemoDossier, MemoNarratives } from "../../memo/types";
import { fmtMoney } from "../../data/format";
import { markWriting } from "../../memo/writingMark";
import {
  beginWork,
  endWork,
  finishRow,
  queueSteer,
  queuedSteers,
  rowForWork,
  secs,
  startRow,
  workFraction,
  workLead,
  workProgress,
  workProgressLine,
  type MemoWork,
} from "./progress";
import { createPaneBuffers, type BufferPane, type PaneBuffers, type PaneRole } from "./paneBuffer";
import type { MemoGreeting } from "./memoGreeting";
import type { MemoRequestSource, MemoTrigger } from "./memoSession";
import { DEADLINES, byDeadline, isDeadline, narrateDeadlineLine, steerDeadlineLine, withDeadline } from "../workroom/deadline";
import { RoomBoundary } from "../workroom/RoomBoundary";
import "../../styles/workroom.css";
import "../../styles/memo.css";

/* =============================================================================
   THE CREDIT MEMO WORKROOM. THE THIRD ROOM ON THE SAME GLASS.

   TWO ROOMS BEFORE THIS ONE ESTABLISHED THE GRAMMAR and this one keeps it to
   the letter: one sheet of glass, a conversation on the left, the room's own
   work on the right, a session rather than a script, settled exchanges that
   collapse, word budgets per moment, and a cinematic finale. What changes is
   what stands in the right lane. The other two rooms put a MANIFEST there,
   because they are about to write to the org. This one puts the DOCUMENT there,
   because the memo IS the work: the banker reads it while they talk about it.

   THE PANE TAKES THE WHOLE RIGHT LANE (66/34 at desktop, founder 2026-09-04:
   "we do not need the approve / flag chips, we have that inline panel in there
   anyway; use that space and make the credit memo interface wider"). The room
   used to hang its own Approve / Flag rail off the frame's edge, which was a
   second set of controls for a decision the memo already offers under each
   section; the rail is gone, its 138px went to the document, and the room now
   LISTENS to the memo's own review shell (`memo/reviewBridge.ts`). Under
   1080px the pane stacks under the conversation rather than shrinking to a
   column neither surface can use.

   THE RENDERER IS INSTANT AND DETERMINISTIC. `renderMemo(dossier)` produces the
   whole document with no model in the room, from the bundle and the executed
   changes alone; the substitution seam then replaces the vendored renderer's
   demo literals. Everything the session brain adds is PROSE, section by
   section, streamed into the pane around figures it is forbidden to invent
   (`memo/narrative.ts`). That split is the room's honesty: a figure on the
   glass came from a system of record, always.

   DRAFT UNTIL ATTESTED. The memo carries the plugin's own classification banner
   from the first frame and the room never removes it. The per-section sign-off
   is the MEMO'S (the plugin's review shell, injected into the frame by
   `memo/reviewShell.ts`), and what the room adds is the count above the pane
   and the door under it, which stays shut, with its reason on it, until every
   section has been reviewed as drafted or reviewed after an edit.
   ============================================================================= */

/* -----------------------------------------------------------------------------
   THE SEAM
   ----------------------------------------------------------------------------- */

export interface MemoContext {
  accountId: string;
  accountName: string;
  /** The package VERSION the memo is about. Null renders a memo that says so. */
  packageId: string | null;
  packageName?: string | null;
  trigger: MemoTrigger;
  /** `meta.user`. The relationship manager on the cover. */
  user?: string | null;
  /** `meta.generatedAt`. The room's only clock. */
  generatedAt: string;
  /** Where the request came from, where an instruction opened this session.
   *  Null is the common case: most memos are asked for by a banker. */
  source?: MemoRequestSource | null;
}

/** One call to the session brain. The room takes a function and asks nothing
 *  about what is on the other end of it, which is what lets the suite drive a
 *  scripted narrator and the cockpit drive the banker's own Claude. */
export type MemoNarrator = (args: {
  prompt: string;
  onText?: (text: string) => void;
  signal?: AbortSignal;
}) => Promise<string>;

export interface MemoDeps {
  narrate?: MemoNarrator;
  /** Phase D's writeback. Defaults to the honest stub in `memo/publish.ts`. */
  publish?: (draft: MemoDraft) => Promise<MemoPublication>;
  /** The store, injected so the round-trip is testable against a fake db. */
  save?: (draft: MemoDraft) => Promise<MemoDraft>;
  saveAttestations?: (draft: MemoDraft) => Promise<void>;
  /**
   * THE FRAME THE MEMO IS BEING READ IN, where the caller has one.
   *
   * jsdom never loads a `srcdoc` frame, so a test that had to reach through
   * `iframe.contentWindow` could not drive the memo's own review panel at all
   * and would be left asserting against a mock of it. This is the seam: hand
   * the room a document with the memo in it and a window the vendored shell
   * has run against, and the room reads the REAL shell's state.
   */
  frame?: ReviewFrame | null;
}

export interface MemoRoomProps {
  ctx: MemoContext;
  /** Built by the host from the bundle and the executed changes. */
  dossier: MemoDossier;
  /** The executed changes this memo is about. May be empty. */
  changes: readonly MemoChange[];
  greeting: MemoGreeting;
  /** The stored memo, where one exists, for "Open latest memo". */
  latest?: MemoDraft | null;
  deps?: MemoDeps;
  onClose: () => void;
}

/* -----------------------------------------------------------------------------
   THE THREAD
   ----------------------------------------------------------------------------- */

type Speaker = "agent" | "banker";

/**
 * WHAT STANDS IN THE CONVERSATION.
 *
 * `say`      one bubble, the rooms' own.
 * `work`     the working exchange: the timeline of what the desk is doing NOW.
 * `settled`  the compact row an exchange leaves behind, and the way back to it.
 *
 * EVERY ITEM CARRIES ITS EXCHANGE. The stage cap, the settle and the summon all
 * act on exchanges rather than on items, because "at most two live exchanges"
 * is a statement about a conversation and a bubble is not a conversation.
 */
type ThreadItem =
  | { id: string; ex: string; kind: "say"; who: Speaker; text: string }
  | { id: string; ex: string; kind: "work"; work: MemoWork }
  | { id: string; ex: string; kind: "settled"; row: SettledRow };

let seq = 0;
const nextId = (): string => `mm-${++seq}`;
const nextEx = (): string => `mx-${++seq}`;

/** The greeting is one exchange, and it is the first thing to settle. */
const GREETING_EX = "mx-greeting";

/** What the room says once the draft is on the glass and its timeline is a row. */
const DRAFTED_LINE =
  "The memo is drafted. Review each section in the pane, or name one and I will write it again.";

/** The line a steer that named nothing gets. A guess here rewrites the wrong
 *  paragraph of a credit document. */
const NAME_THE_SECTION =
  "Name the section and I will write that one again. Everything else in the memo is figures, and those come from the systems of record.";

/** The memo's own title for a module, or the module id read as words. */
function titleOf(id: string, sections: readonly MemoSection[]): string {
  return sections.find((s) => s.id === id)?.title ?? id.replace(/_/g, " ");
}

/**
 * THE ROW AN EXCHANGE LEAVES BEHIND when the stage cap sweeps it, rather than
 * when it finished something. A working exchange has its own receipt
 * (`rowForWork`); everything else is a line somebody said.
 */
function rowForExchange(ex: string, items: readonly ThreadItem[]): SettledRow {
  const own = items.filter((i) => i.ex === ex && i.kind !== "settled");
  for (const item of own) if (item.kind === "work") return rowForWork(item.work);
  const banker = own.find((i) => i.kind === "say" && i.who === "banker");
  if (banker && banker.kind === "say") return rowForRead(banker.text, "read");
  const first = own.find((i) => i.kind === "say");
  return rowForRead(first && first.kind === "say" ? first.text : "Earlier", "read");
}

/* -----------------------------------------------------------------------------
   WHICH SECTION A TYPED LINE IS ABOUT
   ----------------------------------------------------------------------------- */

/**
 * THE STEER, RESOLVED TO ONE MODULE.
 *
 * Deliberately coarse, and deliberately not a second parser: it matches the
 * banker's words against the module ids and the section titles the renderer
 * already stamped, and returns null when nothing matches. Null is answered with
 * a question rather than a guess, because guessing here rewrites the wrong
 * paragraph of a credit document.
 */
export function steerTarget(text: string, sections: readonly MemoSection[]): string | null {
  const line = text.toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const s of sections) {
    if (!specFor(s.id)) continue;
    const words = `${s.id.replace(/_/g, " ")} ${s.title}`.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
    const score = words.filter((w) => line.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: s.id, score };
  }
  return best?.id ?? null;
}

/* -----------------------------------------------------------------------------
   THE ROOM
   ----------------------------------------------------------------------------- */

/** THE FLOOR on how often the pane re-renders while prose is streaming into it.
 *  The whole memo is rebuilt on every re-render, so a per-token rebuild would
 *  spend the room's frame budget on a document nobody is reading yet.
 *
 *  IT IS A FLOOR AND NOT THE WHOLE RULE (founder, 2026-09-04: the room "gets
 *  delayed" while it drafts). A fixed 400ms is a promise the machine may not be
 *  able to keep: on a laptop under a screen share one rebuild is a full memo
 *  render, a review shell, and a browser parsing an entire document, which can
 *  take longer than the interval. The room then generated a second document
 *  before the first had landed, threw away a parse that was half done, and did
 *  it again, on the same thread the composer types into. So the pane's own
 *  readiness is the second half of the rule: see `busy` below. */
const STREAM_FRAME_MS = 400;

/** How many sections may run out of clock back to back before the draft stops
 *  asking. Two, because one is a slow section and two is a door that has
 *  stopped answering; nine of them is six minutes of a timeline that claims to
 *  be working. */
const LATE_SECTIONS_BEFORE_STOPPING = 2;

/** What one section's round trip did. `timeout` carries the room's own clock
 *  so the sentence can name how long it waited. */
type SectionOutcome = "ok" | "declined" | "no-desk" | { kind: "timeout"; error: unknown };
const wroteOk = (o: SectionOutcome): boolean => o === "ok";
const lateFrom = (o: SectionOutcome): unknown => (typeof o === "object" && o.kind === "timeout" ? o.error : null);

export function MemoRoom({ ctx, dossier, changes, greeting, latest, deps, onClose }: MemoRoomProps) {
  const narrate = deps?.narrate;
  const publish = deps?.publish ?? ((d) => Promise.resolve({ ...notWired(d.memoId, d.packageId), reason: NOT_WIRED_LINE }));

  /* ------------------------------------------------------------- the memo */

  /** The prose that has landed, keyed as the renderer reads it. */
  const [narratives, setNarratives] = useState<MemoNarratives>(() => ({}));
  /** Prose still arriving, for the module currently streaming. */
  const [streaming, setStreaming] = useState<MemoNarratives>(() => ({}));
  /** Per-section sign-off, lifted out of the memo's own review shell. */
  const [sectionState, setSectionState] = useState<Record<string, MemoSectionRecord>>({});
  /** Reading a stored memo rather than this session's draft. */
  const [readingStored, setReadingStored] = useState(false);

  /* THE MAP AND THE EDITS LIVE IN REFS, NOT IN STATE, and that is the whole
     reason the pane does not flicker. A `srcdoc` change RELOADS the frame:
     folding the sign-offs into the rendered html as state would reload the
     document on every approval, throwing away the reader's place and the
     shell's own edit in progress. So the map is read at the moment the memo is
     rebuilt for a reason of its own (a narrative landing, a steered section)
     and never causes that rebuild. `sectionState` carries the same facts for
     the count and the door, where a re-render is exactly what is wanted. */
  const attestation = useRef<MemoAttestation>({});
  const edits = useRef<Record<string, string>>({});

  const overrides: MemoOverrides = useMemo(
    () => ({
      rmName: ctx.user ?? null,
      // NO READ CARRIES A CREDIT OFFICER. The cover says so rather than
      // borrowing the demo's name (memo/overrides.ts).
      creditOfficer: null,
      memoDate: memoDateFrom(ctx.generatedAt),
      memoType: MEMO_TYPE_FOR[ctx.trigger] ?? MEMO_TYPE_FOR.adhoc,
      uses: usesFromChanges(changes, fmtMoney),
      guarantorRelation: guarantorRelationOf(dossier),
      proFormaFixedCharges: proFormaOf(dossier),
    }),
    [ctx.generatedAt, ctx.trigger, ctx.user, changes, dossier],
  );

  /** Who the badges name. The view's own user, on the room's only clock. */
  const reviewer = useMemo(
    () => reviewerFor(ctx.user, memoDateFrom(ctx.generatedAt), ctx.generatedAt),
    [ctx.user, ctx.generatedAt],
  );

  /** The dossier the pane is rendering: the room's own, with whatever prose has
   *  landed folded into it, and the sign-offs so far. Never mutated; the
   *  renderer sees a new object. */
  const liveDossier = useMemo<MemoDossier>(() => {
    const prose = { ...(dossier.canon.narratives ?? {}), ...narratives, ...streaming };
    // The map is read here, not depended on: see the refs above.
    return { ...dossier, canon: { ...dossier.canon, narratives: prose }, attestation: attestation.current };
  }, [dossier, narratives, streaming]);

  const rendered = useMemo(() => renderMemo(liveDossier), [liveDossier]);
  const html = useMemo(() => applyMemoOverrides(rendered.html, overrides), [rendered.html, overrides]);
  const plan: RenderPlan = useMemo(() => renderPlanFor(dossier), [dossier]);
  const sections = useMemo(() => sectionsFrom(html), [html]);

  /**
   * WHAT THE PANE SHOWS: this session's memo, or the stored one.
   *
   * Either way it goes in with the plugin's review shell around it and the
   * sign-offs replayed, so the checklist a banker is looking at survives a
   * narrative arrival, a steer, and coming back to a memo a week later.
   */
  const paneHtml = useMemo(() => {
    const source = readingStored && latest?.html ? latest.html : html;
    const map = readingStored && latest ? attestationFrom(latest.sections) : attestation.current;
    return withReviewShell(source, { reviewer, attestation: map, readOnly: readingStored });
  }, [html, readingStored, latest, reviewer]);

  const paneSections = useMemo(
    () => (readingStored && latest ? latest.sections : sections.map((s) => recordFor(s, sectionState))),
    [readingStored, latest, sections, sectionState],
  );

  const progress = attestedCount(paneSections);
  const attested = fullyAttested(paneSections);

  /* ---------------------------------------------------------- the thread */

  const reduced = usePrefersReducedMotion();
  const settle = useSettleChoreography(reduced);
  const { settle: settleItems } = settle;

  const [items, setItems] = useState<ThreadItem[]>(() => [
    { id: nextId(), ex: GREETING_EX, kind: "say", who: "agent", text: greeting.lead },
    ...greeting.lines.map(
      (line): ThreadItem => ({ id: nextId(), ex: GREETING_EX, kind: "say", who: "agent", text: line }),
    ),
    /* WHERE THE REQUEST CAME FROM, in one line, when an instruction opened this
       session. A memo written off a client email should say so on its face: the
       credit officer reading it later is entitled to know what asked for it. */
    ...(sourceLine(ctx.source)
      ? [{ id: nextId(), ex: GREETING_EX, kind: "say", who: "agent", text: sourceLine(ctx.source)! } as ThreadItem]
      : []),
    { id: nextId(), ex: GREETING_EX, kind: "say", who: "agent", text: greeting.ask },
  ]);
  const [draft, setDraft] = useState("");
  const [drafted, setDrafted] = useState(false);
  const [published, setPublished] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publication, setPublication] = useState<MemoPublication | null>(null);

  /**
   * THE THREAD, KEPT SYNCHRONOUSLY AS WELL AS IN STATE.
   *
   * The draft loop runs across awaits and has to be able to name the items an
   * exchange covers at the instant it settles it. A read of `items` there is a
   * read of the last render, which is one section behind by construction, so
   * every writer goes through here and the ref is always exact.
   */
  const itemsRef = useRef<ThreadItem[]>(items);
  const commit = useCallback((fn: (prev: readonly ThreadItem[]) => ThreadItem[]) => {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  /** The exchange anything the agent says right now belongs to. A banker line
   *  opens a new one; that is the only thing that does. */
  const exRef = useRef<string>(GREETING_EX);

  const say = useCallback(
    (who: Speaker, text: string, fresh = who === "banker") => {
      if (fresh) exRef.current = nextEx();
      const ex = exRef.current;
      commit((prev) => [...prev, { id: nextId(), ex, kind: "say", who, text }]);
    },
    [commit],
  );

  /* ------------------------------------------------- the settle and the cap

     THE ROOMS' OWN RULE 1, IN THIS ROOM (founder, 2026-09-04: "always showing
     only the latest two interactions"). An exchange that is over leaves the
     stage in the shared exit and one compact row takes its place, mounted and
     one click from coming back. This room used to dim every earlier bubble and
     keep it, so a draft plus three steers was twenty faded lines a banker could
     neither read nor dismiss; that is accumulation, not history. */

  const settleExchange = useCallback(
    (ex: string, row: SettledRow, land?: () => void) => {
      const ids = itemsRef.current.filter((i) => i.ex === ex && i.kind !== "settled").map((i) => i.id);
      if (!ids.length) {
        land?.();
        return;
      }
      const rowId = `row-${ex}`;
      commit((prev) => {
        // An exchange settles once. A second row would point at a receipt it
        // never had, and the choreography would restart its exit.
        if (prev.some((i) => i.kind === "settled" && i.ex === ex)) return prev as ThreadItem[];
        const at = prev.findIndex((i) => i.ex === ex);
        const item: ThreadItem = { id: rowId, ex, kind: "settled", row };
        return at < 0 ? [...prev, item] : [...prev.slice(0, at), item, ...prev.slice(at)];
      });
      settleItems(ids, rowId, land);
    },
    [commit, settleItems],
  );

  /* AT MOST TWO LIVE EXCHANGES, EVER, on the facility room's own constant
     rather than a second reading of the same rule (`workroom/stage.ts`). The
     sweep runs on the thread rather than at each call site, because the
     omission that room found is that there is never a last call site. */
  useEffect(() => {
    const live: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (item.kind === "settled") continue;
      if (settle.stateOf(item.id) !== "on") continue;
      if (seen.has(item.ex)) continue;
      seen.add(item.ex);
      live.push(item.ex);
    }
    if (live.length <= STAGE_CAP) return;
    for (const ex of live.slice(0, live.length - STAGE_CAP)) {
      settleExchange(ex, rowForExchange(ex, itemsRef.current));
    }
  }, [items, settle, settleExchange]);

  /* -------------------------------------------------------- the narration */

  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  /** THE PROSE SO FAR, KEPT SYNCHRONOUSLY. The prompt for section four has to
   *  know what section three said, and a React state read inside the same loop
   *  would still be showing section two. */
  const written = useRef<MemoNarratives>({});

  /** Ask for one module's prose and stream it into the pane. TRUE where the
   *  desk answered; false leaves the memo's own pending placeholder where it
   *  sits, which is the honest render of a section nobody wrote. */
  /** Whether the reading pane is mid-parse. Filled by `usePaneBuffers` further
   *  down the body; a ref because the streaming callback is created before it. */
  const paneBusy = useRef<() => boolean>(() => false);

  const writeSection = useCallback(
    async (spec: NarrativeSpec, title: string, steer?: string | null): Promise<SectionOutcome> => {
      if (!narrate) return "no-desk";
      const controller = new AbortController();
      abort.current = controller;
      let last = 0;
      const prompt = narrativePrompt({ spec, dossier, sectionTitle: title, steer, written: written.current });
      try {
        /* ============ THE DESK CARRIES A CLOCK, AND THE CLOCK CANCELS (2026-09-05)

           The sample lane takes an AbortSignal and honours it, so a section that
           has not answered inside its budget is not merely abandoned: the stream
           is stopped, and the tokens after it are never paid for. The budget is
           per SECTION, not per draft, so one slow section cannot take a
           nine-section memo down with it. A steer is shorter than a draft
           section for one reason: the banker is watching this one. */
        const stream = (expiry: AbortSignal) => {
          // The clock's own signal drives the door's: one abort, two listeners.
          expiry.addEventListener("abort", () => controller.abort());
          return narrate({
            prompt,
            signal: controller.signal,
            onText: (text) => {
              const now = Date.now();
              if (now - last < STREAM_FRAME_MS) return;
              /* THE PANE SETS THE PACE IT CAN ACTUALLY KEEP. While a document
                 is still being parsed, another rebuild would replace it before
                 it landed: the reader sees nothing sooner and the main thread
                 does the work twice. The text is not lost: it is still in
                 `reply`, and the section lands in full below whatever happened
                 here. */
              if (paneBusy.current()) return;
              last = now;
              setStreaming(narrativesFromReply(spec, text));
            },
          });
        };
        const reply = await withDeadline(
          stream,
          steer ? "steer" : "narrate",
          title,
          steer ? DEADLINES.steer : DEADLINES.narrate,
        );
        const landed = narrativesFromReply(spec, reply);
        written.current = { ...written.current, ...landed };
        setStreaming({});
        setNarratives((prev) => ({ ...prev, ...landed }));
        return "ok";
      } catch (e) {
        setStreaming({});
        /* THE SECTION IS LEFT WITH ITS PENDING MARKER EITHER WAY. What differs
           is what the room says: a desk that refused is absence, and a desk
           that ran out of clock is a fact the banker can act on. */
        return isDeadline(e) ? { kind: "timeout", error: e } : "declined";
      }
    },
    [narrate, dossier],
  );

  /* -------------------------------------------------- the working exchange

     FOUNDER, 2026-09-04: "it should be more like a timeline, think of when a
     connector connects in Claude Cowork, elegant, always showing only the
     latest two interactions, and clear that it is working on something."

     THE WORK IS ONE LIVE EXCHANGE, held in a ref because the loop that drives
     it runs across awaits and has to read what it itself last wrote, and
     mirrored into the thread so the timeline re-renders as it moves. The state
     machine and every sentence it prints are in `./progress.ts`. */

  const work = useRef<MemoWork | null>(null);
  const workItem = useRef<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  /** The module whose words are landing, for the mark in the document. */
  const [writing, setWriting] = useState<string | null>(null);
  const writingRef = useRef<string | null>(null);
  writingRef.current = writing;

  const liveWork = useMemo(() => {
    const item = workingId ? items.find((i) => i.id === workingId) : null;
    return item && item.kind === "work" ? item.work : null;
  }, [items, workingId]);

  const pushWork = useCallback(
    (next: MemoWork) => {
      work.current = next;
      const id = workItem.current;
      if (!id) return;
      commit((prev) => prev.map((i) => (i.id === id && i.kind === "work" ? { ...i, work: next } : i)));
    },
    [commit],
  );

  const openWork = useCallback(
    (kind: "draft" | "steer", rows: ReadonlyArray<{ id: string; title: string }>) => {
      const next = beginWork({
        kind,
        packageName: ctx.packageName ?? ctx.packageId ?? "this package",
        sections: rows,
        now: Date.now(),
      });
      const id = nextId();
      work.current = next;
      workItem.current = id;
      setWorkingId(id);
      const ex = exRef.current;
      commit((prev) => [...prev, { id, ex, kind: "work", work: next }]);
      return next;
    },
    [commit, ctx.packageId, ctx.packageName],
  );

  /** The next steer, through a ref: a queued line runs a steer, and a steer can
   *  itself close over a queued line. One indirection breaks the cycle. */
  const steerNext = useRef<(line: string) => Promise<void>>(async () => {});

  /**
   * THE WORK IS OVER: it settles into the rooms' compact row, and whatever the
   * banker queued while it ran happens next, after the exit and never on top of
   * it, which is the same handover `settle.ts` gives every other exchange.
   */
  const closeWork = useCallback(
    (ex: string, then?: () => void) => {
      const current = work.current;
      if (!current) {
        then?.();
        return;
      }
      const done = endWork(current, Date.now());
      pushWork(done);
      work.current = null;
      workItem.current = null;
      setWorkingId(null);
      setWriting(null);
      const queued = queuedSteers(done);
      settleExchange(ex, rowForWork(done), () => {
        if (!queued.length) {
          then?.();
          return;
        }
        void (async () => {
          for (const line of queued) await steerNext.current(line);
        })();
      });
    },
    [pushWork, settleExchange],
  );

  /* ------------------------------------------------------------ the store */

  const buildDraft = useCallback(
    (): MemoDraft => ({
      memoId: `memo-${ctx.packageId ?? ctx.accountId}-${ctx.generatedAt}`,
      accountId: ctx.accountId,
      packageId: ctx.packageId ?? ctx.accountId,
      trigger: ctx.trigger,
      generatedAt: ctx.generatedAt,
      generator: "cockpit",
      renderPlan: plan,
      sections: sections.map((s) => recordFor(s, sectionState)),
      /* THE PROSE, READ SYNCHRONOUSLY (2026-09-05). `written` is the copy the
         draft loop keeps for exactly this reason: it is current the instant a
         section lands, where the state behind `narratives` is current only
         after React has committed. The store write fires at the END of the
         loop, and a builder reading state could be handed the memo as it stood
         one section ago. Merged rather than substituted so a narrative that
         only ever existed in state is still carried. */
      narratives: { ...narratives, ...written.current },
      /* THE BANKER'S WORDS OUTRANK THE RENDERER'S. Where a section was edited
         in the frame, what is stored is the section as the banker left it. */
      html: applyEditedSections(html, edits.current),
      htmlStored: true,
    }),
    [ctx, plan, sections, sectionState, narratives, html],
  );

  const saveAttest = deps?.saveAttestations;
  const save = deps?.save;
  const latestDraft = useRef(buildDraft);
  latestDraft.current = buildDraft;
  useEffect(() => {
    if (!saveAttest || !Object.keys(sectionState).length) return;
    /* THE BUILDER IS READ THROUGH A REF ON PURPOSE. The write is triggered by an
       ATTESTATION and by nothing else; depending on the builder itself would
       fire it on every render the memo changes, which is every token of prose. */
    void saveAttest(latestDraft.current());
  }, [sectionState, saveAttest]);

  /* ------------------------------------------------------- the attestation */

  /** The sections the pane is showing, for the lift and for the timeline's
   *  titles. A ref so the bridge is bound once per document rather than once
   *  per token of prose. */
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  /* ------------------------------------------------- the draft and the steer */

  /** Rewrite one named section, as its own exchange with its own single row. */
  const runSteer = useCallback(
    async (line: string) => {
      say("banker", line);
      const target = steerTarget(line, sectionsRef.current);
      const spec = target ? specFor(target) : null;
      if (!target || !spec) {
        say("agent", NAME_THE_SECTION);
        return;
      }
      setReadingStored(false);
      const title = titleOf(target, sectionsRef.current);
      const ex = exRef.current;
      const started = openWork("steer", [{ id: target, title }]);
      pushWork(startRow(started, target, Date.now()));
      setWriting(target);
      const outcome = await writeSection(spec, title, line);
      pushWork(finishRow(work.current ?? started, target, Date.now(), !wroteOk(outcome)));
      const late = lateFrom(outcome);
      closeWork(ex, late ? () => say("agent", steerDeadlineLine(late, title), true) : undefined);
    },
    [say, openWork, pushWork, writeSection, closeWork],
  );
  steerNext.current = runSteer;

  /** Draft every narrative section the render plan switched on, in order. */
  const runDraft = useCallback(async () => {
    /* A SECOND DRAFT WHILE ONE IS RUNNING IS NOT A CONVERSATION TURN. The room
       is visibly working; a line saying "already drafting" over its own
       timeline would be the room arguing with a banker who can see the answer
       (founder, 2026-09-04). It is ignored, and nothing is said. */
    if (work.current) return;
    setReadingStored(false);
    const planned = new Set(plan.modules.map((m) => m.id));
    const specs = NARRATIVE_SPECS.filter((s) => planned.has(s.module));

    if (!narrate) {
      // NO DESK IN THIS VIEW. The memo is already whole and deterministic; only
      // the prose is missing, and the room says which half it is short of.
      say("agent", "The desk is not connected, so the memo stands on its figures and the narrative slots stay pending.");
      setDrafted(true);
      return;
    }

    /* THE GREETING COLLAPSES TO ONE LINE the moment the work starts, exactly as
       the other two rooms retire their opening tiers when the first card lands. */
    settleExchange(GREETING_EX, rowForRead(greeting.lead, "read"));

    const ex = exRef.current;
    const started = openWork(
      "draft",
      specs.map((s) => ({ id: s.module, title: titleOf(s.module, sectionsRef.current) })),
    );
    /* ONE SECTION SHORT IS A GAP; NINE IS A DEAD DESK (2026-09-05).

       A section that ran out of clock does not stop the draft: the memo is
       whole and deterministic without any of the prose, and the other eight are
       worth having. But a draft that kept going would spend forty seconds per
       section against a door that has already stopped answering twice, and nine
       of those is six minutes of a timeline that says "working" and is not.
       Two consecutive is the room's evidence that the desk is gone, and it
       stops there and names what it did not write. */
    const late: string[] = [];
    let lateError: unknown = null;
    let consecutive = 0;
    for (const spec of specs) {
      const title = titleOf(spec.module, sectionsRef.current);
      if (consecutive >= LATE_SECTIONS_BEFORE_STOPPING) {
        late.push(title);
        continue;
      }
      pushWork(startRow(work.current ?? started, spec.module, Date.now()));
      setWriting(spec.module);
      const outcome = await writeSection(spec, title);
      pushWork(finishRow(work.current ?? started, spec.module, Date.now(), !wroteOk(outcome)));
      const err = lateFrom(outcome);
      if (err) {
        late.push(title);
        lateError = err;
        consecutive += 1;
      } else {
        consecutive = 0;
      }
    }
    setDrafted(true);
    /* THE DRAFT OUTLIVES THE VIEW. A memo that were only stored on publication
       would leave "Open latest memo" with nothing to open for every memo a
       banker started and came back to. */
    if (save) void save(latestDraft.current());
    closeWork(ex, () =>
      say(
        "agent",
        lateError
          ? `${narrateDeadlineLine(lateError, late.length === 1 ? late[0] : `${late.length} sections`)} ` +
            "The memo stands on its figures, and I will write the rest when the desk answers."
          : DRAFTED_LINE,
        true,
      ),
    );
  }, [plan, narrate, say, settleExchange, greeting.lead, openWork, pushWork, writeSection, closeWork, save]);

  /**
   * THE MEMO SAID SOMETHING; THE ROOM HEARD IT.
   *
   * Called once when a document is bound and again after every approve, edit,
   * undo and review-all inside it. Everything the room knows about the
   * sign-off enters here and nowhere else.
   */
  const lift = useCallback((frame: ReviewFrame) => {
    const read = liftReview(frame, sectionsRef.current);
    attestation.current = read.attestation;
    edits.current = { ...edits.current, ...read.edits };
    setSectionState((prev) => (sameRecords(prev, read.records) ? prev : read.records));
  }, []);

  /* WRITING THE ATTESTATION BACK IS BOOKKEEPING, NEVER A GATE. The glass has
     already recorded it; a store that refused the write leaves the room exactly
     as it is (memo/store.ts). */

  /* --------------------------------------------------------- the composer */

  const send = useCallback(
    async (text: string) => {
      const line = text.trim();
      if (!line || published || publishing) return;
      setDraft("");
      /* THE COMPOSER STAYS ALIVE WHILE THE ROOM WORKS (founder, 2026-09-04:
         "the chat becomes unresponsive during draft or steer"). A line typed
         mid-draft is neither refused nor run over the top of the work: it joins
         the timeline, in the banker's own words, as the next thing that will
         happen. */
      if (work.current) {
        pushWork(queueSteer(work.current, line));
        return;
      }
      await runSteer(line);
    },
    [published, publishing, pushWork, runSteer],
  );

  /* ----------------------------------------------------------- the finale */

  const finale = useFinale(reduced);
  const finaleState = finale.state;

  const onPublish = useCallback(async () => {
    if (!attested || publishing || published) return;
    setPublishing(true);
    /* THE PUBLISH CARRIES THE WRITE BUDGET. It is five connector writes behind
       one gesture; past forty-five seconds the room stops waiting on the socket
       and says what it knows, which is that it cannot see the outcome. */
    let result: Awaited<ReturnType<typeof publish>>;
    try {
      result = await byDeadline(publish(buildDraft()), "execute", "publishing this memo");
    } catch (e) {
      setPublishing(false);
      say(
        "agent",
        isDeadline(e)
          ? "The publish call has not answered in 45 seconds. I will not tell you it failed, because I cannot see that. " +
              "Check the memo in nCino before publishing again, and nothing here has changed in the meantime."
          : NOT_WIRED_LINE,
        true,
      );
      return;
    }
    setPublication(result);
    /* THE STORE IS BOOKKEEPING AND NEVER A GATE: a save that hung would hold
       the room on a publication that has already happened. */
    if (save) await byDeadline(save(buildDraft()), "execute", "storing this memo").catch(() => {});
    if (result.status !== "published") say("agent", result.reason ?? NOT_WIRED_LINE, true);
    setPublished(true);
    setPublishing(false);
  }, [attested, publishing, published, publish, buildDraft, save, say]);

  useEffect(() => {
    if (!published) return;
    finale.begin(items.map((i) => i.id));
  }, [published, finale, items]);

  /* ------------------------------------------------------------- the pane */

  const paneA = useRef<HTMLIFrameElement | null>(null);
  const paneB = useRef<HTMLIFrameElement | null>(null);
  /** Whichever of the two the reader is looking at. */
  const onGlass = useRef<HTMLIFrameElement | null>(null);
  const bridge = useRef<(() => void) | null>(null);
  const liftRef = useRef(lift);
  liftRef.current = lift;
  const injected = deps?.frame ?? null;
  /* A STORED MEMO IS NOT BOUND. Its sign-offs belong to the session that took
     them, and lifting them would fold another memo's map into this one's. */
  const listening = !readingStored;
  const listeningRef = useRef(listening);
  listeningRef.current = listening;

  /* THE BRIDGE FOLLOWS THE DOCUMENT ACROSS THE SWAP. Each buffer is a new
     window with a new review shell in it, so the bind happens the moment a
     document has loaded and before it is on the glass. */
  const bindTo = useCallback(
    (el: HTMLIFrameElement | null) => {
      bridge.current?.();
      bridge.current = null;
      if (!el || injected || !listeningRef.current) return;
      const doc = el.contentDocument;
      const win = el.contentWindow as unknown as ReviewFrameWindow | null;
      if (!doc || !win) return;
      bridge.current = bindReviewBridge({ doc, win }, (f) => liftRef.current(f));
    },
    [injected],
  );

  useEffect(
    () => () => {
      bridge.current?.();
      bridge.current = null;
    },
    [],
  );
  useEffect(() => {
    if (listening) return;
    bridge.current?.();
    bridge.current = null;
  }, [listening]);

  /* THE SEAM. Where the caller hands the room a frame, that frame IS the frame:
     it is how the suite drives the vendored shell's own buttons in jsdom, which
     never loads a `srcdoc` document at all. */
  useEffect(() => {
    if (!injected || !listening) return;
    return bindReviewBridge(injected, (f) => liftRef.current(f));
  }, [injected, listening]);

  const onPaneReady = useCallback(
    (el: HTMLIFrameElement) => {
      onGlass.current = el;
      bindTo(el);
      const doc = el.contentDocument;
      if (doc) markWriting(doc, writingRef.current);
    },
    [bindTo],
  );

  usePaneBuffers({ a: paneA, b: paneB, html: paneHtml, reduced, onReady: onPaneReady, busy: paneBusy });

  /* WHERE THE WORDS WILL LAND, MARKED WHERE THE BANKER IS READING. */
  useEffect(() => {
    const doc = injected?.doc ?? onGlass.current?.contentDocument ?? null;
    if (doc) markWriting(doc, writing);
  }, [writing, injected]);

  const publishReason = !attested
    ? `${progress.total - progress.done} section${progress.total - progress.done === 1 ? "" : "s"} still to attest`
    : null;

  return (
    <Portal>
      <div className="wk-root">
        <div className="wk-scrim" onClick={onClose} role="presentation" />
        <div
          className="wk-room mm-room eg-glass eg-glass-workroom"
          data-finale={finaleState === "off" ? undefined : finaleState}
          role="dialog"
          aria-modal="true"
          aria-label="Credit memo"
        >
          <div className="wk-glass-sheet" aria-hidden="true" />
          {/* THE METABALL FILTER, ONCE PER ROOM. The timeline's writing row
              breathes on the same mark the other two rooms compose with, and
              `filter: url(#wk-goo)` needs the filter to be in this document. */}
          <GooFilter />
          <header className="wk-head">
            <BrandGlyph />
            <span className="wk-title">Credit memo</span>
            <span className="wk-pkgline" data-pkgline={ctx.packageId ?? "none"}>
              <span className="wk-pkgline-k">Package</span>
              <span className="wk-pkgline-v">{ctx.packageName ?? ctx.packageId ?? "not anchored"}</span>
            </span>
            <span className="wk-spacer" />
            <button type="button" className="wk-icobtn" onClick={onClose} aria-label="Close the workroom">
              ×
            </button>
          </header>

          <div className="wk-body mm-body">
            <div className="wk-col-l mm-col-l">
              <section className="wk-thread" data-finale={finaleState === "still" ? "still" : undefined}>
                {/* THE SAME EXCHANGE THE OTHER TWO ROOMS RENDER (founder,
                    2026-09-04: the memo room's conversation was bare text).
                    `settleAttrs` for the wrapper, `.wk-msg.wk-agent` /
                    `.wk-msg.wk-banker` for the side and the identity chip that
                    hangs above it on hover, `.wk-bub` for the bubble, and
                    `<Words>` for the word-by-word speech. Not one class of its
                    own: three rooms, one grammar. */}
                {items.map((item, i) => {
                  const inWave = finaleState === "off" ? null : finaleAttrs(i, finaleState);
                  /* THE SETTLED ROW ITSELF NEVER LEAVES. It is what replaces an
                     exchange, not part of one, so it always stands `on`. */
                  const attrs = settleAttrs(
                    item.kind === "settled" ? "on" : settle.stateOf(item.id),
                    settle.heightOf(item.id),
                  );
                  return (
                    <div key={item.id} data-ex-id={item.id} {...withFinale(attrs, inWave)}>
                      {/* THE INNER ROW IS WHAT COLLAPSES. A grid track can only
                          squeeze a child that will let it, so the row owns the
                          overflow and the wrapper owns the height transition. */}
                      <div className="wk-ex-in">
                        {/* ONE BAD ITEM IS ONE BAD ITEM (2026-09-05). A row the
                            memo cannot render leaves its own gap marker and the
                            timeline above and below it keeps working. */}
                        <RoomBoundary what={`this ${item.kind}`}>
                          {item.kind === "settled" ? (
                            <SettledLine
                              row={item.row}
                              open={settle.isOpen(item.id)}
                              onToggle={() => settle.toggle(item.id)}
                              id={item.id}
                            />
                          ) : item.kind === "work" ? (
                            <WorkTimeline work={item.work} />
                          ) : (
                            <div className={`wk-msg wk-${item.who}`} data-who={item.who === "banker" ? "You" : "Agent"}>
                              <div className="wk-bub">
                                {item.who === "agent" ? <Words text={item.text} /> : item.text}
                              </div>
                            </div>
                          )}
                        </RoomBoundary>
                      </div>
                    </div>
                  );
                })}

                {/* THE CHIPS THE GREETING OFFERED. They retire the moment the
                    memo has been drafted: a chip that repeats work already on
                    the glass is the fourth chip the rooms' rule 30 bans. */}
                {!drafted && !published && (
                  <div className="wk-opts mm-chips">
                    {greeting.chips.map((chip) => (
                      <button
                        type="button"
                        className="wk-opt mm-chip"
                        key={chip.id}
                        data-chip={chip.id}
                        disabled={publishing || (chip.id === "open" && !latest)}
                        onClick={() => {
                          if (chip.id === "draft") {
                            /* A SECOND DRAFT WHILE ONE RUNS IS IGNORED, and no
                               line is said about it (founder, 2026-09-04). */
                            if (work.current) return;
                            say("banker", "Draft it.");
                            void runDraft();
                            return;
                          }
                          if (chip.id === "steer") {
                            say("banker", "Steer me first.");
                            say("agent", "Name the section and say what should change in it.");
                            return;
                          }
                          setReadingStored(true);
                          say("banker", "Open the latest memo.");
                          say("agent", "The stored memo is in the pane, read only, with the attestations it was saved with.");
                        }}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* THE AFTERGLOW. One door and one quiet line, under the card,
                    exactly as the other two rooms end. */}
                {finaleState === "still" && (
                  <div className="wk-afterglow" data-finale="afterglow">
                    <button type="button" className="wk-ag-close" onClick={onClose}>
                      Close workroom
                    </button>
                    <span className="wk-ag-note">
                      {publication?.status === "published"
                        ? "The memo is in nCino and the package is with the approver."
                        : NOT_WIRED_LINE}
                    </span>
                  </div>
                )}
              </section>

              <div className="wk-composer eg-pill" hidden={published}>
                <input
                  className="wk-txt"
                  value={draft}
                  /* NEVER SHUT WHILE THE ROOM WORKS, only while a publish runs
                     (founder, 2026-09-04). A line typed mid-draft joins the
                     timeline and runs when the draft is done. */
                  disabled={publishing || published}
                  placeholder={
                    liveWork
                      ? "Name a section; it runs when this finishes."
                      : "Name a section and say what should change in it."
                  }
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    void send(draft);
                  }}
                  aria-label="Steer the memo"
                />
                <button type="button" className="wk-send" aria-label="Send" onClick={() => void send(draft)}>
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

            {/* ======================= THE READING PANE, where the rail sits */}
            <aside
              className="mm-pane"
              aria-label="The credit memo"
              data-finale={finaleState === "off" ? undefined : finaleState}
            >
              <div className="mm-pane-h">
                {/* ONE QUIET LINE, FROM THE SHELL'S OWN COUNTS. The decision
                    is under each section, in the memo; this is the room saying
                    how far the work has got. */}
                {/* ONE LINE, TWO READINGS. While the room is working it says
                    what it is working on ("Drafting: 3 of 7 sections"); the
                    rest of the time it is the shell's own attestation count.
                    Same altitude, same weight: the banker never has to look in
                    two places to know where the memo stands. */}
                <span
                  className="mm-prog"
                  data-progress={
                    liveWork
                      ? `${workProgress(liveWork).done}/${workProgress(liveWork).total}`
                      : `${progress.done}/${progress.total}`
                  }
                  data-working={liveWork ? liveWork.kind : undefined}
                >
                  {liveWork ? workProgressLine(liveWork) : `${progress.done} of ${progress.total} sections reviewed`}
                </span>
                <span className="mm-plan">{planSentence(plan)}</span>
              </div>
              {plan.suppressed.length > 0 && (
                /* SUPPRESSED IS NOT A GAP (references/conditionality.md). One
                   quiet line, opened only by a reader who wants the reasons. */
                <details className="mm-supp">
                  <summary>{plan.suppressed.length} suppressed by the deal's flags</summary>
                  <ul>
                    {plan.suppressed.map((entry) => (
                      <li key={entry.id}>
                        <b>{entry.name}</b>
                        <span>{entry.reason}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {/* TWO FRAMES, ONE DOCUMENT ON THE GLASS (founder, 2026-09-04:
                  "right now it flickers and updates, not sexy"). A `srcdoc`
                  change RELOADS a frame, so the old document is torn down
                  before the new one exists and the pane flashes once per
                  section. The next document is built in the hidden one and
                  crossfades in when it is whole, at the reader's own scroll
                  offset; `./paneBuffer.ts` owns the choreography and neither
                  frame is ever blank. Both are SAME ORIGIN on purpose: the
                  memo's own stylesheet has to apply and the room has to read
                  the review shell's state out of the document. */}
              <div className="mm-frame">
                <iframe ref={paneA} className="mm-doc" data-buffer="a" data-role="visible" title="Credit memo" />
                <iframe
                  ref={paneB}
                  className="mm-doc"
                  data-buffer="b"
                  data-role="hidden"
                  title="Credit memo, arriving"
                  aria-hidden="true"
                />
              </div>

              <div className="mm-foot">
                {/* THE BUTTON ARRIVES WHEN THE WORK IS DONE (founder, 2026-09-04:
                    like Review and execute, it appears rather than sits greyed).
                    Until then the foot carries one quiet line of where the
                    attestation stands. */}
                {attested && !published ? (
                  <button
                    type="button"
                    className="mm-publish"
                    disabled={publishing}
                    onClick={() => void onPublish()}
                  >
                    Publish to nCino and submit for approval
                  </button>
                ) : (
                  publishReason && !published && <span className="mm-why">{publishReason}</span>
                )}
              </div>
            </aside>
          </div>

          {/* THE CARD THE PANE EXHALES INTO. It is mounted from the moment the
              publish resolves, and it ascends into the space the drain made. */}
          {published && (
            <div
              className="mm-final"
              style={{ "--wk-fin-hold": `${finale.hold}ms`, "--wk-fin-sweep": `${FINALE_SWEEP_MS}ms` } as CSSProperties}
            >
              <div className="wk-rescard mm-card">
                <span className="aura" aria-hidden="true" />
                <div className="rc-h">
                  <TypeIcon kind="package" />
                  <b>Credit memo attested</b>
                </div>
                <div className="rc-line" />
                <div className="rc-r">
                  <TypeIcon kind="commit" />
                  <span>Sections</span>
                  <b>{progress.total}</b>
                </div>
                <div className="rc-r">
                  <TypeIcon kind="package" />
                  <span>Version</span>
                  <b>{ctx.packageId ?? "not anchored"}</b>
                </div>
                {publication?.nforms?.templateId && (
                  <div className="rc-r">
                    <TypeIcon kind="package" />
                    <span>nFORMS memo</span>
                    <b>{publication.nforms.templateId}</b>
                  </div>
                )}
                <div className="rc-line" />
                <div className="rc-f">
                  <span className={publication?.status === "published" && !publication.simulated ? "ok" : ""}>
                    {publication?.status === "published" && !publication.simulated ? "✓" : "·"}
                  </span>
                  {/* "SUBMITTED" ONLY WHEN THE ORG SAW IT. A fixture answer or a
                      failed lane reads as its own sentence, never as a publication. */}
                  {publication?.status === "published" && !publication.simulated
                    ? `Submitted for approval${publication.approval?.queue ? ` to ${publication.approval.queue}` : ""}.`
                    : (publication?.reason ?? NOT_WIRED_LINE)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

/* -----------------------------------------------------------------------------
   SMALL THINGS THE ROOM NEEDS
   ----------------------------------------------------------------------------- */

/** What asked for this memo, in one line, or nothing at all. */
function sourceLine(source: MemoRequestSource | null | undefined): string | null {
  if (!source) return null;
  const what = source.subject ? `"${source.subject}"` : null;
  const who = source.from ? ` from ${source.from}` : "";
  return `This one was asked for by ${source.kind}${who}${what ? `: ${what}` : ""}.`;
}

/** A section's record, from the sign-off state or as it stands: draft. */
function recordFor(section: MemoSection, state: Record<string, MemoSectionRecord>): MemoSectionRecord {
  return state[section.id] ?? { id: section.id, title: section.title, status: "draft" };
}

/** TRUE where a lift said nothing new. The bridge reads the shell on every
 *  bind as well as on every change, so most reads say exactly what the room
 *  already knew; setting state on those would re-render the room for nothing. */
function sameRecords(a: Record<string, MemoSectionRecord>, b: Record<string, MemoSectionRecord>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => {
    const x = a[k];
    const y = b[k];
    return !!y && x.status === y.status && x.note === y.note && x.by === y.by && x.at === y.at;
  });
}

/** The render plan, in the one line above the pane. */
function planSentence(plan: RenderPlan): string {
  return `${plan.modules.length} module${plan.modules.length === 1 ? "" : "s"} on`;
}

/**
 * THE GUARANTOR'S RELATIONSHIP TO THE BORROWER, from the graph.
 *
 * The dossier already carries the guarantor the graph named; what the memo's
 * relationship row wants is the ROLE and the ownership behind it. Absent means
 * absent: the substitution seam writes the marker rather than the demo's line.
 */
function guarantorRelationOf(dossier: MemoDossier): string | null {
  const g = dossier.canon.guarantor;
  if (!g) return null;
  const parts = [g.type === "individual" ? "Individual guarantor" : "Entity guarantor"];
  if (g.guarantyType && !g.guarantyType.startsWith("[")) parts.push(g.guarantyType);
  return parts.join(", ");
}

/**
 * THE PRO FORMA FIXED-CHARGE CELL.
 *
 * The demo printed "~$2.5M". What the cockpit can stand behind is the INTEREST
 * component implied by the ratios (EBITDA over interest coverage); scheduled
 * principal is on no read this page has. So the figure is stated for what it
 * is, and where the ratios do not carry both parts the seam writes the marker.
 */
function proFormaOf(dossier: MemoDossier): string | null {
  const r = dossier.canon.ratios;
  if (!r || r.ebitda == null || !r.interestCoverage) return null;
  const interest = r.ebitda / r.interestCoverage;
  if (!Number.isFinite(interest) || interest <= 0) return null;
  return `${fmtMoney(interest)} interest; scheduled principal not carried`;
}

/** The room's reduced-motion reading. jsdom has no matchMedia, which is why
 *  every render test sees the finale land in one commit (finale.ts). */
function usePrefersReducedMotion(): boolean {
  return useMemo(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
}

/* -----------------------------------------------------------------------------
   THE WORKING EXCHANGE, DRAWN
   ----------------------------------------------------------------------------- */

/**
 * WHAT THE ROOM IS DOING, WHILE IT IS DOING IT.
 *
 * One lead line and one row per section of the manifest, in the order the
 * renderer will print them. The row being written carries the rooms' own
 * breathing mark with the ">" FILLING to the draft's overall progress (founder,
 * 2026-09-04: "gentle loading with the > getting filled"); the rows behind it
 * carry a check and the seconds the desk took; the rows ahead carry a quiet dot
 * and nothing else. A line the banker typed while this ran stands at the foot,
 * in their own words, as the next thing that will happen.
 *
 * ONE LOADER AT A TIME, which is the facility room's rule and the reason there
 * is no separate "Composing…" beat under this: whatever is breathing on the
 * glass is where the words are going.
 */
function WorkTimeline({ work }: { work: MemoWork }) {
  const filled = workFraction(work);
  return (
    <div className="mm-work" data-work={work.kind} role="status" aria-live="polite">
      <div className="mm-work-lead">{workLead(work)}</div>
      <ol className="mm-tl">
        {work.rows.map((row) => (
          <li key={row.id} className="mm-tl-row" data-state={row.state} data-kind={row.kind} data-row={row.id}>
            <span className="mm-tl-mark" style={{ "--mm-p": filled } as CSSProperties}>
              {row.state === "writing" ? (
                <>
                  <LiquidMark />
                  {/* THE SAME MARK AGAIN, IN THE ACCENT, CLIPPED TO PROGRESS.
                      The stylesheet does the clipping off `--mm-p`; this is the
                      ">" filling and not a second kind of loader. */}
                  <span className="mm-tl-fill" aria-hidden="true">
                    <BrandGlyph />
                  </span>
                </>
              ) : (
                <span className="mm-tl-dot" aria-hidden="true">
                  {row.state === "done" ? "✓" : "·"}
                </span>
              )}
            </span>
            <span className="mm-tl-t">{row.title}</span>
            <span className="mm-tl-s">
              {row.state === "done" && row.ms != null ? secs(row.ms) : row.state === "missed" ? "pending" : ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * THE COMPACT ROW AN EXCHANGE BECOMES (rule 1, the rooms' own shape).
 *
 * Two facts and a control: what settled, how, and the way back to the whole
 * thing. It is a BUTTON rather than a row with a button in it, because the
 * whole row is the affordance and a keyboard reaches it in one tab either way.
 */
function SettledLine({
  row,
  open,
  onToggle,
  id,
}: {
  row: SettledRow;
  open: boolean;
  onToggle: () => void;
  id: string;
}) {
  return (
    <button type="button" className="wk-settled" data-settled-row={id} aria-expanded={open} onClick={onToggle}>
      {row.kicker && <span className="wk-settled-k">{row.kicker}</span>}
      <span className="wk-settled-w">{row.what}</span>
      <span className="wk-settled-dot" aria-hidden="true">
        ·
      </span>
      <span className="wk-settled-h">{row.how}</span>
      <span className="wk-settled-x">{expandLabel(open)}</span>
    </button>
  );
}

/* -----------------------------------------------------------------------------
   THE PANE, DOUBLE BUFFERED
   ----------------------------------------------------------------------------- */

/** One real iframe, as `paneBuffer.ts` sees it. Nothing above this line knows
 *  what an iframe is, which is what makes the whole swap testable in jsdom. */
function paneFor(el: HTMLIFrameElement): BufferPane {
  const scroller = () => {
    const doc = el.contentDocument;
    return doc?.scrollingElement ?? doc?.documentElement ?? null;
  };
  /* WHAT THIS FRAME IS SUPPOSED TO BE SHOWING, or null when it has been
     emptied. Blanking a frame fires its `load` exactly the way a real document
     does, and that event would otherwise reach the buffer's own handler and
     swap an empty page onto the glass. The load is only the load we asked for
     when the frame is carrying the document we last wrote. */
  let want: string | null = null;
  return {
    write: (html) => {
      want = html;
      el.srcdoc = html;
    },
    onLoad: (cb) => {
      const guarded = () => {
        if (want !== null && el.srcdoc === want) cb();
      };
      el.addEventListener("load", guarded);
      return () => el.removeEventListener("load", guarded);
    },
    /* TWO FRAMES, ONE DOCUMENT (founder, 2026-09-04: the room gets "delayed"
       while it drafts). The pane needs two frames to swap without blanking; it
       does not need two MEMOS resident, each with its own stylesheet, layout
       and compositor layers, for the whole of a seven-section draft. Once the
       dissolve is over the frame that lost is emptied, and the next present
       parses into an empty frame exactly as the first one did. */
    unload: () => {
      want = null;
      el.srcdoc = "";
    },
    scrollTop: () => scroller()?.scrollTop ?? null,
    scrollTo: (top) => {
      const s = scroller();
      if (s) s.scrollTop = top;
    },
    role: (role: PaneRole) => {
      el.dataset.role = role;
      el.setAttribute("aria-hidden", role === "hidden" ? "true" : "false");
    },
  };
}

/**
 * THE DOCUMENT ON THE GLASS, NEVER BLANKED.
 *
 * Two effects, in this order on purpose: the buffers are built once for the
 * pair of frames, and every new document is presented through them. A present
 * before the buffers exist would be a document written into a frame nothing is
 * listening to.
 */
function usePaneBuffers(args: {
  a: React.RefObject<HTMLIFrameElement | null>;
  b: React.RefObject<HTMLIFrameElement | null>;
  html: string;
  reduced: boolean;
  onReady: (el: HTMLIFrameElement) => void;
  /** Filled with "is a document still being parsed", for the stream pacing. */
  busy?: React.MutableRefObject<() => boolean>;
}): void {
  const { a, b, html, reduced } = args;
  const ready = useRef(args.onReady);
  ready.current = args.onReady;
  const buffers = useRef<PaneBuffers | null>(null);
  const frames = useRef<[HTMLIFrameElement, HTMLIFrameElement] | null>(null);

  useEffect(() => {
    const one = a.current;
    const two = b.current;
    if (!one || !two) return;
    frames.current = [one, two];
    const built = createPaneBuffers({
      panes: [paneFor(one), paneFor(two)],
      reduced,
      onReady: (_pane, index) => {
        const el = frames.current?.[index];
        if (el) ready.current(el);
      },
    });
    buffers.current = built;
    if (args.busy) args.busy.current = () => built.pending();
    return () => {
      built.dispose();
      buffers.current = null;
      if (args.busy) args.busy.current = () => false;
    };
    // `busy` is a ref container and is stable; depending on it would rebuild the
    // buffers on every render and blank the pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b, reduced]);

  useEffect(() => {
    buffers.current?.present(html);
  }, [html]);
}
