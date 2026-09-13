import { useSyncExternalStore } from "react";
import type { ActivityEntry, BorrowerBundle } from "../data/contract";
import type { BrainMail } from "../channel/brainLane";
import { facilityProduct } from "../data/facilityStage";
import { fmtDate, fmtMoney } from "../data/format";
import { clipMail, MAIL_GIST_CHARS, MAIL_SUBJECT_CHARS } from "../components/workroom/clientMail";
import { openFacilityRoom } from "../components/workroom/roomSession";
import { readRouteIntent, ROUTE_WORD, type SmartOpening } from "../components/workroom/route";
import { flyName } from "../components/nameFlight";
import { flightSourceFor, openIntent } from "../intent/open";
import { offerFor } from "../intent/store";
import type { TypedRoute } from "../components/workroom/route";
import type { WorkroomMode } from "../workroom/types";
import { carryMail } from "./mailCarry";
import { readMailRequest, type MailRequest, type RequestIntent } from "./mailIntake";

/* =============================================================================
   AN INBOUND EMAIL, ON THE TRAIL AND INTO THE ROOM.

   FOUNDER, 2026-09-03: "in the activity, when an email is coming in: it looks
   pretty bad, it has this long winded text, and the pop up still opens up the
   old loan modification tab, not our workroom. I need it sleek and elegant."

   Two defects, one path. The trail rendered the whole body preview as the
   entry's prose and hung a `nextSteps` suggestion off it pointing at the
   REGISTRY's `loan-modification` action, which is the pre-workroom action tab.
   So an arriving message read as a paragraph and opened the old panel.

   WHAT THIS MODULE IS. The read behind ONE compact row (sender, subject, the
   ask in one line, the time) and the gesture that opens the facility workroom
   on that message. Nothing here renders and nothing here writes.

   THE ASK IS DERIVED THE WAY THE GREETING DERIVES IT, and from the same
   function: `readMailRequest` is the cockpit's one mail reader for a request,
   and this is a second consumer of it, never a second parser. A FIGURE THE MAIL
   DID NOT STATE IS NEVER PRINTED, not even the book's own commitment, which
   `describeRequest` is allowed to fall back to because it renders under a
   suggestion card that says whose number it is. On a trail row there is no such
   frame, so only the client's own figures are shown.
   ============================================================================= */

/** The one-line ask. Fourteen words is a line on the trail; longer is prose. */
export const ASK_WORDS = 14;

/** The verb a banker would use for each intent the reader finds. */
const VERB: Record<RequestIntent, string> = {
  increase: "increase",
  decrease: "reduce",
  extend: "extend",
  renew: "renew",
  payoff: "pay off",
  new_facility: "open",
};

/** The chip label for the route a message points at, in the room's grammar. */
const OPEN_LABEL: Record<WorkroomMode, string> = {
  modify: "Open the modification",
  renew: "Start the renewal",
  create: "Structure the new facility",
  amend: "Shape this version",
};

const words = (text: string, cap: number): string => {
  const parts = text.replace(/\s+/g, " ").trim().split(" ");
  return parts.length <= cap ? parts.join(" ") : `${parts.slice(0, cap).join(" ")}...`;
};

const lowerFirst = (line: string): string => (line ? line[0].toLowerCase() + line.slice(1) : line);

export interface MailRow {
  /** As the mailbox named the sender. Absent is absent: a person is never
   *  inferred from the relationship, the guarantor list or the address. */
  from: string | null;
  subject: string;
  /** One line, at most {@link ASK_WORDS} words. Null where the message carries
   *  neither a readable request nor a body to clip. */
  ask: string | null;
  /** True where the ask was DERIVED from a readable request, false where it is
   *  the client's own words clipped. The room's opening sentence attributes the
   *  first to the sender and leaves the second alone. */
  askDerived: boolean;
  /** The body, for the expand. NEVER in the default DOM. */
  body: string | null;
  /** The route the message points at, by the room's own coarse read. Never
   *  `amend`: a message cannot ask to shape a version it has never seen, and
   *  `readRouteIntent` answers with the three a sentence can name. */
  route: TypedRoute | null;
}

/** Is this trail entry an inbound message rather than a filed action? */
export function isMailEntry(entry: ActivityEntry): boolean {
  return entry.kind === "REQUEST_RECEIVED" && entry.reference?.kind === "m365-message";
}

/**
 * The client's ask in one line, or null.
 *
 * ONLY THE CLIENT'S OWN FIGURES. `currentAmount` is what they wrote; the
 * facility's booked commitment is deliberately NOT substituted for it, so a row
 * reading "from $15M to $20M" means the message said both.
 */
function askLine(
  req: MailRequest | null,
  body: string | null,
  accountName: string | null,
): { ask: string | null; derived: boolean } {
  if (req?.actionable && req.intent && req.targetAmount !== null) {
    /* THE PRODUCT WORD, NEVER THE FULL BOOKED NAME. The org names a facility
       "Hartwell Precision Manufacturing LLC - Line of Credit - $15,000,000.00",
       which is a line of prose on its own AND carries the book's commitment
       into a sentence made of the client's figures. `facilityProduct` is the
       cockpit's own short name and strips both. */
    const name = req.facility ? facilityProduct(req.facility, accountName) : "facility";
    const move =
      req.currentAmount !== null
        ? `from ${fmtMoney(req.currentAmount)} to ${fmtMoney(req.targetAmount)}`
        : `to ${fmtMoney(req.targetAmount)}`;
    return { ask: words(`Asks to ${VERB[req.intent]} the ${name} ${move}`, ASK_WORDS), derived: true };
  }
  if (!body) return { ask: null, derived: false };
  // The client's own words, clipped at the first sentence and then at the word
  // budget. Nothing is rewritten and nothing is inferred.
  const sentence = body.split(/(?<=[.!?])\s/)[0] ?? body;
  return { ask: words(sentence, ASK_WORDS), derived: false };
}

/** Read one trail entry as a mail row, or refuse it. */
export function readMailRow(entry: ActivityEntry, bundle: BorrowerBundle | null): MailRow | null {
  if (!isMailEntry(entry)) return null;
  const subject = clipMail(entry.title, MAIL_SUBJECT_CHARS) ?? "Client message";
  const body = clipMail(entry.summary, MAIL_GIST_CHARS) ?? null;
  const req = readMailRequest({ subject: entry.title, preview: entry.summary }, bundle);
  const { ask, derived } = askLine(req, body, bundle?.snapshot?.name ?? null);
  return {
    from: entry.actor ?? entry.reference?.source ?? null,
    subject,
    ask,
    askDerived: derived,
    body,
    route: readRouteIntent(`${entry.title ?? ""} ${entry.summary ?? ""}`.trim()),
  };
}

/**
 * The message as the greeting's own mail block.
 *
 * `source: "swept"` is the honest label. This message came off a sync sweep
 * and is on the bundle. The block is byte-compatible with what
 * `mailNoteFromBundle` produces; what it adds is WHICH message, so a
 * relationship carrying several opens the room on the one the banker clicked.
 */
export function mailNoteFromEntry(
  entry: ActivityEntry,
  bundle: BorrowerBundle | null,
  generatedAt: string,
): BrainMail | null {
  const row = readMailRow(entry, bundle);
  if (!row) return null;
  const req = readMailRequest({ subject: entry.title, preview: entry.summary }, bundle);

  const note: BrainMail = { source: "swept" };
  if (row.from) note.from = row.from;
  const received = fmtDate(entry.ts);
  if (received && received !== "—") note.received = received;
  note.subject = row.subject;
  if (row.body) note.gist = row.body;
  if (generatedAt && entry.ts > generatedAt) note.arrivedAfterBook = true;
  if (req?.actionable && req.targetAmount !== null) {
    note.asked = {
      to: fmtMoney(req.targetAmount),
      ...(req.currentAmount !== null ? { from: fmtMoney(req.currentAmount) } : {}),
      ...(req.facility?.name ? { facility: req.facility.name } : {}),
    };
  }
  if (row.route) note.route = row.route;
  return note;
}

/**
 * THE ROUTE THE MESSAGE POINTS AT, AS THE ROOM'S OPENING QUESTION.
 *
 * The room already knows how to open on a signal: `smartAsk` renders the line
 * and offers the yes-chip beside "Something else", and the three routes stay
 * reachable. A message naming a credit action is exactly that shape of signal,
 * so it travels through the SAME opening rather than a fourth kind of question.
 *
 * Null where the message names no route. The room then asks the neutral
 * question with the message on the greeting, which is the greeting-v2 variant
 * for a message carrying no credit action.
 */
export function mailOpening(row: MailRow): SmartOpening | null {
  if (!row.route || !row.ask) return null;
  const line = row.askDerived && row.from ? `${row.from} ${lowerFirst(row.ask)}` : row.ask;
  return { line, route: row.route, yesLabel: OPEN_LABEL[row.route], memberId: null };
}

/**
 * OPEN OUR FACILITY WORKROOM ON THIS MESSAGE.
 *
 * Three moves, none of them new machinery, and the same three the intent
 * handoff makes: the message is carried so the greeting leads with it, the
 * cockpit flies to the relationship by the name flight the worklist row uses,
 * and the room opens through its OWN opener on the message's route.
 *
 * IT NEVER BINDS AND IT NEVER TYPES. The banker decides. The room opens with
 * the route chip offered, not chosen, and nothing the client wrote is staged.
 */
export function openMailRoom(args: {
  entry: ActivityEntry;
  bundle: BorrowerBundle | null;
  accountId: string;
  accountName: string;
  /** `meta.generatedAt`. Nothing here reaches a clock. */
  generatedAt: string;
  /** The cockpit's own OPEN_ACCOUNT dispatch. */
  navigate: (accountId: string) => void;
}): void {
  const row = readMailRow(args.entry, args.bundle);
  if (!row) return;

  /* THE SAME DOOR THE WHISPER OPENS (founder, 2026-09-03: "the same experience
     when clicking Open in workroom from the activity"). Where an intent is
     already waiting on this relationship, the mail row hands to it: the room
     binds the route and feeds the lines exactly as the whisper's Open does,
     rather than opening a bare greeting the banker must retype into. */
  const waiting = offerFor("account", args.accountId);
  if (waiting) {
    openIntent({ intent: waiting, navigate: args.navigate });
    return;
  }

  const note = mailNoteFromEntry(args.entry, args.bundle, args.generatedAt);
  if (note) carryMail(args.accountId, note);

  const src = flightSourceFor(args.accountId);
  const open = () => args.navigate(args.accountId);
  if (src) flyName(src, open);
  else open();

  /* THE ROOM OPENS AFTER THE VIEW HAS, exactly as an intent's does: the banker
     sees the cockpit land on the relationship before the glass comes over it. */
  const raise = () =>
    openFacilityRoom({ accountId: args.accountId, accountName: args.accountName, opening: mailOpening(row) });
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(raise);
  else raise();
}

/* ============================================================== the arrival

   A MESSAGE THAT JUST LANDED IS A WHISPER, NEVER A MODAL.

   The sweep is the only way mail enters this cockpit, so the arrival is a
   gesture the banker already made. What it earns is one line in the corner
   offering the room: the same glass, the same chips and the same manners as
   the intent whisper, because it is the same kind of fact: something someone
   said, waiting to become work.                                             */

export interface MailArrival {
  accountId: string;
  accountName: string;
  entry: ActivityEntry;
}

let arrival: MailArrival | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** A sweep landed inbound mail. The NEWEST message is the one offered: a
 *  corner that stacked would be a notification centre, which this is not. */
export function noteMailArrival(accountId: string, accountName: string, entries: ActivityEntry[]): void {
  const mail = entries.filter(isMailEntry).slice().sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""));
  if (!mail.length) return;
  arrival = { accountId, accountName, entry: mail[0] };
  emit();
}

/** The banker took it, or said Later. Either way it stops being offered. */
export function clearMailArrival(): void {
  if (!arrival) return;
  arrival = null;
  emit();
}

export function useMailArrival(): MailArrival | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => arrival,
    () => arrival,
  );
}

/**
 * THE ONE SENTENCE THE WHISPER SAYS.
 *
 * The sender, what they asked, and the room being offered. Every word is the
 * message's own or the room's; nothing is inferred and no figure is derived.
 */
export function mailWhisperLine(row: MailRow): string {
  const who = row.from ?? "The client";
  const what = row.ask && row.askDerived ? lowerFirst(row.ask) : `wrote about ${row.subject}`;
  const tail = row.route ? `Open the ${ROUTE_WORD[row.route]}?` : "Open the room?";
  return `${who} ${what}. ${tail}`;
}

/** Test seam: put the arrival back the way a fresh page finds it. */
export function __resetMailArrivalForTests(): void {
  arrival = null;
  emit();
}
