/* =============================================================================
   NO AWAIT WITHOUT A DEADLINE.

   FOUNDER, 2026-09-05: "is there anything you would do now for hardening,
   ideally also for the connectivity, that the workroom don't stuck, the syncs
   are all working and so on. i want this a solid perfect built."

   THE DEFECT THIS CLOSES. `callTool` normalises every failure the platform
   REPORTS and retries the reads it is allowed to retry, but it has no wall
   clock: a connector that accepts a call and never answers leaves the promise
   pending for the life of the page. Upstream of it the rooms then await
   forever, and a room that awaits forever is a room with a spinner in it and a
   banker who cannot tell a slow org from a dead one. That is the worst thing
   this cockpit can do in front of an audience.

   SO EVERY CALL A ROOM MAKES CARRIES A DEADLINE, and the deadline is stated in
   the room's own voice when it fires. Five budgets, because the calls are not
   alike: staging is one Apex round trip, executing is a package clone with an
   approval chain behind it, a read is a read, and the desk is a model.

   WHAT A DEADLINE IS NOT. It is not a claim that the call failed. It is the
   room saying it stopped waiting, which is a fact about the room and never a
   fact about the org. On a READ or a STAGE that distinction costs nothing:
   staging is zero-DML by contract, so nothing was written and saying so is
   honest. On an EXECUTE it is the whole thing, and `settleExecution.ts` owns
   what happens next: the room re-queries the org's own staging record and
   reports what the org actually holds. Nothing here ever says "failed".

   IT CANCELS WHERE CANCELLING IS POSSIBLE. `run` is handed an AbortSignal and
   the signal is aborted the moment the budget runs out, so the sample lane
   stops streaming and `callTool` stops waiting on a socket it has given up on.
   A `run` that ignores the signal still resolves this promise on time; the
   orphaned work simply lands nowhere, which is the same outcome the page had
   before minus the stuck room.
   ============================================================================= */

/** The budgets, in one place, per kind of call a room makes.
 *
 *  MEASURED, NOT GUESSED. The longest modification this org has recorded ran
 *  156 seconds end to end, but that is the ORG's run and it is waited out
 *  against the staging record (POLL_BUDGET_MS), not against the socket. What
 *  these numbers bound is how long a room will sit on a call that has told it
 *  nothing at all. */
export const DEADLINES = {
  /** One staging round trip. Zero DML by contract, so an expiry is clean. */
  stage: 25_000,
  /** The write. Past this the room stops waiting on the socket and starts
   *  reading the org's record instead; it never re-executes on its own. */
  execute: 45_000,
  /** Any read a room opens on, or refreshes with. */
  read: 15_000,
  /** One memo section, streamed off the desk. */
  narrate: 40_000,
  /** One rewrite of one section. Shorter: the banker is watching this one. */
  steer: 30_000,
} as const;

export type DeadlineKind = keyof typeof DEADLINES;

/** The typed reason. Never a bare Error: the rooms branch on this, and a
 *  string match on a message is how a room ends up calling a refusal a
 *  timeout. */
export class DeadlineExpired extends Error {
  /** Discriminator that survives a bundler, a re-throw and a structured clone. */
  readonly deadline = true as const;

  constructor(
    /** What the room was waiting for, in banker words, lower case, no period. */
    readonly what: string,
    /** The budget that ran out. */
    readonly waitedMs: number,
    readonly kind: DeadlineKind,
  ) {
    super(`no answer on ${what} within ${Math.round(waitedMs / 1000)}s`);
    this.name = "DeadlineExpired";
  }
}

/** TRUE where this is the room's own clock and not the org's answer. */
export function isDeadline(e: unknown): e is DeadlineExpired {
  return typeof e === "object" && e !== null && (e as { deadline?: unknown }).deadline === true;
}

/** How long the room waited, said the way a person says it. */
export function waitedFor(e: unknown): string {
  const ms = isDeadline(e) ? e.waitedMs : 0;
  const s = Math.round(ms / 1000);
  return `${s} seconds`;
}

/**
 * Run `work` with a wall clock over it.
 *
 * Resolves with whatever `work` resolves with, rejects with whatever it
 * rejects with, or rejects with a {@link DeadlineExpired} at `ms`. The signal
 * handed to `work` is aborted on expiry and on nothing else, so a caller can
 * pass it straight to `callTool` or to the sample lane.
 */
export function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  kind: DeadlineKind,
  what: string,
  ms: number = DEADLINES[kind],
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clock = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DeadlineExpired(what, ms, kind));
    }, ms);
  });

  let started: Promise<T>;
  try {
    started = work(controller.signal);
  } catch (e) {
    // A `work` that throws synchronously is a rejection, not a hang.
    if (timer) clearTimeout(timer);
    return Promise.reject(e);
  }

  return Promise.race([started, clock]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** The same clock over a promise that was already started and takes no signal.
 *  Nothing is cancelled: the work runs on and its answer lands nowhere. Used
 *  only where the API underneath genuinely has no cancellation. */
export function byDeadline<T>(started: Promise<T>, kind: DeadlineKind, what: string, ms: number = DEADLINES[kind]): Promise<T> {
  return withDeadline(() => started, kind, what, ms);
}

/* ---------------------------------------------------------------- the copy

   ONE CALM SENTENCE, ACTIVE, SPECIFIC. It says what the room waited for, how
   long it waited, and what is true of the work as a result. It never
   apologises, never exclaims, and never claims an outcome the room cannot
   read: "nothing was written" appears only where staging's zero-DML contract
   makes it a fact.                                                          */

/** The staging call ran out of clock. Staging writes nothing, so this is the
 *  one place a room may state the org's side of it as fact. */
export const stageDeadlineLine = (e: unknown, what: string): string =>
  `The org has not answered on ${what} in ${waitedFor(e)}, so I have stopped waiting on it. ` +
  "Staging writes nothing, so nothing has been filed and the manifest is exactly as you left it.";

/** The execute call ran out of clock. THE WRITE MAY HAVE LANDED, so the room
 *  states only what it is doing next, and the settle path says the rest. */
export const executeDeadlineLine = (e: unknown): string =>
  `The filing call has not answered in ${waitedFor(e)}. I will not tell you it failed, because I cannot see that. ` +
  "I am reading the org's own record for this run and I will report what it holds.";

/* NO SENTENCE FOR A READ, AND THAT IS DELIBERATE. Both reads a room makes are
   silent by contract: the mailbox because "a banker told the mailbox could not
   be reached learns nothing they can act on inside a credit workroom"
   (clientMail.ts), and the stored plan because every kind of absence is the
   same silence. A read that runs out of clock keeps whatever the module already
   held and says nothing, exactly as a read that came back empty does. A read
   whose absence a banker WOULD act on should get its own line here, written for
   that read rather than borrowed from a generic one. */

/** The desk ran out of clock mid-draft. Section-specific: the rest is intact. */
export const narrateDeadlineLine = (e: unknown, section: string): string =>
  `The desk has not answered on ${section} in ${waitedFor(e)}, so I have stopped waiting on it. ` +
  "That section keeps its pending marker and every other section is untouched.";

/** The desk ran out of clock mid-steer. The section is unchanged. */
export const steerDeadlineLine = (e: unknown, section: string): string =>
  `The desk has not answered that rewrite in ${waitedFor(e)}, so I have stopped waiting on it. ` +
  `${section} is unchanged and the memo is where you left it.`;

/** The two chips a room offers on any deadline that left a plan standing. */
export const TRY_AGAIN = { label: "Try again", say: "try that again" } as const;
export const KEEP_THE_PLAN = { label: "Keep the plan", say: "keep the plan as it is" } as const;
