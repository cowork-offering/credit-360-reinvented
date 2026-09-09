# brain/ . the Workroom Brain grounding pack

`WORKROOM-BRAIN.md` is the knowledge pack that turns a banker's claude.ai session into a
commercial-credit expert for the Credit 360 cockpit. It is grounding, not code. Nothing in it
executes, and nothing in it writes.

## What it is

One markdown document, consumed by a model as system grounding. It carries four things:

1. The output contract (three permitted shapes, with schemas).
2. nCino doctrine for THIS org (bankinggpt sandbox), as it actually runs.
3. Commercial banking doctrine and the demo bank's credit policy.
4. The tool doors the session may open, bound by tool NAME.

## How it is consumed

The pack is loaded as the system prompt of the workroom agent. Per the architecture resolved with
the founder on 2026-08-31 (`knowledge/SESSION-HANDOFF-20260831.md` section 4), the agent runs as
an MCP tool the page calls through `window.claude.mcp`, not as the surrounding conversation. The
prompt pack lives OUR side: it ships in the artifact bundle and is versioned here in the repo. The
page composes the prompt per turn, sends it, then parses and schema-validates the reply. A malformed
reply is treated as unparsed and falls back to the deterministic parser.

Consequence: iterating this pack is an artifact republish. No server deploy.

```
brain/WORKROOM-BRAIN.md   ->  bundled into the artifact  ->  composed per turn
                                                             + live deal read
                                                             + the banker's line
                                                          ->  completion pipe
                                                          ->  schema validation
                                                          ->  card / delta / clarify
```

## The fence

The agent PROPOSES. The deterministic spine WRITES. That split is the SR 11-7 control and it does
not move:

- describe validation at stage time,
- an immutable plan and a plan hash,
- a single-use decision token,
- one human approval,
- re-query verification after execution.

The agent never calls an `execute_*` tool, never mints a token, never sees the approve step. Its
delta proposals enter the same path a typed line enters, and are validated identically.

## Maintaining it

- Every factual claim about the org carries an HTML comment naming its source file. Keep them.
  If a claim loses its source, delete the claim.
- The org moves. When `knowledge/sf-build-v2/recon-*.md` or `OBJECT-COVERAGE.md` changes, re-check
  section 2 of the pack against it.
- The wire schema in section 1 is authored from `knowledge/sf-build-v2/wp2/classes/StageLoanModification.cls`
  and `app/src/channel/writeTools.ts`. Those two files are the authority. If they disagree with the
  pack, the pack is wrong.
- Banking content is standard practice only. Every number in section 5 must be defensible as
  convention. Nothing exotic, nothing invented.
- No em dashes anywhere in this directory. Founder style rule.

## Known gaps, carried deliberately

- No read tool returns package or loan level covenant junctions (`LLC_BI__Loan_Covenant__c`).
  `Customer360Covenants` is scoped to relationship level covenants only. Section 2 and the worked
  example in section 7 say so rather than pretending otherwise.
- Pricing detail does not exist on the Hartwell records. The two pricing streams are header only,
  with no rate or payment components, so there is no stored index, spread, floor or schedule to
  read. The agent must not state a spread from the org; spreads come from the Boom door or from the
  banker.
- The decision ledger (`recall_decisions`) is a session level connector, not a page tool. It answers
  "why did we" questions. It is never a source for a figure in a proposal.
