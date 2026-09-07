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
  /* THE PACKAGE A CREATE OPENS. A new facility creates a new package (founder,
     2026-09-06), so `stage_new_facility` on an ACCOUNT anchor answers with a
     plan whose first step is `create_package` and no package id at all, and the
     execute then names the package it made. Both shapes are the org's own:
     staged live against Hartwell 2026-09-07 (`createsPackage: true`,
     `productPackageId: null`, `plannedPackageName` to the org's convention). */
  var NEW_PACKAGE = "a5Fbb000000NEWPKEAI";
  var NEW_PACKAGE_NAME = "Hartwell Precision Manufacturing LLC - 9/7/2026 - PP";

  /* ---------------------------------------------------- THE BAKED BOOK

     THE STAND-IN ORG HAS TO AGREE WITH THE ARTIFACT IT IS STANDING IN.

     Every `Customer360*` read used to fall through to `ok({})`, and the sync
     sweep patches what a read returns over the baked bundle. An empty payload is
     therefore not "no answer": it is an answer that says the relationship has no
     exposure, no covenants and no facilities, and the workroom that reads it
     finds no package to anchor on and refuses every credit action - which is
     exactly what every facility-room drive in this folder has been measuring.

     So the reads answer from the page's OWN injected book. The stand-in is then
     an org that agrees with the artifact rather than one that contradicts it,
     which is the only kind of stand-in a room's behaviour can be read off.

     Anything not mapped here still falls through to `ok({})`, and that is
     correct for the tools whose absence changes nothing. */
  var BOOK = null;
  function book() {
    if (BOOK) return BOOK;
    /* THE APP'S OWN PARSE FIRST (`data/load.ts` publishes it), the slot second.
       The stand-in must read exactly what the page read, and the window object
       is that by construction. */
    if (window.C360_DATA && typeof window.C360_DATA === "object") { BOOK = window.C360_DATA; return BOOK; }
    try { BOOK = JSON.parse(document.getElementById("c360-data").textContent); } catch (e) { BOOK = null; }
    return BOOK || {};
  }
  /* A READ'S ENVELOPE IS NOT A WRITE'S. `unwrapInvocable` hands the caller the
     WHOLE `outputValues`, and the sweep patches that object straight onto the
     bundle - so a read answered as `{ok:true,result:{...}}` patches THAT over
     the relationship's exposure, and the room then finds a bundle with no
     facilities, no package and nothing it can act on. A read's section goes in
     as `outputValues` itself. */
  function readOk(section) {
    return { payload: { content: [{ isSuccess: true, outputValues: section }] } };
  }
  function baked(tool, input) {
    var d = book();
    if (/Portfolio/.test(tool)) return d.portfolio || null;
    var id = (((input || {}).inputs || [])[0] || {}).accountId;
    var b = ((d.borrowers) || {})[id];
    if (!b) return null;
    if (/Snapshot/.test(tool)) return b.snapshot || null;
    if (/Exposure/.test(tool)) return b.exposure || null;
    if (/Covenants/.test(tool)) return b.covenants || null;
    if (/RelationshipGraph/.test(tool)) return b.graph || null;
    if (/Opportunities/.test(tool)) return b.opportunities || null;
    if (/StructuralSignals/.test(tool)) return b.signals || null;
    return null;
  }


  var ok = function (result) {
    return { payload: { content: [{ isSuccess: true, outputValues: { ok: true, result: result } }] } };
  };

  /** `stage_new_facility` on the ACCOUNT anchor: the plan creates the package
   *  first, and carries no package id because there is not one yet. */
  function newFacilityStagePayload(one) {
    var creates = !one.productPackageId;
    var steps = [
      { id: "write_loan", type: "write", label: "Create the facility at Qualification", objectName: "LLC_BI__Loan__c" },
      { id: "write_involvement", type: "write", label: "Add the borrower to the facility's borrowing structure", objectName: "LLC_BI__Legal_Entities__c" },
      { id: "verify_loan", type: "verification", label: "Read back the facility and report the name the org assigned", objectName: "LLC_BI__Loan__c" },
      { id: "wait_loan_detail", type: "wait", label: "nCino creates the Loan Detail, then this action continues", objectName: "LLC_BI__Loan_Detail__c" },
      { id: "write_loan_purpose", type: "write", label: "Set the primary loan purpose on the Loan Detail", objectName: "LLC_BI__Loan_Detail__c" },
      { id: "hop_to_proposal", type: "write", label: "Move the facility from Qualification to Proposal", objectName: "LLC_BI__Loan__c" }
    ];
    if (creates) {
      steps.unshift({
        id: "create_package",
        type: "write",
        label: "Create the credit package " + NEW_PACKAGE_NAME,
        objectName: "LLC_BI__Product_Package__c"
      });
    }
    return ok({
      stagingId: "a5Sbb0000001PROBE",
      planHash: HASH,
      decisionToken: "4f8ac21e-probe-token",
      summary: creates
        ? "Creates a new credit package for this relationship, named " + NEW_PACKAGE_NAME + " to the org's own convention, then files one facility on it at stage Qualification."
        : "Creates one facility on the package at stage Qualification.",
      steps: steps,
      warnings: [],
      accountId: one.accountId,
      productPackageId: one.productPackageId,
      createsPackage: creates,
      plannedPackageName: creates ? NEW_PACKAGE_NAME : undefined
    });
  }

  function newFacilityExecutePayload(one) {
    var creates = !one.productPackageId;
    return ok({
      stagingId: "a5Sbb0000001PROBE",
      terminalState: "success",
      outcome: "Facility filed and moved to Proposal.",
      resumable: false,
      loanId: "a4Zbb000002NEWFACEAA",
      loanDetailId: "a4Wbb000001NEWDETEAW",
      involvementId: "a4Lbb000000NEWINVEAK",
      productPackageId: creates ? NEW_PACKAGE : one.productPackageId,
      packageCreated: creates,
      stage: "Proposal",
      recordName: "Hartwell Precision Manufacturing LLC - Equipment - $3,000,000.00",
      steps: [
        { id: "create_package", type: "write", label: "Create the credit package", state: "verified", detail: "Package " + NEW_PACKAGE + " created." },
        { id: "write_loan", type: "write", label: "Create the facility", state: "verified", detail: "Facility a4Zbb000002NEWFACEAA created at Qualification." },
        { id: "write_involvement", type: "write", label: "Add the borrower", state: "verified", detail: "Borrower added at 100.00 percent ownership." },
        { id: "verify_loan", type: "verification", label: "Read back the facility", state: "verified", detail: "The org named this facility Hartwell Precision Manufacturing LLC - Equipment - $3,000,000.00." },
        { id: "write_loan_purpose", type: "write", label: "Set the primary loan purpose", state: "verified", detail: "Primary loan purpose set to equipment." },
        { id: "hop_to_proposal", type: "write", label: "Move to Proposal", state: "verified", detail: "Stage moved from Qualification to Proposal." }
      ]
    });
  }

  function stagePayload(input, tool) {
    var one = (((input || {}).inputs || [])[0]) || {};
    if (/new_facility/.test(tool || "")) return newFacilityStagePayload(one);
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

  function executePayload(input, tool) {
    var one = (((input || {}).inputs || [])[0]) || {};
    if (/new_facility/.test(tool || "")) return newFacilityExecutePayload(one);
    void one;
    return ok({
      stagingId: "a5Sbb0000001PROBE",
      terminalState: "completed",
      outcome: "completed",
      cloneLoanId: "a4Zbb0000027NpMEAU",
      outputPackageId: VERSION,
      bookingHandoff: "Booking runs through nCino's own Submit for Approval; this does not book the facility.",
      approvalChainStarted: true,
      facilities: ((((input || {}).inputs || [])[0] || {}).facilities || []).map(function (f, i) {
        /* ONE CLONE PER FACILITY, with an id of its own. The stand-in used to hand
               the SAME clone id back for every facility, which put one record id on
               every row of the filed ledger and read like a mapping defect in the
               room. The room was right; the org was repeating itself. */
            return { facilityId: f.facilityId || ("a4Zbb000002" + i), loanId: "a4Zbb0000027NpM" + i + "AU", cloneLoanId: "a4Zbb0000027NpM" + i + "AU", status: "Qualification" };
      }),
      facilityCount: 1
    });
  }

  /* THE STAGING RECORD THE SETTLE PATH READS. A run the room could not see the
     answer to is a run the ORG still knows about, and `awaitFiling` polls this.
     `window.__CHAOS_TRAIL` is what it says: "Executing" while a scenario wants
     the room still waiting, "Completed" once it should settle. */
  /* THE TRAIL IS A READ, AND ITS KEY IS `entries` (cockpitTools.readActionState).
     It answered as a WRITE under `rows` until 2026-09-06, so every settle poll
     read an undefined list and no filing this harness drove could ever be seen
     to confirm - which is the difference between "the org has not answered" and
     "the org was never asked in a shape it could answer in". */
  function historyPayload() {
    var status = window.__CHAOS_TRAIL || "Completed";
    return readOk({
      entries: [
        {
          stagingId: "a5Sbb0000001PROBE",
          status: status,
          actionId: "loan-modification",
          executedAt: new Date().toISOString(),
          productPackageId: VERSION
        }
      ],
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
    if (/^stage_/.test(tool)) return stagePayload(input, tool);
    if (/^execute_/.test(tool)) return executePayload(input, tool);
    if (/ActionHistory/.test(tool)) return historyPayload();
    if (/get_llm_response/.test(tool)) return llmPayload(input);
    var slice = baked(tool, input);
    if (slice) return readOk(slice);
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
        return Promise.resolve(executePayload(input, tool));
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
        return new Promise(function (r) { setTimeout(function () { r(executePayload(input, tool)); }, 900); });
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
