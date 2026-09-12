/* =============================================================================
   THE SESSION DOOR — window.claude.use("sample").

   THE RECORDED DECISION (handoff line 93) is that the workroom brain runs on the
   USER's session Claude: their identity, their account, their connectors, zero
   infrastructure. The code drifted to the gateway's Bedrock endpoint, which is
   Boom's door and not this one. This module is the correct door, written against
   the runtime contract rather than from memory.

   THE CONTRACT, IN FIVE LINES. `await claude.use("sample")` resolves the
   function or NULL. `await sample(input, {onText, signal, tools, modelTier,
   cache})` resolves `{text, truncated, modelTierApplied}` or rejects with ONE
   shape, `{code, message, text?}`. Every call is memory-less and there is no
   system prompt the page controls, so everything the model knows travels in the
   input. Consent is PER CALL, not per `use()`: a viewer who declines still gets
   the function and every call rejects `not_granted`.

   SO: ABSENCE, NEVER AN ERROR ON THE GLASS. Null, declined, rate-limited or
   timed out all mean the same thing to the room — the session door did not
   answer, take the next rung down. The banker is never shown a stack, a red
   banner or a retry loop. The room runs today's behaviour exactly.

   CONSENT RIDES THE GREETING (founder, 2026-09-02). The platform's one-time
   per-view dialog must appear at the ONE natural moment: the room opening, on
   the greeting the banker just asked for by opening the room. Never mid-plan,
   never between a card and its sentence. `primeConsent` is that call, and it is
   idempotent per view: one consent moment, every later call silent.
   ============================================================================= */

import { markCall, type CallKind, type CallProbe, type CallTier } from "./sampleMetrics";

/* ------------------------------------------------------------ the contract */

export interface SampleTextUpdate {
  /** The WHOLE answer so far. Assign it, never append it. */
  text: string;
  /** Only what was added since the previous call. */
  delta: string;
}

export interface SampleToolContext {
  signal: AbortSignal;
}

/** One page function offered to the model. Read-only by construction here: see
 *  channel/brainTools.ts, which is the only place tools are built. */
export interface SampleTool {
  name: string;
  description: string;
  inputSchema?: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
  execute(input: Record<string, unknown>, context: SampleToolContext): unknown;
  /** PAGE-SIDE ONLY, never sent to the model (the platform reads name,
   *  description and inputSchema and nothing else). TRUE where the envelope
   *  this call travelled with already answered this tool, which makes reaching
   *  for it an OVER-CALL: the number the latency gate turns on. */
  heldAlready?: () => boolean;
}

export interface SampleOptions {
  onText?: (update: SampleTextUpdate) => void;
  signal?: AbortSignal;
  tools?: SampleTool[];
  modelTier?: CallTier;
  cache?: boolean | { gcTime?: number; refresh?: boolean };
}

export interface SampleResult {
  text: string;
  truncated: boolean;
  modelTierApplied: CallTier;
}

interface SampleFn {
  (input: string, options?: SampleOptions): Promise<SampleResult>;
  json?<T = unknown>(input: string, options?: SampleOptions): Promise<T>;
}

type ClaudeRoot = { use?: (name: string) => Promise<unknown> };

/* --------------------------------------------------------- the acquisition */

let acquired: SampleFn | undefined;
let acquisition: Promise<void> | undefined;

/**
 * ACQUIRE THE DOOR, ONCE, BOUNDED, BEFORE FIRST RENDER.
 *
 * Exactly the shape `acquireMcp` uses, and for the same reason: `use()` is
 * asynchronous and decides `null` about ten seconds after load in the worst
 * case, so the room awaits acquisition once and every synchronous gate
 * downstream keeps its meaning. A door that never resolves is a door that is
 * not there.
 */
export function acquireSample(timeoutMs = 4000): Promise<void> {
  if (acquisition) return acquisition;
  acquisition = (async () => {
    if (typeof window === "undefined") return;
    const root = (window as unknown as { claude?: ClaudeRoot }).claude;
    if (!root || typeof root.use !== "function") return;
    try {
      const fn = await Promise.race([
        root.use("sample"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (typeof fn === "function") acquired = fn as SampleFn;
    } catch {
      // Unavailable is a state, not an error. The room hides the feature.
    }
  })();
  return acquisition;
}

/** TRUE where this view has a session door at all. Synchronous, so it may be
 *  read anywhere after `acquireSample()` has settled. */
export function sampleAvailable(): boolean {
  return acquired !== undefined && !declined;
}

/* --------------------------------------------------------- consent, per view

   Consent is per CALL in the contract, and permanent per VIEW in practice: a
   viewer who declines makes every later call reject `not_granted`. So the door
   remembers the decline, stops asking, and the room says the one sentence once.
   These codes mean "hide the feature for this view", never "try again".      */

const PERMANENT_CODES = new Set([
  "not_granted",
  "sampling_disabled",
  "not_declared",
  "capability_disabled",
  "capability_removed",
]);

let declined = false;
let declineSaid = false;

/** WHAT THE ROOM SAYS WHEN THE DESK IS NOT CONNECTED. Banker language, said
 *  once per view and never repeated. Not an error state: no red, no retry. */
export const DECLINE_NOTICE =
  "Working from the file only. The desk is not connected, so I will answer from what is here and stage what the engines can read.";

/** TRUE once this view has declined (or the platform has taken the door away). */
export function sessionDeclined(): boolean {
  return declined;
}

/** The decline sentence, the FIRST time the room asks for it, and null every
 *  time after. A room that repeated it would be nagging about a decision the
 *  banker already made. */
export function takeDeclineNotice(): string | null {
  if (!declined || declineSaid) return null;
  declineSaid = true;
  return DECLINE_NOTICE;
}

/* ------------------------------------------------------------- the failure */

/** Why the session door did not answer. `permanent` is the whole branch the
 *  room cares about: hide the feature, or take the next rung down this once. */
export interface SessionFailure {
  code: string;
  message: string;
  /** Whatever had streamed before the failure, which the caller may keep. */
  text?: string;
  permanent: boolean;
}

const failureOf = (err: unknown): SessionFailure => {
  const e = (err ?? {}) as { code?: unknown; message?: unknown; text?: unknown };
  const code = typeof e.code === "string" ? e.code : "upstream_error";
  const permanent = PERMANENT_CODES.has(code);
  if (permanent) declined = true;
  return {
    code,
    message: typeof e.message === "string" ? e.message : String(err),
    text: typeof e.text === "string" ? e.text : undefined,
    permanent,
  };
};

const UNAVAILABLE: SessionFailure = {
  code: "unavailable",
  message: "no session door in this view",
  permanent: true,
};

/* ------------------------------------------------------------- the two arms */

export interface AskSessionOptions {
  /** `quick` for restatement, `default` for judgment. The ladder picks it. */
  tier?: CallTier;
  signal?: AbortSignal;
  onText?: (update: SampleTextUpdate) => void;
  /**
   * THE FIRST TOKEN LANDED (B2, founder latency brief 2026-09-12).
   *
   * The platform already tells us the moment the model starts writing: the
   * `onText` wrapper below calls `probe.firstToken()` on it, and until now that
   * signal died in `sampleMetrics` with nothing on the glass reading it. A room
   * that shows one undifferentiated breathing mark for up to 150 seconds can
   * use it to move its own mark from reading to writing.
   *
   * CALLED AT MOST ONCE PER CALL, and never for a call the model answered
   * without streaming. It carries no text on purpose: the structured reply
   * cannot be rendered from a partial (`Narration.tsx` documents why), so this
   * is a beat and not a stream.
   */
  onFirstToken?: () => void;
  /** Page functions for a rung-3 call. Never passed with `cache`. */
  tools?: SampleTool[];
  /** Off by default: a room answering the same line twice usually means the
   *  book moved under it. The greeting is the one stable exception. */
  cache?: boolean | { gcTime?: number; refresh?: boolean };
  /** What this call is FOR, for the latency gate. */
  kind?: CallKind;
  /** The rung the router picked, for the over-call reading. */
  rung?: 2 | 3;
  /** Called for each page function the model reached, with whether the envelope
   *  already held the answer. The over-call rate is built from this. */
  onToolCall?: (name: string, overCall: boolean) => void;
}

/** The tools a call exposed, so `execute` can report itself to the gate. */
type ToolReporter = (name: string, overCall: boolean) => void;

/**
 * ASK THE SESSION, AND COME BACK WITH TEXT.
 *
 * Rejects with a {@link SessionFailure} and never with a raw platform error.
 * It never retries: the contract is explicit that only `upstream_error` is
 * transient and that a page must never retry from a loop.
 */
export async function askSession(prompt: string, options: AskSessionOptions = {}): Promise<string> {
  const fn = acquired;
  if (!fn || declined) throw UNAVAILABLE;

  const tier: CallTier = options.tier ?? "quick";
  const probe = markCall({ kind: options.kind ?? "reply", tier, rung: options.rung ?? 2 });
  try {
    const result = await fn(prompt, callOptions(tier, options, probe));
    probe.done();
    return result.text;
  } catch (err) {
    const failure = failureOf(err);
    probe.failed(failure.code);
    throw failure;
  }
}

/**
 * ASK THE SESSION FOR ONE OF THE THREE SHAPES, and come back with the RAW TEXT.
 *
 * `sample.json` is used where the runtime has it, because the platform then
 * tells the model its reply will be machine-parsed and compliance is measurably
 * better for it. The value is handed back SERIALISED rather than parsed,
 * because the room already owns a hard validator (`parseBrainReply`) and two
 * parsers would mean two ideas of what a legal reply is. On `invalid_json` the
 * raw reply is returned instead, so the room's own extractor gets its chance at
 * a reply with a sentence wrapped around it, and degrades honestly if not.
 */
export async function askSessionJson(prompt: string, options: AskSessionOptions = {}): Promise<string> {
  const fn = acquired;
  if (!fn || declined) throw UNAVAILABLE;
  if (typeof fn.json !== "function") return askSession(prompt, options);

  const tier: CallTier = options.tier ?? "quick";
  const probe = markCall({ kind: options.kind ?? "reply", tier, rung: options.rung ?? 2 });
  try {
    const value = await fn.json<unknown>(prompt, callOptions(tier, options, probe));
    probe.done();
    return JSON.stringify(value);
  } catch (err) {
    const failure = failureOf(err);
    probe.failed(failure.code);
    // A reply the platform could not parse may still hold the object our own
    // extractor finds. Give it that chance rather than degrading twice.
    if (failure.code === "invalid_json" && failure.text) return failure.text;
    throw failure;
  }
}

/** The options object handed to the platform, with the tool arms wrapped so
 *  every call the model makes is reported to the latency gate. */
function callOptions(tier: CallTier, options: AskSessionOptions, probe: CallProbe): SampleOptions {
  const report: ToolReporter = (name, over) => {
    probe.tool(name, over);
    options.onToolCall?.(name, over);
  };
  let spoke = false;
  const out: SampleOptions = {
    modelTier: tier,
    signal: options.signal,
    onText: (update) => {
      probe.firstToken();
      if (!spoke) {
        spoke = true;
        options.onFirstToken?.();
      }
      options.onText?.(update);
    },
  };
  if (options.tools?.length) {
    // A call with tools is never cached: the contract rejects `invalid_request`
    // for any cache value but `false` beside them, so the key is simply absent.
    out.tools = options.tools.map((tool) => reporting(tool, report));
  } else if (options.cache !== undefined) {
    out.cache = options.cache;
  }
  return out;
}

/** THE TOOL, REPORTING ITSELF. The wrapper is the only thing between the model
 *  and a page function, so it is also the only honest place to count what was
 *  called. `overCall` is the tool's own judgement (see brainTools). */
function reporting(tool: SampleTool, report: ToolReporter): SampleTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    execute: (input, context) => {
      report(tool.name, tool.heldAlready?.() === true);
      return tool.execute(input, context);
    },
  };
}

/* ------------------------------------------------------ the consent moment */

let priming: Promise<string | null> | undefined;

/**
 * THE ONE CONSENT MOMENT, at room open, on the greeting.
 *
 * The platform asks the viewer to allow this artifact to use their Claude on
 * the FIRST call of a view, and the call waits while they decide. So the first
 * call must be the one the banker just asked for by opening the room: the
 * greeting. The dialog then arrives framed by a sentence that explains itself,
 * never mid-plan and never between a card and its sentence.
 *
 * IDEMPOTENT PER VIEW. The promise is memoised, so a re-render, a strict-mode
 * double effect or a second room cannot trigger a second consent. It is never
 * called from a timer or a loop, and never before the banker has opened a room.
 *
 * Resolves with the model's line, or NULL for every kind of absence. The
 * greeting the room composed deterministically is already on the glass; this
 * can only add to it.
 */
export function primeConsent(prompt: string, options: AskSessionOptions = {}): Promise<string | null> {
  if (priming) return priming;
  priming = (async () => {
    try {
      // The greeting is stable across loads, so the contract's own advice
      // applies: cache it. A reload is a new view and a new consent anyway.
      return await askSession(prompt, { ...options, kind: "greeting", tier: "quick", cache: true });
    } catch {
      return null;
    }
  })();
  return priming;
}

/** TRUE once the consent moment has been taken in this view. */
export function consentPrimed(): boolean {
  return priming !== undefined;
}

/** Reset every per-view fact. For the suite only: a real view is reset by a
 *  reload, which is a new view and a new consent. */
export function resetSessionDoor(): void {
  acquired = undefined;
  acquisition = undefined;
  declined = false;
  declineSaid = false;
  priming = undefined;
}
