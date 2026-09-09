import { useEffect, useMemo, useState } from "react";
import { askDesk, deskAvailable } from "../channel/deskAsk";
import { openFacilityRoom } from "./workroom/roomSession";
import { smartOpeningFor } from "./workroom/route";
import { openRelationshipRoom } from "./relationship/relSession";
import { relOpeningForAccount } from "./relationship/RelationshipRoom";
import { useApp, ACCOUNT_TABS } from "../state/appState";
import type { AiMessage } from "../data/contract";
import { formatProbe, newRequestId, probeChannels } from "../channel/adapter";
import { mcpAvailable, type McpFailure } from "../channel/mcp";
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

/** The chat's own word cadence (rule 9): ~60ms apart, each word 340ms. The
 *  room's is faster (26ms) because the room speaks in one short sentence and
 *  the assist answers in paragraphs. */
const CHAT_WORD_MS = 60;

/**
 * THE ANSWER ARRIVES, IT DOES NOT APPEAR (rule 9).
 *
 * Words condense in one at a time — opacity, a 4px rise and a blur clearing —
 * so a long answer reads as being said rather than pasted in one block. The
 * whitespace stays as plain text nodes, which keeps `textContent` byte-identical
 * to what the copilot returned: nothing about the animation changes the answer.
 *
 * ONLY THE ANSWER THIS SESSION JUST RECEIVED runs it. Injected history is
 * already-read text, and staggering forty words of it on every panel open would
 * be a load animation over something that never loaded.
 */
function ChatWords({ text }: { text: string }) {
  const parts = useMemo(() => text.split(/(\s+)/).filter((p) => p !== ""), [text]);
  let n = -1;
  return (
    <>
      {parts.map((part, i) => {
        if (/^\s+$/.test(part)) return part;
        n += 1;
        return (
          <span className="chatw" style={{ animationDelay: `${n * CHAT_WORD_MS}ms` }} key={i}>
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

/** Merge injected threads + session-local messages, dedupe by id (A15). */
function mergeMessages(threads: AiMessage[], local: AiMessage[]): AiMessage[] {
  const seen = new Set<string>();
  const out: AiMessage[] = [];
  for (const m of [...threads, ...local]) {
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
  const available = live || channel.available();
  const sending = sendState === "sending";
  const [failure, setFailure] = useState<McpFailure | null>(null);
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

  async function send(text: string) {
    const prompt = text.trim();
    if (!prompt || !available || sending) return;

    const requestId = newRequestId();
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
    dispatch({ type: "SET_DRAFT", draft: "" });
    setSendState("sending");
    setFailure(null);
    setLastQuestion(prompt);

    // THE SESSION BRAIN FIRST (founder, 2026-09-03): the desk answers with the
    // whole relationship in view, page-agnostic, exactly like the rooms. The
    // gateway path below stays as the fallback where no session is attached.
    if (account?.accountId && deskAvailable()) {
      const bundle = resolveBundle(data, account.accountId);
      if (bundle) {
        try {
          const answerText = await askDesk({
            data,
            bundle,
            accountName: account.name ?? "this relationship",
            question: prompt,
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
            text: answer.text || "The copilot returned an empty answer.",
            ts: new Date().toISOString(),
          },
        });
        setAnswerMeta({ model: answer.model, costUsd: answer.costUsd });
        setStreamedId(`${requestId}-answer`);
        setSendState("answered");
      } catch (e) {
        setFailure(e as McpFailure);
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
          {/* Branch on the error CODE — never one catch-all banner (it would
              hide the single action that fixes the page). */}
          {failure ? failure.fix : "Could not reach the desk. Try again from an agent-connected session."}
          {lastQuestion && (
            <button type="button" onClick={() => void send(lastQuestion)} className="chatchip c360-press mt-1.5 block">
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
                surface: `Cockpit chat${account?.name ? ` — ${account.name}` : ""}`,
                bookAsOf: data.meta?.generatedAt,
              })
            }
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
          <div className="chatoff-b">
            No agent channel is connected to this artifact. Open the cockpit through the agent to ask questions; the
            staged data stays fully navigable offline.
          </div>
          <ConnectionDetails />
        </div>
      )}
    </>
  );
}
