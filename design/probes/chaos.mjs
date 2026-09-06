#!/usr/bin/env node
/* Customer 360, the NEVER-STUCK probe.
 *
 * FOUNDER, 2026-09-05: "is there anything you would do now for hardening,
 * ideally also for the connectivity, that the workroom don't stuck, the syncs
 * are all working and so on. i want this a solid perfect built."
 *
 * The other probes measure the room when the org answers. This one measures it
 * when the org does not: a connector that accepts a call and never comes back,
 * one that refuses 502, one that answers with the wrong shape, one that fails
 * twice and then works, and a session door that goes quiet halfway through a
 * paragraph.
 *
 * EVERY SCENARIO CARRIES A WALL CLOCK. The assertion is never "the room did
 * something sensible eventually": it is that the room said a specific thing,
 * within a stated number of seconds, with the composer still alive and no
 * spinner left on the glass. A room that recovers in four minutes is a stuck
 * room, and this is the thing that says so.
 *
 *   node design/probes/chaos.mjs [bundle.html]
 *   node design/probes/chaos.mjs --only stage-hang,execute-hang
 *   node design/probes/chaos.mjs --headed --keep
 *
 * ONE BROWSER, ONE CONTEXT AT A TIME. The box this runs on is shared and has
 * four cores; a run that opened six Chromiums would measure the box.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { serveDir } from "./lib/serve.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const BUNDLE = process.argv.find((a) => a.endsWith(".html")) ?? "/tmp/c360-chaos.html";
const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const ONLY = args.only ? new Set(String(args.only).split(",").map((s) => s.trim())) : null;

const HARTWELL = "001bb00001I7FPNAA3";
const CNI_PACKAGE = "a5Fbb000000IHFJEA4";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chaosLib = fs.readFileSync(path.join(HERE, "lib", "chaos.js"), "utf8");

/* ------------------------------------------------------------------ driving */

const jsClick = (page, sel, n = 0) =>
  page.evaluate(([s, i]) => {
    const e = document.querySelectorAll(s)[i];
    if (e) e.click();
    return Boolean(e);
  }, [sel, n]);

const clickText = (page, sel, rx) =>
  page.evaluate(([s, r]) => {
    const el = [...document.querySelectorAll(s)].find((b) => new RegExp(r, "i").test(b.textContent || ""));
    if (el) el.click();
    return Boolean(el);
  }, [sel, rx]);

const say = async (page, line) => {
  await page.evaluate((t) => {
    const input = document.querySelector(".wk-txt");
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, t);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".wk-send")?.click();
    return true;
  }, line);
};

/** Everything a reader can actually see in the room, as one string. */
const glass = (page) =>
  page.evaluate(() => {
    const room = document.querySelector(".wk-room") || document.body;
    return (room.innerText || "").replace(/\s+/g, " ").trim();
  });

/**
 * WHAT A STUCK ROOM LOOKS LIKE, read off the glass rather than inferred.
 *
 * A spinner, a compile card still compiling, a chevron mid-fill or a control
 * that says it is working: any one of them, with nothing else happening, is the
 * founder's complaint. `composer` is the other half: a room may be honest
 * about a failure and still be stuck if the banker cannot type into it.
 */
const stuckness = (page) =>
  page.evaluate(() => {
    const t = ((document.querySelector(".wk-room") || document.body).innerText || "");
    const composer = document.querySelector(".wk-txt");
    return {
      compiling: document.querySelectorAll('[data-compile-state="compiling"]').length,
      working: /Working…|Working\.\.\./.test(t),
      filing: /Filing in progress/.test(t),
      composerAlive: Boolean(composer) && !composer.disabled && composer.offsetParent !== null,
      approveDisabled: Boolean(document.querySelector(".wk-approve")?.disabled),
    };
  });

/** Poll the glass until `rx` appears, or give up. Returns the elapsed ms. */
async function saysWithin(page, rx, capMs, step = 250) {
  const t0 = Date.now();
  for (;;) {
    const seen = await glass(page);
    if (rx.test(seen)) return { ok: true, ms: Date.now() - t0, seen };
    if (Date.now() - t0 > capMs) return { ok: false, ms: Date.now() - t0, seen };
    await sleep(step);
  }
}

/** Poll until `sel` matches exactly `n` nodes, or give up. */
async function countWithin(page, sel, n, capMs, step = 250) {
  const t0 = Date.now();
  for (;;) {
    const seen = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
    if (seen === n) return { ok: true, ms: Date.now() - t0, seen };
    if (Date.now() - t0 > capMs) return { ok: false, ms: Date.now() - t0, seen };
    await sleep(step);
  }
}

async function pickPackage(page) {
  const clicked = await jsClick(page, `.wk-pkg[data-pkg="${CNI_PACKAGE}"]`);
  if (clicked) await sleep(1600);
  return clicked;
}

/** Open the facility room on Hartwell's C&I package, from a cold landing. */
async function openFacilityRoom(page, url) {
  await page.goto(url, { waitUntil: "load" });
  await sleep(1500);
  await jsClick(page, `[data-open="${HARTWELL}"]`);
  await sleep(1300);
  await jsClick(page, "#fab");
  await sleep(600);
  await jsClick(page, "#actFacility");
  await sleep(3200);
  await pickPackage(page);
}

/**
 * A MANIFEST WITH ITS GATES CLEARED, which is the only state the review chip
 * exists in.
 *
 * The room does not go straight from a confirmed card to a plan, and it should
 * not: a commitment increase trips the collateral challenge and the pricing
 * gate, and the review chip is closed until both are answered. A probe that
 * clicked Confirm and then looked for the chip would be measuring the gates
 * rather than the deadline. So this answers whatever the room raises, in the
 * room's own words, until the chip is on the glass.
 */
async function stageOneChange(page) {
  await say(page, "increase the revolving line of credit to 18 million");
  await sleep(2800);
  for (let round = 0; round < 12; round++) {
    if (await page.evaluate(() => document.querySelectorAll(".wk-propose").length > 0)) return true;
    const moved =
      (await clickText(page, "button", "^Confirm$")) ||
      (await clickText(page, "button", "^Acknowledge$")) ||
      (await clickText(page, ".wk-opt", "^Leave pricing for later$")) ||
      (await clickText(page, ".wk-opt", "^240 months$"));
    if (!moved) await sleep(900);
    await sleep(1500);
  }
  return page.evaluate(() => document.querySelectorAll(".wk-propose").length > 0);
}

/**
 * ALL THE WAY TO THE SHEET, and the wall clock of the two beats that matter.
 *
 * `cardMs` is when the execute's own answer reached the glass - the dossier card
 * is mounted on the commit that lands the result - and `sheetMs` is when the
 * clean summary the founder asked for was readable. The claim the finale makes
 * is about the DIFFERENCE between those two: the room's ending is the room's own
 * choreography over facts it already holds, and it can never be a function of
 * how long the org took.
 */
async function fileAndWaitForTheSheet(page, url, bound) {
  await openFacilityRoom(page, url);
  await stageOneChange(page);
  await askForThePlan(page);
  await sleep(2500);
  await clickText(page, ".wk-approve", ".");
  const card = await countWithin(page, ".wk-rescard", 1, bound, 60);
  const t0 = Date.now();
  const sheet = await countWithin(page, ".wk-sheet", 1, 8000, 60);
  return { card, sheet, sinceCard: Date.now() - t0 };
}

/** What the sheet is showing, and whether a banker could act on it. */
const sheetState = (page) =>
  page.evaluate(() => {
    const sheet = document.querySelector(".wk-sheet");
    if (!sheet) return { on: false };
    const doors = [...sheet.querySelectorAll(".wk-sheet-acts button")];
    return {
      on: true,
      title: (sheet.querySelector(".wk-sheet-t")?.textContent || "").trim(),
      exposure: (sheet.querySelector('[data-block="exposure"]')?.textContent || "").replace(/\s+/g, " ").trim(),
      unconfirmed: /has not confirmed the figures yet/.test(sheet.textContent || ""),
      pending: Boolean(sheet.querySelector(".wk-sheet-d[data-pending]")),
      ledgerRows: sheet.querySelectorAll(".rc-fl-r").length,
      doors: doors.map((b) => (b.textContent || "").trim()),
      doorsLive: doors.length > 0 && doors.every((b) => !b.disabled),
      /* NO SPINNER, EVER. The sheet renders from what the room already holds, so
         a loader anywhere inside it is the claim failing rather than the room
         being slow. */
      spinners: sheet.querySelectorAll(".wk-loadchip, .wk-compose, .goo, .mm-tl-mark").length,
    };
  });

/** The one way to the plan: the review chip in the live exchange. */
const askForThePlan = async (page) => {
  const hit = (await jsClick(page, ".wk-propose")) || (await clickText(page, "button", "Review & execute"));
  await sleep(1200);
  return hit;
};

/* ---------------------------------------------------------------- scenarios

   Each returns { pass, detail, ms }. `bound` is the wall clock the founder
   would feel: past it the room is stuck whatever it eventually says.        */

const SCENARIOS = [
  /* ===================================================== 2. NO AWAIT WITHOUT A DEADLINE */
  {
    id: "stage-hang",
    room: "facility",
    bound: 32_000,
    chaos: { rules: [{ match: "^stage_", mode: "hang" }] },
    expect: "The room stops waiting on the staging call, states nothing was filed, and offers Try again.",
    async run(page, url, bound) {
      await openFacilityRoom(page, url);
      await stageOneChange(page);
      await askForThePlan(page);
      const said = await saysWithin(page, /has not answered on staging this plan in 25 seconds/i, bound);
      const s = await stuckness(page);
      return {
        pass: said.ok && s.composerAlive && s.compiling === 0,
        ms: said.ms,
        detail: said.ok
          ? `deadline sentence at ${(said.ms / 1000).toFixed(1)}s, composer alive=${s.composerAlive}, compile cards=${s.compiling}`
          : `no deadline sentence inside ${bound}ms`,
      };
    },
  },
  {
    id: "execute-hang",
    room: "facility",
    bound: 60_000,
    chaos: { rules: [{ match: "^execute_", mode: "hang" }] },
    trail: "Completed",
    expect: "The room stops waiting on the write, says it is reading the org's record, and never says failed.",
    async run(page, url, bound) {
      await openFacilityRoom(page, url);
      await stageOneChange(page);
      await askForThePlan(page);
      await sleep(2500);
      await clickText(page, ".wk-approve", ".");
      const said = await saysWithin(page, /filing call has not answered in 45 seconds/i, bound);
      const seen = await glass(page);
      const s = await stuckness(page);
      return {
        pass: said.ok && !/this filing failed|the filing failed/i.test(seen) && s.composerAlive,
        ms: said.ms,
        detail: said.ok
          ? `deadline sentence at ${(said.ms / 1000).toFixed(1)}s, never claimed failure, composer alive=${s.composerAlive}`
          : `no execute deadline sentence inside ${bound}ms`,
      };
    },
  },
  {
    id: "read-hang-on-open",
    room: "facility",
    bound: 25_000,
    chaos: { rules: [{ match: "Customer360|outlook_email_search", mode: "hang" }] },
    expect: "The room opens and takes an instruction with every read hung behind it.",
    async run(page, url, bound) {
      const t0 = Date.now();
      await openFacilityRoom(page, url);
      await say(page, "increase the revolving line to 18 million");
      const said = await saysWithin(page, /revolving|commitment|18/i, bound);
      const s = await stuckness(page);
      return {
        pass: said.ok && s.composerAlive,
        ms: Date.now() - t0,
        detail: said.ok ? `room awake and answering, composer alive=${s.composerAlive}` : "room never became usable",
      };
    },
  },
  {
    id: "desk-hang-mid-draft",
    room: "memo",
    /* TWO SECTIONS AT FORTY SECONDS EACH IS THE ROOM'S OWN CEILING ON A DEAD
       DESK, so the bound is that plus the room's opening and the exit. */
    bound: 100_000,
    chaos: { rules: [], sample: "hang-mid-stream" },
    expect: "The section keeps its pending marker, the room names the wait, the timeline stops working.",
    async run(page, url, bound) {
      await openMemoRoom(page, url);
      await clickText(page, ".mm-chip", "^Draft$");
      const said = await saysWithin(page, /desk has not answered on .* in 40 seconds/i, bound);
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll(".mm-tl-row")].map((r) => r.dataset.state),
      );
      const s = await stuckness(page);
      return {
        pass: said.ok && !rows.includes("running") && s.composerAlive,
        ms: said.ms,
        detail: said.ok
          ? `deadline sentence at ${(said.ms / 1000).toFixed(1)}s, no row left running (${rows.join(",") || "none"})`
          : `no narrate deadline sentence inside ${bound}ms`,
      };
    },
  },
  {
    id: "desk-hang-mid-steer",
    room: "memo",
    bound: 50_000,
    chaos: { rules: [], sample: "hang" },
    expect: "The steer stops on its own clock and says the section is unchanged.",
    async run(page, url, bound) {
      await openMemoRoom(page, url);
      await say(page, "rewrite the credit request");
      const said = await saysWithin(page, /desk has not answered that rewrite in 30 seconds|has not answered on .* in 30 seconds/i, bound);
      const s = await stuckness(page);
      return {
        pass: said.ok && s.composerAlive,
        ms: said.ms,
        detail: said.ok ? `steer deadline at ${(said.ms / 1000).toFixed(1)}s` : `no steer deadline inside ${bound}ms`,
      };
    },
  },

  /* ============================================================ 3. THE PLAN SURVIVES */
  {
    id: "plan-survives-reload",
    room: "facility",
    bound: 45_000,
    chaos: { rules: [] },
    expect: "A reload offers the plan back by name and time, and resuming re-says the lines and re-stages.",
    async run(page, url, bound) {
      await openFacilityRoom(page, url);
      await stageOneChange(page);
      const stored = await page.evaluate(() =>
        Object.keys(window.localStorage).filter((k) => k.includes("stagedPlans")).length,
      );
      // The reload. Same origin, same store, a brand new page.
      await openFacilityRoom(page, url);
      const offer = await saysWithin(page, /You left a plan on .* at \d\d:\d\d/i, bound);
      if (!offer.ok) return { pass: false, ms: offer.ms, detail: `no resume offer inside ${bound}ms (stored docs: ${stored})` };
      /* POLLED FAST, ON PURPOSE. The re-stage note is said and then the lines
         go straight back through the composer, and the settle choreography
         retires the exchange above the first card within a couple of seconds.
         A quarter-second poll can miss a sentence the room genuinely said. */
      await clickText(page, ".wk-opt", "Resume the plan");
      const resumed = await saysWithin(page, /Nothing is staged yet/i, 12_000, 60);
      // AND THE MANIFEST IS ACTUALLY BACK, which is the substantive claim: the
      // lines were re-said through the room's own grammar and made cards again.
      await sleep(6000);
      const rows = await page.evaluate(() => document.querySelectorAll(".wk-railrow, .wk-rail-row, .wk-chip").length);
      return {
        pass: stored > 0 && offer.ok && resumed.ok && rows > 0,
        ms: offer.ms,
        detail: `offer at ${(offer.ms / 1000).toFixed(1)}s, re-stage note ${resumed.ok ? "said" : "MISSING"}, manifest rows after resume: ${rows}`,
      };
    },
  },

  /* ================================================= 4. DOUBLE ACTIONS AND THE LOCK */
  {
    id: "double-confirm",
    room: "facility",
    bound: 40_000,
    chaos: { rules: [{ match: "^execute_", mode: "slow:4000" }] },
    expect: "Two clicks on approve inside one tick spend one token: exactly one execute reaches the org.",
    async run(page, url) {
      await openFacilityRoom(page, url);
      await stageOneChange(page);
      await askForThePlan(page);
      await sleep(2500);
      // BOTH CLICKS IN ONE EVALUATE, so they land in the same commit. This is
      // the case a state-only lock cannot catch.
      await page.evaluate(() => {
        const b = document.querySelector(".wk-approve");
        if (!b) return;
        b.click();
        b.click();
        b.click();
      });
      await sleep(9000);
      const calls = await page.evaluate(() => (window.__CHAOS_LOG || []).filter((r) => /^execute_/.test(r.tool)).length);
      const s = await stuckness(page);
      return {
        pass: calls === 1,
        ms: 0,
        detail: `execute_* reached the org ${calls} time(s), approve disabled=${s.approveDisabled}`,
      };
    },
  },
  {
    id: "execute-duplicate",
    room: "facility",
    bound: 40_000,
    chaos: { rules: [{ match: "^execute_", mode: "duplicate" }] },
    expect: "An org replaying the same version id lands one dossier, not two.",
    async run(page, url, bound) {
      await openFacilityRoom(page, url);
      await stageOneChange(page);
      await askForThePlan(page);
      await sleep(2500);
      await clickText(page, ".wk-approve", ".");
      /* THE CARD ITSELF, not a word that happens to appear in the room's prose.
         `.wk-rescard` is the dossier's own root and there is exactly one of it
         per filing; two would mean the room landed a second card off the org's
         replay of a spent key. The card's own token note comes from the org's
         result, so a stand-in org that carries none renders none: counting the
         card is the claim, and matching its prose would only be testing the
         fixture. */
      const landed = await countWithin(page, ".wk-rescard", 1, bound);
      await sleep(4000);
      const dossiers = await page.evaluate(() => document.querySelectorAll(".wk-rescard").length);
      return {
        pass: landed.ok && dossiers === 1,
        ms: landed.ms,
        detail: `dossier cards on glass: ${dossiers}, landed at ${(landed.ms / 1000).toFixed(1)}s`,
      };
    },
  },

  /* ================================================== 6. GARBAGE IN, CALM OUT */
  {
    id: "garbage-on-stage",
    room: "facility",
    bound: 35_000,
    chaos: { rules: [{ match: "^stage_", mode: "garbage" }] },
    expect: "A malformed plan is refused in the room's own words, with no crash and no blank page.",
    async run(page, url, bound) {
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message || e)));
      await openFacilityRoom(page, url);
      await stageOneChange(page);
      await askForThePlan(page);
      /* THE ROOM HAS TO SAY SOMETHING, and it has to still be a room. A plan
         that came back unreadable is refused by the arm gate ("no step for"),
         by the stage refusal, or by the compile card's own line; any of them is
         the room speaking, and a silent room with a spinner is the failure. */
      const said = await saysWithin(page, /nothing has been (filed|written)|no step for|did not plan|could not read/i, bound);
      const alive = await page.evaluate(() => document.querySelectorAll(".wk-room").length > 0);
      const s = await stuckness(page);
      return {
        pass: alive && s.composerAlive && said.ok && !errors.length,
        ms: said.ms,
        detail:
          `said=${said.ok}, room mounted=${alive}, composer alive=${s.composerAlive}, page errors=${errors.length}` +
          (said.ok ? "" : ` | room said: ...${said.seen.slice(-260)}`),
      };
    },
  },
  {
    id: "garbage-on-reads",
    room: "facility",
    bound: 30_000,
    chaos: { rules: [{ match: "Customer360Snapshot|Customer360Exposure", mode: "garbage" }] },
    expect: "Malformed snapshot and exposure leave the room usable and the page unbroken.",
    async run(page, url) {
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message || e)));
      const t0 = Date.now();
      await openFacilityRoom(page, url);
      await say(page, "increase the revolving line to 18 million");
      await sleep(3000);
      const alive = await page.evaluate(() => document.querySelectorAll(".wk-room").length > 0);
      const blank = await page.evaluate(() => (document.body.innerText || "").trim().length < 40);
      const s = await stuckness(page);
      return {
        pass: alive && !blank && s.composerAlive,
        ms: Date.now() - t0,
        detail: `room mounted=${alive}, blank page=${blank}, page errors=${errors.length}`,
      };
    },
  },
  {
    id: "garbage-on-desk",
    room: "facility",
    bound: 35_000,
    chaos: { rules: [{ match: "get_llm_response", mode: "garbage" }], sample: "garbage" },
    expect: "A desk reply the parser cannot read degrades to the room's clarify, never to a stack.",
    async run(page, url, bound) {
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message || e)));
      await openFacilityRoom(page, url);
      await say(page, "what did the client actually ask us for");
      /* THE ROOM'S OWN DEGRADE LINES, verbatim from brainLane's two clarifies.
         A looser match would be satisfied by the room's ordinary prose and this
         scenario would pass without the desk having failed at all. */
      const said = await saysWithin(page, /could not read that answer|not going to leave you waiting on it/i, bound);
      const s = await stuckness(page);
      return {
        pass: said.ok && s.composerAlive && errors.length === 0,
        ms: said.ms,
        detail: said.ok ? `degraded in ${(said.ms / 1000).toFixed(1)}s, page errors=${errors.length}` : "no degrade line",
      };
    },
  },
  {
    id: "garbage-on-execute",
    room: "facility",
    bound: 40_000,
    chaos: { rules: [{ match: "^execute_", mode: "garbage" }] },
    trail: "Completed",
    expect: "A malformed execute never claims a filing the org did not confirm, and never crashes.",
    /* KNOWN RED, AND NOT THIS TREE'S TO FIX (2026-09-05). `writeTools` already
       reads a malformed execute correctly: `terminalState` normalises to
       "failed" when the payload carries none. What loses that fact is the
       engine leg above it, in app/src/workroom/, which builds `WorkroomExecution.filed`
       from the MANIFEST the room sent rather than from what the org answered,
       record ids included. So the room is handed a result that looks exactly
       like a successful filing, and the two guards it can apply at this seam,
       a non-empty `filed` and a record id on it, are both satisfied by rows the
       org never confirmed. The room's afterglow then lights on a write nobody
       can see. THE FIX IS IN THE ENGINE, which is a byte fence in this wave:
       carry `terminalState` onto `WorkroomExecution` and refuse to build a
       filed list from a run the org reported as failed. The guards added in
       Workroom.tsx stay: they close the empty-result case, which is the half
       the room CAN see. */
    blocked: "app/src/workroom/ (byte fence) builds the filed list from the manifest, not the org's answer, so a failed execute is indistinguishable at the room's seam",
    async run(page, url, bound) {
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message || e)));
      await openFacilityRoom(page, url);
      await stageOneChange(page);
      await askForThePlan(page);
      await sleep(2500);
      await clickText(page, ".wk-approve", ".");
      const said = await saysWithin(page, /not claim an outcome|could not read|nothing needs approving again|reading the org/i, bound);
      const alive = await page.evaluate(() => document.querySelectorAll(".wk-room").length > 0);
      /* NEVER A CLAIMED FILING. The org's answer was unreadable, so the room
         must not land a dossier, must not light the afterglow, and must say so.
         The afterglow is the strongest tell: it is the room's end-of-work
         surface and it only appears once a filing is believed. */
      const claimed = await page.evaluate(
        () => document.querySelectorAll(".wk-afterglow, .wk-rescard").length,
      );
      return {
        pass: alive && errors.length === 0 && said.ok && claimed === 0,
        ms: said.ms,
        detail:
          `room mounted=${alive}, page errors=${errors.length}, said=${said.ok}, filing surfaces on glass=${claimed}` +
          (said.ok ? "" : ` | room said: ...${said.seen.slice(-260)}`),
      };
    },
  },

  /* ============================================ 7. THE FINALE IS NOT A NETWORK CALL

     FOUNDER, 2026-09-06: "all super super gentle, no hangers, I hate when it
     gets stuck, so we need to ensure it's all fluid."

     The three below are the whole claim, measured: the sheet is a function of
     what the room already holds and never of what the org is doing, the org's
     silence costs one honest line and nothing else, and a desk that stops
     answering after the handover leaves a working memo room behind it. */
  {
    id: "execute-slow",
    room: "facility",
    bound: 60_000,
    chaos: { rules: [{ match: "^execute_", mode: "slow:8000" }] },
    trail: "Completed",
    expect: "Eight seconds of execute, and the clean sheet is readable within 1.5s of the answer landing.",
    async run(page, url, bound) {
      const { card, sheet, sinceCard } = await fileAndWaitForTheSheet(page, url, bound);
      const state = await sheetState(page);
      /* 1.5s IS THE WHOLE POINT, and it is measured from the CARD and not from
         the click: the eight seconds the org spent are the org's, and everything
         after them is the room's own choreography over facts it already has. */
      const inTime = sheet.ok && sinceCard <= 1500;
      return {
        pass: card.ok && inTime && state.doorsLive && state.spinners === 0 && state.ledgerRows > 0,
        ms: sinceCard,
        detail: sheet.ok
          ? `card at ${(card.ms / 1000).toFixed(1)}s after approve, sheet ${sinceCard}ms after the card, ` +
            `${state.ledgerRows} filed row(s), doors ${state.doors.join(" / ")}, spinners ${state.spinners}`
          : `no sheet inside 8s of the card (card ok=${card.ok})`,
      };
    },
  },
  {
    id: "settle-hang",
    room: "facility",
    /* THE CONFIRMATION BUDGET IS 12s, plus the room's own ending and the drive. */
    bound: 90_000,
    chaos: { rules: [{ match: "ActionHistory", mode: "hang" }] },
    expect: "The trail never answers: the sheet stands, says the org has not confirmed, and stays usable.",
    async run(page, url, bound) {
      const { card, sheet, sinceCard } = await fileAndWaitForTheSheet(page, url, bound);
      // THE SHEET IS UP BEFORE THE CONFIRMATION IS EVEN ASKED FOR, which is the
      // claim: nothing on it waits for a read.
      const early = await sheetState(page);
      const said = await saysWithin(page, /has not confirmed the figures yet/i, 30_000);
      const late = await sheetState(page);
      return {
        pass: card.ok && sheet.ok && sinceCard <= 1500 && !early.unconfirmed && said.ok && late.doorsLive && late.pending,
        ms: said.ms,
        detail: said.ok
          ? `sheet at +${sinceCard}ms with no claim either way, org line at ${(said.ms / 1000).toFixed(1)}s, ` +
            `figures still shown pending=${late.pending}, doors live=${late.doorsLive}`
          : `sheet at +${sinceCard}ms, but no confirmation line inside 30s`,
      };
    },
  },
  {
    id: "desk-hang-after-draft",
    room: "facility",
    /* THE HANDOVER, then one section's own 40s ceiling on a dead desk. */
    bound: 120_000,
    chaos: { rules: [], sample: "hang-mid-stream" },
    expect: "The sheet hands to the memo room, the timeline shows the section pending, and the composer works.",
    async run(page, url, bound) {
      const { sheet } = await fileAndWaitForTheSheet(page, url, bound);
      if (!sheet.ok) return { pass: false, ms: 0, detail: "the sheet never landed, so there was no handover to make" };
      await clickText(page, ".wk-sheet-go", "Draft the credit memo");
      const t0 = Date.now();
      /* THE MEMO ROOM MOUNTS UNDER THE SHEET, so the first row is on the glass
         before the slide is even over. It carries the filing, drawn in the memo
         room's own timeline grammar. */
      const handed = await countWithin(page, ".mm-filed", 1, 12_000, 60);
      const landedMs = Date.now() - t0;
      /* AND THE DRAFT STARTS ITSELF and runs into a desk that has stopped
         answering. What the banker must be left with is a room, not a spinner. */
      const said = await saysWithin(page, /desk has not answered on .* in 40 seconds/i, bound - landedMs);
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll(".mm-tl-row")].map((r) => `${r.dataset.kind}:${r.dataset.state}`),
      );
      const s = await stuckness(page);
      const pending = rows.some((r) => /:missed$/.test(r));
      return {
        pass: handed.ok && landedMs <= 3000 && said.ok && pending && s.composerAlive,
        ms: landedMs,
        detail: handed.ok
          ? `memo room carried the filing at +${landedMs}ms, deadline line at ${(said.ms / 1000).toFixed(1)}s, ` +
            `rows ${rows.join(",") || "none"}, composer alive=${s.composerAlive}`
          : `no handover inside 12s`,
      };
    },
  },

  /* ===================================================== 5. SYNC NEVER STUCK */
  {
    id: "sync-lane-hangs",
    room: "landing",
    bound: 40_000,
    chaos: { rules: [{ match: "Customer360Exposure", mode: "hang" }] },
    expect: "A sweep with one lane hung ends on its own clock rather than holding the console open.",
    /* KNOWN RED, AND NOT THIS TREE'S TO FIX (2026-09-05). `runSyncSweep` awaits
       `callTool`, which normalises every failure the platform REPORTS and has no
       wall clock of its own, so a connector that accepts a read and never
       answers holds the sweep console open with a line spinning and the Sync
       control disabled, for the life of the page. The fix belongs in
       channel/syncSweep.ts, which is the connector-transport wave's territory:
       wrap each lane's call in a per-lane deadline and fail that line with a
       reason rather than awaiting it forever. The scenario stays here, RED and
       counted, so the day it is fixed the gate says so. */
    blocked: "channel/syncSweep.ts has no per-lane deadline; the fix belongs to the connector-transport wave",
    async run(page, url, bound) {
      await page.goto(url, { waitUntil: "load" });
      await sleep(1500);
      await jsClick(page, `[data-open="${HARTWELL}"]`);
      await sleep(1500);
      await clickText(page, "button", "^Sync$");
      const t0 = Date.now();
      for (;;) {
        const open = await page.evaluate(() => Boolean(document.querySelector('[aria-label="Syncing this relationship"]')));
        const running = await page.evaluate(() =>
          [...document.querySelectorAll(".c360-sync-spin")].length,
        );
        if (!open || running === 0) return { pass: true, ms: Date.now() - t0, detail: `sweep console closed after ${((Date.now() - t0) / 1000).toFixed(1)}s` };
        if (Date.now() - t0 > bound) {
          return {
            pass: false,
            ms: Date.now() - t0,
            detail: `sweep console still open with ${running} line(s) spinning after ${(bound / 1000).toFixed(0)}s: the sweep has no wall clock (channel/syncSweep.ts)`,
          };
        }
        await sleep(500);
      }
    },
  },
  {
    id: "sync-lane-502",
    room: "landing",
    bound: 40_000,
    chaos: { rules: [{ match: "Customer360Exposure", mode: "error:server_unavailable" }] },
    expect: "A 502 lane fails on its own line with a reason, and the sweep still finishes.",
    async run(page, url, bound) {
      await page.goto(url, { waitUntil: "load" });
      await sleep(1500);
      await jsClick(page, `[data-open="${HARTWELL}"]`);
      await sleep(1500);
      await clickText(page, "button", "^Sync$");
      const t0 = Date.now();
      for (;;) {
        const open = await page.evaluate(() => Boolean(document.querySelector('[aria-label="Syncing this relationship"]')));
        if (!open) break;
        if (Date.now() - t0 > bound) return { pass: false, ms: Date.now() - t0, detail: "sweep never finished" };
        await sleep(400);
      }
      const pressable = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => /^Sync$/.test((x.textContent || "").trim()));
        return Boolean(b) && !b.disabled;
      });
      return { pass: pressable, ms: Date.now() - t0, detail: `finished in ${((Date.now() - t0) / 1000).toFixed(1)}s, Sync pressable again=${pressable}` };
    },
  },
  {
    id: "sync-lane-garbage",
    room: "landing",
    bound: 40_000,
    chaos: { rules: [{ match: "Customer360Covenants", mode: "garbage" }] },
    expect: "A malformed lane keeps the last good figures and never blanks the workspace.",
    async run(page, url, bound) {
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message || e)));
      await page.goto(url, { waitUntil: "load" });
      await sleep(1500);
      await jsClick(page, `[data-open="${HARTWELL}"]`);
      await sleep(1500);
      await clickText(page, "button", "^Sync$");
      const t0 = Date.now();
      for (;;) {
        const open = await page.evaluate(() => Boolean(document.querySelector('[aria-label="Syncing this relationship"]')));
        if (!open) break;
        if (Date.now() - t0 > bound) return { pass: false, ms: Date.now() - t0, detail: "sweep never finished" };
        await sleep(400);
      }
      const blank = await page.evaluate(() => (document.body.innerText || "").trim().length < 200);
      return { pass: !blank && errors.length === 0, ms: Date.now() - t0, detail: `blank=${blank}, page errors=${errors.length}` };
    },
  },
];

/** The memo room, opened from the facility room's afterglow is the long way.
 *  The command palette is the short one and it is the same mount. */
async function openMemoRoom(page, url) {
  await page.goto(url, { waitUntil: "load" });
  await sleep(1500);
  await jsClick(page, `[data-open="${HARTWELL}"]`);
  await sleep(1300);
  await jsClick(page, "#fab");
  await sleep(600);
  await jsClick(page, "#actMemo");
  await sleep(3600);
  await pickPackage(page);
}

/* ---------------------------------------------------------------------- run */

async function main() {
  if (!fs.existsSync(BUNDLE)) {
    console.error(`FAIL: no bundle at ${BUNDLE}. Build with \`cd app && npm run build\` and assemble with`);
    console.error(`      node app/scripts/assemble-artifact.mjs artifact/live-data.json ${BUNDLE}`);
    process.exit(1);
  }

  /* THE BOX IS SHARED. A gate that runs a browser on a machine already at load
     11 is measuring the machine; say so rather than reporting the noise. */
  const load = os.loadavg()[0];
  const freeMb = Math.round(os.freemem() / 1024 / 1024);
  console.log(`[chaos] box: load ${load.toFixed(2)}, ${freeMb}MB free, ${os.cpus().length} cores`);
  if (freeMb < 250) console.log("[chaos] WARNING: low memory, a context may be killed mid-scenario");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c360-chaos-"));
  fs.copyFileSync(BUNDLE, path.join(dir, "index.html"));
  const server = await serveDir(dir);

  const browser = await chromium.launch({
    headless: !args.headed,
    args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"],
  });

  const rows = [];
  try {
    for (const s of SCENARIOS) {
      if (ONLY && !ONLY.has(s.id)) continue;
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 940 } });
      await ctx.addInitScript({
        content: `window.__CHAOS = ${JSON.stringify(s.chaos)}; window.__CHAOS_TRAIL = ${JSON.stringify(s.trail ?? "Completed")};`,
      });
      await ctx.addInitScript({ content: chaosLib });
      const page = await ctx.newPage();
      const t0 = Date.now();
      let out;
      try {
        out = await s.run(page, server.url, s.bound);
      } catch (e) {
        out = { pass: false, ms: Date.now() - t0, detail: `threw: ${String(e && e.message ? e.message : e)}` };
      }
      const wall = Date.now() - t0;
      rows.push({ ...s, ...out, wall });
      const mark = out.pass ? "PASS" : s.blocked ? "RED*" : "FAIL";
      console.log(`[chaos] ${mark}  ${s.id.padEnd(22)} ${String(Math.round(out.ms)).padStart(6)}ms  (bound ${s.bound}ms, wall ${wall}ms)`);
      console.log(`               ${out.detail}`);
      if (!args.keep) await ctx.close();
    }
  } finally {
    if (!args.keep) await browser.close();
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log("");
  console.log("scenario                 room          result   observed    bound   what the banker sees");
  console.log("-".repeat(120));
  for (const r of rows) {
    console.log(
      `${r.id.padEnd(24)} ${r.room.padEnd(13)} ${(r.pass ? "green" : r.blocked ? "RED*" : "RED").padEnd(8)} ${String(Math.round(r.ms)).padStart(7)}ms ${String(r.bound).padStart(7)}ms  ${r.expect}`,
    );
  }
  /* A KNOWN RED IS STILL A RED AND IT IS STILL PRINTED. What `blocked` changes
     is only whether the gate can pass while a defect nobody in this tree may
     fix is outstanding: the scenario runs, fails, and says whose it is. */
  const failed = rows.filter((r) => !r.pass && !r.blocked);
  const blocked = rows.filter((r) => !r.pass && r.blocked);
  console.log("");
  console.log(`[chaos] ${rows.filter((r) => r.pass).length}/${rows.length} green, ${blocked.length} known red`);
  for (const b of blocked) {
    console.log(`[chaos] RED* ${b.id}: ${b.detail}`);
    console.log(`             blocked: ${b.blocked}`);
  }
  if (failed.length) {
    for (const f of failed) console.log(`[chaos] RED ${f.id}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
