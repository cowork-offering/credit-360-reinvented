import { describe, expect, it, vi } from "vitest";
import {
  DEADLINES,
  DeadlineExpired,
  byDeadline,
  executeDeadlineLine,
  isDeadline,
  narrateDeadlineLine,
  stageDeadlineLine,
  steerDeadlineLine,
  waitedFor,
  withDeadline,
} from "./deadline";

/* =============================================================================
   THE CLOCK, ON ITS OWN.

   The thing it has to be right about is the hang: a promise that never settles
   has to become a typed rejection at a stated time, and the signal it handed
   out has to be aborted so the work underneath stops. Everything else here is
   the guarantee that a call which answers in time is untouched by any of it.
   ============================================================================= */

const never = () => new Promise<never>(() => {});

describe("withDeadline", () => {
  it("resolves untouched when the work answers in time", async () => {
    const seen: AbortSignal[] = [];
    const out = await withDeadline(
      (signal) => {
        seen.push(signal);
        return Promise.resolve("the org answered");
      },
      "read",
      "the exposure",
    );
    expect(out).toBe("the org answered");
    expect(seen[0].aborted).toBe(false);
  });

  it("rejects with a typed deadline when the work never settles", async () => {
    vi.useFakeTimers();
    try {
      const p = withDeadline(never, "stage", "staging this plan", 25_000);
      const caught = p.catch((e) => e);
      await vi.advanceTimersByTimeAsync(25_000);
      const e = await caught;
      expect(isDeadline(e)).toBe(true);
      expect((e as DeadlineExpired).kind).toBe("stage");
      expect((e as DeadlineExpired).what).toBe("staging this plan");
      expect((e as DeadlineExpired).waitedMs).toBe(25_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts the signal it handed out, so the work underneath can stop", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | null = null;
      const p = withDeadline(
        (s) => {
          signal = s;
          return never();
        },
        "narrate",
        "the credit request",
        40_000,
      );
      const caught = p.catch(() => "expired");
      expect(signal!.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(40_000);
      await caught;
      expect(signal!.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes the work's own rejection through rather than dressing it as a timeout", async () => {
    const refusal = { code: "VALIDATION_FAILED", message: "the org refused" };
    const e = await withDeadline(() => Promise.reject(refusal), "stage", "staging this plan").catch((x) => x);
    expect(e).toBe(refusal);
    expect(isDeadline(e)).toBe(false);
  });

  it("treats a synchronous throw as a rejection and clears its clock", async () => {
    vi.useFakeTimers();
    try {
      const boom = new Error("no engine");
      const e = await withDeadline(
        () => {
          throw boom;
        },
        "read",
        "the snapshot",
      ).catch((x) => x);
      expect(e).toBe(boom);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears its clock on a normal answer, so nothing is left pending", async () => {
    vi.useFakeTimers();
    try {
      await withDeadline(() => Promise.resolve(1), "read", "the snapshot");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("byDeadline puts the same clock over a promise that is already running", async () => {
    vi.useFakeTimers();
    try {
      const caught = byDeadline(never(), "execute", "the filing", 45_000).catch((e) => e);
      await vi.advanceTimersByTimeAsync(45_000);
      expect(isDeadline(await caught)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the budgets", () => {
  it("are the five the rooms were specified with", () => {
    expect(DEADLINES).toEqual({ stage: 25_000, execute: 45_000, read: 15_000, narrate: 40_000, steer: 30_000 });
  });
});

describe("what the room says", () => {
  const expired = new DeadlineExpired("staging this plan", 25_000, "stage");

  it("counts the wait in whole seconds", () => {
    expect(waitedFor(expired)).toBe("25 seconds");
  });

  it("states the stage as written nothing, because staging writes nothing", () => {
    const said = stageDeadlineLine(expired, "staging this plan");
    expect(said).toContain("25 seconds");
    expect(said).toContain("nothing has been filed");
  });

  it("never says the filing failed, because the room cannot see that", () => {
    const said = executeDeadlineLine(new DeadlineExpired("the filing", 45_000, "execute"));
    expect(said).toContain("45 seconds");
    expect(said).not.toMatch(/failed\b(?!,)/);
    expect(said).toContain("reading the org's own record");
  });

  it("keeps every fault sentence sober: no apology, no exclamation, no em dash", () => {
    const lines = [
      stageDeadlineLine(expired, "staging this plan"),
      executeDeadlineLine(expired),
      narrateDeadlineLine(expired, "the credit request"),
      steerDeadlineLine(expired, "The credit request"),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/!/);
      expect(line).not.toMatch(/—/);
      expect(line).not.toMatch(/\bsorry\b|\bapolog/i);
      expect(line).not.toMatch(/\boops\b/i);
    }
  });
});
