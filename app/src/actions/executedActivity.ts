/* =============================================================================
   EXECUTED ACTIONS IN THE TRAIL (A30, 2026-07-26)

   Every user-driven event belongs in the Activity tab, and an execution is the
   most consequential one the cockpit produces: a record now exists in the org
   because a named person confirmed a plan. Success and failure both land — an
   attempted write is trail-worthy, and a trail that only records what worked is
   not an audit trail.

   HONEST NAMING. The executor returns `recordName` and `anchorName` when the
   org read them back, and the entry uses them: "Collateral valuation
   CV-0000000002 filed against COL-000758".

   A NULL `recordName` is not a missing nicety. It means the verification
   read-back FAILED — the filed_unverified case — so the entry says the name was
   not confirmed instead of falling back to a generic label. A fallback there
   would hide a real verification failure behind copy that reads like success.
   ============================================================================= */

import type { ActionHistoryRow, ActivityEntry } from "../data/contract";
import type { ExecuteResult } from "../channel/writeTools";
import type { WorkroomExecution } from "../workroom/types";
import type { MemoPublication } from "../memo/publishTypes";
import { CREATED_OBJECT, recordDeepLink } from "../components/DeepLink";

export interface ExecutedEntryInput {
  actionId: string;
  /** The executor's own result. Its words and its ids, never ours. */
  outcome: ExecuteResult;
  /** What the action was filed against, in banker language, from the schema. */
  target?: string;
  /** The signed-in user. */
  actor?: string;
  instanceUrl?: string;
  /** Session clock: the banker just did this, on this clock (A10 carve-out). */
  now?: () => Date;
}

/** The created record's id for this action, or undefined when none came back. */
export function createdRecordId(actionId: string, outcome: ExecuteResult): string | undefined {
  if (actionId === "collateral-valuation") return outcome.valuationId;
  if (actionId === "create-service-request") return outcome.caseId;
  if (actionId === "annual-review") return outcome.reviewId;
  if (actionId === "risk-rating-review") return outcome.riskRatingReviewId;
  if (actionId === "new-facility-request") return outcome.loanId;
  // The clone, never the parent. `cloneLoanId` survives a replay, so a replayed
  // execution still names the facility that exists.
  if (actionId === "loan-modification") return outcome.cloneLoanId;
  return undefined;
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The step that stopped the plan, for the failure entry's detail. */
function failingStep(outcome: ExecuteResult): { label: string; detail?: string } | null {
  const bad = outcome.steps.find((s) => s.state === "failed" || s.state === "ambiguous");
  return bad ? { label: bad.label, detail: bad.detail } : null;
}

/**
 * Mint the trail entry for one execution. Returns null when there is nothing
 * honest to log — no terminal state means nothing was attempted.
 */
export function executedActivityEntry(input: ExecutedEntryInput): ActivityEntry | null {
  const { actionId, outcome, target, actor, instanceUrl } = input;
  const now = (input.now ?? (() => new Date()))();
  const label = CREATED_OBJECT[actionId]?.label ?? "action";
  const recordId = createdRecordId(actionId, outcome);
  const succeeded = outcome.terminalState === "success";
  // The org's own name for what this was filed against wins over the panel's
  // staged label for the same thing.
  const anchor = outcome.anchorName ?? target;
  const against = anchor ? ` against ${anchor}` : "";
  const recordName = outcome.recordName ?? null;
  const nameConfirmed = recordName !== null;

  if (!outcome.terminalState) return null;

  const base = {
    // Keyed on the staging id: one execution, one entry, however many times the
    // tracker re-renders or a replay returns the same result.
    id: `exec-${outcome.stagingId || recordId || now.getTime()}`,
    ts: now.toISOString(),
    actor: actor ?? "You",
    sessionLocal: true,
  };

  if (succeeded || (recordId && !nameConfirmed)) {
    const href = recordDeepLink(instanceUrl, CREATED_OBJECT[actionId]?.object, recordId);
    // A BULK COVENANT REVIEW created nothing and named no single record: it
    // updated N compliance rows under one plan. Naming one of them in the title
    // would report a batch as if it were a single assessment.
    const written = (outcome.items ?? []).filter((i) => i.covenantId && i.written !== false);
    const bulkCovenants = actionId === "covenant-review" && written.length > 1;
    /* THE INTAKE IS A BATCH TOO, and it authored rather than assessed. Naming
       one of the records in the title would report N creates as a single one,
       which is the same error the bulk covenant case exists to avoid. */
    const authored = actionId === "relationship-intake" ? (outcome.items ?? []).length : 0;
    // Named: "Collateral valuation CV-0000000002 filed against COL-000758".
    // Unnamed: the read-back failed, and the title says exactly that.
    const title = bulkCovenants
      ? `${written.length} covenant assessments recorded`
      : authored > 1
        ? `${authored} records authored on the relationship`
        : nameConfirmed
        ? `${sentenceCase(label)} ${recordName} filed${against}`
        : `${sentenceCase(label)} filed${against}, name not confirmed`;
    return {
      ...base,
      kind: "ACTION_EXECUTED",
      title,
      // The executor's own sentence, not a restatement of it.
      summary: outcome.outcome || undefined,
      reference: {
        kind: "ncino-record",
        id: recordId,
        label: CREATED_OBJECT[actionId]?.object,
        source: "Customer 360",
        // Absent instanceUrl leaves this undefined, and the popup renders the
        // id as plain text rather than a fabricated link (A29).
        webLink: href ?? undefined,
      },
      detail: {
        body: [
          outcome.outcome,
          // The bulk case has no single record name to confirm, so the null
          // doctrine does not apply to it: each covenant carries its own.
          nameConfirmed || bulkCovenants
            ? null
            : "The verification read-back did not return the record name, so this is filed but unverified.",
          bulkCovenants
            ? written.map((i) => `${i.anchorName ?? i.covenantId} ${i.sourceStatus ?? "?"} to ${i.status ?? "?"}.`).join(" ")
            : null,
          recordId ? `Record ${recordId}.` : null,
          outcome.stagingId ? `Staged as ${outcome.stagingId}.` : null,
          outcome.replayed ? "Replayed under the same idempotency key; nothing was written twice." : null,
        ]
          .filter(Boolean)
          .join(" "),
      },
    };
  }

  const failed = failingStep(outcome);
  return {
    ...base,
    kind: "ACTION_EXECUTION_FAILED",
    title: `${sentenceCase(label)} did not complete${against}`,
    summary: outcome.outcome || undefined,
    reference: recordId ? { kind: "ncino-record", id: recordId, source: "Customer 360" } : undefined,
    detail: {
      body: [
        failed ? `Stopped at: ${failed.label}.` : null,
        failed?.detail ?? null,
        `Terminal state ${outcome.terminalState}.`,
        outcome.stagingId ? `Staged as ${outcome.stagingId}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
    },
  };
}

/* ------------------------------------------- the workroom, in the same trail

   A30, EXTENDED TO THE ROOM (2026-09-01). An executed workroom plan is the same
   class of event as an executed panel action: a record now exists in the org
   because a named person approved a hashed plan. It belongs on the client's
   Activity timeline for the same reason, keyed the same way, and deduped
   against the org's own durable row by the same `exec-<stagingId>` id.

   FROM WHAT THE ROOM ALREADY HELD. The room hands over the execution result it
   is standing on at dossier time; no org read is issued to write this entry.

   THE STAGING-RECORD-DRIVEN HISTORICAL READ IS FUTURE WORK. `Customer360-
   ActionHistory` returns `actionId: "loan-modification"` rows and
   `historyActivityEntry` above already renders them, so a modification filed in
   a PREVIOUS session appears after a sync. What is not built is the read that
   would recover the change COUNT and the approver for such a row: the history
   tool carries neither, so an org-sourced modification entry states what it
   knows and no more.                                                         */

export interface WorkroomFiledInput {
  /** The room's own execution result, verbatim. */
  execution: WorkroomExecution;
  /** How many changes actually filed, as the dossier counted them. */
  changeCount: number;
  /**
   * OF `changeCount`, HOW MANY THE BANKER TYPED (Cowork feedback, 2026-09-03).
   *
   * The pricing gate adds the amortised term and the first payment date once
   * an amount or a term moves, and those two file with everything else, so
   * "4 changes filed" read as the parser inventing a pair the banker never
   * asked for. Both absent or `derivedCount` at 0 renders the count exactly
   * as it always has; the room passes both together, from
   * `derivedDelta.ts`'s `countSplit` over the filed entries.
   */
  requestedCount?: number;
  derivedCount?: number;
  /** The package the plan ran on, in banker language. */
  packageName: string;
  /** The identity that took the single approval. */
  approver?: string;
  /** The dossier's own resolved link, or null. Passed rather than re-derived so
   *  the trail entry and the dossier can never disagree about the address. */
  packageHref?: string | null;
  /** The package record id, for the reference chip's selectable fallback. */
  productPackageId?: string | null;
  /**
   * WHAT THE ORG ARMS DID, in banker language, composed by the room.
   *
   * A carry exclusion writes NO record, so it leaves no id and no created-record
   * line: `filed` can say the clone was made and never say that a covenant was
   * left off it. The room holds the manifest, so the room composes the sentence
   * and the trail carries it verbatim. Absent on every plan that carries none.
   */
  arms?: string | null;
  /**
   * WHAT THE PLAN SAYS ABOUT THE FOUR FIELDS nCINO PRICES ON, composed by the
   * room (founder, 2026-09-02).
   *
   * An amortised term and a first payment date that were SET ride the filed list
   * like any other field change and need nothing here. A facility whose pricing
   * the banker chose to LEAVE FOR LATER writes no record at all, so this is the
   * only place the trail can carry that decision. Absent where every facility
   * that moved carries both fields.
   */
  pricing?: string | null;
  /** Session clock: the banker just did this, on this clock (A10 carve-out). */
  now?: () => Date;
}

/**
 * The trail entry for one executed workroom plan, or null where there is
 * nothing honest to log.
 *
 * A plan that filed NOTHING is not an execution to celebrate: it is a plan
 * whose every entry was handed off, and the room already says so on the
 * dossier. It gets no `ACTION_EXECUTED` row, because a trail that records a
 * modification against a package nothing was written to is a trail that lies.
 */
export function workroomActivityEntry(input: WorkroomFiledInput): ActivityEntry | null {
  const { execution, changeCount, packageName, approver, packageHref, productPackageId, arms, pricing } = input;
  const filed = execution.filed ?? [];
  if (!filed.length || changeCount < 1) return null;
  const now = (input.now ?? (() => new Date()))();
  // The staging id lives inside the token note the org composed; the room does
  // not carry it separately. Keying on the clone the plan created is the next
  // most durable thing it holds, and it is stable across a replay.
  const anchor = filed[0]?.recordId || packageName;
  const derivedCount = input.derivedCount ?? 0;
  const requestedCount = input.requestedCount ?? changeCount - derivedCount;
  // A PARENTHETICAL, NOT A NEW SENTENCE. Same doctrine as the rail head and
  // the flow card: an ordinary plan reads exactly as it always has, and a
  // plan the pricing gate touched says so beside the count rather than in a
  // line of its own.
  const splitNote = derivedCount > 0 ? ` (${requestedCount} requested, ${derivedCount} derived)` : "";

  return {
    id: `exec-${anchor}`,
    ts: now.toISOString(),
    actor: approver ?? "You",
    sessionLocal: true,
    kind: "ACTION_EXECUTED",
    title: `Modification executed on ${packageName}`,
    summary: `${changeCount} ${changeCount === 1 ? "change" : "changes"}${splitNote} filed${approver ? `, approved by ${approver}` : ""}.`,
    reference: productPackageId
      ? {
          kind: "ncino-record",
          id: productPackageId,
          label: "LLC_BI__Product_Package__c",
          source: "Customer 360",
          // Absent host leaves this undefined and the popup renders the id as
          // plain text rather than a fabricated link (A29).
          webLink: packageHref ?? undefined,
        }
      : undefined,
    detail: {
      body: [
        `${changeCount} ${changeCount === 1 ? "change" : "changes"}${splitNote} filed against ${packageName}.`,
        approver ? `Confirmed by ${approver}.` : null,
        arms ?? null,
        pricing ?? null,
        execution.tokenNote,
        ...filed.map((f) => `${f.recordId}: ${f.verification}`),
        execution.handoff ?? null,
        (execution.handoffs ?? []).length
          ? `${execution.handoffs!.length} recorded on the plan but not filed.`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    },
  };
}

/* ------------------------------------------------ the memo, in the same trail

   A30, EXTENDED TO THE MEMO ROOM (2026-09-04). A published memo is the same
   class of event as an executed plan: records now exist in the bank's systems
   because a named person pressed publish. It belongs on the Activity timeline,
   and the reference is the nFORMS document, because that is the thing a banker
   opens when they ask "show me the memo".

   THE TITLE NEVER OVERSTATES. Four systems are written independently, so the
   entry says which of them landed. "Published and submitted for approval" is
   claimed only when the document and the approval both completed; a publish
   whose submit failed says so, and a publish the connectors only simulated says
   that too, because a trail row is the last place a partial write should read
   as a whole one.                                                            */

export interface MemoPublishedInput {
  /** The publication report, verbatim. No system is re-read to write this. */
  publication: MemoPublication;
  /** The package in banker language. */
  packageName?: string;
  /** The identity that published. */
  actor?: string;
  /** Session clock: the banker just did this, on this clock (A10 carve-out). */
  now?: () => Date;
}

/**
 * The trail entry for one memo publication, or null where nothing was
 * attempted (the phase C stub, which runs no lane at all).
 */
export function memoPublishedActivityEntry(input: MemoPublishedInput): ActivityEntry | null {
  const { publication, packageName, actor } = input;
  const lanes = publication.lanes ?? [];
  if (!lanes.length) return null;
  const now = (input.now ?? (() => new Date()))();
  const landed = (lane: string) => lanes.some((l) => l.lane === lane && l.status === "done");
  const against = packageName ? ` on ${packageName}` : "";

  const base = {
    // One publication, one entry, however many times the room re-renders.
    id: `memo-${publication.memoId}`,
    ts: now.toISOString(),
    actor: actor ?? "You",
    sessionLocal: true,
    reference: publication.nforms
      ? {
          kind: "ncino-record",
          id: publication.nforms.templateId,
          label: "nFORMS__Form_Template__c",
          source: "Experience / nCino",
          // Absent leaves this undefined and the popup renders the id as plain
          // text rather than a fabricated link (A29).
          webLink: publication.nforms.generateUrl,
        }
      : undefined,
  };

  const detail = {
    body: [
      ...lanes.filter((l) => l.status !== "skipped").map((l) => `${l.lane}: ${l.detail}`),
      publication.afs ? `AFS workpackage ${publication.afs.workpackageId}.` : null,
      publication.approval?.notified?.length ? `Notified ${publication.approval.notified.join(", ")}.` : null,
      publication.simulated
        ? "At least one connector answered from fixtures: it reported the write and the system of record did not change."
        : null,
    ]
      .filter(Boolean)
      .join(" "),
  };

  if (!lanes.some((l) => l.status === "done")) {
    return {
      ...base,
      kind: "ACTION_EXECUTION_FAILED",
      title: `Credit memo publish did not complete${against}`,
      summary: lanes.find((l) => l.status === "failed")?.detail,
      detail,
    };
  }

  const title = landed("document")
    ? landed("approval")
      ? `Credit memo published and submitted for approval${against}`
      : `Credit memo published${against}, not submitted for approval`
    : `Credit memo narrative synced to nCino${against}`;

  return {
    ...base,
    kind: "ACTION_EXECUTED",
    title,
    summary: publication.simulated
      ? "Reported by the connector as a simulated write: nothing changed in the system of record."
      : undefined,
    detail,
  };
}

/* ------------------------------------------------- the org's durable trail */

/** Banker language for an action id the org recorded. */
const ACTION_LABEL: Record<string, string> = {
  "collateral-valuation": "Collateral valuation",
  "create-service-request": "Service request",
  "annual-review": "Annual credit review",
  "risk-rating-review": "Risk rating review",
  "new-facility-request": "Facility",
  "covenant-review": "Covenant assessment",
  "loan-modification": "Modification",
  renewal: "Renewal",
};

/**
 * One org-history row as a trail entry.
 *
 * Keyed IDENTICALLY to the session echo (`exec-<stagingId>`) so the two dedupe
 * against each other without a second matching rule: the org row is the same
 * event, read back from the system of record.
 */
export function historyActivityEntry(row: ActionHistoryRow, instanceUrl?: string): ActivityEntry | null {
  if (!row.stagingId) return null;
  const label = (row.actionId && ACTION_LABEL[row.actionId]) ?? "Action";
  const ts = row.executedAt ?? row.createdDate;
  if (!ts) return null; // an entry with no time cannot be placed on a timeline

  const object = row.actionId ? CREATED_OBJECT[row.actionId]?.object : undefined;
  const href = recordDeepLink(instanceUrl, object, row.resultRecordId);
  const status = row.status ?? "";
  const completed = status.toLowerCase() === "completed";
  const staged = status.toLowerCase() === "staged";
  const name = row.resultRecordName ?? null;

  const base = {
    id: `exec-${row.stagingId}`,
    ts,
    actor: row.approverUserId ?? row.actorUserId,
    orgConfirmed: true,
    detail: {
      body: [
        `Staged as ${row.stagingId}.`,
        row.resultRecordId ? `Record ${row.resultRecordId}.` : null,
        row.approverUserId ? `Confirmed by ${row.approverUserId}.` : null,
        row.status ? `The org records this as ${row.status}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
    },
  };

  if (completed) {
    // The null-name doctrine applies HERE and only here: on a completed row a
    // missing name means the read-back failed, which is a verification failure
    // worth saying out loud. On a staged row it means nothing was created.
    return {
      ...base,
      kind: "ACTION_EXECUTED",
      /* THE HISTORY READ CARRIES IDS, NOT NAMES. A Completed row whose name
         did not travel is still a completed, org-verified filing; the title
         says what was filed and the record link carries the org's own name
         (founder, 2026-09-03: "name not confirmed" on the trail read as a
         failure on a filing the org had completed). */
      title: name ? `${label} ${name} filed` : `${label} filed`,
      summary: name ? undefined : "Completed in the org; the record carries its org-assigned name.",
      reference: row.resultRecordId
        ? { kind: "ncino-record", id: row.resultRecordId, label: object, source: "Customer 360", webLink: href ?? undefined }
        : undefined,
    };
  }

  // Staged, and anything else the org may report: neither a write nor a
  // failure. The org's own word for the state is carried verbatim rather than
  // being mapped onto a claim we cannot support.
  return {
    ...base,
    kind: "ACTION_STAGED",
    title: staged ? `${label} staged, never filed` : `${label} recorded as ${row.status ?? "unknown"}`,
    summary: staged ? "A plan was built and confirmed by nobody. Nothing was written." : undefined,
  };
}

/**
 * The trail the Activity tab renders: the org's durable rows, the session's own
 * echoes, and the staged history, newest first.
 *
 * ORG WINS. When both describe the same stagingId the org row replaces the
 * session echo — same event, stronger evidence. A session echo with no org row
 * yet still renders instantly, which is what makes the tab feel live.
 */
export function mergeTrail(
  orgRows: ActivityEntry[],
  sessionEntries: ActivityEntry[],
  staged: ActivityEntry[],
): ActivityEntry[] {
  const byId = new Map<string, ActivityEntry>();
  for (const e of staged) byId.set(e.id, e);
  for (const e of sessionEntries) byId.set(e.id, e);
  for (const e of orgRows) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}

/* ------------------------------------------ the spread, in the same trail

   A30, EXTENDED TO THE SPREADING ROOM (BOOM-UPLOAD-SPEC §2, 2026-09-12). Files
   leaving the cockpit for the spreading system are the same class of event as a
   filed plan: a named person confirmed a governed plan and something left the
   page because of it. The spec says so in as many words — "the action lands in
   the relationship's activity trail like every governed write" — so the plan
   lands when it is SENT and again when Boom settles it, success or failure.

   WHY NOT A `WriteActionId`. That union is the nCino write-tool registry in
   `channel/writeTools.ts`: every member has a stage tool, an execute tool and a
   decision token. A spread has none of the three — it is a file going to a
   different system entirely — so growing that union would put an action in the
   registry that no executor can run. The entry is minted here, beside the
   workroom's and the memo's, which is where every non-registry trail entry in
   this cockpit is already minted.

   THE SYSTEM IS NAMED, AND IT IS NAMED HONESTLY. While the Boom connector does
   not exist the spread came from the stub, and the trail says
   "Boom (stub, provisional)" rather than "Boom". A trail row is the last place
   a provisional figure should read as a verified one.                        */

export interface SpreadFiledInput {
  /** Sent, settled, or refused by the spreading system. */
  phase: "sent" | "completed" | "failed";
  /** The relationship the plan was anchored on. */
  company: string;
  /** The plan's own governed sentence, verbatim. The line the trail carries. */
  summary: string;
  /** Which system answered, in words: "Boom", or "Boom (stub, provisional)"
   *  while the lane is the stub. Composed by the room, carried verbatim. */
  system: string;
  /** One plan, one entry per phase, however many times the room re-renders.
   *  The room passes the plan's own content key (the files' hashes). */
  planKey: string;
  /** The period Boom returned, where it returned one. */
  period?: string | null;
  /** TRUE only where the spreading system reports an analyst has signed it off.
   *  The stub never does, and neither does a Boom spread before verification. */
  signedOff?: boolean;
  /** How many files went. */
  fileCount?: number;
  /** The spreading system's own words on a failure. Shown verbatim; this layer
   *  has no structured reason to map it onto (Boom Q&A tracker #14). */
  failure?: string | null;
  /** The signed-in user. */
  actor?: string;
  /** Session clock: the banker just did this, on this clock (A10 carve-out). */
  now?: () => Date;
}

/** The trail entry for one spreading plan, at one of its three moments. */
export function spreadActivityEntry(input: SpreadFiledInput): ActivityEntry {
  const { phase, company, summary, system, planKey, period, failure, actor } = input;
  const now = (input.now ?? (() => new Date()))();
  const files = input.fileCount ?? 0;
  const fileWord = files ? `${files} file${files === 1 ? "" : "s"}` : "The statements";

  const base = {
    id: `spread-${planKey}-${phase}`,
    ts: now.toISOString(),
    actor: actor ?? "You",
    sessionLocal: true,
    // No record id and no link: the spreading system's own page is an analyst
    // verification session the cockpit cannot mint (the stub has none at all).
    // The source label is what the trail can say truthfully, so it is all it says.
    reference: { kind: "boom-spread", source: system },
  };

  if (phase === "sent") {
    return {
      ...base,
      kind: "ACTION_TRIGGERED" as const,
      title: `Financial statements sent to ${system}`,
      summary,
      detail: { body: `${fileWord} left the cockpit for ${system} on ${company}. ${summary}` },
    };
  }

  if (phase === "failed") {
    return {
      ...base,
      kind: "ACTION_EXECUTION_FAILED" as const,
      title: `${system} did not spread these statements`,
      summary,
      detail: {
        body: [summary, failure ? `${system} reported: ${failure}` : null, "Nothing on the relationship moved."]
          .filter(Boolean)
          .join(" "),
      },
    };
  }

  return {
    ...base,
    kind: "ACTION_EXECUTED" as const,
    title: period ? `${system} spread ${period} for ${company}` : `${system} spread these statements for ${company}`,
    summary,
    detail: {
      body: [
        summary,
        period ? `${period} is on the relationship's financials.` : null,
        input.signedOff ? null : "An analyst has not signed this spread off in Boom.",
      ]
        .filter(Boolean)
        .join(" "),
    },
  };
}
