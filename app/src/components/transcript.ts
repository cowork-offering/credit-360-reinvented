/* =============================================================================
   THE CONVERSATION, AS PLAIN TEXT — for a one-click feedback copy.

   Every workroom and the chat carry a bug button (components/BugCopyButton.tsx)
   that copies the WHOLE exchange to the clipboard, so a tester or a banker can
   paste it back to us verbatim: what the room said, what they typed, which chip
   they clicked, what settled. A pasted transcript is worth ten paraphrased bug
   reports, and it is how we see the real flow.

   NOTHING SENSITIVE, AND NOTHING INVENTED. This reads the surface's OWN state
   (the workroom's `items`, the chat's `messages`) — both of which fold rather
   than delete, so the record is complete — and renders it as markdown. It adds
   no figures of its own; it is a transcript, not an analysis.

   RESILIENT BY DESIGN. The thread item is a wide union and the models it carries
   (cards, chips, rows) evolve; this pulls the human-readable fields it can find
   and falls back to a named marker for the structural beats, so a new item kind
   never throws here and never blocks a copy.
   ============================================================================= */

export interface TranscriptMeta {
  /** e.g. "Loan modification — Sunbelt Hospitality Group" or "Cockpit chat". */
  surface: string;
  /** The book's own as-of, so a report says which snapshot it was taken on. */
  bookAsOf?: string;
  /** The build the transcript came off, for triage. */
  appVersion?: string;
}

type Row = Record<string, unknown>;

const isRec = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** First present non-empty string among the given keys of an object. */
function pluck(obj: unknown, keys: string[]): string {
  if (!isRec(obj)) return "";
  for (const k of keys) {
    const s = str(obj[k]).trim();
    if (s) return s;
  }
  return "";
}

/** A short label for a nested model (card, row, chip, challenge, reply): the
 *  first human-readable field we can find, so the transcript names the beat even
 *  when the model's exact shape is not known here. */
function label(model: unknown): string {
  return pluck(model, ["title", "label", "heading", "name", "summary", "text", "value", "subject"]) || "";
}

/** One thread item as one markdown line (or a few), or "" to skip it. */
function itemLine(item: unknown): string {
  if (!isRec(item)) return "";
  const kind = str(item.kind);
  const text = str(item.text).trim();
  switch (kind) {
    case "banker":
      return `**You:** ${text}`;
    case "fed":
      return `**You (via ${str(item.from) || "chat"}):** ${text}`;
    case "agent": {
      const lines = [`**Room:** ${text}`];
      const note = str(item.note).trim();
      if (note) lines.push(`  _${note}_`);
      const options = Array.isArray(item.options) ? item.options : [];
      const chips = options.map((o) => pluck(o, ["label", "say"])).filter(Boolean);
      if (chips.length) lines.push(`  Options: ${chips.join(" · ")}`);
      const link = isRec(item.link) ? pluck(item.link, ["label", "href"]) : "";
      if (link) lines.push(`  Link: ${link}`);
      return lines.join("\n");
    }
    case "chips": {
      const chips = Array.isArray(item.chips) ? item.chips : [];
      const names = chips.map((c) => label(c)).filter(Boolean);
      const advis = Array.isArray(item.advisories) ? item.advisories : [];
      const notes = advis.map((a) => label(a)).filter(Boolean);
      const head = names.length ? `**Room (choices):** ${names.join(" · ")}` : "**Room (choices)**";
      return notes.length ? `${head}\n  Advisory: ${notes.join("; ")}` : head;
    }
    case "challenge": {
      const c = label(item.challenge) || "effective challenge";
      return `**Room (challenge):** ${c}${item.acked ? " — acknowledged" : ""}`;
    }
    case "reply":
      return `**Room (drafted reply):** ${label(item.reply) || "[reply]"}`;
    case "read":
      return `**Room (read):** ${label(item.card) || "[read card]"}`;
    case "notice":
      return `**Room (notice): ${str(item.title)}** ${str(item.body)}`.trim();
    case "trouble":
      return `**Runtime:** ${text}`;
    case "settled":
      return `**Filed:** ${label(item.row) || "[settled]"}`;
    case "dossier":
      return `_[dossier]_`;
    case "opening":
    case "brief":
    case "packages":
    case "pkgask":
    case "lookup":
      return `_[${kind}]_`;
    default:
      return kind ? `_[${kind}]_` : "";
  }
}

function header(meta: TranscriptMeta): string {
  const now = new Date().toISOString();
  const lines = [
    `# Credit 360 — conversation transcript`,
    ``,
    `- Surface: ${meta.surface}`,
    `- Copied at: ${now}`,
  ];
  if (meta.bookAsOf) lines.push(`- Book as of: ${meta.bookAsOf}`);
  if (meta.appVersion) lines.push(`- Build: ${meta.appVersion}`);
  lines.push(``, `---`, ``);
  return lines.join("\n");
}

/** The workroom thread as markdown. `items` is the room's own `ThreadItem[]`. */
export function threadToMarkdown(items: ReadonlyArray<unknown>, meta: TranscriptMeta): string {
  const body = (items ?? []).map(itemLine).filter(Boolean).join("\n\n");
  return `${header(meta)}${body || "_(no exchange yet)_"}\n`;
}

/** The cockpit chat as markdown. Messages are `AiMessage` (`{ id, role, text }`,
 *  role "user" | "agent"). */
export function chatToMarkdown(
  messages: ReadonlyArray<{ id?: string; text?: string; role?: string }>,
  meta: TranscriptMeta,
): string {
  const body = (messages ?? [])
    .map((m) => {
      const who = (m?.role ?? "").toLowerCase() === "user" ? "You" : "Desk";
      const t = str(m?.text).trim();
      return t ? `**${who}:** ${t}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  return `${header(meta)}${body || "_(no messages yet)_"}\n`;
}

/**
 * Copy text to the clipboard, resolving to whether it landed. Uses the async
 * clipboard API on a user gesture, with a hidden-textarea fallback for the
 * sandboxed artifact frame where the API can be absent or blocked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
