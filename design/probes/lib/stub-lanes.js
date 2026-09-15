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
                 IT IS THE claude.ai HOP THAT DROPS THEM (0.9.29), so the WRITE
                 DOOR below never sees a drop: that is a hop of our own, and a
                 stub where one knob shut both doors could not tell the door
                 working from the door never being reached.
     writeDoor   "absent" (default) | "granted". THE SECOND HOP FOR THE GOVERNED
                 WRITES (0.9.29, SPEC-0.9.29-WRITE-DOOR). Granted, a third
                 connector appears in `listTools()` serving `gw_<ApexClass>` for
                 every stage/execute pair plus `gw_health`, and it answers the
                 SAME bodies from the SAME staging ledger: one row per key,
                 whichever door files it. Absent by default, so every drive
                 written before it is unchanged and the relay-drop scenario still
                 exercises the re-issue path with no door to fall to.
     staging     THE STAGING LEDGER, fenced on the idempotency key the way
                 C360ActionStaging.stagePlan is: one row per key, a repeat
                 returns that row with `replayed: true` and a NULL decision
                 token, and `staging.calls` carries every stage call so a drive
                 can prove no key ever produced two rows.
     rotateOnReplay
                 THE ORG'S OWN ROTATION RULE (C360ActionStaging, 2026-09-13),
                 OFF by default. The deployed Apex re-issues the token on a
                 replay of an UNTOUCHED row (Staged, token never consumed, never
                 executed, same actor) and answers `replayed` and `tokenRotated`
                 both true, so a page that lost the first answer can execute the
                 plan the org already holds. Off by default because the
                 relay-drop scenario predates the rule and asserts the client's
                 derived-key fallback, which is still the path for a replay the
                 org will NOT rotate: a different actor, or a row that has moved
                 on. The write-door scenario turns it on, because a door that
                 re-asks a key and is handed no token cannot file anything.
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
     boom        THE BOOM LANE (2026-09-12; re-cut to the LIVE wire 2026-09-15),
                 the stand-in for Noland's Boom MCP server:
                   mode          "ok" | "failed", what the file ends as
                   processingMs  how long the file sits at `processing`
                                 (4000 is the floor of the room's own range)
                   files         per-file clock, keyed by Boom file id
                   rejects       per TOOL, how many of the next calls the
                                 transport swallows (502), the file carrying on
                                 spreading behind it. The 2026-09-15 shape: a
                                 rejected `boom_await_file` says nothing at all
                                 about the file, and the room must not read one
                                 as a failure.
                 It answers the whole surface the cockpit uses on whichever
                 connector the page addresses it to: `boom_ensure_company`,
                 `boom_list_files`, `boom_create_upload`, `boom_upload_bytes`,
                 `boom_process_file`, `boom_await_file`, `boom_get_file`,
                 `boom_get_spread`, `boom_get_ratios` and
                 `boom_open_verification`.
                 EVERY ANSWER CARRIES THE LIVE ENVELOPE, verbatim in shape:
                 `contractVersion`, `_source: "BOOM-STUB"`, `_provenance` and
                 the body under its own key where the live one has one
                 (`{file:{}}`, `{spread:{}}`). That is the whole point of this
                 block: the drive exercises the same parser the live server
                 hits. Boom's ladder, unchanged:
                 waiting_for_upload -> processing -> failed | completed.

   NOTHING HERE SHIPS. The artifact's own build fails closed on simulation
   markers and this file is never bundled; the app itself still refuses to
   invent a figure. */
(function () {
  var ACCOUNT = "001bb00001DLtRMAA1";

  var BACKUP_SERVER = "Salesforce Read Backup";
  /* THE WRITE DOOR'S DISPLAY NAME. The page FINDS the door by the tools it
     serves (app/src/channel/writeDoor.ts), so this spelling is only what the
     published grant declares and what the health row falls back to; the drive
     asserts on the name it resolves to, which is this one. */
  var WRITE_DOOR_SERVER = "Customer 360 Write Door";

  /** The governed writes the door carries, as the manifest declares them. */
  var DOOR_WRITES = [
    "stage_collateral_valuation", "execute_collateral_valuation",
    "stage_service_request", "execute_service_request",
    "stage_annual_review", "execute_annual_review",
    "stage_new_facility", "execute_new_facility",
    "stage_risk_rating_review", "execute_risk_rating_review",
    "stage_covenant_review", "execute_covenant_review",
    "stage_loan_modification", "execute_loan_modification",
    "stage_renewal", "stage_relationship_intake", "execute_relationship_intake",
    "complete_new_facility_detail",
    "stage_amend_version", "execute_amend_version",
    "stage_discard_version", "execute_discard_version",
  ];

  /** `stage_loan_modification` is `gw_StageLoanModification`, the Apex class the
   *  gateway publishes. The page derives the same name the same way. */
  function gwWriteName(tool) {
    return "gw_" + tool.replace(/(^|_)([a-z0-9])/g, function (_m, _sep, c) { return c.toUpperCase(); });
  }

  /** And back again, so the door answers off the same table the org does. */
  function doorTool(name) {
    return name.replace(/^gw_/, "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  }

  window.__LANES = { mode: "ok", backupMode: "ok", backup: "granted", hangTools: [], latencyMs: 0, relayMs: 0, attempts: {}, calls: [], settled: [], livePatch: {}, accounts: [], boom: { mode: "ok", processingMs: 4000, files: {}, rejects: {} }, version: null, failNext: {}, writeDoor: "absent", rotateOnReplay: false, staging: { seq: 148, byKey: {}, rows: [], calls: [] } };
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
      return { id: led.byKey[key].id, replayed: true, rotated: window.__LANES.rotateOnReplay === true };
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

  /** THE TOKEN A REPLAY COMES BACK WITH, which is the whole of what makes a
   *  re-ask through either door worth making. See `rotateOnReplay` above:
   *  withheld by default, minted afresh where the org's own rotation rule is
   *  switched on. */
  function replayToken(row) {
    return row.replayed && !row.rotated ? null : "4f8ac21e-probe-token";
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
    var door = server === WRITE_DOOR_SERVER;
    /* `mode` IS THE SALESFORCE HOP'S. The backup has its own, and the door is a
       hop of ours that is either there or not: a knob that took the door down
       with Salesforce would make the fallback untestable. */
    var mode = backup ? (L.backupMode || "ok") : door ? "ok" : L.mode;
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
    // Same for a write door the viewer never added: it is an OPTIONAL connector
    // and its absence is the default, not a failure of anything.
    if (door && L.writeDoor !== "granted") {
      settle(server, tool, false);
      return Promise.reject({ code: "server_not_connected", message: WRITE_DOOR_SERVER + " is not connected", retryable: false });
    }
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

    /* THE WRITE DOOR ANSWERS THE SAME BODIES (0.9.29). It forwards to
       `invokeAction` untouched, so `gw_StageLoanModification` IS
       `stage_loan_modification`: same ledger, same envelope, one row per key
       whichever door files it. Reached AFTER the drop above, deliberately, since
       `failNext` is the claude.ai relay losing an answer and this door does not
       ride that relay. `gw_health` is left alone: it is the gateway's own, on
       both endpoints, and it carries no Salesforce data. */
    if (door && /^gw_[A-Z]/.test(tool)) tool = doorTool(tool);

    // The backup's own health tool carries no Salesforce data.
    if (tool === "gw_health") {
      return give({ payload: { ok: true, orgReachable: true, orgError: null, checkedAt: new Date().toISOString() } });
    }

    /* ------------------------------------------------------------- boom

       THE BOOM SERVER, standing in for `boom-mcp`. The tool names, the argument
       names and the ANSWER ENVELOPES are the live server's, read off it on
       2026-09-15 and saved verbatim under app/src/__fixtures__/boom-live/, so a
       drive here exercises the wire contract itself and not a paraphrase of it.

       IDEMPOTENT, because Boom is: the file id is derived from the sha256 the
       cockpit sends as `externalUniqueId`, so the same bytes twice are one
       file, one clock and one set of periods, and `boom_list_files` reports the
       file already taken so the adapter never reserves a second. NEVER
       `verified`: verification is an analyst's act in Boom's own page and no
       stub may claim one. */
    if (tool.indexOf("boom_") === 0) {
      /* THE TRANSPORT DROPS THE ANSWER, AND BOOM CARRIES ON SPREADING.

         The 2026-09-15 19:37 UTC shape, and it is NOT a refusal by Boom: the
         file is in, `processing`, and it is the answer that never arrives. The
         cockpit used to read that as a failed file and wrote "[object Object]"
         on the row. The count is per tool so a drive can reject the WAIT
         specifically and leave `boom_get_file` answering, which is the exact
         asymmetry the room's fallback is built on. */
      var boomRejects = (L.boom.rejects || {})[unprefixed(tool)];
      if (boomRejects > 0) {
        L.boom.rejects[unprefixed(tool)] = boomRejects - 1;
        return refuse(UNAVAILABLE);
      }
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
          decisionToken: replayToken(row),
          replayed: row.replayed,
          tokenRotated: !!row.rotated,
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

    /* THE ORG'S OWN ACCOUNT SEARCH, answered from the drive's own table (backlog
       row 57, the founder's Blue Ridge run). The page asks it whenever a banker
       names a party the relationship does not carry, so a stub returning a flat
       empty set could only ever drive the "nothing matched" half. `accounts` is
       set by the drive off the baked relationships, and the match is the org's:
       a partial, case-insensitive name. */
    if (unprefixed(tool) === "Customer360SearchAccounts") {
      var want = String((firstInput(input) || {}).name || "").trim().toLowerCase();
      var pool = L.accounts || [];
      var hits = want.length >= 3 ? pool.filter(function (a) { return String(a.name || "").toLowerCase().indexOf(want) !== -1; }) : [];
      return sleep(0).then(function () { return give(envelope({ count: hits.length, results: hits })); });
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
      decisionToken: replayToken(row),
      replayed: row.replayed,
      tokenRotated: !!row.rotated,
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


  /* ------------------------------------------------- the plan's own steps

     THE FROZEN CONTRACT RUNS EACH OBJECT IN ITS OWN WRITE STEP AND PROVES IT IN
     `<stepId>_verify` IMMEDIATELY AFTER, and that pairing is the whole of what a
     group is (app/src/actions/stageModel.ts). The stub answered a flat five-step
     plan with one verification at the end, which was the 0.9.23 confirm gate's
     shape: on the 0.9.29 stage it reads as ZERO groups, so the surface that says
     what a discard deletes said nothing at all.

     THE SHAPE HERE IS THE ORG'S OWN, off the live Sunbelt answer kept at
     `app/src/__fixtures__/discard/stage-discard-version-stg168.json` (staging
     STG-0000000168): one write + verify pair per object in the contract's delete
     order, then the two closing verifications, then the trail row that is KEPT
     and marked Withdrawn, then what the org merely observed. The counts, the
     names and the parents are this book's, counted; nothing here is composed. */
  var DISCARD_GROUPS = [
    { id: "delete_chain", object: "LLC_BI__LoanRenewal__c", label: "Remove the renewal chain rows that keep the booked parents flagged" },
    { id: "delete_pledges", object: "LLC_BI__Loan_Collateral2__c", label: "Remove the collateral pledges copied onto the version facilities" },
    { id: "delete_covenant_junctions", object: "LLC_BI__Loan_Covenant__c", label: "Detach the covenants from the version facilities" },
    { id: "delete_pricing_streams", object: "LLC_BI__Pricing_Stream__c", label: "Remove the pricing streams nCino cloned onto the version facilities" },
    { id: "delete_members", object: "LLC_BI__Loan__c", label: "Remove the version facilities" },
    { id: "delete_aggregates", object: "LLC_BI__Loan_Collateral_Aggregate__c", label: "Remove the collateral aggregate shells this version owns" },
    { id: "delete_package", object: "LLC_BI__Product_Package__c", label: "Remove the version package" },
  ];

  /** The staged plan's steps, and the sentence each one reports once it has run. */
  function discardPlan(spec, items, parents) {
    var steps = [];
    var counts = {};
    items.forEach(function (i) { counts[i.object] = (counts[i.object] || 0) + 1; });
    DISCARD_GROUPS.forEach(function (g) {
      var n = counts[g.object] || 0;
      steps.push({
        id: g.id, type: "write", objectName: g.object, fields: ["Id"],
        label: g.label + " (" + n + ")",
        automationWoken: ["nCino managed delete handling on " + g.object],
        verification: "SELECT COUNT() FROM " + g.object + " WHERE Id IN :planned",
        detail: n === 0 ? "Re-query confirms 0. Nothing was there to remove." : "Re-query confirms all " + n + " gone.",
      });
      steps.push({
        id: g.id + "_verify", type: "verification", objectName: g.object, fields: ["Id"],
        label: "Confirm every " + g.object + " in this group is gone",
        verification: "SELECT COUNT() FROM " + g.object + " WHERE Id IN :planned",
        detail: n === 0 ? "Re-query confirms 0. Nothing was there to remove." : "Re-query confirms all " + n + " gone.",
      });
    });
    /* THE CLOSING, in the org's order: the parents, the version itself, the
       trail row that survives, and the shells the org only watched. */
    steps.push({
      id: "verify_parents", type: "verification", objectName: "LLC_BI__Loan__c",
      label: "Confirm every booked parent reads hasRenewal false",
      detail: (parents.length ? parents.join(", ") : "Every booked parent") + " reads hasRenewal false and can be forked again.",
    });
    steps.push({
      id: "verify_version_gone", type: "verification", objectName: "LLC_BI__Product_Package__c",
      label: "Confirm the version package id no longer resolves",
      detail: "Version package " + spec.id + " no longer resolves. The version is gone.",
    });
    steps.push({
      id: "withdraw_trail", type: "write", objectName: "cm_Action_Staging__c", fields: ["Id"],
      label: "Mark the version's action trail rows Withdrawn (" + (counts["cm_Action_Staging__c"] || 0) + ")",
      detail: "Staging a5Sbb00000MODSTG1 is kept on the trail and marked Withdrawn.",
    });
    steps.push({
      id: "observe_aggregates", type: "observed_side_effect",
      label: "Collateral aggregate shells left standing (0)",
      automationWoken: ["LLC_BI__ColPledgesAutoUpdater"],
      detail: "None was left standing.",
    });
    return steps;
  }

  /** What the org says beside the list: the count line the stage reads as its
   *  lede, the parents it will free, and the trail row it keeps. */
  function discardWarnings(items, parents) {
    var kept = items.filter(function (i) { return i.object === "cm_Action_Staging__c"; }).length;
    return [
      "This action DELETES " + (items.length - kept) + " records. Nothing outside the list above is touched: the booked package, " +
        "the booked facilities, the collateral assets and their ownership junctions, and the covenant records all stay exactly as they are.",
      "After the discard, " + (parents.join(", ") || "every booked parent") + " will read hasRenewal false and be available to fork again. " +
        "That is verified by re-query, not assumed.",
      kept + " action trail row belonging to this version is KEPT and marked Withdrawn. The trail is the audit and is never deleted.",
    ];
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
      var parents = sourceMembers(body).map(function (f) { return f.name; });
      return {
        ok: true,
        result: {
          stagingId: "a5Sbb00000DISCRD1",
          planHash: "a1b2c3d4e5f60718",
          decisionToken: "discard-probe-token",
          productPackageId: spec.id,
          sourcePackageId: spec.source,
          summary: "Removes the unbooked version and its copies. The booked package is untouched.",
          steps: discardPlan(spec, items, parents).map(function (s) {
            // THE STAGED PLAN CARRIES NO ANSWERS. The detail is what the run
            // reports, and a plan that shipped it would be stating an outcome
            // nobody has asked the org for yet.
            var out = {}; for (var k in s) if (k !== "detail") out[k] = s[k];
            out.state = "pending";
            return out;
          }),
          warnings: discardWarnings(items, parents),
          items: items,
          itemCount: items.length,
        },
      };
    }

    if (tool === "execute_discard_version") {
      var gone = discardInventory(spec, clones);
      var ranParents = sourceMembers(body).map(function (f) { return f.name; });
      vstate.discarded = true;
      /* EVERY STATE AT ONCE, which is the contract: `execute_*` is one call that
         returns every step settled, and the pace the banker watches is the
         stage's own reveal, never a poll. */
      return {
        ok: true,
        result: {
          stagingId: "a5Sbb00000DISCRD1",
          terminalState: "success",
          outcome: "The version package and its members were deleted; every booked parent reads hasRenewal false.",
          sourcePackageId: spec.source,
          items: gone,
          steps: discardPlan(spec, gone, ranParents).map(function (s) {
            return { id: s.id, type: s.type, label: s.label, objectName: s.objectName,
                     state: s.type === "observed_side_effect" ? "filed_unverified" : "verified", detail: s.detail };
          }),
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

  /* THE RATIO SET THE LIVE SERVER STRUCK FROM THIS FILE (boom_get_ratios `raw`,
     read 2026-09-15). Verbatim, because the cockpit passes it through verbatim. */
  var BOOM_RAW_RATIOS = {
    revenue: 64486000,
    revenuePrior: 59915000,
    grossProfit: 14064000,
    operatingIncome: 2838000,
    ebitda: 5234000,
    totalDebt: 20130000,
    leverage: 3.8460068781047,
    interestCoverage: 2.637546468401487,
    revenueYoY: 0.07629141283484937,
    grossMargin: 0.2180938498278696,
    ebitdaMargin: 0.08116490401017275,
  };

  /** `support.lines`: which spread line fed which figure, the live server's own
   *  shape. The stub spreads ONE income statement, so these are the lines that
   *  statement carries and no others: no balance sheet means no debt lines and
   *  no cash flow means no D and A. */
  function boomSupportLines(fileId) {
    if (!fileId) return [];
    var line = function (figure, code, name, period, value) {
      return {
        figure: figure,
        statement: "income_statement",
        accountCode: code,
        name: name,
        period: period,
        value: value,
        method: "accountCode",
      };
    };
    return [
      line("revenue", "net_sales_revenue", "Net Sales", "2025-12-31", 64486000),
      line("revenuePrior", "net_sales_revenue", "Net Sales", "2024-12-31", 59915000),
      line("costOfSales", "cost_of_sales", "Cost of Sales", "2025-12-31", 50422000),
      line("grossProfit", "gross_profit", "Gross Profit", "2025-12-31", 14064000),
      line("operatingExpenses", "total_operating_expenses", "Operating Expenses", "2025-12-31", 11226000),
      line("operatingIncome", "operating_profit", "Income from Operations", "2025-12-31", 2838000),
      line("interestExpense", "interest_expense", "Interest Expense", "2025-12-31", -1076000),
    ];
  }

  function boomStatements(fileId) {
    var lines = [
      boomLine(fileId + "-l1", "Net Sales", "net_sales_revenue", "line_item", 56266000, 59915000, 64486000),
      boomLine(fileId + "-l2", "Cost of Sales", "cost_of_sales", "line_item", 40829000, 45371000, 50422000),
      boomLine(fileId + "-l3", "Gross Profit", "gross_profit", "subtotal", 15437000, 14544000, 14064000),
      boomLine(fileId + "-l4", "Operating Expenses", "total_operating_expenses", "line_item", 10752000, 10989000, 11226000),
      boomLine(fileId + "-l5", "Income from Operations", "operating_profit", "subtotal", 4685000, 3555000, 2838000),
      boomLine(fileId + "-l6", "Interest Expense", "interest_expense", "line_item", -947000, -1019000, -1076000),
      boomLine(fileId + "-l7", "Net Income", "net_income", "total", 2873000, 1868000, 1390000),
    ];
    return [{
      id: fileId + "-s1",
      statementType: "income_statement",
      endDate: "2025-12-31",
      /* NOT `validated`, ever. The live server DOES return `validated` on a file
         an analyst signed off in Boom's own page, and that is exactly why no
         stub may: a freshly processed file is `completed` and `not_validated`,
         which is the state this block simulates. */
      validationStatus: "not_validated",
      periods: BOOM_PERIODS,
      lineItems: lines,
      /* BOOM'S OWN ROLL-UP SHAPE: a pair per period, as given and as the
         analyst allowed (observed live 2026-09-15), never a bare number. */
      aggregatedFinancials: lines.map(function (l) {
        var values = {};
        Object.keys(l.periodValues).forEach(function (id) {
          values[id] = { asGiven: l.periodValues[id], asAllowed: l.periodValues[id] };
        });
        return { accountCode: l.accountCode, accountName: l.name, periodValues: values };
      }),
    }];
  }

  /** A uuid-shaped file id from the sha256 the cockpit sends. */
  function boomFileId(sha) {
    var h = String(sha || "").replace(/[^0-9a-f]/gi, "").toLowerCase();
    while (h.length < 32) h += "0";
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32);
  }

  /** THE LIVE ENVELOPE, shape for shape. `_source` names the stub so nothing
   *  downstream can mistake this for Boom's own read. */
  function boomEnvelope(record, ids, asOf, body) {
    var out = {
      contractVersion: "1.0",
      _source: "BOOM-STUB",
      _provenance: { system: "Boom", record: record, ids: ids || {}, asOf: asOf || new Date().toISOString() },
    };
    Object.keys(body || {}).forEach(function (k) { out[k] = body[k]; });
    return out;
  }

  /** The stub's own File row, in the live shape. */
  function boomFileRow(id, file) {
    return {
      id: id,
      fileName: file.fileName,
      status: boomStatusOf(file),
      statementQuality: null,
      fileGroupId: file.fileGroupId,
      periodEnds: boomStatusOf(file) === "completed" ? ["2025-12-31", "2024-12-31", "2023-12-31"] : [],
      createdAt: new Date(file.startedAt).toISOString(),
      downloadUrl: null,
    };
  }

  /** Where one file has got to on Boom's ladder, by the clock. */
  function boomStatusOf(file) {
    var B = window.__LANES.boom;
    if (Date.now() - file.startedAt < (B.processingMs || 0)) return "processing";
    return B.mode === "failed" ? "failed" : "completed";
  }

  var BOOM_FAILURE_MESSAGE = "Boom could not read this file. Nothing in it could be placed on a statement.";

  function boomAnswer(tool, input) {
    var B = window.__LANES.boom;
    var id;

    if (tool === "boom_ensure_company") {
      return boomEnvelope("company", { externalUniqueId: input.salesforceRecordId || null }, null, {
        company: {
          id: boomFileId("c0" + (input.salesforceRecordId || "")),
          name: input.name || null,
          externalUniqueId: input.salesforceRecordId || null,
        },
      });
    }

    if (tool === "boom_list_files") {
      var rows = Object.keys(B.files).map(function (fid) { return boomFileRow(fid, B.files[fid]); });
      return boomEnvelope("file-list", { externalUniqueId: input.salesforceRecordId || null }, null, { files: rows });
    }

    if (tool === "boom_create_upload") {
      // A re-drop does not restart the clock and does not make a second file:
      // the reservation is keyed on the sha256 the cockpit sends.
      id = boomFileId(input.externalUniqueId);
      if (!B.files[id]) {
        B.files[id] = { startedAt: Date.now(), fileGroupId: input.fileGroupId || null, fileName: input.fileName, bytesIn: false };
      }
      return boomEnvelope("file", { fileId: id }, null, { file: boomFileRow(id, B.files[id]) });
    }

    if (tool === "boom_upload_bytes") {
      var taking = B.files[input.fileId];
      if (taking) taking.bytesIn = true;
      return boomEnvelope("file", { fileId: input.fileId }, null, { fileId: input.fileId, bytes: (input.contentBase64 || "").length });
    }

    if (tool === "boom_process_file") {
      var starting = B.files[input.fileId];
      if (starting) starting.startedAt = starting.startedAt || Date.now();
      return boomEnvelope("file", { fileId: input.fileId }, null, {
        fileId: input.fileId,
        status: starting ? boomStatusOf(starting) : "processing",
      });
    }

    if (tool === "boom_await_file") {
      /* THE SERVER BLOCKS, AND SO DOES THIS, up to the seconds it was asked for
         or until the file settles, whichever comes first. A stub that answered
         instantly would let the room spin its whole budget in one tick and the
         wait would never be exercised at all. */
      var awaited = B.files[input.fileId];
      var ceiling = Math.min(Number(input.maxSeconds) || 20, 25) * 1000;
      var deadline = Date.now() + ceiling;
      return new Promise(function (resolve) {
        var tick = setInterval(function () {
          var state = awaited ? boomStatusOf(awaited) : "failed";
          if (state !== "processing" || Date.now() >= deadline) {
            clearInterval(tick);
            resolve(
              boomEnvelope("file", { fileId: input.fileId }, null, {
                fileId: input.fileId,
                status: state,
                done: state !== "processing",
              }),
            );
          }
        }, 50);
      });
    }

    if (tool === "boom_open_verification") {
      return boomEnvelope("file", { fileId: input.fileId }, null, {
        url: "https://app.boom.build/file-validation/" + input.fileId + "#token=bvs_probe",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
    }

    if (tool === "boom_get_spread") {
      var spreadOf = B.files[input.fileId];
      if (!spreadOf || boomStatusOf(spreadOf) !== "completed") {
        return { code: "NOT_FOUND", message: "Boom has no readable spread for that file.", boomStatus: 404 };
      }
      return boomEnvelope("file", { fileId: input.fileId }, "2025-12-31", {
        /* THE BASIS THE CALLER ASKED FOR, echoed. The stand-in holds one read of
           the file, so the figures do not move with it; what this proves is that
           the room ASKS the server rather than filtering what it already has. */
        adjusted: input.adjusted !== false,
        spread: {
          id: input.fileId,
          fileName: spreadOf.fileName,
          externalUniqueId: input.fileId,
          companyId: null,
          fileGroupId: spreadOf.fileGroupId,
          status: "completed",
          statementQuality: null,
          downloadUrl: null,
          wipTables: [],
          financialStatements: boomStatements(input.fileId),
        },
      });
    }

    if (tool === "boom_get_ratios") {
      /* BY FILE, WHERE THE CALLER NAMED ONE. The live tool takes a file id OR a
         borrower, and the room asks by file: the ratio support lines beside a
         spread on the glass belong to THAT file. */
      if (input.fileId) {
        if (!B.files[input.fileId]) {
          return { code: "NOT_FOUND", message: "Boom has no ratio set for that file.", boomStatus: 404 };
        }
        return boomEnvelope("file", { fileId: input.fileId }, "2025-12-31", {
          company: "Piedmont Precision Components, Inc.",
          method: "derived-local",
          adjusted: input.adjusted !== false,
          raw: BOOM_RAW_RATIOS,
          ratios: [],
          metrics: [],
          support: {
            fileId: input.fileId,
            periodEnd: "2025-12-31",
            lines: boomSupportLines(input.fileId),
            method: {},
          },
        });
      }
      /* ONLY THE BORROWER BOOM ACTUALLY HOLDS. On the founder's own org three
         companies are linked and Piedmont is the one this bundle carries;
         Hartwell, Kingsley and the rest are genuinely NOT IN BOOM and the live
         server answers them 404. A stub that handed Piedmont's ratios to every
         relationship would put one borrower's figures on another's tab, which is
         the worst thing this lane could teach the cockpit to do. */
      if ((input.salesforceRecordId || input.externalUniqueId || ACCOUNT) !== ACCOUNT) {
        return {
          code: "NOT_FOUND",
          message: "Boom GET /companies/external-id/" + (input.salesforceRecordId || input.externalUniqueId) + " returned 404 Not Found: Company Not Found",
          boomStatus: 404,
        };
      }
      return boomEnvelope("file", { externalUniqueId: input.salesforceRecordId || null }, "2025-12-31", {
        company: "Piedmont Precision Components, Inc.",
        method: "derived-local",
        adjusted: true,
        raw: BOOM_RAW_RATIOS,
        ratios: [],
        metrics: [],
        support: {
          fileId: Object.keys(B.files)[0] || null,
          periodEnd: "2025-12-31",
          lines: boomSupportLines(Object.keys(B.files)[0] || null),
          method: {},
        },
      });
    }

    // boom_get_file
    var file = B.files[input.fileId];
    if (!file) {
      return { code: "NOT_FOUND", message: "Boom has no file with that id.", boomStatus: 404 };
    }
    var row = boomFileRow(input.fileId, file);
    if (row.status === "failed") row.message = BOOM_FAILURE_MESSAGE;
    return boomEnvelope("file", { fileId: input.fileId }, null, { file: row });
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
        /* THE BOOM CONNECTOR, AND ITS TOOL LIST. The cockpit no longer knows
           Boom's display name: it takes whichever server here serves BOTH
           `boom_get_ratios` and `boom_get_spread` (app/src/channel/boomLane.ts).
           So this entry has to publish them, or discovery would fall back and
           the drives would never exercise the mechanism at all. */
        {
          server: "Boom",
          authStatus: "connected",
          tools: [
            { name: "boom_get_ratios" },
            { name: "boom_get_spread" },
            { name: "boom_get_file" },
            { name: "boom_list_files" },
            { name: "boom_ensure_company" },
            { name: "boom_create_upload" },
            { name: "boom_upload_bytes" },
            { name: "boom_process_file" },
            { name: "boom_await_file" },
            { name: "boom_open_verification" },
          ],
        },
      ];
      if (window.__LANES.backup !== "absent") {
        servers.splice(1, 0, { server: BACKUP_SERVER, authStatus: "connected", tools: [] });
      }
      /* THE WRITE DOOR PUBLISHES ITS TOOLS OR IT IS INVISIBLE. The page takes
         whichever connector here serves a `gw_Stage...` and a `gw_Execute...`
         (app/src/channel/writeDoor.ts) and calls only the pairs it lists, so a
         door with an empty tool list would never be found and the drive would
         never exercise the mechanism at all. */
      if (window.__LANES.writeDoor === "granted") {
        servers.push({
          server: WRITE_DOOR_SERVER,
          authStatus: "connected",
          tools: DOOR_WRITES.map(gwWriteName).concat("gw_health").map(function (name) { return { name: name }; }),
        });
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
