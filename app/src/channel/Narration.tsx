import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrainEnvelope } from "./brainLane";
import { LiquidMark } from "../components/workroom/Liquid";
import {
  ACT_WORDS,
  clipBudget,
  composeNarratePrompt,
  cutPlanRestatement,
  GREETING_MAX_SENTENCES,
  guardClaims,
  NARRATION_MAX_SENTENCES,
  parseNarration,
  resolveEntities,
  shouldNarrate,
  type NarrateSubject,
  type NarrationBlock,
  type NarrationSpan,
} from "./narrate";
import {
  askSession,
  primeConsent,
  sampleAvailable,
  takeDeclineNotice,
  type AskSessionOptions,
} from "./sampleDoor";
import { startPacer, unitsOf, type Pacer } from "./streamPacer";
import { prefersReducedMotion } from "../data/motion";

/* =============================================================================
   THE REMARK, ON THE GLASS — the thin hook and the one component.

   The room calls `useNarration` ONCE and renders `<Narration>` under a thread
   item. That is the whole integration surface: the deterministic layer is not
   touched, the card is not touched, and a room with the feature off renders
   exactly what it renders today.

   THE THINKING PULSE IS THE ROOM'S OWN. `LiquidMark` under `.wk-compose` is
   what the room already shows while it composes, so a remark arriving reads as
   the same room thinking, not as a second system loading.
   ============================================================================= */

/** The beat between one block of a landed remark and the next. The founder's
 *  own cadence for a paced reveal is 250 to 400ms; this is the middle of it. */
export const BLOCK_BEAT_MS = 300;

export interface NarrationView {
  /**
   * THE GUARDED BLOCKS, FINAL FROM THE FIRST FRAME.
   *
   * FOUNDER, 2026-09-03: "the text in the workroom flickers: some chat bubbles
   * grow and then shrink, and it kicks out the nice bullet listing." They did.
   * The remark was rendered from the RAW stream and the guards ran on the
   * finished text, so a sentence the figure guard was going to strip was shown
   * first and taken away after, and a line item whose head had not landed yet
   * was rendered as a paragraph and became a row a frame later.
   *
   * NOTHING IS EVER REPLACED NOW. The room waits for the completed text, runs
   * every guard once, and only then reveals - so what the banker sees is only
   * ever appended to, and the row count is the final row count from the first
   * paint.
   */
  blocks: NarrationBlock[];
  /** HOW MUCH OF THE PROSE HAS BEEN REVEALED, in words. The blocks do not
   *  change; this is the only thing that moves. Rows and bullets are structure
   *  and are shown whole, so a list never assembles itself in front of the
   *  reader. */
  reveal?: number;
  /** THE PACER IS STILL RELEASING. The block reserves its height while this is
   *  true, so the pane below it does not walk up and down the page. */
  streaming?: boolean;
  /** TRUE from the call leaving the page until the first streamed token. */
  pending: boolean;
  /**
   * TRUE WHERE THE MODEL ACTUALLY SPOKE (founder drive, 2026-09-02).
   *
   * The room reads this to know whether it still owes the banker its own
   * paragraph. A decline notice is the room's sentence, not the model's, so it
   * leaves this false and the deterministic explanation stands: degrade parity
   * is a contract and the reduction may never be one of the ways it is lost.
   */
  spoke: boolean;
}

export interface NarrationDeps {
  /**
   * FALSE turns the whole feature off and the room renders today's sentences.
   * Channel-none parity is a contract, not a fallback.
   */
  enabled: boolean;
  /** Builds the envelope a remark is grounded in. Called lazily, per remark, so
   *  the book it sees is the book as it stands when the card lands. */
  envelopeFor: (line: string) => BrainEnvelope;
  /** The door. Injected so the suite never touches a global. */
  ask?: (prompt: string, options: AskSessionOptions) => Promise<string>;
  /** The consent moment. Injected for the same reason. */
  prime?: (prompt: string, options: AskSessionOptions) => Promise<string | null>;
}

export interface NarrationHook {
  /**
   * STOP TALKING.
   *
   * The runtime got in the way and the banker has one thing to do. Every remark
   * still in flight is cancelled and no new one is asked for until the room
   * says the exchange has moved on. The founder read two model paragraphs under
   * a host error that had nothing to do with either of them.
   */
  hush(): void;
  /** The exchange moved on: the model may speak again. */
  unhush(): void;
  /**
   * THE OPENING, AND THE ONE CONSENT MOMENT.
   *
   * Called once when the room opens, on the greeting the banker just asked for
   * by opening it. The platform's consent dialog appears framed by that
   * greeting, never mid-plan and never between a card and its sentence.
   */
  open(id: string, subject: NarrateSubject): void;
  /** Narrate what the room just did, under the item that carries it. */
  narrate(id: string, subject: NarrateSubject, line?: string): void;
  viewFor(id: string): NarrationView | undefined;
  /** IS A REMARK BREATHING SOMEWHERE. The room reads it to stand its own
   *  compose beat down: two loaders in two places, taking turns, read as one
   *  loader jumping around the glass. */
  pending: boolean;
}

export function useNarration(deps: NarrationDeps): NarrationHook {
  const [views, setViews] = useState<Record<string, NarrationView>>({});
  const running = useRef(new Map<string, AbortController>());
  /** One pacer per remark, cancelled with the room. */
  const pacers = useRef(new Map<string, Pacer>());
  /** ONE REMARK PER ITEM, EVER. The hook's returned object changes identity as
   *  the remark streams, so a caller's effect will re-fire on its own updates:
   *  without this latch that is an infinite loop rather than a second remark. */
  const asked = useRef(new Set<string>());
  /** The runtime got in the way: no remark until the exchange moves on. */
  const hushed = useRef(false);
  const { enabled, envelopeFor } = deps;
  const ask = deps.ask ?? askSession;
  const prime = deps.prime ?? primeConsent;

  useEffect(() => {
    const inflight = running.current;
    const paced = pacers.current;
    return () => {
      for (const controller of inflight.values()) controller.abort();
      inflight.clear();
      for (const p of paced.values()) p.cancel();
      paced.clear();
    };
  }, []);

  /** WHERE A REMARK CANNOT BE HAD, THE DETERMINISTIC SENTENCE STANDS ALONE.
   *  The one exception is a decline: the room says the one sentence, once, in
   *  the place the remark would have been, and never mentions it again. */
  const settle = useCallback((id: string) => {
    const notice = takeDeclineNotice();
    setViews((prev) => {
      const next = { ...prev };
      if (notice) next[id] = { blocks: [{ kind: "line", spans: [{ text: notice }] }], pending: false, spoke: false };
      else delete next[id];
      return next;
    });
  }, []);

  const run = useCallback(
    (id: string, subject: NarrateSubject, line: string, greeting: boolean) => {
      if (!enabled || !sampleAvailable()) return;
      if (hushed.current) return;
      if (!greeting && !shouldNarrate(subject)) return;
      if (asked.current.has(id)) return;
      asked.current.add(id);

      const controller = new AbortController();
      running.current.set(id, controller);
      setViews((prev) => ({ ...prev, [id]: { blocks: [], pending: true, spoke: false } }));

      /* ONE ENVELOPE, FOR THE LIFE OF THE REMARK. The prompt the model is
         given and the book the row's figures are resolved out of must be the
         same instance, or a row could print a figure from a book the model
         never saw. */
      const envelope = envelopeFor(line);
      /* THE GUARDS RUN ON THE FINISHED REMARK, NOT ON EVERY PARTIAL. A
         half-streamed "$5.2M" is a different figure from the "$5.2MM" it is
         about to become, so marking mid-stream would flicker a warning on and
         off under a sentence the model has not finished writing. */
      /* THE PROSE CAP IS PER ACT. Two sentences under a card, three on the
         greeting, whose shape is the addendum's own lead, rows and close. */
      const cap = greeting ? GREETING_MAX_SENTENCES : NARRATION_MAX_SENTENCES;
      /* THE WORD BUDGET IS ENFORCED ON THE GLASS, NOT ONLY IN THE PROMPT
         (founder, 2026-09-03). It runs on every read, streamed and settled
         alike: a remark that grew past its budget mid-stream and was cut back
         at the end would be a paragraph the banker watched arrive and then
         watched shrink. The cut is at whole sentences and whole rows. */
      const budget = ACT_WORDS[subject.act];
      /**
       * GUARD BEFORE REVEAL (founder, 2026-09-03).
       *
       * ONE pass, on the COMPLETED text, in the order the rules depend on each
       * other: parse to the grammar, resolve each row's rail out of the book,
       * drop a run that only restates the plan, run the claim and figure guards,
       * then spend the act's word budget on what survived. What comes back is
       * what the banker will read, and it is the only thing ever rendered.
       */
      const guarded = (text: string): NarrationBlock[] => {
        const blocks = resolveEntities(parseNarration(text, cap), envelope);
        const held = cutPlanRestatement(blocks, envelope, subject);
        return clipBudget(guardClaims(held, envelope, subject).blocks, budget);
      };
      const prompt = composeNarratePrompt(envelope, subject);

      /* ============ THE REMARK ARRIVES AT A READABLE PACE (founder, 2026-09-03)

         "The streamed narration feels stuck and jerky." It was: the door hands
         over whatever the model produced since the last callback, and a model
         produces in bursts, so the glass showed a stall and then a paragraph.

         THE PACER BUFFERS AND RELEASES AT A STEADY WORD RATE, on the frame
         clock. Every guard still runs on the prefix exactly as it ran on the
         raw delta - the pacer cannot change what a remark SAYS, only when the
         reader gets to see it - and the last emit is the door's own text, byte
         for byte. Under reduced motion there is no pacer at all. */
      /* THE RAW STREAM IS NOT RENDERED. `onText` is deliberately absent: a
         partial is a sentence the guards have not seen, and showing one is how
         the bubble grew and then shrank. The thinking mark stands until the
         guarded text exists, which is the honest picture of what the room is
         doing anyway. */
      const options: AskSessionOptions = {
        kind: greeting ? "greeting" : "narrate",
        tier: "quick",
        rung: 2,
        signal: controller.signal,
      };

      const call = greeting ? prime(prompt, options) : ask(prompt, options);
      void Promise.resolve(call)
        .then((text) => {
          if (hushed.current) {
            settle(id);
            return;
          }
          const blocks = guarded(typeof text === "string" ? text : "");
          if (!blocks.length) {
            settle(id);
            return;
          }
          /* AND THE GUARDED TEXT IS WHAT IS PACED. The rows are structure and
             land whole; the prose writes itself at a readable rate over them.
             `reveal` only ever grows, so the glass only ever gains words. */
          const prose = proseOf(blocks);
          const total = unitsOf(prose).length;
          setViews((prev) => ({
            ...prev,
            [id]: { blocks, reveal: 0, pending: false, spoke: true, streaming: total > 0 },
          }));
          if (!total || prefersReducedMotion()) {
            setViews((prev) => ({ ...prev, [id]: { blocks, reveal: total, pending: false, spoke: true } }));
            return;
          }
          /* AN EMIT THAT CARRIES NO NEW WORD COMMITS NOTHING (D2/F1, founder
             latency brief 2026-09-12: "110% zero latency and smooth
             transitions"). The pacer runs on the frame clock at 26 words a
             second against 60fps, so on a 51-word remark 39 of its 90 emits
             release the same prefix as the frame before. Each one used to be a
             `setViews` returning a FRESH object, which React can never bail out
             of, so the largest component in the build re-rendered forty times
             for no change on the glass. Returning `prev` unchanged where both
             `reveal` and `streaming` match is the bail-out. The pacer's own
             emit semantics are untouched: `streamPacer.test.ts` reads the first
             frame's emit and it is still made. */
          const pacer = startPacer({
            emit: (visible, done) =>
              setViews((prev) => {
                const reveal = unitsOf(visible).length;
                const streaming = !done;
                const held = prev[id];
                if (held && held.reveal === reveal && held.streaming === streaming) return prev;
                return {
                  ...prev,
                  [id]: { blocks, reveal, pending: false, spoke: true, streaming },
                };
              }),
          });
          pacers.current.set(id, pacer);
          pacer.finish(prose);
        })
        .catch(() => settle(id))
        .finally(() => running.current.delete(id));
    },
    [ask, enabled, envelopeFor, prime, settle],
  );

  const hush = useCallback(() => {
    hushed.current = true;
    for (const c of running.current.values()) c.abort();
    running.current.clear();
    for (const p of pacers.current.values()) p.cancel();
    pacers.current.clear();
  }, []);
  const unhush = useCallback(() => {
    hushed.current = false;
  }, []);

  return useMemo(
    () => ({
      open: (id, subject) => run(id, subject, "", true),
      narrate: (id, subject, line = "") => run(id, subject, line, false),
      viewFor: (id) => views[id],
      pending: Object.values(views).some((v) => v.pending),
      hush,
      unhush,
    }),
    [hush, run, unhush, views],
  );
}

/** The PROSE a remark carries, which is the only part that is paced. Rows and
 *  bullets are structure and are never assembled in front of the reader. */
function proseOf(blocks: NarrationBlock[]): string {
  return blocks
    .filter((b) => b.kind === "line")
    .map((b) => (b.kind === "line" ? b.spans.map((sp) => sp.text).join("") : ""))
    .join(" ")
    .trim();
}

/**
 * THE REMARK, DRAWN IN THE ROOM'S OWN TYPOGRAPHY.
 *
 * It is an agent bubble, because that is what it is: the room speaking. It
 * carries light structure only — a short bullet list and a bold figure — parsed
 * out of the model's text into these elements, so no markdown character ever
 * reaches the glass.
 */
export function Narration({ view }: { view?: NarrationView }): React.JSX.Element | null {
  if (!view) return null;
  if (view.pending) {
    return (
      <div className="wk-msg wk-agent wk-narr" data-who="Agent">
        <div className="wk-bub wk-narr-wait" role="status" aria-label="Thinking">
          <LiquidMark />
        </div>
      </div>
    );
  }
  if (!view.blocks.length) return null;
  /* NO LAYOUT THRASH WHILE IT WRITES (founder, 2026-09-03). A remark that grows
     a line at a time walks everything under it down the page a line at a time.
     The block reserves three lines of height while the pacer is releasing and
     lets go the moment it finishes, so the pane settles once instead of on
     every frame. */
  /* THE PROSE IS REVEALED, THE STRUCTURE IS NOT (founder, 2026-09-03). Rows and
     bullets are the remark's shape and they render whole from the first paint,
     so a three-item list is three items in every frame it exists. Only the
     sentences write themselves, and they only ever gain words. */
  let left = view.reveal ?? Number.POSITIVE_INFINITY;
  const revealed = (spans: NarrationSpan[]): NarrationSpan[] => {
    if (left === Number.POSITIVE_INFINITY) return spans;
    if (left <= 0) return [];
    const out: NarrationSpan[] = [];
    for (const span of spans) {
      const words = span.text.match(/\S+\s*/g) ?? [];
      if (!words.length) {
        out.push(span);
        continue;
      }
      if (words.length <= left) {
        left -= words.length;
        out.push(span);
        continue;
      }
      out.push({ ...span, text: words.slice(0, left).join("") });
      left = 0;
      break;
    }
    return out;
  };
  return (
    <div className="wk-msg wk-agent wk-narr" data-who="Agent" data-streaming={view.streaming ? "true" : undefined}>
      <div className={`wk-bub${view.streaming ? " wk-narr-live" : ""}`}>
        {view.blocks.map((block, i) => {
          /* NEVER A SIMULTANEOUS DUMP (founder, 2026-09-03). A remark that
             landed whole - the door answered in one go, or the reader has
             asked for no pacing - still arrives a block at a time, one beat
             apart, so the lead line is read before the rows land under it.
             While the PACER is running the words are already arriving one at a
             time and a second stagger on top of it would fight it. */
          const beat = view.streaming ? undefined : { animationDelay: `${i * BLOCK_BEAT_MS}ms` };
          if (block.kind === "line") {
            const shown = revealed(block.spans);
            // A line the pacer has not reached yet keeps its place in the
            // block list and renders nothing: the shape never changes, only
            // what is written into it.
            return (
              <p className="wk-narr-line wk-narr-block" style={beat} key={i}>
                {shown.map((span, j) => (span.bold ? <b key={j}>{span.text}</b> : <span key={j}>{span.text}</span>))}
              </p>
            );
          }
          if (block.kind === "bullets")
            return (
              <ul className="wk-narr-list wk-narr-block" style={beat} key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    {item.map((span, k) => (span.bold ? <b key={k}>{span.text}</b> : <span key={k}>{span.text}</span>))}
                  </li>
                ))}
              </ul>
            );
          /* THE QUIET MARK (2026-09-02). The room's own note that a figure in
             the remark above is on no read it holds. It is not the model's
             text, so it is not parsed out of it and it never carries a span:
             it is one muted line under the bubble it is about. */
          if (block.kind === "mark")
            return (
              <p className="wk-narr-mark" key={i}>
                {block.text}
              </p>
            );
          /* THE LINE ITEM. The read card's own row vocabulary, minus its icon:
             three 20px glyphs inside an agent bubble read as a second card,
             which is the boundary the four-channel rule draws. The bold name is
             the mark. A SEPARATE list, so a resolved run never lands in
             `.wk-narr-list` and the bullet contract stays exactly as it was. */
          return (
            <ul className="wk-narr-rows wk-narr-block" style={beat} key={i}>
              {block.rows.map((row, j) => (
                <li className={`wk-narr-row${row.tone ? ` wk-${row.tone}` : ""}`} key={j}>
                  <span className="wk-narr-row-l">
                    <b>{row.label.map((span) => span.text).join("")}</b>
                    {": "}
                    {row.spans.map((span, k) => (span.bold ? <b key={k}>{span.text}</b> : <span key={k}>{span.text}</span>))}
                  </span>
                  {row.value && <span className="wk-narr-row-v tnum">{row.value}</span>}
                </li>
              ))}
            </ul>
          );
        })}
      </div>
    </div>
  );
}
