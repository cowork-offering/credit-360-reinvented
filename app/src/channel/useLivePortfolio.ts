import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Portfolio } from "../data/contract";
import { SERVERS, TOOLS, unwrapInvocableOne, watchTool, type McpFailure } from "./mcp";
import { callGateway, noteServedByBackup, shouldFallBack } from "./gateway/lane";

export interface LivePortfolio {
  portfolio?: Portfolio;
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

    const askBackup = async () => {
      try {
        const ok = await callGateway<Portfolio>(TOOLS.portfolio, [{}]);
        if (dead) return;
        const slot = unwrapInvocableOne<Portfolio>(ok.payload);
        if (!slot.ok) return;
        noteServedByBackup(ok.cache?.storedAt);
        setLive({ portfolio: slot.data, storedAt: ok.cache?.storedAt, failure: undefined, retrying: false });
      } catch {
        // Both doors shut. The banner the primary failure raised stands, and it
        // names the lane the banker can actually do something about.
      }
    };

    // Store the (synchronous) unsubscribe before anything can fire.
    const stop = watchTool(
      SERVERS.customer360,
      TOOLS.portfolio,
      { inputs: [{}] },
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
        setLive({ portfolio: slot.data, storedAt: ev.data?.cache?.storedAt, failure: undefined, retrying: false });
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
