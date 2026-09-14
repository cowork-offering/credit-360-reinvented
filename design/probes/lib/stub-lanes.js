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
     failNext    THE RELAY DROP (2026-09-13), per UNPREFIXED tool name: how many
                 of the next answers this stub swallows with the relay's own
                 `server_unavailable: request failed (502)` before answering
                 normally again. THE ORG STILL DOES THE WORK. A dropped stage
                 answer still files its staging row, which is exactly the founder
                 502 of 2026-09-13: STG-0000000149 existed in Salesforce while
                 the page said the request had failed. Default {} , so every
                 drive written before it is unchanged.
     staging     THE STAGING LEDGER, fenced on the idempotency key the way
                 C360ActionStaging.stagePlan is: one row per key, a repeat
                 returns that row with `replayed: true` and a NULL decision
                 token, and `staging.calls` carries every stage call so a drive
                 can prove no key ever produced two rows.
     settled     one row per ANSWER, `{ server, tool, at, ok }`, so a probe can
                 time the sixth slice landing without reading the glass
     livePatch    per-tool fields merged over the LIVE body, so a drive that
                 needs one more field (a package id, for a room that will not
                 open without one) does not have to fork this table
     version     THE IN-FLIGHT MODIFICATION VERSION (0.9.23), OFF by default so
                 every drive written before it is unchanged. Set it to
                   { source: "<booked package id>", id: "<version package id>",
                     moved: { loanId: "<parent loan id>", committed: 20000000 } }
                 and the stub's book carries ONE unbooked version of `source`:
                 a clone of EVERY active member of that package at stage
                 Qualification with `isModification` true, the moved facility
                 renamed to its new figure, and a Completed `loan-modification`
                 row on Customer360ActionHistory tying the version to its source.
                 MEMBER FOR MEMBER, and that is not a simplification: nCino's
                 credit action clones the whole package (the org's own verified
                 Hartwell fork of a5Fbb000000IHFJEA4 held seven Qualification
                 loans against seven Booked ones), and `book/packages.ts`
                 recognises a fork by exactly that mirror.
                 The four version tools answer off the same fixture, and the
                 state is PER PAGE: after `execute_discard_version` the exposure
                 and history reads no longer carry the version at all, and after
                 `execute_amend_version` the facilities read carries the new
                 figure.
     boom        THE BOOM UPLOAD LANE (2026-09-12), the stand-in for Noland's
                 read + write Boom MCP server, which does not exist yet:
                   mode          "ok" | "failed", what the file ends as
                   processingMs  how long the file sits at `processing`
                                 (4000 is the floor of the room's own range)
                   files         per-file clock, keyed by Boom file id
                 It answers `boom_upload_statement`, `boom_upload_status`,
                 `boom_create_file_group` and `boom_validation_session` on
                 whichever connector the page addresses them to, which is
                 "IDB Gateway" until `SERVERS.boom` is flipped to the Boom
                 connector's own name. Boom's ladder, unchanged:
                 waiting_for_upload -> processing -> failed | completed.

   NOTHING HERE SHIPS. The artifact's own build fails closed on simulation
   markers and this file is never bundled; the app itself still refuses to
   invent a figure. */
(function () {
  var ACCOUNT = "001bb00001DLtRMAA1";

  var BACKUP_SERVER = "Salesforce Read Backup";

  window.__LANES = { mode: "ok", backupMode: "ok", backup: "granted", hangTools: [], latencyMs: 0, relayMs: 0, attempts: {}, calls: [], settled: [], livePatch: {}, boom: { mode: "ok", processingMs: 4000, files: {} }, version: null, failNext: {}, staging: { seq: 148, byKey: {}, rows: [], calls: [] } };
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

  /** The one `inputs[0]` row a Customer 360 invocable call carries. */
  function firstInput(input) {
    return (((input || {}).inputs || [])[0]) || {};
  }

  /**
   * THE IDEMPOTENCY FENCE, as C360ActionStaging.stagePlan keeps it: the row is
   * looked up by key, a hit is returned as a replay, and a miss files exactly one
   * new row. Nothing here ever files two rows for one key, which is the property
   * a drive asserts after the relay has dropped an answer.
   */
  function stageRow(tool, one) {
    var led = window.__LANES.staging;
    var key = String(one.idempotencyKey || "");
    led.calls.push({ tool: tool, key: key, at: Date.now() });
    if (led.byKey[key]) {
      led.byKey[key].replays += 1;
      return { id: led.byKey[key].id, replayed: true };
    }
    led.seq += 1;
    var id = "STG-" + String(led.seq).padStart(10, "0");
    var row = {
      stagingId: id,
      actionId: tool.replace(/^stage_/, "").replace(/_/g, "-"),
      status: "Staged",
      createdDate: new Date().toISOString(),
      accountId: one.accountId || ACCOUNT,
      productPackageId: one.productPackageId || null,
      planHashPresent: true,
      key: key,
      replays: 0,
      id: id,
    };
    led.byKey[key] = row;
    led.rows.push(row);
    return { id: id, replayed: false };
  }

  /** The trail, carrying whatever this page session has staged. A row filed by a
   *  call whose answer was lost is on it like any other: that is the whole point
   *  of reading the trail after a 502. */
  function withStaged(body) {
    var rows = window.__LANES.staging.rows.map(function (r) {
      return {
        stagingId: r.stagingId, actionId: r.actionId, status: r.status, createdDate: r.createdDate,
        accountId: r.accountId, productPackageId: r.productPackageId, planHashPresent: true,
      };
    });
    if (!rows.length) return body;
    var entries = ((body || {}).entries || []).concat(rows);
    return Object.assign({}, body || {}, { entries: entries, count: entries.length });
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

    /* THE RELAY DROPS THE ANSWER, AND THE ORG DOES THE WORK ANYWAY. This is the
       2026-09-13 shape and not a refusal: the staging row is filed first, under
       the key the payload carries, and only then is the answer swallowed. A stub
       that refused before filing would make the whole recovery path untestable,
       because there would be nothing in the org for the trail to find. */
    var dropping = (L.failNext || {})[unprefixed(tool)];
    if (dropping > 0) {
      L.failNext[unprefixed(tool)] = dropping - 1;
      if (/^stage_/.test(tool) && VERSION_TOOLS.indexOf(tool) === -1) stageRow(tool, firstInput(input));
      return refuse(UNAVAILABLE);
    }
    // NEVER SETTLES. Not an error and not an answer: the shape a sweep with no
    // wall clock of its own hangs on forever.
    if (mode === "hang") return new Promise(function () {});

    // The backup's own health tool carries no Salesforce data.
    if (tool === "gw_health") {
      return give({ payload: { ok: true, orgReachable: true, orgError: null, checkedAt: new Date().toISOString() } });
    }

    /* ------------------------------------------------------------- boom

       THE UPLOAD LANE, standing in for Noland's Boom MCP server. The four tool
       names and the argument names are the ones the cockpit's adapter sends
       (app/src/channel/boomUpload.ts, "THE MAPPING NOLAND'S SERVER AMENDS"), so
       a drive here exercises the wire contract itself and not a paraphrase of
       it. The answers are Boom's own output shapes: a file id and a rung on
       `boom_upload_statement`, the same object with `financialStatements` once
       the file has been processing for `processingMs`.

       IDEMPOTENT, because Boom is: the file id is derived from the sha256 the
       cockpit sends as `externalUniqueId`, so the same bytes twice are one
       file, one clock and one set of periods. NEVER `verified`: verification is
       an analyst's act in Boom's own page and no stub may claim one. */
    if (tool.indexOf("boom_upload") === 0 || tool.indexOf("boom_create") === 0 || tool.indexOf("boom_validation") === 0) {
      return give({ payload: boomAnswer(tool, input || {}) });
    }

    /* ------------------------------------------------- the version lifecycle

       The four 0.9.23 tools, answered off the same fabricated version the
       exposure and history reads carry. The envelope, the `ok` discriminator
       and the field names are the frozen contract's
       (knowledge/SPEC-0.9.23-TOOL-CONTRACT.md), so a drive here exercises the
       wire shape rather than a paraphrase of it. */
    if (VERSION_TOOLS.indexOf(tool) !== -1) {
      var one = (((input || {}).inputs || [])[0]) || {};
      return give(envelope(versionAnswer(tool, one)));
    }

    /* ------------------------------------------ the two relationship reviews

       0.9.24, backlog row 49. `stage_covenant_review` and
       `stage_collateral_valuation` take `accountId` and each planned row comes
       back carrying `associations`, a JSON STRING of
       [{loanId, loanName, productPackageId, packageName}]. The rows are derived
       from the BOOK THIS LANE IS SERVING - the covenants and exposure bodies the
       drive patches in - so a drive here exercises the real junctions rather
       than a table somebody typed. Additive: every other stage tool falls
       through to the generic plan below, unchanged. */
    if (tool === "stage_covenant_review" || tool === "stage_collateral_valuation") {
      var relOne = firstInput(input);
      var relRow = stageRow(tool, relOne);
      return give(envelope({ ok: true, result: reviewAnswer(tool, relOne, relRow) }));
    }

    /* AND THEIR EXECUTES, so a drive can take Confirm the way the banker does.
       Nothing is simulated beyond the tool's own answer shape: one item per row
       the plan carried, with the org's own outcome sentence. */
    if (tool === "execute_covenant_review" || tool === "execute_collateral_valuation") {
      return give(envelope({ ok: true, result: executedReview(tool, firstInput(input)) }));
    }

    /* THE STAGED PLAN, so a probe can time the room's one write-path round
       trip. The shape is the one lib/stub-connector.js already answers with;
       nothing here executes and nothing here is a figure the room may print. */
    if (/^stage_/.test(tool)) {
      var one = firstInput(input);
      var row = stageRow(tool, one);
      return give(envelope({
        ok: true,
        result: {
          /* THE ROW IS THE LEDGER'S, AND A REPLAY CARRIES NO TOKEN. Both come
             straight from C360ActionStaging.stagePlan: a key it has seen returns
             that row with `replayed: true` and a null decisionToken, because
             minting a second single-use token for a plan the banker may already
             have confirmed is the one thing A33.5.4 forbids. */
          stagingId: row.id,
          planHash: "9c41e08bf27a4d10",
          decisionToken: row.replayed ? null : "4f8ac21e-probe-token",
          replayed: row.replayed,
          summary: "Probe plan.",
          /* THE STEP SET MIRRORS THE ORG'S OBJECTS. The page validates every plan
             against its transition allowlist, so a stub plan that omits an object
             the live plan carries lets the drive pass a plan the confirm gate
             refuses on the real host (0.9.25 shipped exactly that: the org's
             `sweep_aggregates` step on the aggregate object was on the live plan
             and not here). Every version-creating tool declares the sweep. */
          steps: [{ id: "w1", type: "write", label: "Apply the commitment", objectName: "LLC_BI__Loan__c" },
                  { id: "v1", type: "verification", label: "Re-query the clone", dependsOn: ["w1"] }]
            .concat(/^stage_(loan_modification|new_facility|amend_version)$/.test(tool)
              ? [{ id: "sweep_aggregates", type: "write", objectName: "LLC_BI__Loan_Collateral_Aggregate__c", fields: ["Id"],
                   label: "Remove any collateral aggregate shell this version creation mints and leaves unlinked, and only those" }]
              : []),
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
    // THE VERSION RIDES OVER THE PATCH, not under it: the drive replaces the
    // whole exposure body with Hartwell's real one, so a fixture merged in
    // first would be thrown away by the very patch it has to extend.
    body = withVersion(unprefixed(tool), body);
    if (unprefixed(tool) === "Customer360ActionHistory") body = withStaged(body);
    var wait = mode === "slow" ? (L.latencyMs || 3000) : 0;
    return sleep(wait).then(function () { return give(body ? envelope(body) : { payload: {} }); });
  }

  /* ------------------------------------------ the two relationship reviews

     THE BOOK THIS LANE IS SERVING, after the drive's own patch. Everything the
     two account-anchored reviews answer with is derived from it: the covenant
     junctions, the pledges hanging off each facility, and the package names,
     composed the way `actions/schemas.ts` composes them so the page's own short
     word for a package matches what this stub sends. */
  function servedBook(name) {
    var body = LIVE[name];
    var extra = (window.__LANES.livePatch || {})[name];
    return extra ? Object.assign({}, body, extra) : body;
  }

  function bookFacilities() {
    return ((servedBook("Customer360Exposure") || {}).facilities) || [];
  }

  /** The deal's headline, derived exactly as the page derives it. */
  function packageNameOf(pkgId) {
    var facilities = bookFacilities();
    var ids = [];
    var anchor = (servedBook("Customer360Snapshot") || {}).productPackageId;
    if (anchor) ids.push(anchor);
    facilities.forEach(function (f) { if (f.productPackageId && ids.indexOf(f.productPackageId) === -1) ids.push(f.productPackageId); });
    var relationship = ((servedBook("Customer360Snapshot") || {}).name || "").trim();
    var base = relationship ? relationship + " credit package" : "Credit package";
    if (ids.length <= 1) return base;
    var on = facilities.filter(function (f) { return f.productPackageId === pkgId; });
    var products = [];
    on.forEach(function (f) { var t = (f.productType || "").trim(); if (t && products.indexOf(t) === -1) products.push(t); });
    if (!products.length) return base;
    return base + " · " + products.slice(0, 2).join(" and ") + (products.length > 2 ? " and " + (products.length - 2) + " more" : "");
  }

  /** One association row, off a facility the book carries. */
  function associationOf(f) {
    return { loanId: f.loanId, loanName: f.name, productPackageId: f.productPackageId, packageName: packageNameOf(f.productPackageId) };
  }

  /** The junctions a covenant carries, as the contract sends them: a STRING. */
  function covenantAssociations(covenantId) {
    var covenants = ((servedBook("Customer360Covenants") || {}).covenants) || [];
    var cov = covenants.filter(function (c) { return c.covenantId === covenantId; })[0];
    var byId = {};
    bookFacilities().forEach(function (f) { if (f.loanId) byId[f.loanId] = f; });
    var rows = ((cov || {}).attachedLoans || []).map(function (j) {
      var f = byId[j.loanId];
      return f ? associationOf(f) : { loanId: j.loanId, loanName: j.loanName, productPackageId: null, packageName: null };
    });
    return JSON.stringify(rows);
  }

  /** The pledges an asset carries, deduplicated by facility. */
  function collateralAssociations(collateralId) {
    var seen = {};
    var rows = [];
    bookFacilities().forEach(function (f) {
      var holds = (f.collateral || []).some(function (c) { return c.collateralId === collateralId; });
      if (!holds || seen[f.loanId]) return;
      seen[f.loanId] = true;
      rows.push(associationOf(f));
    });
    return JSON.stringify(rows);
  }

  function collateralNameOf(collateralId) {
    var found = null;
    bookFacilities().forEach(function (f) {
      (f.collateral || []).forEach(function (c) { if (c.collateralId === collateralId && !found) found = c.collateralName || c.collateralId; });
    });
    return found || collateralId;
  }

  /** The staged plan for one of the two reviews. Anchored on the ACCOUNT the
   *  caller sent; a `productPackageId` is echoed only where the caller chose
   *  one, because the relationship room never sends it. */
  function reviewAnswer(tool, one, row) {
    var covenant = tool === "stage_covenant_review";
    var plan = {
      stagingId: row.id,
      planHash: "9c41e08bf27a4d10",
      decisionToken: row.replayed ? null : "4f8ac21e-probe-token",
      replayed: row.replayed,
      summary: covenant
        ? "Assesses the covenants selected on this relationship."
        : "Files a valuation for each asset selected on this relationship.",
      steps: [{ id: "w1", type: "write", label: covenant ? "Write the assessments" : "File the valuations", objectName: covenant ? "LLC_BI__Covenant_Compliance2__c" : "LLC_BI__Collateral_Valuation__c" },
              { id: "v1", type: "verification", label: "Re-query the records", dependsOn: ["w1"] }],
      warnings: [],
      accountId: one.accountId,
    };
    if (one.productPackageId) plan.productPackageId = one.productPackageId;
    if (covenant) {
      var assessments = one.assessments || [];
      plan.covenants = assessments.map(function (a) {
        return {
          covenantId: a.covenantId,
          covenantName: "COV-" + String(a.covenantId).slice(-6),
          state: "planned",
          assessedStatus: a.status,
          associations: covenantAssociations(a.covenantId),
        };
      });
      plan.assessedCount = plan.covenants.length;
    } else {
      var items = one.items || [];
      plan.items = items.map(function (i) {
        return {
          collateralId: i.collateralId,
          collateralName: collateralNameOf(i.collateralId),
          value: typeof i.value === "number" ? i.value : null,
          associations: collateralAssociations(i.collateralId),
        };
      });
      plan.itemCount = plan.items.length;
    }
    return plan;
  }

  /** The executed run, one item per row the plan carried. */
  function executedReview(tool, one) {
    var covenant = tool === "execute_covenant_review";
    var led = window.__LANES.staging;
    var row = null;
    led.rows.forEach(function (r) { if (r.stagingId === one.stagingId) row = r; });
    var out = {
      stagingId: one.stagingId,
      terminalState: "success",
      outcome: covenant
        ? "The assessments were written and verified."
        : "The valuations were filed and verified.",
      recordName: covenant ? "COMP-0489" : "CV-0000000002",
      accountId: (row || {}).accountId || ACCOUNT,
      steps: [{ id: "w1", type: "write", label: covenant ? "Write the assessments" : "File the valuations", state: "done" },
              { id: "v1", type: "verification", label: "Re-query the records", state: "done" }],
    };
    if (!covenant) out.valuationId = "a34bb00000PROBE01";
    return out;
  }

  /* ----------------------------------------------- the version lifecycle

     ONE IN-FLIGHT MODIFICATION VERSION, built out of whatever book the lane is
     serving. The fixture is not a table of loans: it is DERIVED from the source
     package's own active members at read time, so the version mirrors the book
     the drive patched in, member for member, which is the shape
     `book/packages.ts` recognises as a fork and the shape nCino produces.

     THE STATE IS PER PAGE. `discarded` is what `execute_discard_version` sets,
     and from then on the exposure and the history reads carry no version at
     all: the roster drops it, the source unlocks, and the drive can assert the
     undo landed by reading the page rather than by trusting the tool's reply.
     `amended` is what `execute_amend_version` writes, per version loan, so the
     figures read back changed on the version and unchanged on the parent, and
     `requests` is every version call as the page sent it. */

  var VERSION_TOOLS = ["stage_discard_version", "execute_discard_version", "stage_amend_version", "execute_amend_version"];
  /* `requests` is the wire ledger: every version call with the body the page
     actually sent, so a drive can assert the ARM rather than the prose the room
     printed over it. */
  var vstate = { discarded: false, amended: {}, staged: {}, requests: [] };
  window.__LANES.versionState = vstate;

  /** The version fixture, or null where the drive did not ask for one. */
  function versionSpec() {
    var v = window.__LANES.version;
    if (!v || vstate.discarded) return null;
    return { source: v.source, id: v.id, moved: v.moved || null, name: v.name || null };
  }

  /** The ACTIVE members of the source package, off the body being served.
   *
   *  ACTIVE IS THE APP'S OWN WORD (`data/worklist.ts:isActiveFacility`), and it
   *  read `status !== "Closed"` here until 2026-09-13. That held on Hartwell,
   *  where every member is Open, and broke on the first book carrying a Paid Off
   *  loan (Kingsley): the clone set came back one member LARGER than the
   *  source's active roster, `book/packages.ts:mirrors` refuses a size mismatch,
   *  and the version was therefore never read as a fork at all. nCino clones
   *  what is live. */
  function activeFacility(f) {
    var s = String((f && f.status) || "").trim().toLowerCase();
    return s === "" || s === "active" || s === "open";
  }
  function sourceMembers(body) {
    var spec = versionSpec();
    if (!spec || !body || !body.facilities) return [];
    return body.facilities.filter(function (f) {
      return f.productPackageId === spec.source && activeFacility(f);
    });
  }

  /** MONEY AS THE ORG WRITES IT INTO A LOAN NAME: "$20,000,000.00". */
  function moneyName(n) {
    return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** One clone per active member of the source package. */
  function versionClones(body) {
    var spec = versionSpec();
    if (!spec) return [];
    return sourceMembers(body).map(function (f, i) {
      var id = "a4Zbb00000CLONE" + i;
      var moved = spec.moved && spec.moved.loanId === f.loanId ? spec.moved : null;
      var committed = moved && moved.committed != null ? moved.committed : f.committed;
      var clone = Object.assign({}, f, {
        loanId: id,
        productPackageId: spec.id,
        // The whole point of a version: unbooked, and the banker's until a
        // member reaches Approval / Loan Committee.
        stage: "Qualification",
        status: "Open",
        isModification: true,
        outstanding: 0,
        available: committed,
        committed: committed,
        // The filing RENAMES the facility it moved, which is how the org's own
        // fork of this package reads.
        name: moved && f.name ? f.name.replace(moneyName(f.committed), moneyName(committed)) : f.name,
      });
      var amended = vstate.amended[id];
      if (amended) Object.assign(clone, amended);
      return clone;
    });
  }

  /** The exposure / history body a read should carry once a version exists. */
  function withVersion(tool, body) {
    var spec = versionSpec();
    if (!spec || !body) return body;
    if (tool === "Customer360Exposure") {
      var clones = versionClones(body);
      if (!clones.length) return body;
      var facilities = (body.facilities || []).concat(clones);
      return Object.assign({}, body, {
        facilities: facilities,
        // Customer360Exposure sums every loan it returns, the version's
        // included. The cockpit is what corrects that; the stub must not.
        totalCommitted: facilities.reduce(function (n, f) { return n + (f.committed || 0); }, 0),
        totalOutstanding: facilities.reduce(function (n, f) { return n + (f.outstanding || 0); }, 0),
      });
    }
    if (tool === "Customer360ActionHistory") {
      var entries = (body.entries || []).concat([modificationRow(spec)]);
      return Object.assign({}, body, { entries: entries, count: entries.length });
    }
    return body;
  }

  /* THE TRAIL ROW THAT TIES THE VERSION TO ITS SOURCE. Observed shape: the row
     names the SOURCE package in `productPackageId` and a member of the VERSION
     in `resultRecordId`, never the version package's own id. */
  function modificationRow(spec) {
    return {
      stagingId: "a5Sbb00000MODSTG1",
      actionId: "loan-modification",
      status: "Completed",
      executedAt: "2026-09-12T14:20:00.000Z",
      createdDate: "2026-09-12T14:19:00.000Z",
      approverUserId: "005bb00000ftouDAAQ",
      resultRecordId: "a4Zbb00000CLONE0",
      productPackageId: spec.source,
      summary: "Modification filed against the booked package; the version carries the new figure.",
    };
  }

  /** The inventory `stage_discard_version` discovers by query. */
  function discardInventory(spec, clones) {
    var items = [
      { object: "LLC_BI__LoanRenewal__c", id: "a3Xbb00000CHAIN0", name: "RL-00000198 revision 0", reason: "the self-anchor row on the booked parent" },
      { object: "LLC_BI__LoanRenewal__c", id: "a3Xbb00000CHAIN1", name: "RL-00000199 revision 1", reason: "points the booked parent at the clone" },
      { object: "LLC_BI__Loan_Collateral2__c", id: "a3Ybb00000PLDGE0", name: "Pledge copied onto the version", reason: "a copy of the parent pledge; the asset and its ownership row stay" },
      { object: "LLC_BI__Loan_Covenant__c", id: "a3Zbb00000JUNCT0", name: "Minimum Debt Service Coverage junction", reason: "a copy of the parent junction; the covenant record stays" },
      { object: "LLC_BI__Pricing_Stream__c", id: "a40bb00000STREM0", name: "Pricing stream on the version", reason: "cloned by the nCino pricing engine" },
    ];
    clones.forEach(function (c) {
      items.push({ object: "LLC_BI__Loan__c", id: c.loanId, name: c.name, reason: "a modification clone at Qualification" });
    });
    /* The clones' rollup anchors, frozen at stage time (0.9.25): the live inventory
       names them after the facilities and before the package, and the page's
       discard fence has to accept the object or the confirm gate refuses. */
    clones.forEach(function (c, i) {
      items.push({ object: "LLC_BI__Loan_Collateral_Aggregate__c", id: "a4Sbb00000AGGSH" + i, name: "Collateral aggregate on " + c.name, reason: "the clone's own rollup anchor; nCino usually takes it with the facility" });
    });
    items.push({ object: "LLC_BI__Product_Package__c", id: spec.id, name: spec.name || "the version package", reason: "the version package itself" });
    items.push({ object: "cm_Action_Staging__c", id: "a5Sbb00000MODSTG1", name: "Staging a5Sbb00000MODSTG1", reason: "kept as the audit and marked Withdrawn" });
    return items;
  }

  function versionAnswer(tool, input) {
    vstate.requests.push({ tool: tool, input: input });
    var spec = versionSpec();
    if (!spec) {
      return { ok: false, error: { code: "NOT_A_VERSION", message: "No unbooked version resolves from that id." } };
    }
    var body = withVersion("Customer360Exposure", Object.assign({}, LIVE.Customer360Exposure, (window.__LANES.livePatch || {}).Customer360Exposure));
    var clones = (body.facilities || []).filter(function (f) { return f.productPackageId === spec.id; });

    if (tool === "stage_discard_version") {
      if (input.versionPackageId && input.versionPackageId !== spec.id) {
        return { ok: false, error: { code: "NOT_A_VERSION", message: "That package is not an unbooked version." } };
      }
      var items = discardInventory(spec, clones);
      return {
        ok: true,
        result: {
          stagingId: "a5Sbb00000DISCRD1",
          planHash: "a1b2c3d4e5f60718",
          decisionToken: "discard-probe-token",
          productPackageId: spec.id,
          summary: "Removes the unbooked version and its copies. The booked package is untouched.",
          steps: [
            { id: "d1", type: "write", label: "Delete the version chain rows", objectName: "LLC_BI__LoanRenewal__c" },
            { id: "d2", type: "write", label: "Delete the copied pledges, junctions and pricing", objectName: "LLC_BI__Loan_Collateral2__c" },
            { id: "d3", type: "write", label: "Delete the clone facilities", objectName: "LLC_BI__Loan__c" },
            { id: "d4", type: "write", label: "Delete the version package", objectName: "LLC_BI__Product_Package__c" },
            { id: "d5", type: "write", label: "Mark the staging rows Withdrawn", objectName: "cm_Action_Staging__c" },
            { id: "v1", type: "verification", label: "Re-query every booked parent for hasRenewal false", dependsOn: ["d3"] },
          ],
          warnings: [],
          items: items,
          itemCount: items.length,
        },
      };
    }

    if (tool === "execute_discard_version") {
      var gone = discardInventory(spec, clones);
      vstate.discarded = true;
      return {
        ok: true,
        result: {
          stagingId: "a5Sbb00000DISCRD1",
          terminalState: "success",
          outcome: "The version package and its members were deleted; every booked parent reads hasRenewal false.",
          sourcePackageId: spec.source,
          items: gone,
          steps: [
            { id: "d1", type: "write", label: "Delete the version chain rows", state: "verified" },
            { id: "d2", type: "write", label: "Delete the copied pledges, junctions and pricing", state: "verified" },
            { id: "d3", type: "write", label: "Delete the clone facilities", state: "verified" },
            { id: "d4", type: "write", label: "Delete the version package", state: "verified" },
            { id: "d5", type: "write", label: "Mark the staging rows Withdrawn", state: "verified" },
            { id: "v1", type: "verification", label: "Re-query every booked parent for hasRenewal false", state: "verified" },
          ],
        },
      };
    }

    /* AMEND: the arms echo back as `facilities[]`, from -> to, one row per
       touched member of the version. The stub reads the scalar arm only, which
       is the arm the amend room sends for a figure on a facility.

       THE ARM'S OWN SHAPE, off the org rather than off the spec's prose:
       `StageLoanModification.parseScalarChanges` reads each entry as
       `{ key, value, targetLoanId }` with `key` one of the four request-key
       names (StageLoanModification.cls:2325-2387, class ScalarChange:117), and
       `StageAmendVersion` reuses that parser verbatim. An earlier stub read the
       four names as KEYS of the entry, so every amendment echoed back as no
       change at all. */
    var SCALAR_FIELD = {
      requestedRate: { field: "LLC_BI__Interest_Rate__c", from: "interestRate" },
      requestedAmount: { field: "LLC_BI__Amount__c", from: "committed" },
      requestedMaturityDate: { field: "LLC_BI__Maturity_Date__c", from: "maturityDate" },
      requestedTermMonths: { field: "LLC_BI__Term_Months__c", from: "termMonths" },
    };
    var AMEND_STAGING = "a5Sbb00000AMENDV1";
    /* THE EXECUTE CARRIES THE STAGING ROW, NOT THE ARMS, which is the whole
       point of a staged plan: the org holds what was planned and the second
       call names it by id and token. So the stage keeps the touched set and
       the execute reads it back rather than re-parsing a body it never gets. */
    var touched = vstate.staged[AMEND_STAGING] || [];

    if (tool === "stage_amend_version") {
      var scalars = [];
      try { scalars = JSON.parse(input.scalarChangesJson || "[]"); } catch (e) { scalars = []; }
      touched = [];
      scalars.forEach(function (c) {
        var at = SCALAR_FIELD[c && c.key];
        if (!at) return;
        var loan = clones.filter(function (f) { return f.loanId === c.targetLoanId; })[0] || clones[0] || {};
        touched.push({ facilityId: loan.loanId, facilityName: loan.name, field: at.field, from: loan[at.from], to: c.value });
      });
      vstate.staged[AMEND_STAGING] = touched;
      return {
        ok: true,
        result: {
          stagingId: AMEND_STAGING,
          planHash: "f0e1d2c3b4a59687",
          decisionToken: "amend-probe-token",
          productPackageId: spec.id,
          summary: "Writes the figures on the version's own loans. No credit action, no clone.",
          steps: touched.map(function (t, i) {
            return { id: "a" + (i + 1), type: "write", label: "Apply " + t.field + " on " + t.facilityName, objectName: "LLC_BI__Loan__c", fields: [t.field] };
          }).concat([{ id: "av1", type: "verification", label: "Re-query the version's loans", dependsOn: ["a1"] }]),
          warnings: [],
          facilities: touched,
          facilityCount: touched.length,
        },
      };
    }

    // execute_amend_version
    touched.forEach(function (t) {
      if (!t.facilityId) return;
      var patch = vstate.amended[t.facilityId] || (vstate.amended[t.facilityId] = {});
      if (t.field === "LLC_BI__Interest_Rate__c") patch.interestRate = Number(t.to);
      if (t.field === "LLC_BI__Amount__c") { patch.committed = Number(t.to); patch.available = Number(t.to); }
      if (t.field === "LLC_BI__Maturity_Date__c") patch.maturityDate = t.to;
      if (t.field === "LLC_BI__Term_Months__c") patch.termMonths = Number(t.to);
    });
    return {
      ok: true,
      result: {
        stagingId: AMEND_STAGING,
        terminalState: "success",
        outcome: "The version's own loans carry the new figures; the booked parents are untouched.",
        productPackageId: spec.id,
        facilities: touched,
        facilityCount: touched.length,
        steps: touched.map(function (t, i) {
          return { id: "a" + (i + 1), type: "write", label: "Apply " + t.field + " on " + t.facilityName, state: "verified" };
        }).concat([{ id: "av1", type: "verification", label: "Re-query the version's loans", state: "verified" }]),
      },
    };
  }

  /* ---------------------------------------------------------------- boom */

  /* ONE STATEMENT, in Boom's output shape, with the figures the cockpit's
     on-file spread carries (client-360/assets/boom-spread.json: Piedmont,
     FY2023-2025). A drive reading these back off the page is reading the same
     numbers a banker would. */
  var BOOM_PERIODS = [
    { id: "p2023", endDate: "2023-12-31", periodType: "annual" },
    { id: "p2024", endDate: "2024-12-31", periodType: "annual" },
    { id: "p2025", endDate: "2025-12-31", periodType: "annual" },
  ];

  function boomLine(id, name, code, hierarchy, v23, v24, v25) {
    return {
      id: id,
      name: name,
      hierarchy: hierarchy,
      accountCode: code,
      flipSign: false,
      periodValues: { p2023: v23, p2024: v24, p2025: v25 },
    };
  }

  function boomStatements(fileId) {
    var lines = [
      boomLine(fileId + "-l1", "Net Sales", "net_sales_revenue", "line_item", 59915000, 56266000, 64486000),
      boomLine(fileId + "-l2", "Cost of Sales", "cost_of_sales", "line_item", 45371000, 40829000, 50422000),
      boomLine(fileId + "-l3", "Gross Profit", "gross_profit", "subtotal", 14544000, 15437000, 14064000),
      boomLine(fileId + "-l4", "Operating Expenses", "operating_expenses", "line_item", 10989000, 10752000, 11226000),
      boomLine(fileId + "-l5", "Income from Operations", "operating_profit", "subtotal", 3555000, 4685000, 2838000),
      boomLine(fileId + "-l6", "Interest Expense", "interest_expense", "line_item", -1019000, -947000, -1076000),
      boomLine(fileId + "-l7", "Net Income", "net_income", "total", 1868000, 2873000, 1390000),
    ];
    return [{
      id: fileId + "-s1",
      statementType: "income_statement",
      endDate: "2025-12-31",
      validationStatus: "not_validated",
      periods: BOOM_PERIODS,
      lineItems: lines,
      aggregatedFinancials: lines.map(function (l) {
        return { accountCode: l.accountCode, accountName: l.name, periodValues: l.periodValues };
      }),
    }];
  }

  /** A uuid-shaped file id from the sha256 the cockpit sends. */
  function boomFileId(sha) {
    var h = String(sha || "").replace(/[^0-9a-f]/gi, "").toLowerCase();
    while (h.length < 32) h += "0";
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32);
  }

  function boomAnswer(tool, input) {
    var B = window.__LANES.boom;
    if (tool === "boom_create_file_group") {
      return { fileGroupId: boomFileId("f11e" + (input.companyExternalUniqueId || "")) };
    }
    if (tool === "boom_validation_session") {
      return {
        url: "https://app.boom.build/file-validation/" + input.fileId + "#token=bvs_probe",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
    }
    if (tool === "boom_upload_statement") {
      var id = boomFileId((input.file || {}).sha256 || input.externalUniqueId);
      // A re-drop does not restart the clock and does not make a second file.
      if (!B.files[id]) B.files[id] = { startedAt: Date.now(), fileGroupId: input.fileGroupId || null };
      return {
        fileId: id,
        companyId: boomFileId("c0" + ((input.company || {}).externalUniqueId || "")),
        fileGroupId: B.files[id].fileGroupId,
        status: "processing",
      };
    }
    // boom_upload_status
    var file = B.files[input.fileId];
    if (!file) {
      return { fileId: input.fileId, companyId: null, fileGroupId: null, status: "failed", message: "Boom has no file with that id." };
    }
    var base = { fileId: input.fileId, companyId: null, fileGroupId: file.fileGroupId, validationUrl: null };
    if (Date.now() - file.startedAt < (B.processingMs || 0)) {
      base.status = "processing";
      return base;
    }
    if (B.mode === "failed") {
      base.status = "failed";
      base.message = "Boom could not read this file. Nothing in it could be placed on a statement.";
      return base;
    }
    base.status = "completed";
    base.financialStatements = boomStatements(input.fileId);
    return base;
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
        /* THE BOOM CONNECTOR, published here already so the day `SERVERS.boom`
           stops being the gateway's name the drives need no change. The page
           only asks about the lanes it addresses, so an extra one is invisible
           until the cockpit names it. */
        { server: "Boom", authStatus: "connected", tools: [] },
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
