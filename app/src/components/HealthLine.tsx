import { useEffect } from "react";
import { fmtAsOf } from "../data/format";
import { probeConnectorGrants, SERVERS } from "../channel/mcp";
import { useLaneHealth, type LaneHealth } from "../channel/laneHealth";

/* =============================================================================
   THE HEALTH LINE: one quiet sentence about the connectors, always on screen.

   FOUNDER, 2026-09-03: the relay dropped the Salesforce session for two hours,
   the page said "Customer 360 is briefly unreachable" over empty modules, and
   there was no way to tell from the screen which lane had gone, whether the
   grant was even there, or when the figures had last been true. Three different
   problems wear the same banner, and the fix for each is different.

   So the chrome carries a status line: per connector, the grant, when it last
   answered, and what it is doing now. It is DELIBERATELY QUIET, 10.5px faint
   ink on the page ground, no fills, no badges, nothing louder than the live dot
   in the header, because a banker should be able to ignore it for a whole
   afternoon and still find it in the same place when something goes wrong.

   IT NEVER CLAIMS LIVE OVER STORED DATA. `stale since` is its own word, and it
   is what a lane painting a cached document reads.
   ============================================================================= */

/** The lanes, in the order the cockpit depends on them, with the word a banker
 *  uses for each. Display names come from SERVERS so the line can never name a
 *  connector the calls do not address. */
const LANES: ReadonlyArray<{ server: string; label: string }> = [
  { server: SERVERS.customer360, label: "Salesforce" },
  /* THE BACKUP EARNS ITS PLACE ON THE LINE OR IT IS NOT ON IT. A read lane
     nobody has needed is not news, and naming it every session would spend the
     one quiet sentence the chrome has on a connector that did nothing. So it
     appears in exactly two states: it answered for Salesforce (the filter below
     keeps any lane that has been called), or the viewer has not added it, which
     is a connector to add and worth one word. */
  { server: SERVERS.readBackup, label: "Backup" },
  { server: SERVERS.gateway, label: "Gateway" },
  { server: SERVERS.m365, label: "Inbox" },
  { server: SERVERS.experience, label: "nCino" },
  { server: SERVERS.afs, label: "AFS" },
];

const SERVER_NAMES = LANES.map((l) => l.server);

/** The lane's state, in words, with the one fact that state is about. */
export function laneSentence(lane: LaneHealth | undefined, label: string, now: number): string {
  if (!lane) return `${label} ready`;
  if (lane.grant === "unavailable") return `${label} unavailable`;
  if (lane.grant === "not-granted") return `${label} not granted`;
  if (lane.state === "unreachable") return `${label} unreachable: ${lane.code ?? "upstream_error"}`;
  // The figures ARE current; they came through the other door. Same tokens and
  // the same quietness as `live`, because that is the honest comparison: the
  // org answered, and this says which hop carried the answer.
  if (lane.state === "backup") return `${label} via backup ${fmtAsOf(lane.lastGoodAt, now)}`;
  if (lane.state === "stale") return `${label} stale since ${fmtAsOf(lane.lastGoodAt, now)}`;
  if (lane.state === "live") return `${label} live ${fmtAsOf(lane.lastGoodAt, now)}`;
  return `${label} ready`;
}

/** Ink for one lane. Warning for a lane that is down, faint for everything
 *  else: a granted lane doing its job is not news. */
function laneInk(lane: LaneHealth | undefined): string {
  if (lane?.state === "unreachable" && lane.grant === "granted") return "var(--warning)";
  return "var(--ink-faint)";
}

export function HealthLine() {
  const lanes = useLaneHealth();

  /* ASK ONCE, AT MOUNT. A lane nobody granted and a lane that is briefly down
     look identical from a failed call, and only `listTools()` can tell them
     apart before the first read. */
  useEffect(() => {
    void probeConnectorGrants(SERVER_NAMES);
  }, []);

  const now = Date.now();
  const shown = LANES.filter(({ server }) => {
    const lane = lanes[server];
    // A lane nobody has called and nobody granted has nothing to say. The two
    // writeback connectors sit unused for whole sessions; naming them idle
    // every time would make the line longer than it is useful.
    return lane !== undefined && !(lane.grant === "granted" && lane.state === "idle");
  });

  if (!shown.length) return null;

  const everyLaneGone = shown.every((l) => lanes[l.server]?.grant === "unavailable");

  return (
    /* NOT role="status". A live region would have the screen reader announce
       every lane transition over whatever the banker was reading, and the
       cockpit already has one status region: the sync console. A footer is a
       contentinfo landmark on its own. */
    <footer className="health-line" aria-label="Connector health">
      <span className="hl-key">Connectors</span>
      {everyLaneGone ? (
        <span className="hl-lane" style={{ color: "var(--ink-faint)" }}>
          unavailable in this view
        </span>
      ) : (
        shown.map(({ server, label }) => {
          const lane = lanes[server];
          return (
            <span
              key={server}
              className="hl-lane"
              style={{ color: laneInk(lane) }}
              data-lane={server}
              data-lane-state={lane?.state}
              title={lane?.message ? `${server}: ${lane.message}` : server}
            >
              {laneSentence(lane, label, now)}
            </span>
          );
        })
      )}
    </footer>
  );
}
