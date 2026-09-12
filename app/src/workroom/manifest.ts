import { MANIFEST_GROUPS, type ManifestGroupId, type WorkroomDelta } from "./types";

/* =============================================================================
   THE MANIFEST RAIL.

   It starts EMPTY (law 8) and everything in it arrived by a confirm. That is
   why every figure the room shows is DERIVED from what is actually in the rail
   rather than accumulated as the room goes: a removal then walks the counts and
   the pro-forma figures back exactly as the landing walked them forward, with
   no separate undo path to keep in step.

   Nothing here touches the DOM or React. The rail is a list and a derivation,
   and both are testable on their own.
   ============================================================================= */

/** Where the room starts. The account door of `create` starts at zero, which is
 *  a legitimate baseline and not a missing read. */
export interface ManifestBaseline {
  committedMM: number;
  members: number;
  /** Singular and plural for one thing in the rail, from the mode vocabulary. */
  changeWord: [string, string];
}

/**
 * THE SAME FIELD ON THE SAME MEMBER, ADDRESSED TWICE.
 *
 * A wire entry carries ONE value per field per member: `wirePayload` refuses a
 * plan holding two and the org could not file it either way round. A second
 * entry on that address is therefore not a second change, it is a CORRECTION of
 * the first.
 *
 * THE ADDRESS IS DELIBERATELY NARROW. Covenants, pledges, fees, parties and
 * policy exceptions carry no address at all, because a package legitimately
 * takes two of each and superseding one with the next would quietly delete work
 * the banker asked for.
 */
function wireAddress(delta: WorkroomDelta): string | null {
  if (delta.wire) return `scalar:${delta.wire.key}:${delta.wire.facilityId}`;
  if (delta.fieldWire) return `field:${delta.fieldWire.field}:${delta.fieldWire.facilityId}`;
  return null;
}

/** The entry this one REPLACES, or null. Exported so the room can name the
 *  figure that was walked over on the confirm that replaced it. */
export function supersededBy(entries: WorkroomDelta[], delta: WorkroomDelta): WorkroomDelta | null {
  const address = wireAddress(delta);
  if (!address) return null;
  return entries.find((e) => e.id !== delta.id && wireAddress(e) === address) ?? null;
}

/**
 * The rail, in landing order. Removal is by delta id, so the order of what is
 * left is the order it landed in.
 *
 * A CORRECTION SUPERSEDES (founder stress script, 2026-09-12, MODIFICATION 3.k:
 * "set 7%, then 'actually 8%' — 🚩 keeps the first or STACKS BOTH"). The note
 * below this function used to say the opposite, and stacking is what it
 * produced: 7% AND 8% on one facility, a plan that then refused to stage at
 * all, and the banker doing the room's bookkeeping by hand. The founder's
 * script supersedes that note. A second figure on the same wire address
 * REPLACES the first IN PLACE, so the rail keeps the order the banker built it
 * in and the entry stays where their eye last left it. Removal by × is
 * untouched, and everything the wire does not address still stacks.
 */
export function addEntry(entries: WorkroomDelta[], delta: WorkroomDelta): WorkroomDelta[] {
  if (entries.some((e) => e.id === delta.id)) return entries;
  const replaced = supersededBy(entries, delta);
  if (replaced) return entries.map((e) => (e.id === replaced.id ? delta : e));
  return [...entries, delta];
}

export function removeEntry(entries: WorkroomDelta[], deltaId: string): WorkroomDelta[] {
  return entries.filter((e) => e.id !== deltaId);
}

/* ------------------------------------------------- the rail, from the chat
   W2: "the chat must speak about what is staged and accept amendments
   conversationally (not only the rail's ×)". Two moves here and no more, because
   they are the two the rail itself offers: say what is in there, and take
   something out of it.

   AMENDING IS NOT A THIRD MOVE HERE, and it no longer has to be. This file used
   to answer "make it 19 instead" with "remove the entry and say it again", which
   is the bookkeeping the founder's stress script flags as a red flag (2026-09-12,
   MODIFICATION 3.k). Saying it again is now enough on its own: the new figure
   lands through `addEntry` and SUPERSEDES the old one at the same wire address.
   Every entry in the rail is still one the parser produced from one sentence. */

export type ManifestAddress =
  | { kind: "list"; entries: WorkroomDelta[] }
  | { kind: "remove"; entry: WorkroomDelta }
  /** A rail command that names MORE THAN ONE entry. Naming none is not a miss:
   *  it is a line for the parser, and it falls through as null. */
  | { kind: "miss"; reason: string }
  /** Not a rail command at all. The line belongs to the parser. */
  | null;

const LIST_PHRASES = [
  "what is staged",
  "what's staged",
  "what have we staged",
  "what is in the manifest",
  "what's in the manifest",
  "read the manifest",
  "show the manifest",
  "what is on the modification",
  "what have i confirmed",
];

const REMOVE_PHRASES = ["remove", "drop", "take out", "take off", "undo", "forget", "cancel", "delete", "scrap"];

/** The banker's own removal verb. It identifies NOTHING: an entry whose title
 *  begins "Remove a legal entity" would otherwise be named by every removal
 *  line ever typed. */
const REMOVE_WORDS = new Set(REMOVE_PHRASES.flatMap((p) => p.split(" ")));

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9$.%]+/)
    .filter((w) => w.length > 2);

/** What the banker reads on the FACE of an entry: what it is, and what kind of
 *  thing it is. Naming one of these is naming the entry. */
const identityWords = (e: WorkroomDelta): string[] =>
  words(`${e.title} ${e.kind}`).filter((w) => !REMOVE_WORDS.has(w));

/** What tells two entries of the SAME identity apart: the member they sit on
 *  and the figures they move between. A discriminant on its own identifies
 *  nothing — every amendment to a facility names that facility. */
const discriminantWords = (e: WorkroomDelta): string[] => words([e.target, e.after, e.before].join(" "));

/**
 * Does this line address something already in the rail?
 *
 * IT CLAIMS A LINE ONLY WHEN THE LINE NAMES AN ENTRY. The defect this closes,
 * found in a live click-through: "remove the guarantor Hartwell Industrial
 * Holdings LLC from the line of credit - $15,000,000.00" was claimed here on
 * the bare word "remove" and answered "Nothing is staged yet, so there is
 * nothing to take out" — so a borrowing-structure REMOVE, which the parser
 * files as a carry exclusion, never reached the parser at all. A removal verb
 * is not a rail command; a removal verb that NAMES an entry is.
 *
 * So an empty rail falls through unconditionally, and a rail that holds nothing
 * the line names falls through too. Both are the parser's lines, not this
 * function's.
 */
export function addressManifest(text: string, entries: WorkroomDelta[]): ManifestAddress {
  const lower = text.toLowerCase().trim();
  if (!lower) return null;

  if (LIST_PHRASES.some((p) => lower.includes(p))) return { kind: "list", entries };

  const removal = REMOVE_PHRASES.some((p) => new RegExp(`(^|\\W)${p}(\\W|$)`).test(lower));
  if (!removal || !entries.length) return null;

  // Match on the words the RAIL shows, so the banker removes a thing by what
  // they can see — but on the entry's IDENTITY first. The target only chooses
  // between entries the line has already named.
  const scored = entries
    .map((e) => ({
      entry: e,
      named: new Set(identityWords(e).filter((t) => lower.includes(t))).size,
      on: new Set(discriminantWords(e).filter((t) => lower.includes(t))).size,
    }))
    .filter((s) => s.named > 0)
    .sort((a, b) => b.named - a.named || b.on - a.on);

  if (!scored.length) return null;

  // A TIE IS AN AMBIGUITY, not a coin toss: taking the wrong entry out of a
  // change set the banker is about to sign is the one mistake that must not be
  // made quietly.
  const tied = scored.filter((s) => s.named === scored[0].named && s.on === scored[0].on);
  if (tied.length > 1) {
    return {
      kind: "miss",
      reason: `That could be ${tied.map((s) => `${s.entry.title} on ${s.entry.target}`).join(" or ")}. Name one.`,
    };
  }
  return { kind: "remove", entry: scored[0].entry };
}

/** The rail grouped the way a credit committee reads it. Empty groups do not
 *  render, so the rail grows a heading only when it has something under it. */
export function groupEntries(entries: WorkroomDelta[]): { id: ManifestGroupId; label: string; entries: WorkroomDelta[] }[] {
  return MANIFEST_GROUPS.map((g) => ({ ...g, entries: entries.filter((e) => e.group === g.id) })).filter(
    (g) => g.entries.length > 0,
  );
}

export interface ManifestFigures {
  count: number;
  /** Distinct existing members the rail touches. */
  membersChanged: number;
  /** Members the rail ADDS. */
  newMembers: number;
  committedMM: number;
  committedLabel: string;
  /** Empty until a landed change moves the figure, then labelled pro forma. */
  committedNote: string;
  membersLabel: string;
  membersNote: string;
  covenantNote: string;
  /** The rail's own header line. */
  countLine: string;
  /** The sentence on the plan card above the approve action. */
  planSummary: string;
}

/** Every figure the room shows, derived from the rail and the baseline and from
 *  nothing else. Called on every add and every remove; there is no other path. */
export function figuresFor(entries: WorkroomDelta[], baseline: ManifestBaseline): ManifestFigures {
  const touched = new Set(entries.map((e) => e.member).filter(Boolean));
  const newMembers = entries.filter((e) => e.newMember).length;
  const covenants = entries.filter((e) => e.group === "covenants").length;
  const committedMM = entries.reduce((sum, e) => sum + (e.committedDeltaMM ?? 0), baseline.committedMM);
  const moved = committedMM !== baseline.committedMM;
  const members = baseline.members + newMembers;
  const [one, many] = baseline.changeWord;
  const noun = entries.length === 1 ? one : many;

  // "N of M members" wherever there is an M to count against. A package that
  // does not exist yet has no denominator, and inventing "0 of 0" would be a
  // count of nothing presented as a selection.
  const memberClause = baseline.members > 0 ? `${touched.size} of ${baseline.members} members` : null;
  const newClause = newMembers ? `${newMembers} new member${newMembers > 1 ? "s" : ""}` : null;

  const countLine = entries.length
    ? [`${entries.length} ${noun}`, memberClause, newClause].filter(Boolean).join(" · ")
    : "Nothing staged";

  const planSummary = entries.length
    ? [
        `${entries.length} ${noun} staged.`,
        memberClause ? `${touched.size} of ${baseline.members} members changed.` : null,
        newMembers ? `${newMembers} member${newMembers > 1 ? "s" : ""} added.` : null,
      ]
        .filter(Boolean)
        .join(" ")
    : "Nothing staged.";

  return {
    count: entries.length,
    membersChanged: touched.size,
    newMembers,
    committedMM,
    committedLabel: `$${committedMM.toFixed(1)}MM`,
    committedNote: moved ? `pro forma · was $${baseline.committedMM.toFixed(1)}MM` : "",
    membersLabel: String(members),
    membersNote: newMembers ? `+${newMembers} proposed` : "",
    covenantNote: covenants ? `${covenants} proposed` : "",
    countLine,
    planSummary,
  };
}
