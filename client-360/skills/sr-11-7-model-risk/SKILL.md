---
name: sr-11-7-model-risk
description: Federal Reserve SR 11-7 model-risk governance for the agentic credit-memo system. Frames the whole pipeline — drafting and review alike — as decision-support, never autonomous credit decisions, with effective challenge, full data lineage (Boom→AFS→nCino), human-in-the-loop attestation, DRAFT-until-committee, an auditable Snowflake decision ledger, and separation of development (the drafting agent) from validation (the reviewer agent). Use whenever applying, citing, or explaining model-risk controls on either the analyst/drafting side or the reviewer side of the credit-memo agent.
---

# SR 11-7 Model Risk Management — Governing Principles

This skill states how the agentic credit-memo system operates under **Federal Reserve SR 11-7,
"Guidance on Model Risk Management."** It applies to the **whole pipeline** — **both** the
analyst/drafting side (the `credit-memo` orchestrator + `commercial-credit-memo` /
`finalize-and-writeback` skills) **and** the validation/review side (the `credit-reviewer` agent +
`credit-review` skill). Load it on either side when applying, citing, or explaining a model-risk
control.

## Primary sources (clickable — open these live)

- **Federal Reserve SR 11-7, "Guidance on Model Risk Management" (April 4, 2011):**
  [federalreserve.gov/boarddocs/srletters/2011/sr1107.htm](https://www.federalreserve.gov/boarddocs/srletters/2011/sr1107.htm)
- **FDIC FIL-22-2017 — adoption of the same joint guidance** (the FDIC's stable mirror; OCC 2011-12 is the OCC-issued companion of this identical interagency guidance):
  [fdic.gov/news/financial-institution-letters/2017/fil17022.html](https://www.fdic.gov/news/financial-institution-letters/2017/fil17022.html)

SR 11-7 defines a *model* broadly — any quantitative or analytical method that processes inputs into
estimates used for business decisions. An LLM-based agent that synthesizes spread, servicing, and risk
data into a credit memo falls squarely inside that definition, so the agent is governed as a model and
this guidance applies to it directly.

## How the system maps to SR 11-7

### (a) Decision-support, never autonomous credit decisions

The agent produces **decision-support material**: a drafted memo, a covenant write-up, a risk
narrative. It does **not** make or approve the credit decision. SR 11-7's core caution is over-reliance
on model output; the system answers it structurally — every memo carries
`DRAFT — PENDING CREDIT COMMITTEE REVIEW`, and the credit decision is reserved to a human committee.
Both agents are fenced out of decisioning, covenant waivers, and exceptions.

### (b) Effective challenge + full data lineage

SR 11-7 requires **effective challenge** — critical, independent review by parties with the standing to
act on findings. Two mechanisms implement it:

- **Independent validation by the reviewer.** The `credit-reviewer` agent is a separate persona that
  reads the finished work product, re-reads the figures at their source, rates each section, checks
  policy alignment, and approves or rejects. It does not inherit the drafter's context — it **recalls**
  the deal — so the challenge is genuinely independent.
- **Full data lineage.** Every figure traces to a source of truth along the **Boom → AFS → nCino**
  chain: Boom owns raw line items + standard ratios (compute-on-read), AFS consumes those ratios to
  produce ratings / PD / covenant grades, nCino owns covenant thresholds and the loan/package record,
  and the covenant **grade** is a deterministic Boom-ratio × nCino-threshold join. Deterministic math
  lives in the MCP tools, never in the LLM's reasoning — *agents reason, tools compute* — which keeps
  the numeric layer testable and reproducible. A figure that cannot be traced is surfaced as a gap, not
  estimated.

### (c) Human-in-the-loop attestation, DRAFT-until-committee

SR 11-7 stresses informed human use of model output. The system makes this a visible control:

- **Per-section attestation** — the drafting agent walks the reviewer through each ON section
  (approve / edit / skip), attributed to the authenticated user (`getUserInfo`). Section sign-off is
  *preparer verification*, distinct from committee approval.
- **DRAFT-until-committee** — the `DRAFT — PENDING CREDIT COMMITTEE REVIEW` banner stays on the document
  through drafting and section attestation. It is governed only by the committee decision the
  `credit-reviewer` records (`ncino_approve_package`). The human committee, not the model, lifts the
  draft state.

### (d) Auditability — the Snowflake decision ledger is the model-risk audit trail

SR 11-7 requires documentation and an audit trail sufficient for independent parties (including
examiners) to understand and reproduce the model's use. The system persists this to Snowflake
`GOVERNANCE`:

- **`DECISION_LEDGER`** (the *why*) — rationale and alternatives at each genuine decision point
  (`record_decision` / `recall_decisions`), keyed by nCino package id.
- **`AUDIT_EVENTS`** (the *what*) — every attestation transition and every system-of-record write
  (`log_audit_event` / `get_audit_trail`).

This is the examiner-facing change log and institutional memory. **Fence:** the ledger *informs*
judgment and lets the next analyst's agent walk in warm — it is **never** a source for a figure. Numbers
come from the source of truth, not the memory of a prior decision.

### (e) Separation of development and validation

SR 11-7 calls for organizational separation between those who **develop** a model and those who
**validate** it. The agent design encodes this as two distinct personas:

| Function | Agent | Writes |
|---|---|---|
| **Development** (draft + finalize) | `credit-memo` orchestrator (+ `commercial-credit-memo`, `finalize-and-writeback`) | builds, renders, syncs, publishes the memo |
| **Validation** (effective challenge + decision) | `credit-reviewer` (+ `credit-review`) | read-only on the work product; only writes the approval/reject decision + AFS workpackage |

The reviewer never drafts; the drafter never approves. The boundary is enforced in each agent's
out-of-scope list, not just by convention.

## Applying this skill

- **On the drafting side** — trace every figure to its source; surface gaps instead of estimating; keep
  deterministic math in the tools; render the DRAFT banner; walk per-section attestation under the
  authenticated user; log decisions and writes to the ledger.
- **On the review side** — perform independent effective challenge; re-verify load-bearing figures
  against the source; rate sections and check policy alignment; record a human-attested decision; never
  let the model make the credit call.

In both cases the discipline is the same: the model **supports** the credit judgment with a fully
traceable, auditable, human-governed work product — it does not make the judgment.

## Voice

Sober banking / model-risk register. Active, specific, no marketing language, no exclamation points, no
emojis. The audience is a credit committee and a model-risk examiner.
