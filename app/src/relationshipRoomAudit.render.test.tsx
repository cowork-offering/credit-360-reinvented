// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RelationshipRoom, type RelRouter } from "./components/relationship/RelationshipRoom";
import { relContextFor, type RelContext, type RelFlowDeps } from "./components/relationship/reviewFlows";
import type { RelRoute } from "./components/relationship/relRoute";
import type { OrgCatalog } from "./channel/catalog";
import type { BorrowerBundle, C360Data } from "./data/contract";
import type { StagedOutput } from "./actions/stagedPlan";
import type { ExecuteResult, ToolOutcome } from "./channel/writeTools";

/* =============================================================================
   THE RELATIONSHIP WORKROOM, JUDGED AGAINST THE CHAT GOLDEN RULE.

   Pre-Dreamforce findings audit, 2026-09-12. Every `it.skip` below is a
   REPRODUCED DEFECT: the assertion states the behaviour the golden rule
   (`knowledge/CHAT-GOLDEN-RULE.md`) demands, and it FAILS against the room as
   it stands today. Each carries the rule it breaks and the line that produces
   it. Nothing under `app/src` outside this file was changed to write them.

   Un-skip a case when its fix lands; it is the acceptance test for that fix.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.className = "";
});

const PACKAGE = "a5Fbb000000IHFJEA4";

/** A Hartwell-shaped read: two active facilities, one cross-pledged asset with
 *  a 2024 appraisal on file, one breached covenant carrying a Pending row. */
function hartwell(): BorrowerBundle {
  return {
    snapshot: {
      accountId: "001X",
      name: "Hartwell Precision Manufacturing LLC",
      productPackageId: PACKAGE,
      primaryRiskRating: "4",
      computedRiskRating: "5",
    },
    exposure: {
      totalCommitted: 18_400_000,
      facilities: [
        {
          loanId: "0Cb1",
          status: "Active",
          productPackageId: PACKAGE,
          committed: 10_000_000,
          collateral: [
            {
              collateralId: "a35A",
              collateralName: "COL-000762",
              collateralDescription: "CNC machining line, Kokomo plant",
              collateralType: "Equipment",
              collateralValue: 8_000_000,
              currentLendableValue: 4_000_000,
              advanceRateSource: "pledge override",
            },
            {
              collateralId: "a35B",
              collateralDescription: "Receivables",
              collateralType: "Accounts Receivable",
              collateralValue: 3_000_000,
              currentLendableValue: 2_400_000,
            },
          ],
        },
        {
          loanId: "0Cb2",
          status: "Active",
          productPackageId: PACKAGE,
          committed: 8_400_000,
          collateral: [{ collateralId: "a35A", collateralName: "COL-000762" }],
        },
      ],
    },
    covenants: {
      covenants: [
        {
          covenantId: "cov1",
          covenantType: "Debt Service Coverage",
          nextEvaluationDate: "2026-09-06",
          frequency: "Quarterly",
          actualValue: 1.08,
          thresholdValue: 1.25,
          lastEvaluationStatus: "Exception",
          latestComplianceId: "a3X1",
          latestComplianceStatus: "Pending",
        },
      ],
    },
    requests: [{ summary: "Copy of the June covenant compliance certificate" }],
    collateralValuations: [
      { collateralId: "a35A", valuationDate: "2024-03-14", type: "Appraisal", source: "Third Party Appraisal", value: 8_000_000 },
    ],
  } as unknown as BorrowerBundle;
}

/** The org catalog as `Customer360Catalog` actually returns it. */
const CATALOG = {
  fields: [
    {
      objectName: "LLC_BI__Collateral__c",
      fieldName: "LLC_BI__Collateral_Type__c",
      source: "catalog",
      values: [
        { value: "a33A", label: "Equipment" },
        { value: "a33B", label: "Inventory" },
      ],
      acceptedValues: ["a33A", "a33B"],
    },
  ],
} as unknown as OrgCatalog;

function ctxFor(catalog: OrgCatalog | null): RelContext {
  const bundle = hartwell();
  const data = {
    meta: { generatedAt: "2026-09-12", userId: "005bb000001AAAAAAA" },
    portfolio: { accounts: [] },
    borrower: bundle,
    borrowers: { "001X": bundle },
  } as unknown as C360Data;
  return relContextFor({
    data,
    bundle,
    accountId: "001X",
    accountName: "Hartwell Precision Manufacturing LLC",
    catalog,
  });
}

const PLAN: StagedOutput = {
  stagingId: "a8abb00001KtalSAAR",
  planHash: "hash-wxyz",
  decisionToken: "6b3490fc91cfc47256b488c8bd783add",
  summary: "Files the record.",
  steps: [],
  warnings: [],
  suggestions: [],
};
const RESULT: ExecuteResult = {
  stagingId: "a8abb00001KtalSAAR",
  terminalState: "success",
  outcome: "Created and verified.",
  recordName: "REC-1",
  status: "In Progress",
  steps: [],
};
const deps: RelFlowDeps = {
  available: () => true,
  newKey: () => "key-1",
  stage: async () => ({ ok: true, result: PLAN }) as ToolOutcome<StagedOutput>,
  execute: async () => ({ ok: true, result: RESULT }) as ToolOutcome<ExecuteResult>,
};

function open(route: RelRoute, catalog: OrgCatalog | null = null): HTMLElement {
  const router: RelRouter = {
    question: null,
    say: null,
    preselectCovenantId: null,
    neutral: () => ({ line: "", chips: [] }),
    onBind: () => {},
    onRestart: () => {},
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <RelationshipRoom ctx={ctxFor(catalog)} route={route} router={router} deps={deps} onClose={() => {}} />,
    );
  });
  return document.querySelector<HTMLElement>(".wk-room")!;
}

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
};

async function type(room: HTMLElement, text: string) {
  const input = room.querySelector<HTMLInputElement>(".wk-txt")!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();
}

function chip(re: RegExp) {
  const b = [...document.body.querySelectorAll("button.wk-opt")].find((x) => re.test(x.textContent ?? ""));
  if (!b) throw new Error(`no chip matching ${re}`);
  act(() => b.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

/** Every agent bubble the room has spoken, sentence only. */
const said = () =>
  [...document.body.querySelectorAll(".wk-msg[data-who='Agent'] .wk-bub")].map((n) => {
    const copy = n.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".wk-opts, .rl-kicker").forEach((x) => x.remove());
    return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
  });

/** The step counters the room has printed, in order. */
const kickers = () =>
  [...document.body.querySelectorAll(".wk-msg[data-who='Agent'] .rl-kicker")].map((n) => (n.textContent ?? "").trim());

/* ========================================================================== */

describe("AUDIT — collateral valuation", () => {
  /* FINDING 1 — showcase-blocking. Golden rule 4/6 (the banker must know where
     they are). `plannedStepCount` (RelationshipRoom.tsx:449-461) walks the
     machine writing the SKIPPED sentinel into every step, but `valuationStep`
     (reviewFlows.ts:718) advances only on `typeof values[id] === "number"`, so
     the probe never clears the per-asset value step and burns the whole 64-turn
     guard. The counter reads "Step 2 of 65" on one asset and "Step 3 of 66" on
     two. MINIMAL FIX: make the probe write a number for a `number` step
     (`assign(probe, step.key, step.kind === "multi" ? [] : step.kind === "number" ? 0 : SKIPPED)`),
     or make `valuationStep` test `answered(values, id)` the way `covenantStep`
     already tests its observed figure. */
  it.skip("counts the steps it is going to ask, not 65 of them", async () => {
    const room = open("valuation");
    await settle();
    chip(/CNC machining line/);
    await settle();
    expect(kickers()).toEqual(["Step 1 of 7", "Step 2 of 7"]);
    void room;
  });

  /* FINDING 2 — showcase-blocking. Golden rule 1 + 2: every question leads with
     the current figure, offers the real options and recommends one. The chooser
     chip already prints "$8M · $4M lendable · Last valued Mar 14, 2024 at $8M"
     (reviewFlows.ts:699-712 through relBook.ts:171-180), and the one question
     that needs it — reviewFlows.ts:721-727 — asks a bare "What value are we
     filing for X?" with a "The figure, in dollars." placeholder. This is the
     "vague ask" on IMPROVEMENTS-AND-BUGS D.2. MINIMAL FIX: build the ask from
     the same `BookAsset` the chooser used — name the asset, the value on file,
     the appraisal date and the lendable figure, and offer the on-file figure as
     an option chip the way the covenant observed-value step does
     (reviewFlows.ts:546-555). */
  it.skip("leads the value question with the appraisal on file and its date", async () => {
    const room = open("valuation");
    await settle();
    chip(/CNC machining line/);
    await settle();
    const ask = said().at(-1) ?? "";
    expect(ask).toContain("CNC machining line, Kokomo plant");
    expect(ask).toContain("$8M");
    expect(ask).toContain("Mar 14, 2024");
    void room;
  });

  /* FINDING 3 — important. Golden rule 5 (no loops) + 1 (never refuse the
     book's own vocabulary). The asset chooser is a `multi` step whose option
     VALUES are Salesforce record ids and whose LABELS are the long description,
     and `matchOptions` (RelationshipRoom.tsx:2588-2590) matches on those two
     alone. So the org's own name for the asset — COL-000762, printed on the
     collateral pane and in nCino — is answered with the identical re-ask, as
     many times as the banker types it. MINIMAL FIX: widen the valuation
     options' match surface (carry `collateralName` and `collateralType` as
     synonyms on `StepOption`, matched by `matchOptions` alongside label and
     value), and make the second consecutive miss name what CAN be said rather
     than repeating the sentence. */
  it.skip("takes the asset's own autonumber as an answer", async () => {
    const room = open("valuation");
    await settle();
    await type(room, "COL-000762");
    expect(said().at(-1)).not.toContain("I could not read that");
  });
});

describe("AUDIT — annual review", () => {
  /* FINDING 4 — showcase-blocking. Golden rule 5 (the answer is taken, not
     re-answered) + 4 (no dead ends). `asksForFacilityWork` is tested BEFORE the
     step machine at RelationshipRoom.tsx:1585-1588 with no open-text-step
     guard, while the sibling route-switch reader HAS one (relRoute.ts:344). So
     the commonest annual-review recommendation there is — "Renew at current
     terms." — is thrown away and answered with the facility handoff, and the
     step stays live. "Amend the covenant package at renewal." and "Restructure
     is not warranted." do the same. MINIMAL FIX: pass `openTextStep` into the
     facility-work test the way `readRelRouteSwitch` already takes it, and skip
     the handoff while the live step is an open `text` step that is not itself a
     request (i.e. only hand off on a SHORT, route-naming line). */
  it.skip("takes 'Renew at current terms.' as the recommendation, not as facility work", async () => {
    const room = open("annual");
    await settle();
    chip(/^Annual/);
    await settle();
    await type(room, "Performing, no material change to the position.");
    await type(room, "Renew at current terms.");
    expect(said().join(" ")).not.toContain("That is facility work.");
    expect(said().at(-1)).toContain("Anything else for the file?");
  });
});

describe("AUDIT — relationship intake", () => {
  /* FINDING 5 — showcase-blocking. Golden rule 1/2 and a data-integrity defect.
     `seedLine` (intakeFlows.ts:499-505) treats ANY answer to "a covenant or an
     asset?" containing whitespace as the banker's opening sentence, and
     `collateralDrafts` (intakeFlows.ts:574) reads the asset's DESCRIPTION out
     of it. Answering "an asset" therefore files the collateral record with the
     description "an asset" — the only readable identity the record carries —
     and suppresses the "How is the asset described?" question entirely
     (intakeFlows.ts:1078). The next question then reads "What is an asset
     worth?". MINIMAL FIX: only treat the kind answer as a seed when it carries
     more than the disambiguation itself — require it to survive stripping the
     kind words ("a covenant" / "an asset" / "collateral"), not merely to
     contain a space. */
  it.skip("does not file the word 'an asset' as the asset's description", async () => {
    const room = open("intake", CATALOG);
    await settle();
    await type(room, "an asset");
    await settle();
    await type(room, "Equipment");
    await settle();
    expect(said().at(-1)).toContain("How is the asset described?");
  });

  /* FINDING 6 — important. Golden rule 4 (no dead ends) + 2. The intake reads
     its type names ONLY from the live org catalog (`collateralTypeNames`,
     intakeFlows.ts:237-239; `covenantTypeNames`, 184-186). With no catalog —
     the lane-outage case `design/probes/drive-lanes.mjs` scenarios 3 and 5
     model, and the state the host itself starts in (RelationshipRoom.tsx:3113)
     — the list is empty, so EVERY typed type is refused with "Pick a type
     below" and there is nothing below: `colPick`'s options are empty
     (intakeFlows.ts:1067-1076). The host's own comment says a null catalog
     "leaves the intake asking the banker to write the name"; the code refuses
     every name instead. Worse, a `chips` step with zero options falls through
     `stepAccepts` (RelationshipRoom.tsx:2574) and records whatever was typed,
     so the entry advances to "Another asset, or is that all?" carrying no type
     at all. MINIMAL FIX: give `intakeFlows` the mirror `elicit.ts` already has
     (`ASSET_KIND_OPTIONS`, elicit.ts:1203-1210, and `FILEABLE_COVENANT_TYPES`,
     elicit.ts:1409-1419) as the fallback when the catalog is empty, exactly as
     `assetTypeUniverse` (elicit.ts:1336-1341) does. */
  it.skip("still offers collateral types when the catalog read came back empty", async () => {
    const room = open("intake", null);
    await settle();
    await type(room, "an asset");
    await settle();
    await type(room, "Equipment");
    await settle();
    const last = said().at(-1) ?? "";
    expect(last).not.toContain("holds nothing called Equipment");
  });
});

describe("AUDIT — reads inside a bound review", () => {
  /* FINDING 7 — important. Golden rule 3 ("brief, specific to THIS
     relationship, then BACK TO THE FLOW") and 4. A read answered mid-review
     lands the shared card and stops: the room never restates the live step, and
     the card's own last line is the FACILITY room's invitation — "Which test
     should change, and to what threshold? I can also add one to a facility."
     (readCard.ts:273) — offered to a banker who is three questions into a
     covenant review, and which this room answers with the facility handoff if
     taken. MINIMAL FIX: after landing a read card inside a bound route
     (RelationshipRoom.tsx:1561-1581), re-emit the live step's question, and
     give `buildRelReadCard`/`buildReadCard` a room-aware follow-up rather than
     the facility room's. */
  it.skip("returns to the live question after answering a read", async () => {
    const room = open("covenant");
    await settle();
    chip(/Debt Service Coverage/);
    await settle();
    await type(room, "what is this covenant doing");
    /* The card is the LAST thing in the thread: the live step is never
       restated, so the banker has to scroll back to find what they were
       being asked. The last thing on the glass should be the question. */
    const thread = [...document.body.querySelectorAll(".wk-read, .wk-msg[data-who='Agent']")];
    const last = thread.at(-1)!;
    expect(last.classList.contains("wk-read")).toBe(false);
    expect((last.textContent ?? "").replace(/\s+/g, " ")).toContain(
      "How does the Debt Service Coverage test assess?",
    );
    void room;
  });
});

describe("AUDIT — the create stepper (elicit.ts), the named soft spot", () => {
  /* FINDING 8 — important. Golden rule 5 (no loops) and the principle
     `knowledge/WORKROOM-ITERATION-SPEC.md` section 2 states for exactly this
     machine: "an UNRECOGNIZED answer must not re-emit the identical question".
     It still does. `readAssetType` (elicit.ts:1366-1390) returns null for any
     line the org catalog and the six `ASSET_KINDS` words (elicit.ts:1156-1163)
     both miss, so `collateralAsk` (elicit.ts:2022-2039) re-emits its
     three-sentence question verbatim, with the same six family chips, as many
     times as the banker answers it. Driven with "a solar array" /
     "photovoltaic panels" / "solar" / "rooftop solar array, Kokomo" /
     "an aircraft": five identical asks, no escalation and no acknowledgement
     that anything was said.

     NOTE ON THE REPORT: the founder's "US vs non-US" wording matches nothing in
     the source. `country`, `non-US`, `United States`, `domestic` and
     "provide collateral information" appear nowhere under app/src (the single
     `country` hit is a postal-address comment at intakeFlows.ts:407). What the
     report describes — answering the collateral question and being re-asked —
     is THIS loop and the value loop below; the country wording is most likely a
     live-org collateral type name read back through the same machine.

     MINIMAL FIX: count consecutive misses on one slot in the `Draft`. On the
     second, say what was heard and that the catalog does not carry it, and
     narrow to the chips ("I cannot place 'solar array' in the bank's catalog.
     The closest families are Equipment and Real Estate; pick one and I will
     name the types inside it"), rather than repeating the question. */
  it.skip("does not re-emit the identical asset-kind question on a word the catalog misses", async () => {
    const { advance, openCreate, readInto, EMPTY_BOOK } = await import("./components/workroom/elicit");
    const m = { id: "0Cb1", key: "0Cb1", label: "Term Loan", orgName: "Term Loan", shortName: "Term", product: "Term", committed: 8_000_000 };
    const ectx = { members: [m], book: EMPTY_BOOK, focused: m, catalog: null } as never;
    let draft = openCreate("pledge a new asset on the term loan", ectx)!;
    const asked: string[] = [];
    for (const line of ["a solar array", "photovoltaic panels", "solar"]) {
      asked.push(advance(draft, ectx).ask?.text ?? "");
      draft = readInto(draft, line, ectx);
    }
    asked.push(advance(draft, ectx).ask?.text ?? "");
    expect(new Set(asked).size).toBeGreaterThan(1);
  });

  /* FINDING 9 — important. The same machine, the same rule, one slot further
     on. `collateralAsk`'s value question (elicit.ts:2050-2056) carries no chips
     and no escalation, and `readInto` only takes a figure `moneyIn` recognises
     (elicit.ts:1659-1663), so every non-money line re-emits it verbatim. Driven
     with "solar array" / "photovoltaic" / "it is a solar array" / "first lien":
     four identical asks — and the last of those DID settle the lien slot
     silently, so the room acted on the line and still claimed not to have read
     it. MINIMAL FIX: same counter; on a repeat miss, say what the line DID
     settle and re-ask only for the figure. */
  it.skip("does not re-emit the identical value question on a line it has already acted on", async () => {
    const { advance, openCreate, readInto, EMPTY_BOOK } = await import("./components/workroom/elicit");
    const m = { id: "0Cb1", key: "0Cb1", label: "Equipment Loan", orgName: "Equipment Loan", shortName: "Equipment", product: "Equipment", committed: 8_000_000 };
    const ectx = { members: [m], book: EMPTY_BOOK, focused: m, catalog: null } as never;
    let draft = openCreate("pledge new collateral on the equipment loan", ectx)!;
    draft = readInto(draft, "a solar array on the Kokomo roof", ectx);
    const first = advance(draft, ectx).ask?.text ?? "";
    draft = readInto(draft, "first lien", ectx);
    const second = advance(draft, ectx).ask?.text ?? "";
    expect(second).not.toBe(first);
  });
});

describe("AUDIT — what is already right", () => {
  /* The refusals that DO meet the rule, kept live as regression cover. */
  it("refuses an off-scale grade by name, with the scale in words", async () => {
    const room = open("rating");
    await settle();
    for (const s of ["skip", "skip", "skip", "skip"]) await type(room, s);
    await type(room, "47");
    expect(said().at(-1)).toContain("The rating review's own scale is 1 to 12");
  });

  it("refuses a regulatory classification and names the surface it does file on", async () => {
    const room = open("rating");
    await settle();
    for (const s of ["skip", "skip", "skip", "skip"]) await type(room, s);
    await type(room, "Substandard");
    expect(said().at(-1)).toContain("the classification is assigned elsewhere");
  });

  it("makes the override reason mandatory the moment an override is given", async () => {
    const room = open("rating");
    await settle();
    for (const s of ["skip", "skip", "skip", "skip", "5", "7"]) await type(room, s);
    expect(said().at(-1)).toContain("An override needs a written reason.");
  });

  it("leads the covenant observed figure with the rail the read carries", async () => {
    const room = open("covenant");
    await settle();
    chip(/Debt Service Coverage/);
    await settle();
    await type(room, "Exception");
    expect(said().at(-1)).toContain("The read carries 1.08");
    void room;
  });
});
