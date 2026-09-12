/**
 * THE HERO, DERIVED FROM THE BUNDLE.
 *
 * FOUNDER, 2026-09-09, opening a seeded relationship on the live book: "it only
 * shows Blue Ridge Orthopedic Partners PC but not the summary and the chips as
 * Hartwell has". Hartwell's summary paragraph and its four anchor chips were
 * hand-written into the baked snapshot in July, and the live sweep never wrote
 * either, so every relationship the page reads live opened as a name over an
 * empty strip. The baked Hartwell text had also gone stale: it states $46.0M
 * committed over a book that reads $54.0M.
 *
 * So the hero is DERIVED here, from the same reads the panes below it show,
 * for every relationship alike. One sentence of position, one sentence of
 * judgement, four chips. The judgement is rule-based and ranked: an exception
 * outranks an overdue test, which outranks thin coverage, which outranks a
 * tight covenant, and a clean book says so. Nothing here is a figure of its
 * own: every number is one the exposure or covenant read carries, formatted.
 */
import type { Anchor, BorrowerBundle, Covenant, Facility } from "../data/contract";
import { fmtMoney } from "../data/format";
import { BOOKED, stageRung } from "../data/facilityStage";

/** Millions the way the hero has always said them: "$46.0M", "$38.7M", "$27.75M".
 *  One decimal, a second only when it carries a figure; below a million, the
 *  cockpit's own formatter. */
export function mm(n: number): string {
  if (Math.abs(n) < 1e6) return fmtMoney(n);
  const fixed = (n / 1e6).toFixed(2);
  return "$" + (fixed.endsWith("0") ? fixed.slice(0, -1) : fixed) + "M";
}

export interface Hero {
  verdict: string;
  anchors: Anchor[];
}

/** Legal suffixes a banker drops in speech. */
const SUFFIX = /\b(llc|l\.l\.c\.|inc\.?|incorporated|corp\.?|corporation|co\.?|ltd\.?|limited|plc|pc|p\.c\.|lp|l\.p\.|llp|holdings?|group|partners|investors|international)\b\.?,?/gi;
/** First words that do not name a company on their own. */
const LEADING = new Set(["blue", "red", "green", "black", "white", "golden", "silver", "north", "south", "east", "west", "new", "old", "grand", "great", "big", "little", "first", "united", "prairie", "mountain", "coastal", "pacific", "atlantic", "royal", "saint", "st.", "st", "the", "la", "le", "el", "de", "van", "von"]);

/** "Blue Ridge Orthopedic Partners PC" -> "Blue Ridge"; "Hartwell Precision Manufacturing LLC" -> "Hartwell". */
export function shortName(name: string | undefined): string {
  const clean = (name ?? "").replace(SUFFIX, " ").replace(/[,]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "The relationship";
  const words = clean.split(" ");
  if (words.length === 1) return words[0];
  const take = LEADING.has(words[0].toLowerCase()) || words[0].length <= 2 ? 2 : 1;
  return words.slice(0, take).join(" ");
}

/* ------------------------------------------------------------ covenants */

type Sense = "min" | "max";
interface Read {
  c: Covenant;
  label: string;
  sense: Sense;
  value?: number;
  threshold?: number;
  /** Distance to the threshold as a share of it; negative once crossed. */
  headroom?: number;
  status: "exception" | "waived" | "compliant" | "open";
  overdueDays: number;
}

const MAX = /\b(max|maximum|leverage|debt to|debt\/|loan to value|ltv|capex|capital expenditure|fixed asset purchases|distributions?)\b/i;

/** The short label a chip carries. */
export function covenantLabel(type: string | undefined): string {
  const t = (type ?? "").trim();
  if (/debt service coverage/i.test(t)) return /distribution/i.test(t) ? "DSC (dist.)" : "DSC";
  if (/fixed charge/i.test(t)) return "FCC";
  if (/interest coverage/i.test(t)) return "ICR";
  if (/debt to worth|debt\/worth/i.test(t)) return "D/W";
  if (/leverage|debt to ebitda|debt\/ebitda|funded debt/i.test(t)) return "Leverage";
  if (/loan to value|ltv/i.test(t)) return "LTV";
  if (/liquidity/i.test(t)) return "Liquidity";
  if (/current ratio/i.test(t)) return "Current";
  if (/availability/i.test(t)) return "Availability";
  if (/tangible net worth|net worth/i.test(t)) return "TNW";
  if (/accounts receivable|receivable/i.test(t)) return "A/R";
  if (/capex|capital expenditure|fixed asset/i.test(t)) return "Capex";
  if (/field exam/i.test(t)) return "Field exam";
  if (/borrowing base/i.test(t)) return "Borrowing base";
  if (/term covenant/i.test(t)) return "Term";
  return t.split(/\s+/).slice(0, 2).join(" ") || "Covenant";
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A covenant value in its own unit: money, percent, or a ratio. */
export function covenantValue(type: string | undefined, v: number | undefined): string {
  if (v === undefined) return "—";
  const t = type ?? "";
  if (Math.abs(v) >= 10_000) return mm(v);
  if (/loan to value|ltv|advance rate|percent|%|accounts receivable/i.test(t) || Math.abs(v) > 20) return `${+v.toFixed(1)}%`;
  return `${v.toFixed(2).replace(/0$/, "")}×`;
}

function readCovenant(c: Covenant, today: number): Read {
  const type = c.covenantType;
  const sense: Sense = MAX.test(type ?? "") ? "max" : "min";
  const value = num(c.actualValue);
  const threshold = num(c.thresholdValue);
  let headroom: number | undefined;
  if (value !== undefined && threshold !== undefined && threshold !== 0) {
    headroom = sense === "min" ? (value - threshold) / Math.abs(threshold) : (threshold - value) / Math.abs(threshold);
  }
  const s = `${c.lastEvaluationStatus ?? ""} ${c.covenantStatus ?? ""}`.toLowerCase();
  const status: Read["status"] =
    c.breached === true || /exception|breach|out of compliance|non-?compliant|fail/.test(s)
      ? "exception"
      : /waive/.test(s)
        ? "waived"
        : /compliant|pass|in compliance/.test(s)
          ? "compliant"
          : "open";
  let overdueDays = 0;
  const days = num(c.daysUntilNextEvaluation);
  if (days !== undefined) overdueDays = days < 0 ? -days : 0;
  else if (c.nextEvaluationDate) {
    const due = Date.parse(c.nextEvaluationDate);
    if (Number.isFinite(due)) overdueDays = Math.max(0, Math.floor((today - due) / 86_400_000));
  }
  return { c, label: covenantLabel(type), sense, value, threshold, headroom, status, overdueDays };
}

const TIGHT = 0.1;

/* ---------------------------------------------------------------- hero */

/* -----------------------------------------------------------------------------
   BOOKED IS THE ONLY COMMITTED, AND EVERY UNBOOKED RUNG COUNTS AS UNBOOKED.

   LIVE DEFECT, 2026-09-12. Both predicates matched the word "Proposal" and
   nothing else on the ladder, so a facility at Qualification, Credit
   Underwriting, Final Review, Approval / Loan Committee, Processing, Doc Prep,
   Closing or Boarding read as BOOKED here.

   That is the exposure double-count the founder flagged. nCino files a
   modification as a forked package version holding a COPY of every member at an
   unbooked stage — Hartwell's live fork sits at Qualification — and the
   Customer360Exposure read sums every loan it returns into `totalCommitted`
   (`Customer360Exposure.cls:320`, over `Status != 'Closed'`). Subtracting only
   the Proposals left the copy in: Hartwell's booked $54.0M read as $67.5M, the
   $13.5M version counted a second time beside the facilities it copies. A
   revolver moved from $15M to $20M read as $35M.

   So the test is the ladder's own, and it is a position rather than a word:
   anything below `Booked` is not committed. `Complete` sits above Booked and
   stays counted — it is a loan that ran its course, not a proposal.
   ----------------------------------------------------------------------------- */
const BOOKED_RUNG = stageRung(BOOKED);

/** Unbooked, and carrying a figure. A stage this org does not name is NOT
 *  assumed unbooked: `stageRung` returns -1 and the facility keeps counting,
 *  which is the same fail-closed rule the rest of the book keeps. */
function isPending(f: Facility): boolean {
  const rung = stageRung(f.stage);
  return rung >= 0 && rung < BOOKED_RUNG && (f.committed ?? 0) > 0;
}

/**
 * ARCHIVED: the org has replaced or abandoned this loan.
 *
 * `Superseded` is nCino's own word for an original a later version replaced
 * (read off LLC_BI__Loan__c in bankinggpt-at 2026-09-12: a4Zbb000000xU0eEAE
 * carries Stage `Complete`, Status `Superseded`); `Withdrawn` is what a
 * discarded modification carries. Neither may reach a roll-up — for the
 * superseded one the loan that REPLACED it is already in the same read, so
 * counting both is the founder's $15M-plus-$20M exactly.
 */
function isArchived(f: Facility): boolean {
  const status = (f.status ?? "").toLowerCase();
  if (/withdrawn|declined|cancel/.test((f.stage ?? "").toLowerCase())) return true;
  return /closed|paid|cancel|superse|superce|withdrawn|declined/.test(status);
}

function isActive(f: Facility): boolean {
  if (isArchived(f) || isPending(f)) return false;
  return (f.committed ?? 0) > 0;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The hero for a bundle, or null when the bundle cannot yet say what the
 * relationship carries (no exposure read and no snapshot totals): a name over
 * an empty strip is then the honest state, not a sentence made of dashes.
 */
export function heroOf(bundle: BorrowerBundle | null | undefined, now: number = Date.now()): Hero | null {
  if (!bundle) return null;
  const snap = bundle.snapshot ?? {};
  const ex = bundle.exposure;
  const facilities = ex?.facilities ?? [];
  const active = facilities.filter(isActive);
  /* WHAT THE BANKER IS TOLD ABOUT SEPARATELY: the unbooked, which is real work
     in flight. An ARCHIVED facility is not named here at all — it is gone, not
     pending — so the two sets are summed apart. */
  const sum = (fs: Facility[]) => fs.reduce((s, f) => s + (f.committed ?? 0), 0);
  const pending = sum(facilities.filter((f) => isPending(f) && !isArchived(f)));
  const archived = sum(facilities.filter(isArchived));
  /* THE BOOKED FIGURE. The exposure read sums every loan it returns — every
     unbooked rung and every superseded original among them — so its total is
     committed-plus-unbooked-plus-archived. The hero states what is BOOKED AND
     LIVE (the in-flight-lock doctrine), names the unbooked apart, and never
     names the archived at all. */
  const gross = num(ex?.totalCommitted);
  const committed = gross !== undefined ? Math.max(0, gross - pending - archived) : num(snap.totalCreditExposure);
  if (committed === undefined) return null;
  /* THE DRAWN BALANCE OF AN ARCHIVED LOAN IS NOT DRAWN EITHER. A superseded
     original still carries its balance on the read, and the loan that replaced
     it carries the same money; counting both would put utilisation over 100%
     on a relationship that simply modified a facility. */
  const archivedDrawn = (ex?.facilities ?? [])
    .filter(isArchived)
    .reduce((s, f) => s + (typeof f.outstanding === "number" ? f.outstanding : 0), 0);
  const grossOutstanding = num(ex?.totalOutstanding) ?? num(snap.totalOutstanding) ?? 0;
  const outstanding = Math.max(0, grossOutstanding - archivedDrawn);
  const grossAvailable = num(ex?.totalAvailable);
  const available =
    grossAvailable !== undefined ? Math.max(0, grossAvailable - pending - archived) : Math.max(0, committed - outstanding);
  const grade = snap.primaryRiskRating ?? snap.computedRiskRating ?? null;
  const stage = snap.primaryStage ?? snap.packageStage ?? "Booked";
  const who = shortName(snap.name);

  const reads = (bundle.covenants?.covenants ?? []).map((c) => readCovenant(c, now));
  const graded = reads.filter((r) => r.status !== "open" || r.value !== undefined);
  const compliant = reads.filter((r) => r.status === "compliant" || r.status === "waived").length;
  const exceptions = reads.filter((r) => r.status === "exception");
  const overdue = reads.filter((r) => r.overdueDays > 0).sort((a, b) => b.overdueDays - a.overdueDays);
  const numeric = reads.filter((r) => r.headroom !== undefined);
  const tight = numeric.filter((r) => r.status !== "exception" && r.headroom! >= 0 && r.headroom! < TIGHT).sort((a, b) => a.headroom! - b.headroom!);
  const coverage = num(ex?.coverageRatio);
  const assets = num(ex?.uniqueCollateralCount);

  /* ------------------------------------------------- sentence one: position */
  let s1 = `${stage} at Grade ${grade ?? "—"}, ${who} carries ${mm(committed)} committed`;
  if (active.length) s1 += ` across ${plural(active.length, "facility", "facilities")}`;
  s1 += ` with ${mm(outstanding)} drawn and ${mm(available)} of headroom`;
  // "unbooked", not "proposed": the set is now every rung below Booked, which
  // includes a modification version sitting in approval.
  if (pending > 0) s1 += `, plus ${mm(pending)} unbooked`;
  if (reads.length) {
    const named = [...exceptions, ...overdue, ...tight, ...numeric.filter((r) => /^(DSC|FCC|Leverage|LTV)$/.test(r.label))]
      .filter((r, i, all) => all.indexOf(r) === i)
      .slice(0, 2)
      .map((r) =>
        r.status === "exception"
          ? `${r.label} ${covenantValue(r.c.covenantType, r.value)} in exception`
          : r.overdueDays > 0
            ? `the ${r.label} test ${plural(r.overdueDays, "day")} overdue`
            : `${r.label} ${covenantValue(r.c.covenantType, r.value)}`,
      );
    s1 += `; ${compliant} of ${plural(reads.length, "covenant")} test compliant${named.length ? ` (${named.join(", ")})` : ""}`;
  } else {
    s1 += `; no covenants are attached at the relationship level`;
  }
  s1 += ".";

  /* ------------------------------------------------ sentence two: judgement */
  const cover = coverage !== undefined ? `Collateral coverage sits at ${coverage.toFixed(2)}×${assets ? ` across ${plural(assets, "pledged asset")}` : ""}` : "";
  let s2: string;
  const worst = exceptions[0];
  if (worst) {
    const against = worst.threshold !== undefined ? ` against ${covenantValue(worst.c.covenantType, worst.threshold)}` : "";
    s2 = `${worst.label} sits in exception at ${covenantValue(worst.c.covenantType, worst.value)}${against}, so that is the figure to clear first`;
    if (cover) s2 += `; ${cover.charAt(0).toLowerCase()}${cover.slice(1)}`;
  } else if (overdue[0]) {
    s2 = `The ${overdue[0].label} test is ${plural(overdue[0].overdueDays, "day")} overdue, so the file, not the figures, is what needs attention`;
    if (cover) s2 += `; ${cover.charAt(0).toLowerCase()}${cover.slice(1)}`;
  } else if (coverage !== undefined && coverage < 1) {
    s2 = `${cover}, below par, so the cushion, not capacity, is the figure to watch`;
  } else if (tight[0]) {
    const t = tight[0];
    const floor = t.threshold !== undefined ? ` against a ${covenantValue(t.c.covenantType, t.threshold)} ${t.sense === "min" ? "floor" : "ceiling"}` : "";
    s2 = cover ? `${cover}, so ${t.label} at ${covenantValue(t.c.covenantType, t.value)}${floor} is the figure to watch` : `${t.label} at ${covenantValue(t.c.covenantType, t.value)}${floor} is the figure to watch`;
  } else if (cover) {
    s2 = `${cover}, so nothing on this relationship is pressing today`;
  } else if (reads.length) {
    s2 = `Nothing on this relationship is pressing today`;
  } else {
    s2 = `With no covenant package attached, the facilities themselves are the whole story`;
  }
  s2 += ".";

  /* ------------------------------------------------------------- the chips */
  const anchors: Anchor[] = [
    { label: "Rating", value: grade ? `Grade ${grade}` : "Unrated", sub: stage, dir: null },
    { label: "Committed", value: mm(committed), sub: `${mm(outstanding)} drawn`, dir: null },
  ];
  const chip = (r: Read): Anchor => {
    const bound = r.threshold !== undefined ? `${r.sense === "min" ? "Floor" : "Ceiling"} ${covenantValue(r.c.covenantType, r.threshold)}` : r.c.frequency ?? "";
    const note = r.status === "exception" ? " exception" : r.overdueDays > 0 ? ` overdue ${r.overdueDays}d` : r.headroom !== undefined && r.headroom >= 0 && r.headroom < TIGHT ? " tight" : r.status === "waived" ? " waived" : "";
    const bad = r.status === "exception" || r.overdueDays > 0 || note === " tight";
    return { label: r.label, value: covenantValue(r.c.covenantType, r.value), sub: `${bound}${note}`.trim(), dir: bad ? "down" : null };
  };
  const picked: Read[] = [];
  for (const r of [...exceptions, ...overdue, ...tight, ...numeric.filter((r) => /^(DSC|FCC|Leverage|LTV|D\/W)$/.test(r.label)), ...numeric, ...graded]) {
    if (picked.length === 2) break;
    if (!picked.includes(r) && (r.value !== undefined || r.overdueDays > 0 || r.status === "exception")) picked.push(r);
  }
  for (const r of picked) anchors.push(chip(r));
  if (anchors.length < 4 && coverage !== undefined) {
    anchors.push({ label: "Coverage", value: `${coverage.toFixed(2)}×`, sub: assets ? plural(assets, "pledged asset") : "collateral", dir: coverage < 1 ? "down" : null });
  }
  if (anchors.length < 4) {
    anchors.push({ label: "Headroom", value: mm(available), sub: `of ${mm(committed)}`, dir: null });
  }

  return { verdict: `${s1} ${s2}`, anchors };
}
