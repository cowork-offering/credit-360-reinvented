import { executeAction, stageAction, type StagePayloads } from "../channel/writeTools";
import { amendablePackage, packageRoster } from "../book/packages";
import { armStage } from "../components/workroom/orgArms";
import type { BorrowerBundle, C360Data } from "../data/contract";
import { isActiveFacility } from "../data/worklist";
import type { WorkroomEngine } from "./engine";
import { createModifyEngine, WorkroomRefusalError, type ModifyEngineDeps } from "./modifyEngine";
import type { WorkroomContext } from "./types";

/* =============================================================================
   SHAPING THE VERSION THAT ALREADY EXISTS (0.9.23, spec section 2a).

   FOUNDER, 2026-09-13: "a modification we created a day ago: add a covenant or
   collateral, change the facility information; same for packages I created."
   0.9.17 gave the version a first-class STATE. It gave it no ROUTE: the room
   could name the version, lock the fork, say the version was "editable until
   approval", and then offer nothing that edited it.

   THIS IS THAT ROUTE, AND IT IS DELIBERATELY NOT A NEW ROOM.

   The banker's language does not change between reshaping a booked package and
   reshaping the version of it they made yesterday: "take the line to $20M",
   "add a fixed charge covenant at 1.25", "pledge the Duluth warehouse". So the
   whole conversation is the MODIFICATION ENGINE, run in its `amend` variant:
   the same field catalog, the same `parseModify` member resolution (over the
   VERSION's members, because they are the package's members), the same
   four-field pricing gate, the same step machine (term, first payment date,
   rate, amount), the same advisories, the same drift recompute, the same
   single-use token. What this module owns is the three things that genuinely
   differ:

     1. WHO MAY. `amendablePackage` (book/packages.ts, the orchestrator's) is
        the one judgement, and it is the same one `StageAmendVersion` re-reads
        on the org: an in-flight version still below Approval / Loan Committee,
        or a package the cockpit created with nothing booked on it.
     2. WHERE IT LANDS. `stage_amend_version` / `execute_amend_version`, whose
        arms are the modification's arms minus the two that cannot be an
        amendment. The translation below is the whole of that wire.
     3. WHAT THE ROOM CALLS IT. An amendment forks nothing, clones nothing and
        starts no credit action, and the plan card says so before the banker
        confirms anything.

   NOTHING HERE SIMULATES. Until the pair is published on the connector the
   stage call fails as the unavailable tool it is, exactly as every other write
   in this cockpit does.
   ============================================================================= */

/** The tool contract's own name for the wire this room stages on. */
export const AMEND_ACTION_ID = "amend-version" as const;

/**
 * THE SENTENCE A FORK ROUTE MEETS IN A VERSION IT COULD BE AMENDING.
 *
 * `VERSION_TARGET_REFUSAL` (book/packages.ts) says the true half and then sends
 * the banker to Salesforce. That second half was honest only while the cockpit
 * had no way to change a version; it has one now, so a refused fork on a version
 * this room COULD amend points at the amend route instead. The Salesforce
 * sentence survives where it is still true: a version the org has taken, which
 * `IN_APPROVAL_REFUSAL` already answers.
 */
export const VERSION_AMEND_REFUSAL =
  "This package is the unbooked modification version itself, so it carries no booked facility to modify or renew. " +
  "Change the figures in this version: say what should move, and I put it on the plan.";

/** The plan card's own sentence. It names the version, because the one thing a
 *  banker has to know before confirming is WHICH record this changes. */
export function amendPlanTitle(versionName: string): string {
  const named = (versionName ?? "").trim();
  return `Amendment on ${named || "this version"}, no new version, no credit action; it changes the version the org already holds.`;
}

/* ------------------------------------------------------------------ the gate */

/**
 * MAY THIS ROOM OFFER THE AMEND ROUTE?
 *
 * One judgement, `amendablePackage`, read off the roster, and every surface
 * asks THIS rather than re-deriving it: the route chip, the refused fork and
 * the create room's offer all have to agree, and a rule written three times is
 * a rule that agrees today. A room standing on no package offers nothing, which
 * is the create room's default path: there is no version there to shape.
 */
export function canAmendHere(
  bundle: BorrowerBundle | null | undefined,
  productPackageId: string | null,
  history?: Parameters<typeof packageRoster>[1],
): boolean {
  if (!productPackageId) return false;
  const entry = packageRoster(bundle, history).find((e) => e.id === productPackageId);
  return entry ? amendablePackage(entry) : false;
}

/* --------------------------------------------------------------- the wire */

type ModificationPayload = StagePayloads["loan-modification"];
type AmendPayload = StagePayloads["amend-version"];

/** One entry of an arm that names the loan it lands on. */
interface Targeted {
  targetLoanId?: string;
  op?: string;
}

function parseArm(json: string | null | undefined, arm: string): Targeted[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as Targeted[]) : [];
  } catch {
    throw new WorkroomRefusalError(
      `The plan's ${arm} could not be read back as a list, so it cannot be checked against this version's own facilities. Take the entry off the manifest and say it again.`,
    );
  }
}

/**
 * THE MODIFICATION PAYLOAD, TURNED INTO AN AMENDMENT.
 *
 * The two shapes are deliberately close: the tool contract says so in its own
 * words ("amending an EXISTING version is the same arms landing on the
 * version's own loans, without the credit action"), which is why the engine can
 * compose one payload and this converts it. What it will NOT do is let an arm
 * through that the amendment pair does not carry. Every refusal below is a
 * sentence the banker can act on, raised BEFORE the call leaves, so nothing is
 * written and the manifest is exactly where they left it.
 */
export function toAmendPayload(
  payload: ModificationPayload,
  args: { versionPackageId: string; memberIds: ReadonlySet<string> },
): AmendPayload {
  const { versionPackageId, memberIds } = args;

  /* NO BROADCAST. The contract has no flat scalar keys at all: on an amend
     every figure names its loan. `wirePayload` already routes per target for
     this variant, so reaching here with a flat figure is a broken invariant
     rather than a banker's mistake, and it is refused as one. */
  const flat = (["requestedAmount", "requestedMaturityDate", "requestedTermMonths", "requestedRate"] as const).filter(
    (key) => payload[key] !== null && payload[key] !== undefined,
  );
  if (flat.length) {
    throw new WorkroomRefusalError(
      `An amendment names the facility for every figure, and this plan carries ${flat.join(", ")} with no facility on it. Say the change again naming the facility it lands on.`,
    );
  }

  /* THE TWO ARMS THE PAIR DOES NOT CARRY, each with the contract's own reason.
     Both are already handed off at the chip (`modifyEngine`'s variant arms), so
     this is the backstop for a payload assembled anywhere else. */
  if (payload.policyExceptionAddsJson) {
    throw new WorkroomRefusalError(
      "A policy exception is authored by the credit action against the clone it makes, and an amendment makes none. Take it off the manifest; it belongs on the modification that books this version, or on Salesforce directly.",
    );
  }
  if (payload.covenantExclusionsJson || payload.pledgeExclusionsJson) {
    throw new WorkroomRefusalError(
      "A carry exclusion tells a version roll to write fewer rows, and an amendment rolls nothing: the version already exists and its junctions are already on it. Removing one is a real delete, which this pair does not do.",
    );
  }
  if (payload.newFacilitiesJson) {
    throw new WorkroomRefusalError(
      "A new facility on this version is the new facility room's own filing, not an amendment of the loans already on it. Open New facility and take this version off the offer.",
    );
  }

  const involvements = parseArm(payload.involvementChangesJson, "borrowing-structure changes");
  if (involvements.some((e) => e.op === "remove")) {
    throw new WorkroomRefusalError(
      "A removal on a version is a real delete, not a carry the roll can leave behind, and the amendment pair does not delete. Take the row off in Salesforce, or discard the version and fork it again.",
    );
  }

  /* EVERY TARGET IS A MEMBER OF THIS VERSION, and a target outside it is
     refused BY NAME rather than sent for the org to reject. The engine resolves
     members from the version package, so this is an invariant; it is checked
     because a plan that filed a figure onto somebody else's loan is the one
     failure this room can never recover from. */
  const arms: Array<[string, string | null | undefined]> = [
    ["scalarChangesJson", payload.scalarChangesJson],
    ["fieldChangesJson", payload.fieldChangesJson],
    ["covenantAddsJson", payload.covenantAddsJson],
    ["covenantAttachesJson", payload.covenantAttachesJson],
    ["pledgeAddsJson", payload.pledgeAddsJson],
    ["feeAddsJson", payload.feeAddsJson],
    ["involvementChangesJson", payload.involvementChangesJson],
  ];
  let carried = 0;
  for (const [name, json] of arms) {
    const entries = parseArm(json, name);
    carried += entries.length;
    for (const entry of entries) {
      const target = entry.targetLoanId;
      if (target && !memberIds.has(target)) {
        throw new WorkroomRefusalError(
          `${target} is not a facility on this version, so nothing in this plan may land on it. Name one of the facilities above.`,
        );
      }
    }
  }
  if (!carried) {
    throw new WorkroomRefusalError("Nothing in this plan changes the version, so there is no amendment to stage.");
  }

  const out: AmendPayload = {
    idempotencyKey: payload.idempotencyKey,
    // The contract makes it REQUIRED, and the engine always composes one.
    rationale: payload.rationale ?? "Amendment Workroom",
    versionPackageId,
  };
  // A key exists on the wire only where it carries something: the org counts
  // the lists that arrive, and an empty one is a change nobody asked for.
  for (const [name, json] of arms) {
    if (json) (out as unknown as Record<string, string>)[name] = json;
  }
  return out;
}

/* -------------------------------------------------------------- the engine */

export interface AmendEngineDeps extends Pick<ModifyEngineDeps, "restate" | "available" | "newKey" | "today"> {
  stage?: (payload: AmendPayload) => ReturnType<typeof stageAction<"amend-version">>;
  execute?: ModifyEngineDeps["execute"];
}

/**
 * THE AMEND ROOM'S ENGINE.
 *
 * It is `createModifyEngine` in its `amend` variant with the wire swapped. The
 * arms ride `armStage` exactly as the modification's do (the covenant-attach
 * arm is on the amendment contract too), and then `toAmendPayload` turns the
 * modification shape into the amendment shape, refusing the arms that are not
 * on the pair. Everything the banker sees and says is the modification room's.
 */
export function createAmendEngine(args: {
  context: WorkroomContext;
  data: C360Data;
  bundle: BorrowerBundle | null;
  deps?: AmendEngineDeps;
}): WorkroomEngine {
  const { context, bundle } = args;
  const versionPackageId = context.productPackageId;
  const memberIds = new Set(
    (bundle?.exposure?.facilities ?? [])
      .filter(isActiveFacility)
      .filter((f) => !versionPackageId || f.productPackageId === versionPackageId)
      .map((f) => f.loanId)
      .filter((id): id is string => Boolean(id)),
  );

  const stage = args.deps?.stage ?? ((payload: AmendPayload) => stageAction(AMEND_ACTION_ID, payload));

  return createModifyEngine({
    context: args.context,
    data: args.data,
    bundle: args.bundle,
    variant: "amend",
    deps: {
      ...args.deps,
      /* THE ARMS FIRST, THEN THE TRANSLATION. `armStage` lifts the sentinel
         field changes back out into their own keys; only then is the shape an
         amendment's, so the two run in that order and never the other way. */
      stage: armStage((payload) => {
        if (!versionPackageId) {
          throw new WorkroomRefusalError(
            "This room is not standing in a version, so there is nothing to amend. Open the package the version is on and try again.",
          );
        }
        return stage(toAmendPayload(payload, { versionPackageId, memberIds }));
      }),
      execute: args.deps?.execute ?? ((payload) => executeAction(AMEND_ACTION_ID, payload)),
    },
  });
}
