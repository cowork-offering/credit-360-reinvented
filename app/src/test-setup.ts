/* PER-TEST ISOLATION FOR THE READ SEAM (0.9.30).

   `callTool` holds one in-flight read per question and answers an identical ask
   for five seconds after it settles (SPEC-0.9.30-READ-COALESCING.md). That is
   page-session state, and a suite is many page sessions: a test asking for the
   same read a second test already asked for would be handed the first test's
   answer with no call on the wire. Reset here rather than in two hundred files.

   The read seam's own tests reset it themselves too, because they reset it
   mid-test as well as between tests. */
import { beforeEach } from "vitest";
import { __resetReadSeamForTests } from "./channel/mcp";

beforeEach(() => {
  __resetReadSeamForTests();
});
