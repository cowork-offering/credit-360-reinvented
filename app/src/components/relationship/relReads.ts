import type { ReadCardModel, ReadRow, ReadSource } from "../workroom/readCard";
import { relBookFor } from "./relBook";
import type { RelContext } from "./reviewFlows";

/* =============================================================================
   THE THREE READS THIS ROOM'S OWN SUBJECT MATTER NEEDS.

   `ask.ts` answers structure, covenants, collateral, fees and facilities, and
   they are the FACILITY room's five. Three questions a banker asks a
   relationship fall through all of them and reach the desk, or come back as a
   re-ask: what is the risk rating, when was the last review, what has the
   client asked for.

   THE SHARED READER IS NOT TOUCHED, AND THAT IS DELIBERATE.
   `ReadTopic`, `readTopic` and `buildReadCard` are the facility room's on every
   line it takes, and widening the union would mean a facility question that
   used to reach the desk now gets a card. That is a behaviour change in the
   room that is the founder's demo, for the sake of a room that is not. So this
   module is a SECOND reader, consulted only by the relationship room and only
   AFTER the shared one has declined the line. `ReadCardModel.topic` is already
   a plain string, so both lanes still render through one component.

   EVERY CARD BELOW IS BUILT FROM THE READ OR IT IS NOT BUILT. Null is answered
   by `relReadGap`, which says what no read on this cockpit carries. An empty
   card claiming "no reviews on file" would be a claim nothing supports: the
   read does not carry reviews at all, which is a different fact.
   ============================================================================= */

export type RelReadTopic = "rating" | "reviews" | "requests";

/** The openers that make a line a READ rather than an instruction. The same set
 *  `ask.ts` uses, because a banker asks both rooms the same way. */
const READ_OPENER =
  /\b(which|who|whose|what|when|list|show|tell me|do we|do i|have we|have i|are there|is there|how many|what's|whats|when's|whens)\b/i;

/** Anything that makes the line an instruction. Mirrors `ask.ts`'s own guard so
 *  "downgrade the rating" is never read as a question about the rating. */
const ACTS =
  /\b(add|adds|remove|removes|drop|drops|change|changes|set|sets|move|moves|increase|decrease|reduce|raise|lower|file|stage|log|run|open|start|downgrade|upgrade|re-?rate|re-?grade|override|affirm|assess|value|revalue|waive|raise)\b/i;

/** One topic per line, tested in the order a collision should resolve. */
const TOPICS: Array<[RelReadTopic, RegExp]> = [
  ["rating", /\b(risk[-\s]?rating|risk\s+grade|grade|rating)\b/i],
  ["reviews", /\b(reviews?|annual\s+review|last\s+review|re-?underwrit\w+)\b/i],
  ["requests", /\b(requests?|asked\s+for|service\s+requests?|cases?|tickets?)\b/i],
];

/**
 * THE RELATIONSHIP TOPIC A READ QUESTION IS ABOUT, or null.
 *
 * Called only where `readTopic` has already declined the line, so a question
 * naming a covenant or a facility never reaches here and the facility room's
 * five keep first refusal on every word they own.
 */
export function readRelTopic(text: string): RelReadTopic | null {
  const line = text.trim();
  if (!line) return null;
  if (ACTS.test(line)) return null;
  if (!READ_OPENER.test(line) && !bareTopic(line)) return null;
  for (const [topic, re] of TOPICS) if (re.test(line)) return topic;
  return null;
}

/** Past this it is a sentence, not a bare topic. `ask.ts`'s own rule. */
const BARE_WORD_CAP = 4;

function bareTopic(line: string): boolean {
  const words = line.replace(/[?.!]+$/, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > BARE_WORD_CAP) return false;
  return line.trim().endsWith("?") || /^any\b/i.test(line.trim());
}

/* ------------------------------------------------------------- the cards */

/**
 * THE GRADE ON FILE, WITH ITS SURFACE NAMED.
 *
 * Four grade surfaces are live in this org and they do not agree, so a grade
 * with no surface named is not a grade, it is a rumour. The card names which
 * one every figure sits on, and it claims nothing about the three it is not
 * reading: the probability of default, the loss given default and the
 * quantitative and qualitative scores exist on the rating object, are empty on
 * every record here, and are on no wire this room touches.
 */
function ratingCard(ctx: RelContext): ReadCardModel | null {
  const snapshot = ctx.bundle?.snapshot;
  const onFile = snapshot?.primaryRiskRating;
  const computed = snapshot?.computedRiskRating;
  if (onFile == null && computed == null) return null;

  const rows: ReadRow[] = [];
  if (onFile != null) {
    rows.push({
      icon: "commit",
      label: "Grade on file",
      value: String(onFile),
      detail: "On the relationship. Not the facility scale, and not the rating review's own.",
    });
  }
  if (computed != null) {
    rows.push({
      icon: "commit",
      label: "Computed",
      value: String(computed),
      detail: "The grade the read carries. A rating review files a proposal; Salesforce's formula decides the final.",
    });
  }

  /* THE FACILITY GRADES ARE A SECOND SCALE AND ARE LABELLED AS ONE. One
     borrower carries one grade; six facilities carry six, and that spread IS
     the dual rating this org actually holds. */
  const facilities = (ctx.bundle?.exposure?.facilities ?? []).filter((f) => f.riskGrade != null);
  const graded: ReadRow[] = facilities.map((f) => ({
    icon: "package",
    label: f.name?.trim() || f.loanId || "Facility",
    value: String(f.riskGrade),
  }));

  const groups = [{ heading: "The relationship", rows }];
  if (graded.length) groups.push({ heading: "The facilities, on their own scale", rows: graded });

  return {
    topic: "rating",
    lede:
      onFile != null
        ? `The grade on file for ${ctx.accountName} is ${onFile}, on the relationship.`
        : `${ctx.accountName} carries no grade on file; the read computes ${computed}.`,
    groups,
    followUp: "Run the risk-rating review, or read something else on the book?",
  };
}

/**
 * WHAT THE CLIENT HAS ASKED FOR, from the requests the read staged.
 *
 * Null where the read stages none, which is the Hartwell case today: no
 * requests block reaches this bundle at all. `relReadGap` then says the read
 * carries none rather than the room claiming the client has asked for nothing.
 */
function requestsCard(ctx: RelContext): ReadCardModel | null {
  const requests = ctx.bundle?.requests ?? [];
  if (!requests.length) return null;
  return {
    topic: "requests",
    lede: `${requests.length} ${requests.length === 1 ? "request is" : "requests are"} open on ${ctx.accountName}.`,
    groups: [
      {
        heading: "From the client",
        rows: requests.map<ReadRow>((r) => ({
          icon: "maturity",
          label: r.summary?.trim() || "Request",
          value: r.receivedAt ?? "no date",
          detail: r.reference?.source ? `From ${r.reference.source}.` : undefined,
        })),
      },
    ],
    followUp: "Raise one as a service request, or run one of the reviews?",
  };
}

export function buildRelReadCard(topic: RelReadTopic, ctx: RelContext, followUp?: string): ReadCardModel | null {
  const card = relCardFor(topic, ctx);
  /* THE LIVE QUESTION WINS WHERE THERE IS ONE. A read answered three questions
     into a review hands back to the review, not to the room's front door. */
  return card && followUp ? { ...card, followUp } : card;
}

function relCardFor(topic: RelReadTopic, ctx: RelContext): ReadCardModel | null {
  if (topic === "rating") return ratingCard(ctx);
  if (topic === "requests") return requestsCard(ctx);
  /* REVIEWS ARE NEVER A CARD, because no read on this cockpit carries
     `LLC_BI__Review__c`. That is a gap in the READ and not an empty history,
     and a card saying "no reviews" would be a claim nothing supports. */
  return null;
}

/** The honest sentence for a topic the room cannot read. It says WHY. */
export function relReadGap(topic: RelReadTopic, ctx: RelContext): string {
  if (topic === "reviews") {
    const book = relBookFor(ctx);
    void book;
    return (
      `No read on this cockpit carries the credit reviews already filed against ${ctx.accountName}, ` +
      "so I cannot tell you when the last one was or whether one is open. I can file a new one, and " +
      "if one is already open this files a second: there is no deployed path that edits the one on file."
    );
  }
  if (topic === "rating") {
    return `The read stages no risk grade for ${ctx.accountName}, on any of this org's four grade surfaces. A rating review would file the first one.`;
  }
  return `The read stages no client requests for ${ctx.accountName}, so there is nothing here the client has asked for. I can still raise a service request: tell me what they asked for.`;
}

/** The read source this room hands the shared builders. Kept here so the two
 *  readers stand on one context rather than two shapes of the same book. */
export type { ReadSource };
