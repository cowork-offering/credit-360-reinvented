#!/usr/bin/env node
// Structural + coverage checks for the Credit 360 cockpit data contract.
// SPEC.md §5 (data contract) + §12 v1.1 amendments A6–A8, A10 + Codex round 2 fixes (see inline
// notes tagged R2-n). Imported by assemble-cockpit.mjs. Split into its own module so the rules
// are unit-testable in isolation (see contract-checks.test.mjs) without spinning up the whole
// assembler.
//
// SYNC NOTE (A7): this is the runtime-checked plain-JS mirror of the TypeScript authoritative
// shape in app/src/data/contract.ts. If contract.ts's shape changes, update the checks here too —
// nothing enforces the sync automatically (pragmatic scope; no codegen, per A7).
//
// No dependencies beyond node built-ins. Node 18+ (uses Object.hasOwn, Node 16.9+).

export class ContractError extends Error {}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * A6: `borrowers` must be a plain non-array object; an own entry for `meta.anchorAccountId` is
 * ALWAYS required (regardless of what's in portfolio/worklist); every bundle's
 * `snapshot.accountId` must match its own map key (catches copy-paste bundle mixups).
 * Throws ContractError — always fatal, never bypassable by --allow-partial (this is about
 * internal shape integrity, not staging completeness).
 */
export function assertBorrowersStructure(data) {
  const anchorId = data && data.meta && data.meta.anchorAccountId;
  if (!anchorId) throw new ContractError("meta.anchorAccountId is required");

  const borrowers = data.borrowers;
  if (!isPlainObject(borrowers)) {
    throw new ContractError("data.borrowers must be a plain object (not an array, not null, not missing)");
  }
  if (!Object.hasOwn(borrowers, anchorId)) {
    throw new ContractError(`data.borrowers has no own entry for meta.anchorAccountId ("${anchorId}") — the anchor bundle is always required`);
  }
  for (const key of Object.keys(borrowers)) {
    const bundle = borrowers[key];
    if (!isPlainObject(bundle) || !isPlainObject(bundle.snapshot)) {
      throw new ContractError(`data.borrowers["${key}"] is missing a snapshot object`);
    }
    if (bundle.snapshot.accountId !== key) {
      throw new ContractError(`data.borrowers["${key}"].snapshot.accountId ("${bundle.snapshot.accountId}") does not match its own map key ("${key}")`);
    }
  }
}

/**
 * A10 + Codex R2 finding 3: `meta.generatedAt` is the deterministic clock every time-based
 * worklist derivation (client AND server) reasons against — `Date.now()` is never used. The
 * assembler is the fail-closed gate: reject a missing or non-ISO value here rather than let a
 * bad artifact ship and have the client-side deriver silently refuse to run (or worse, fall back
 * to wall-clock time) downstream.
 */
// Captures: 1 year, 2 month, 3 day, 4 hour, 5 min, 6 sec, 7 fractional (optional), 8 full offset,
// 9 offset sign, 10 offset hour, 11 offset min (9-11 absent when offset is "Z").
const ISO_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Codex round 3 finding 3: the regex + Date.parse from round 2 still let an invalid calendar date
 * through — `new Date("2026-02-30T10:00:00Z")` doesn't throw, it silently NORMALIZES to
 * 2026-03-02T10:00:00.000Z (JS Date has no calendar validity check anywhere). Close the hole by
 * round-tripping: shift the parsed instant back by the stated offset and read it via
 * `toISOString()`, then compare those date/time fields against the ones captured from the input
 * string. A mismatch means the input's calendar components were out of range and got silently
 * rolled over — reject it. (Equivalent to "does `new Date(v).toISOString()` reproduce the same
 * Y-M-D-h-m-s-ms the string claimed", per the finding.)
 *
 * Pure/boolean so round-4's activity[]/requests[] timestamp checks can reuse the exact same
 * validity rule as meta.generatedAt itself ("consistent with the generatedAt discipline").
 */
function isValidIsoInstant(v) {
  if (typeof v !== "string") return false;
  const m = ISO_INSTANT_RE.exec(v);
  const t = m ? Date.parse(v) : NaN;
  if (!m || Number.isNaN(t)) return false;

  const [, yearS, monthS, dayS, hourS, minS, secS, msS, offsetToken, offsetSign, offHourS, offMinS] = m;
  const year = Number(yearS), month = Number(monthS), day = Number(dayS);
  const hour = Number(hourS), minute = Number(minS), second = Number(secS);
  const ms = msS ? Number(msS.padEnd(3, "0")) : 0;
  const offsetMinutes = offsetToken === "Z" ? 0 : (offsetSign === "-" ? -1 : 1) * (Number(offHourS) * 60 + Number(offMinS));

  // Shift the UTC instant by the stated offset so re-reading it in UTC recovers the ORIGINAL
  // local wall-clock fields the string claimed (for "Z" this is a no-op shift).
  const iso = new Date(t + offsetMinutes * 60000).toISOString(); // "YYYY-MM-DDTHH:mm:ss.sssZ"
  const isoM = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(iso);
  return !!(
    isoM &&
    Number(isoM[1]) === year &&
    Number(isoM[2]) === month &&
    Number(isoM[3]) === day &&
    Number(isoM[4]) === hour &&
    Number(isoM[5]) === minute &&
    Number(isoM[6]) === second &&
    Number(isoM[7]) === ms
  );
}

export function assertGeneratedAt(data) {
  const v = data && data.meta && data.meta.generatedAt;
  if (typeof v !== "string" || v.trim() === "") {
    throw new ContractError("meta.generatedAt is required and must be an ISO-8601 timestamp string (A10: the deterministic clock reference for all time-based worklist derivation)");
  }
  if (!isValidIsoInstant(v)) {
    throw new ContractError(`meta.generatedAt ("${v}") is not a valid ISO-8601 instant / calendar date-time (expected e.g. "2026-07-02T09:15:00Z"; the components must round-trip through Date parsing — a day-of-month out of range for that month, silently normalized instead of rejected, is rejected here)`);
  }
}

/**
 * `meta.userId` is the SALESFORCE USER ID (005...) of the signed-in identity, and it is the only
 * value the `execute_*` tools accept as `approverUserId`: the Apex compares it to the running
 * identity BEFORE it will redeem a decision token, so a display name fails that check and nothing
 * is written (live defect, 2026-07-26). The page therefore refuses the confirm gesture without it,
 * and the assembler is the fail-closed gate on the same footing as assertGeneratedAt: reject the
 * missing or misshapen value here rather than ship an artifact whose every governed action dies at
 * the moment a banker confirms a plan.
 *
 * The pattern is copied VERBATIM from app/src/channel/writeTools.ts SF_USER_ID (read 2026-09-03).
 * Keep the two in step by hand, the same A7 sync-note duty as everywhere else in this file.
 *
 * The ONE deliberate escape is the assembler's --no-approver, for a session that genuinely cannot
 * read the id (the Customer 360 connector has no whoami tool). That publishes a cockpit whose
 * execute path is read-only, and the skill has to say so out loud.
 */
const SF_USER_ID = /^005[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/;

export function assertUserId(data) {
  const v = data && data.meta && data.meta.userId;
  if (typeof v !== "string" || v.trim() === "") {
    throw new ContractError("meta.userId is required and must be the 15 or 18 character Salesforce user id (005...) of the signed-in identity: it is the only accepted approverUserId on execute_*, so an artifact without it can stage but can never file");
  }
  if (!SF_USER_ID.test(v.trim())) {
    throw new ContractError(`meta.userId ("${v}") is not a Salesforce user id (expected 005 followed by 12 or 15 alphanumerics, e.g. "005bb00000ftouDAAQ"). A display name or an email is refused by the org before the decision token is redeemed, so it is refused here instead`);
  }
}

/**
 * Codex R2 finding 2 (structural well-formedness of `worklist.accountIds`, split out of
 * computeCoverage): malformed entries (non-string / empty) or duplicates are an authoring bug in
 * the id LIST ITSELF, unconditionally fatal — never a staging gap, so never downgradable by
 * --allow-partial. A missing BORROWERS BUNDLE for an otherwise well-formed id is a *coverage*
 * question (handled by computeCoverage below), not a structural one.
 */
function assertWellFormedIds(ids, label) {
  const seen = new Set();
  for (const id of ids) {
    if (typeof id !== "string" || id.trim() === "") {
      throw new ContractError(`${label} contains a malformed id: ${JSON.stringify(id)}`);
    }
    if (seen.has(id)) {
      throw new ContractError(`${label} contains a duplicate id: "${id}"`);
    }
    seen.add(id);
  }
}

// -------------------------------------------------------------------------------------------
// Codex round 3 finding 4: deriveClientWorklistIds must mirror the CLIENT's exact predicates
// (app/src/data/worklist.ts), not "any signal id at all" — round 2's version over-required
// staging for signal ids the client would never actually surface (e.g. a maturity 400 days in
// the past). Constants + logic below are copied VERBATIM from the client (read 2026-07-25):
//
//   app/src/data/time.ts:
//     function utcMidnight(iso) {
//       const d = new Date(iso);
//       if (Number.isNaN(d.getTime())) return null;
//       return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
//     }
//     export function dayDiff(targetISO, baseISO) {
//       if (!targetISO) return null;
//       const t = utcMidnight(targetISO);
//       const b = utcMidnight(baseISO);
//       if (t === null || b === null) return null;
//       return Math.round((t - b) / 86_400_000);
//     }
//
//   app/src/data/worklist.ts:
//     export const COVENANT_DUE_WINDOW_DAYS = 45;
//     export const MATURITY_NEAR_WINDOW_DAYS = 270;
//     ...
//     const clockOk = dayDiff(generatedAt, generatedAt) !== null;
//     ...
//     for (const c of sig.covenantsDueSoon ?? []) {
//       if (c.accountId !== id) continue;
//       const d = dayDiff(c.nextEvaluationDate, generatedAt);
//       // F1: null (missing/unparseable) fires nothing. Overdue (negative) still
//       // counts as due — the test is outstanding, unlike a passed maturity.
//       if (d !== null && d <= COVENANT_DUE_WINDOW_DAYS) codes.add("COVENANT_DUE");
//     }
//     for (const m of sig.maturitiesSoon ?? []) {
//       if (m.accountId !== id) continue;
//       const d = dayDiff(m.maturityDate, generatedAt);
//       if (d !== null && d >= 0 && d <= MATURITY_NEAR_WINDOW_DAYS) codes.add("MATURITY_NEAR");
//     }
//
// Any negative d (deeply overdue) still satisfies "d <= 45" on its own — there is no separate
// "OR overdue" branch in the client, it falls out of the single <= comparison. A maturity in the
// past (d < 0) never fires, matched exactly by the d >= 0 lower bound below.
// -------------------------------------------------------------------------------------------
const COVENANT_DUE_WINDOW_DAYS = 45;
const MATURITY_NEAR_WINDOW_DAYS = 270;

function utcMidnight(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function dayDiff(targetISO, baseISO) {
  if (!targetISO) return null;
  const t = utcMidnight(targetISO);
  const b = utcMidnight(baseISO);
  if (t === null || b === null) return null;
  return Math.round((t - b) / 86400000);
}

/**
 * When there's no server-authored worklist, the client derives its own worklist from the
 * book-wide EWS signals in `portfolio.signals`. Only ids that would ACTUALLY produce a reason
 * code under the client's exact predicates need a staged bundle — an id whose signal date is
 * unparseable, or out of the client's window, never becomes a worklist row, so it must not be
 * treated as a coverage requirement here either.
 */
function deriveClientWorklistIds(data) {
  const ids = new Set();
  const signals = data.portfolio && data.portfolio.signals;
  const generatedAt = data.meta && data.meta.generatedAt;
  const clockOk = typeof generatedAt === "string" && dayDiff(generatedAt, generatedAt) !== null;
  if (!signals || !clockOk) return ids;

  if (Array.isArray(signals.covenantsDueSoon)) {
    for (const c of signals.covenantsDueSoon) {
      if (!c || !c.accountId) continue;
      const d = dayDiff(c.nextEvaluationDate, generatedAt);
      if (d !== null && d <= COVENANT_DUE_WINDOW_DAYS) ids.add(c.accountId);
    }
  }
  if (Array.isArray(signals.maturitiesSoon)) {
    for (const m of signals.maturitiesSoon) {
      if (!m || !m.accountId) continue;
      const d = dayDiff(m.maturityDate, generatedAt);
      if (d !== null && d >= 0 && d <= MATURITY_NEAR_WINDOW_DAYS) ids.add(m.accountId);
    }
  }
  return ids;
}

/**
 * Codex round 3 finding 2: validate the SHAPE of a server-authored `worklist.reasons` at assembly
 * time — must be a plain non-array object; every own value must be an array containing only the
 * six permitted ReasonCode values (app/src/data/contract.ts `ReasonCode`). Anything else names
 * the offending id and is unconditionally fatal (a shape bug, not a staging gap).
 */
export const PERMITTED_REASON_CODES = Object.freeze([
  "COVENANT_BREACH",
  "COVENANT_DUE",
  "MATURITY_NEAR",
  "MODIFICATION_CLUSTER",
  "GUARANTOR_SIGNAL",
  "RECENTLY_MODIFIED",
]);
const PERMITTED_REASON_CODES_SET = new Set(PERMITTED_REASON_CODES);

export function assertWorklistReasons(data) {
  const worklist = data && data.worklist;
  if (worklist === undefined || worklist === null) return; // worklist itself is optional (A9)

  const reasons = worklist.reasons;
  if (reasons === undefined) return; // reasons may be omitted even when worklist.accountIds is present

  if (!isPlainObject(reasons)) {
    throw new ContractError("data.worklist.reasons must be a plain object (not an array, not null)");
  }
  for (const id of Object.keys(reasons)) {
    const codes = reasons[id];
    if (!Array.isArray(codes)) {
      throw new ContractError(`data.worklist.reasons["${id}"] must be an array of reason codes (got ${codes === null ? "null" : typeof codes})`);
    }
    for (const code of codes) {
      if (!PERMITTED_REASON_CODES_SET.has(code)) {
        throw new ContractError(`data.worklist.reasons["${id}"] contains an unknown reason code: ${JSON.stringify(code)} — permitted: ${PERMITTED_REASON_CODES.join(", ")}`);
      }
    }
  }
}

/**
 * A6 + Codex R2 finding 2/4 (+ round 3 finding 4 tightening): empty/absent `worklist.accountIds`
 * does NOT bypass coverage — it falls back to full `portfolio.accounts` coverage UNION the
 * client-derived signal ids (only ids that would actually fire a reason under the client's exact
 * predicates — see deriveClientWorklistIds). A required id with no bundle in `borrowers` is a
 * COVERAGE GAP — returned in `missing` for
 * the caller to apply --allow-partial policy to (fail-closed by default, downgradable to a
 * warning). This includes a server-authored worklist id that references an account with no
 * borrowers bundle yet: that is exactly the A17 "unstaged worklist row" scenario the artifact
 * must be able to render in a degraded state, so it must be reachable via --allow-partial, not a
 * hard structural error (this was Codex R2 finding 2 — an earlier revision threw unconditionally
 * here, making A17 impossible to exercise).
 *
 * Structural (unconditional) problems — malformed/duplicate ids — are checked separately via
 * assertWellFormedIds and always throw, regardless of --allow-partial.
 */
export function computeCoverage(data) {
  const portfolioIds = (data.portfolio && Array.isArray(data.portfolio.accounts))
    ? data.portfolio.accounts.map((a) => a && a.accountId).filter(Boolean)
    : [];
  const worklistIdsRaw = (data.worklist && Array.isArray(data.worklist.accountIds)) ? data.worklist.accountIds : [];
  assertWellFormedIds(worklistIdsRaw, "worklist.accountIds");

  const borrowers = isPlainObject(data.borrowers) ? data.borrowers : {};

  let requiredIds, source;
  if (worklistIdsRaw.length) {
    requiredIds = [...new Set(worklistIdsRaw)];
    source = "worklist.accountIds";
  } else {
    const clientIds = deriveClientWorklistIds(data);
    requiredIds = [...new Set([...portfolioIds, ...clientIds])];
    source = "portfolio.accounts + client-derived signal ids (portfolio.signals.covenantsDueSoon/maturitiesSoon)";
  }

  const missing = requiredIds.filter((id) => !Object.hasOwn(borrowers, id));
  return { requiredIds, missing, source };
}

/**
 * A8 + Codex R2 finding 5: referential integrity by construction. The assembler DERIVES
 * top-level `borrower` UNCONDITIONALLY from `borrowers[meta.anchorAccountId]`. Any input-supplied
 * top-level `borrower` is ADVISORY ONLY — useful for human-readability while hand-authoring
 * sample data — and is always overwritten, never diffed against the derived bundle.
 *
 * An earlier revision compared the two with an order-sensitive JSON.stringify equality check and
 * errored on divergence; that produced false-positive errors from harmless key-ordering
 * differences alone (node:util.isDeepStrictEqual would have fixed the false positives, but
 * "ignore the advisory copy and derive unconditionally" is simpler and removes the footgun
 * entirely — that's the one picked here, per Codex round 2 finding 5).
 */
export function deriveAnchorBorrower(data) {
  const anchorId = data.meta.anchorAccountId;
  return data.borrowers[anchorId]; // assertBorrowersStructure already guaranteed this exists
}

/**
 * A5 regression-fixture hook: after validateC360() runs, every staged bundle must carry a
 * covenantChallenge array and the top-level dataQuality array must exist. Catches a validator
 * wiring regression (e.g. validateC360 called before borrowers is populated, or skipped
 * silently) rather than shipping an artifact that's quietly missing its SR 11-7 challenge surface.
 */
export function assertValidationSurfaces(data) {
  if (!Array.isArray(data.dataQuality)) {
    throw new ContractError("data.dataQuality is missing after the validation stage — validateC360() did not run or was wired incorrectly");
  }
  const borrowers = isPlainObject(data.borrowers) ? data.borrowers : {};
  for (const key of Object.keys(borrowers)) {
    if (!Array.isArray(borrowers[key].covenantChallenge)) {
      throw new ContractError(`data.borrowers["${key}"].covenantChallenge is missing after the validation stage`);
    }
  }
}

/* =============================================================================================
   SPEC §12 A30 (+ A29 seam) — round 4: optional per-bundle `activity[]` and `requests[]`.
   Both are OPTIONAL (absent = fine, honest empty state per A30.2 — "missing activity never
   invented history"). When PRESENT, the shape below is enforced unconditionally (structural,
   never bypassable by --allow-partial — same footing as assertBorrowersStructure). The assembler
   passes both arrays through untouched; nothing here transforms the data.
   ============================================================================================= */

/** A30.2 "Kinds v1" + A31.3: the machine values SPEC currently defines a literal enum for (the
 *  prose also gestures at future "RENDER/AUDIT events", but gives them no concrete kind string
 *  yet, so they are not yet permitted here). ACTION_TRIGGERED (A31.3) is a user/banker-initiated
 *  action — session-local/user-generated today, persisted via the v2 audit path later. No sample
 *  data carries it yet; the assembler just needs to accept it once that path lands. */
// GENERATED FROM THE APP'S ActivityKind UNION on 2026-09-03: every kind the page can render is a kind the
// assembler accepts, so the two never disagree again (the executed trail rows were being refused here).
export const PERMITTED_ACTIVITY_KINDS = Object.freeze([
  "REQUEST_RECEIVED",
  "ANALYSIS_CONCLUDED",
  "COVENANT_EVALUATED",
  "FACILITY_MODIFIED",
  "ACTION_TRIGGERED",
  "ACTION_EXECUTED",
  "ACTION_EXECUTION_FAILED",
  "ACTION_STAGED",
  "RENDER_AUDIT",
]);
const PERMITTED_ACTIVITY_KINDS_SET = new Set(PERMITTED_ACTIVITY_KINDS);

/**
 * `activity[].detail.nextSteps[].actionId` (A30.4: "SAME data feeds the popup's next-step
 * buttons, the chat suggestion chips, and the Actions panel") must reference a REAL registry
 * action id or all three consumers break. Copied VERBATIM from app/src/actions/registry.ts
 * ACTIONS[].id (read 2026-07-25) — keep in sync manually if the registry changes (same A7
 * sync-note duty as everywhere else in this file).
 */
export const PERMITTED_ACTION_IDS = Object.freeze([
  "generate-spreading",
  "draft-credit-memo",
  "loan-modification",
  "renewal",
  "covenant-review",
  "collateral-valuation",
  "annual-review",
  "risk-rating-review",
  "new-facility-request",
  "create-service-request",
]);
const PERMITTED_ACTION_IDS_SET = new Set(PERMITTED_ACTION_IDS);

function assertNonEmptyString(v, label) {
  if (typeof v !== "string" || v.trim() === "") {
    throw new ContractError(`${label} must be a non-empty string (got ${JSON.stringify(v)})`);
  }
}

/** ts/receivedAt must be a valid ISO instant AND must not postdate meta.generatedAt — activity
 *  and requests are historical relative to the deterministic snapshot clock (A10). Skips the
 *  ordering half of the check if generatedAt itself isn't valid (assertGeneratedAt already covers
 *  that failure on its own with a clearer message; this function shouldn't pile on). */
function assertTsConsistentWithGeneratedAt(v, label, generatedAt) {
  if (!isValidIsoInstant(v)) {
    throw new ContractError(`${label} ("${v}") is not a valid ISO-8601 instant — same validity rule as meta.generatedAt (A10)`);
  }
  if (isValidIsoInstant(generatedAt) && Date.parse(v) > Date.parse(generatedAt)) {
    throw new ContractError(`${label} ("${v}") is after meta.generatedAt ("${generatedAt}") — activity/request timestamps are historical and must not postdate the deterministic snapshot clock (A10)`);
  }
}

function assertReference(ref, label) {
  if (ref === undefined) return; // optional (A30.2: `reference?`)
  if (!isPlainObject(ref)) throw new ContractError(`${label} must be a plain object if present`);
  assertNonEmptyString(ref.kind, `${label}.kind`);
  assertNonEmptyString(ref.id, `${label}.id`);
  if (ref.webLink !== undefined && typeof ref.webLink !== "string") {
    throw new ContractError(`${label}.webLink must be a string if present`);
  }
}

function assertNextSteps(nextSteps, label) {
  if (nextSteps === undefined) return; // optional (A30.4)
  if (!Array.isArray(nextSteps)) {
    throw new ContractError(`${label} must be an array if present`);
  }
  for (const [i, step] of nextSteps.entries()) {
    const stepLabel = `${label}[${i}]`;
    if (!isPlainObject(step)) throw new ContractError(`${stepLabel} must be an object`);
    assertNonEmptyString(step.actionId, `${stepLabel}.actionId`);
    if (!PERMITTED_ACTION_IDS_SET.has(step.actionId)) {
      throw new ContractError(`${stepLabel}.actionId "${step.actionId}" is not a known registry action id — permitted: ${PERMITTED_ACTION_IDS.join(", ")}`);
    }
    if (step.note !== undefined && typeof step.note !== "string") {
      throw new ContractError(`${stepLabel}.note must be a string if present`);
    }
  }
}

/**
 * A30.2: `{ id, ts, kind, title, summary, reference?, detail?: { verdict?, body?, nextSteps? } }`.
 * Validates every borrower's `activity[]` when present. Ids must be unique WITHIN each bundle's
 * own array (the natural scope — mirrors how covenantId only needs to be unique within that
 * bundle's own covenants list elsewhere in this file).
 */
export function assertActivity(data) {
  const generatedAt = data && data.meta && data.meta.generatedAt;
  const borrowers = isPlainObject(data.borrowers) ? data.borrowers : {};

  for (const key of Object.keys(borrowers)) {
    const bundle = borrowers[key];
    if (!isPlainObject(bundle) || bundle.activity === undefined) continue;
    if (!Array.isArray(bundle.activity)) {
      throw new ContractError(`data.borrowers["${key}"].activity must be an array if present`);
    }

    const seenIds = new Set();
    for (const [i, entry] of bundle.activity.entries()) {
      const label = `data.borrowers["${key}"].activity[${i}]`;
      if (!isPlainObject(entry)) throw new ContractError(`${label} must be an object`);

      assertNonEmptyString(entry.id, `${label}.id`);
      if (seenIds.has(entry.id)) {
        throw new ContractError(`${label}.id "${entry.id}" is a duplicate within data.borrowers["${key}"].activity`);
      }
      seenIds.add(entry.id);

      assertTsConsistentWithGeneratedAt(entry.ts, `${label}.ts`, generatedAt);

      if (!PERMITTED_ACTIVITY_KINDS_SET.has(entry.kind)) {
        throw new ContractError(`${label}.kind "${entry.kind}" is not a permitted activity kind — permitted: ${PERMITTED_ACTIVITY_KINDS.join(", ")}`);
      }
      assertNonEmptyString(entry.title, `${label}.title`);
      assertNonEmptyString(entry.summary, `${label}.summary`);
      assertReference(entry.reference, `${label}.reference`);

      if (entry.detail !== undefined) {
        if (!isPlainObject(entry.detail)) throw new ContractError(`${label}.detail must be a plain object if present`);
        if (entry.detail.verdict !== undefined && typeof entry.detail.verdict !== "string") {
          throw new ContractError(`${label}.detail.verdict must be a string if present`);
        }
        if (entry.detail.body !== undefined && typeof entry.detail.body !== "string") {
          throw new ContractError(`${label}.detail.body must be a string if present`);
        }
        assertNextSteps(entry.detail.nextSteps, `${label}.detail.nextSteps`);
      }
    }
  }
}

/**
 * A29 seam: `{ id, channel: 'email', receivedAt, summary, ask: {type, from, to},
 * reference: {kind: 'm365-message', id, webLink?}, status }`. `reference` and `ask` are required
 * WHEN a request exists (A29: "the EMAIL is the source of truth" — a request with no source
 * reference isn't a request, it's an unattributed claim). `webLink` stays optional/absent — A29:
 * "nothing in the app may fabricate" a clickable reference until the real M365 intake exists.
 */
export function assertRequests(data) {
  const generatedAt = data && data.meta && data.meta.generatedAt;
  const borrowers = isPlainObject(data.borrowers) ? data.borrowers : {};

  for (const key of Object.keys(borrowers)) {
    const bundle = borrowers[key];
    if (!isPlainObject(bundle) || bundle.requests === undefined) continue;
    if (!Array.isArray(bundle.requests)) {
      throw new ContractError(`data.borrowers["${key}"].requests must be an array if present`);
    }

    const seenIds = new Set();
    for (const [i, req] of bundle.requests.entries()) {
      const label = `data.borrowers["${key}"].requests[${i}]`;
      if (!isPlainObject(req)) throw new ContractError(`${label} must be an object`);

      assertNonEmptyString(req.id, `${label}.id`);
      if (seenIds.has(req.id)) {
        throw new ContractError(`${label}.id "${req.id}" is a duplicate within data.borrowers["${key}"].requests`);
      }
      seenIds.add(req.id);

      if (req.channel !== "email") {
        throw new ContractError(`${label}.channel must be "email" (the only channel A29 v1 defines) — got ${JSON.stringify(req.channel)}`);
      }
      assertTsConsistentWithGeneratedAt(req.receivedAt, `${label}.receivedAt`, generatedAt);
      assertNonEmptyString(req.summary, `${label}.summary`);

      if (!isPlainObject(req.ask)) throw new ContractError(`${label}.ask must be a plain object`);
      assertNonEmptyString(req.ask.type, `${label}.ask.type`);
      if (req.ask.from === undefined || req.ask.to === undefined) {
        throw new ContractError(`${label}.ask must carry both "from" and "to"`);
      }

      if (!isPlainObject(req.reference)) {
        throw new ContractError(`${label}.reference is required — A29: the email is the source of truth, a request with no reference is an unattributed claim`);
      }
      if (req.reference.kind !== "m365-message") {
        throw new ContractError(`${label}.reference.kind must be "m365-message" (the only reference kind A29 v1 defines) — got ${JSON.stringify(req.reference.kind)}`);
      }
      assertNonEmptyString(req.reference.id, `${label}.reference.id`);
      if (req.reference.webLink !== undefined && typeof req.reference.webLink !== "string") {
        throw new ContractError(`${label}.reference.webLink must be a string if present`);
      }

      assertNonEmptyString(req.status, `${label}.status`);
    }
  }
}
