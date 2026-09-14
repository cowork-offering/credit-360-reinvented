/* WORKROOM BROWSER DRIVE (orchestrator gate, 2026-09-13). Drives the modification room on the
   BUILT page with the probe stub lanes, handing the lane the chosen borrower's REAL exposure +
   covenants + snapshot + graph via __LANES.livePatch, types the founder's transcript +
   stress-script lines into the real composer, and asserts per turn: a NEW room reply arrives, it
   is not a repeat of the previous reply, a "One decision at a time" refusal only appears while an
   open card/chips are visible, no em dash.
   SCENARIOS ARE TYPED (0.9.23). A scenario is either a COMPOSER script, which is what every
   scenario before this release was and which is unchanged, or a DRIVE, a function handed the page
   after the relationship is open. The version-lifecycle scenarios are drives: they walk the trail,
   the panel and the create room rather than typing into a composer. A scenario may also declare
   `version`, which switches on the stub's in-flight modification version, and `pending: "<agent>"`,
   which reports it separately rather than counting its findings as a gate failure.

   ============================ THE RULE: EVERY RELEASE RUNS THE MATRIX ============================

   Founder, 2026-09-13: "it is not only Hartwell, it needs to work everywhere." One book green is
   not a gate, it is a coincidence: every sentence the room prints about "which package", "which
   one of those", a guarantor, a pledge or a coverage ratio is a sentence some OTHER book says
   differently, and a drive pinned to one relationship cannot see any of it.

   So no release ships on one book. `node ../design/probes/gate.mjs` (npm: `npm run gate:drives`
   in app/) runs EVERY scenario below on Hartwell, Kingsley and Piedmont plus the spread drive's
   three files, prints one table and exits non-zero on any finding. Run it before the version bump,
   not after.

   THE THREE BOOKS ARE CHOSEN, not arbitrary. Hartwell is the founder's own: two packages, nine
   facilities, two lines of credit, twenty-six graph rows. Kingsley is ONE package, one revolver
   (so no "which one?" question), a Paid Off member and two guarantors. Piedmont is one package
   with NOTHING BOOKED, so a credit action has nothing to run against and no modification version
   can exist at all. Between them they exercise both sides of every fork in the room.

   A BOOK THAT CANNOT ASK A QUESTION MUST STILL BE ASSERTED ON. Where a scenario's question does
   not arise on this book (one package binds silently, one facility of a product needs no
   disambiguation, no booked facility means no modification), the scenario asserts the SIMPLE path
   instead and reports `path` saying which it took. It is never skipped: the simple path is where
   the single-book defects live.

   Usage: node workroom-e2e.mjs [bundle.html] [scenario] [out.json] [--book <accountId|name>] */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "/opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented/design/probes/node_modules/playwright/index.mjs";
import { serveDir } from "/opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented/design/probes/lib/serve.mjs";
import { bookParams, resolveBook, fmtMoney } from "/opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented/design/probes/lib/book.mjs";
const ROOT = "/opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented";
/** `--book <id|name>` may sit anywhere; everything else stays positional. */
function takeFlag(name) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return null;
  const value = process.argv[at + 1] ?? null;
  process.argv.splice(at, value === null ? 1 : 2);
  return value;
}
const BOOK_ARG = takeFlag("book") || "Hartwell";
const BUNDLE = process.argv[2] || path.join(ROOT, "app/dist/cockpit.html");
const ONLY = process.argv[3] || null;
const OUT = process.argv[4] || "wk-e2e-out.json";
const STUB = fs.readFileSync(path.join(ROOT, "design/probes/lib/stub-lanes.js"), "utf8");
const SAMPLE = fs.readFileSync(path.join(ROOT, "design/probes/lib/stub-sample.js"), "utf8");
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, "artifact/live-data.json"), "utf8"));
/* THE DRIVE RUNS ON ONE REAL BOOK, AND `--book` SAYS WHICH. The snapshot and the relationship
   graph ride with the exposure and the covenants (and the opportunities and the structural
   signals), so every label the room prints names THIS borrower and every party the parser resolves
   is a real row off its own graph rather than the stub's empty one. Without the graph the party
   asks were answered out of nothing; without the snapshot the room read the lane's default name
   over the patched facilities. `lib/book.mjs` owns the mapping and every derived figure. */
const ACCOUNT = resolveBook(LIVE, BOOK_ARG);
const BOOK = bookParams(LIVE, ACCOUNT);
const patch = BOOK.patch;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wk-e2e-")); fs.mkdirSync(path.join(dir, "b"), { recursive: true });
execFileSync("node", [path.join(ROOT, "app/scripts/assemble-artifact.mjs"), path.join(ROOT, "artifact/live-data.json"), path.join(dir, "b/index.html"), BUNDLE], { stdio: "ignore" });
const server = await serveDir(dir);
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--no-sandbox"] });

/* "THE LINE OF CREDIT" NAMES NEITHER, on a package carrying two of them, so the
   room asks which and the banker answers (D1, 2026-09-13). The pick is ADDED to
   each script rather than replacing anything: every line the drive asserted on
   before is still typed, in the same order, after the member is settled.

   ON A BOOK CARRYING ONE OF THEM THERE IS NOTHING TO ASK, so the pick line is
   dropped and the scenario reports that it took the silent path. Typing it
   anyway would be the drive answering a question the room never put. */
const PICK = BOOK.ambiguousMember ? BOOK.pickLine : null;
/** The script, with the member pick in it only where the book raises the question. */
const withPick = (lines) => lines.filter((l) => l !== null && l !== undefined);

/* THE IN-FLIGHT VERSION THE STUB CARRIES for every version-lifecycle scenario. The source is this
   book's most-booked package and the moved facility is its largest line of credit, which the
   filing renames to the raised figure on the clone. The clone set is the source's ACTIVE members,
   one for one: that is what nCino's credit action produces and what `book/packages.ts` recognises
   as a fork. Null on a book with no booked package, because a credit action only runs against a
   booked loan and therefore no version of it can exist. */
const VERSION = BOOK.version;
const SOURCE_PACKAGE = VERSION ? VERSION.source : null;
const VERSION_PACKAGE = VERSION ? VERSION.id : null;
/** The regex that finds this book's working package in a picker row. */
const PKG_WANT = BOOK.packageId;

/* THE SENTENCES, COMPOSED FROM THE BOOK. Every one of them is the founder's own line with its
   figures and its names taken off whichever relationship is open: on Hartwell they render back to
   the literal transcript ("Increase the line of credit by 20M USD", "the $15M line of credit",
   "Hold 6.58%"), and on another book they say the same thing about that book's own facility. */
const P = BOOK.product;
const SCENARIOS = {
  founderTranscript: {
    lines: withPick([
      `Increase the ${P} by ${BOOK.raisedToPhrase} USD`,
      PICK,
      "240 months",
      "1 October 2026",
      BOOK.holdRate === null ? "no change" : `Hold ${BOOK.holdRate}%`,
      "what borrowers are on this loan already ?",
      BOOK.pushRate === null ? "keep it" : `yes increase to ${BOOK.pushRate}%`,
      "show me the pledges on this loan",
    ]),
  },
  stressRate: {
    lines: withPick([
      `Increase the ${P} to ${BOOK.raisedToPhrase}`,
      PICK,
      BOOK.pushRate === null ? "7.25%" : `${BOOK.pushRate}%`,
      "asdf",
      "keep it",
      "240 months",
      "1 October 2026",
      "no change",
    ]),
  },
  relativeAndSign: {
    lines: withPick([`add 50bps on the ${P}`, PICK, "-5%", "actually 8%", "what is this covenant doing?"]),
  },
  /* 0.9.23, IMPROVEMENTS row 44. Parties and collateral, in the founder's own words: the plural
     collateral read, the borrowing-structure reads, a party named by her first name, "this loan"
     for a removal, and the line that already worked. A book with ONE guarantor cannot be asked to
     add a second party, so that line is dropped and the scenario says so. */
  founderParties: {
    lines: withPick([
      "show me all my collaterals",
      "show my full collaterals",
      "who are the guarantors on this package",
      `which entities are on ${BOOK.ambiguousMember ? BOOK.pickLine : "this package"}`,
      BOOK.removeFirstName ? `remove ${BOOK.removeFirstName} from this loan` : null,
      BOOK.removeParty ? `remove ${BOOK.removeParty} from this loan` : null,
      BOOK.removeParty ? `remove ${BOOK.removeParty} as guarantor from the ${BOOK.bareMoney} ${P.toLowerCase()}` : null,
      BOOK.addParty ? `add ${BOOK.addParty} as guarantor on the ${BOOK.bareMoney} ${P.toLowerCase()}` : null,
    ]),
    path: [
      BOOK.removeFirstName ? null : "no guarantor on this book is a person, so no first-name ask",
      BOOK.addParty ? null : `one guarantor on this book, so no second party to add`,
    ].filter(Boolean).join("; ") || null,
    /* THE ROOM MUST SEE THE PARTY IT IS BEING ASKED ABOUT (D1, 2026-09-13). The
       per-turn rules cannot catch this one: three replies that never name the
       guarantor are three different sentences, all fresh, none a repeat, and on
       Kingsley that is exactly what came back ("I read the Term Loan A, but not
       what should change on it") while the card two lines above listed him. So
       the scenario reads the whole transcript once: a party the drive named off
       the book's own graph has to appear in what the room said back. */
    check: (said, findings) => {
      for (const who of [BOOK.removeParty, BOOK.addParty].filter(Boolean)) {
        if (!said.includes(who)) findings.push(`the room never names ${who}, a guarantor on this book's own relationship graph`);
      }
      if (/but not what should change on/i.test(said) && BOOK.removeParty) {
        findings.push(`a party line was answered as a facility the room could not change: "${said.match(/[^|]*but not what should change on[^|]*/i)?.[0]?.trim().slice(0, 160)}"`);
      }
    },
  },
  /* 0.9.23. The undo, end to end on the built page: the trail's standing row, the panel, the org's
     inventory on the confirm gate, and the book afterwards. */
  discardVersion: { version: true, drive: driveDiscard, needsVersion: true },
  /* 2c.1, both halves. "New package" leads the create room's offer from the relationship; from
     inside the version, the version leads and "New package" follows, and the booked SOURCE of the
     version is on neither list. */
  createFromRelationship: { version: true, drive: driveCreateFromRelationship, needsVersion: true },
  createInsideVersion: { version: true, drive: driveCreateInsideVersion, needsVersion: true },
  /* 2a.1, C1's amend engine, LANDED: the route, the arm on the wire and the figure on the
     version's own loan afterwards. No longer pending. */
  amendVersion: { version: true, drive: driveAmend, needsVersion: true },
  /* 0.9.23 P0. THE RELAY DROPS THE ANSWER (the founder's 502, 2026-09-13): the org takes the plan
     and the page never hears back. Both halves, on the built page: one dropped answer, which the
     room must survive without a duplicate staging row, and every answer dropped, where the room
     must name the row Salesforce is holding instead of saying nothing was filed. */
  relayDrop: { drive: driveRelayDrop },
  /* ROW 51. THE DOORS OPEN ON EVERY BOOK. The relationship room and the memo door were driven on
     Hartwell alone, where the package question is always asked; a book that binds its one package
     silently walks a different branch through both of them, and a door that throws on it is a
     door the founder finds. The create room's own door is `createFromRelationship`. */
  doorsOpen: { drive: driveDoors },
  /* ROW 49. COVENANTS AND COLLATERAL ARE RELATIONSHIP-DRIVEN. Both reviews, on the built page: no
     package question, every covenant and every owned asset listed with the facilities and packages
     it is tied to, the wire anchored on the account, and the filing taken to Confirm. */
  relationshipReviews: { drive: driveRelationshipReviews },
};

/** A page on the built bundle, on the stub lanes, with the CHOSEN book open. One door for every
 *  scenario, script or drive, so no two of them open the cockpit differently. */
async function openPage(version) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await page.addInitScript(STUB); await page.addInitScript(SAMPLE);
  await page.addInitScript((cfg) => { var i = setInterval(function () { if (window.__LANES) { clearInterval(i); window.__LANES.relayMs = 200; window.__LANES.livePatch = Object.assign({}, window.__LANES.livePatch || {}, cfg.patch); if (cfg.version) window.__LANES.version = cfg.version; } }, 0); }, { patch, version: version || null });
  await page.goto(server.url + "b/", { waitUntil: "commit" });
  await page.waitForSelector(`[data-open="${ACCOUNT}"]`, { timeout: 30000 });
  await page.click(`[data-open="${ACCOUNT}"]`); await page.waitForSelector("#view-account .hero", { timeout: 15000 });
  await page.waitForTimeout(2500);
  return { page, errs };
}

/** Open the facility room from the arc. It opens on the ROUTE question (spec 2c.3). */
async function openFacilityRoom(page) {
  await page.click("#fab"); await page.waitForSelector("#actFacility", { state: "visible", timeout: 6000 }); await page.waitForTimeout(400);
  await page.click("#actFacility"); await page.waitForSelector(".wk-root", { state: "attached", timeout: 8000 });
  await page.waitForTimeout(4000);
}

/** The package rows the route just scoped, as the ask renders them. */
async function packageRows(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".wk-pkgask .wk-pkg")].map((r) => ({
      id: r.getAttribute("data-pkg"),
      blocked: r.disabled,
      line: (r.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
    })),
  );
}

/** ROUTE FIRST, PACKAGE SECOND. Take the route, then answer the question it scopes.
 *  Returns the row that was taken, "[blocked] …" where the route closed it, or null
 *  where the route asks for no package at all.
 *
 *  THE ROW IS FOUND BY ID, not by a phrase in its label (D1, 2026-09-13). The
 *  label is derived from the products the package carries and says nothing about
 *  the facility a scenario is aiming at, so the old regex fell through to
 *  `rows[0]` on the one book it was written for and would have picked a
 *  different package on the next one. `want` is the package id; the regex is
 *  kept as the fallback for a row whose id attribute is missing. */
async function routeThenPackage(page, route, want) {
  await takeRoute(page, route);
  await page.waitForTimeout(3000);
  return page.evaluate((id) => {
    const rows = [...document.querySelectorAll(".wk-pkgask .wk-pkg")];
    if (!rows.length) return null;
    const hit = rows.find((r) => r.getAttribute("data-pkg") === id) || rows[0];
    if (hit.disabled) return "[blocked] " + (hit.textContent || "").trim().slice(0, 80);
    hit.click(); return (hit.textContent || "").trim().slice(0, 80);
  }, want);
}

/** STAND IN A PACKAGE BEFORE THE ROUTE, the way the header's own switch does. The
 *  route question is still open afterwards: anchoring is not binding. */
async function standInPackage(page, want) {
  await page.click(".wk-pkgline");
  await page.waitForSelector("[data-pkgrow]", { timeout: 8000 });
  const took = await page.evaluate((re) => {
    const rows = [...document.querySelectorAll("[data-pkgrow]")];
    const hit = rows.find((r) => new RegExp(re, "i").test(r.textContent || ""));
    if (!hit) return null;
    if (hit.disabled) return "[blocked] " + (hit.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
    hit.click(); return (hit.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
  }, want);
  await page.waitForTimeout(4000);
  return took;
}

/* ============================ THE ROUTES ARE DOORS ON THE ENTRY SHEET (0.9.25)

   Founder design-intent gate, 2026-09-14 (knowledge/DESIGN-0.9.24-ENTRY.md): both rooms open on
   one centred sheet carrying the relationship, one line of state and the routes as large glass
   doors, instead of a greeting bubble with option pills under it. A route the book has shut stays
   on the sheet, disabled, carrying the book's own reason (A27.3).

   So every drive reads `[data-door="<route>"]` rather than a chip. The route ids are the room's
   own: modify, renew, create, amend, memo in the facility room; annual, covenant, valuation,
   rating, service, intake, versionCovenant, versionPledge in the relationship room.           */

/** Every door on the sheet: its route, its label, its one line, and whether it is shut. */
async function doorRows(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".wk-entry-door[data-door]")].map((d) => {
      const label = d.querySelector(".wk-entry-dl");
      const line = d.querySelector(".wk-entry-dw");
      return {
        route: d.getAttribute("data-door"),
        label: ((label && label.textContent) || "").replace(/\s+/g, " ").trim(),
        line: ((line && line.textContent) || "").replace(/\s+/g, " ").trim(),
        shut: !!d.disabled,
      };
    }),
  );
}

/** The labels the sheet is offering, in order. */
async function doorLabels(page) {
  return (await doorRows(page)).map((d) => d.label);
}

/** Click the door whose route id matches, or whose label does. `exact` is off for a drive that
 *  knows the start of a label but not the whole of it. Returns false where the door is shut. */
async function takeDoor(page, want, { exact = true } = {}) {
  await page
    .waitForFunction(
      ([w, e]) =>
        [...document.querySelectorAll(".wk-entry-door[data-door]")].some((d) => {
          const n = d.querySelector(".wk-entry-dl");
          const label = ((n && n.textContent) || "").trim();
          return d.getAttribute("data-door") === w || (e ? label === w : label.startsWith(w));
        }),
      [want, exact],
      { timeout: 25000 },
    )
    .catch(() => {});
  return page.evaluate(([w, e]) => {
    const door = [...document.querySelectorAll(".wk-entry-door[data-door]")].find((d) => {
      const n = d.querySelector(".wk-entry-dl");
      const label = ((n && n.textContent) || "").trim();
      return d.getAttribute("data-door") === w || (e ? label === w : label.startsWith(w));
    });
    if (!door || door.disabled) return false;
    door.click();
    return true;
  }, [want, exact]);
}

/** Take the route door with this exact label. */
async function takeRoute(page, label) {
  await takeDoor(page, label);
}

async function runScript(name, lines, version, check) {
  const { page, errs } = await openPage(version);
  await openFacilityRoom(page);
  /* ROUTE FIRST, PACKAGE SECOND (spec 2c.3, founder 2026-09-13). The room opens on the route
     question; a MULTI-PACKAGE book then asks which package the route runs in, and on this book
     that is the one carrying the target facility. A ONE-PACKAGE book is never asked: the room
     binds it silently, `routeThenPackage` comes back null, and the scenario records that it took
     the silent path rather than pretending a question was answered. The composer wakes either
     way, and everything after this line is identical on both. */
  const picked = await routeThenPackage(page, "Modify", PKG_WANT);
  /* A COMPOSER THAT NEVER WAKES IS A FINDING, NOT A CRASH. On one book the wait always ends and
     on another the room may refuse at the door; a drive that threw here would take the rest of
     the matrix with it and say nothing about why. */
  const awake = await page
    .waitForFunction(() => { const t = document.querySelector(".wk-txt"); return t && !t.disabled; }, null, { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  if (!awake) {
    const visible = await page.evaluate(() => ((document.querySelector(".wk-root") || {}).textContent || "").replace(/\s+/g, " ").trim().slice(0, 400));
    await page.close();
    return {
      name,
      book: BOOK.relationship,
      path: "the composer never woke after the route was taken",
      picked,
      turns: [],
      approveDoors: [],
      findings: [`the composer never woke after Modify was taken; the room said: "${visible}"`],
      pageErrors: errs,
    };
  }
  await page.waitForTimeout(600);
  const agentText = () => page.$$eval(".wk-msg.wk-agent .wk-bub", (ns) => ns.map((n) => (n.textContent || "").trim()));
  // A READ CARD IS A REPLY TOO. "show me the pledges" is answered by a card inside the live step, not by an agent bubble,
  // so the live step's own text (minus the banker's line and the review chip) counts as the room having spoken.
  const stepAnswer = (line) => page.evaluate((l) => {
    const steps = [...document.querySelectorAll(".wk-step")].filter((n) => n.offsetParent !== null && !/\bwk-gone\b/.test(n.className));
    const last = steps[steps.length - 1]; if (!last) return "";
    const own = (last.querySelector(".wk-msg.wk-you, .wk-you") || {}).textContent || "";
    const bubbles = [...last.querySelectorAll(".wk-msg.wk-agent .wk-bub")].map((n) => n.textContent || "").join("");
    let t = (last.textContent || "").replace(own, "").replace(bubbles, "").replace(l, "").replace(/\d+ changes? · .*$/, "").trim();
    return t.slice(0, 400);
  }, line);
  const turns = [];
  let prevCount = (await agentText()).length;
  let prevLast = (await agentText()).slice(-1)[0] || "";
  for (const line of lines) {
    await page.waitForFunction(() => { const t = document.querySelector(".wk-txt"); return t && !t.disabled; }, null, { timeout: 20000 });
    await page.fill(".wk-txt", line); await page.keyboard.press("Enter");
    const t0 = Date.now();
    let replies = []; let settled = false;
    while (Date.now() - t0 < 25000) {
      await page.waitForTimeout(400);
      replies = await agentText();
      const composerFree = await page.evaluate(() => { const t = document.querySelector(".wk-txt"); return !!t && !t.disabled; });
      const thinking = await page.$(".wk-thinking, [data-desk]");
      const stepNow = await stepAnswer(line);
      if ((replies.length > prevCount || stepNow.length > 20) && composerFree && !thinking) { settled = true; break; }
    }
    // let the pacer finish
    await page.waitForTimeout(1500); replies = await agentText();
    // THE BANKER'S HAND: when the room puts a confirm / acknowledge chip up, take it (as the founder did), then let the room settle
    const CHIP = 'button.eg-btn-ink, .wk-opts button, .wk-opt, .wk-chip';
    for (let k = 0; k < 4; k++) {
      const took = await page.evaluate((sel) => {
        const ns = [...document.querySelectorAll(sel)].filter((n) => n.offsetParent !== null);
        const hit = ns.find((n) => /^(Confirm|Acknowledge|Acknowledged|Yes, confirm|Confirm and file)/i.test((n.textContent || "").trim()));
        if (hit) { const t = hit.textContent.trim(); hit.click(); return t; } return null;
      }, CHIP);
      if (!took) break;
      turns.push({ you: `[chip] ${took}`, ms: 0, replied: true, repeat: false, refusal: false, visibleChips: 0, openCard: 0, emDash: false, freshCount: 0, reply: "" });
      await page.waitForTimeout(2200);
    }
    replies = await agentText();
    const CANNED = /leverage stands inside policy|coverage cushion is intact/i;
    const fresh = replies.slice(prevCount).filter((f) => !CANNED.test(f));
    const cardText = fresh.length ? "" : await stepAnswer(line);
    if (cardText.length > 20) fresh.push("[card] " + cardText);
    const last = fresh.slice(-1)[0] || "";
    const chipLabels = await page.$$eval(".wk-opts button, .wk-opt, .wk-chip, button.eg-btn-ink, button.eg-btn-quiet", (ns) => ns.filter((n) => n.offsetParent !== null).map((n) => (n.textContent || "").trim().slice(0, 50)));
    const visibleChips = chipLabels.length;
    const openCard = await page.$$eval("[data-live], .wk-card, .wk-challenge, .wk-gate", (ns) => ns.filter((n) => n.offsetParent !== null).length);
    const refusal = /One decision at a time/.test(last);
    turns.push({ you: line, ms: Date.now() - t0, replied: fresh.length > 0, repeat: last !== "" && last === prevLast, freshCount: fresh.length, refusal, visibleChips, openCard, emDash: fresh.some((f) => /—/.test(f)), chipLabels, reply: fresh.map((f) => f.slice(0, 160)).join(" || ") });
    prevCount = replies.length; if (last) prevLast = last;
  }
  const approve = await page.$$eval(".wk-approve", (ns) => ns.filter((n) => n.offsetParent !== null).map((n) => n.textContent.trim()));
  const findings = [];
  turns.forEach((t, i) => {
    if (!t.replied) findings.push(`turn ${i + 1} "${t.you}": no reply within 25 s`);
    if (t.repeat) findings.push(`turn ${i + 1} "${t.you}": reply repeats the previous reply`);
    if (t.refusal && t.visibleChips === 0 && t.openCard === 0) findings.push(`turn ${i + 1} "${t.you}": one-decision refusal with nothing visible to act on`);
    if (t.emDash) findings.push(`turn ${i + 1}: em dash in a reply`);
  });
  /* ------------------------------------------------- what THIS book must also be true about

     THE SIMPLE PATHS ARE ASSERTED, NEVER SKIPPED. On a one-package book the room must bind
     silently rather than put an empty question up; on a book with no booked facility a credit
     action has nothing to run against, so the room must SAY so in the org's own terms and must
     never open an approval door over it. Both are paths the founder's own book never takes. */
  const said = turns.map((t) => t.reply || "").join(" || ");
  const path = [];
  if (BOOK.multiPackage) {
    path.push(`package asked, took ${BOOK.packageId}`);
    if (!picked) findings.push("the Modify route asked no package on a relationship staging more than one");
    else if (/^\[blocked\]/.test(String(picked))) findings.push(`the Modify route blocked this book's own working package: ${picked}`);
  } else {
    path.push("one package, bound silently");
    if (picked) findings.push(`the room put a package question up on a one-package relationship: ${picked}`);
  }
  if (BOOK.ambiguousMember) path.push(`${BOOK.siblings.length} ${BOOK.product} on the package, member asked`);
  else path.push(`one ${BOOK.product} on the package, member bound silently`);
  if (!BOOK.hasBooked) {
    path.push("nothing booked on this relationship, so the modification is refused");
    if (!/booked/i.test(said)) {
      findings.push("no booked facility on this relationship and the room never says that is why nothing here can be modified");
    }
    if (approve.length) findings.push(`an approval door opened on a relationship with no booked facility: ${JSON.stringify(approve)}`);
  }
  /* AND THE ROOM NAMES THIS BORROWER. A label carrying another book's name is the single
     cheapest sign that a read was answered off the lane's default body rather than off the
     patch, and it is invisible on the book the default happens to be. */
  const strangers = Object.values(LIVE.borrowers || {})
    .map((b) => String((b.snapshot || {}).name || "").trim())
    .filter((n) => n && n !== BOOK.relationship);
  for (const other of strangers) if (said.includes(other)) findings.push(`the room named "${other}" while ${BOOK.relationship} was open`);
  /* AND THE SCENARIO'S OWN READ OVER THE WHOLE TRANSCRIPT, for the properties no
     per-turn rule can see. The per-turn `reply` is capped at 160 characters a
     bubble so the report stays readable, which is right for a rule about a turn
     and useless for a rule about a NAME that may sit inside a card: the check is
     handed everything still on the glass beside it. */
  if (check) {
    const onGlass = await page.evaluate(() => ((document.querySelector(".wk-root") || {}).textContent || "").replace(/\s+/g, " ").trim());
    check(`${said} || ${onGlass}`, findings, BOOK);
  }
  await page.close();
  return { name, book: BOOK.relationship, path: path.join("; "), picked, turns, approveDoors: approve, findings, pageErrors: errs };
}
/* ============================================================ the version drives

   Not composer scripts. The undo is taken from the Activity trail's standing row and confirmed at
   the gate; the create-room checks read the offer the room actually renders. Each returns the same
   shape a script does, so the harness reports them the same way. */

const text = (page, sel) => page.evaluate((s) => { const n = document.querySelector(s); return n ? (n.textContent || "").replace(/\s+/g, " ").trim() : null; }, sel);

/** The trail tab, and the standing Modification in Progress row on it. */
async function openTrail(page) {
  await page.click('[data-pane="activity"]');
  await page.waitForTimeout(900);
}

async function driveDiscard(page) {
  const findings = [];
  const turns = [];
  const note = (you, reply) => turns.push({ you, reply, replied: !!reply, repeat: false, refusal: false, emDash: /—/.test(reply || ""), visibleChips: 0, openCard: 0, freshCount: reply ? 1 : 0, ms: 0 });

  await openTrail(page);
  const standing = await text(page, '[data-inflight-row="1"]');
  note("[open] Activity trail", standing);
  if (!standing) findings.push("the Activity trail carries no Modification in Progress row while a version is in flight");
  else {
    if (!/Modification in Progress/.test(standing)) findings.push("the standing row does not name Modification in Progress");
    if (!/editable until approval/.test(standing)) findings.push("the standing row does not say the version is editable until approval");
  }

  const door = await page.$('[data-discard-door="trail"]');
  if (!door) { findings.push("no Discard this version door on the trail"); return { turns, findings }; }
  await door.click();
  await page.waitForSelector('[role="dialog"][aria-label="Discard this version"]', { timeout: 8000 });
  await page.waitForTimeout(500);
  const intro = await text(page, '[role="dialog"][aria-label="Discard this version"]');
  note("[chip] Discard this version", (intro || "").slice(0, 300));
  if (intro && !/stays exactly as it is/.test(intro)) findings.push("the panel does not say what stays");

  await page.fill("#f-discardReason", "Forked the wrong package; the booked terms stand.");
  await page.waitForTimeout(300);
  await page.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Review the plan/.test(x.textContent || "")); if (b) b.click(); });
  /* THE GATE, NOT THE INVENTORY, is what the wait is on. A missing inventory is a FINDING about
     the gate, and a drive that hung on its selector would report a timeout instead of the defect
     and would never exercise the confirm, the trail row or the book afterwards. */
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some((b) => /^Confirm and file$/.test((b.textContent || "").trim())), null, { timeout: 25000 });
  await page.waitForTimeout(500);
  const inventory = await text(page, '[data-inventory="discard"]');
  const gate = await text(page, '[role="dialog"][aria-label="Discard this version"]');
  note("[chip] Review the plan", (inventory || gate || "").slice(0, 600));
  if (!inventory) findings.push("the confirm gate renders no inventory block: the staged plan reached it carrying no items[] the gate could read");
  /* WHAT THE INVENTORY MUST NAME, off this book: the clone the filing RENAMED to the raised
     figure, one sibling clone that came across untouched, and the version package itself. */
  for (const want of BOOK.inventoryWants) {
    if (!inventory || inventory.indexOf(want) === -1) findings.push(`the inventory does not name "${want}"`);
  }
  if (inventory && !/Staging rows, marked Withdrawn/.test(inventory)) findings.push("the inventory does not show the staging rows as kept and marked Withdrawn");
  if (inventory && !/only the version's own copies of them go/.test(inventory)) findings.push("the gate does not say what stays beside what goes");

  await page.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /^Confirm and file$/.test((x.textContent || "").trim())); if (b) b.click(); });
  await page.waitForTimeout(3500);
  const tracker = await text(page, '[role="dialog"][aria-label="Discard this version"]');
  note("[chip] Confirm and file", (tracker || "").slice(0, 300));

  await page.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /^Close$/.test((x.textContent || "").trim()) || x.getAttribute("aria-label") === "Close"); if (b) b.click(); });
  await page.waitForTimeout(1200);
  await openTrail(page);
  const trail = await text(page, "#pane-activity");
  note("[read] the trail after the undo", (trail || "").slice(0, 400));
  if (!trail || trail.indexOf("Version discarded") === -1) findings.push("the trail carries no Version discarded row after the undo");
  const stillStanding = await page.$('[data-inflight-row="1"]');
  if (stillStanding) findings.push("the trail still shows Modification in Progress after the version was discarded");

  /* And the package pickers: the source must no longer read Modification in Progress. The ask is
     the one the Modify route scopes now (spec 2c.3), which is exactly the picker the lock lives
     in: a source still carrying a version would be blocked there by name. */
  await openFacilityRoom(page);
  await takeRoute(page, "Modify");
  await page.waitForTimeout(3000);
  const rows = (await packageRows(page)).map((r) => r.line);
  note("[read] the package ask after the undo", rows.join(" || ").slice(0, 400));
  /* THE VERSION WAS THE SECOND PACKAGE. On a ONE-package book the undo takes the roster back to
     one, and one package is not a choice: the room must bind it silently rather than keep an
     empty question up. On a book that stages more than one of its own, the question stays. */
  if (BOOK.multiPackage) {
    if (!rows.length) findings.push("the Modify route asks for no package on a relationship staging more than one");
  } else if (rows.length) {
    findings.push(`the Modify route still asks which package after the undo took the relationship back to one: ${JSON.stringify(rows)}`);
  }
  if (rows.some((r) => /Modification in Progress/.test(r))) findings.push("a package still reads Modification in Progress after the version was discarded");
  if (rows.some((r) => /Modification in flight/.test(r))) findings.push("the discarded version is still on the package ask");
  return { turns, findings, path: BOOK.multiPackage ? "version undone, the book's own packages still ask" : "version undone, the one remaining package binds silently" };
}

/* ------------------------------------------------- the no-version books

   A BOOK WITH NO BOOKED PACKAGE CANNOT CARRY A MODIFICATION VERSION, and that is not a gap in
   the drive: nCino takes a credit action only against a booked loan, so the fork has nothing to
   fork. `book/packages.ts` reads a version as an all-unbooked package that MIRRORS a booked one,
   and with no booked package there is nothing to mirror.

   So the three version drives assert the OTHER side of every sentence they exist for: nothing
   stands in flight, no undo door is offered over a version that does not exist, and the header's
   own switch offers no version to walk into. A skip would have hidden exactly the case where a
   room invents a version out of an unbooked package. */
async function driveNoVersion(page, which) {
  const findings = [];
  const turns = [];
  const note = (you, reply) => turns.push({ you, reply: String(reply ?? "").slice(0, 400), replied: !!reply, repeat: false, refusal: false, emDash: /—/.test(String(reply ?? "")), visibleChips: 0, openCard: 0, freshCount: reply ? 1 : 0, ms: 0 });

  await openTrail(page);
  const trail = await text(page, "#pane-activity");
  note("[open] Activity trail", (trail || "").slice(0, 400));
  if (!trail) findings.push("the Activity trail renders nothing at all on this relationship");
  const standing = await page.$('[data-inflight-row="1"]');
  if (standing) findings.push("the trail shows Modification in Progress on a relationship that can carry no version");
  const door = await page.$('[data-discard-door="trail"]');
  if (door) findings.push("the trail offers Discard this version with no version in flight");

  if (which === "amend" || which === "create") {
    await openFacilityRoom(page);
    const switched = await standInPackage(page, "Modification in flight").catch(() => null);
    note("[stand in] a version, if the header offers one", String(switched));
    if (switched && !/^\[blocked\]/.test(String(switched))) {
      findings.push(`the header's switch walked the room into a "Modification in flight" package on a relationship that can carry no version: ${switched}`);
    }
    const routes = await doorLabels(page);
    note("[read] the routes on the book's own package", routes.join(" || "));
    if (!routes.length) findings.push("the room offers no route at all");
    /* AND NO ROUTE MAY PROMISE A CREDIT ACTION HERE. Modify and Renew are still on the row (the
       route is what SCOPES the package question, and the refusal is the engine's), but the room
       must never claim a version. */
    const said = await roomSaid(page);
    if (/version chain|clone/i.test(said)) findings.push(`the room talks about a version on a relationship that has none: "${said.slice(0, 200)}"`);
  }
  return {
    turns,
    findings,
    path: "no booked package on this book, so no modification version can exist; asserted the no-version path",
  };
}

/** Every package on the relationship carrying a booked member, off the connector the page talks
 *  to. A new facility may never be offered one of these (spec 2c.3): money is out on them. */
async function bookedPackageIds(page) {
  return page.evaluate(async (account) => {
    const mcp = await window.claude.use("mcp");
    const r = await mcp.callTool("Customer 360", "Customer360Exposure", { inputs: [{ accountId: account }] });
    const facilities = (((((r || {}).payload || {}).content || [])[0] || {}).outputValues || {}).facilities || [];
    const booked = new Set();
    for (const f of facilities) if (f.productPackageId && /^(Booked|Complete)$/i.test(String(f.stage || ""))) booked.add(f.productPackageId);
    return [...booked];
  }, ACCOUNT);
}

/** The create room's offer, in the order the room renders it. */
async function offerRows(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".wk-pkgs:not(.wk-pkgask) .wk-pkg")].map((r) => ({
      id: r.getAttribute("data-pkg"),
      label: (r.querySelector("b") || {}).textContent || "",
      line: (r.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
    })),
  );
}

async function driveCreateFromRelationship(page) {
  const findings = [];
  const turns = [];
  // THE COMMAND PALETTE opens the create room on the RELATIONSHIP: no package travels, which is
  // exactly the case 2c.1 is about. It routes through `workroomContextFor` like every other door.
  await page.keyboard.press("Control+k");
  await page.waitForSelector("#cmdkInput", { state: "visible", timeout: 8000 });
  await page.fill("#cmdkInput", "New Facility");
  await page.waitForTimeout(600);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".wk-root", { state: "attached", timeout: 10000 });
  await page.waitForTimeout(4000);
  const rows = await offerRows(page);
  turns.push({ you: "[open] New Facility Request from the relationship", reply: rows.map((r) => r.label).join(" || "), replied: rows.length > 0, repeat: false, refusal: false, emDash: false, visibleChips: rows.length, openCard: 0, freshCount: rows.length, ms: 0 });
  if (!rows.length) findings.push("the create room offered no package at all");
  else if (rows[0].label.trim() !== "New package") findings.push(`the create room's offer leads with "${rows[0].label.trim()}" rather than "New package"`);
  if (SOURCE_PACKAGE && rows.some((r) => r.id === SOURCE_PACKAGE)) findings.push("the create room offers the booked source of an in-flight version");
  if (VERSION_PACKAGE && rows.some((r) => r.id === VERSION_PACKAGE)) findings.push("the create room offers a version the banker is not standing in");
  const booked = await bookedPackageIds(page);
  const offeredBooked = rows.filter((r) => booked.includes(r.id));
  if (offeredBooked.length) findings.push(`New facility offers a booked package: ${JSON.stringify(offeredBooked.map((r) => r.id))}`);
  return {
    turns,
    findings,
    path: VERSION_PACKAGE
      ? "a version in flight, so the offer must lead with New package and hide both the version and its source"
      : "no version on this book, so the offer is New package and whatever is still before approval",
  };
}

async function driveCreateInsideVersion(page) {
  const findings = [];
  const turns = [];
  /* STANDING IN THE VERSION. Route first means the door asks no package (spec 2c.3), so the way
     into a version before the route is the header's own switch, which is route-neutral while the
     route question is open. */
  await openFacilityRoom(page);
  const picked = await standInPackage(page, "Modification in flight");
  turns.push({ you: "[stand in] the in-flight version", reply: String(picked), replied: !!picked, repeat: false, refusal: false, emDash: false, visibleChips: 0, openCard: 0, freshCount: 1, ms: 0 });
  if (!picked || /^\[blocked\]/.test(String(picked))) {
    findings.push("the facility room will not stand in an editable version");
    return { turns, findings };
  }
  await takeRoute(page, "New facility");
  await page.waitForTimeout(4000);
  /* AND NEW FACILITY NEVER ASKS FOR A BOOKED PACKAGE (spec 2c.3): its homes are the version, a
     cockpit-created package still before approval, and a new package. */
  const asked = await packageRows(page);
  if (asked.length) findings.push(`New facility put the booked-package question up: ${JSON.stringify(asked.map((r) => r.id))}`);
  const rows = await offerRows(page);
  turns.push({ you: "[route] New facility", reply: rows.map((r) => r.label).join(" || "), replied: rows.length > 0, repeat: false, refusal: false, emDash: false, visibleChips: rows.length, openCard: 0, freshCount: rows.length, ms: 0 });
  if (rows.length < 2) findings.push("the create room inside a version offered fewer than two packages");
  else {
    if (rows[0].id !== VERSION_PACKAGE) findings.push(`the offer leads with "${rows[0].label.trim()}" rather than the version the room is standing in`);
    if (rows[1].label.trim() !== "New package") findings.push(`"New package" does not follow the version; the second row is "${rows[1].label.trim()}"`);
  }
  if (rows.some((r) => r.id === SOURCE_PACKAGE)) findings.push("the create room offers the booked source of the version it is standing in");
  const booked = await bookedPackageIds(page);
  const offeredBooked = rows.filter((r) => booked.includes(r.id));
  if (offeredBooked.length) findings.push(`New facility offers a booked package: ${JSON.stringify(offeredBooked.map((r) => r.id))}`);
  return { turns, findings, path: "standing in the version, so the version leads and New package follows" };
}

/** Everything the room has said: its agent bubbles, its cards and its gate. */
async function roomSaid(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".wk-root .wk-msg.wk-agent .wk-bub, .wk-root .wk-card, .wk-root .wk-gate")]
      .map((n) => (n.textContent || "").replace(/\s+/g, " ").trim())
      .join(" || "),
  );
}

async function driveAmend(page) {
  const findings = [];
  const turns = [];
  const note = (you, reply) => turns.push({ you, reply: String(reply ?? "").slice(0, 500), replied: !!reply, repeat: false, refusal: false, emDash: /—/.test(String(reply ?? "")), visibleChips: 0, openCard: 0, freshCount: reply ? 1 : 0, ms: 0 });

  await openFacilityRoom(page);
  const picked = await standInPackage(page, "Modification in flight");
  note("[stand in] the in-flight version", picked);
  const routes = await doorLabels(page);
  note("[read] the routes inside a version", routes.join(" || "));
  // C1's own label for the amend route is "Shape this version"; the drive accepts the two
  // phrasings the spec used as well, so a rename does not read as a missing route.
  const AMEND_ROUTE = /^(Amend|Change the figures|Shape this version)/i;
  if (!routes.some((r) => AMEND_ROUTE.test(r))) {
    findings.push("the room standing in an editable version offers no amend route");
    return { turns, findings };
  }
  await takeRoute(page, routes.find((r) => AMEND_ROUTE.test(r)));
  await page.waitForFunction(() => { const t = document.querySelector(".wk-txt"); return t && !t.disabled; }, null, { timeout: 15000 });
  /* THE BANKER STILL CALLS IT BY YESTERDAY'S FIGURE. The filing renamed the clone, so the line
     names the facility the way the banker remembers it rather than the way the version writes it. */
  const AMEND_LINE = `take the ${BOOK.bareMoney} ${BOOK.product.toLowerCase()} to ${BOOK.amendRate.toFixed(2)}%`;
  await page.fill(".wk-txt", AMEND_LINE);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(6000);
  note(AMEND_LINE, await roomSaid(page));

  /* THE FIGURE THE VERSION RENAMED. Where the source carried two of this product, the filing
     leaves the version carrying two and neither at the figure the banker just said: the room asks
     which, and the banker answers with the chip for the one that was the target yesterday. Where
     the source carried ONE, there is nothing to ask and the reference binds silently. */
  const raisedMoney = fmtMoney(BOOK.raisedTo);
  const RAISED = new RegExp(
    `${raisedMoney.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${BOOK.raisedTo.toLocaleString("en-US")}`,
  );
  const memberChips = await page.evaluate(() => [...document.querySelectorAll(".wk-opts button, .wk-opt, .wk-chip")].filter((n) => n.offsetParent !== null).map((n) => (n.textContent || "").trim()));
  const moved = memberChips.find((c) => RAISED.test(c));
  if (moved) {
    await page.evaluate((label) => { const b = [...document.querySelectorAll(".wk-opts button, .wk-opt, .wk-chip")].filter((n) => n.offsetParent !== null).find((n) => (n.textContent || "").trim() === label); if (b) b.click(); }, moved);
    await page.waitForFunction(() => [...document.querySelectorAll("button.eg-btn-ink, .wk-opts button, .wk-opt, .wk-chip")].some((n) => n.offsetParent !== null && /^Confirm$/i.test((n.textContent || "").trim())), null, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1500);
    note(`[chip] ${moved}`, await roomSaid(page));
  } else if (BOOK.ambiguousMember) {
    findings.push(`the version carries ${BOOK.siblings.length} ${BOOK.product} and the room never asked which one the amendment lands on; chips on screen: ${JSON.stringify(memberChips)}`);
  }

  /* THE BANKER'S HAND to the end: the change is confirmed onto the manifest, the manifest is
     reviewed, the plan is staged and the single-use token is taken. */
  for (let k = 0; k < 4; k++) {
    const took = await page.evaluate(() => {
      const ns = [...document.querySelectorAll("button.eg-btn-ink, .wk-opts button, .wk-opt, .wk-chip")].filter((n) => n.offsetParent !== null);
      const hit = ns.find((n) => /^(Confirm|Acknowledge|Acknowledged|Yes, confirm|Confirm and file)/i.test((n.textContent || "").trim()));
      if (hit) { const t = hit.textContent.trim(); hit.click(); return t; }
      return null;
    });
    if (!took) break;
    await page.waitForTimeout(2200);
  }
  const propose = await page.$(".wk-propose");
  if (!propose) { findings.push("no Review & execute chip after the amendment was confirmed onto the manifest"); return { turns, findings }; }
  await propose.click();
  await page.waitForTimeout(12000);

  const card = await page.evaluate(() => {
    const tok = document.querySelector(".wk-tok");
    const approve = document.querySelector(".wk-approve");
    return { token: tok ? (tok.textContent || "").trim() : null, approve: approve ? { label: (approve.textContent || "").trim(), disabled: approve.disabled } : null };
  });
  note("[chip] Review & execute", `${card.token || "no token"} || ${card.approve ? card.approve.label : "no approval"}`);
  if (!card.token) findings.push("the staged amendment carries no decision token");
  if (!card.approve || card.approve.disabled) findings.push("the amendment's approval never opened");

  /* THE PLAN, AS THE ROOM SAID IT. One read over everything the room has spoken, so the three
     properties an amendment has to have are asserted once rather than once per beat. */
  const plan = await roomSaid(page);
  const asked = BOOK.amendRate.toFixed(2);
  const askedRe = new RegExp(`${asked.replace(".", "\\.")}|${String(BOOK.amendRate).replace(".", "\\.")}%`);
  if (/credit action|clone|version chain/i.test(plan)) findings.push("the amendment plan talks about a credit action, which an amend never runs");
  if (!askedRe.test(plan)) findings.push(`the amendment plan does not carry the figure the banker asked for (${asked})`);
  if (!/this version/i.test(plan)) findings.push("the amendment plan does not say it changes the version the org already holds");

  /* THE ARM ON THE WIRE, not the prose the room printed over it: the contract says an amend names
     the facility for every figure, so the rate has to arrive as a scalar entry on a member of the
     version package. */
  const movedClone = await versionFacility(page);
  // `versionState.requests` records the unwrapped `inputs[0]` the tool was handed, which is the
  // payload itself.
  const staged = await page.evaluate(() => (window.__LANES.versionState.requests || []).filter((r) => r.tool === "stage_amend_version").map((r) => r.input || {}));
  const armed = staged.map((one) => { try { return { versionPackageId: one.versionPackageId, scalars: JSON.parse(one.scalarChangesJson || "[]") }; } catch { return { versionPackageId: one.versionPackageId, scalars: [] }; } });
  note("[wire] stage_amend_version", JSON.stringify(armed));
  if (!armed.length) findings.push("the room staged no amendment on the version pair");
  /* THE ARM'S SHAPE IS THE ORG'S: one entry per (scalar, member), `{ key, value, targetLoanId }`
     with `key` one of the four request-key names (StageLoanModification.parseScalarChanges). */
  const rate = armed.flatMap((a) => a.scalars).find((c) => c && c.key === "requestedRate");
  if (!rate) findings.push("scalarChangesJson carries no requestedRate entry");
  else {
    if (Number(rate.value) !== BOOK.amendRate) findings.push(`scalarChangesJson carries requestedRate ${rate.value} rather than ${asked}`);
    if (!movedClone || rate.targetLoanId !== movedClone.loanId) findings.push(`the amendment lands on ${rate.targetLoanId} rather than the version's own copy of the facility (${movedClone ? movedClone.loanId : "not on the read"})`);
  }
  if (armed.some((a) => a.versionPackageId !== VERSION_PACKAGE)) findings.push("the amendment names a package other than the version");

  await page.evaluate(() => { const a = document.querySelector(".wk-approve"); if (a) a.click(); });
  await page.waitForFunction(() => (window.__LANES.versionState.requests || []).some((r) => r.tool === "execute_amend_version"), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const filed = await page.evaluate(() => [...document.querySelectorAll(".wk-root .wk-msg.wk-agent .wk-bub, .wk-root .wk-card, .wk-root .wk-gate")].map((n) => (n.textContent || "").replace(/\s+/g, " ").trim()).slice(-3).join(" || "));
  note("[chip] Approve and file", filed);

  /* AND THE FIGURE ON THE VERSION, read back off the connector the page itself talks to rather
     than off the room's own memory of what it filed. */
  const onVersion = await versionFacility(page);
  const onParent = await page.evaluate(async (ids) => {
    const mcp = await window.claude.use("mcp");
    const r = await mcp.callTool("Customer 360", "Customer360Exposure", { inputs: [{ accountId: ids.account }] });
    const facilities = (((((r || {}).payload || {}).content || [])[0] || {}).outputValues || {}).facilities || [];
    const parent = facilities.find((f) => f.loanId === ids.parent);
    return parent ? { name: parent.name, interestRate: parent.interestRate } : null;
  }, { account: ACCOUNT, parent: VERSION.moved.loanId });
  note("[read] the version's facility after the amendment", JSON.stringify({ version: onVersion, parent: onParent }));
  if (!onVersion) findings.push(`the version's ${BOOK.product} is gone from the facilities read after the amendment`);
  else if (Number(onVersion.interestRate) !== BOOK.amendRate) findings.push(`the version's ${BOOK.product} reads ${onVersion.interestRate} rather than ${asked} after the amendment`);
  if (onParent && Number(onParent.interestRate) === BOOK.amendRate) findings.push("the amendment moved the booked parent's rate, which an amend never touches");
  return {
    turns,
    findings,
    path: moved ? `${BOOK.siblings.length} ${BOOK.product} on the version, the room asked which` : `one ${BOOK.product} on the version, the reference bound silently`,
  };
}

/** The version's own copy of the facility the filing moved, off the connector the page talks to. */
async function versionFacility(page) {
  return page.evaluate(async (ids) => {
    const mcp = await window.claude.use("mcp");
    const r = await mcp.callTool("Customer 360", "Customer360Exposure", { inputs: [{ accountId: ids.account }] });
    const facilities = (((((r || {}).payload || {}).content || [])[0] || {}).outputValues || {}).facilities || [];
    const loan = facilities.find((f) => f.productPackageId === ids.version && f.committed === ids.committed);
    return loan ? { loanId: loan.loanId, name: loan.name, interestRate: loan.interestRate } : null;
  }, { account: ACCOUNT, version: VERSION_PACKAGE, committed: VERSION ? VERSION.moved.committed : -1 });
}

/* ============================================================ the relay drop

   THE INCIDENT, DRIVEN. `__LANES.failNext` swallows a stage answer AFTER the stub has filed the
   staging row, which is what the relay did on 2026-09-13: STG-0000000149 existed in Salesforce
   while the page read "request failed (502)". What is asserted is the pair of properties the fix
   exists for: the plan still lands, and no key ever produces two staging rows. */

async function driveRelayDrop(page) {
  const findings = [];
  const turns = [];
  const note = (you, reply) => turns.push({ you, reply: String(reply ?? "").slice(0, 400), replied: !!reply, repeat: false, refusal: false, emDash: /—/.test(String(reply ?? "")), visibleChips: 0, openCard: 0, freshCount: reply ? 1 : 0, ms: 0 });

  await openFacilityRoom(page);
  const picked = await routeThenPackage(page, "Modify", PKG_WANT);
  note(`[route] Modify, then the package carrying the ${BOOK.shortMoney} ${BOOK.product}`, picked);
  await page.waitForFunction(() => { const t = document.querySelector(".wk-txt"); return t && !t.disabled; }, null, { timeout: 20000 });

  /* THE BANKER'S HAND, the same one `runScript` lends: a room that puts a confirm card up is
     waiting on the banker, and a drive that never presses it never reaches the manifest. */
  const takeChips = async () => {
    const CHIP = "button.eg-btn-ink, .wk-opts button, .wk-opt, .wk-chip";
    for (let k = 0; k < 4; k++) {
      const took = await page.evaluate((sel) => {
        const ns = [...document.querySelectorAll(sel)].filter((n) => n.offsetParent !== null);
        const hit = ns.find((n) => /^(Confirm|Acknowledge|Acknowledged|Yes, confirm|Confirm and file)/i.test((n.textContent || "").trim()));
        if (hit) { const t = hit.textContent.trim(); hit.click(); return t; }
        return null;
      }, CHIP);
      if (!took) break;
      await page.waitForTimeout(2200);
    }
  };

  const say = async (line) => {
    await page.waitForFunction(() => { const t = document.querySelector(".wk-txt"); return t && !t.disabled; }, null, { timeout: 20000 });
    await page.fill(".wk-txt", line);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(4000);
    await takeChips();
    const said = await page.$$eval(".wk-msg.wk-agent .wk-bub", (ns) => ns.map((n) => (n.textContent || "").trim()).slice(-1)[0] || "");
    note(line, said);
    return said;
  };

  /* THE FOUNDER'S OWN OPENING, and then what the room asks for before the approval opens: the
     amortisation term and the first payment date nCino requires with a commitment change. */
  await say(`Increase the ${BOOK.product} to ${BOOK.raisedToPhrase}`);
  if (PICK) await say(PICK);
  await say("240 months");
  await say("1 October 2026");
  await say("no change");

  /* A RELATIONSHIP WITH NOTHING BOOKED NEVER REACHES A MANIFEST, so there is no plan for the
     relay to drop and the assertion is the other one: the room said why, and the org was never
     asked to file anything. A drive that hunted for the Review chip here would report the honest
     refusal as a missing chip. */
  if (!BOOK.hasBooked) {
    const said = await roomSaid(page);
    const rows = await page.evaluate(() => window.__LANES.staging.rows.length);
    note("[read] the room on a relationship with nothing booked", said.slice(0, 400));
    if (!/booked/i.test(said)) findings.push("the room never says a credit action needs a booked facility on a relationship that has none");
    if (rows) findings.push(`${rows} staging rows were filed against a relationship carrying no booked facility`);
    if (await page.$(".wk-propose")) findings.push("a Review & execute chip opened over a relationship with no booked facility");
    return { turns, findings, path: "nothing booked on this book, so no plan is composed and no row is filed" };
  }

  /* ONE ANSWER DROPPED. The org files the row and the page never hears it, so the same key goes
     back out, comes back as a replay carrying no token, and the plan is re-issued under a fresh
     key: the only way Salesforce mints one. */
  await page.evaluate(() => { window.__LANES.failNext = { stage_loan_modification: 1 }; });
  const review = await page.$(".wk-propose");
  if (!review) {
    const visible = await page.evaluate(() => [...document.querySelectorAll(".wk-opts button, .wk-opt, .wk-chip, button.eg-btn-ink, button.eg-btn-quiet, .wk-propose")].filter((n) => n.offsetParent !== null).map((n) => (n.textContent || "").trim().slice(0, 60)));
    findings.push(`no Review & execute chip after the manifest was composed; on screen: ${JSON.stringify(visible)}`);
    return { turns, findings };
  }
  await review.click();
  await page.waitForTimeout(14000);

  const card = await page.evaluate(() => {
    const tok = document.querySelector(".wk-tok");
    const approve = document.querySelector(".wk-approve");
    return {
      token: tok ? (tok.textContent || "").trim() : null,
      approve: approve ? { label: (approve.textContent || "").trim(), disabled: approve.disabled } : null,
      said: [...document.querySelectorAll(".wk-msg.wk-agent .wk-bub")].map((n) => (n.textContent || "").trim()).slice(-1)[0] || "",
    };
  });
  const ledger = await page.evaluate(() => ({
    calls: window.__LANES.staging.calls.map((c) => c.key),
    rows: window.__LANES.staging.rows.map((r) => ({ id: r.stagingId, key: r.key, replays: r.replays })),
  }));
  note("[chip] Review & execute, with one answer dropped", `${card.token || card.said} || rows: ${ledger.rows.map((r) => r.id).join(", ")}`);

  if (!card.token || !/decision token/.test(card.token)) findings.push("the plan did not land after the relay dropped one answer: the flow card carries no decision token");
  if (card.approve && card.approve.disabled) findings.push("the approval is closed on a plan that landed on the second ask");
  const perKey = {};
  for (const r of ledger.rows) perKey[r.key] = (perKey[r.key] || 0) + 1;
  if (Object.values(perKey).some((n) => n > 1)) findings.push(`a key produced more than one staging row: ${JSON.stringify(perKey)}`);
  if (ledger.calls.length < 3) findings.push(`the lost answer was not asked again: ${ledger.calls.length} stage calls`);
  const distinctKeys = [...new Set(ledger.calls)];
  if (distinctKeys.length !== 2 || !/#r2$/.test(distinctKeys[1] || "")) {
    findings.push(`the plan was not re-issued under a derived key: ${JSON.stringify(distinctKeys)}`);
  }

  /* EVERY ANSWER DROPPED. The room must name the row the org is holding rather than tell the
     banker nothing was filed. */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".wk-acts button")].find((x) => /^Cancel$/.test((x.textContent || "").trim()));
    if (b) b.click();
    window.__LANES.failNext = { stage_loan_modification: 9 };
  });
  await page.waitForTimeout(1500);
  const again = await page.$(".wk-propose");
  if (!again) { findings.push("the Review & execute chip did not come back after the plan was discarded"); return { turns, findings }; }
  await again.click();
  await page.waitForTimeout(22000);

  /* THE ROOM'S LAST WORD, canned analyst prose excluded the way `runScript` excludes it: the
     dossier lines are not replies to anything and would hide the sentence being asserted. */
  const CANNED = /leverage stands inside policy|coverage cushion is intact/i;
  const said = await page.evaluate((canned) => {
    const re = new RegExp(canned, "i");
    const bubbles = [...document.querySelectorAll(".wk-msg.wk-agent .wk-bub, .wk-notice, .wk-armheld")]
      .map((n) => (n.textContent || "").trim())
      .filter((t) => t && !re.test(t));
    return bubbles.slice(-2).join(" || ");
  }, CANNED.source);
  note("[chip] Review & execute, with every answer dropped", said);
  if (!/STG-/.test(said)) findings.push(`the room does not name the staging row Salesforce is holding: "${said.slice(0, 200)}"`);
  if (/nothing (has been|was) filed/i.test(said)) findings.push("the room claims nothing was filed over a staging row that exists");
  if (/request failed \(502\)/.test(said) && !/Salesforce/.test(said)) findings.push("the room hands the banker the platform string as its whole answer");
  if (/—/.test(said)) findings.push("em dash in the recovery sentence");

  const after = await page.evaluate(() => window.__LANES.staging.rows.map((r) => ({ id: r.stagingId, key: r.key })));
  const keys = {};
  for (const r of after) keys[r.key] = (keys[r.key] || 0) + 1;
  if (Object.values(keys).some((n) => n > 1)) findings.push(`a key produced more than one staging row after the second half: ${JSON.stringify(keys)}`);
  return { turns, findings, path: "the plan is composed, one answer dropped and then every answer dropped" };
}

/* ============================================================ the doors

   THE RELATIONSHIP ROOM AND THE MEMO DOOR, on whichever book is open. Neither is a composer
   script: what is asserted is that the door OPENS, that the room it opens names THIS borrower,
   and that the package line under the title says the truth about this book, which is a different
   sentence on a one-package relationship than on Hartwell's two. */

/** The routes each room offers, as the rooms' own door ids. A door may be SHUT on a given book
 *  (A27.3) but it is never missing: that is the whole of what the sheet promises. */
const FACILITY_ROUTES = ["modify", "renew", "create", "memo"];
const REL_ROUTES = [
  "annual",
  "covenant",
  "valuation",
  "rating",
  "service",
  "intake",
  "versionCovenant",
  "versionPledge",
];

/** THE ENTRY SHEET, ASSERTED (0.9.25). It is the first thing in the thread, it names the
 *  relationship, it says one line of state, and its doors are the routes the room offers today. */
async function entrySheetFindings(page, where, expected) {
  const found = [];
  const sheet = await page.evaluate(() => {
    const thread = document.querySelector(".wk-root .wk-thread");
    if (!thread) return null;
    const entry = thread.querySelector(".wk-entry");
    if (!entry) return { present: false };
    /* FIRST ON THE GLASS: nothing the room said may stand above the sheet. */
    const blocks = [...thread.querySelectorAll(".wk-entry, .wk-msg, [data-recap]")];
    const title = entry.querySelector(".wk-sheet-t");
    const state = entry.querySelector(".wk-entry-state");
    return {
      present: true,
      first: blocks[0] === entry,
      title: ((title && title.textContent) || "").trim(),
      state: ((state && state.textContent) || "").replace(/\s+/g, " ").trim(),
      reads: !!entry.querySelector(".wk-entry-reads"),
    };
  });
  if (!sheet || !sheet.present) {
    found.push(`${where} does not open on the entry sheet`);
    return found;
  }
  if (!sheet.first) found.push(`${where} puts something above the entry sheet in the thread`);
  if (sheet.title !== BOOK.relationship) found.push(`the entry sheet in ${where} is titled "${sheet.title}", not ${BOOK.relationship}`);
  if (!sheet.state) found.push(`the entry sheet in ${where} says no line of state`);
  if (/\u2014/.test(sheet.state)) found.push(`em dash on the entry sheet's state line in ${where}`);
  if (!sheet.reads) found.push(`the entry sheet in ${where} carries no read chips under its doors`);
  const rows = await doorRows(page);
  const missing = expected.filter((r) => !rows.some((d) => d.route === r));
  if (missing.length) found.push(`${where} offers no door for ${missing.join(", ")}`);
  for (const d of rows) {
    if (!d.label) found.push(`a door in ${where} carries no label`);
    if (!d.line) found.push(`the ${d.route} door in ${where} says nothing about what it does`);
    if (/\u2014/.test(d.line)) found.push(`em dash on the ${d.route} door in ${where}`);
  }
  return found;
}

async function driveDoors(page) {
  const findings = [];
  const turns = [];
  const note = (you, reply) => turns.push({ you, reply: String(reply ?? "").slice(0, 400), replied: !!reply, repeat: false, refusal: false, emDash: /—/.test(String(reply ?? "")), visibleChips: 0, openCard: 0, freshCount: reply ? 1 : 0, ms: 0 });
  const strangers = Object.values(LIVE.borrowers || {})
    .map((b) => String((b.snapshot || {}).name || "").trim())
    .filter((n) => n && n !== BOOK.relationship);

  /* ---- THE RELATIONSHIP ROOM. */
  await page.click("#fab");
  await page.waitForSelector("#actRelationship", { state: "visible", timeout: 6000 });
  await page.waitForTimeout(400);
  await page.click("#actRelationship");
  const rel = await page.waitForSelector('[data-room="relationship"]', { timeout: 12000 }).catch(() => null);
  if (!rel) {
    findings.push("the relationship room did not open");
  } else {
    await page.waitForTimeout(3500);
    const title = await page.evaluate(() => (document.querySelector('[data-room="relationship"] .wk-title') || {}).textContent || "");
    const pkgLine = await page.evaluate(() => {
      const b = document.querySelector('[data-room="relationship"] .wk-pkgline');
      return b ? { anchor: b.getAttribute("data-pkgline"), text: (b.textContent || "").replace(/\s+/g, " ").trim() } : null;
    });
    const body = await page.evaluate(() => ((document.querySelector('[data-room="relationship"]') || {}).textContent || "").replace(/\s+/g, " ").trim());
    note("[open] Relationship Actions", `${title} || ${pkgLine ? pkgLine.text : "no package line"}`);
    if (!pkgLine) findings.push("the relationship room renders no package line");
    /* ONE PACKAGE IS NOT A CHOICE. The room must be standing in it rather than waiting on a
       question nobody is going to be asked. */
    else if (!BOOK.multiPackage && pkgLine.anchor === "pending") {
      findings.push(`the relationship room holds the package question open on a one-package relationship: "${pkgLine.text}"`);
    }
    for (const other of strangers) if (body.includes(other)) findings.push(`the relationship room named "${other}" while ${BOOK.relationship} was open`);
    if (!body.includes(BOOK.relationship)) findings.push(`the relationship room never names ${BOOK.relationship}`);
    findings.push(...(await entrySheetFindings(page, "the relationship room", REL_ROUTES)));
    await page.evaluate(() => { const b = document.querySelector('[aria-label="Close the relationship room"]'); if (b) b.click(); });
    await page.waitForTimeout(1200);
  }

  /* ---- THE FACILITY ROOM'S OWN SHEET, and the fold. Picking a door leaves ONE recap line where
          the sheet was, and under it the room's own flow: the package question where the route
          needs one, or the first step where it does not. */
  await openFacilityRoom(page);
  findings.push(...(await entrySheetFindings(page, "the facility room", FACILITY_ROUTES)));
  const shut = (await doorRows(page)).filter((d) => d.shut);
  note("[sheet] the facility room's doors", (await doorRows(page)).map((d) => `${d.route}${d.shut ? " [shut]" : ""}`).join(" || "));
  for (const d of shut) if (!d.line) findings.push(`the ${d.route} door is shut with no reason on it`);
  await takeRoute(page, "Modify");
  await page.waitForTimeout(3500);
  const folded = await page.evaluate(() => {
    const thread = document.querySelector(".wk-root .wk-thread");
    const recap = thread ? thread.querySelector('[data-recap="entry"]') : null;
    return {
      sheet: !!(thread && thread.querySelector(".wk-entry")),
      recap: recap ? (recap.textContent || "").replace(/\s+/g, " ").trim() : null,
      asked: !!document.querySelector(".wk-pkgask"),
      composer: !!document.querySelector(".wk-txt:not([disabled])"),
    };
  });
  note("[fold] Modify, chosen", JSON.stringify(folded));
  if (folded.sheet) findings.push("the entry sheet is still on the glass after a door was taken");
  if (folded.recap !== "Modify, chosen") findings.push(`the fold left no recap line: ${JSON.stringify(folded.recap)}`);
  /* ONE OR THE OTHER, NEVER NEITHER. A multi-package book asks which package the route runs in; a
     one-package book binds it silently and the composer wakes on the first step. */
  if (BOOK.multiPackage ? !folded.asked : !folded.composer) {
    findings.push(
      BOOK.multiPackage
        ? "the fold landed no package question on a relationship staging more than one"
        : "the fold woke no step on a one-package relationship",
    );
  }
  await page.evaluate(() => { const b = document.querySelector('[aria-label="Close the workroom"]'); if (b) b.click(); });
  await page.waitForTimeout(1500);

  /* ---- THE MEMO DOOR, off the facility room's route question. On a book staging more than one
          package the door ASKS which the memo is for; on a one-package book it opens straight
          onto the package the room is already standing in. */
  await openFacilityRoom(page);
  const door = await page.$('[data-door="memo"]');
  if (!door) {
    findings.push("the route question carries no Credit memo door");
    return { turns, findings, path: "the memo door was not on the route question" };
  }
  await door.click();
  await page.waitForTimeout(2500);
  const asked = await packageRows(page);
  if (BOOK.multiPackage) {
    if (!asked.length) findings.push("the memo door asked no package on a relationship staging more than one");
    else {
      await page.evaluate((id) => {
        const rows = [...document.querySelectorAll(".wk-pkgask .wk-pkg")];
        const hit = rows.find((r) => r.getAttribute("data-pkg") === id) || rows[0];
        if (hit && !hit.disabled) hit.click();
      }, PKG_WANT);
    }
  } else if (asked.length) {
    findings.push(`the memo door asked which package on a one-package relationship: ${JSON.stringify(asked.map((r) => r.line))}`);
  }
  const memo = await page.waitForSelector('[aria-label="Credit memo"]', { timeout: 25000 }).catch(() => null);
  if (!memo) {
    findings.push("the memo room did not open");
  } else {
    await page.waitForTimeout(4000);
    const said = await page.evaluate(() => ((document.querySelector('[aria-label="Credit memo"]') || {}).textContent || "").replace(/\s+/g, " ").trim());
    note("[door] Credit memo", said.slice(0, 400));
    for (const other of strangers) if (said.includes(other)) findings.push(`the memo room named "${other}" while ${BOOK.relationship} was open`);
    if (!said.includes(BOOK.relationship)) findings.push(`the memo room never names ${BOOK.relationship}`);
  }
  return {
    turns,
    findings,
    path: BOOK.multiPackage ? "both rooms asked which package" : "one package, both rooms bound it silently",
  };
}

/* ============================================= the two relationship reviews (row 49)

   Founder, 2026-09-13: "covenants and collaterals should be driven from the relationship
   perspective. A package is an association the row shows, which PPs and facilities it is tied to,
   never a filter or a narrowing control."

   So this drive opens the relationship room on the BUILT page and asserts, for the covenant review
   and the collateral valuation in turn: no package question and no package chip, the header on the
   relationship, EVERY covenant / every owned asset listed, each row carrying what it is tied to,
   the plan staged with `accountId` and no `productPackageId`, the org's own associations read back
   onto the card, and the filing taken to Confirm. Derived from the open book, so it runs on any
   `--book`.                                                                                    */

/** The covenants this book's own read carries, the ones the room can offer. */
function bookCovenantIds() {
  return (((BOOK.bundle.covenants || {}).covenants) || []).filter((c) => c.covenantId).map((c) => c.covenantId);
}

/** The distinct collateral this book's ACTIVE facilities pledge. */
function bookCollateralIds() {
  const out = [];
  for (const f of (BOOK.bundle.exposure || {}).facilities || []) {
    if (!/^(open|active)$/i.test(String(f.status || ""))) continue;
    for (const c of f.collateral || []) if (c.collateralId && !out.includes(c.collateralId)) out.push(c.collateralId);
  }
  return out;
}

/** Open Relationship Actions off the arc. */
async function openRelationshipRoom(page) {
  await page.click("#fab");
  await page.waitForSelector("#actRelationship", { state: "visible", timeout: 8000 });
  await page.waitForTimeout(400);
  await page.click("#actRelationship");
  await page.waitForSelector('[data-room="relationship"]', { timeout: 12000 });
  await page.waitForTimeout(3500);
}

/** Bind a review by name, off the entry sheet's doors.
 *
 *  THE TWO-STEP IS GONE (0.9.25). The room used to open on a governance signal offering ONE route
 *  plus "Something else", so binding anything else meant taking the way out first. The sheet shows
 *  every route every time, with the signal on its state line, so one gesture binds. */
async function takeReview(page, label) {
  await takeDoor(page, label, { exact: false });
  await page.waitForTimeout(3000);
}

/** The option rows of the live step, label and detail together, as the banker reads them. */
async function liveOptions(page) {
  return page.evaluate(() => {
    const steps = [...document.querySelectorAll(".wk-step")].filter((n) => n.offsetParent !== null && !/\bwk-gone\b/.test(n.className));
    const last = steps[steps.length - 1];
    if (!last) return [];
    return [...last.querySelectorAll(".wk-opts button")].map((b) => (b.textContent || "").replace(/\s+/g, " ").trim());
  });
}

/** Answer whatever the room is asking, once. Chips and pickers take their first live option; a
 *  typed step takes a figure, a date or a sentence off its own placeholder. Returns what it did,
 *  or null where the room asked nothing it could answer. */
async function answerLive(page) {
  const took = await page.evaluate(() => {
    const steps = [...document.querySelectorAll(".wk-step")].filter((n) => n.offsetParent !== null && !/\bwk-gone\b/.test(n.className));
    const last = steps[steps.length - 1];
    if (!last) return null;
    const chip = [...last.querySelectorAll(".wk-opts button")].find((b) => !b.disabled);
    if (chip) { const t = (chip.textContent || "").trim().slice(0, 60); chip.click(); return `[chip] ${t}`; }
    return null;
  });
  if (took) { await page.waitForTimeout(2200); return took; }
  const typed = await page.evaluate(() => {
    const t = document.querySelector(".wk-txt");
    if (!t || t.disabled) return null;
    const hint = (t.placeholder || "").toLowerCase();
    return /yyyy|date/.test(hint) ? "2026-09-13" : /dollar|figure|number/.test(hint) ? "12000000" : "Filed for the record.";
  });
  if (!typed) return null;
  await page.fill(".wk-txt", typed);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2200);
  return typed;
}

/** Walk the room to the "Review & file" chip, answering every step it asks. */
async function collectToPropose(page, limit = 14) {
  const said = [];
  for (let i = 0; i < limit; i++) {
    if (await page.$(".wk-propose")) return said;
    const one = await answerLive(page);
    if (!one) return said;
    said.push(one);
  }
  return said;
}

async function driveOneReview(page, opts) {
  const findings = [];
  const turns = [];
  const note = (you, reply) => turns.push({ you, reply: String(reply ?? "").slice(0, 600), replied: !!reply, repeat: false, refusal: false, emDash: /—/.test(String(reply ?? "")), visibleChips: 0, openCard: 0, freshCount: reply ? 1 : 0, ms: 0 });

  await openRelationshipRoom(page);
  await takeReview(page, opts.route);

  /* 1. NO PACKAGE QUESTION, NO PACKAGE CHIP. */
  const ask = await page.$(".wk-pkgask");
  const header = await page.evaluate(() => {
    const n = document.querySelector('[data-room="relationship"] .wk-pkgline');
    return n ? { anchor: n.getAttribute("data-pkgline"), tag: n.tagName, text: (n.textContent || "").replace(/\s+/g, " ").trim() } : null;
  });
  note(`[route] ${opts.route}`, `${header ? header.text : "no anchor line"} || package question: ${ask ? "ASKED" : "none"}`);
  if (ask) findings.push(`${opts.route} put the package question up: it is anchored on the account`);
  if (!header) findings.push(`${opts.route} renders no anchor line at all`);
  else {
    if (header.anchor !== "account") findings.push(`${opts.route} anchors the header on "${header.anchor}" rather than the relationship`);
    if (header.tag !== "SPAN") findings.push(`${opts.route} leaves the anchor line a control; an association is a statement`);
    if (!header.text.includes(BOOK.relationship)) findings.push(`${opts.route} does not name ${BOOK.relationship} in the header`);
  }

  /* 2. EVERY ROW, WITH ITS ASSOCIATIONS. */
  const rows = await liveOptions(page);
  note(`[read] every ${opts.noun.slice(0, -1)} on this relationship`, `${rows.length} rows || ${rows.join(" || ")}`);
  if (rows.length !== opts.expected) {
    findings.push(`${opts.route} lists ${rows.length} ${opts.noun}; this book carries ${opts.expected}`);
  }
  const TIED = /package|Relationship level, on no facility|pledged to no active facility/;
  const untied = rows.filter((r) => !TIED.test(r));
  if (untied.length) findings.push(`${untied.length} ${opts.noun} rows carry no association at all: ${JSON.stringify(untied.slice(0, 2))}`);
  if (!rows.some((r) => /; .*package/.test(r))) {
    findings.push(`no ${opts.noun} row names a facility and a package, so the association never reached the glass`);
  }

  /* 3. THE PLAN, AND WHAT IT TOUCHES. */
  const collected = await collectToPropose(page);
  note("[collect] the review's own questions", collected.join(" || "));
  const propose = await page.$(".wk-propose");
  if (!propose) {
    findings.push(`${opts.route} never reached the Review & file chip: ${JSON.stringify(collected.slice(-3))}`);
    return { turns, findings };
  }
  await propose.click();
  await page.waitForTimeout(6000);
  const card = await page.evaluate(() => {
    const n = document.querySelector(".wk-flowcard");
    return n ? (n.textContent || "").replace(/\s+/g, " ").trim() : null;
  });
  const touches = await page.evaluate(() => {
    const n = document.querySelector('[data-assoc="plan"]');
    return n ? (n.textContent || "").replace(/\s+/g, " ").trim() : null;
  });
  note("[chip] Review & file", `${(card || "no card").slice(0, 300)} || touches: ${touches || "none"}`);
  if (!card) findings.push(`${opts.route} staged no plan card`);
  if (!touches) findings.push(`${opts.route} plan carries no "What this touches" block, so the org's associations never reached the card`);
  else if (!/package/.test(touches)) findings.push(`the plan's associations name no package: "${touches.slice(0, 160)}"`);

  /* AND THE WIRE. The payload the page actually sent, off the lane's own ledger. */
  const sent = await page.evaluate((t) => (window.__LANES.staging.calls || []).filter((c) => c.tool === t).length, opts.tool);
  const payload = await page.evaluate((t) => {
    const rows = (window.__LANES.staging.rows || []).filter((r) => r.actionId === t);
    const last = rows[rows.length - 1];
    return last ? { accountId: last.accountId, productPackageId: last.productPackageId } : null;
  }, opts.actionId);
  note("[wire] what the page sent", JSON.stringify({ calls: sent, payload }));
  if (!payload) findings.push(`no ${opts.tool} row on the lane's ledger`);
  else {
    if (payload.accountId !== ACCOUNT) findings.push(`${opts.tool} was staged against ${payload.accountId} rather than the relationship`);
    if (payload.productPackageId) findings.push(`${opts.tool} carried a productPackageId the room never asked for: ${payload.productPackageId}`);
  }

  /* 4. CONFIRM, the way the banker does. */
  const filed = await page.evaluate((label) => {
    const b = [...document.querySelectorAll("button")].filter((n) => n.offsetParent !== null).find((n) => new RegExp(label, "i").test((n.textContent || "").trim()));
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }, opts.approve);
  if (!filed) {
    findings.push(`the approval "${opts.approve}" was not live on a staged plan`);
    return { turns, findings };
  }
  await page.waitForTimeout(7000);
  /* THE RESULT CARD AND THE LINE UNDER IT. The token line is where the room says what the filing
     landed against, and on an account-anchored review that has to be the RELATIONSHIP. */
  const settled = await page.evaluate(() => {
    const card = document.querySelector(".wk-rescard");
    const tok = document.querySelector(".wk-tokline");
    return {
      dossier: card ? (card.textContent || "").replace(/\s+/g, " ").trim() : null,
      token: tok ? (tok.textContent || "").replace(/\s+/g, " ").trim() : null,
    };
  });
  note(`[chip] ${opts.approve}`, `${(settled.dossier || "no dossier").slice(0, 300)} || ${settled.token || "no token line"}`);
  if (!settled.dossier) findings.push(`${opts.route} did not settle into a result dossier after the confirm`);
  if (!settled.token) findings.push(`${opts.route} filed without a token line`);
  else if (!settled.token.includes(BOOK.relationship)) {
    findings.push(`the filing is not reported against ${BOOK.relationship}: "${settled.token.slice(0, 160)}"`);
  }
  if (/—/.test(`${settled.dossier || ""} ${settled.token || ""}`)) findings.push("em dash in the filed card");
  return { turns, findings };
}

/** THE ROUTE THE BOOK CANNOT RUN (D1's rule, applied to the reviews): a book whose covenants carry no
 *  compliance row cannot record an assessment, and a book whose active pledges carry no collateral
 *  id has nothing to value. The room must say so at the door, once, in its own words; the drive
 *  asserts THAT path instead of pretending the review ran. */
async function driveRefusedReview(page, route, expectRe) {
  const findings = []; const turns = [];
  await openRelationshipRoom(page);
  /* THE DOOR SAYS IT BEFORE IT IS PRESSED (0.9.25). A route the book cannot run is a SHUT door on
     the entry sheet carrying the reason on its own face, and the sheet shows every route every
     time, so there is no "Something else" step to walk any more. */
  const rows = await doorRows(page);
  const chip = rows.find((r) => r.label.startsWith(route) || r.route === route) || null;
  let said = chip ? `${chip.label} || ${chip.line}` : "";
  if (chip && !chip.shut) {
    await takeReview(page, route); await page.waitForTimeout(3000);
    /* THE ROOM'S OWN WORDS, not the stub door's canned remark that lands after them. */
    const CANNED_HERE = /leverage stands inside policy|coverage cushion is intact/i;
    said = await page.evaluate((re) => { const all = [...document.querySelectorAll(".wk-msg.wk-agent .wk-bub")].map((n) => (n.textContent || "").replace(/\s+/g, " ").trim()); const own = all.filter((t) => !new RegExp(re, "i").test(t)); return own.slice(-1).join(" "); }, CANNED_HERE.source);
  }
  turns.push({ you: `[route] ${route} (nothing to run on this book)`, reply: said.slice(0, 400), replied: !!said, repeat: false, refusal: false, emDash: /\u2014/.test(said), visibleChips: 0, openCard: 0, freshCount: said ? 1 : 0, ms: 0 });
  if (!chip) findings.push(`${route} is not offered at all on this book`);
  else if (!expectRe.test(said)) findings.push(`${route} on a book with nothing to run did not say why: "${said.slice(0, 160)}"`);
  const askedTwice = await page.evaluate(() => { const b = [...document.querySelectorAll(".wk-msg.wk-agent .wk-bub")].map((n) => (n.textContent || "").trim()); return b.length >= 2 && b[b.length - 1] === b[b.length - 2]; });
  if (askedTwice) findings.push(`${route} said the same thing twice`);
  await page.evaluate(() => { const b = document.querySelector('[aria-label="Close the relationship room"]'); if (b) b.click(); });
  await page.waitForTimeout(1500);
  return { turns, findings };
}

async function driveRelationshipReviews(page) {
  const covenants = bookCovenantIds();
  const assets = bookCollateralIds();
  const assessable = (((BOOK.bundle.covenants || {}).covenants) || []).filter((c) => c.covenantId && (c.latestComplianceId || c.latestComplianceStatus)).length;
  const first = assessable === 0
    ? await driveRefusedReview(page, "Covenant review", /open test period|nothing to assess|nothing for a covenant review/i)
    : await driveOneReview(page, {
    route: "Covenant review",
    noun: "covenants",
    expected: covenants.length,
    tool: "stage_covenant_review",
    actionId: "covenant-review",
    approve: "^File the assessments$",
  });
  /* A SECOND ROOM, OPENED THE WAY THE BANKER OPENS IT. The first review has filed and its room is
     finished; the valuation is a fresh session rather than a switch inside a settled one. */
  if (assessable > 0) {
    await page.evaluate(() => { const b = document.querySelector('[aria-label="Close the relationship room"]'); if (b) b.click(); });
    await page.waitForTimeout(1500);
  }
  const second = assets.length === 0
    ? await driveRefusedReview(page, "Collateral valuation", /nothing to value|no asset|no collateral/i)
    : await driveOneReview(page, {
    route: "Collateral valuation",
    noun: "assets",
    expected: assets.length,
    tool: "stage_collateral_valuation",
    actionId: "collateral-valuation",
    approve: "^File the valuation$",
  });
  return {
    turns: [...first.turns, ...second.turns],
    findings: [...first.findings, ...second.findings],
    path: `${covenants.length} covenants (${assessable} with a compliance row), ${assets.length} owned assets on ${BOOK.relationship}${assessable === 0 ? "; covenant review refused at the door" : ""}${assets.length === 0 ? "; valuation refused at the door" : ""}`,
  };
}

/* ------------------------------------------------------------------- the harness */

/** Which drive this scenario runs on THIS book. A version scenario on a book that can carry no
 *  version runs the no-version assertions instead of its own, and says so in `path`. */
function driveFor(name, spec) {
  if (!spec.needsVersion || BOOK.canVersion) return spec.drive;
  /* `createFromRelationship` asks what the create room OFFERS, and that question stands with or
     without a version in flight: its version-specific rows are already conditional. */
  if (name === "createFromRelationship") return spec.drive;
  const which = name === "amendVersion" ? "amend" : name === "createInsideVersion" ? "create" : "discard";
  return (page) => driveNoVersion(page, which);
}

const out = {};
for (const [name, spec] of Object.entries(SCENARIOS)) {
  if (ONLY && ONLY !== name) continue;
  if (spec.drive) {
    const { page, errs } = await openPage(spec.version ? VERSION : null);
    let result;
    try {
      result = await driveFor(name, spec)(page);
    } catch (e) {
      result = { turns: [], findings: [`the drive threw: ${String(e).slice(0, 200)}`] };
    }
    await page.close();
    out[name] = { name, book: BOOK.relationship, ...result, pageErrors: errs, pending: spec.pending ?? null };
  } else {
    let ran;
    try {
      ran = await runScript(name, spec.lines, spec.version ? VERSION : null, spec.check);
    } catch (e) {
      ran = { name, book: BOOK.relationship, turns: [], approveDoors: [], pageErrors: [], findings: [`the script threw: ${String(e).slice(0, 200)}`] };
    }
    /* A SCENARIO MAY CARRY ITS OWN NOTE ABOUT WHAT THIS BOOK COULD NOT BE ASKED. It is appended
       to the path the run derived rather than replacing it. */
    out[name] = { ...ran, path: [ran.path, spec.path].filter(Boolean).join("; "), pending: spec.pending ?? null };
  }
}
/* A PENDING SCENARIO IS REPORTED, NOT COUNTED. Its findings are a statement about work that has
   not landed yet, so they are moved out of `findings` and named for the agent who owns them. */
for (const [name, r] of Object.entries(out)) {
  if (!r.pending) continue;
  r.pendingFindings = r.findings;
  r.findings = [];
}
fs.writeFileSync(OUT, JSON.stringify({ book: { id: ACCOUNT, name: BOOK.relationship }, scenarios: out }, null, 1));
console.log(`written ${OUT} (${BOOK.relationship})`);
await browser.close();
process.exit(0);
