/* =============================================================================
   Worklist reason-code derivation — pure, unit-tested (worklist.test.ts).

   All time-based reasons compute against meta.generatedAt in whole UTC days
   (SPEC §12 A10), never Date.now(). Thresholds are INCLUSIVE:
     COVENANT_DUE           next test  <= 45 days  (incl. overdue / negative)
     MATURITY_NEAR          maturity   0..270 days (past maturities never fire)
     RECENTLY_MODIFIED      mod age    <= 30 days
     MODIFICATION_CLUSTER   >= 3 modifications within 180 days

   THE 45-DAY GATE IS FOR BUNDLE COVENANTS ONLY. A bundle carries a
   relationship's whole covenant schedule, unfiltered, so the window is what
   makes "due" mean anything. `portfolio.signals.covenantsDueSoon` is already
   filtered in Apex to the org's own signalWindowDays off the org's own today;
   re-gating it here against a snapshot clock is not a stricter rule, it is a
   second, staler one, and it silently drops rows the org just flagged.

   Server-side (Apex) reason codes take precedence PER ACCOUNT (A9): a valid own
   entry in `worklist.reasons` replaces derivation for that id — including an
   explicit [] ("reviewed, no reasons"). Ids without one are derived here from
   the staged bundles + portfolio signals — the interim path until Apex lands.
   Server data is untrusted input and is validated at consumption.
   ============================================================================= */

import type {
  BorrowerBundle,
  C360Data,
  Id,
  ModificationEntry,
  ReasonCode,
  Worklist,
} from "./contract";
import { classifyCovenant } from "../domain/covenantStatus";
import { dayDiff } from "./time";

export const COVENANT_DUE_WINDOW_DAYS = 45;
export const MATURITY_NEAR_WINDOW_DAYS = 270;
export const RECENTLY_MODIFIED_WINDOW_DAYS = 30;
export const MODIFICATION_CLUSTER_WINDOW_DAYS = 180;
export const MODIFICATION_CLUSTER_MIN = 3;

/** Most-severe first. Drives chip order and worklist ranking. */
export const SEVERITY: ReasonCode[] = [
  // A30.4 — an inbound client request outranks every risk signal: a human is
  // waiting on an answer, which is more urgent than a metric drifting.
  "CLIENT_REQUEST",
  "COVENANT_BREACH",
  // Below breach, above "test due": an administrative Exception is a real
  // outstanding item, and it is NOT credit deterioration.
  "COVENANT_EXCEPTION",
  "COVENANT_DUE",
  "MATURITY_NEAR",
  "MODIFICATION_CLUSTER",
  "GUARANTOR_SIGNAL",
  "RECENTLY_MODIFIED",
];

/** A facility counts as active when status is absent or explicitly "Active"
 *  (F6). Closed / paid-off facilities never drive maturity alerts or display. */
/**
 * Is this facility LIVE?
 *
 * VOCABULARY, and it is the org's, not ours. A real loan's status is `Open`:
 * that is the value every live facility carries in bankinggpt, and `Booked +
 * Open` is the combination a credit action requires. `Active` is the sample-era
 * word and stays accepted so older staged bundles keep working; absent stays
 * active per F6.
 *
 * LIVE DEFECT 2026-07-26: this accepted only `""` and `active`, so every real
 * facility read as inactive. Modification and renewal greyed out on a
 * relationship with six booked loans, coverage math dropped them, and maturity
 * alerts went silent. One word, and the whole live surface behaved as if the
 * relationship had no facilities at all.
 *
 * Everything else stays inactive on purpose: Paid Off, Closed, Withdrawn and
 * Hold are all real states, and none of them is a facility you can act on.
 */
export function isActiveFacility(f: { status?: string }): boolean {
  const s = (f.status ?? "").trim().toLowerCase();
  return s === "" || s === "active" || s === "open";
}

/** True when the relationship carries an inbound client request — either a
 *  REQUEST_RECEIVED activity entry or a requests[] entry (A30.4). */
export function hasClientRequest(bundle: BorrowerBundle): boolean {
  if ((bundle.requests?.length ?? 0) > 0) return true;
  return (bundle.activity ?? []).some((a) => a.kind === "REQUEST_RECEIVED");
}

export function readModDate(m: ModificationEntry): string | null {
  return m.date ?? m.modifiedDate ?? m.modificationDate ?? m.effectiveDate ?? null;
}

const KNOWN_CODES = new Set<string>(SEVERITY);

/** Is `reasons` a usable plain object we can look ids up on? (R3.3)
 *  Arrays, null and primitives are rejected — server data is untrusted input. */
function isPlainReasonMap(r: unknown): r is Record<string, unknown> {
  return typeof r === "object" && r !== null && !Array.isArray(r);
}

/** Validate ONE server reason entry at consumption (R3.3). Returns the filtered
 *  code list, or null meaning "unusable — fall back to derivation". A non-array
 *  (null/garbage) entry is treated as ABSENT rather than crashing or being
 *  silently read as an empty, authoritative "reviewed, no reasons". */
function sanitizeServerReasons(value: unknown): ReasonCode[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((c): c is ReasonCode => typeof c === "string" && KNOWN_CODES.has(c));
}

function orderBySeverity(codes: Iterable<ReasonCode>): ReasonCode[] {
  const set = new Set(codes);
  return SEVERITY.filter((c) => set.has(c));
}

/** Derive reason codes for a single staged bundle relative to `generatedAt`. */
export function deriveReasonsForBundle(bundle: BorrowerBundle, generatedAt: string): ReasonCode[] {
  const codes = new Set<ReasonCode>();

  // CLIENT_REQUEST is presence-based, not time-based: it fires from the data
  // itself, so it still works when the clock is unusable (A30.4).
  if (hasClientRequest(bundle)) codes.add("CLIENT_REQUEST");

  // ONE classifier decides what a covenant status means (domain/covenantStatus).
  // A financial breach and an administrative Exception are different reasons and
  // must never collapse into one another: 101 of 140 compliance rows in this org
  // sit at Exception with nothing measured, and calling those breaches would put
  // the whole book on the queue as credit deterioration.
  for (const cov of bundle.covenants?.covenants ?? []) {
    const verdict = classifyCovenant(cov);
    if (verdict.financialBreach) {
      codes.add("COVENANT_BREACH");
      continue;
    }
    if (verdict.kind === "exception") {
      // An exception row is overdue by construction, so it subsumes "test due"
      // the same way a breach does.
      codes.add("COVENANT_EXCEPTION");
      continue;
    }
    const d = dayDiff(cov.nextEvaluationDate, generatedAt);
    if (d !== null && d <= COVENANT_DUE_WINDOW_DAYS) codes.add("COVENANT_DUE");
  }

  // Maturity. ACTIVE facility maturities are AUTHORITATIVE and EXCLUSIVE: when
  // the bundle carries any usable active-facility maturity, the structural
  // maturityWatch is ignored entirely for this account — a stale watch entry
  // must not outvote current facility data (R3.2). maturityWatch is consulted
  // only when there is no usable facility maturity at all.
  // A maturity already in the PAST (d < 0) never fires: it matured, it is not
  // "near" (F6).
  const facilityDays = (bundle.exposure?.facilities ?? [])
    .filter(isActiveFacility)
    .map((f) => dayDiff(f.maturityDate, generatedAt))
    .filter((d): d is number => d !== null);

  const maturityDays = facilityDays.length
    ? facilityDays
    : (bundle.signals?.maturityWatch ?? [])
        .map((m) => dayDiff(m.maturityDate, generatedAt))
        .filter((d): d is number => d !== null);

  if (maturityDays.some((d) => d >= 0 && d <= MATURITY_NEAR_WINDOW_DAYS)) {
    codes.add("MATURITY_NEAR");
  }

  const sig = bundle.signals;
  if (sig) {
    if ((sig.guarantorSignals?.length ?? 0) > 0) codes.add("GUARANTOR_SIGNAL");

    const mods = sig.modifications ?? [];
    let recent = 0;
    let inCluster = 0;
    for (const m of mods) {
      const md = readModDate(m);
      if (!md) continue;
      const age = dayDiff(generatedAt, md); // days since modification
      if (age === null || age < 0) continue;
      if (age <= RECENTLY_MODIFIED_WINDOW_DAYS) recent++;
      if (age <= MODIFICATION_CLUSTER_WINDOW_DAYS) inCluster++;
    }
    if (recent > 0) codes.add("RECENTLY_MODIFIED");
    // Honor a server-set cluster flag OR the ≥3-in-180d rule.
    if (sig.modificationClusterFlag === true || inCluster >= MODIFICATION_CLUSTER_MIN) {
      codes.add("MODIFICATION_CLUSTER");
    }
  }

  return orderBySeverity(codes);
}

/**
 * Which relationships carry a covenant test that is ALREADY PAST DUE.
 *
 * BREACH > OVERDUE test > DUE test is the founder's own ordering, and the
 * vocabulary does not need a ninth reason code to say it: the chip has always
 * read "Test due · 2d ago" and turned red on a negative day count. This is the
 * same fact, lifted so the QUEUE can rank on it too.
 *
 * The org's own `overdue` flag wins where it is present: Apex computed it
 * against the org's today, which on a snapshot assembled weeks ago is the more
 * honest clock. Everything else measures against `meta.generatedAt` (A10).
 */
export function overdueTestIds(data: C360Data): Set<Id> {
  const generatedAt = data.meta?.generatedAt ?? "";
  const out = new Set<Id>();

  for (const c of data.portfolio?.signals?.covenantsDueSoon ?? []) {
    if (!c.accountId) continue;
    if (c.overdue === true) {
      out.add(c.accountId);
      continue;
    }
    if (c.overdue === false) continue;
    const d = dayDiff(c.nextEvaluationDate, generatedAt);
    if (d !== null && d < 0) out.add(c.accountId);
  }

  const bundles: Record<Id, BorrowerBundle> = { ...(data.borrowers ?? {}) };
  const anchorId = data.borrower?.snapshot?.accountId;
  if (anchorId && !Object.hasOwn(bundles, anchorId)) bundles[anchorId] = data.borrower;
  for (const [id, bundle] of Object.entries(bundles)) {
    for (const cov of bundle?.covenants?.covenants ?? []) {
      const verdict = classifyCovenant(cov);
      // A breach and an administrative exception are their own reasons and rank
      // on their own; neither is "the test is late".
      if (verdict.financialBreach || verdict.kind === "exception") continue;
      const d = dayDiff(cov.nextEvaluationDate, generatedAt);
      if (d !== null && d < 0) out.add(id);
    }
  }
  return out;
}

/** Build the worklist for the whole book.
 *
 *  A9 per-account precedence (F3): a server `worklist.reasons` entry REPLACES
 *  derivation for that id — including an explicit `[]`, which means "reviewed,
 *  no reasons". Ids with no own entry are derived. Server `accountIds` set the
 *  row set when present.
 *
 *  F1: a missing/unparseable date yields NO reason. Absence of evidence is not
 *  evidence of an alert — an unknown date renders an honest gap, never a
 *  fabricated one.
 *
 *  F4: derived ids are filtered to accounts that actually exist in
 *  portfolio.accounts or borrowers, so a stray signal cannot conjure a ghost row.
 *
 *  F5: time-based derivation requires a valid meta.generatedAt. Without it the
 *  time reasons are skipped entirely rather than falling back to another field. */
export function deriveWorklist(data: C360Data): Worklist {
  const generatedAt = data.meta?.generatedAt ?? "";
  const clockOk = dayDiff(generatedAt, generatedAt) !== null;

  const knownIds = new Set<Id>([
    ...(data.portfolio?.accounts ?? []).map((a) => a.accountId).filter(Boolean),
    ...Object.keys(data.borrowers ?? {}),
  ]);
  const anchorId = data.borrower?.snapshot?.accountId;
  if (anchorId) knownIds.add(anchorId);

  const bundles: Record<Id, BorrowerBundle> = { ...(data.borrowers ?? {}) };
  if (anchorId && !Object.hasOwn(bundles, anchorId)) bundles[anchorId] = data.borrower;

  /** Derive one account's reasons from its bundle + portfolio-level signals. */
  const deriveFor = (id: Id): ReasonCode[] => {
    const codes = new Set<ReasonCode>();
    const bundle = bundles[id];
    if (bundle) {
      // Presence-based reasons need no clock.
      if (hasClientRequest(bundle)) codes.add("CLIENT_REQUEST");
      if (clockOk) for (const c of deriveReasonsForBundle(bundle, generatedAt)) codes.add(c);
    }

    const sig = data.portfolio?.signals;
    if (sig && clockOk) {
      for (const c of sig.covenantsDueSoon ?? []) {
        if (c.accountId !== id) continue;
        /* THE ORG ALREADY DREW THE WINDOW. `covenantsDueSoon` is filtered in
           Apex to `signalWindowDays` (90) off the ORG's own today, and a second
           45-day gate here measured against a BAKED `generatedAt` is not a
           stricter rule: it is a different clock. A cockpit whose snapshot was
           assembled six weeks ago would drop a test the org just told us is due
           in October, which is precisely the row a banker opened the page for.
           F1 still holds — a signal row carrying no READABLE date and no day
           count fires nothing at all. */
        const readable =
          dayDiff(c.nextEvaluationDate, generatedAt) !== null || typeof c.daysUntilNextEvaluation === "number";
        if (readable) codes.add("COVENANT_DUE");
      }
      for (const m of sig.maturitiesSoon ?? []) {
        if (m.accountId !== id) continue;
        const d = dayDiff(m.maturityDate, generatedAt);
        if (d !== null && d >= 0 && d <= MATURITY_NEAR_WINDOW_DAYS) codes.add("MATURITY_NEAR");
      }
    }
    return orderBySeverity(codes);
  };

  const server = data.worklist;
  const reasons: Record<Id, ReasonCode[]> = {};

  // Candidate row set: the server's list when given, else every known account.
  const candidates: Id[] = server?.accountIds?.length
    ? server.accountIds.filter((id) => knownIds.has(id))
    : [...knownIds];

  const serverReasons = isPlainReasonMap(server?.reasons) ? server.reasons : null;

  for (const id of candidates) {
    // A9: an own, VALID server entry wins outright (even an empty array, which
    // means "reviewed, no reasons"). Missing or malformed ⇒ derive (R3.3).
    const own = serverReasons && Object.hasOwn(serverReasons, id) ? sanitizeServerReasons(serverReasons[id]) : null;
    const base = own ?? deriveFor(id);

    // NARROW, DELIBERATE EXCEPTION to A9 server precedence — CLIENT_REQUEST only.
    //
    // The server worklist is computed from nCino. Inbound client requests arrive
    // over a DIFFERENT channel (M365/Graph, A29) that the Apex worklist has no
    // visibility into, so a server entry omitting CLIENT_REQUEST is silence, not
    // a judgement that no request exists. Suppressing it would show a request in
    // the Activity tab while the queue says nothing is waiting — the exact
    // dishonesty the honesty rules exist to prevent.
    //
    // Scope is deliberately minimal: additive only, never removes or reorders a
    // server reason, and only for this one presence-derived code. Once the Apex
    // worklist emits CLIENT_REQUEST itself this becomes a no-op (the code is
    // already present, and the Set de-duplicates).
    const bundle = bundles[id];
    const merged =
      bundle && hasClientRequest(bundle) && !base.includes("CLIENT_REQUEST")
        ? [...base, "CLIENT_REQUEST" as ReasonCode]
        : base;

    reasons[id] = orderBySeverity(merged);
  }

  // With no server list, only accounts that actually have reasons make the queue.
  const rows = server?.accountIds?.length ? candidates : candidates.filter((id) => reasons[id].length > 0);
  for (const id of Object.keys(reasons)) if (!rows.includes(id)) delete reasons[id];

  const tce = new Map<Id, number>();
  for (const a of data.portfolio?.accounts ?? []) tce.set(a.accountId, a.tce ?? 0);
  const worstRank = (id: Id) => {
    const r = reasons[id];
    return r?.length ? SEVERITY.indexOf(r[0]) : SEVERITY.length;
  };

  const accountIds = rows.sort((a, b) => {
    const s = worstRank(a) - worstRank(b);
    if (s !== 0) return s;
    return (tce.get(b) ?? 0) - (tce.get(a) ?? 0);
  });

  return { accountIds, reasons };
}
