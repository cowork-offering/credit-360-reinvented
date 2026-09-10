import { describe, expect, it } from "vitest";
import { buildActionBucket } from "./kpiActions";
import type { WorklistRow } from "../data/worklistRows";
import type { ReasonCode } from "../data/contract";

function row(over: Partial<WorklistRow> & { accountId: string; name: string; reasons: ReasonCode[] }): WorklistRow {
  return {
    industry: "Manufacturing",
    naicsCode: "3339",
    riskRating: 5,
    tce: 12_000_000,
    outstanding: 8_000_000,
    nextTestDays: null,
    nextTestDate: null,
    maturityDays: null,
    maturityDate: null,
    staged: true,
    sample: false,
    liveReadAt: null,
    ...over,
  };
}

const BREACH = row({ accountId: "a1", name: "Sunbelt Hospitality", reasons: ["COVENANT_BREACH"], nextTestDays: -23 });
const DUE = row({ accountId: "a2", name: "Piedmont Precision", reasons: ["COVENANT_DUE"], nextTestDays: 5 });
const MATURITY = row({ accountId: "a3", name: "Sterling Fabrication", reasons: ["MATURITY_NEAR"], maturityDays: 18 });
const REQUEST = row({ accountId: "a4", name: "Brightwater Foods", reasons: ["CLIENT_REQUEST"] });
const QUIET = row({ accountId: "a5", name: "Kingsley Works", reasons: [] });

const ALL = [DUE, BREACH, MATURITY, REQUEST, QUIET];

describe("buildActionBucket", () => {
  it("needs-action returns every queue row, most-acute first", () => {
    const b = buildActionBucket("needs-action", ALL);
    expect(b.title).toBe("Needs action");
    expect(b.rows).toHaveLength(5);
    // bad (breach) sorts ahead of warn (due/maturity/request) ahead of neutral (quiet)
    expect(b.rows[0].accountId).toBe("a1");
    expect(b.rows.at(-1)!.accountId).toBe("a5");
    expect(b.triage).toContain("5");
  });

  it("reviews-due keeps only covenant rows and routes them to covenant review", () => {
    const b = buildActionBucket("reviews-due", ALL);
    expect(b.rows.map((r) => r.accountId).sort()).toEqual(["a1", "a2"]);
    for (const r of b.rows) {
      expect(r.ctaLabel).toBe("Start covenant review");
      expect(r.prompt).toContain("covenant review");
      expect(r.prompt).toContain(r.name);
    }
  });

  it("breach is acute and reads as overdue; due-ahead is a warning", () => {
    const b = buildActionBucket("reviews-due", ALL);
    const breach = b.rows.find((r) => r.accountId === "a1")!;
    const due = b.rows.find((r) => r.accountId === "a2")!;
    expect(breach.tone).toBe("bad");
    expect(breach.read).toContain("23d overdue");
    expect(due.tone).toBe("warn");
    expect(due.read).toContain("due in 5d");
  });

  it("ews keeps breaches and maturities; maturity routes to a renewal", () => {
    const b = buildActionBucket("ews", ALL);
    expect(b.rows.map((r) => r.accountId).sort()).toEqual(["a1", "a3"]);
    const maturity = b.rows.find((r) => r.accountId === "a3")!;
    expect(maturity.ctaLabel).toBe("Start renewal");
    expect(maturity.prompt).toContain("renewal");
    expect(maturity.read).toContain("matures in 18d");
  });

  it("a client request opens the request, pre-typed for a modification", () => {
    const b = buildActionBucket("needs-action", [REQUEST]);
    expect(b.rows[0].ctaLabel).toBe("Open the request");
    expect(b.rows[0].prompt.toLowerCase()).toContain("modification");
  });

  it("an empty bucket says so and lists nothing", () => {
    const b = buildActionBucket("ews", [QUIET, REQUEST]);
    expect(b.rows).toHaveLength(0);
    expect(b.triage).toContain("No early-warning");
  });
});
