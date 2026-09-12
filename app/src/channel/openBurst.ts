import { LAUNCH_GAP_MS, MAX_IN_FLIGHT } from "./syncSweep";

/* =============================================================================
   THE OPEN BURST REGISTER — how wide an open may go, and what narrows it.

   LIFTED OUT OF `openRefresh.ts` ON 2026-09-12 (founder latency brief: "110%
   zero latency and smooth transitions etc in all workrooms and chats"). The
   policy itself is unchanged and `openRefresh` still re-exports every name it
   published. What changed is only WHO may read it: the live-open aggregate
   (`book/aggregate.ts`) now paces itself off this same register, and importing
   `openRefresh` to get at it would have put a cycle through React state
   (aggregate -> openRefresh -> appState -> dynamicBook -> aggregate). This
   module imports nothing but two numbers, so every reader can have it.

   ALL SIX AT ONCE, AND THAT IS MEASURED. Against the real backup connector on
   2026-09-06: six reads issued serially cost 243-542ms each; the same six
   issued together answered in 534ms of wall clock TOTAL. The org and the
   transport serve six concurrently for very close to the price of one, so
   paying for three waves buys nothing.

   THE PLATFORM'S OWN WORD IS THE ONLY THING THAT NARROWS IT. Not a guess, not a
   heuristic on latency: `rate_limited` is a code the runtime sends, and until
   it does, six is what the measurement supports. Page-session scoped, because a
   relay that is rationing calls at 22:34 is still rationing them at 22:35.
   ============================================================================= */

/** All six at once. The open is one round trip deep, not three. */
export const OPEN_MAX_IN_FLIGHT = 6;
/** No spacing between them either: a burst of six is what the measurement says
 *  the transport is happy to answer, and a 200ms ladder in front of it only
 *  delays the last read by a second for nothing. */
export const OPEN_LAUNCH_GAP_MS = 0;

let burstAllowed = true;

/** Calls in flight the next open may use. */
export const openInFlightLimit = (): number => (burstAllowed ? OPEN_MAX_IN_FLIGHT : MAX_IN_FLIGHT);
/** Spacing the next open may use. */
export const openLaunchGapMs = (): number => (burstAllowed ? OPEN_LAUNCH_GAP_MS : LAUNCH_GAP_MS);

/** The platform said there were too many. Every open after this one is paced. */
export function noteOpenRateLimited(): void {
  burstAllowed = false;
}

/** Test seam: put the burst policy back the way a fresh page finds it. */
export function __resetOpenBurstForTests(): void {
  burstAllowed = true;
}
