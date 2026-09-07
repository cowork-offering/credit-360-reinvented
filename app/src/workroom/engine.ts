import type { PlanStep, StagedOutput } from "../actions/stagedPlan";
import { HAVE, MEMBERS } from "./fixture";
import { vocabularyFor } from "./modes";
import { scriptFor, type SourceChip, type WhyRow, type WorkroomScript } from "./scripts";
import { greetingFor } from "./viewer";
import type {
  HaveRow,
  IntentResult,
  PackageMember,
  StagedWorkroomPlan,
  WorkroomAcknowledgement,
  WorkroomApproval,
  WorkroomContext,
  WorkroomDelta,
  WorkroomExecution,
  WorkroomMode,
} from "./types";

/* =============================================================================
   THE ENGINE SEAM.

   The shell talks to ONE interface and never to a script, a tool or a parser.
   Everything the room knows about the world arrives through these five calls,
   which is the whole point: the wiring waves swap the implementation and the
   room does not notice.

     brief       — "read the room". What the entry scene says, what the package
                   strip holds, and what the agent read to say it.
     suggest     — the next natural move, offered as a pill. Null when the room
                   is waiting on the banker rather than on a new instruction.
     pick        — the banker chose a member off the package strip. The engine
                   answers with what can change on it. Null where the engine has
                   no read behind the strip to talk about.
     parseIntent — natural language in, PROPOSED deltas out. Or an honest
                   refusal. Or "I did not understand that". Never a fake parse.
     acknowledge — a chip landed. What that DID, in banker language, and the
                   check the new figures trip. Never silence.
     stagePlan   — the confirmed deltas become ONE immutable plan. Zero DML.
     execute     — the token is redeemed and the plan runs. Verified, or it does
                   not come back.

   EVERY BANKER MOVE HAS A CONVERSATIONAL CONSEQUENCE, and the two calls that
   guarantee it are `pick` and `acknowledge`. A room whose engine answers the
   first four and goes quiet on a confirm is a room that files in silence, which
   is the one thing a change set under one approval may never do.

   THE SCRIPTED ENGINE below implements all five off a storyline. It is a shell
   engine and says so: it writes nothing, it reaches no tool, and its plan hash
   is a local digest rather than the org's. The real engines replace it whole.
   ============================================================================= */

/**
 * ONE PACKAGE, and the choice that anchors it.
 *
 * A modification's credit action is anchored on ONE product package, so one
 * session is one package is one plan is one approval — that anchor IS the
 * governance boundary, and a manifest that blurred two packages would be a
 * change set no single approval could honestly cover. A relationship carrying
 * more than one package therefore CHOOSES rather than defaulting to whichever
 * one the read happened to list first.
 */
export interface PackageChoice {
  id: string;
  label: string;
  /** "$46.0MM committed · 6 members", as the chip prints it. */
  figure: string;
  /** False where no member of it can carry a credit action. Rendered hollow. */
  eligible: boolean;
  /** The one line reason. Present exactly when NOT eligible. */
  reason?: string;
  /** WHERE THE PLAN STANDS RIGHT NOW, marked rather than assumed. A create's
   *  offer carries "New package" as the default and marks it; an existing
   *  package is NEVER pre-selected, which is the whole point of the offer. */
  selected?: boolean;
}

/** What "read the room" gives back: everything the entry scene renders from. */
export interface WorkroomBrief {
  /** "Hey Fabian." — the viewer, resolved from what the read already carries.
   *  EMPTY where nothing names them, because a room that greets a record id is
   *  worse than a room that opens without a greeting. */
  greeting: string;
  packageName: string;
  /** The package's committed total today, in millions. */
  baselineCommittedMM: number;
  baselineMembers: number;
  /** False when there is no package yet, and so no member chips to draw. */
  showsMembers: boolean;
  /** THE PACKAGES TO CHOOSE BETWEEN, when the room was opened at relationship
   *  altitude on a relationship carrying more than one. EMPTY once the room is
   *  anchored — a selection beat over a list of one is a click that decides
   *  nothing, and the single-package case must never see it. */
  packageChoices: PackageChoice[];
  /**
   * DOES THE ROOM HAVE TO WAIT FOR ONE OF THEM?
   *
   * TRUE is the question a modification asks on a relationship staging several
   * packages: nothing below it is scoped to one, so the composer sleeps and the
   * facilities do not land until the banker picks. FALSE is an OFFER, the plan
   * already stands somewhere honest and the chips are an alternative, which is
   * the only shape a create's package chips ever take (founder, 2026-09-06: a
   * new facility creates a new package, so there is nothing to ask).
   */
  packageChoiceRequired: boolean;
  covenantFigure: string;
  loadSteps: string[];
  askPin: string;
  /** THE one sentence in the room. */
  position: string;
  sources: SourceChip[];
  why: WhyRow[];
  whyCaveat: string;
  /** What the Compose step counts up to. */
  composeTarget: number;
  /** The package strip's member chips. A real engine resolves these from the
   *  cockpit's bundle; the shell engine hands back the fixture. */
  members: PackageMember[];
  /** "What the package holds today", as the room actually read it. */
  have: HaveRow[];
}

/**
 * THE NEXT MOVE, OFFERED.
 *
 * Two strings, because the pill a banker READS and the instruction the parser
 * HEARS are not the same sentence and pretending they are cost a live UAT. The
 * org names a loan `<Borrower> - <Product> - <$Amount>`, so an instruction
 * precise enough to name one member of six carries that member's CURRENT
 * commitment inside it — and a pill built from that instruction read
 * "Increase the Line of Credit - $15,000,000.00", which a banker parses as
 * "increase BY fifteen million".
 *
 *   label — banker grammar. A current figure appears as context, never in the
 *           position where a target belongs.
 *   say   — the instruction, scoped precisely enough to resolve one member, sent
 *           back through `parseIntent` exactly as a typed line is. A suggestion
 *           can never do something the banker could not have said themselves.
 */
export interface WorkroomSuggestion {
  label: string;
  say: string;
}

/* ------------------------------------------------- the composed manifest holds

   THE ROOM CLOSES; THE WORK DOES NOT.

   The shell holds its entries in component state and the component unmounts on
   close, so a banker who shut the room to check a figure on the cockpit behind
   it came back to a blank manifest and had to say every change again. What
   survives a close is held HERE, in the engine layer, rather than in the
   component that dies.

   KEYED BY THE PACKAGE, and by the mode that composed it. The package anchor IS
   the governance boundary — one session is one package is one plan is one
   approval — so a manifest composed against one package may never reappear
   under another; and a renewal's terms are not a modification's changes even on
   the same package.

   A PAGE SESSION, and no longer. This is module scope, not storage: a reload
   starts clean, which is the honest lifetime for a change set that has not been
   filed and whose staging token the org may since have expired.               */

export interface ComposedHold {
  /** The confirmed manifest, in landing order. */
  entries: WorkroomDelta[];
  /** The key the org ties a restage to. Carried across the close so a banker
   *  who reopens and approves files ONE credit action, replayed, rather than a
   *  second one beside the first. */
  idempotencyKey: string | null;
}

const holds = new Map<string, ComposedHold>();

const holdKey = (mode: WorkroomMode, packageId: string | null | undefined): string | null =>
  packageId ? `${mode}:${packageId}` : null;

/** What this package was left composing. Empty on a first visit, and empty
 *  again once a plan has filed. A package that does not exist yet — the account
 *  door of `create` — has no anchor to hold anything against. */
export function recallComposed(mode: WorkroomMode, packageId: string | null | undefined): ComposedHold {
  const key = holdKey(mode, packageId);
  return (key && holds.get(key)) || { entries: [], idempotencyKey: null };
}

export function holdComposed(mode: WorkroomMode, packageId: string | null | undefined, hold: ComposedHold): void {
  const key = holdKey(mode, packageId);
  if (!key) return;
  if (!hold.entries.length && !hold.idempotencyKey) {
    holds.delete(key);
    return;
  }
  holds.set(key, { entries: [...hold.entries], idempotencyKey: hold.idempotencyKey });
}

/** The plan filed. There is nothing left to pick up, and offering the filed
 *  entries again as if they were still composing would be a lie. */
export function releaseComposed(mode: WorkroomMode, packageId: string | null | undefined): void {
  const key = holdKey(mode, packageId);
  if (key) holds.delete(key);
}

/** Module state outlives a test file. Tests that compose a manifest drop it. */
export function clearComposed(): void {
  holds.clear();
}

/* ----------------------------------------------------------- readable errors

   A THROWN THING IS NOT ALWAYS AN ERROR. The transport rejects with a plain
   `McpFailure` object, and `String(that)` is "[object Object]" — which is
   exactly what a live run put in the thread as the agent's whole answer to a
   43-second execute. Anything the room says out loud goes through here first. */

/** How much of an unrecognised shape is worth reading. Past this it is a dump,
 *  not a sentence. */
const ERROR_CHARS = 300;

export function readableError(e: unknown): string {
  if (typeof e === "string" && e.trim()) return e.trim();
  const message = (e as { message?: unknown } | null | undefined)?.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  try {
    const json = JSON.stringify(e);
    if (json && json !== "{}" && json !== "null") {
      return json.length > ERROR_CHARS ? `${json.slice(0, ERROR_CHARS)}…` : json;
    }
  } catch {
    // Circular, or a shape JSON refuses. The fallback below still says something.
  }
  const text = String(e);
  // THE ONE STRING THAT MAY NEVER REACH THE THREAD. A shape that carries nothing
  // readable is an unreadable error, and saying so is the honest answer; putting
  // "[object Object]" in front of a banker is not.
  return text === "[object Object]" ? "The room got back an error it could not read." : text;
}

export interface WorkroomEngine {
  readonly mode: WorkroomMode;
  /** TRUE while the room runs on a storyline and reaches no tool. The header
   *  badge is driven by this and by nothing else, so an engine cannot quietly
   *  stop being scripted without the room saying so. */
  readonly scripted: boolean;
  brief(context: WorkroomContext): WorkroomBrief;
  suggest(): WorkroomSuggestion | null;
  /** The banker clicked a member on the package strip. Null means the engine has
   *  nothing to say about that member and the shell should open the member
   *  detail instead — which is the shell engines, whose strip is a fixture with
   *  no facilities behind it to focus a conversation on. */
  pick(memberId: string): IntentResult | null;
  parseIntent(text: string, context: WorkroomContext): Promise<IntentResult>;
  /** What a landed chip DID. `staged` is the manifest INCLUDING `delta`, so a
   *  check can reason over the whole change set rather than one entry. */
  acknowledge(delta: WorkroomDelta, staged: WorkroomDelta[]): WorkroomAcknowledgement;
  stagePlan(deltas: WorkroomDelta[], context: WorkroomContext): Promise<StagedWorkroomPlan>;
  execute(approval: WorkroomApproval): Promise<WorkroomExecution>;
  /** The manifest this package was left composing when the room last closed,
   *  read at construction. Empty on a first visit. */
  resume(): WorkroomDelta[];
  /** The room hands its manifest back on every landing and every removal, so a
   *  close cannot lose it. */
  hold(entries: WorkroomDelta[]): void;
  /** The plan filed; there is nothing left to pick up. */
  release(): void;
}

/* ------------------------------------------------------------------ scripted */

/** Deterministic and order-sensitive over what the plan actually contains, so
 *  editing the plan changes the hash exactly as the real tool's does. Local to
 *  the shell engine: nothing on the wire ever sees it. */
function digest(material: string): string {
  let h = 0;
  for (let i = 0; i < material.length; i++) h = (Math.imul(31, h) + material.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0");
}

function planSteps(deltas: WorkroomDelta[]): PlanStep[] {
  const steps: PlanStep[] = [];
  deltas.forEach((d, i) => {
    const write = `w${i + 1}`;
    steps.push({
      id: write,
      type: "write",
      label: `${d.kind}: ${d.title}`,
      objectName: d.map[0]?.[1],
      fields: d.fields,
    });
    steps.push({
      id: `v${i + 1}`,
      type: "verification",
      label: `Re-query ${d.title.toLowerCase()} to prove the write landed`,
      verification: d.filed.verification,
      dependsOn: [write],
    });
  });
  return steps;
}

/**
 * The storyline runner.
 *
 * It holds two pieces of state and no more: which beat the conversation is on,
 * and the plan it last staged. Both are conversation state, not domain state —
 * the room writes nothing, so there is nothing else to hold.
 */
export function createScriptedEngine(
  context: Pick<WorkroomContext, "mode" | "door" | "approver" | "productPackageId">,
): WorkroomEngine {
  const script: WorkroomScript = scriptFor(context.mode, context.door);
  const vocabulary = vocabularyFor(context);
  const held = recallComposed(context.mode, context.productPackageId);
  let beatIndex = 0;
  let staged: StagedWorkroomPlan | null = null;
  /** What the last plan was staged FROM, so execution can report per delta. */
  let stagedDeltas: WorkroomDelta[] = [];
  const spent = new Set<string>();

  function nextBeat() {
    return beatIndex < script.beats.length ? script.beats[beatIndex] : null;
  }

  function resultFor(beat: (typeof script.beats)[number]): IntentResult {
    if (beat.refusal) {
      return { kind: "refusal", reply: beat.reply, refusal: script.refusals[beat.refusal] };
    }
    return {
      kind: "deltas",
      reply: beat.reply,
      deltas: (beat.deltas ?? []).map((id) => script.deltas[id]),
    };
  }

  return {
    mode: script.mode,
    scripted: true,

    resume: () => held.entries,
    // The shell engine stages no org plan, so it holds no idempotency key with
    // the entries: there is no credit action for a replay to land on.
    hold: (entries) => holdComposed(context.mode, context.productPackageId, { entries, idempotencyKey: null }),
    release: () => releaseComposed(context.mode, context.productPackageId),

    brief() {
      return {
        greeting: greetingFor(context.approver),
        // The storyline stands on ONE package by construction, so there is
        // never a choice to offer here.
        packageChoices: [],
        packageChoiceRequired: false,
        members: script.showsMembers ? MEMBERS : [],
        have: ["position", "revolver", "covenants", "collateral"].map((k) => HAVE[k]).filter(Boolean),
        packageName: script.packageName,
        baselineCommittedMM: script.baselineCommittedMM,
        baselineMembers: script.baselineMembers,
        showsMembers: script.showsMembers,
        covenantFigure: script.covenantFigure,
        loadSteps: script.loadSteps,
        askPin: script.askPin,
        position: script.position,
        sources: script.sources,
        why: script.why,
        whyCaveat: script.whyCaveat,
        composeTarget: script.composeTarget,
      };
    },

    suggest() {
      const pill = nextBeat()?.pill;
      // The storyline's pill IS the line its beat matches on, so what the banker
      // reads and what the parser hears are the same sentence here.
      return pill ? { label: pill, say: pill } : null;
    },

    // THE STRIP IS A FIXTURE HERE, not a read: there are no facilities behind
    // these members to focus a conversation on, and the parse runs on storyline
    // rails that a member pick could not join. The shell opens the member detail
    // instead, which is the honest answer rather than a question this engine
    // could not then take an answer to.
    pick: () => null,

    acknowledge(delta) {
      return {
        reply: `${delta.title} on ${delta.target} is in the manifest: ${delta.before} → ${delta.after}. ${vocabulary.nextMove}`,
        challenge: delta.challenge,
      };
    },

    async parseIntent(text) {
      const beat = nextBeat();
      // Storyline rails, not a parser. The real engine sends the line to the
      // gateway and validates the parse against org fields before it becomes a
      // chip; what it must NOT do, and this must not either, is invent a delta
      // from a line it did not understand.
      if (!beat) return { kind: "unparsed", reply: script.offScript };
      const lower = text.toLowerCase();
      if (!beat.keys.some((k) => lower.includes(k))) {
        return { kind: "unparsed", reply: script.offScript };
      }
      beatIndex++;
      return resultFor(beat);
    },

    async stagePlan(deltas, ctx) {
      const steps = planSteps(deltas);
      const material = JSON.stringify(steps.map((s) => [s.id, s.type, s.objectName ?? "", s.fields ?? []]));
      const planHash = `shell-${digest(material)}`;
      const stagingId = `shell-staging-${script.mode}-${digest(deltas.map((d) => d.id).join("|"))}`;
      const plan: StagedOutput = {
        stagingId,
        planHash,
        decisionToken: `shell-token-${digest(planHash + stagingId)}`,
        accountId: ctx.accountId,
        productPackageId: ctx.productPackageId ?? undefined,
        summary: `${vocabulary.planTitle} ${deltas.length} ${deltas.length === 1 ? "change" : "changes"} to ${script.packageName}.`,
        steps,
        warnings: deltas.flatMap((d) => (d.caveat ? [d.caveat] : [])),
        suggestions: [],
      };
      staged = { plan, planHash, stagingId, decisionToken: plan.decisionToken ?? null };
      stagedDeltas = deltas;
      return staged;
    },

    async execute(approval): Promise<WorkroomExecution> {
      if (!staged) throw new Error("nothing has been staged, so there is no plan to execute");
      // The single most important check, and the same one the real token
      // redemption makes: a confirmation never travels to another plan.
      if (approval.planHash !== staged.planHash || approval.stagingId !== staged.stagingId) {
        throw new Error("the plan changed after you confirmed it, so the confirmation no longer applies");
      }
      if (spent.has(approval.decisionToken)) throw new Error("this confirmation has already been used");
      spent.add(approval.decisionToken);

      const count = stagedDeltas.length;
      return {
        filed: stagedDeltas.map((d) => ({
          deltaId: d.id,
          recordId: d.filed.recordId,
          verification: d.filed.verification,
        })),
        tokenNote: `Token redeemed by ${approval.approverUserId} · single use · ${count} of ${count} ${
          count === 1 ? "entry" : "entries"
        } verified by re-query`,
        handoff: script.handoff,
        reply: script.reply,
      };
    },
  };
}
