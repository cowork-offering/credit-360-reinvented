import { useEffect, useState } from "react";
import { fmtAsOf } from "../data/format";
import { boomServer } from "../channel/boomLane";
import { probeConnectorGrants, SERVERS } from "../channel/mcp";
import { writeDoorServer } from "../channel/writeDoor";
import { laneCalls, useLaneHealth, type LaneHealth } from "../channel/laneHealth";

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

   AND IT CARRIES THE CLOCK (2026-09-06). "Latency free" is a claim, and a claim
   the founder cannot check from his own seat during a demo is a claim nobody
   should make. The relay hop between the artifact and the connector is
   invisible to every instrument except this page, so the last call's own wall
   time rides the same sentence, in the same faint ink:

       Salesforce live 22:34 UTC · 420 ms

   and the lane opens to its last ten calls with their durations and the tool
   each one asked for. THE OPEN STATE IS A CLICK, NOT A HOVER. A panel that
   appears under a passing cursor is a panel that appears while a banker is
   reaching for something else, and this line's whole design is that it can be
   ignored for an afternoon.
   ============================================================================= */

/** The lanes, in the order the cockpit depends on them, with the word a banker
 *  uses for each. Display names come from SERVERS so the line can never name a
 *  connector the calls do not address. */
/* THE BOOM ROW NAMES THE CONNECTOR THAT WAS FOUND (0.9.28). Boom left the
   gateway and is a connector of its own, addressed by whatever display name the
   viewer gave it: the row is therefore built per render off `boomServer()`
   rather than from a constant, so the moment the boot probe below discovers the
   real spelling the line says it. Until it does, the row reads the fallback
   ("Boom"), which is also what a call would be addressed to. The label is the
   connector's own name so an operator reading this line and the connector list
   in claude.ai sees one string, not two. */
function lanes(): ReadonlyArray<{ server: string; label: string; carries?: string; optional?: true }> {
  return [
    { server: SERVERS.customer360, label: "Salesforce" },
    /* THE BACKUP EARNS ITS PLACE ON THE LINE OR IT IS NOT ON IT. A read lane
       nobody has needed is not news, and naming it every session would spend the
       one quiet sentence the chrome has on a connector that did nothing. So it
       appears in exactly two states: it answered for Salesforce (the filter below
       keeps any lane that has been called), or the viewer has not added it, which
       is a connector to add and worth one word. */
    { server: SERVERS.readBackup, label: "Backup" },
    /* THE WRITE DOOR (0.9.29), OPTIONAL AND SAYING WHAT IT CARRIES. It appears
       on the same two terms the backup does: it answered for Salesforce, or the
       viewer has not added it. `carries` is the one sentence that tells an
       operator what this connector is for, and it rides the title rather than
       the line, because the line is the quietest thing in the cockpit and this
       lane is silent in a session where nothing was filed the hard way. Found,
       not named: the row addresses whichever connector discovery resolved. */
    {
      server: writeDoorServer(),
      label: "Write door",
      carries: "the second hop for the governed stage and execute pairs, taken only when the Salesforce hop loses an answer. Reads never use it.",
      optional: true,
    },
    { server: boomServer(), label: boomServer() },
    { server: SERVERS.m365, label: "Inbox" },
    { server: SERVERS.experience, label: "nCino" },
    { server: SERVERS.afs, label: "AFS" },
  ];
}

/** A round trip, in the units a banker reads without converting: under a
 *  second in milliseconds, past it in seconds to one decimal. */
function fmtLatency(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The lane's state, in words, with the one fact that state is about, and what
 *  the last round trip on it cost.
 *
 *  THE DURATION RIDES A STATE THAT HAS ONE. A lane painting a stored document
 *  has made no call this session, and a lane nobody granted has made none
 *  either; printing a millisecond figure beside either would be inventing a
 *  measurement out of a state that is the absence of one. */
export function laneSentence(lane: LaneHealth | undefined, label: string, now: number): string {
  if (!lane) return `${label} ready`;
  if (lane.grant === "unavailable") return `${label} unavailable`;
  if (lane.grant === "not-granted") return `${label} not granted`;
  const ms = fmtLatency(lane.lastMs);
  const withMs = (sentence: string) => (ms ? `${sentence} · ${ms}` : sentence);
  if (lane.state === "unreachable") return withMs(`${label} unreachable: ${lane.code ?? "upstream_error"}`);
  // The figures ARE current; they came through the other door. Same tokens and
  // the same quietness as `live`, because that is the honest comparison: the
  // org answered, and this says which hop carried the answer.
  if (lane.state === "backup") return `${label} via backup ${fmtAsOf(lane.lastGoodAt, now)}`;
  if (lane.state === "stale") return `${label} stale since ${fmtAsOf(lane.lastGoodAt, now)}`;
  if (lane.state === "live") return withMs(`${label} live ${fmtAsOf(lane.lastGoodAt, now)}`);
  return `${label} ready`;
}

/** The last ten calls on one lane, newest first, each with what it cost.
 *
 *  Rendered only while the lane is open, so a cockpit nobody has asked about
 *  its connectors carries none of this in the document at all. */
function LaneHistory({ server }: { server: string }) {
  const calls = laneCalls(server);
  if (!calls.length) return <div className="hl-hist-empty">no calls yet this session</div>;
  return (
    <ol className="hl-hist">
      {[...calls].reverse().map((c) => (
        <li key={`${c.at}-${c.tool}`} data-ok={c.ok ? "1" : "0"}>
          <span className="hl-hist-tool">{c.tool}</span>
          <span className="hl-hist-ms">{fmtLatency(c.ms)}</span>
          <span className="hl-hist-when">{new Date(c.at).toISOString().slice(11, 19)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Ink for one lane. Warning for a lane that is down, faint for everything
 *  else: a granted lane doing its job is not news. */
function laneInk(lane: LaneHealth | undefined): string {
  if (lane?.state === "unreachable" && lane.grant === "granted") return "var(--warning)";
  return "var(--ink-faint)";
}

export function HealthLine() {
  const health = useLaneHealth();
  const LANES = lanes();
  /** The one lane whose history is showing, or null. One at a time: this is a
   *  status line, and two open panels is a console. */
  const [open, setOpen] = useState<string | null>(null);

  /* ASK ONCE, AT MOUNT. A lane nobody granted and a lane that is briefly down
     look identical from a failed call, and only `listTools()` can tell them
     apart before the first read. */
  useEffect(() => {
    void probeConnectorGrants(LANES.map((l) => l.server));
  }, []);

  const now = Date.now();
  const shown = LANES.filter(({ server, optional }) => {
    const lane = health[server];
    // A lane nobody has called and nobody granted has nothing to say. The two
    // writeback connectors sit unused for whole sessions; naming them idle
    // every time would make the line longer than it is useful.
    if (lane === undefined || (lane.grant === "granted" && lane.state === "idle")) return false;
    /* AND AN OPTIONAL DOOR NOBODY HAS NEEDED IS NOT NEWS EITHER. The backup
       earns its "not granted" word because without it an outage leaves the page
       on stored figures; the write door changes nothing at all until a governed
       write loses its answer, so it appears once it has carried something (or
       failed to), and never merely because a viewer did not add it. */
    if (optional && lane.grant !== "granted") return false;
    return true;
  });

  if (!shown.length) return null;

  const everyLaneGone = shown.every((l) => health[l.server]?.grant === "unavailable");

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
        shown.map(({ server, label, carries }) => {
          const lane = health[server];
          const isOpen = open === server;
          return (
            <span key={server} className="hl-lane">
              {/* A BUTTON, because it does something. The sentence itself is
                  the control: adding a separate affordance beside it would put
                  a second thing on the quietest line in the cockpit.

                  THE LANE'S IDENTITY TRAVELS WITH THE SENTENCE, not with the
                  wrapper: `data-lane-state`, the ink and the platform's message
                  describe what the words say, and the drives and the suite have
                  always read them off the element carrying those words. */}
              <button
                type="button"
                className="hl-lane-btn"
                style={{ color: laneInk(lane) }}
                data-lane={server}
                data-lane-state={lane?.state}
                aria-expanded={isOpen}
                title={[server, carries, lane?.message].filter(Boolean).join(": ")}
                onClick={() => setOpen(isOpen ? null : server)}
              >
                {laneSentence(lane, label, now)}
              </button>
              {isOpen && <LaneHistory server={server} />}
            </span>
          );
        })
      )}
    </footer>
  );
}
