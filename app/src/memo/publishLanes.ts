/* =============================================================================
   THE PUBLISH LANES (phase D, 2026-09-04).

   Seven steps across four systems of record. Each one reports its own outcome,
   each one is allowed to fail on its own, and the only step that waits for
   another is the approval, which waits for the document.

   NOTHING HERE IS RETRIED. Every call is a write except the ledger reads that
   do not exist, and `callTool` never auto-retries a write: a rejection is not
   proof the tool did not run. A lane whose failure was ambiguous says so, and
   re-firing it is the banker's gesture, not this module's.

   THE FIXTURE FLAG IS LOAD-BEARING. Both connectors can answer from fixtures:
   they report a successful write, name plausible record ids, and change nothing
   in the org (observed 2026-09-04, see OBSERVED.md, and confirmed by reading
   the package back over REST). A room that renders that as "published" tells a
   banker something untrue about the system of record, so every lane carries
   whether its answer was simulated and the publication carries the roll-up.
   ============================================================================= */

import { SERVERS, TOOLS, callTool, unwrapJson, type McpFailure, type McpOk } from "../channel/mcp";
import { toNcinoSafeHtml, toRteSafeHtml } from "./ncinoSafe";
import {
  LANE_IDS,
  LANE_REQUIRES,
  LANE_SYSTEM,
  isMemoSectionId,
  publicationStatus,
  type LaneId,
  type LaneOutcome,
  type MemoDraft,
  type MemoPublication,
  type MemoPublishContext,
} from "./publishTypes";

/* ---------------------------------------------------- what the lanes read

   The FULL observed envelopes live in OBSERVED.md. These declare only the keys
   the lanes actually read, so a field here is a field something depends on. */

interface SyncPayload {
  ok?: boolean;
  mapped?: Array<{ section?: string; field?: string; chars?: number }>;
  unmapped?: unknown[];
  truncated?: unknown[];
  message?: string;
}

interface PublishPayload {
  ok?: boolean;
  templateId?: string;
  templateName?: string;
  generateUrl?: string;
  bytes?: number;
  message?: string;
}

interface FinalizePayload {
  ok?: boolean;
  message?: string;
}

interface SubmitPayload {
  ok?: boolean;
  queue?: string;
  processInstanceId?: string;
  notified?: string[];
  message?: string;
}

interface NotifyPayload {
  ok?: boolean;
  to?: string[];
  message?: string;
}

interface LedgerPayload {
  recorded?: { occurredAt?: string };
  logged?: { occurredAt?: string };
}

interface WorkpackagePayload {
  workpackageId?: string;
  messages?: Array<{ severity?: string; text?: string }>;
}

/* ------------------------------------------------------------- lane plumbing */

/** What a lane body reports. The runner adds the lane's identity. */
type LaneResult = Omit<LaneOutcome, "lane" | "system">;

const skipped = (detail: string): LaneResult => ({ status: "skipped", detail });

/** Did the connector answer from fixtures rather than from the org? */
function isSimulated(payload: unknown): boolean {
  const p = (payload ?? {}) as { simulated?: unknown; _source?: unknown; workpackageId?: unknown; messages?: unknown };
  if (p.simulated === true) return true;
  if (typeof p._source === "string" && /fixture/i.test(p._source)) return true;
  // AFS says it in its own way: a fixture id and a fixture note.
  if (typeof p.workpackageId === "string" && /fixture/i.test(p.workpackageId)) return true;
  return Array.isArray(p.messages) && p.messages.some((m) => /fixture/i.test(String((m as { text?: unknown })?.text ?? "")));
}

/** The connector's own sentence, or the tool name when it sent none. */
const said = (payload: { message?: string } | undefined, fallback: string) => payload?.message?.trim() || fallback;

/** A rejection, in the words a banker can act on. */
function fromFailure(err: unknown): LaneResult {
  const f = err as Partial<McpFailure>;
  const detail = f.fix ?? f.message ?? String(err);
  return f.ambiguous
    ? {
        status: "failed",
        detail: `${detail} The outcome is unknown: the write may already have run, so it is not repeated automatically.`,
        ambiguous: true,
      }
    : { status: "failed", detail };
}

/** Every write goes out the same way: uncached, and never auto-retried. */
async function write<T>(server: string, tool: string, input: unknown): Promise<{ result: McpOk<unknown>; payload: T | undefined }> {
  const result = await callTool(server, tool, input, { cache: false, read: false });
  return { result, payload: unwrapJson<T>(result) };
}

/** The ledger's two calls are half-independent: one may land without the
 *  other, so each is caught here and the lane reports what actually happened. */
async function ledgerCall<T>(tool: string, input: unknown): Promise<{ payload?: T; error?: string }> {
  try {
    const { payload } = await write<T>(SERVERS.experience, tool, input);
    return { payload };
  } catch (e) {
    return { error: fromFailure(e).detail };
  }
}

/* ------------------------------------------------------------------ lanes */

/** The narrative, keyed by nCino's own section ids and cut to the RTE subset. */
export function syncableSections(draft: MemoDraft): Record<string, string> {
  const out: Record<string, string> = {};
  for (const section of draft.sections ?? []) {
    if (!isMemoSectionId(section.id)) continue;
    const html = toRteSafeHtml(section.html ?? "");
    if (html) out[section.id] = html;
  }
  return out;
}

const names = (rows: unknown[] | undefined): string[] =>
  (rows ?? []).map((r) => (typeof r === "string" ? r : String((r as { section?: unknown })?.section ?? ""))).filter(Boolean);

/**
 * Run the publish: the real body behind the `publishMemo` seam.
 *
 * Returns the per-lane report whatever happens. It does not throw, because a
 * room that loses the report loses the only record of which of four systems
 * was written to.
 */
export async function publishMemo(draft: MemoDraft, ctx: MemoPublishContext, now: () => Date = () => new Date()): Promise<MemoPublication> {
  const actor = { actingUserId: ctx.actingUserId, actingUserName: ctx.actingUserName };
  const publication: MemoPublication = {
    memoId: draft.memoId,
    packageId: ctx.packageId,
    status: "failed",
    publishedAt: now().toISOString(),
    lanes: [],
  };
  const landed = new Set<LaneId>();

  const bodies: Record<LaneId, () => Promise<LaneResult>> = {
    /* (a) The narrative into the package's own rich-text fields. It goes FIRST
       because those fields live on the package, and the submit locks it. */
    sections: async () => {
      const sections = syncableSections(draft);
      const ids = Object.keys(sections);
      if (!ids.length) return skipped("The draft carries no narrative section that nCino has a field for.");
      const { result, payload } = await write<SyncPayload>(SERVERS.experience, TOOLS.syncMemoSections, {
        packageId: ctx.packageId,
        sections,
        ...actor,
      });
      if (!payload || payload.ok === false) {
        return { status: "failed", detail: said(payload, "The connector did not confirm the narrative sync."), simulated: isSimulated(payload ?? result.payload) };
      }
      const synced = names(payload.mapped);
      const unmapped = names(payload.unmapped);
      const truncated = names(payload.truncated);
      publication.sections = { synced, unmapped, truncated };
      return {
        status: "done",
        detail: [
          `${synced.length} of ${ids.length} narrative sections written to the package.`,
          unmapped.length ? `nCino has no field for ${unmapped.join(", ")}.` : "",
          truncated.length ? `Truncated at the field limit: ${truncated.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join(" "),
        simulated: isSimulated(payload),
      };
    },

    /* (b) The memo itself, as the nFORMS template body, so the banker's own
       "Generate Credit Memo" renders our markup and can freeze it to DocMan. */
    document: async () => {
      if (!draft.html?.trim()) return skipped("The draft carries no rendered memo to publish.");
      const { result, payload } = await write<PublishPayload>(SERVERS.experience, TOOLS.publishCreditMemo, {
        packageId: ctx.packageId,
        html: toNcinoSafeHtml(draft.html),
        ...(ctx.templateName ? { templateName: ctx.templateName } : {}),
        ...actor,
      });
      if (!payload || payload.ok === false) {
        return { status: "failed", detail: said(payload, "The connector did not confirm the memo publish."), simulated: isSimulated(payload ?? result.payload) };
      }
      // The generate URL is what the trail row and the banker's own "Generate
      // Credit Memo" stand on. A publish that named no address published
      // nothing anyone can open, so it is not reported as done.
      if (!payload.generateUrl) {
        return { status: "failed", detail: "The connector confirmed the publish but returned no generate URL.", simulated: isSimulated(payload) };
      }
      publication.nforms = {
        templateId: payload.templateId,
        templateName: payload.templateName,
        generateUrl: payload.generateUrl,
        bytes: payload.bytes,
      };
      return {
        status: "done",
        detail: said(payload, "The memo was published to the package's credit-memo template."),
        recordId: payload.templateId,
        url: payload.generateUrl,
        simulated: isSimulated(payload),
      };
    },

    /* (c) The connector's own server-side narrative sync plus the path move.
       It holds the memo text, so nothing but the package id crosses the wire. */
    finalize: async () => {
      const { result, payload } = await write<FinalizePayload>(SERVERS.experience, TOOLS.finalizeCreditMemo, {
        packageId: ctx.packageId,
        ...actor,
      });
      if (!payload || payload.ok === false) {
        return { status: "failed", detail: said(payload, "The connector did not confirm the finalize."), simulated: isSimulated(payload ?? result.payload) };
      }
      return { status: "done", detail: said(payload, "The package was finalised."), simulated: isSimulated(payload) };
    },

    /* (d) The full-circle moment: the package routed to the Loan Committee. */
    approval: async () => {
      if (!ctx.approverEmails?.length) return skipped("No approver was named, and the approval routes on an approver's email.");
      if (!ctx.notificationEmails?.length) return skipped("No notification address was named, which the submit requires.");
      const { result, payload } = await write<SubmitPayload>(SERVERS.experience, TOOLS.submitForApproval, {
        packageId: ctx.packageId,
        approverEmails: ctx.approverEmails,
        notificationEmails: ctx.notificationEmails,
        comments: ctx.comments ?? `Credit memo ${draft.memoId} published from the Credit 360 cockpit.`,
        ...actor,
      });
      if (!payload || payload.ok === false) {
        return { status: "failed", detail: said(payload, "The connector did not confirm the approval submission."), simulated: isSimulated(payload ?? result.payload) };
      }
      publication.approval = {
        submittedAt: now().toISOString(),
        queue: payload.queue,
        processInstanceId: payload.processInstanceId,
        notified: payload.notified ?? [],
      };
      return {
        status: "done",
        detail: said(payload, "The package was submitted for credit approval."),
        recordId: payload.processInstanceId,
        simulated: isSimulated(payload),
      };
    },

    /* (e) The credit lead's email. Composed here only when there is a memo
       link to carry; otherwise the connector composes its own notice. */
    notify: async () => {
      if (!ctx.notificationEmails?.length) return skipped("No recipient was named for the notice.");
      const url = publication.nforms?.generateUrl;
      const { result, payload } = await write<NotifyPayload>(SERVERS.experience, TOOLS.ncinoNotify, {
        packageId: ctx.packageId,
        to: ctx.notificationEmails,
        ...(url
          ? {
              subject: "Credit memo ready for review",
              body: `The credit memo for this package has been published and the package submitted for approval. Open it in nCino: ${url}`,
            }
          : {}),
        ...actor,
      });
      if (!payload || payload.ok === false) {
        return { status: "failed", detail: said(payload, "The connector did not confirm the notification."), simulated: isSimulated(payload ?? result.payload) };
      }
      return { status: "done", detail: said(payload, `Notified ${(payload.to ?? ctx.notificationEmails).join(", ")}.`), simulated: isSimulated(payload) };
    },

    /* (f) The WHY and the WHAT, in the Experience ledger. Two calls, one step:
       a decision with no audit event, or an audit event with no decision, is a
       half-written ledger and the lane says so rather than reporting success. */
    ledger: async () => {
      const decision = await ledgerCall<LedgerPayload>(TOOLS.recordDecision, {
        packageId: ctx.packageId,
        decision: "Published the credit memo and submitted the package for credit approval.",
        rationale: `Memo ${draft.memoId} was published from the Credit 360 cockpit against package ${ctx.packageId}.`,
        ...actor,
      });
      const audit = await ledgerCall<LedgerPayload>(TOOLS.logAuditEvent, {
        packageId: ctx.packageId,
        eventType: "writeback",
        fieldOrStatus: "credit memo",
        newValue: publication.nforms?.templateId ?? "published",
        ...actor,
      });

      const decisionAt = decision.payload?.recorded?.occurredAt;
      const auditAt = audit.payload?.logged?.occurredAt;
      publication.ledger = { decisionAt, auditAt };
      const simulated = isSimulated(decision.payload) || isSimulated(audit.payload);
      if (decisionAt && auditAt) {
        return { status: "done", detail: "The decision and the audit event were appended to the package's ledger.", simulated };
      }
      const why = [decision.error, audit.error].filter(Boolean).join(" ");
      if (!decisionAt && !auditAt) {
        return { status: "failed", detail: `Neither the decision nor the audit event reached the ledger. ${why}`.trim(), simulated };
      }
      return {
        status: "failed",
        detail: `${
          decisionAt
            ? "The decision was recorded, but the audit event did not reach the ledger."
            : "The audit event was logged, but the decision did not reach the ledger."
        } ${why}`.trim(),
        simulated,
      };
    },

    /* (g) Servicing. The workpackage is staged LAST, after the credit side has
       landed, and only against a mapping that came off the relationship. */
    servicing: async () => {
      if (!draft.afs) {
        return skipped("No AFS servicing key is recorded for this relationship, so no workpackage was staged.");
      }
      const facilities = draft.servicingFacilities ?? [];
      if (!facilities.length) {
        return skipped("The draft declares no facility for servicing, and AFS would otherwise stage its own sample facilities.");
      }
      const { result, payload } = await write<WorkpackagePayload>(SERVERS.afs, TOOLS.afsCreateWorkpackage, {
        workflow: "postApproval",
        bank: draft.afs.bank,
        obligorNumber: draft.afs.obligor,
        ...(draft.afs.officer ? { officer: draft.afs.officer } : {}),
        ...(draft.afs.assignmentUnit ? { assignmentUnit: draft.afs.assignmentUnit } : {}),
        description: `Credit memo ${draft.memoId} published for package ${ctx.packageId}`,
        facilities: facilities.map((f) => ({
          name: f.name,
          amount: f.amount,
          ...(f.currency ? { currency: f.currency } : {}),
          ...(f.revolvingType ? { revolvingType: f.revolvingType } : {}),
          ...(f.maturityDate ? { maturityDate: f.maturityDate } : {}),
          ...(f.effectiveDate ? { effectiveDate: f.effectiveDate } : {}),
        })),
      });
      const errors = (payload?.messages ?? []).filter((m) => String(m.severity).toLowerCase() === "error");
      if (!payload?.workpackageId || errors.length) {
        return {
          status: "failed",
          detail: errors.length ? errors.map((m) => m.text).join(" ") : "AFS did not return a workpackage id.",
          simulated: isSimulated(payload ?? result.payload),
        };
      }
      publication.afs = { workpackageId: payload.workpackageId };
      return {
        status: "done",
        detail: `Servicing workpackage ${payload.workpackageId} staged in AFS.`,
        recordId: payload.workpackageId,
        simulated: isSimulated(payload),
      };
    },
  };

  for (const lane of LANE_IDS) {
    const missing = (LANE_REQUIRES[lane] ?? []).filter((required) => !landed.has(required));
    const result: LaneResult = missing.length
      ? skipped(`Held: this step needs the ${missing.join(" and ")} step, which did not complete.`)
      : await bodies[lane]().catch(fromFailure);
    if (result.status === "done") landed.add(lane);
    publication.lanes.push({ lane, system: LANE_SYSTEM[lane], ...result });
  }

  publication.status = publicationStatus(publication.lanes);
  if (publication.lanes.some((l) => l.simulated)) publication.simulated = true;
  return publication;
}
