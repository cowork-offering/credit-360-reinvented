/* =============================================================================
   WHICH DOOR IS BOOM. A leaf module, and deliberately: `channel/mcp.ts` reads
   these names into its own manifest, so anything this file imported would be a
   cycle through the seam every call in the cockpit passes through.

   THE CONNECTOR IS FOUND, NOT NAMED (0.9.28, founder decision D1). A connector
   is addressed by the DISPLAY NAME the viewer gave it in claude.ai, and nobody
   here can know what that is: one bank will add Boom as "Boom", another as
   "Boom MCP", a third as "Spreading". Hard-wiring a spelling is how a lane goes
   dark on a page that is correctly configured. So the page asks `listTools()`
   which connectors it can see and takes the one that serves BOTH Boom reads.
   Nothing else can serve both; a server that serves them IS Boom, whatever its
   owner called it.

   THE FALLBACK IS A LABEL, NOT AN ADDRESS. Where the runtime cannot enumerate
   servers, or none matches, `BOOM_FALLBACK_NAME` is what the health row and the
   operator sentence print. A call addressed to it will fail `server_not_connected`
   if that is not the viewer's spelling, and that failure's own copy ("Add Boom in
   claude.ai Settings → Connectors") is the honest next step.
   ============================================================================= */

/** The Boom connector's display name before discovery answers, and where it
 *  never does. `SERVERS.boom` in channel/mcp.ts is this string. */
export const BOOM_FALLBACK_NAME = "Boom";

type ServerListing = ReadonlyArray<{ server: string; authStatus?: string; tools?: ReadonlyArray<{ name: string }> }>;

let resolved: string | null = null;
let discovery: Promise<string> | undefined;

/** The connector display name every Boom call is addressed to. */
export function boomServer(): string {
  return resolved ?? BOOM_FALLBACK_NAME;
}

/** Take the Boom connector out of a `listTools()` answer, where one is in it.
 *  `probeConnectorGrants` calls this, so the boot probe pays for one round trip
 *  and discovery rides on it. The SIGNATURE is handed in, the tool names live
 *  in `TOOLS` (channel/mcp.ts), which is the cockpit's one manifest and which
 *  imports this file. */
export function noteBoomServers(servers: ServerListing | undefined, signature: readonly string[]): string | null {
  for (const entry of servers ?? []) {
    const names = new Set((entry.tools ?? []).map((t) => t.name));
    if (!signature.every((t) => names.has(t))) continue;
    if (typeof entry.server === "string" && entry.server) resolved = entry.server;
    return resolved;
  }
  return null;
}

/** How the connector list is asked for. The runtime namespace is ACQUIRED
 *  (`window.claude.use("mcp")` on current runtimes, a pre-injected member on
 *  older ones), and that acquisition lives in channel/mcp.ts, which imports this
 *  file: the lister is therefore handed in rather than reached for. */
export type ServerLister = () => Promise<ServerListing | undefined>;

/** Find the Boom connector, once. Memoised, so a page asking from three
 *  surfaces asks the runtime once. */
export function discoverBoomServer(list: ServerLister, signature: readonly string[]): Promise<string> {
  if (resolved) return Promise.resolve(resolved);
  if (discovery) return discovery;
  discovery = (async () => {
    try {
      return noteBoomServers(await list(), signature) ?? BOOM_FALLBACK_NAME;
    } catch {
      // A probe that cannot answer says nothing; the fallback is still a name
      // the operator sentence can print.
      return BOOM_FALLBACK_NAME;
    }
  })();
  return discovery;
}

/** Tests. */
export function resetBoomServer(): void {
  resolved = null;
  discovery = undefined;
}
