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

   THE CONTROL SURFACE is `window.__LANES`, which the drive flips mid-run:
     mode        "ok" | "down" | "failTwice" | "slow"
     latencyMs   how long every answer takes in "slow"
     attempts    per-tool attempt counter, so the drive can count retries

   NOTHING HERE SHIPS. The artifact's own build fails closed on simulation
   markers and this file is never bundled; the app itself still refuses to
   invent a figure. */
(function () {
  var ACCOUNT = "001bb00001DLtRMAA1";

  window.__LANES = { mode: "ok", latencyMs: 0, attempts: {}, calls: [] };
  window.__DRIVE_OUT = { errors: [] };
  window.addEventListener("error", function (e) {
    window.__DRIVE_OUT.errors.push(String((e && e.message) || e));
  });
  window.addEventListener("unhandledrejection", function (e) {
    window.__DRIVE_OUT.errors.push("unhandled: " + String((e && e.reason && e.reason.message) || (e && e.reason)));
  });

  var UNAVAILABLE = { code: "server_unavailable", message: "request failed (502)", retryable: false };

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

  function answer(tool) {
    var L = window.__LANES;
    L.attempts[tool] = (L.attempts[tool] || 0) + 1;
    L.calls.push({ tool: tool, at: Date.now(), n: L.attempts[tool], mode: L.mode });

    if (L.mode === "down") return Promise.reject(UNAVAILABLE);
    if (L.mode === "failTwice" && L.attempts[tool] <= 2) return Promise.reject(UNAVAILABLE);

    var body = LIVE[tool];
    var wait = L.mode === "slow" ? (L.latencyMs || 3000) : 0;
    return sleep(wait).then(function () {
      return body ? envelope(body) : { payload: {} };
    });
  }

  var mcp = {
    callTool: function (_server, tool) {
      return answer(tool);
    },
    watchTool: function (server, tool, input, handler) {
      var stopped = false;
      answer(tool).then(
        function (r) { if (!stopped) handler({ type: "data", result: r }); },
        function (e) { if (!stopped) handler({ type: "error", error: e }); },
      );
      return function () { stopped = true; };
    },
    listTools: function () {
      return Promise.resolve({
        servers: [
          { server: "Customer 360", authStatus: "connected", tools: [] },
          { server: "IDB Gateway", authStatus: "connected", tools: [] },
        ],
      });
    },
    invalidate: function () { return Promise.resolve(); },
  };

  /* ------------------------------------------------------------------ db */

  var docs = {};
  window.__LANES.seed = function (path, body) { docs[path] = body; };
  window.__LANES.dump = function () { return JSON.parse(JSON.stringify(docs)); };

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
      set: function (data) { docs[path] = JSON.parse(JSON.stringify(data)); return Promise.resolve(); },
      update: function (data) { docs[path] = Object.assign({}, docs[path] || {}, data); return Promise.resolve(); },
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
