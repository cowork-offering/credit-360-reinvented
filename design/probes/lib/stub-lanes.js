/* PROBE HARNESS ONLY: THE LANE STAND-IN.

   THE FAILURE THIS EXISTS TO REPRODUCE. On 2026-09-03 the artifact-to-connector
   relay dropped its Salesforce session for two hours: every call the PAGE made
   answered `server_unavailable: request failed (502)` while the same tools
   answered normally in chat. There is no way to ask a real relay to do that on
   demand, so the drive supplies a connector of its own that can.

   TWO DOORS, BOTH THE 0.2.x SHAPE:
     window.claude.use("mcp")   the connector namespace, driven by window.__LANES
     window.claude.use("db")    an in-memory artifact store of the db.d.ts shape,
                                so the page's last-good cache and the intent
                                watch have somewhere real to read and write.

   AND THREE CONNECTORS BEHIND THE FIRST DOOR. "Customer 360" and, since the
   backup lane was wired in, "Salesforce Read Backup": the SAME ten reads under
   `gw_`-prefixed names, answered from the same table, with a mode and a grant
   of their own so the drive can shut either door independently. That is the
   whole point of the lane, and a stub that could only shut both at once could
   not tell the fallback working from the fallback never being reached.

   THE CONTROL SURFACE is `window.__LANES`, which the drive flips mid-run:
     mode        "ok" | "down" | "failTwice" | "slow" | "hang" | "denied"
     backupMode  the same set, for the read backup. Default "ok".
     backup      "granted" | "absent". Absent means the viewer never added the
                 connector: it is missing from listTools and every call to it is
                 refused server_not_connected, which is what claude.ai does.
     hangTools   UNPREFIXED tool names that never settle on EITHER door, so the
                 drive can hang exactly one lane and watch the rest finish
     latencyMs   how long every answer takes in "slow"
     relayMs     THE RELAY BUDGET. What ONE artifact-to-connector round trip
                 costs, paid by every answer this stub gives, success or
                 refusal alike. The real hop (claude.ai artifact to connector to
                 org) was measured at 236-560ms per call on 2026-09-06 against
                 the read backup; `relayMs` is how the latency probe replays a
                 300 / 500 / 800ms relay against the real bundle. Default 0, so
                 every drive written before this knob existed is unchanged.
     attempts    per-tool attempt counter, so the drive can count retries
     settled     one row per ANSWER, `{ server, tool, at, ok }`, so a probe can
                 time the sixth slice landing without reading the glass
     livePatch    per-tool fields merged over the LIVE body, so a drive that
                 needs one more field (a package id, for a room that will not
                 open without one) does not have to fork this table

   NOTHING HERE SHIPS. The artifact's own build fails closed on simulation
   markers and this file is never bundled; the app itself still refuses to
   invent a figure. */
(function () {
  var ACCOUNT = "001bb00001DLtRMAA1";

  var BACKUP_SERVER = "Salesforce Read Backup";

  window.__LANES = { mode: "ok", backupMode: "ok", backup: "granted", hangTools: [], latencyMs: 0, relayMs: 0, attempts: {}, calls: [], settled: [], livePatch: {} };
  window.__DRIVE_OUT = { errors: [] };
  window.addEventListener("error", function (e) {
    window.__DRIVE_OUT.errors.push(String((e && e.message) || e));
  });
  window.addEventListener("unhandledrejection", function (e) {
    window.__DRIVE_OUT.errors.push("unhandled: " + String((e && e.reason && e.reason.message) || (e && e.reason)));
  });

  var UNAVAILABLE = { code: "server_unavailable", message: "request failed (502)", retryable: false };
  /* AN AUTHZ DENIAL, which is about WHO is asking. The lane must NOT fall back
     on it: the backup asks as a service identity, so a fallback here would
     quietly serve data the viewer was just refused. */
  var DENIED = { code: "needs_reauth", message: "the session is no longer authorised", retryable: false };
  var NOT_CONNECTED = { code: "server_not_connected", message: BACKUP_SERVER + " is not connected", retryable: false };

  /* The org's own envelope, so the page's unwrapper is the real one. Figures
     are deliberately DIFFERENT from anything baked or cached, so the drive can
     tell a live read from a stored one by reading the screen. */
  function envelope(outputValues) {
    return { payload: { content: [{ actionName: "t", errors: null, isSuccess: true, outputValues: outputValues, sortOrder: 0, version: 1 }] } };
  }

  var LIVE = {
    Customer360Snapshot: { accountId: ACCOUNT, name: "Piedmont Precision Components, Inc.", riskRating: "6", totalCommittedExposure: 44400000, totalOutstanding: 33300000 },
    /* ONE ACTIVE FACILITY, because a pane with none renders its honest empty
       state and the drive would then be reading a gap rather than a figure. */
    Customer360Exposure: {
      accountId: ACCOUNT,
      totalCommitted: 44400000,
      totalOutstanding: 33300000,
      totalAvailable: 11100000,
      facilities: [{ loanId: "a4Zbb0000LIVE001", name: "Revolving line of credit", status: "Active", amount: 44400000, outstanding: 33300000, collateral: [] }],
    },
    Customer360RelationshipGraph: { accountId: ACCOUNT, connections: [], legalEntities: [], note: "live" },
    Customer360Covenants: { accountId: ACCOUNT, covenants: [], note: "live" },
    Customer360Opportunities: { accountId: ACCOUNT, opportunities: [], note: "live" },
    Customer360StructuralSignals: { accountId: ACCOUNT, modifications: [], renewals: [], maturityWatch: [], guarantorSignals: [], note: "live" },
    Customer360Portfolio: { accounts: [], bookTotals: { totalCommitted: 44444444, totalOutstanding: 33333333, accountCount: 5, utilizationPct: 75 }, signals: {} },
    Customer360ActionHistory: { accountId: ACCOUNT, count: 0, entries: [] },
    Customer360SearchAccounts: { count: 0, results: [] },
  };

  var sleep = function (ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  };

  /** The backup mirrors by name: gw_Customer360Snapshot is Customer360Snapshot. */
  function unprefixed(tool) {
    return tool.indexOf("gw_") === 0 ? tool.slice(3) : tool;
  }

  /* EVERY ANSWER PAYS THE RELAY, AND SO DOES EVERY REFUSAL. A 502 comes back
     over the same hop a figure does, so a stub that refused instantly would
     make the retry ladder look free and flatter every fallback measurement. */
  function relay() { return sleep(window.__LANES.relayMs || 0); }

  function settle(server, tool, ok) {
    window.__LANES.settled.push({ server: server, tool: tool, at: Date.now(), ok: ok });
  }

  function answer(server, tool, input) {
    var L = window.__LANES;
    var backup = server === BACKUP_SERVER;
    var mode = backup ? (L.backupMode || "ok") : L.mode;
    L.attempts[tool] = (L.attempts[tool] || 0) + 1;
    L.calls.push({ server: server, tool: tool, at: Date.now(), n: L.attempts[tool], mode: mode });

    var refuse = function (err) {
      return relay().then(function () { settle(server, tool, false); return Promise.reject(err); });
    };
    var give = function (body) {
      return relay().then(function () { settle(server, tool, true); return body; });
    };

    // A connector the viewer never added is not a connector that is down. No
    // relay is paid: the runtime refuses this one without leaving the page.
    if (backup && L.backup === "absent") { settle(server, tool, false); return Promise.reject(NOT_CONNECTED); }
    // One named lane, shut on both doors, neither answering nor refusing.
    if ((L.hangTools || []).indexOf(unprefixed(tool)) !== -1) return new Promise(function () {});
    if (mode === "denied") return refuse(DENIED);
    if (mode === "down") return refuse(UNAVAILABLE);
    if (mode === "failTwice" && L.attempts[tool] <= 2) return refuse(UNAVAILABLE);
    // NEVER SETTLES. Not an error and not an answer: the shape a sweep with no
    // wall clock of its own hangs on forever.
    if (mode === "hang") return new Promise(function () {});

    // The backup's own health tool carries no Salesforce data.
    if (tool === "gw_health") {
      return give({ payload: { ok: true, orgReachable: true, orgError: null, checkedAt: new Date().toISOString() } });
    }

    /* THE STAGED PLAN, so a probe can time the room's one write-path round
       trip. The shape is the one lib/stub-connector.js already answers with;
       nothing here executes and nothing here is a figure the room may print. */
    if (/^stage_/.test(tool)) {
      var one = (((input || {}).inputs || [])[0]) || {};
      return give(envelope({
        ok: true,
        result: {
          stagingId: "a5Sbb0000001PROBE",
          planHash: "9c41e08bf27a4d10",
          decisionToken: "4f8ac21e-probe-token",
          summary: "Probe plan.",
          steps: [{ id: "w1", type: "write", label: "Apply the commitment", objectName: "LLC_BI__Loan__c" },
                  { id: "v1", type: "verification", label: "Re-query the clone", dependsOn: ["w1"] }],
          warnings: [],
          accountId: one.accountId,
          productPackageId: one.productPackageId,
          facilities: (one.facilities || []).map(function (f, i) {
            return { facilityId: f.facilityId || ("a4Zbb000002" + i), loanId: f.loanId || ("a4Zbb000002" + i), requestedAmount: f.requestedAmount };
          }),
          facilityCount: (one.facilities || []).length,
        },
      }));
    }

    var body = LIVE[unprefixed(tool)];
    var extra = (L.livePatch || {})[unprefixed(tool)];
    if (body && extra) body = Object.assign({}, body, extra);
    var wait = mode === "slow" ? (L.latencyMs || 3000) : 0;
    return sleep(wait).then(function () { return give(body ? envelope(body) : { payload: {} }); });
  }

  var mcp = {
    callTool: function (server, tool, input) {
      return answer(server, tool, input);
    },
    watchTool: function (server, tool, input, handler) {
      var stopped = false;
      answer(server, tool, input).then(
        function (r) { if (!stopped) handler({ type: "data", result: r }); },
        function (e) { if (!stopped) handler({ type: "error", error: e }); },
      );
      return function () { stopped = true; };
    },
    listTools: function () {
      var servers = [
        { server: "Customer 360", authStatus: "connected", tools: [] },
        { server: "IDB Gateway", authStatus: "connected", tools: [] },
      ];
      if (window.__LANES.backup !== "absent") {
        servers.splice(1, 0, { server: BACKUP_SERVER, authStatus: "connected", tools: [] });
      }
      return Promise.resolve({ servers: servers });
    },
    invalidate: function () { return Promise.resolve(); },
  };

  /* ------------------------------------------------------------------ db */

  var docs = {};
  window.__LANES.seed = function (path, body) { docs[path] = body; };
  window.__LANES.dump = function () { return JSON.parse(JSON.stringify(docs)); };

  /* EVERY BODY THE PAGE ACTUALLY SENT. The drive's firewall check reads this:
     what reaches here is what would have gone to claude.ai over the wire, so a
     document carrying an XSS signature here is a request the founder's own web
     application firewall could block him for (2026-09-06). Writes the door
     refuses never arrive, which is the point of scanning the arrivals. */
  window.__LANES.writes = [];
  function record(path, data) {
    var json;
    try { json = JSON.stringify(data); } catch (e) { json = "[unserialisable]"; }
    window.__LANES.writes.push({ path: path, json: json });
  }

  function segments(p) { return p.split("/").filter(Boolean); }

  function snapOf(path) {
    var body = docs[path];
    return {
      id: segments(path).slice(-1)[0] || "",
      exists: body !== undefined,
      data: function () { return body === undefined ? undefined : JSON.parse(JSON.stringify(body)); },
      metadata: { fromCache: false, hasPendingWrites: false },
    };
  }

  function docRef(path) {
    return {
      id: segments(path).slice(-1)[0],
      path: path,
      get: function () { return Promise.resolve(snapOf(path)); },
      set: function (data) { record(path, data); docs[path] = JSON.parse(JSON.stringify(data)); return Promise.resolve(); },
      update: function (data) { record(path, data); docs[path] = Object.assign({}, docs[path] || {}, data); return Promise.resolve(); },
      delete: function () { delete docs[path]; return Promise.resolve(); },
    };
  }

  function children(collection) {
    var out = [];
    var depth = segments(collection).length + 1;
    Object.keys(docs).forEach(function (path) {
      var s = segments(path);
      if (s.length === depth && path.indexOf(collection + "/") === 0) out.push(snapOf(path));
    });
    return out;
  }

  function query(collection) {
    var self = {
      where: function () { return self; },
      orderBy: function () { return self; },
      limit: function () { return self; },
      get: function () { return Promise.resolve({ docs: children(collection), size: children(collection).length, empty: !children(collection).length }); },
      onSnapshot: function (next) { next({ docs: children(collection) }); return function () {}; },
    };
    return self;
  }

  var db = {
    doc: function (path) { return docRef(path); },
    collection: function (path) {
      var q = query(path);
      q.path = path;
      q.doc = function (id) { return docRef(path + "/" + id); };
      return q;
    },
  };

  window.claude = window.claude || {};
  window.claude.use = function (name) {
    if (name === "mcp") return Promise.resolve(mcp);
    if (name === "db") return Promise.resolve(db);
    return Promise.resolve(null);
  };
})();
