/* PROBE HARNESS ONLY — A STAND-IN CONNECTOR.

   THIS IS NOT A SIMULATION MODE. The app refuses to invent a plan: with no
   connector the workroom says so and burns nothing, which is the channel-none
   doctrine and is asserted in the unit suite. But the room's EXECUTE-SIDE
   CHOREOGRAPHY — the structured loader, the halo, the dossier constructing
   itself, and the write-back rolling the cockpit's figures behind the blur —
   only exists on the far side of a successful write, and those are acceptance
   numbers the mint is gated on.

   So the probe supplies an org-shaped `window.claude.mcp` of its own, OUTSIDE
   the app, and only when `--stub-connector` is passed. Nothing here ships: the
   artifact's own build fails closed on simulation markers, and this file is
   never bundled.

   Original note: A stand-in connector so the room's execute path can be
   MEASURED without a live org. It lives in the probe, never in the artifact:
   the app itself refuses to simulate, which is why nothing like this can be
   shipped inside it. */
(function () {
  var ok = function (result) {
    return { payload: { content: [{ isSuccess: true, outputValues: { ok: true, result: result } }] } };
  };
  var HASH = "9c41e08bf27a4d10";
  /* HAS ANYTHING BEEN FILED IN THIS PAGE? The trail below answers only after an
     execute has run, so every surface that has NOT filed sees exactly the empty
     trail it saw before this stand-in learned to answer at all. */
  var filed = false;

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

  window.claude = window.claude || {};
  window.claude.mcp = {
    callTool: function (server, tool, input) {
      var one = (((input || {}).inputs || [])[0]) || {};
      if (/^stage_/.test(tool)) {
        return Promise.resolve(ok({
          stagingId: "a5Sbb0000001PROBE",
          planHash: HASH,
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
          facilityCount: (one.facilities || []).length
        }));
      }
      if (/^execute_/.test(tool)) {
        /* A real org takes seconds; the loader is a thing the probe has to be
           able to SEE, so the stand-in takes a moment too. */
        filed = true;
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(ok({
          stagingId: "a5Sbb0000001PROBE",
          terminalState: "completed",
          outcome: "completed",
          cloneLoanId: "a4Zbb0000027NpMEAU",
          /* THE VERSION THE FILING MADE. A real execute returns one and the
             filed sheet names it; a stand-in that did not would shoot a sheet
             whose title is missing the fact the founder asked it to carry. */
          outputPackageId: "a5Fbb000000J61hEAC",
          approvalQueue: "Loan Committee",
          bookingHandoff: "Booking runs through nCino's own Submit for Approval; this does not book the facility.",
          approvalChainStarted: true,
          facilities: (((input || {}).inputs || [])[0].facilities || []).map(function (f, i) {
            /* ONE CLONE PER FACILITY, with an id of its own. The stand-in used to hand
               the SAME clone id back for every facility, which put one record id on
               every row of the filed ledger and read like a mapping defect in the
               room. The room was right; the org was repeating itself. */
            return { facilityId: f.facilityId || ("a4Zbb000002" + i), loanId: "a4Zbb0000027NpM" + i + "AU", cloneLoanId: "a4Zbb0000027NpM" + i + "AU", status: "Qualification" };
          }),
          facilityCount: 1
          })); }, 1800);
        });
      }
      /* THE BRAIN LANE'S OWN DOOR. The room routes a question it cannot answer
         over the artifact<->session bridge, which is the gateway completion
         tool, and hard-validates the reply against the three contract shapes.
         The stand-in answers IN CONTRACT so the lane's rendering can be shot;
         it invents nothing the pack does not already publish as its worked
         example. Same rule as everything else here: probe harness only, never
         bundled, and the app itself still refuses to simulate. */
      if (/get_llm_response/.test(tool)) {
        var prompt = String((input || {}).prompt || "");
        var line = "";
        try { line = (JSON.parse(prompt.slice(prompt.indexOf("{"))) || {}).line || ""; } catch (e) { line = prompt; }
        var reply = /borrower|who|structure|part(y|ies)|guarantor/i.test(line)
          ? {
              type: "read-card",
              topic: "involvements",
              title: "Borrowing structure on the Hartwell package",
              rows: [
                { icon: "borrower", label: "Hartwell Precision Manufacturing LLC", value: "Borrower", sub: "all 6 facilities . Operating Company . 100%" },
                { icon: "guarantor", label: "Hartwell Industrial Holdings LLC", value: "Guarantor", sub: "all 6 . unlimited . EPC" },
                { icon: "guarantor", label: "James Hartwell", value: "Guarantor", sub: "all 6 . unlimited . individual" },
                { icon: "warn", label: "Elena Hartwell", value: "Limited Guarantor", sub: "HW1001 capped $5.0MM . HW1003 capped $4.0MM" },
                { icon: "facility", label: "Hartwell Logistics LLC", value: "Related Entity", sub: "HW1003 construction only" }
              ],
              followUp: "Who should be added, and on which facility?"
            }
          : {
              type: "clarify",
              text: "Which line do you mean? The relationship carries two.",
              options: [
                { label: "Revolving line, $15.0MM", say: "the revolving line of credit" },
                { label: "Seasonal line, $2.5MM", say: "the seasonal line of credit" }
              ]
            };
        return Promise.resolve({ payload: { statusCode: 200, body: JSON.stringify({ response: JSON.stringify(reply) }) } });
      }
      /* THE STAGING RECORD THE SHEET CONFIRMS AGAINST. The room reads this once
         behind the sheet to turn "pending" into a settled figure; a stand-in org
         that stayed silent would shoot every surface with the unconfirmed line
         on it, which is the exception rather than the ordinary afternoon. */
      if (filed && /ActionHistory/.test(tool)) {
        return Promise.resolve(readOk({
          entries: [
            {
              stagingId: "a5Sbb0000001PROBE",
              status: "Completed",
              actionId: "loan-modification",
              executedAt: new Date().toISOString(),
              productPackageId: "a5Fbb000000J61hEAC"
            }
          ],
          count: 1
        }));
      }
      var slice = baked(tool, input);
      if (slice) return Promise.resolve(readOk(slice));
      return Promise.resolve(ok({}));
    },
    watchTool: function () { return function () {}; },
    listTools: function () { return Promise.resolve({ servers: [{ server: "Customer 360", authStatus: "connected", tools: [] }] }); },
    invalidate: function () { return Promise.resolve(); }
  };
})();
