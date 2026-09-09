import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SIGNAL_WINDOW_DAYS, type Portfolio } from "../data/contract";
import { READ_DEADLINE_MS, SERVERS, TOOLS, callTool, unwrapInvocableOne, type McpFailure } from "./mcp";
import { callGateway, noteServedByBackup, shouldFallBack } from "./gateway/lane";
import { loadBook, putBook } from "./lastGood";
import { portfolioSignature } from "../book/livePortfolio";

export interface LivePortfolio {
  portfolio?: Portfolio;
  /** A structural reading of `portfolio`, so an unchanged book keeps the SAME
   *  object across refetches. See `settle` below. */
  signature?: string;
  failure?: McpFailure;
  /** The platform stamp of a cached answer, or the arrival time of an executed one. */
  storedAt?: number;
  /** A re-registration the banker asked for is in flight. */
  retrying?: boolean;
  /** Read again now: the banker's own gesture on the banner. */
  retry?: () => void;
  /** TRUE ON A FRESH OPEN while the first book is still on its way, cached or
   *  live, and no failure has landed yet. The landing surfaces show a skeleton
   *  in this window rather than the baked test book, so a viewer never watches
   *  the five samples flash before the org's real book arrives. Never true
   *  without a connector: a share link opens on the baked book exactly as
   *  before, with no skeleton. It ends the moment a book arrives, a failure
   *  lands, or the backstop clock runs out. */
  booting?: boolean;
  /** Where the book on screen came from: `cache` is this org's last good book,
   *  painted from the store and marked with its age; `live` is the org answering
   *  this session. Absent until a book has landed. */
  source?: "cache" | "live";
}

/* TEST SEAM: mount the home already settled, the way a returning viewer with a
   warm cache does. A fresh open boots through the skeleton until the first book
   lands (cache or live); a test that mounts the home ONLY to navigate through
   it into an account does not want to drive the portfolio read first, and this
   lets it start with `booting` off. Same `__`-prefixed, test-only convention as
   `__resetOpenBurstForTests`. Never called in the app; the cold-open tests that
   assert the skeleton leave it alone. */
let skipBootForTests = false;
export function __skipBootForTests(v = true): void {
  skipBootForTests = v;
}

/** THE SKELETON'S BACKSTOP. A single portfolio read is bounded inside
 *  `callTool` by READ_DEADLINE_MS, and the failure path ends the skeleton the
 *  instant the read rejects, so this only ever fires for a read that neither
 *  answers nor rejects. It sits just past that deadline: long enough never to
 *  cut a slow-but-live read short, short enough that a wedged open reveals the
 *  baked book under an honest banner rather than shimmering forever. */
export const BOOK_BOOT_MAX_MS = READ_DEADLINE_MS + 2_000;

/** The book does not move second to second, so this sits well above the
 *  platform's ~30s polling floor. It exists so an expired MCP session heals
 *  itself: the poll re-reads on its own and the next good read clears the
 *  banner, instead of the failure standing until the view remounts.
 *
 *  TWO MINUTES SINCE 2026-09-04, from one (founder: the cockpit "seems to
 *  overload" on a shared screen). A refetch is not just a request: it is a
 *  result delivered into React, a KPI band re-rendered and four figures counted
 *  up again, and doing that every minute behind a demo buys nothing: the
 *  portfolio a banker is talking over does not move while they talk. Two
 *  minutes is still four times inside the observed idle expiry this exists to
 *  survive, which is the only thing the interval was ever for. */
export const PORTFOLIO_REFETCH_MS = 120_000;

/**
 * HOW MANY ACCOUNTS THE READ ASKS FOR, and why it is not the tool's default.
 *
 * `Customer360Portfolio` truncates to the 25 highest-TCE accounts unless asked
 * otherwise, and since 2026-09-08 this result is what decides the QUEUE. A book
 * of forty relationships would then have fifteen the landing could not put a
 * row on at all, however loudly they were breaching, purely because they are
 * small. The queue's own cap is thirty, so the read has to be able to see past
 * it: sixty is comfortably above the cap, well inside the tool's own ceiling of
 * a hundred, and still one call. `bookTotals` was always book-wide and is
 * unaffected either way.
 */
export const PORTFOLIO_MAX_ACCOUNTS = 60;

/**
 * THE ONE INPUT SHAPE BOTH DOORS USE, so the poll and the backup can never ask
 * for different books.
 *
 * WHY THE WINDOW IS NOT THE TOOL'S DEFAULT. `Customer360Portfolio` defaults
 * `signalWindowDays` to 90. Measured against the seeded book on 2026-09-08,
 * `maturitiesSoon` came back EMPTY: the one maturity a banker on that book is
 * actually planning around, Prairie Ag's seasonal revolver, falls 153 days out.
 * A window that cannot see it is not a tighter filter, it is a blind spot, and
 * the page said "None in window" over a book with a maturity in it. The number
 * lives in `data/contract.ts` so the read and every sentence the page says
 * about it take it from one place.
 */
const PORTFOLIO_INPUT = {
  maxAccounts: PORTFOLIO_MAX_ACCOUNTS,
  signalWindowDays: SIGNAL_WINDOW_DAYS,
} as const;

/* ------------------------------------------------------- the hidden document

   A cockpit behind a slide deck must not poll. The cost of a refetch is never
   the request alone: it is the render it lands. So the poll is TORN DOWN when
   the page goes away and STARTED AGAIN when it comes back, which also makes
   the return a fresh read rather than a two-minute-old one. */
function subscribeVisibility(cb: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

function documentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/** TRUE while the page is on screen. Server snapshot is `true`: a render with
 *  no document is a render with no poll to pause. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, documentVisible, () => true);
}

/** Keep the home KPI band, and since 2026-09-08 the QUEUE, current from
 *  Customer360Portfolio.
 *
 *  THIS IS A POLL, NOT A WATCH, SINCE 2026-09-09. The read ran as `watchTool`
 *  from 2026-07-25 and carried the 2026-09-03 demo; on 2026-09-09 the founder's
 *  seat opened the cockpit to "Salesforce unreachable: bad_request" over the
 *  baked rows, with the platform's own reason beside it: "declared-write tools
 *  cannot be watched". The runtime allows a watch only on a tool whose
 *  connector declares `readOnlyHint: true`; the Salesforce-hosted MCP server
 *  declares its Apex invocables the other way, every one of them, reads
 *  included, and `Customer360Portfolio` is the only tool the page ever watched.
 *  So the book's read goes through `callTool` like the other nine reads on the
 *  same connector, which were answering in the same minute, and the page keeps
 *  its own two-minute clock. `callTool` also brings what the watch never had:
 *  the retry policy, the wall clock, and a line on the health list.
 *
 *  Failures never blank the band: a transient error keeps the last good data
 *  with a staleness note, and only an authz denial retracts it. */
export function useLivePortfolio(enabled: boolean): LivePortfolio {
  /* BOOTING FROM THE FIRST PAINT, where there is a connector to boot for. The
     initial value is read once; `enabled` is `mcpAvailable()`, stable for the
     life of the session, so a share link starts settled on the baked book and a
     real seat starts on the skeleton. */
  const [live, setLive] = useState<LivePortfolio>({ booting: enabled && !skipBootForTests });
  const visible = usePageVisible();
  /* READ AT START, NOT WATCHED. The seed below wants to know whether a book was
     already on screen when the effect (re)ran, without the effect depending on
     `live` — a dependency there would tear the poll down and start it again on
     its own first result. Same discipline as openRefresh's refs. */
  const hasBookRef = useRef(false);
  hasBookRef.current = !!live.portfolio;
  // Bumped by the banner's Retry: a new value restarts the poll, and the first
  // read of a restart asks for a fresh execution rather than a cached one.
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setLive((prev) => ({ ...prev, retrying: true }));
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !visible) return;
    let dead = false;
    let inFlight = false;
    /* Once the org itself has answered this session, the cached book is history:
       a stored document must never paint back over a live one, however fast it
       arrives from the local store. */
    let landedLive = false;
    /* THE CACHE SEED IS A COLD-OPEN THING ONLY. This effect also re-runs on a
       Retry and on the page coming back into view, and by then a book is
       already on screen; reseeding the cache there would step a current book
       back to an older stamp for the instant before the fresh read lands. If
       there is already a book, the seed is skipped and only the read runs. */
    const hadBookAtStart = hasBookRef.current;

    /* THE SAME BOOK IS THE SAME OBJECT.
       FOUNDER CONDITION ONE, 2026-09-08: no latency, no stuck behaviour. This
       result is the source of the QUEUE, not just of six figures, so its
       identity decides whether the whole cockpit re-renders. The poll re-reads
       every two minutes and hands back a fresh object whether or not a figure
       moved; a book that did not move keeps the object it had, and only the
       freshness stamp advances. A real change replaces it, as it always did.

       AND `booting` ENDS HERE. Whichever book lands first, cached or live, the
       skeleton is done: the surfaces have a real book to render. When a live
       read settles over an identical cached book the object is kept, so nothing
       reflows, and only `storedAt` and `source` advance from the cache's age to
       the current read. */
    const settle = (portfolio: Portfolio, storedAt: number | undefined, source: "cache" | "live") => {
      const signature = portfolioSignature(portfolio);
      setLive((prev) =>
        prev.portfolio && prev.signature === signature
          ? { ...prev, storedAt, failure: undefined, retrying: false, booting: false, source }
          : { portfolio, signature, storedAt, failure: undefined, retrying: false, booting: false, source },
      );
    };

    /* THE CACHED BOOK, FIRST AND LOCAL. One document, one round trip, painted
       only if the org has not already beaten it home. A returning viewer sees
       their own last book instantly, marked with its age; the live read below
       settles over it. With no `db` grant `loadBook` is null and this is a
       silent no-op, exactly as before the store existed. */
    if (!hadBookAtStart) {
      void (async () => {
        const cached = await loadBook(Date.now());
        if (dead || landedLive || !cached) return;
        const pf = cached.payload as Portfolio | undefined;
        if (!pf || !(pf.accounts?.length ?? 0)) return;
        settle(pf, cached.storedAt, "cache");
      })();
    }

    /* THE BACKSTOP. If neither the cache nor the org has produced a book by the
       time this fires, and no failure has either, the skeleton gives way to the
       baked book: a wedged read is not a reason to shimmer forever. */
    const bootTimer = setTimeout(() => {
      if (dead) return;
      setLive((prev) => (prev.booting ? { ...prev, booting: false } : prev));
    }, BOOK_BOOT_MAX_MS);

    /* THE BACKUP LANE IS A ONE-SHOT. When the primary reports a hop failure the
       band asks the backup ONCE, by hand, and feeds the answer through the same
       unwrapper. The poll keeps running underneath and its next good read
       replaces this, which is what recovery looks like. */
    const askBackup = async () => {
      try {
        const ok = await callGateway<Portfolio>(TOOLS.portfolio, [{ ...PORTFOLIO_INPUT }]);
        if (dead) return;
        const slot = unwrapInvocableOne<Portfolio>(ok.payload);
        if (!slot.ok) return;
        noteServedByBackup(ok.cache?.storedAt);
        const stamp = ok.cache?.storedAt ?? Date.now();
        landedLive = true;
        settle(slot.data, stamp, "live");
        // A backup answer is a good answer, and it is remembered like one; the
        // stamp records which door it came through, not whether to trust it.
        void putBook(TOOLS.portfolio, slot.data, stamp, "gateway");
      } catch {
        // Both doors shut. The banner the primary failure raised stands, and it
        // names the lane the banker can actually do something about.
      }
    };

    const read = async (refresh: boolean) => {
      // One flight at a time: a slow org must not stack reads behind the timer.
      if (inFlight) return;
      inFlight = true;
      try {
        const ok = await callTool<unknown>(
          SERVERS.customer360,
          TOOLS.portfolio,
          { inputs: [{ ...PORTFOLIO_INPUT }] },
          { read: true, cache: refresh ? { refresh: true } : { staleTime: PORTFOLIO_REFETCH_MS } },
        );
        if (dead) return;
        const slot = unwrapInvocableOne<Portfolio>(ok.payload);
        if (!slot.ok) {
          // The org answered, even if with nothing to unwrap: the skeleton is
          // done either way, and the baked book stands under whatever comes next.
          setLive((prev) => ({ ...prev, failure: undefined, retrying: false, booting: false }));
          return;
        }
        /* A cached answer carries the platform's own stamp. An answer with no
           cache block was EXECUTED for this call (the contract's word), and a
           declared write is never cached, so the moment it arrived is the
           honest "as of": that is the one case Date.now() states a fact. */
        const stamp = ok.cache?.storedAt ?? Date.now();
        landedLive = true;
        settle(slot.data, stamp, "live");
        // The org's own book, kept where the next open finds it before any
        // connector answers. Fire-and-forget; a no-op with no `db` grant.
        void putBook(TOOLS.portfolio, slot.data, stamp);
      } catch (err) {
        if (dead) return;
        const failure = err as McpFailure;
        setLive((prev) =>
          // Authz denial ⇒ retract rendered data. Transient ⇒ keep last good.
          // Either way the skeleton is over: a failure is a book's worth of
          // answer, and the baked book plus the banner is more honest than a
          // shimmer that never resolves.
          failure.retract
            ? { failure, retrying: false, booting: false }
            : { ...prev, failure, retrying: false, booting: false },
        );
        // Only the conditions the lane already encodes: a denial is about WHO
        // asked, and the backup asks as somebody else.
        if (shouldFallBack(failure)) void askBackup();
      } finally {
        inFlight = false;
      }
    };

    void read(attempt > 0);
    /* TWO MINUTES, on the page's own clock. The reason the interval exists at
       all is the idle expiry of the Salesforce-hosted MCP session: with no
       re-read, the first failure after a pause stood until the view remounted.
       It pauses while the page is hidden (this effect is gone by then). */
    const timer = setInterval(() => void read(true), PORTFOLIO_REFETCH_MS);
    return () => {
      dead = true;
      clearInterval(timer);
      clearTimeout(bootTimer);
    };
  }, [enabled, attempt, visible]);

  return { ...live, retry };
}
