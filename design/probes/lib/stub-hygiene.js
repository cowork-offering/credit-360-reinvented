/* PROBE HARNESS ONLY. THE THREAD HYGIENE STAND-IN.

   A SEPARATE FILE, for the same reason stub-greeting.js is one: the other
   shots' stub is not this build's to move. This one supplies the three doors
   the hygiene drive needs and nothing else. It is never bundled - the
   artifact's own build fails closed on simulation markers, and the app itself
   still refuses to simulate.

   1. window.claude.mcp        outlook_email_search answers nothing (this drive
                               is about the thread, not the mailbox);
                               stage_/execute_ THROW, because nothing here may
                               reach a write path.
   2. window.claude.use("db")  a fake store holding ONE pending intent with four
                               lines, so the intent lane, the feed and the fed
                               marker are exercised end to end.
   3. window.claude.use("sample")  a session door that RECORDS every prompt and
                               answers in the v2 grammar, streaming its answer
                               in BURSTS - four words, a stall, the rest - which
                               is what the pacer exists to smooth.

   Config: window.__DRIVE = { intent: bool }. Set by an init script before this
   file runs. */
(function () {
  var CFG = window.__DRIVE || {};
  var T0 = performance.now();
  var since = function () {
    return Math.round(performance.now() - T0);
  };

  window.__DRIVE_OUT = { prompts: [], errors: [], frames: [], marks: [] };
  var mark = function (what) {
    window.__DRIVE_OUT.marks.push({ what: what, at: since() });
  };
  mark("init");

  window.addEventListener("error", function (e) {
    window.__DRIVE_OUT.errors.push(String((e && e.message) || e));
  });
  window.addEventListener("unhandledrejection", function (e) {
    window.__DRIVE_OUT.errors.push("unhandled: " + String((e && e.reason && e.reason.message) || (e && e.reason)));
  });

  /* ------------------------------------------------------- the frame counter

     A rAF loop that records inter-frame gaps, so the drive can say what the
     pane actually held while the remark streamed rather than asserting it. */
  var lastT = 0;
  var tick = function (t) {
    if (lastT) window.__DRIVE_OUT.frames.push(Math.round((t - lastT) * 100) / 100);
    lastT = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  /* ------------------------------------------------------- the release trace

     WHAT THE GLASS ACTUALLY DID while a remark streamed. The frame counter
     above is honest about the harness and dishonest about the app - headless
     Chrome throttles rAF hard - so the smoothness that MATTERS is measured
     where it shows: how many distinct lengths the remark's own text passed
     through, and the largest single jump. A pacer that worked releases many
     small steps; the one this replaced released two, and the second was a
     paragraph. */
  window.__DRIVE_OUT.releases = [];
  var lastLen = -1;
  setInterval(function () {
    var bub = document.querySelector(".wk-narr .wk-bub");
    var len = bub ? (bub.textContent || "").length : 0;
    if (len !== lastLen) {
      window.__DRIVE_OUT.releases.push({ at: since(), len: len });
      lastLen = len;
    }
  }, 16);

  /* ------------------------------------------------------------ the intent */

  var INTENT = {
    accountId: "001bb00001I7FPNAA3",
    accountName: "Hartwell Precision Manufacturing LLC",
    room: "facility",
    route: "modify",
    lines: [
      "increase the 15M line of credit to 20M",
      "move the construction loan maturity to 2029-06-30",
      "move the 2.5M line of credit rate to 7.25%",
      "add a 1% origination fee to the 15M line of credit",
    ],
    context: {
      summary:
        "James Hartwell asked to take the revolver to $20M, move the construction maturity out a year, reprice the seasonal line and add an origination fee.",
      source: { kind: "meeting", id: "mtg-1", subject: "Hartwell quarterly", from: "james@hartwellprecision.com", received: "3 Sep 2026" }
    },
    createdAt: "2026-09-03T07:00:00.000Z",
    status: "pending",
  };

  /** The smallest thing shaped like the platform's db namespace. */
  function makeDb() {
    var docs = CFG.intent ? [{ id: "01J8ZQ5K9T2M4XQ7YB3C1", exists: true, data: function () { return INTENT; } }] : [];
    var query = {
      where: function () { return query; },
      orderBy: function () { return query; },
      limit: function () { return query; },
      get: function () { return Promise.resolve({ docs: docs, size: docs.length, empty: !docs.length }); },
      onSnapshot: function (next) {
        setTimeout(function () { next({ docs: docs, size: docs.length, empty: !docs.length }); }, 60);
        return function () {};
      },
      path: "intents",
      doc: function (id) {
        return {
          id: id || "x",
          path: "intents/" + (id || "x"),
          get: function () { return Promise.resolve({ id: id, exists: false, data: function () { return undefined; } }); },
          set: function () { return Promise.resolve(); },
          update: function () { return Promise.resolve(); },
          delete: function () { return Promise.resolve(); },
        };
      },
    };
    return {
      doc: function (path) { return query.doc(path.split("/").pop()); },
      collection: function () { return query; },
    };
  }

  /* ------------------------------------------------------------- the model

     The v2 grammar, quoting names out of the CONTEXT JSON it was handed, and
     STREAMED IN BURSTS: four words, a four-hundred-millisecond stall, then the
     rest at once. That is what a model actually does and what the pacer is
     built to smooth. */
  function answerFor(prompt) {
    var env = null;
    var i = prompt.lastIndexOf("\nCONTEXT:\n");
    if (i >= 0) { try { env = JSON.parse(prompt.slice(i + 10)); } catch (e) { env = null; } }
    var greeting = /The room has just OPENED/.test(prompt);
    if (greeting) {
      var reads = (env && env.reads) || {};
      var covs = (reads.covenants || []).slice(0, 3);
      var lead = "Hartwell's package sits clean across its facilities, nothing staged yet.";
      var rows = covs.map(function (c) {
        return "- **" + (c.name || c.label || "Covenant") + "**: worth a look before anything moves.";
      });
      return [lead].concat(rows).concat(["Modify, renew, or structure something new?"]).join("\n");
    }
    /* WITH ROWS, when the drive asks for them: the founder's own complaint was
       that the "nice bullet listing" got kicked out, so the clip needs a remark
       that has one. The first sentence is one the CLAIM GUARD will strip, which
       is what made the bubble grow and then shrink. */
    if (CFG.rows) {
      return [
        "The banker moved the first payment date forward two months to Oct 1, 2026.",
        "The pledged pool does not move with the commitment as it grows.",
        "- **Debt Service Coverage of Borrower**: the widest cushion on the deal.",
        "- **Maximum Debt to Worth**: room before it binds either way.",
        "- **Accounts Receivable**: exactly on its ceiling, and tested monthly.",
      ].join("\n");
    }
    return "The pledged pool does not move with the commitment, so the cover behind this facility thins as it grows.";
  }

  var claude = {
    mcp: {
      callTool: function (server, tool) {
        if (/^(stage_|execute_)/.test(tool || "")) throw new Error("the hygiene drive never writes");
        return Promise.resolve({ payload: {} });
      },
    },
    use: function (name) {
      if (name === "db") return Promise.resolve(makeDb());
      if (name !== "sample") return Promise.resolve(null);
      return Promise.resolve(function (input, options) {
        var kind = (options && options.kind) || "narrate";
        window.__DRIVE_OUT.prompts.push({ kind: kind, at: since(), text: input });
        var text = answerFor(input);
        var onText = options && options.onText;
        return new Promise(function (resolve) {
          if (!onText) { setTimeout(function () { resolve({ text: text, truncated: false, modelTierApplied: "quick" }); }, 300); return; }
          var words = text.split(/(\s+)/);
          var burst = words.slice(0, 9).join("");
          setTimeout(function () { onText({ text: burst, delta: burst }); }, 120);
          setTimeout(function () { onText({ text: text, delta: text.slice(burst.length) }); }, 620);
          setTimeout(function () { resolve({ text: text, truncated: false, modelTierApplied: "quick" }); }, 700);
        });
      });
    },
  };

  window.claude = claude;
  mark("stub-ready");
})();
