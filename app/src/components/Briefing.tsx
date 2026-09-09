import { fmtDate, fmtDays } from "../data/format";
import type { WorklistRow } from "../data/worklistRows";
import type { ReasonCode } from "../data/contract";
import { BriefingSkeleton } from "./HomeSkeleton";

/* =============================================================================
   THE BRIEFING — the landing opens like a morning brief, not a list.

   Rule 60: the headline rises WORD BY WORD, 70ms apart, from 120ms. Rule 68.6:
   the kicker carries the REAL date, read off the client's clock. Copy rule: no
   em dashes anywhere in UI copy.

   THE LEAD IS ASSEMBLED, NEVER WRITTEN. Every clause below is a real row, a
   real reason code and a real day count. The dummy's paragraph is prose because
   the dummy's three clients are authored; here the same shape is built from the
   queue, so the sentence cannot drift away from the figures under it. The
   snapshot date is stated at the end for the same reason: the kicker says what
   day it is for the reader, and the book says what day it is FROM.
   ============================================================================= */

const NUMBER_WORDS = [
  "No", "One", "Two", "Three", "Four", "Five", "Six",
  "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function todayKicker(now = new Date()): string {
  return `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()} · your book`;
}

/** Two lines, exactly as the mint sets it: the count and its noun, then the
 *  verb. Numbers up to twelve are spelled; past that the figure reads better. */
export function headlineLines(n: number): [string, string] {
  const word = n >= 0 && n <= 12 ? NUMBER_WORDS[n] : String(n);
  return n === 1 ? [`${word} relationship`, "needs you today."] : [`${word} relationships`, "need you today."];
}

/** One clause per row, off its loudest reason code and that reason's own clock.
 *  A reason with nothing to count stays a plain statement of what it is. */
function clauseFor(r: WorklistRow): string {
  const code: ReasonCode | undefined = r.reasons[0];
  switch (code) {
    case "COVENANT_BREACH":
      return `${r.name} is in covenant breach`;
    case "COVENANT_EXCEPTION":
      return `${r.name} carries a recorded covenant exception`;
    case "COVENANT_DUE":
      return r.nextTestDays != null
        ? `${r.name} has a covenant test ${fmtDays(r.nextTestDays)}`
        : `${r.name} has a covenant test due`;
    case "MATURITY_NEAR":
      return r.maturityDays != null
        ? `${r.name} matures ${fmtDays(r.maturityDays)}`
        : `${r.name} has a maturity in the window`;
    case "CLIENT_REQUEST":
      return `${r.name} has a client request waiting`;
    case "GUARANTOR_SIGNAL":
      return `${r.name} has a guarantor signal`;
    case "MODIFICATION_CLUSTER":
    case "RECENTLY_MODIFIED":
      return `${r.name} was modified recently`;
    default:
      return `${r.name} is on the queue`;
  }
}

export function leadParagraph(rows: WorklistRow[], bookSize: number, generatedAt: string): string {
  const asOf = `Book as of ${fmtDate(generatedAt)}.`;
  if (rows.length === 0) {
    return `Nothing in the book is outside tolerance on this snapshot. ${asOf}`;
  }
  const named = rows.slice(0, 2).map(clauseFor);
  const rest = rows.length - named.length;
  const parts = [...named];
  if (rest > 0) parts.push(`${rest} more ${rest === 1 ? "sits" : "sit"} on the queue`);
  const lead = parts.length > 1
    ? `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}.`
    : `${parts[0]}.`;
  const clear = bookSize > rows.length ? " Everything else in the book is current." : "";
  return `${lead}${clear} ${asOf}`;
}

/** Word-rise boot (rule 60): 70ms apart, from 120ms, counted across BOTH lines
 *  so the second line continues the first rather than restarting it. */
export function Briefing({
  rows,
  bookSize,
  generatedAt,
  booting,
}: {
  rows: WorklistRow[];
  bookSize: number;
  generatedAt: string;
  /** True on a fresh open while the org's book is still on its way. The lead is
   *  ASSEMBLED FROM THE BOOK, so narrating it over the baked samples would state
   *  a count and name relationships the read is about to replace. It waits. */
  booting?: boolean;
}) {
  if (booting) return <BriefingSkeleton />;
  const lines = headlineLines(rows.length);
  let idx = 0;
  return (
    <div className="brief">
      <div className="eyebrow">
        <span className="kicker" data-probe="brief-date">
          {todayKicker()}
        </span>
      </div>
      <h1>
        {lines.map((line, li) => (
          <span key={li}>
            {li > 0 && <br />}
            {line.split(" ").map((word, wi) => (
              <span key={wi}>
                {/* The space sits OUTSIDE the rising span: an inline-block that
                    owns its leading space carries it up on the transform. */}
                {wi > 0 ? " " : null}
                <span className="bw" style={{ animationDelay: `${120 + idx++ * 70}ms` }}>
                  {word}
                </span>
              </span>
            ))}
          </span>
        ))}
      </h1>
      <p>{leadParagraph(rows, bookSize, generatedAt)}</p>
    </div>
  );
}
