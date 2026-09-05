/* PROBE HARNESS ONLY: THE FAULT INJECTOR.

   `stub-connector.js` supplies an org that always answers. This supplies one
   that answers the way a real connector answers on a bad afternoon: it hangs,
   it is slow, it refuses with a code, it fails twice and then works, it comes
   back malformed, and it hands the same version id back to a second execute.
   The session door gets the same treatment: hang before a token, hang mid
   stream, abort, and return prose the parser cannot read.

   NOTHING HERE SHIPS. It is never bundled, the artifact's own build fails
   closed on simulation markers, and the app itself still refuses to simulate:
   with no connector the room says so and burns nothing. What this exists for
   is the OTHER half of that doctrine, which no fixture can reach: what the
   room does when the connector is there and does not answer.

   CONFIGURED FROM OUTSIDE. `window.__CHAOS` is written by an earlier init
   script, so a scenario is data the runner passes rather than a build of this
   file. Shape:

     { rules: [{ match: "^execute_", mode: "hang" }, ...],
       sample: "ok" | "hang" | "hang-mid-stream" | "abort" | "garbage" }

   Modes, one per rule, first match wins:
     ok            the ordinary payload
     hang          the promise never settles
     slow:N        the ordinary payload, N ms late
     error:CODE    rejects {code, message, retryable per the code}
     flaky:N       rejects N times, then answers
     garbage       resolves with a payload of the wrong shape
     duplicate     execute answers, and answers the SAME version id again      */
(function () {
  "use strict";
  var CFG = window.__CHAOS || { rules: [], sample: "ok" };
  var counts = {};

  /* ------------------------------------------------------------ the payloads */

  var HASH = "9c41e08bf27a4d10";
  var VERSION = "a5Fbb000000J61hEAC";

  var ok = function (result) {
    return { payload: { content: [{ isSuccess: true, outputValues: { ok: true, result: result } }] } };
  };

  function stagePayload(input) {
    var one = (((input || {}).inputs || [])[0]) || {};
    return ok({
      stagingId: "a5Sbb0000001PROBE",
      planHash: HASH,
      decisionToken: "4f8ac21e-probe-token",
      summary: "Probe plan.",
      steps: [
        { id: "w1", type: "write", label: "Apply the commitment", objectName: "LLC_BI__Loan__c" },
        { id: "v1", type: "verification", label: "Re-query the clone", dependsOn: ["w1"] }
      ],
      warnings: [],
      accountId: one.accountId,
      productPackageId: one.productPackageId,
      facilities: (one.facilities || []).map(function (f, i) {
        return { facilityId: f.facilityId || ("a4Zbb000002" + i), loanId: f.loanId || ("a4Zbb000002" + i), requestedAmount: f.requestedAmount };
      }),
      facilityCount: (one.facilities || []).length
    });
  }

  function executePayload(input) {
    return ok({
      stagingId: "a5Sbb0000001PROBE",
      terminalState: "completed",
      outcome: "completed",
      cloneLoanId: "a4Zbb0000027NpMEAU",
      outputPackageId: VERSION,
      bookingHandoff: "Booking runs through nCino's own Submit for Approval; this does not book the facility.",
      approvalChainStarted: true,
      facilities: ((((input || {}).inputs || [])[0] || {}).facilities || []).map(function (f, i) {
        return { facilityId: f.facilityId || ("a4Zbb000002" + i), loanId: "a4Zbb0000027NpMEAU", cloneLoanId: "a4Zbb0000027NpMEAU", status: "Qualification" };
      }),
      facilityCount: 1
    });
  }

  /* THE STAGING RECORD THE SETTLE PATH READS. A run the room could not see the
     answer to is a run the ORG still knows about, and `awaitFiling` polls this.
     `window.__CHAOS_TRAIL` is what it says: "Executing" while a scenario wants
     the room still waiting, "Completed" once it should settle. */
  function historyPayload() {
    var status = window.__CHAOS_TRAIL || "Completed";
    return ok({
      rows: [{ stagingId: "a5Sbb0000001PROBE", status: status, actionId: "loan_modification" }],
      count: 1
    });
  }

  function llmPayload(input) {
    var prompt = String((input || {}).prompt || "");
    var line = "";
    try { line = (JSON.parse(prompt.slice(prompt.indexOf("{"))) || {}).line || ""; } catch (e) { line = prompt; }
    var reply = {
      type: "clarify",
      text: "Which line do you mean? The relationship carries two.",
      options: [
        { label: "Revolving line, $15.0MM", say: "the revolving line of credit" },
        { label: "Seasonal line, $2.5MM", say: "the seasonal line of credit" }
      ]
    };
    void line;
    return { payload: { statusCode: 200, body: JSON.stringify({ response: JSON.stringify(reply) }) } };
  }

  function goodFor(tool, input) {
    if (/^stage_/.test(tool)) return stagePayload(input);
    if (/^execute_/.test(tool)) return executePayload(input);
    if (/ActionHistory/.test(tool)) return historyPayload();
    if (/get_llm_response/.test(tool)) return llmPayload(input);
    return ok({});
  }

  /* ---------------------------------------------------------------- the rules */

  function modeFor(tool) {
    for (var i = 0; i < (CFG.rules || []).length; i++) {
      var r = CFG.rules[i];
      try {
        if (new RegExp(r.match).test(tool)) return r.mode;
      } catch (e) { /* a rule that does not compile matches nothing */ }
    }
    return "ok";
  }

  var CODES = {
    tool_error: { message: "The tool raised an error.", retryable: true },
    server_unavailable: { message: "The connector session is not answering (502).", retryable: true, http: 502 },
    not_granted: { message: "This viewer has not granted the connector.", retryable: false },
    rate_limited: { message: "Too many calls. Try again shortly.", retryable: true, retryAfterMs: 800 }
  };

  function refuse(code) {
    var spec = CODES[code] || { message: "Refused.", retryable: false };
    var err = new Error(spec.message);
    err.code = code;
    err.retryable = spec.retryable;
    if (spec.http) err.status = spec.http;
    if (spec.retryAfterMs) err.retryAfterMs = spec.retryAfterMs;
    return err;
  }

  /** A payload that is the RIGHT ENVELOPE and the WRONG SHAPE. This is the
   *  realistic malformation: a connector that answered, with content the
   *  reader cannot make anything of. A bare `null` would be caught by the
   *  envelope unwrapper and prove less. */
  function garbage() {
    return { payload: { content: [{ isSuccess: true, outputValues: { ok: true, result: { rows: "not-an-array", total: {} } } }] } };
  }

  var log = [];
  window.__CHAOS_LOG = log;

  window.claude = window.claude || {};
  window.claude.mcp = {
    callTool: function (server, tool, input) {
      var mode = modeFor(tool);
      counts[tool] = (counts[tool] || 0) + 1;
      log.push({ at: Date.now(), tool: tool, mode: mode, n: counts[tool] });

      if (mode === "hang") return new Promise(function () {});
      if (mode === "garbage") return Promise.resolve(garbage());
      if (mode === "duplicate") {
        // Both executes answer, with the SAME version id: the org replaying a
        // spent idempotency key, which is the shape a second click produces.
        return Promise.resolve(executePayload(input));
      }
      if (/^slow:/.test(mode)) {
        var ms = parseInt(mode.split(":")[1], 10) || 1000;
        return new Promise(function (r) { setTimeout(function () { r(goodFor(tool, input)); }, ms); });
      }
      if (/^error:/.test(mode)) return Promise.reject(refuse(mode.split(":")[1]));
      if (/^flaky:/.test(mode)) {
        var fails = parseInt(mode.split(":")[1], 10) || 1;
        if (counts[tool] <= fails) return Promise.reject(refuse("tool_error"));
        return Promise.resolve(goodFor(tool, input));
      }
      // The ordinary org still takes a moment on a write, so the loader exists.
      if (/^execute_/.test(tool)) {
        return new Promise(function (r) { setTimeout(function () { r(executePayload(input)); }, 900); });
      }
      return Promise.resolve(goodFor(tool, input));
    },
    watchTool: function () { return function () {}; },
    listTools: function () { return Promise.resolve({ servers: [{ server: "Customer 360", authStatus: "connected", tools: [] }] }); },
    invalidate: function () { return Promise.resolve(); }
  };

  /* ------------------------------------------------------------ the session */

  var LOREM = ("The borrower's leverage stands inside policy and the coverage "
    + "cushion is intact at the tested quarter. Working capital is seasonal and "
    + "the revolver carries it; the term facility amortises on schedule.").split(/(\s+)/);

  function sample(input, options) {
    options = options || {};
    var mode = CFG.sample || "ok";
    if (mode === "hang") {
      return new Promise(function (_res, rej) {
        if (options.signal) options.signal.addEventListener("abort", function () { rej({ code: "aborted", message: "aborted", text: "" }); });
      });
    }
    if (mode === "abort") return Promise.reject({ code: "aborted", message: "the door closed", text: "" });
    if (mode === "garbage") {
      return Promise.resolve({ text: "{{{ not json at all", truncated: false, modelTierApplied: options.modelTier || "default" });
    }
    return new Promise(function (resolve, reject) {
      var i = 0, text = "", cancelled = false;
      if (options.signal) {
        options.signal.addEventListener("abort", function () {
          cancelled = true;
          reject({ code: "aborted", message: "aborted", text: text });
        });
      }
      (function burst() {
        if (cancelled) return;
        if (i >= LOREM.length) {
          resolve({ text: text, truncated: false, modelTierApplied: options.modelTier || "default" });
          return;
        }
        // HANG MID STREAM: some words land, then the door goes quiet and never
        // resolves. This is the shape that leaves prose half written on glass.
        if (mode === "hang-mid-stream" && i > 12) return;
        var before = text;
        for (var n = 0; n < 8 && i < LOREM.length; n++, i++) text += LOREM[i];
        if (options.onText) options.onText({ text: text, delta: text.slice(before.length) });
        setTimeout(burst, 40);
      })();
    });
  }
  sample.json = function (input, options) {
    var mode = CFG.sample || "ok";
    if (mode === "hang") return new Promise(function () {});
    if (mode === "garbage") return Promise.reject({ code: "invalid_json", message: "not json", text: "{{{ not json" });
    return Promise.resolve({ type: "clarify", text: "Which line do you mean?", options: [] });
  };

  /* ----------------------------------------------------------------- the db

     A STORE THAT OUTLIVES A RELOAD, which is the whole point of the scenario it
     exists for. localStorage is per origin and the probe serves one origin, so
     a document written before a reload is there after it, exactly as the
     artifact's own db is. Query support is the two operators the cockpit
     actually uses, and nothing more: a fuller fake would only be a second
     opinion about what the platform does. */
  function key(path) { return "chaos-db:" + path; }
  function docRef(path) {
    return {
      id: path.split("/").pop(),
      path: path,
      get: function () {
        var raw = null;
        try { raw = window.localStorage.getItem(key(path)); } catch (e) { raw = null; }
        return Promise.resolve({ id: path.split("/").pop(), exists: raw !== null, data: function () { return raw ? JSON.parse(raw) : undefined; } });
      },
      set: function (data) {
        try { window.localStorage.setItem(key(path), JSON.stringify(data)); } catch (e) { /* full is empty */ }
        return Promise.resolve();
      },
      update: function (patch) {
        var raw = null;
        try { raw = window.localStorage.getItem(key(path)); } catch (e) { raw = null; }
        var next = Object.assign(raw ? JSON.parse(raw) : {}, patch);
        try { window.localStorage.setItem(key(path), JSON.stringify(next)); } catch (e) { /* ignore */ }
        return Promise.resolve();
      },
      delete: function () {
        try { window.localStorage.removeItem(key(path)); } catch (e) { /* ignore */ }
        return Promise.resolve();
      }
    };
  }
  function collectionRef(path) {
    var q = {
      path: path,
      doc: function (id) { return docRef(path + "/" + id); },
      where: function () { return q; },
      orderBy: function () { return q; },
      limit: function () { return q; },
      get: function () { return Promise.resolve({ docs: [], size: 0, empty: true }); },
      onSnapshot: function (next) { next({ docs: [], size: 0, empty: true }); return function () {}; }
    };
    return q;
  }
  var chaosDb = { doc: docRef, collection: collectionRef };
  window.__CHAOS_DB = chaosDb;

  var prior = window.claude.use;
  window.claude.use = function (name) {
    if (name === "sample") return Promise.resolve(CFG.sample === "absent" ? null : sample);
    if (name === "mcp") return Promise.resolve(window.claude.mcp);
    if (name === "db") return Promise.resolve(CFG.db === false ? null : chaosDb);
    if (typeof prior === "function") return prior.call(window.claude, name);
    return Promise.resolve(null);
  };
})();
