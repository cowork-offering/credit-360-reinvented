/**
 * Customer360Bundle, the six relationship reads the cockpit opens with, in ONE
 * invocation.
 *
 * WHY IT EXISTS. The cockpit page opens a relationship by calling six tools
 * (Snapshot, RelationshipGraph, Exposure, Covenants, Opportunities,
 * StructuralSignals), each of which crosses the claude.ai artifact-to-connector
 * relay separately. That relay was measured at 243-542ms per call on
 * 2026-09-06, and 300-800ms is the working range. If the relay serialises those
 * six the open costs six round trips; this collapses them to one.
 *
 * MEASURED BEFORE IT WAS WRITTEN (bankinggpt sandbox, Piedmont, 2026-09-06):
 * the six run back to back in a single transaction in 393ms, spending 15 SOQL
 * of 100, 104ms CPU of 10,000 and 2.5 KB of heap. There is no governor risk in
 * composing them; the only question a bundle answers is how many times the page
 * pays the relay.
 *
 * AND IT IS NOT A NEW READ. Every slice here is the EXISTING tool's own method,
 * called unchanged, so there is exactly one implementation of each read and no
 * second place for a field to drift. This class adds no query of its own.
 *
 * THE SLICES TRAVEL AS JSON STRINGS, deliberately. An invocable that nested six
 * other classes' Apex-defined Response types would be a new wire contract with
 * six new ways to be wrong at the platform boundary; a JSON string per slice is
 * byte-identical to what the individual tool already returns under
 * `outputValues`, so a caller unwraps it with `JSON.deserializeUntyped` and
 * every existing reader downstream is unchanged. `errorsBySlice` carries the
 * one-line reason for any slice that failed, and a failed slice NEVER takes the
 * other five down: that is the same doctrine the page's own lanes run under.
 *
 * NOT YET REACHABLE FROM THE PAGE. This class is deployed and callable in Apex;
 * it is NOT in the Customer360 mcpServerDefinition, so no connector exposes it.
 * Wiring it is three steps and a founder's call, because the middle one
 * republishes the MCP server the demo runs on:
 *   1. add a `tools` block for `Customer360Bundle` to
 *      Customer360.mcpServerDefinition-meta.xml;
 *   2. deploy that file, then have each viewer REFRESH the Customer 360
 *      connector in claude.ai so its cached tool list picks the tool up;
 *   3. add `Customer360Bundle` to client-360/assets/capabilities.json and
 *      republish the artifact, or the first call is refused not_in_manifest.
 * Until all three are done the page opens six-wide, which is what it does now.
 *
 * All objects and fields are the ones the six tools already verified live
 * against the bankinggpt sandbox. This class touches none of them directly.
 */
global with sharing class Customer360Bundle {

    global class Request {
        @InvocableVariable(label='Account Id' description='Salesforce Account Id of the customer/relationship anchor.' required=true)
        global String accountId;
    }

    global class Response {
        @InvocableVariable(label='Account Id')
        global String accountId;
        @InvocableVariable(label='Snapshot (JSON)' description='Customer360Snapshot output for this account, as JSON.')
        global String snapshot;
        @InvocableVariable(label='Relationship Graph (JSON)')
        global String relationshipGraph;
        @InvocableVariable(label='Exposure (JSON)')
        global String exposure;
        @InvocableVariable(label='Covenants (JSON)')
        global String covenants;
        @InvocableVariable(label='Opportunities (JSON)')
        global String opportunities;
        @InvocableVariable(label='Structural Signals (JSON)')
        global String structuralSignals;
        @InvocableVariable(label='Slices that failed' description='One line per slice that could not be read. Empty when all six answered.')
        global List<String> errorsBySlice;
        @InvocableVariable(label='Note')
        global String note;
    }

    @InvocableMethod(
        label='Customer 360: Relationship Bundle'
        description='The six relationship reads in one call: snapshot, relationship graph, exposure, covenants, opportunities and structural signals, each as JSON. Same data as the six individual tools, one round trip. A slice that fails is named in errorsBySlice and does not take the others down.'
    )
    global static List<Response> getBundle(List<Request> requests) {
        List<Response> results = new List<Response>();

        for (Request req : requests) {
            Response res = new Response();
            res.accountId = req.accountId;
            res.errorsBySlice = new List<String>();

            /* ONE SLICE'S TROUBLE IS ONE SLICE'S TROUBLE. Each read is caught on
               its own so a covenant query that trips over a permission leaves
               the other five figures on the banker's screen, exactly what the
               page's per-lane doctrine does when the six are called separately.
               A bundle that failed whole would be a downgrade dressed as a
               speed-up. */
            try {
                Customer360Snapshot.Request r = new Customer360Snapshot.Request();
                r.accountId = req.accountId;
                List<Customer360Snapshot.Response> out = Customer360Snapshot.getSnapshot(new List<Customer360Snapshot.Request>{ r });
                if (!out.isEmpty()) res.snapshot = JSON.serialize(out[0]);
            } catch (Exception e) {
                res.errorsBySlice.add('snapshot: ' + e.getMessage());
            }

            try {
                Customer360RelationshipGraph.Request r = new Customer360RelationshipGraph.Request();
                r.accountId = req.accountId;
                List<Customer360RelationshipGraph.Response> out = Customer360RelationshipGraph.getRelationshipGraph(new List<Customer360RelationshipGraph.Request>{ r });
                if (!out.isEmpty()) res.relationshipGraph = JSON.serialize(out[0]);
            } catch (Exception e) {
                res.errorsBySlice.add('relationshipGraph: ' + e.getMessage());
            }

            try {
                Customer360Exposure.Request r = new Customer360Exposure.Request();
                r.accountId = req.accountId;
                List<Customer360Exposure.Response> out = Customer360Exposure.getExposure(new List<Customer360Exposure.Request>{ r });
                if (!out.isEmpty()) res.exposure = JSON.serialize(out[0]);
            } catch (Exception e) {
                res.errorsBySlice.add('exposure: ' + e.getMessage());
            }

            try {
                Customer360Covenants.Request r = new Customer360Covenants.Request();
                r.accountId = req.accountId;
                List<Customer360Covenants.Response> out = Customer360Covenants.getCovenants(new List<Customer360Covenants.Request>{ r });
                if (!out.isEmpty()) res.covenants = JSON.serialize(out[0]);
            } catch (Exception e) {
                res.errorsBySlice.add('covenants: ' + e.getMessage());
            }

            try {
                Customer360Opportunities.Request r = new Customer360Opportunities.Request();
                r.accountId = req.accountId;
                List<Customer360Opportunities.Response> out = Customer360Opportunities.getOpportunities(new List<Customer360Opportunities.Request>{ r });
                if (!out.isEmpty()) res.opportunities = JSON.serialize(out[0]);
            } catch (Exception e) {
                res.errorsBySlice.add('opportunities: ' + e.getMessage());
            }

            try {
                Customer360StructuralSignals.Request r = new Customer360StructuralSignals.Request();
                r.accountId = req.accountId;
                List<Customer360StructuralSignals.Response> out = Customer360StructuralSignals.getStructuralSignals(new List<Customer360StructuralSignals.Request>{ r });
                if (!out.isEmpty()) res.structuralSignals = JSON.serialize(out[0]);
            } catch (Exception e) {
                res.errorsBySlice.add('structuralSignals: ' + e.getMessage());
            }

            res.note = res.errorsBySlice.isEmpty()
                ? 'All six slices read in one call.'
                : String.valueOf(res.errorsBySlice.size()) + ' of 6 slices could not be read; the rest are current.';
            results.add(res);
        }

        return results;
    }
}
