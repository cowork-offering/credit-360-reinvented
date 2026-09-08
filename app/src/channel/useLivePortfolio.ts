import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { SIGNAL_WINDOW_DAYS, type Portfolio } from "../data/contract";
import { SERVERS, TOOLS, unwrapInvocableOne, watchTool, type McpFailure } from "./mcp";
import { callGateway, noteServedByBackup, shouldFallBack } from "./gateway/lane";
import { portfolioSignature } from "../book/livePortfolio";

export interface LivePortfolio {
  portfolio?: Portfolio;
  /** A structural reading of `portfolio`, so an unchanged book keeps the SAME
   *  object across refetches. See `settle` below. */
  signature?: string;
  failure?: McpFailure;
  /** From result.cache.storedAt, never Date.now(). */
  storedAt?: number;
  /** A re-registration the banker asked for is in flight. */
  retrying?: boolean;
  /** Re-register the watch: the banker's own gesture on the banner. */
  retry?: () => void;
}

/** The book does not move second to second, so this sits well above the
 *  platform's ~30s polling floor. It exists so an expired MCP session heals
 *  itself: the watch re-reads on its own and the next good event clears the
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
 * THE ONE INPUT SHAPE BOTH DOORS USE, so the watch and the backup can never ask
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

   A cockpit behind a slide deck must not poll. The platform throttles timers on
   a hidden page but does not stop a watch, and the cost of a refetch is never
   the request alone: it is the render it lands. So the watch is TORN DOWN when
   the page goes away and REGISTERED AGAIN when it comes back, which also makes
   the return a fresh read rather than a two-minute-old one. A quick tab flip is
   served from the watch's own cache (staleTime) and costs nothing at all. */
function subscribeVisibility(cb: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

function documentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/** TRUE while the page is on screen. Server snapshot is `true`: a render with
 *  no document is a render with no watch to pause. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, documentVisible, () => true);
}

/** Keep the home KPI band current from Customer360Portfolio.
 *
 *  This is the DISPLAY arm: watchTool replays the cached entry, refreshes when
 *  stale, and delivers every newer result. The watch layer retries a retryable
 *  failure once before it reports anything, so a connector re-handshake after
 *  an idle session never reaches the banker at all.
 *
 *  Failures never blank the band: a transient error keeps the last good data
 *  with a staleness note, and only an authz denial retracts it. */
export function useLivePortfolio(enabled: boolean): LivePortfolio {
  const [live, setLive] = useState<LivePortfolio>({});
  const visible = usePageVisible();
  // Bumped by the banner's Retry: a new value tears the watch down and
  // registers it again, which is the only way to recover a registration that
  // failed outright.
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setLive((prev) => ({ ...prev, retrying: true }));
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !visible) return;
    /* THE BACKUP LANE IS A ONE-SHOT HERE, NOT A WRAPPED CALL. `watchTool` is a
       subscription with no fallback arm: there is no second registration to
       make and no second stream to reconcile. So when the watch reports a hop
       failure the band asks the backup ONCE, by hand, and feeds the answer
       through the same unwrapper. The watch keeps running underneath and its
       next good event replaces this, which is what recovery looks like. */
    let dead = false;

    /* THE SAME BOOK IS THE SAME OBJECT.
       FOUNDER CONDITION ONE, 2026-09-08: no latency, no stuck behaviour. This
       result is now the source of the QUEUE, not just of six figures, so its
       identity decides whether the whole cockpit re-renders. The watch re-reads
       every two minutes and hands back a fresh object whether or not a figure
       moved; a book that did not move keeps the object it had, and only the
       freshness stamp advances. A real change replaces it, as it always did. */
    const settle = (portfolio: Portfolio, storedAt: number | undefined) => {
      const signature = portfolioSignature(portfolio);
      setLive((prev) =>
        prev.portfolio && prev.signature === signature
          ? { ...prev, storedAt, failure: undefined, retrying: false }
          : { portfolio, signature, storedAt, failure: undefined, retrying: false },
      );
    };

    const askBackup = async () => {
      try {
        const ok = await callGateway<Portfolio>(TOOLS.portfolio, [{ ...PORTFOLIO_INPUT }]);
        if (dead) return;
        const slot = unwrapInvocableOne<Portfolio>(ok.payload);
        if (!slot.ok) return;
        noteServedByBackup(ok.cache?.storedAt);
        settle(slot.data, ok.cache?.storedAt);
      } catch {
        // Both doors shut. The banner the primary failure raised stands, and it
        // names the lane the banker can actually do something about.
      }
    };

    // Store the (synchronous) unsubscribe before anything can fire.
    const stop = watchTool(
      SERVERS.customer360,
      TOOLS.portfolio,
      { inputs: [{ ...PORTFOLIO_INPUT }] },
      (ev) => {
        if (ev.failure) {
          setLive((prev) =>
            // Authz denial ⇒ retract rendered data. Transient ⇒ keep last good.
            ev.failure!.retract
              ? { failure: ev.failure, retrying: false }
              : { ...prev, failure: ev.failure, retrying: false },
          );
          // Only the conditions the lane already encodes: a denial is about WHO
          // asked, and the backup asks as somebody else.
          if (shouldFallBack(ev.failure)) void askBackup();
          return;
        }
        const slot = unwrapInvocableOne<Portfolio>(ev.data?.payload);
        if (!slot.ok) {
          setLive((prev) => ({ ...prev, failure: undefined, retrying: false }));
          return;
        }
        // A good event is what clears the banner. Nothing else does.
        settle(slot.data, ev.data?.cache?.storedAt);
      },
      {
        staleTime: 120_000,
        /* POLLING IS BACK, at a minute, and deliberately.
           It was removed on 2026-07-25 because a tighter loop starved the chat
           of connector budget. What put it back is the stuck banner: the
           Salesforce-hosted MCP session expires on idle, and with no poll and
           no retry the first failure after a pause was the LAST event the watch
           ever delivered. A minute is twice the platform's ~30s floor, is
           coalesced per identity so every section costs one flight, and pauses
           while the page is hidden. */
        refetchInterval: PORTFOLIO_REFETCH_MS,
      },
    );
    return () => {
      dead = true;
      stop();
    };
  }, [enabled, attempt, visible]);

  return { ...live, retry };
}
