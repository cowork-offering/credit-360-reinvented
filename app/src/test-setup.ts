/* PER-TEST ISOLATION FOR THE READ SEAM (0.9.30).

   `callTool` holds one in-flight read per question and answers an identical ask
   for five seconds after it settles (SPEC-0.9.30-READ-COALESCING.md). That is
   page-session state, and a suite is many page sessions: a test asking for the
   same read a second test already asked for would be handed the first test's
   answer with no call on the wire. Reset here rather than in two hundred files.

   The read seam's own tests reset it themselves too, because they reset it
   mid-test as well as between tests. */
/* AND FOR THE BOOM WAIT (0.9.31).

   The poll on a file Boom is spreading lives at PAGE level and is deduped by
   Boom's own file id, so a test that watches the same fixture file as the test
   before it would join the first test's loop and never make a call. Same
   reasoning, same place. */
import { beforeEach } from "vitest";
import { __resetReadSeamForTests } from "./channel/mcp";
import { resetBoomWatch } from "./components/workroom/boomWatch";
import { resetBoomFiles } from "./components/workroom/spreadSession";

beforeEach(() => {
  __resetReadSeamForTests();
  resetBoomWatch();
  resetBoomFiles();
});
