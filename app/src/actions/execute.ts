/* =============================================================================
   Action execution over the connector layer.

   Every registry action resolves to ONE of three execution modes:

     "tools":    a proven connector read exists today (Generate Spreading).
     "analysis": no tool exists yet, so the action produces a GROUNDED
                 ANALYSIS through the session door and says plainly what a
                 human would need to approve. This is the honest v1 behaviour
                 for the write-shaped actions: it never claims a record was
                 written.
     "prompt":   no capability in this view; the copy-prompt fallback carries
                 the ask into a live session.

   The `apexAction` seam on the registry names the FUTURE callTool target for
   the write-shaped actions; it stays unwired until v2 gated writes exist.
   ============================================================================= */

import type { BorrowerBundle, C360Data, Id } from "../data/contract";
import { refreshBoom } from "../channel/cockpitTools";
import { buildGroundedPrompt } from "../data/grounding";
import { mcpAvailable } from "../channel/mcp";
import { askSession, sampleAvailable } from "../channel/sampleDoor";
import { normaliseBoom } from "../../../client-360/render/boom-normalise.mjs";
import type { ClientAction } from "./registry";

export type ExecutionMode = "tools" | "analysis" | "prompt";

export interface ExecutionResult {
  mode: ExecutionMode;
  /** Narrative to surface in the timeline / panel. */
  text?: string;
  /** Data patch to merge over the staged bundle (tools mode). */
  patch?: Partial<BorrowerBundle>;
  storedAt?: number;
}

/** Actions with a proven connector read TODAY. */
const TOOL_BACKED = new Set(["generate-spreading"]);

/** WHAT ANSWERED, IN ITS OWN WORDS. Boom's server stamps every answer `_source`
 *  ("BOOM-LIVE" where it read Boom itself, a fixture name otherwise), and the
 *  line the banker reads says which rather than claiming the live one. */
const boomRefreshedLine = (source: string | undefined): string =>
  source === "BOOM-LIVE" || source === undefined
    ? "Spread financials refreshed from Boom."
    : `Spread financials refreshed from Boom, reading ${source}.`;

/* WHICH DOOR EACH MODE NEEDS (2026-09-15). IDB Gateway retired, so the grounded
   analysis runs on the session door and the tool-backed action runs on the
   connectors. They are different capabilities and a view can carry either
   without the other, so each mode asks for its own rather than for one that
   used to stand for both. With neither, the copy-prompt fallback carries the
   ask into a live session, which is what it has always been for. */
export function executionMode(action: ClientAction): ExecutionMode {
  if (mcpAvailable() && TOOL_BACKED.has(action.id)) return "tools";
  return sampleAvailable() ? "analysis" : "prompt";
}

/** Instruction appended to write-shaped actions so the answer is explicitly a
 *  preparation, never a claim that something was filed. */
const PREP_FRAMING =
  "Prepare this action: set out the analysis, the figures that support it, and exactly what a credit officer " +
  "would need to approve. Do NOT state or imply that any record has been created or written — nothing has been.";

export async function executeAction(args: {
  action: ClientAction;
  data: C360Data;
  bundle: BorrowerBundle | null;
  accountId: Id;
  accountName: string;
  tab: string | null;
}): Promise<ExecutionResult> {
  const { action, data, bundle, accountId, accountName, tab } = args;
  const mode = executionMode(action);
  if (mode === "prompt") return { mode };

  if (mode === "tools" && action.id === "generate-spreading") {
    const boom = await refreshBoom({ accountId, company: bundle?.snapshot?.name ?? accountName });
    const patch: Partial<BorrowerBundle> = {};
    if (boom.ratios || boom.spread) {
      // THE SAME NORMALISER THE ASSEMBLER RUNS (client-360/render/boom-normalise.mjs). The
      // connector hands back boom_get_ratios / boom_get_spread as they come off the wire, and
      // merging those raw envelopes onto the bundle is what used to leave the Financials tab
      // reading Boom's display CARDS array as if it were the ratio object. Normalise once, here,
      // and the tab and the covenant challenge keep reading one shape.
      const merged = normaliseBoom({
        ...(bundle?.boom ?? {}),
        ...(boom.ratios ? { ratios: boom.ratios } : {}),
        ...(boom.spread ? { spread: boom.spread } : {}),
      });
      if (merged) patch.boom = merged;
    }
    return { mode, patch, storedAt: boom.storedAt, text: boomRefreshedLine(boom.source) };
  }

  // analysis mode — grounded, and explicitly a preparation for the
  // write-shaped actions.
  const isWriteShaped = Boolean(action.apexAction);
  const question = `${action.promptTemplate
    .replaceAll("{account}", accountName)
    .replaceAll("{accountId}", accountId)}${isWriteShaped ? `\n\n${PREP_FRAMING}` : ""}`;

  // THE SAME GROUNDING, THE SESSION DOOR (2026-09-15). The prompt is built from
  // the staged bundle exactly as it was when the gateway answered it, so the
  // analysis still stands on the cockpit's own figures and never on general
  // knowledge; only the door it goes through changed.
  const text = await askSession(buildGroundedPrompt({ data, bundle, accountName, tab, question }), {
    tier: "default",
    kind: "reply",
  });
  return { mode, text };
}
