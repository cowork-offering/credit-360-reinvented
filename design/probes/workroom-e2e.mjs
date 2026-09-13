/* WORKROOM BROWSER DRIVE (orchestrator gate, 2026-09-13). Drives the modification room on the
   BUILT page with the probe stub lanes, handing the lane Hartwell's REAL exposure + covenants via
   __LANES.livePatch, types the founder's transcript + stress-script lines into the real composer,
   and asserts per turn: a NEW room reply arrives, it is not a repeat of the previous reply, a
   "One decision at a time" refusal only appears while an open card/chips are visible, no em dash.
   SCENARIOS ARE TYPED (0.9.23). A scenario is either a COMPOSER script, which is what every
   scenario before this release was and which is unchanged, or a DRIVE, a function handed the page
   after the relationship is open. The version-lifecycle scenarios are drives: they walk the trail,
   the panel and the create room rather than typing into a composer. A scenario may also declare
   `version`, which switches on the stub's in-flight modification version, and `pending: "<agent>"`,
   which reports it separately rather than counting its findings as a gate failure.
   Usage: node workroom-e2e.mjs <bundle.html> [scenario] */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "/opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented/design/probes/node_modules/playwright/index.mjs";
import { serveDir } from "/opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented/design/probes/lib/serve.mjs";
const ROOT = "/opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented";
const BUNDLE = process.argv[2] || path.join(ROOT, "app/dist/cockpit.html");
const ONLY = process.argv[3] || null;
const STUB = fs.readFileSync(path.join(ROOT, "design/probes/lib/stub-lanes.js"), "utf8");
const SAMPLE = fs.readFileSync(path.join(ROOT, "design/probes/lib/stub-sample.js"), "utf8");
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, "artifact/live-data.json"), "utf8"));
const ACCOUNT = "001bb00001I7FPNAA3";
const H = LIVE.borrowers[ACCOUNT];
/* THE DRIVE RUNS ON HARTWELL'S REAL BOOK. The snapshot and the relationship graph ride with the
   exposure and the covenants, so every label the room prints names Hartwell and every party the
   parser resolves is a real row off the graph rather than the stub's empty one. Without the graph
   the party asks were answered out of nothing; without the snapshot the room read Piedmont's name
   over Hartwell's facilities. */
const patch = { Customer360Snapshot: H.snapshot, Customer360RelationshipGraph: H.graph, Customer360Covenants: H.covenants, Customer360Exposure: H.exposure };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wk-e2e-")); fs.mkdirSync(path.join(dir, "b"), { recursive: true });
execFileSync("node", [path.join(ROOT, "app/scripts/assemble-artifact.mjs"), path.join(ROOT, "artifact/live-data.json"), path.join(dir, "b/index.html"), BUNDLE], { stdio: "ignore" });
const server = await serveDir(dir);
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--no-sandbox"] });

/* "THE LINE OF CREDIT" NAMES NEITHER, on a package carrying two of them, so the
   room asks which and the banker answers (D1, 2026-09-13). The pick is ADDED to
   each script rather than replacing anything: every line the drive asserted on
   before is still typed, in the same order, after the member is settled. */
const PICK = "the $15M line of credit";

/* THE IN-FLIGHT VERSION THE STUB CARRIES for every version-lifecycle scenario. The source is
   Hartwell's booked package and the moved facility is the $15M line, which the filing renames to
   $20,000,000.00 on the clone. The clone set is the source's members, one for one: that is what
   nCino's credit action produces and what `book/packages.ts` recognises as a fork. */
const SOURCE_PACKAGE = "a5Fbb000000IHFJEA4";
const VERSION_PACKAGE = "a5Fbb0000009TESTV1";
const VERSION = {
  source: SOURCE_PACKAGE,
  id: VERSION_PACKAGE,
  name: "Hartwell Precision Manufacturing LLC credit package",
  moved: { loanId: "a4Zbb0000027MaYEAU", committed: 20000000 },
};

const SCENARIOS = {
  founderTranscript: { lines: ["Increase the line of credit by 20M USD", PICK, "240 months", "1 October 2026", "Hold 6.58%", "what borrowers are on this loan already ?", "yes increase to 7.25%", "show me the pledges on this loan"] },
  stressRate: { lines: ["Increase the line of credit to 20M", PICK, "7.25%", "asdf", "keep it", "240 months", "1 October 2026", "no change"] },
  relativeAndSign: { lines: ["add 50bps on the line of credit", PICK, "-5%", "actually 8%", "what is this covenant doing?"] },
  /* 0.9.23, IMPROVEMENTS row 44. Parties and collateral, in the founder's own words: the plural
     collateral read, the borrowing-structure reads, a party named by her first name, "this loan"
     for a removal, and the line that already worked. */
  founderParties: { lines: ["show me all my collaterals", "show my full collaterals", "who are the guarantors on this package", "which entities are on the $15M line of credit", "remove Elena from this loan", "remove Elena Hartwell from this loan", "remove Elena Hartwell as guarantor from the 15M line of credit", "add James as guarantor on the 15M line"] },
  /* 0.9.23. The undo, end to end on the built page: the trail's standing row, the panel, the org's
     inventory on the confirm gate, and the book afterwards. */
  discardVersion: { version: true, drive: driveDiscard },
  /* 2c.1, both halves. "New package" leads the create room's offer from the relationship; from
     inside the version, the version leads and "New package" follows, and the booked SOURCE of the
     version is on neither list. */
  createFromRelationship: { version: true, drive: driveCreateFromRelationship },
  createInsideVersion: { version: true, drive: driveCreateInsideVersion },
  /* 2a.1, C1's amend engine, LANDED: the route, the arm on the wire and the figure on the
     version's own loan afterwards. No longer pending. */
  amendVersion: { version: true, drive: driveAmend },
  /* 0.9.23 P0. THE RELAY DROPS THE ANSWER (the founder's 502, 2026-09-13): the org takes the plan
     and the page never hears back. Both halves, on the built page: one dropped answer, which the
     room must survive without a duplicate staging row, and every answer dropped, where the room
     must name the row Salesforce is holding instead of saying nothing was filed. */
  relayDrop: { drive: driveRelayDrop },
};

/** A page on the built bundle, on the stub lanes, with Hartwell open. One door for every
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
 *  where the route asks for no package at all. */
async function routeThenPackage(page, route, want) {
  await takeRoute(page, route);
  await page.waitForTimeout(3000);
  return page.evaluate((re) => {
    const rows = [...document.querySelectorAll(".wk-pkgask .wk-pkg")];
    if (!rows.length) return null;
    const hit = rows.find((r) => new RegExp(re, "i").test(r.textContent || "")) || rows[0];
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

/** Take the route chip with this exact label. */
async function takeRoute(page, label) {
  const ROUTE = '.wk-opts button, .wk-opt, .wk-routes button';
  await page.waitForFunction(([sel, l]) => [...document.querySelectorAll(sel)].some((b) => (b.textContent || "").trim() === l), [ROUTE, label], { timeout: 25000 });
  await page.evaluate(([sel, l]) => { const b = [...document.querySelectorAll(sel)].find((x) => (x.textContent || "").trim() === l); if (b) b.click(); }, [ROUTE, label]);
}

async function runScript(name, lines, version) {
  const { page, errs } = await openPage(version);
  await openFacilityRoom(page);
  /* ROUTE FIRST, PACKAGE SECOND (spec 2c.3, founder 2026-09-13). The room opens on the route
     question; a multi-package book then asks which package the route runs in, and on Hartwell that
     is the one carrying the $15M line. The composer wakes only once both are settled. */
  const picked = await routeThenPackage(page, "Modify", "Line of Credit|15,000,000|\\$15M");
  await page.waitForFunction(() => { const t = document.querySelector(".wk-txt"); return t && !t.disabled; }, null, { timeout: 25000 });
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
  await page.close();
  return { name, picked, turns, approveDoors: approve, findings, pageErrors: errs };
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
  for (const want of ["Line of Credit - $20,000,000.00", "Line of Credit - $2,500,000.00", "Hartwell Precision Manufacturing LLC credit package"]) {
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
  if (!rows.length) findings.push("the Modify route asks for no package on a relationship staging more than one");
  if (rows.some((r) => /Modification in Progress/.test(r))) findings.push("a package still reads Modification in Progress after the version was discarded");
  if (rows.some((r) => /Modification in flight/.test(r))) findings.push("the discarded version is still on the package ask");
  return { turns, findings };
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
  if (rows.some((r) => r.id === SOURCE_PACKAGE)) findings.push("the create room offers the booked source of an in-flight version");
  if (rows.some((r) => r.id === VERSION_PACKAGE)) findings.push("the create room offers a version the banker is not standing in");
  const booked = await bookedPackageIds(page);
  const offeredBooked = rows.filter((r) => booked.includes(r.id));
  if (offeredBooked.length) findings.push(`New facility offers a booked package: ${JSON.stringify(offeredBooked.map((r) => r.id))}`);
  return { turns, findings };
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
  return { turns, findings };
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
  const routes = await page.evaluate(() => [...document.querySelectorAll('.wk-opts button, .wk-opt, .wk-routes button')].map((b) => (b.textContent || "").trim()));
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
  await page.fill(".wk-txt", "take the 15M line of credit to 7.10%");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(6000);
  note("take the 15M line of credit to 7.10%", await roomSaid(page));

  /* THE FIGURE THE VERSION RENAMED. The filing took the $15M line to $20M on the clone, so the
     package carries two lines of credit and neither is $15M any more: the room asks which, and the
     banker answers with the chip for the one that was the $15M line yesterday. */
  const memberChips = await page.evaluate(() => [...document.querySelectorAll(".wk-opts button, .wk-opt, .wk-chip")].filter((n) => n.offsetParent !== null).map((n) => (n.textContent || "").trim()));
  const twenty = memberChips.find((c) => /\$?20(?:[.,]0+)?M|20,000,000/.test(c));
  if (twenty) {
    await page.evaluate((label) => { const b = [...document.querySelectorAll(".wk-opts button, .wk-opt, .wk-chip")].filter((n) => n.offsetParent !== null).find((n) => (n.textContent || "").trim() === label); if (b) b.click(); }, twenty);
    await page.waitForFunction(() => [...document.querySelectorAll("button.eg-btn-ink, .wk-opts button, .wk-opt, .wk-chip")].some((n) => n.offsetParent !== null && /^Confirm$/i.test((n.textContent || "").trim())), null, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1500);
    note(`[chip] ${twenty}`, await roomSaid(page));
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
  if (/credit action|clone|version chain/i.test(plan)) findings.push("the amendment plan talks about a credit action, which an amend never runs");
  if (!/7\.10|7\.1%/.test(plan)) findings.push("the amendment plan does not carry the figure the banker asked for");
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
    if (Number(rate.value) !== 7.1) findings.push(`scalarChangesJson carries requestedRate ${rate.value} rather than 7.10`);
    if (!movedClone || rate.targetLoanId !== movedClone.loanId) findings.push(`the amendment lands on ${rate.targetLoanId} rather than the version's own copy of the line (${movedClone ? movedClone.loanId : "not on the read"})`);
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
  if (!onVersion) findings.push("the version's line of credit is gone from the facilities read after the amendment");
  else if (Number(onVersion.interestRate) !== 7.1) findings.push(`the version's line of credit reads ${onVersion.interestRate} rather than 7.10 after the amendment`);
  if (onParent && Number(onParent.interestRate) === 7.1) findings.push("the amendment moved the booked parent's rate, which an amend never touches");
  return { turns, findings };
}

/** The version's own copy of the facility the filing moved, off the connector the page talks to. */
async function versionFacility(page) {
  return page.evaluate(async (ids) => {
    const mcp = await window.claude.use("mcp");
    const r = await mcp.callTool("Customer 360", "Customer360Exposure", { inputs: [{ accountId: ids.account }] });
    const facilities = (((((r || {}).payload || {}).content || [])[0] || {}).outputValues || {}).facilities || [];
    const loan = facilities.find((f) => f.productPackageId === ids.version && f.committed === ids.committed);
    return loan ? { loanId: loan.loanId, name: loan.name, interestRate: loan.interestRate } : null;
  }, { account: ACCOUNT, version: VERSION_PACKAGE, committed: VERSION.moved.committed });
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
  const picked = await routeThenPackage(page, "Modify", "Line of Credit|15,000,000");
  note("[route] Modify, then the package carrying the $15M line", picked);
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
  await say("Increase the line of credit to 20M");
  await say(PICK);
  await say("240 months");
  await say("1 October 2026");
  await say("no change");

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
  return { turns, findings };
}

/* ------------------------------------------------------------------- the harness */

const out = {};
for (const [name, spec] of Object.entries(SCENARIOS)) {
  if (ONLY && ONLY !== name) continue;
  if (spec.drive) {
    const { page, errs } = await openPage(spec.version ? VERSION : null);
    let result;
    try {
      result = await spec.drive(page);
    } catch (e) {
      result = { turns: [], findings: [`the drive threw: ${String(e).slice(0, 200)}`] };
    }
    await page.close();
    out[name] = { name, ...result, pageErrors: errs, pending: spec.pending ?? null };
  } else {
    out[name] = { ...(await runScript(name, spec.lines, spec.version ? VERSION : null)), pending: spec.pending ?? null };
  }
}
/* A PENDING SCENARIO IS REPORTED, NOT COUNTED. Its findings are a statement about work that has
   not landed yet, so they are moved out of `findings` and named for the agent who owns them. */
for (const [name, r] of Object.entries(out)) {
  if (!r.pending) continue;
  r.pendingFindings = r.findings;
  r.findings = [];
}
fs.writeFileSync(process.argv[4] || "wk-e2e-out.json", JSON.stringify(out, null, 1)); console.log("written"); await browser.close(); process.exit(0);
