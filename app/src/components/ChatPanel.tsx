import { useEffect, useMemo, useState } from "react";
import { askDesk, deskAvailable } from "../channel/deskAsk";
import { startPacer } from "../channel/streamPacer";
import { prefersReducedMotion } from "../data/motion";
import { openFacilityRoom } from "./workroom/roomSession";
import { smartOpeningFor } from "./workroom/route";
import { openRelationshipRoom } from "./relationship/relSession";
import { relOpeningForAccount } from "./relationship/RelationshipRoom";
import { useApp, ACCOUNT_TABS } from "../state/appState";
import type { AiMessage } from "../data/contract";
import { formatProbe, newRequestId, probeChannels, type AgentChannel } from "../channel/adapter";
import { mcpAvailable } from "../channel/mcp";
import { askCopilot } from "../channel/cockpitTools";
import { resolveBundle } from "../actions/registry";
import { ActionPanel } from "./ActionPanel";
import { suggestActions, type Suggestion } from "../actions/suggest";
import { ACTIONS_BY_ID } from "../actions/registry";
import { BrandGlyph } from "./brand";
import { BugCopyButton } from "./BugCopyButton";
import { chatToMarkdown } from "./transcript";
import { GooFilter, LiquidMark } from "./workroom/Liquid";

type SendState = "idle" | "sending" | "handedOff" | "answered" | "error";

/**
 * THE ANSWER ARRIVES, IT DOES NOT APPEAR (rule 9).
 *
 * Words condense in one at a time — opacity, a 4px rise and a blur clearing —
 * so a long answer reads as being said rather than pasted in one block. The
 * whitespace stays as plain text nodes, which keeps `textContent` byte-identical
 * to what the desk returned: nothing about the animation changes the answer.
 *
 * THE RATE IS THE ROOMS' RATE NOW (D1, founder latency brief 2026-09-12: "110%
 * zero latency and smooth transitions etc in all workrooms and chats"). It used
 * to be a fixed 60ms CSS stagger per word — `animationDelay: n * 60ms` — with no
 * catch-up and no cap, which is 16.7 words a second: 2.3 times slower than the
 * rooms and BELOW the pacer's own resting floor of 26. Because it was linear it
 * scaled without limit, so the longest legal desk answer (DESK_ANSWER_WORDS,
 * 140) took 8.4 seconds to finish arriving and the banker read the chat as the
 * slow surface in the cockpit. The same 140 words on the rooms' pacer take 3.0
 * seconds, because the pacer leans into a backlog instead of crawling through
 * it.
 *
 * SO THE PACER RELEASES THE WORDS AND THE CSS STILL SAYS THEM. `startPacer` is
 * the rooms' own clock (BASE_RATE 26, MAX_RATE 72, CATCH_UP 0.34) and it hands
 * out a growing PREFIX; each word that arrives is a new DOM node and runs the
 * `.chatw` condense on its own, with no delay, because the pacer is already the
 * cadence. The previously released words keep their nodes and never re-animate.
 *
 * IT PACES THE GUARDED ANSWER, NEVER A PARTIAL. `askDesk` resolves to text that
 * `deskAnswer` has already stripped of markdown and clipped to budget. A raw
 * stream would put unguarded markdown on the glass and then shrink it, which is
 * the defect `Narration.tsx` documents; the guarded text paced at the rooms'
 * rate is the honest version of the same beat.
 *
 * ONLY THE ANSWER THIS SESSION JUST RECEIVED runs it. Injected history is
 * already-read text, and staggering forty words of it on every panel open would
 * be a load animation over something that never loaded.
 *
 * REDUCED MOTION LANDS IT WHOLE, which is the pacer's own contract and the path
 * every jsdom test takes.
 */
function ChatWords({ text }: { text: string }) {
  const [visible, setVisible] = useState(() => (prefersReducedMotion() ? text : ""));
  useEffect(() => {
    if (!text) {
      setVisible("");
      return;
    }
    const pacer = startPacer({ emit: (v) => setVisible(v), instant: prefersReducedMotion() });
    pacer.finish(text);
    return () => pacer.cancel();
  }, [text]);

  const parts = useMemo(() => visible.split(/(\s+)/).filter((p) => p !== ""), [visible]);
  return (
    <>
      {parts.map((part, i) => {
        if (/^\s+$/.test(part)) return part;
        return (
          <span className="chatw" key={i}>
            {part}
          </span>
        );
      })}
    </>
  );
}

/** Channel diagnostics disclosure, shown only in the no-channel state.
 *  Collapsed by default; the probe runs on first open (and not before), so a
 *  banker who never opens it pays nothing. No polling — one read per open. */
function ConnectionDetails() {
  const [report, setReport] = useState<string | null>(null);

  return (
    <details
      className="mt-2"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && report === null) {
          try {
            setReport(formatProbe(probeChannels()));
          } catch (err) {
            setReport("probe failed: " + String(err));
          }
        }
      }}
    >
      <summary className="cursor-pointer text-[11px] font-semibold text-ink-faint hover:text-ink-muted">
        Connection details
      </summary>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-surface px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-ink-muted">
        {report ?? "…"}
      </pre>
    </details>
  );
}

/* ======================================================= THE DOORS AND THE COPY

   THE GATE COUNTED THE WRONG DOORS (founder 2026-09-12, the fallback audit).
   `available` was `live || channel.available()`: the connector, and the legacy
   prompt bridge. Neither is the door the cockpit chat answers through. The desk
   runs on the viewer's own session Claude and needs no connector at all, and it
   is tried FIRST inside `send`. So a view carrying a working session door and
   no IDB Gateway rendered the composer disabled and told the banker to re-open
   the cockpit through the agent, with the door that would have answered sitting
   open beside it. The desk is now the first door the gate counts, in the same
   order `send` tries them.

   THE COPY IS THE CHAT'S OWN. It used to print the connector layer's fix copy
   (`McpFailure.fix`), which names the IDB Gateway and claude.ai connector
   settings: plumbing, addressed to an administrator, handed to a banker with no
   next step in it. `HealthLine` is where that diagnosis belongs. Here the rule
   is the golden rule's: say what could not be done, then the move that still
   exists on this page.                                                        */

/** Whether the chat can take an ask at all, over any of its three doors, in the
 *  order `send` tries them: the session desk, the connector, the prompt bridge. */
export function chatReachable(channel: AgentChannel): boolean {
  return deskAvailable() || mcpAvailable() || channel.available();
}

/** The ask did not reach any door, or the one it reached refused. */
export const CHAT_ASK_FAILED =
  "That question did not reach the desk. The figures on this page are the ones already read from the bank, so the tabs and the rooms still answer from them. Ask again, or open the relationship room and put the question there.";

/** A door answered with nothing at all. */
export const CHAT_EMPTY_ANSWER =
  "The desk came back with nothing on that one. Ask again, or open the relationship room, where the same book travels with the question.";

/** No door of the three is in this view. */
export const CHAT_OFF_BODY =
  "Nothing in this view can take a question right now. The book on this page is already read, so the tabs, the relationship room and the facility room all work from it, and a change you type in a room still stages.";

/** How far apart a local message and the agent's own written-back copy of it
 *  may sit and still be the same exchange. The two clocks are different
 *  machines, so it is a window and not an equality. */
const ECHO_WINDOW_MS = 120_000;

/**
 * Merge injected threads + session-local messages, dedupe by id (A15).
 *
 * AND BY THE EXCHANGE ITSELF (golden rule 5, finding I8). Dedupe by id alone let
 * a locally rendered question and the agent's written-back copy of it BOTH
 * render: two identical bubbles, one answer said twice, on the surface a founder
 * demo opens on. The ids differ by construction, so nothing on the id could ever
 * have caught it.
 *
 * THE LOCAL COPY IS THE ONE THAT SURVIVES, always: it is the bubble the banker
 * already watched arrive, and it carries the id the word cadence is keyed on.
 * The match is only ever made ACROSS the two sources, so a banker who genuinely
 * asks the same thing twice in one session still sees both.
 */
export function mergeMessages(threads: AiMessage[], local: AiMessage[]): AiMessage[] {
  const at = (m: AiMessage) => Date.parse(m.ts ?? "") || 0;
  const echoedLocally = (m: AiMessage) =>
    local.some(
      (l) =>
        l.id !== m.id &&
        l.role === m.role &&
        l.text.trim() === m.text.trim() &&
        (!at(l) || !at(m) || Math.abs(at(l) - at(m)) <= ECHO_WINDOW_MS),
    );

  const seen = new Set<string>();
  const out: AiMessage[] = [];
  for (const m of [...threads.filter((m) => !echoedLocally(m)), ...local]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/** Suggestion chips (A27.5). Data-driven by design: this component renders
 *  whatever Suggestion[] it is handed, so agent-supplied suggestions can
 *  replace the client-computed ones without touching the UI. */
function SuggestionChips({
  suggestions,
  disabled,
  onPick,
}: {
  suggestions: Suggestion[];
  /** Whether the CHANNEL is unusable. Panel-backed chips ignore it: opening the
   *  Action Panel is local UI and needs no channel, exactly as the Client
   *  Actions row does (A33.1.1 — the three entry points must behave alike). */
  disabled: boolean;
  onPick: (s: Suggestion) => void;
}) {
  if (!suggestions.length) return null;
  return (
    <div className="chatchips">
      {suggestions.map((s) => (
        <button
          key={s.id}
          type="button"
          disabled={disabled && !ACTIONS_BY_ID[s.id]?.hasPanel}
          onClick={() => onPick(s)}
          title={s.prompt}
          className="chatchip c360-press"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

export function ChatPanelBody() {
  const { data, worklist, channel, state, dispatch } = useApp();
  const [sendState, setSendState] = useState<SendState>("idle");

  const account =
    state.view === "account" && state.accountId
      ? data.portfolio.accounts.find((a) => a.accountId === state.accountId)
      : null;
  const tabLabel =
    state.view !== "account" ? "Worklist" : (ACCOUNT_TABS.find((t) => t.id === state.tab)?.label ?? null);

  const historyMessages = useMemo<AiMessage[]>(() => {
    const out: AiMessage[] = [];
    for (const t of data.aiPanel?.threads ?? []) for (const m of t.messages ?? []) if (m?.id) out.push(m);
    return out;
  }, [data.aiPanel]);

  const messages = useMemo(
    () => mergeMessages(historyMessages, state.localMessages),
    [historyMessages, state.localMessages],
  );

  const suggestions = useMemo(
    () => suggestActions(data, worklist, account?.accountId ?? null, account?.name ?? null),
    [data, worklist, account],
  );

  const live = mcpAvailable();
  const available = chatReachable(channel);
  const sending = sendState === "sending";
  // Last question, so a failed ask can be retried by a USER GESTURE. Never auto-
  // retried: the contract forbids it for non-retryable codes, and the trust
  // budget that produces blocked_by_policy would only burn further.
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  // A33.1.1 entry point 3 of 3.
  const [panelActionId, setPanelActionId] = useState<string | null>(null);
  const [answerMeta, setAnswerMeta] = useState<{ model?: string; costUsd?: number } | null>(null);
  /** The one answer that ARRIVED in this session, so only it speaks its words
   *  (rule 9). Everything else in the thread is history and is simply there. */
  const [streamedId, setStreamedId] = useState<string | null>(null);
  const canSend = available && !sending && state.draft.trim().length > 0;

  // The assist is never unmounted (rule 56 keeps the conversation), so closing
  // it has to put away what it had open. A ticket a chip raised is the one
  // piece of that state a banker would not expect to find still standing when
  // they come back.
  const assistOpen = state.panel === "chat";
  useEffect(() => {
    if (!assistOpen) setPanelActionId(null);
  }, [assistOpen]);

  /** Chip click: send, and if the chip is registry-backed log it to the
   *  account timeline like any other triggered action (A31.3). Book-level
   *  chips have no registry action, so nothing is logged. */
  /* THE ROOMS TOOK OVER THE PANEL'S WORK (founder, 2026-09-03: "the chips
     still refer to our old list thingys"). A chip whose action the rooms now
     carry opens the ROOM, exactly as the FAB does; the legacy panel modal
     remains only for actions no room covers. */
  const FACILITY_CHIP_ACTIONS = new Set(["loan-modification", "renewal", "new-facility-request"]);
  const RELATIONSHIP_CHIP_ACTIONS = new Set([
    "covenant-review",
    "collateral-valuation",
    "annual-review",
    "risk-rating-review",
    "create-service-request",
  ]);

  async function sendSuggestion(s: Suggestion) {
    const action = ACTIONS_BY_ID[s.id];
    if (account?.accountId && FACILITY_CHIP_ACTIONS.has(s.id)) {
      const bundle = resolveBundle(data, account.accountId);
      openFacilityRoom({
        accountId: account.accountId,
        accountName: account.name ?? "this relationship",
        opening: smartOpeningFor({ data, bundle, accountName: account.name ?? "", productPackageId: null }),
      });
      return;
    }
    if (account?.accountId && RELATIONSHIP_CHIP_ACTIONS.has(s.id)) {
      openRelationshipRoom({
        accountId: account.accountId,
        accountName: account.name ?? "this relationship",
        opening: relOpeningForAccount({ data, accountId: account.accountId }),
      });
      return;
    }
    // A33.1.2 — a chip for a panel-backed action opens the SAME modal the
    // Client Actions row and the activity next-step open.
    if (ACTIONS_BY_ID[s.id]?.hasPanel) {
      setPanelActionId(s.id);
      return;
    }
    if (action && account?.accountId) {
      dispatch({ type: "LOG_ACTION", accountId: account.accountId, actionLabel: action.label });
    }
    await send(s.prompt);
  }

  /**
   * SEND, WITH THE CONVERSATION SO FAR.
   *
   * `echo: false` is the RETRY (golden rule 5). "Ask again" used to re-post the
   * question as a second user bubble, so a banker who retried a failed call read
   * their own question twice and the thread claimed they had asked it twice.
   * The question is already in the thread; only the ask is repeated.
   */
  async function send(text: string, opts: { echo?: boolean } = {}) {
    const prompt = text.trim();
    if (!prompt || !available || sending) return;
    const echo = opts.echo !== false;

    /* THE CONVERSATION SO FAR, READ BEFORE THE ECHO IS PUSHED. This is what
       makes the desk a conversation rather than a series of first questions
       (finding I8). The banker's own words travel verbatim; `deskThread` clips
       and budgets it exactly as the rooms' envelope does. */
    const history = messages.map((m) => ({ who: m.role === "user" ? ("banker" as const) : ("agent" as const), text: m.text }));
    // ON A RETRY the question is already the last thing in the thread, and a
    // question asked twice in one prompt is the double input rule 5 forbids.
    const last = history[history.length - 1];
    const thread = !echo && last?.who === "banker" && last.text === prompt ? history.slice(0, -1) : history;

    const requestId = newRequestId();
    if (echo) {
      dispatch({
        type: "PUSH_MESSAGE",
        message: {
          id: requestId,
          role: "user",
          text: prompt,
          ts: new Date().toISOString(),
          context: { accountId: account?.accountId, tab: tabLabel ?? undefined },
        },
      });
    }
    dispatch({ type: "SET_DRAFT", draft: "" });
    setSendState("sending");
    setLastQuestion(prompt);

    // THE SESSION BRAIN FIRST (founder, 2026-09-03): the desk answers with the
    // whole relationship in view, page-agnostic, exactly like the rooms. The
    // gateway path below stays as the fallback where no session is attached.
    if (account?.accountId && deskAvailable()) {
      const bundle = resolveBundle(data, account.accountId);
      if (bundle) {
        try {
          const answerText = await askDesk({
            bundle,
            accountName: account.name ?? "this relationship",
            question: prompt,
            thread,
            /* WHAT THIS COCKPIT HAS ALREADY FILED. The desk named it in its own
               cut notice and no caller ever passed it, so the block was
               unreachable by construction (2026-09-12). */
            history: state.actionHistory[account.accountId],
          });
          dispatch({
            type: "PUSH_MESSAGE",
            message: {
              id: `${requestId}-answer`,
              role: "agent",
              text: answerText,
              ts: new Date().toISOString(),
              context: { accountId: account.accountId },
            },
          });
          setStreamedId(`${requestId}-answer`);
          setSendState("idle");
          return;
        } catch {
          // The door refused or the session is gone; the gateway path answers.
        }
      }
    }

    // LIVE PATH — ask the credit copilot through the connector, grounded in the
    // staged bundle, and render the answer in-thread.
    if (live) {
      try {
        const answer = await askCopilot({
          data,
          bundle: resolveBundle(data, account?.accountId ?? null),
          accountName: account?.name ?? null,
          tab: tabLabel,
          question: prompt,
        });
        dispatch({
          type: "PUSH_MESSAGE",
          message: {
            id: `${requestId}-answer`,
            role: "agent",
            text: answer.text || CHAT_EMPTY_ANSWER,
            ts: new Date().toISOString(),
          },
        });
        setAnswerMeta({ model: answer.model, costUsd: answer.costUsd });
        setStreamedId(`${requestId}-answer`);
        setSendState("answered");
      } catch {
        setSendState("error");
      }
      return;
    }

    // Legacy prompt-bridge path (no capability in this view).
    try {
      await channel.request(prompt, {
        requestId,
        accountId: account?.accountId,
        accountName: account?.name,
        tab: tabLabel ?? undefined,
      });
      setSendState("handedOff");
    } catch {
      setSendState("error");
    }
  }

  return (
    <>
      {panelActionId && <ActionPanel actionId={panelActionId} onClose={() => setPanelActionId(null)} />}

      {/* THE THREAD. Both roles are LIGHT (rule 28's language): cool grey with
          ink text for the banker, white bordered for the agent, alignment
          carrying the role. A violet bubble was the last purple fill left in
          the corner and it is gone. */}
      <div className="chatbody">
        {messages.length === 0 ? (
          <p className="chatempty">
            Ask about exposure, covenants, structure, or the next best action. Answers are grounded in the staged
            relationship data.
          </p>
        ) : (
          <div className="chatmsgs">
            {messages.map((m) => (
              <div key={m.id} className={`chatrow ${m.role === "user" ? "me" : "agent"}`}>
                {/* PLAIN TEXT ONLY (A13) — React escapes; no HTML/Markdown parsing.
                    The word cadence splits the same escaped text into spans and
                    changes nothing about what it says. */}
                <div className="chatbub">{m.id === streamedId ? <ChatWords text={m.text} /> : m.text}</div>
              </div>
            ))}
          </div>
        )}

        {/* THE ASSIST IS COMPOSING (rule 46: the mark is sanctioned for the
            chat's thinking beat; rule 65.4 is the breath). Between the send and
            the answer the panel used to say nothing at all, which reads as a
            dropped question rather than a question being worked on.

            The goo filter is declared beside the mark that uses it. The room
            declares an identical one while it is open; two identical `#wk-goo`
            defs resolve to the same effect, and neither surface may depend on
            the other being mounted to breathe. */}
        {sending && (
          <div className="chatthink" role="status" aria-label="Composing an answer">
            <GooFilter />
            <LiquidMark />
            <span>Composing…</span>
          </div>
        )}
      </div>

      {sendState === "error" && (
        <div className="chatnote bad">
          {/* ONE SENTENCE, THE CHAT'S OWN. The connector's `failure.fix` names
              the IDB Gateway and claude.ai connector settings, which is
              plumbing addressed to an administrator. That diagnosis lives on
              HealthLine, where an operator looks for it. */}
          {CHAT_ASK_FAILED}
          {/* The question is already in the thread. Repeating the ASK must not
              repeat the banker's own bubble (golden rule 5). */}
          {lastQuestion && (
            <button
              type="button"
              onClick={() => void send(lastQuestion, { echo: false })}
              className="chatchip c360-press mt-1.5 block"
            >
              Ask again
            </button>
          )}
        </div>
      )}
      {sendState === "handedOff" && (
        <div className="chatnote">Handed off to the desk. The cockpit refreshes in place when the answer lands.</div>
      )}
      {sendState === "answered" && answerMeta?.model && (
        <div className="chatnote">
          {answerMeta.model}
          {answerMeta.costUsd != null ? ` · $${answerMeta.costUsd.toFixed(4)}` : ""}
        </div>
      )}

      <SuggestionChips suggestions={suggestions} disabled={!available || sending} onPick={(s) => void sendSuggestion(s)} />

      {/* THE BUG BUTTON. One click copies the whole chat for feedback, the same
          control the workrooms carry. Only where there is something to copy. */}
      {messages.length > 0 && (
        <div className="chatfoot">
          <BugCopyButton
            build={() =>
              chatToMarkdown(messages, {
                surface: `Cockpit chat${account?.name ? `: ${account.name}` : ""}`,
                bookAsOf: data.meta?.generatedAt,
              })
            }
            surface={`Cockpit chat${account?.name ? `: ${account.name}` : ""}`}
            accountName={account?.name}
            bookAsOf={data.meta?.generatedAt}
          />
        </div>
      )}

      {/* THE COMPOSER. One pill, the field inside it, the send riding on the
          right. Rule 27: the send is INK, never violet. Rule 47: the PILL takes
          the focus so no rectangle is drawn inside a rounded shell. */}
      {available ? (
        <form
          className="chatin eg-pill"
          onSubmit={(e) => {
            e.preventDefault();
            send(state.draft);
          }}
        >
          <textarea
            data-autofocus
            value={state.draft}
            onChange={(e) => dispatch({ type: "SET_DRAFT", draft: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(state.draft);
              }
            }}
            rows={1}
            disabled={sending}
            placeholder={sending ? "Sending…" : "Ask about this relationship…"}
            aria-label="Ask about this relationship"
          />
          <button type="submit" disabled={!canSend} className="send" aria-label={sending ? "Sending" : "Send"}>
            <BrandGlyph className="gt" />
          </button>
        </form>
      ) : (
        <div className="chatoff">
          <div className="chatoff-t">Chat unavailable in this view</div>
          <div className="chatoff-b">{CHAT_OFF_BODY}</div>
          <ConnectionDetails />
        </div>
      )}
    </>
  );
}
