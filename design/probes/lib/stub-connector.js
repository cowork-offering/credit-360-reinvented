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
  /* THE PACKAGE A CREATE OPENS, and the name the org's own convention gives it
     (`<Account> - <M/D/YYYY> - PP`). Both come back from the live tool. */
  var NEW_PACKAGE = "a5Fbb000000NEWPKEAI";
  var NEW_PACKAGE_NAME = "Hartwell Precision Manufacturing LLC - 9/7/2026 - PP";
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
      /* A NEW FACILITY CREATES A NEW PACKAGE (founder, 2026-09-06), and the org
         answers an ACCOUNT anchor with a plan whose first step is
         `create_package` and no package id at all. Shapes staged live against
         Hartwell 2026-09-07: `createsPackage: true`, `productPackageId: null`,
         `plannedPackageName` to the org's own convention. Without these the
         create surfaces shoot a sheet whose title is missing the package the
         filing made, which is the fact the founder asked it to carry. */
      if (/^stage_new_facility/.test(tool)) {
        var creating = !one.productPackageId;
        var nfSteps = [
          { id: "write_loan", type: "write", label: "Create the facility at Qualification", objectName: "LLC_BI__Loan__c" },
          { id: "write_involvement", type: "write", label: "Add the borrower to the facility's borrowing structure", objectName: "LLC_BI__Legal_Entities__c" },
          { id: "verify_loan", type: "verification", label: "Read back the facility and report the name the org assigned", objectName: "LLC_BI__Loan__c" },
          { id: "wait_loan_detail", type: "wait", label: "nCino creates the Loan Detail, then this action continues", objectName: "LLC_BI__Loan_Detail__c" },
          { id: "write_loan_purpose", type: "write", label: "Set the primary loan purpose on the Loan Detail", objectName: "LLC_BI__Loan_Detail__c" },
          { id: "hop_to_proposal", type: "write", label: "Move the facility from Qualification to Proposal", objectName: "LLC_BI__Loan__c" }
        ];
        if (creating) {
          nfSteps.unshift({ id: "create_package", type: "write", label: "Create the credit package " + NEW_PACKAGE_NAME, objectName: "LLC_BI__Product_Package__c" });
        }
        return Promise.resolve(ok({
          stagingId: "a5Sbb0000001PROBE",
          planHash: HASH,
          decisionToken: "4f8ac21e-probe-token",
          summary: creating
            ? "Creates a new credit package for this relationship, named " + NEW_PACKAGE_NAME + " to the org's own convention, then files one facility on it at stage Qualification."
            : "Creates one facility on the package at stage Qualification.",
          steps: nfSteps,
          warnings: [],
          accountId: one.accountId,
          productPackageId: one.productPackageId,
          createsPackage: creating,
          plannedPackageName: creating ? NEW_PACKAGE_NAME : undefined
        }));
      }
      if (/^execute_new_facility/.test(tool)) {
        filed = true;
        var made = !one.productPackageId;
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(ok({
            stagingId: "a5Sbb0000001PROBE",
            terminalState: "success",
            outcome: "Facility filed and moved to Proposal.",
            resumable: false,
            loanId: "a4Zbb000002NEWFACEAA",
            loanDetailId: "a4Wbb000001NEWDETEAW",
            involvementId: "a4Lbb000000NEWINVEAK",
            productPackageId: made ? NEW_PACKAGE : one.productPackageId,
            packageCreated: made,
            stage: "Proposal",
            approvalQueue: "Loan Committee",
            recordName: "Hartwell Precision Manufacturing LLC - Line of Credit - $3,000,000.00",
            steps: [
              { id: "create_package", type: "write", label: "Create the credit package", state: "verified", detail: "Package " + NEW_PACKAGE + " created." },
              { id: "write_loan", type: "write", label: "Create the facility", state: "verified", detail: "Facility a4Zbb000002NEWFACEAA created at Qualification." },
              { id: "write_involvement", type: "write", label: "Add the borrower", state: "verified", detail: "Borrower added at 100.00 percent ownership." },
              { id: "verify_loan", type: "verification", label: "Read back the facility", state: "verified", detail: "The org named this facility Hartwell Precision Manufacturing LLC - Line of Credit - $3,000,000.00." },
              { id: "write_loan_purpose", type: "write", label: "Set the primary loan purpose", state: "verified", detail: "Primary loan purpose set to working capital." },
              { id: "hop_to_proposal", type: "write", label: "Move to Proposal", state: "verified", detail: "Stage moved from Qualification to Proposal." }
            ]
          })); }, 1800);
        });
      }
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
