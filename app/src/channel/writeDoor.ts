/* =============================================================================
   THE WRITE DOOR. A leaf module, for the same reason `boomLane.ts` is one:
   `channel/mcp.ts` reads these names into its own manifest and into the call
   seam, so anything this file imported would be a cycle through the seam every
   call in the cockpit passes through.

   WHY THERE IS A SECOND DOOR FOR TWO WRITES (0.9.29, SPEC-0.9.29-WRITE-DOOR).
   On 2026-09-15, live in front of an audience, five `stage_loan_modification`
   attempts from a fresh page answered `server_unavailable` (502) within seconds
   while the ORG staged every one of them: rows STG-0000000172 to 175, Apex
   Success in 451 to 735 ms, plans about 9 KB. The answer carries the single-use
   decision token, so a lost answer is a plan the banker cannot file. The same
   plan staged and executed first try over the REST Actions API from our own box
   twenty minutes earlier. The hop the page rents from claude.ai to Salesforce's
   hosted dispatcher fails in windows we neither see nor control, and no length
   of retry ladder can outlast a window nobody can measure. So the cockpit gains
   a door we run: the gateway's own MCP endpoint for writes, which forwards the
   SAME body to `invokeAction` untouched.

   THE DOOR IS FOUND, NOT NAMED. A connector is addressed by the DISPLAY NAME
   the viewer gave it in claude.ai and nobody here can know that spelling, so the
   page asks `listTools()` which connector serves the door's tools. The read
   gateway serves `gw_Customer360*` and `gw_health` and NEVER a write, so a
   connector serving a `gw_Stage...` AND a `gw_Execute...` is the write door,
   whatever its owner called it. `WRITE_DOOR_FALLBACK_NAME` is a LABEL for the
   health row and the manifest, never an address discovery has answered.

   THE DOOR ADDS NO GATE AND REMOVES NONE. The org's own fences are the
   authority: the plan hash, the single-use token, `approverUserId` equal to the
   running identity, the allowlisted transitions. D-W1 (open for the founder):
   the door runs as the gateway's own org identity, so for any viewer who is not
   that identity the org itself refuses the execute, which is the correct
   behaviour and is not widened here.
   ============================================================================= */

/** The door's display name before discovery answers, and where it never does.
 *  `SERVERS.writeDoor` in channel/mcp.ts is this string, and it is the name the
 *  published grant declares (client-360/assets/capabilities.json). */
export const WRITE_DOOR_FALLBACK_NAME = "Customer 360 Write Door";

type ServerListing = ReadonlyArray<{ server: string; authStatus?: string; tools?: ReadonlyArray<{ name: string }> }>;

/**
 * The door's name for one cockpit tool, or null where the tool is not a write
 * the door can carry.
 *
 * DERIVED, NOT TABULATED. The gateway publishes one tool per Apex invocable
 * class, under the class's own name with a `gw_` prefix, and every governed tool
 * name in `TOOLS` is that class name in snake case: `stage_loan_modification` is
 * `StageLoanModification.cls` is `gw_StageLoanModification`. A hand-kept table
 * would be a second thing to keep true, and its drift would be silent.
 *
 * The derivation is not the authority on what the door SERVES: only the
 * connector's own tool list is ({@link doorTool}). A name derived for a tool the
 * gateway does not publish is never called.
 */
export function doorToolName(tool: string): string | null {
  if (!/^(stage|execute|complete)_[a-z0-9]+(_[a-z0-9]+)*$/.test(tool)) return null;
  return `gw_${tool.replace(/(^|_)([a-z0-9])/g, (_m, _sep, c: string) => c.toUpperCase())}`;
}

let resolved: string | null = null;
let served: ReadonlySet<string> = new Set();

/** The display name every write-door call is addressed to. */
export function writeDoorServer(): string {
  return resolved ?? WRITE_DOOR_FALLBACK_NAME;
}

/** True once a connector in the viewer's list has been recognised as the door. */
export function writeDoorConnected(): boolean {
  return resolved !== null;
}

/**
 * Take the write door out of a `listTools()` answer, where one is in it.
 * `probeConnectorGrants` calls this, so the boot probe pays for one round trip
 * and this discovery rides on it, exactly as the Boom lane's does.
 *
 * THE SIGNATURE IS STRUCTURAL. Not a pair of hard-wired tool names, because the
 * door's tool set is whatever pairs the org deploys; a connector that serves one
 * staging tool and one execute tool under the gateway's prefix is the door, and
 * nothing else in the cockpit's world serves either.
 */
export function noteWriteDoorServers(servers: ServerListing | undefined): string | null {
  for (const entry of servers ?? []) {
    const names = (entry.tools ?? []).map((t) => t.name);
    if (!names.some((n) => n.startsWith("gw_Stage")) || !names.some((n) => n.startsWith("gw_Execute"))) continue;
    if (typeof entry.server !== "string" || !entry.server) continue;
    resolved = entry.server;
    served = new Set(names);
    return resolved;
  }
  return null;
}

/** The door's tool name for this cockpit tool, but ONLY where a discovered door
 *  actually serves it. Null is the whole answer to "can the door carry this":
 *  no door, or a door whose gateway does not publish this pair. */
export function doorTool(tool: string): string | null {
  if (resolved === null) return null;
  const name = doorToolName(tool);
  return name !== null && served.has(name) ? name : null;
}

/** Tests. */
export function resetWriteDoor(): void {
  resolved = null;
  served = new Set();
}
