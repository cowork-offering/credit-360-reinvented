import type { ReactNode } from "react";
import { briefingItemSentence, type Briefing } from "../../channel/relationshipBriefing";
import "../../styles/briefing.css";

/* =============================================================================
   THE BRIEFING, ON THE GLASS.

   FIVE SECTIONS, EACH ONE PARAGRAPH. Not a tile grid: a tile grid is what the
   room already had, and it is what reads flat. A briefing is prose a credit
   officer would say out loud, so each section is a run of sentences under one
   quiet label, and the labels are the only chrome.

   IT COMPOSES NOTHING. Every sentence on this surface is written by
   `channel/relationshipBriefing.ts` and rendered verbatim. The component owns
   the order, the labels and the material; it owns no words. That split is what
   lets the golden-rule scan run over the builder and cover what the banker
   actually reads.

   THE GAP IS THE LAST SECTION AND IT IS ALWAYS RENDERED WHERE THERE IS ONE. A
   room that shows what it knows and hides what it does not is worse than a room
   that shows neither: the banker cannot tell a clean read from a thin one.

   THE MATERIAL IS THE ROOM'S. Solid surface, hairline border, the card shadow,
   the same arrival curve the thread's other blocks use. No backdrop-filter, so
   the glass census is unchanged (the rule `styles/relationship.css` states).
   ============================================================================= */

/** The label on each section. The order is the order the founder set: what is
 *  due, what it is tied to (inside the item's own sentence), what changed, what
 *  the room needs, what the committee will ask, and what is missing. */
const NEEDS_LABEL = "What I need from you";

export interface BriefingProps {
  briefing: Briefing;
  /** The heading the room prints above the briefing, where it prints one. */
  title?: string;
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="bf-sec">
      <h4 className="bf-k">{label}</h4>
      {children}
    </section>
  );
}

/** THE GAPS, ONE SENTENCE EACH. The builder writes two shapes into `gaps`: a
 *  noun phrase ("the fees already charged on these facilities") and a full
 *  sentence ("no inbox rows are loaded on this relationship, so the room cannot
 *  say whether the certificate arrived"). Joined after one lede they collided
 *  ("does not carry no inbox rows are loaded"). A phrase gets the lede, a
 *  sentence stands on its own, and each ends where a sentence ends. */
const SENTENCE_SHAPED = /^(no|none|nothing|not|this|that|the (read|room|trail|book) |it |what )|, so |does not|cannot|is not|are not|never /i;
export function gapSentences(gaps: readonly string[]): string {
  return gaps
    .map((g) => g.trim().replace(/\.$/, ""))
    .filter(Boolean)
    .map((g) => (SENTENCE_SHAPED.test(g) ? g.charAt(0).toUpperCase() + g.slice(1) : `Not on this read: ${g}`) + ".")
    .join(" ");
}

export function RelationshipBriefing({ briefing, title }: BriefingProps) {
  const { opening, due, changedSince, needs, committee, gaps } = briefing;
  return (
    <article className="bf" data-route={briefing.route ?? "opening"} aria-label={title ?? "Briefing"}>
      <p className="bf-lede">{opening}</p>

      {due.length > 0 && (
        <Section label="What is due">
          {due.map((item, i) => (
            <p className="bf-p" key={`${item.what}-${i}`}>
              {briefingItemSentence(item)}
            </p>
          ))}
        </Section>
      )}

      {/* WHAT MOVED, AS ONE PARAGRAPH ACROSS EVERY LANE. The lane is carried as
          a data attribute rather than as a badge: the banker reads a paragraph,
          and the lane is there for anyone inspecting where a sentence came
          from. The SOURCE rides the title, so it is one hover away and never a
          line of chrome between two facts. */}
      {changedSince.length > 0 && (
        <Section label="What has changed since">
          <p className="bf-p">
            {changedSince.map((change, i) => (
              <span className="bf-chg" key={`${change.lane}-${i}`} data-lane={change.lane} title={change.source}>
                {change.sentence}{" "}
              </span>
            ))}
          </p>
        </Section>
      )}

      {needs.length > 0 && (
        <Section label={NEEDS_LABEL}>
          {needs.map((need, i) => (
            <p className="bf-p" key={`${need.ask}-${i}`}>
              <b className="bf-ask">{need.ask}</b> {need.why}
            </p>
          ))}
        </Section>
      )}

      {committee.length > 0 && (
        <Section label="What the committee will ask">
          <p className="bf-p">{committee.join(" ")}</p>
        </Section>
      )}

      {gaps.length > 0 && (
        <Section label="Not in front of me">
          <p className="bf-p bf-gap">
            {gapSentences(gaps)}
          </p>
        </Section>
      )}
    </article>
  );
}
