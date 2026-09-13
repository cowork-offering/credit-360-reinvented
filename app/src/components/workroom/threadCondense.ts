/* =============================================================================
   CONDENSED HISTORY, LIVE PRESENT — what the thread SHOWS, turn by turn.

   FOUNDER, 2026-09-13 (feedback bucket bug-1789294443785, Hartwell modification
   room): "the chips with earlier read etc etc. they basically pile up so that
   the answer is always directly above the chat, as mentioned i wanted to have it
   that only the current action is nicely shown in the chat you know what i mean?
   (likely in all workrooms)".

   THE PILE IS REAL AND IT IS MADE OF SPENT THINGS. After every answer the room
   left a chip row nobody can press again and a receipt row of its own on the
   glass, so four decisions read as a dozen blocks and the live question sat on
   the bottom edge of the column, directly above the composer.

   THE RULE: ONE TURN IS LIVE, EVERY EARLIER TURN IS ONE LINE. The turn the
   banker is in renders in full — the question, its chips, the open card.
   Everything before it condenses to a single quiet line in the rooms' own
   settled register, the way a banker recaps: "Commitment amount: $15M to $35M,
   confirmed". Nothing is lost: the line carries the turn's ids and the room
   brings the whole turn back on a click, one at a time.

   PURE, AND NOTHING UNMOUNTS. This decides what each item SHOWS and returns one
   decision per item, in order. A room maps its thread through it and renders the
   same wrappers it always did, so the settle choreography's `data-settle-state`
   contract, the absence tests and the word speech are all untouched — and the
   transcript (components/transcript.ts) still reads `items`, so the feedback
   bucket keeps the FULL history while only the glass condenses.
   ============================================================================= */

/** The shape this reads off a thread item. Every room's own union is wider; a
 *  field that is absent simply does not match a rule. */
export interface CondensableChip {
  state?: string;
  delta?: { title?: string; before?: string; after?: string } | null;
}

/** The two fields a settled row carries, plus the ritual's own step number. */
export interface CondensableRow {
  what?: string;
  how?: string;
  kicker?: string;
}

export interface CondensableItem {
  id: string;
  kind: string;
  /** The memo room's speaker: its bubbles are one kind with two sides. */
  who?: string;
  text?: string;
  row?: CondensableRow;
  covers?: readonly string[];
  chips?: readonly CondensableChip[];
}

/** The one line an earlier turn becomes. */
export interface Recap {
  /** "Step 2 of 6", where the room numbers its steps. */
  kicker?: string;
  /** The recap sentence itself. */
  text: string;
  /** Is there more under it than the line already says? */
  control: boolean;
  /** Has the banker opened it? The turn renders under the line while it is. */
  open: boolean;
}

export type ThreadShow<T> =
  /** Render the item as the room always has. */
  | { show: "full"; id: string; item: T }
  /** Render ONE recap line in place of this item, for the whole turn. */
  | { show: "recap"; id: string; item: T; recap: Recap }
  /** Render nothing. The node stays mounted; it has nothing left to say. */
  | { show: "none"; id: string; item: T };

/** THE LONGEST A RECAP CLAUSE MAY RUN before it is a paragraph again. A recap is
 *  a line a banker's eye crosses, not a sentence they read. */
const CLAUSE_MAX = 72;

/** A BANKER LINE OPENS A TURN, and nothing else does. The room's own answer, its
 *  cards, its chips and its receipts all belong to the turn that asked for them.
 *  `fed` is the intent handoff's marker line: somebody outside the room said it,
 *  and it opens a turn exactly as a typed line does. */
function opensTurn(item: CondensableItem): boolean {
  if (item.kind === "banker" || item.kind === "fed") return true;
  return item.kind === "say" && item.who === "banker";
}

/** A CHIP ROW NOBODY CAN PRESS AGAIN. The answer line carries what was chosen,
 *  so the row itself is spent and leaves the glass. */
function isSpentChips(item: CondensableItem): boolean {
  if (item.kind !== "chips") return false;
  const chips = item.chips ?? [];
  if (!chips.length) return true;
  return !chips.some((c) => c.state === "open");
}

const clean = (s: string | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

function shorten(s: string, max = CLAUSE_MAX): string {
  const said = clean(s);
  if (said.length <= max) return said;
  return `${said.slice(0, max).replace(/\s+\S*$/, "")}...`;
}

/**
 * THE FIELD A RECEIPT IS ABOUT, recovered from the exchange it covers.
 *
 * `rowForDelta` drops the field name where it prints both figures, because on a
 * row directly under the card the card already says which field it is. A recap
 * line standing on its own three turns later does not have that card, so the
 * name comes back — from the chip's own delta, never invented.
 */
function fieldFor(row: CondensableItem, byId: Map<string, CondensableItem>): string {
  for (const id of row.covers ?? []) {
    const covered = byId.get(id);
    for (const chip of covered?.chips ?? []) {
      const title = clean(chip.delta?.title);
      if (title) return title;
    }
  }
  return "";
}

/** The field's own name, without the unit the manifest carries in brackets: on a
 *  line that already prints "240 months" the unit is the same word twice. */
const bareField = (title: string): string => title.replace(/\s*\([^)]*\)\s*$/, "").trim();

/** The receipt's words with the field's name taken off the front, so a clause
 *  never says the field twice. */
function valueOf(what: string, title: string): string {
  for (const head of [title, bareField(title)]) {
    if (head && what.toLowerCase().startsWith(head.toLowerCase())) {
      return what.slice(head.length).replace(/^[\s:,-]+/, "");
    }
  }
  return what;
}

/** A receipt with no figure and no verdict in it records that the room ASKED,
 *  not what the banker decided. It earns a clause only where nothing later says
 *  more about the same field. */
const isProcedural = (row: CondensableRow): boolean =>
  !/[0-9\u2192]/.test(row.what ?? "") && clean(row.how) !== "acknowledged";

const norm = (s: string | undefined): string =>
  clean(s).replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").toLowerCase().trim();

/**
 * THE RECEIPTS A LATER ONE HAS ALREADY OVERTAKEN.
 *
 * The room files a receipt when it ASKS a pricing question and another when the
 * banker ANSWERS it, and a recap that carried both would say the amortisation
 * term twice, once with no figure. The first goes when a later receipt talks
 * about the same field; where nothing later does (a pricing ask the banker left
 * for later) it stands, because then it is the only thing that happened.
 */
function supersededRows(items: readonly CondensableItem[]): ReadonlySet<string> {
  const rows = items.filter((i) => i.kind === "settled" && i.row);
  const out = new Set<string>();
  rows.forEach((row, at) => {
    if (!isProcedural(row.row!)) return;
    const head = norm(row.row!.what);
    if (!head) return;
    if (rows.slice(at + 1).some((later) => norm(later.row!.what).startsWith(head))) out.add(row.id);
  });
  return out;
}

/** The word an acknowledged check condenses to (the founder's "effective
 *  challenge, acknowledged", as one clause rather than a row of its own). */
const CHALLENGED = "challenged, acknowledged";

/** ONE RECEIPT, AS ONE CLAUSE. */
function clauseFor(row: CondensableItem, byId: Map<string, CondensableItem>): string {
  const what = clean(row.row?.what);
  const how = clean(row.row?.how);
  if (how === "acknowledged") return CHALLENGED;
  const title = fieldFor(row, byId);
  const head = title ? `${bareField(title)}: ${valueOf(what, title)}` : what;
  if (!head) return how;
  return how && !head.toLowerCase().includes(how.toLowerCase()) ? `${head}, ${how}` : head;
}

/**
 * THE LINE A TURN BECOMES.
 *
 * Built from the turn's own receipts, in the order they were filed, deduplicated
 * and joined with the rooms' own separator. A turn that settled nothing is
 * recapped by what the banker said in it, which is the only honest thing left to
 * say about it.
 */
function recapFor(
  kept: readonly CondensableItem[],
  byId: Map<string, CondensableItem>,
  superseded: ReadonlySet<string>,
  open: boolean,
): Recap {
  const rows = kept.filter((i) => i.kind === "settled" && i.row);
  const say = (skip: boolean): string[] => {
    const out: string[] = [];
    for (const row of rows) {
      if (skip && superseded.has(row.id)) continue;
      const clause = shorten(clauseFor(row, byId));
      if (clause && !out.includes(clause)) out.push(clause);
    }
    return out;
  };
  /* NOTHING IS LOST TO THE SUPERSEDING RULE. A turn whose every receipt was
     overtaken still says what it was about, in its own words. */
  const kept0 = say(true);
  const clauses = kept0.length ? kept0 : say(false);
  if (!clauses.length) {
    const said = kept.find((i) => opensTurn(i) && clean(i.text));
    const spoke = kept.find((i) => clean(i.text));
    const text = shorten(clean(said?.text) || clean(spoke?.text) || "Earlier");
    return { text, control: kept.length > 1, open };
  }
  return {
    kicker: clean(rows[0].row?.kicker) || undefined,
    text: clauses.join(" · "),
    /* A TURN THAT IS NOTHING BUT ITS RECEIPT HAS NOTHING TO BRING BACK, and a
       control that opens an empty turn is the busyness this pass removes. */
    control: kept.some((i) => i.kind !== "settled"),
    open,
  };
}

/**
 * THE TURNS OF A THREAD, in order.
 *
 * A room that MODELS its exchanges (the memo room's `ex`) says where a turn
 * begins and ends itself, and `key` reads it; a room that does not is cut at
 * the banker's own lines, and everything before the first one is the room's
 * opening, which is a turn like any other.
 */
function turnsOf<T extends CondensableItem>(items: readonly T[], key?: (item: T) => string): T[][] {
  const turns: T[][] = [];
  let at: string | null = null;
  for (const item of items) {
    const here = key ? key(item) : null;
    const opens = key ? here !== at : opensTurn(item);
    at = here;
    if (!turns.length || opens) turns.push([item]);
    else turns[turns.length - 1].push(item);
  }
  return turns;
}

export interface CondenseOptions<T> {
  /** The recap lines the banker has expanded. A room that keeps a single id is
   *  one at a time by construction. */
  opened?: ReadonlySet<string>;
  /** ITEMS THAT ARE NOT PART OF A TURN. The entry tiers have their own
   *  choreography and their own summon; condensing one would give a node two
   *  owners and leave the summon opening nothing. */
  pinned?: (item: T) => boolean;
  /** A ROOM THAT MODELS ITS EXCHANGES NAMES ITS OWN TURNS. The memo room's
   *  receipts are inserted at the head of the exchange they close, ahead of the
   *  banker line that opened it, so cutting on banker lines would file a
   *  receipt under the turn before its own. */
  turnKey?: (item: T) => string;
  /** HOW MANY TURNS ARE THE PRESENT. One, unless the room already holds a wider
   *  stage of its own: the memo room's cap is two live exchanges (founder,
   *  2026-09-04) and the condensation does not overrule it. ZERO is a step the
   *  room has already put behind the live one: nothing in it is the present, so
   *  every turn in it is a line. */
  liveTurns?: number;
}

/**
 * WHAT EACH ITEM SHOWS, one decision per item, in thread order.
 *
 * Called on ONE step of the thread, which is the unit the rooms already render:
 * the last turn in it is the live one and every turn before it is a line.
 */
export function condenseThread<T extends CondensableItem>(
  items: readonly T[],
  opts: CondenseOptions<T> = {},
): Array<ThreadShow<T>> {
  const opened = opts.opened ?? new Set<string>();
  const pinned = opts.pinned ?? (() => false);
  const byId = new Map<string, CondensableItem>(items.map((i) => [i.id, i]));
  const superseded = supersededRows(items);
  const turns = turnsOf(items, opts.turnKey);
  const present = Math.max(0, opts.liveTurns ?? 1);
  const out: Array<ThreadShow<T>> = [];
  turns.forEach((turn, at) => {
    const live = present > 0 && at >= turns.length - present;
    const kept = turn.filter((i) => !isSpentChips(i) && !pinned(i));
    const carrier = kept.find((i) => i.kind === "settled" && i.row) ?? kept[0];
    const open = !!carrier && opened.has(carrier.id);
    /* A TURN WITH ONE THING IN IT IS ALREADY A LINE. Condensing it would swap
       one block for another and lose the room's own rendering of it. */
    const recap = !live && kept.length > 1 && carrier ? recapFor(kept, byId, superseded, open) : null;
    for (const item of turn) {
      if (isSpentChips(item)) out.push({ show: "none", id: item.id, item });
      else if (!recap || pinned(item)) out.push({ show: "full", id: item.id, item });
      else if (item.id === carrier!.id) out.push({ show: "recap", id: item.id, item, recap });
      /* OPENED, THE TURN IS BACK UNDER ITS OWN LINE. The line stays, so the
         gesture that opened it is the gesture that closes it again. */
      else out.push({ show: open ? "full" : "none", id: item.id, item });
    }
  });
  return out;
}
