/* PROBE HARNESS ONLY. THE GREETING v2 STAND-IN.

   A SEPARATE FILE FROM lib/stub-connector.js ON PURPOSE. Every other shot in
   this directory stands on that stub and its bytes are not this build's to
   move. This one adds the two doors the greeting needs, leaves that one alone,
   and is never bundled: the artifact's own build fails closed on simulation
   markers, and the app itself still refuses to simulate.

   IT SUPPLIES TWO THINGS.

   1. window.claude.mcp, whose outlook_email_search answers the OBSERVED LIVE
      SHAPE (a BARE SINGLE OBJECT, `sender` a plain address string, the body
      under `summary`), on a per-run shape and delay; and stage_/execute_
      THROWING, because nothing in this drive may reach a write path.

   2. window.claude.use("sample"), a session door that RECORDS every prompt it
      is handed and answers in the v2 grammar, quoting two covenant names and
      one facility label READ OUT OF THE CONTEXT JSON it was just given. It is
      not a model: it is the smallest thing that proves the ROOM renders the
      grammar, and its closing line is composed from the envelope's own route
      and mail so the route-neutrality rule can be seen rather than trusted.
      What a real model actually writes is what --live is for.

   Config: window.__DRIVE = { mail, delayMs, label }. Set by an init script
   BEFORE this file runs. */
(function () {
  var CFG = window.__DRIVE || {};
  var T0 = performance.now();
  var since = function () {
    return Math.round(performance.now() - T0);
  };

  /* WHAT THE DRIVE READS BACK. Prompts verbatim, and a timeline, so the
     greeting's moment can be compared with the lookup beat's rather than
     guessed at from a screenshot. */
  window.__DRIVE_OUT = { prompts: [], marks: [], errors: [], mailCalls: 0 };
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

  /* THE LOOKUP BEAT. The room drops its load chip the moment the package is
     looked up, which is the beat the greeting is supposed to land on. */
  var watchLookup = function () {
    var seen = false;
    var obs = new MutationObserver(function () {
      var chip = document.querySelector(".wk-loadchip");
      if (chip) {
        if (!seen) {
          seen = true;
          mark("lookup-chip-in");
        }
        return;
      }
      if (seen) {
        obs.disconnect();
        mark("lookup-landed");
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchLookup);
  else watchLookup();

  /* ------------------------------------------------------------ the mailbox */

  var mailPayload = function () {
    // The bare single object the live tool actually answers with. Not an array,
    // not a `value` wrapper: that is the 2026-07-27 defect unwrapMail handles.
    return CFG.mail || {};
  };

  var CLARIFY = {
    type: "clarify",
    text: "Which line do you mean? The relationship carries two.",
    options: [
      { label: "Revolving line, $15.0MM", say: "the revolving line of credit" },
      { label: "Seasonal line, $2.5MM", say: "the seasonal line of credit" },
    ],
  };

  window.claude = window.claude || {};
  window.claude.mcp = {
    callTool: function (server, tool) {
      if (/^(stage|execute)_/.test(tool)) {
        // NOTHING IN THIS DRIVE REACHES A WRITE PATH, and a stub that quietly
        // succeeded would hide a room that tried.
        return Promise.reject(new Error("probe: write tools are closed in the greeting drive"));
      }
      if (tool === "outlook_email_search") {
        window.__DRIVE_OUT.mailCalls += 1;
        mark("mail-called");
        return new Promise(function (resolve) {
          setTimeout(function () {
            mark("mail-answered");
            resolve({ payload: mailPayload() });
          }, CFG.delayMs || 0);
        });
      }
      return Promise.resolve({ payload: { content: [{ isSuccess: true, outputValues: { ok: true, result: {} } }] } });
    },
    watchTool: function () {
      return function () {};
    },
    listTools: function () {
      return Promise.resolve({ servers: [{ server: "Microsoft 365", authStatus: "connected", tools: [] }] });
    },
    invalidate: function () {
      return Promise.resolve();
    },
  };

  /* ------------------------------------------------------- the session door */

  var envelopeOf = function (prompt) {
    var i = prompt.lastIndexOf("\nCONTEXT:\n");
    if (i < 0) return null;
    try {
      return JSON.parse(prompt.slice(i + "\nCONTEXT:\n".length));
    } catch (e) {
      return null;
    }
  };

  /** Two real covenant names and one real facility label, out of the book the
   *  room just handed over. A name this stub could not copy verbatim would
   *  render as a value-less row, which would be a stub bug read as a feature. */
  var remarkFor = function (prompt) {
    var env = envelopeOf(prompt) || {};
    var covs = ((env.reads || {}).covenants || []).map(function (c) {
      return c.name;
    });
    var facs = (env.facilities || []).map(function (f) {
      return f.label;
    });
    var mail = env.mail;
    var open = env.routeOpen === true;
    var late = /message arrived AFTER the room greeted/.test(prompt);

    var lead = late
      ? "One more thing, on the message that has just come in."
      : "Hartwell's package sits clean across six facilities, nothing staged yet.";

    var rows = [];
    if (late) {
      if (facs[2]) rows.push("- **" + facs[2] + "**: the facility the note names.");
    } else {
      if (mail && mail.route === "renew" && facs[2]) {
        rows.push("- **" + facs[2] + "**: the facility the note names, and the one a renewal re-cuts.");
        if (covs[1]) rows.push("- **" + covs[1] + "**: the test a renewal is priced against.");
      } else if (mail && mail.route === "modify" && facs[0]) {
        rows.push("- **" + facs[0] + "**: the line the sender asked about, nothing staged toward it.");
        if (covs[1]) rows.push("- **" + covs[1] + "**: the test a bigger line moves first.");
      } else {
        if (covs[1]) rows.push("- **" + covs[1] + "**: the widest ratio cushion on the deal.");
        if (covs[2]) rows.push("- **" + covs[2] + "**: room before the covenant binds, either way.");
        if (!mail && facs[0]) rows.push("- **" + facs[0] + "**: the largest facility on the package.");
        if (mail && covs[0]) rows.push("- **" + covs[0] + "**: tested monthly, and the one test with no room left.");
      }
    }

    /* THE CLOSING LINE IS COMPOSED FROM THE ENVELOPE, not written by a model.
       That is the point of the stub run: the route-neutrality rule and the
       "offer the route the mail names" rule can be SEEN. */
    var who = (mail && mail.from) || "the client";
    var when = mail && mail.received ? " on " + mail.received : "";
    var close;
    if (late) close = "Open the renewal, or say what you want to do with it.";
    else if (open && mail && mail.route === "renew")
      close = who + " asked" + when + " to renew the equipment loan; open the renewal?";
    else if (open && mail && mail.route === "modify")
      close = "That reads as a modification. Open it, or renew or structure something new instead?";
    else if (open && mail)
      close = who + " wrote" + when + ", and it asks nothing of the credit. Modify, renew, or structure something new?";
    else if (open) close = "Modify, renew, or structure something new?";
    else close = "Say what you want to change and I will read it back.";

    return [lead].concat(rows).concat([close]).join("\n");
  };

  var sample = function (prompt, options) {
    var kind = /The room has just OPENED/.test(prompt)
      ? "greeting"
      : /message arrived AFTER the room greeted/.test(prompt)
        ? "mail"
        : "narrate";
    window.__DRIVE_OUT.prompts.push({ kind: kind, at: since(), text: prompt });
    mark("sample:" + kind);
    var text = remarkFor(prompt);
    if (options && typeof options.onText === "function") options.onText({ text: text, delta: text });
    return Promise.resolve({ text: text, truncated: false, modelTierApplied: "quick" });
  };

  var priorUse = typeof window.claude.use === "function" ? window.claude.use.bind(window.claude) : null;
  window.claude.use = function (name) {
    if (name === "sample") return Promise.resolve(sample);
    if (name === "mcp") return Promise.resolve(window.claude.mcp);
    return priorUse ? priorUse(name) : Promise.resolve(null);
  };
})();
