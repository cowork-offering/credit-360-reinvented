import { describe, expect, it } from "vitest";
import { chatToMarkdown, threadToMarkdown } from "./transcript";

/* The transcript serialisers turn a workroom thread or a chat into the plain
   markdown the bug button copies. They must name every human-readable beat, be
   resilient to an unknown item kind, and never throw. */

describe("threadToMarkdown", () => {
  const meta = { surface: "Loan modification — Sunbelt Hospitality Group", bookAsOf: "2026-08-25" };

  it("renders banker lines, agent lines and the options offered", () => {
    const items = [
      { id: "b1", step: 0, kind: "banker", text: "increase the line to 18M" },
      {
        id: "a1",
        step: 0,
        kind: "agent",
        text: "What rate should it move to?",
        options: [
          { label: "Hold 7.60%", say: "hold the rate" },
          { label: "New all-in rate", say: "set a new rate" },
        ],
      },
      { id: "b2", step: 1, kind: "banker", text: "hold" },
    ];
    const md = threadToMarkdown(items, meta);
    expect(md).toContain("Loan modification — Sunbelt Hospitality Group");
    expect(md).toContain("Book as of: 2026-08-25");
    expect(md).toContain("**You:** increase the line to 18M");
    expect(md).toContain("**Room:** What rate should it move to?");
    expect(md).toContain("Options: Hold 7.60% · New all-in rate");
    expect(md).toContain("**You:** hold");
  });

  it("names settled receipts, notices and a fed line", () => {
    const items = [
      { id: "f1", step: 0, kind: "fed", text: "value the collateral", from: "queue" },
      { id: "n1", step: 0, kind: "notice", title: "Salesforce unreachable", body: "needs_reauth" },
      { id: "s1", step: 1, kind: "settled", row: { label: "Commitment → $18.0M" } },
    ];
    const md = threadToMarkdown(items, meta);
    expect(md).toContain("**You (via queue):** value the collateral");
    expect(md).toContain("**Room (notice): Salesforce unreachable** needs_reauth");
    expect(md).toContain("**Filed:** Commitment → $18.0M");
  });

  it("does not throw on an unknown item kind and marks it", () => {
    const md = threadToMarkdown([{ id: "x", step: 0, kind: "future_kind" }], meta);
    expect(md).toContain("_[future_kind]_");
  });

  it("says so when there is no exchange yet", () => {
    expect(threadToMarkdown([], meta)).toContain("_(no exchange yet)_");
  });
});

describe("chatToMarkdown", () => {
  const meta = { surface: "Cockpit chat — Hartwell Precision Manufacturing LLC" };

  it("labels the banker and the desk by role", () => {
    const md = chatToMarkdown(
      [
        { id: "1", role: "user", text: "what is the covenant position" },
        { id: "2", role: "agent", text: "The DSCR test is 23 days overdue." },
      ],
      meta,
    );
    expect(md).toContain("**You:** what is the covenant position");
    expect(md).toContain("**Desk:** The DSCR test is 23 days overdue.");
  });

  it("says so when there are no messages", () => {
    expect(chatToMarkdown([], meta)).toContain("_(no messages yet)_");
  });
});
