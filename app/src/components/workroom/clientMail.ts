import { useEffect, useMemo, useState } from "react";
import type { BrainMail } from "../../channel/brainLane";
import { distinctiveToken, matchesAccount, searchMailbox, type MailHit } from "../../channel/cockpitTools";
import { mcpAvailable } from "../../channel/mcp";
import { byDeadline } from "./deadline";
import type { BorrowerBundle } from "../../data/contract";
import { fmtDate, fmtMoney } from "../../data/format";
import { readRouteIntent } from "./route";

/* =============================================================================
   THE CLIENT'S OWN MESSAGE, ON THE GREETING.

   FOUNDER, 2026-09-02: "when there is an email attached, it should be in that
   first response baked in", and then, sharper: it is ANY mail, not an increase.
   "btw James reached out for xyz, do you want to bake this in?" A renewal, a
   new loan, covenant relief, a valuation, a question, a complaint, a notice
   with no credit action in it at all: the room reads what the message actually
   says and offers the move that matches, or simply mentions it when none does.

   ONE READER, TWO CONSUMERS. `searchMailbox` is the cockpit's one mail reader
   and this is its second caller, not a third: `useMailTip` is deleted and the
   quiet tier is derived from the hits this hook already holds. Net connector
   traffic for a room open is unchanged at one `outlook_email_search`, and
   inside 60s of a sync sweep it is served from the platform cache.

   THE MAIL IS NEVER A SOURCE FOR A FIGURE. Everything here is what the CLIENT
   said. `asked` carries their number, labelled as theirs; every figure the room
   prints still comes from the book. The doctrine says so in words and the
   envelope says so in shape: the block is a sibling of `reads`, never inside it.

   EVERY FAILURE PATH IS SILENT, exactly as the tier it replaces was. No
   connector, no distinctive token, a refused call, an empty mailbox: the note
   is null, the gate opens, and the room says one thing fewer.
   ============================================================================= */

/**
 * THE LONGEST THE GREETING WAITS FOR THE MAILBOX.
 *
 * The consent dialog is the one moment the room cannot take twice, and under
 * reduced motion the room's own lookup lands synchronously, so a longer gate is
 * a visibly late dialog rather than more mail. Mail that misses the gate
 * arrives as a SECOND remark under the greeting, which is why a short cap is
 * strictly better than a long one.
 */
export const MAIL_GATE_MS = 1200;
export const MAIL_SUBJECT_CHARS = 140;
export const MAIL_GIST_CHARS = 320;

const clip = (text: string | undefined, cap: number): string | undefined => {
  const line = (text ?? "").replace(/\s+/g, " ").trim();
  if (!line) return undefined;
  if (line.length <= cap) return line;
  const cut = line.slice(0, cap);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > cap / 2 ? cut.slice(0, lastSpace) : cut).trim()}...`;
};

/** Later than the book this room is standing on. The read predates the note,
 *  and a remark that did not say so would be quietly stale. */
const after = (receivedAt: string | undefined, generatedAt: string): true | undefined =>
  receivedAt && generatedAt && receivedAt > generatedAt ? true : undefined;

/**
 * THE ROUTE THE MESSAGE POINTS AT, or none.
 *
 * `readRouteIntent` is the room's own coarse read and is already trusted for a
 * typed line; a mail is a line someone else typed. It answers with a route or
 * with null, and null is the honest answer for "can you send me the June
 * covenant certificate". The MODEL decides what the message means; this only
 * decides whether one of the three route words is even on the table.
 */
const routeOf = (subject: string | undefined, gist: string | undefined): BrainMail["route"] => {
  const route = readRouteIntent(`${subject ?? ""} ${gist ?? ""}`.trim());
  return route ?? undefined;
};

const money = (n: number | undefined): string | undefined => (typeof n === "number" ? fmtMoney(n) : undefined);

/**
 * THE MAIL A SYNC SWEEP ALREADY LANDED, read off the bundle. Synchronous, zero
 * calls: a banker who swept and then opened the room gets the message in the
 * greeting with no wait at all.
 *
 * The sweep lands a `ClientRequest` (subject, date, the derived ask) AND an
 * activity entry carrying the SENDER and the body preview, so both are read and
 * joined rather than one of them being invented from the other.
 */
export function mailNoteFromBundle(bundle: BorrowerBundle | null, generatedAt: string): BrainMail | null {
  const request = (bundle?.requests ?? [])[0];
  if (!request) return null;

  const entries = (bundle?.activity ?? []).filter((a) => a.reference?.kind === "m365-message");
  const entry = entries.find((a) => a.reference?.id && a.reference.id === request.reference?.id) ?? entries[0];

  const subject = clip(request.summary ?? entry?.title, MAIL_SUBJECT_CHARS);
  const gist = clip(entry?.summary, MAIL_GIST_CHARS);
  // The sweep records the sender as the entry's actor and, on the request, as
  // the reference's source. Neither is inferred from the relationship name.
  const from = entry?.actor ?? request.reference?.source;
  const to = money(request.ask?.to);

  const note: BrainMail = { source: "swept" };
  if (from) note.from = from;
  if (request.receivedAt) note.received = fmtDate(request.receivedAt);
  if (subject) note.subject = subject;
  if (gist) note.gist = gist;
  const arrived = after(request.receivedAt, generatedAt);
  if (arrived) note.arrivedAfterBook = arrived;
  if (to) note.asked = { to, from: money(request.ask?.from), facility: request.ask?.facilityName };
  const route = routeOf(subject, gist);
  if (route) note.route = route;
  // No re-match: the sweep filtered through `matchesAccount` before it landed
  // any of this, and a second copy of the matcher is a second way for a message
  // to attach to the wrong relationship.
  return note;
}

/**
 * THE MOST RECENT MESSAGE ON THIS RELATIONSHIP, from a live mailbox read.
 *
 * A MESSAGE NEWER THAN THE BOOK IS KEPT. The quiet tier used to discard one, on
 * the reasoning that a future-dated message could not be real; it is real, it is
 * simply newer than the read, and `arrivedAfterBook` says so. Discarding it is
 * how the founder's own seeded mail rendered nothing at all.
 */
export function mailNoteFromHits(hits: MailHit[], accountName: string, generatedAt: string): BrainMail | null {
  const matched = hits
    .filter((h) => matchesAccount(h, accountName))
    .slice()
    .sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));
  const top = matched[0];
  if (!top) return null;

  const subject = clip(top.subject, MAIL_SUBJECT_CHARS);
  const gist = clip(top.preview, MAIL_GIST_CHARS);

  const note: BrainMail = { source: "mailbox" };
  if (top.from) note.from = top.from;
  if (top.receivedAt) {
    const received = fmtDate(top.receivedAt);
    if (received && received !== "—") note.received = received;
  }
  if (subject) note.subject = subject;
  if (gist) note.gist = gist;
  // A COUNT, never the text of a second message. `notCarried` says the same
  // thing in words, so the model can refuse a thread by name.
  if (matched.length > 1) note.more = matched.length - 1;
  const arrived = after(top.receivedAt, generatedAt);
  if (arrived) note.arrivedAfterBook = arrived;
  const route = routeOf(subject, gist);
  if (route) note.route = route;
  return note;
}

/** How much of a message a note actually carries. A live read is the only
 *  source of a body gist and of a sender, so it replaces a swept note that has
 *  neither rather than the room holding the poorer of the two. */
const richness = (note: BrainMail | null): number =>
  note ? [note.from, note.gist, note.subject, note.received].filter(Boolean).length : -1;

/**
 * THE CLIENT'S MAIL, AND THE GATE THE GREETING WAITS ON.
 *
 * One live read per room, on mount, beside whatever the bundle already carries.
 * The gate opens on the swept note, on the read resolving, on it rejecting, or
 * on {@link MAIL_GATE_MS}, whichever comes first, and with no connector it is
 * open on the first tick: no room ever waits for a mailbox it cannot reach.
 */
export function useClientMail(args: {
  accountName: string;
  bundle: BorrowerBundle | null;
  /** `meta.generatedAt`. Nothing here reaches a clock. */
  generatedAt: string;
  /**
   * THE INTENT THIS ROOM WAS OPENED FROM, as a mail block.
   *
   * It WINS over both reads, and not by richness: it is the reason the room is
   * open. A greeting that led with an unrelated message while the banker
   * watched their own forwarded instruction being typed in would be the room
   * talking past them. Absent — every room not opened from an intent — and the
   * swept/live contest below is exactly what it was.
   */
  intentNote?: BrainMail | null;
}): { note: BrainMail | null; hits: MailHit[]; gate: boolean } {
  const { accountName, bundle, generatedAt } = args;
  const swept = useMemo(() => mailNoteFromBundle(bundle, generatedAt), [bundle, generatedAt]);
  const [live, setLive] = useState<{ note: BrainMail | null; hits: MailHit[] }>({ note: null, hits: [] });
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    // NO CHANNEL IS NOT AN ERROR STATE, it is the common one. No call, no
    // timer, and the greeting is not held for a beat.
    if (!accountName || !mcpAvailable() || distinctiveToken(accountName) === null) {
      setOpened(true);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      if (alive) setOpened(true);
    }, MAIL_GATE_MS);
    void (async () => {
      try {
        /* THE READ CARRIES A CLOCK (2026-09-05). The gate below already opens
           the room on a timer, so a hung mailbox never held the greeting; what
           it did hold was a promise and its callbacks, for the life of the
           page. Fifteen seconds is the ordinary read budget. */
        const { hits } = await byDeadline(searchMailbox(accountName), "read", "the mailbox");
        if (alive) setLive({ note: mailNoteFromHits(hits, accountName, generatedAt), hits });
      } catch {
        // Silent by contract. A banker told the mailbox could not be reached
        // learns nothing they can act on inside a credit workroom.
      }
      if (alive) setOpened(true);
    })();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [accountName, generatedAt]);

  const read = richness(live.note) > richness(swept) ? live.note : swept;
  const note = args.intentNote ?? read;
  // An intent needs no mailbox: the room does not hold its greeting for a read
  // it is not going to lead with.
  return { note, hits: live.hits, gate: !!args.intentNote || opened || swept !== null };
}

/** The clip the greeting's mail block runs on, for the ACTIVITY TRAIL's row.
 *  One rule, two consumers: a second clip would drift from this one. */
export { clip as clipMail };
