/* PROBE HARNESS ONLY. THE RELATIONSHIP INTAKE STAND-IN.

   A SEPARATE FILE FROM lib/stub-connector.js AND lib/stub-greeting.js, for the
   same reason those two are separate from each other: their bytes are not this
   build's to move, and a shot that stands on one of them must keep standing on
   exactly what it stood on before.

   WHAT IT SUPPLIES.

   1. Customer360Catalog, answering with the ORG'S OWN NAMES, read off
      bankinggpt-at on 2026-09-03: all 71 LLC_BI__Covenant_Type__c records and
      the collateral-type catalog. Nothing here is invented, because the whole
      point of the chips is that they are the org's.

   2. stage_relationship_intake and execute_relationship_intake, which RECORD
      the payload verbatim and answer with a plan in the frozen contract's own
      grammar: one create step and one verify step per record, named
      covenant_create_{i} / covenant_verify_{i} / collateral_create_{i} /
      collateral_verify_{i}, plus refusals[] by index.

      THE TOOL IS NOT DEPLOYED. That is why this exists and it is stated rather
      than hidden: what this drive proves is the SHELL, the elicitation, the
      loops, the read-back and the exact bytes the room would put on the wire.
      What it cannot prove is the org's own answer.

   3. Every other stage_ and execute_ THROWING, because nothing else in this
      drive may reach a write path.

   4. window.claude.use("sample"), a session door that records prompts and
      answers in the v2 grammar. Not a model: the smallest thing that keeps the
      room's narration lane honest while the intake flows are driven.

   Config: window.__DRIVE = { label }. Set by an init script BEFORE this runs. */
(function () {
  var T0 = performance.now();
  var since = function () {
    return Math.round(performance.now() - T0);
  };

  window.__DRIVE_OUT = { prompts: [], marks: [], errors: [], staged: [], executed: [], catalogCalls: 0 };
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

  /* ------------------------------------------------------------ the catalog

     THE ORG'S OWN NAMES. 71 covenant types and 43 collateral types, read from
     bankinggpt-at over the REST describe/query on 2026-09-03. The shape is the
     one Customer360Catalog returns: one entry per object.field, `values` as
     {label, value} where a CATALOG entry's value is the record id. */
  var COVENANT_TYPES = [
    {
      "label": "Accounts Payable",
      "value": "a3Gbb000000PLNvEAO"
    },
    {
      "label": "Accounts Receivable",
      "value": "a3Gbb000000PdkXEAS"
    },
    {
      "label": "Aviation - Borrower",
      "value": "a3Gbb000001GudkEAC"
    },
    {
      "label": "Aviation - Lessee",
      "value": "a3Gbb000001GudxEAC"
    },
    {
      "label": "Aviation - Lessee Parent",
      "value": "a3Gbb000001GudyEAC"
    },
    {
      "label": "Aviation - Non Borrower",
      "value": "a3Gbb000001GudgEAC"
    },
    {
      "label": "Aviation - Parent/Guarantor",
      "value": "a3Gbb000001GuduEAC"
    },
    {
      "label": "Budgets",
      "value": "a3Gbb000001GudtEAC"
    },
    {
      "label": "Business Financial Statement",
      "value": "a3Gbb000000PLOAEA4"
    },
    {
      "label": "CF - Parent",
      "value": "a3Gbb000001GudiEAC"
    },
    {
      "label": "CF - Subsidiary",
      "value": "a3Gbb000001GudhEAC"
    },
    {
      "label": "Collateral Insurance",
      "value": "a3Gbb000000PdkZEAS"
    },
    {
      "label": "Coverage - Private Company",
      "value": "a3Gbb000001GudcEAC"
    },
    {
      "label": "Coverage - Public Company",
      "value": "a3Gbb000001GudbEAC"
    },
    {
      "label": "Debt Service Coverage of Borrower",
      "value": "a3Gbb000000PLNqEAO"
    },
    {
      "label": "Debt Service Coverage with and without Distributions",
      "value": "a3Gbb000000PdkpEAC"
    },
    {
      "label": "Debt to Equity",
      "value": "a3Gbb000000PLNpEAO"
    },
    {
      "label": "Default Covenants",
      "value": "a3Gbb000000PdkvEAC"
    },
    {
      "label": "EBITDA",
      "value": "a3Gbb000000PLO3EAO"
    },
    {
      "label": "ECA & STF - All",
      "value": "a3Gbb000001GudfEAC"
    },
    {
      "label": "ESFO - Borrower",
      "value": "a3Gbb000001GuddEAC"
    },
    {
      "label": "ESFO- Non Borrower",
      "value": "a3Gbb000001GudaEAC"
    },
    {
      "label": "ESG Information",
      "value": "a3Gbb000001GudwEAC"
    },
    {
      "label": "ESG KPIs",
      "value": "a3Gbb000001GudvEAC"
    },
    {
      "label": "Event of Default",
      "value": "a3Gbb000001GudlEAC"
    },
    {
      "label": "Financial Indicators",
      "value": "a3Gbb000000PdkuEAC"
    },
    {
      "label": "Financial Statement Requirements",
      "value": "a3Gbb000000PdkgEAC"
    },
    {
      "label": "Fixed Asset Purchases",
      "value": "a3Gbb000000PdkkEAC"
    },
    {
      "label": "Fund Finance - All",
      "value": "a3Gbb000001GudjEAC"
    },
    {
      "label": "Fund Finance Activity Report",
      "value": "a3Gbb000001GudpEAC"
    },
    {
      "label": "Fund Reports",
      "value": "a3Gbb000001GudrEAC"
    },
    {
      "label": "General (all other)",
      "value": "a3Gbb000001GudsEAC"
    },
    {
      "label": "Global Debt Service Coverage",
      "value": "a3Gbb000000PLNsEAO"
    },
    {
      "label": "Insurance",
      "value": "a3Gbb000000PdkdEAC"
    },
    {
      "label": "Inventory Report",
      "value": "a3Gbb000000PLO8EAO"
    },
    {
      "label": "Lease Information",
      "value": "a3Gbb000000PdkfEAC"
    },
    {
      "label": "Leverage",
      "value": "a3Gbb000000a2OHEAY"
    },
    {
      "label": "LF - All",
      "value": "a3Gbb000001GudeEAC"
    },
    {
      "label": "Life Insurance",
      "value": "a3Gbb000000PdknEAC"
    },
    {
      "label": "Limiting Compensation",
      "value": "a3Gbb000000PdkoEAC"
    },
    {
      "label": "Lock Up Event",
      "value": "a3Gbb000001GudmEAC"
    },
    {
      "label": "Maintain Accounts",
      "value": "a3Gbb000000PdklEAC"
    },
    {
      "label": "Maximum Debt to Worth",
      "value": "a3Gbb000000PLNuEAO"
    },
    {
      "label": "Minimum Current Ratio",
      "value": "a3Gbb000000PLO1EAO"
    },
    {
      "label": "Minimum Liquidity",
      "value": "a3Gbb000000PLNyEAO"
    },
    {
      "label": "Minimum Times Interest Earned",
      "value": "a3Gbb000000PLO2EAO"
    },
    {
      "label": "Minimum Working Capital",
      "value": "a3Gbb000000PLO0EAO"
    },
    {
      "label": "Minimum Working Capital Ratio",
      "value": "a3Gbb000000PLNtEAO"
    },
    {
      "label": "Net Profit",
      "value": "a3Gbb000000PLNwEAO"
    },
    {
      "label": "Net Worth",
      "value": "a3Gbb000000PLNxEAO"
    },
    {
      "label": "Other",
      "value": "a3Gbb000001GudqEAC"
    },
    {
      "label": "Personal Financial Statement",
      "value": "a3Gbb000000PLO6EAO"
    },
    {
      "label": "Real Estate Taxes",
      "value": "a3Gbb000000PdkeEAC"
    },
    {
      "label": "Regulatory Reports",
      "value": "a3Gbb000001GudoEAC"
    },
    {
      "label": "Rent Roll",
      "value": "a3Gbb000000PLO9EAO"
    },
    {
      "label": "Sales Report",
      "value": "a3Gbb000000PLO7EAO"
    },
    {
      "label": "Securitisation - All",
      "value": "a3Gbb000001GudZEAS"
    },
    {
      "label": "Seller / Servicer / SPV solvency certificate",
      "value": "a3Gbb000001GudnEAC"
    },
    {
      "label": "Servicer/Asset Reports",
      "value": "a3Gbb000001GudzEAC"
    },
    {
      "label": "Tax Returns",
      "value": "a3Gbb000000PLO5EAO"
    },
    {
      "label": "Term Covenants",
      "value": "a3Gbb000000PdkaEAC"
    }
  ];
  var COLLATERAL_TYPES = [
    {
      "label": "GOVT - Governmental-Motor Vehicle-1518",
      "value": "a33bb000001NA1JAAW"
    },
    {
      "label": "Other-Government Contracts",
      "value": "a33bb000000lBWuAAM"
    },
    {
      "label": "Possessory-Letter of Credit",
      "value": "a33bb000000lBWUAA2"
    },
    {
      "label": "Possessory-Life Insurance",
      "value": "a33bb000000lBWWAA2"
    },
    {
      "label": "Possessory-Note/Instrument",
      "value": "a33bb000000lBWSAA2"
    },
    {
      "label": "Possessory-Other Possessory",
      "value": "a33bb000000lBWVAA2"
    },
    {
      "label": "Possessory-Receipts/Bills",
      "value": "a33bb000000lBWTAA2"
    },
    {
      "label": "Possessory-Savings/CDs",
      "value": "a33bb000000lBWQAA2"
    },
    {
      "label": "Possessory-Securities",
      "value": "a33bb000000lBWRAA2"
    },
    {
      "label": "Real Estate-1-4 Family",
      "value": "a33bb000000lBWJAA2"
    },
    {
      "label": "Real Estate-Construction",
      "value": "a33bb000000lBWHAA2"
    },
    {
      "label": "Real Estate-Farm Land",
      "value": "a33bb000000lBWpAAM"
    },
    {
      "label": "Real Estate-Land",
      "value": "a33bb000000lBWoAAM"
    },
    {
      "label": "Real Estate-Lot",
      "value": "a33bb000000lBWmAAM"
    },
    {
      "label": "Real Estate-Mobile Home",
      "value": "a33bb000000lBWnAAM"
    },
    {
      "label": "Real Estate-Multi-Family",
      "value": "a33bb000000lBWlAAM"
    },
    {
      "label": "Real Estate-Office",
      "value": "a33bb000000lBWqAAM"
    },
    {
      "label": "Real Estate-Other RE",
      "value": "a33bb000000lBWtAAM"
    },
    {
      "label": "Real Estate-Retail",
      "value": "a33bb000000lBWsAAM"
    },
    {
      "label": "Real Estate-Warehouse",
      "value": "a33bb000000lBWrAAM"
    },
    {
      "label": "Titled-Aircraft",
      "value": "a33bb000000lBWNAA2"
    },
    {
      "label": "Titled-Mobile Home",
      "value": "a33bb000000lBWKAA2"
    },
    {
      "label": "Titled-Motor Vehicle",
      "value": "a33bb000000lBWIAA2"
    },
    {
      "label": "Titled-Other Titled",
      "value": "a33bb000000lBWPAA2"
    },
    {
      "label": "Titled-Pleasure Boat",
      "value": "a33bb000000lBWLAA2"
    },
    {
      "label": "Titled-Ship",
      "value": "a33bb000000lBWMAA2"
    },
    {
      "label": "Titled-Trailer",
      "value": "a33bb000000lBWOAA2"
    },
    {
      "label": "Titled-Vessel",
      "value": "a33bb000000lBWvAAM"
    },
    {
      "label": "UCC-Accounts",
      "value": "a33bb000000lBWZAA2"
    },
    {
      "label": "UCC-Chattel Paper",
      "value": "a33bb000000lBWYAA2"
    },
    {
      "label": "UCC-Consumer Goods",
      "value": "a33bb000000lBWfAAM"
    },
    {
      "label": "UCC-Crops",
      "value": "a33bb000000lBWhAAM"
    },
    {
      "label": "UCC-Equipment",
      "value": "a33bb000000lBWaAAM"
    },
    {
      "label": "UCC-Farm Equipment",
      "value": "a33bb000000lBWeAAM"
    },
    {
      "label": "UCC-Farm Products",
      "value": "a33bb000000lBWcAAM"
    },
    {
      "label": "UCC-Fixtures",
      "value": "a33bb000000lBWiAAM"
    },
    {
      "label": "UCC-General Intangibles",
      "value": "a33bb000000lBWbAAM"
    },
    {
      "label": "UCC-Inventory",
      "value": "a33bb000000lBWXAA2"
    },
    {
      "label": "UCC-Livestock",
      "value": "a33bb000000lBWdAAM"
    },
    {
      "label": "UCC-Minerals, Oil and Gas",
      "value": "a33bb000000lBWkAAM"
    },
    {
      "label": "UCC-Standing Timber",
      "value": "a33bb000000lBWjAAM"
    },
    {
      "label": "UCC-Tort Claim",
      "value": "a33bb000000lBWgAAM"
    }
  ];

  var CATALOG = {
    content: [
      {
        isSuccess: true,
        outputValues: {
          fields: [
            {
              objectName: "LLC_BI__Covenant2__c",
              fieldName: "LLC_BI__Covenant_Type__c",
              source: "catalog",
              values: COVENANT_TYPES,
              acceptedValues: [],
              note: "Every covenant type record in the org. The tool matches covenantTypeName against Name.",
            },
            {
              objectName: "LLC_BI__Collateral__c",
              fieldName: "LLC_BI__Collateral_Type__c",
              source: "catalog",
              values: COLLATERAL_TYPES,
              acceptedValues: COLLATERAL_TYPES.map(function (v) {
                return v.label;
              }),
              note: "A type whose own advance rate is null is refused on the insert.",
            },
          ],
        },
      },
    ],
  };

  /* ------------------------------------------------------------- the intake */

  var planCount = 0;

  /** One create step and one verify step per record, in the contract's own
   *  names, with the objects and the fields the tool actually writes. */
  var stepsFor = function (covenants, collateral) {
    var steps = [];
    covenants.forEach(function (c, i) {
      steps.push({
        id: "covenant_create_" + i,
        type: "write",
        state: "pending",
        objectName: "LLC_BI__Covenant2__c",
        label: "Author the " + c.covenantTypeName + " covenant on the relationship",
        fields: [
          "LLC_BI__Covenant_Type__c",
          "Acnpex_Operator__c",
          "Financial_Indicator_Operator__c",
          "LLC_BI__Financial_Indicator_Value__c",
          "LLC_BI__Frequency__c",
          "LLC_BI__Effective_Date__c",
        ],
        verification: "SELECT Id, Name FROM LLC_BI__Covenant2__c WHERE Id = :newId",
        automationWoken: [],
      });
      steps.push({
        id: "covenant_verify_" + i,
        type: "verification",
        state: "pending",
        objectName: "LLC_BI__Account_Covenant__c",
        label: "Confirm the " + c.covenantTypeName + " junction landed on the account",
        fields: ["LLC_BI__Account__c", "LLC_BI__Covenant2__c"],
        automationWoken: [],
      });
    });
    collateral.forEach(function (c, i) {
      steps.push({
        id: "collateral_create_" + i,
        type: "write",
        state: "pending",
        objectName: "LLC_BI__Collateral__c",
        label: "File " + c.description,
        fields: ["LLC_BI__Collateral_Type__c", "LLC_BI__Description__c", "LLC_BI__Value__c"],
        verification: "SELECT Id, Name FROM LLC_BI__Collateral__c WHERE Id = :newId",
        automationWoken: [],
      });
      steps.push({
        id: "collateral_verify_" + i,
        type: "verification",
        state: "pending",
        objectName: "LLC_BI__Account_Collateral__c",
        label: "Confirm the ownership junction for " + c.description,
        fields: ["LLC_BI__Account__c", "LLC_BI__Collateral__c"],
        automationWoken: [],
      });
    });
    return steps;
  };

  var parse = function (raw) {
    if (!raw) return [];
    try {
      var out = JSON.parse(raw);
      return Array.isArray(out) ? out : [];
    } catch (e) {
      return [];
    }
  };

  /** THE ORG'S OWN REFUSALS, BY INDEX. A name the catalog does not hold, a value
   *  at or below zero, and anything past ten. */
  var refusalsFor = function (covenants, collateral) {
    var out = [];
    var covNames = {};
    COVENANT_TYPES.forEach(function (v) {
      covNames[v.label.toLowerCase()] = true;
    });
    var colNames = {};
    COLLATERAL_TYPES.forEach(function (v) {
      colNames[v.label.toLowerCase()] = true;
    });
    covenants.forEach(function (c, i) {
      if (!covNames[String(c.covenantTypeName || "").toLowerCase()]) {
        out.push({ index: i, reason: "No covenant type named " + c.covenantTypeName + " exists in this org." });
      }
    });
    collateral.forEach(function (c, i) {
      if (!colNames[String(c.collateralType || "").toLowerCase()]) {
        out.push({ index: i, reason: "No collateral type named " + c.collateralType + " exists in this org." });
      }
      if (!(Number(c.value) > 0)) out.push({ index: i, reason: "A collateral value must be above zero." });
    });
    return out;
  };

  var stageIntake = function (input) {
    var req = (input && input.inputs && input.inputs[0]) || {};
    var covenants = parse(req.covenantsJson);
    var collateral = parse(req.collateralJson);
    window.__DRIVE_OUT.staged.push({ at: since(), request: req, covenants: covenants, collateral: collateral });
    mark("stage:relationship_intake");

    var refusals = refusalsFor(covenants, collateral);
    var keptCov = covenants.filter(function (_, i) {
      return !refusals.some(function (r) {
        return r.index === i && r.reason.indexOf("covenant type") > -1;
      });
    });
    var keptCol = collateral.filter(function (_, i) {
      return !refusals.some(function (r) {
        return r.index === i && r.reason.indexOf("collateral") > -1;
      });
    });
    planCount += 1;
    var n = keptCov.length + keptCol.length;
    return {
      content: [
        {
          isSuccess: true,
          outputValues: {
            ok: true,
            result: {
              planId: "a4Fbb00000INTAKE" + planCount,
              planHash: "h" + planCount + "9f2c41ab",
              decisionToken: "tok-" + planCount + "-6d21f0",
              accountId: req.accountId,
              summary:
                n === 1
                  ? "One record is authored on the relationship, with its account junction."
                  : n + " records are authored on the relationship, each with its account junction.",
              steps: stepsFor(keptCov, keptCol),
              warnings: keptCol.length
                ? ["No pledge and no lien is written. Nothing about facility coverage moves."]
                : ["No compliance row is minted and no approval is raised."],
              refusals: refusals,
              itemCount: n,
            },
          },
        },
      ],
    };
  };

  var executeIntake = function (input) {
    var req = (input && input.inputs && input.inputs[0]) || {};
    var last = window.__DRIVE_OUT.staged[window.__DRIVE_OUT.staged.length - 1] || { covenants: [], collateral: [] };
    window.__DRIVE_OUT.executed.push({ at: since(), request: req });
    mark("execute:relationship_intake");
    var items = [];
    var steps = [];
    last.covenants.forEach(function (c, i) {
      var id = "a2Xbb0000COV" + i + "AAK";
      items.push({ recordId: id, recordName: "COV-00099" + i, outcome: c.covenantTypeName + " authored." });
      steps.push({ id: "covenant_create_" + i, type: "write", state: "verified", label: "Author the " + c.covenantTypeName + " covenant on the relationship", detail: "Covenant " + id + " inserted." });
      steps.push({ id: "covenant_verify_" + i, type: "verification", state: "verified", label: "Confirm the junction landed on the account", detail: "Account junction a2Ybb0000JCT" + i + " reads back." });
    });
    last.collateral.forEach(function (c, i) {
      var id = "a34bb0000COL" + i + "AAK";
      items.push({ recordId: id, recordName: "COL-00088" + i, outcome: c.description + " filed, unpledged." });
      steps.push({ id: "collateral_create_" + i, type: "write", state: "verified", label: "File " + c.description, detail: "Collateral " + id + " inserted." });
      steps.push({ id: "collateral_verify_" + i, type: "verification", state: "verified", label: "Confirm the ownership junction for " + c.description, detail: "Ownership junction a35bb0000OWN" + i + " reads back." });
    });
    return {
      content: [
        {
          isSuccess: true,
          outputValues: {
            ok: true,
            result: {
              stagingId: req.stagingId,
              terminalState: "completed",
              steps: steps,
              items: items,
              outcome: items.length + " records authored on the relationship and every junction read back.",
            },
          },
        },
      ],
    };
  };

  window.claude = window.claude || {};
  window.claude.mcp = {
    callTool: function (server, tool, input) {
      if (tool === "Customer360Catalog") {
        window.__DRIVE_OUT.catalogCalls += 1;
        mark("catalog");
        return Promise.resolve({ payload: CATALOG });
      }
      if (tool === "stage_relationship_intake") return Promise.resolve({ payload: stageIntake(input) });
      if (tool === "execute_relationship_intake") return Promise.resolve({ payload: executeIntake(input) });
      if (/^(stage|execute)_/.test(tool)) {
        return Promise.reject(new Error("probe: only the intake pair is open in this drive"));
      }
      if (tool === "outlook_email_search") return Promise.resolve({ payload: {} });
      return Promise.resolve({ payload: { content: [{ isSuccess: true, outputValues: { ok: true, result: {} } }] } });
    },
    watchTool: function () {
      return function () {};
    },
    listTools: function () {
      return Promise.resolve({ servers: [{ server: "Customer 360", authStatus: "connected", tools: [] }] });
    },
    invalidate: function () {
      return Promise.resolve();
    },
  };

  /* ------------------------------------------------------- the session door */

  var sample = function (prompt, options) {
    var kind = /The room has just OPENED/.test(prompt) ? "greeting" : "narrate";
    window.__DRIVE_OUT.prompts.push({ kind: kind, at: since(), text: prompt });
    mark("sample:" + kind);
    var text = "Hartwell's relationship sits on six facilities and six covenants.\nWhich review are we running?";
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
