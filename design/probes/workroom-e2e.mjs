/* WORKROOM BROWSER DRIVE (orchestrator gate, 2026-09-13). Drives the modification room on the
   BUILT page with the probe stub lanes, handing the lane Hartwell's REAL exposure + covenants via
   __LANES.livePatch, types the founder's transcript + stress-script lines into the real composer,
   and asserts per turn: a NEW room reply arrives, it is not a repeat of the previous reply, a
   "One decision at a time" refusal only appears while an open card/chips are visible, no em dash.
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
const patch = { Customer360Covenants: H.covenants, Customer360Exposure: H.exposure };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wk-e2e-")); fs.mkdirSync(path.join(dir, "b"), { recursive: true });
execFileSync("node", [path.join(ROOT, "app/scripts/assemble-artifact.mjs"), path.join(ROOT, "artifact/live-data.json"), path.join(dir, "b/index.html"), BUNDLE], { stdio: "ignore" });
const server = await serveDir(dir);
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--no-sandbox"] });

/* "THE LINE OF CREDIT" NAMES NEITHER, on a package carrying two of them, so the
   room asks which and the banker answers (D1, 2026-09-13). The pick is ADDED to
   each script rather than replacing anything: every line the drive asserted on
   before is still typed, in the same order, after the member is settled. */
const PICK = "the $15M line of credit";
const SCENARIOS = {
  founderTranscript: ["Increase the line of credit by 20M USD", PICK, "240 months", "1 October 2026", "Hold 6.58%", "what borrowers are on this loan already ?", "yes increase to 7.25%", "show me the pledges on this loan"],
  stressRate: ["Increase the line of credit to 20M", PICK, "7.25%", "asdf", "keep it", "240 months", "1 October 2026", "no change"],
  relativeAndSign: ["add 50bps on the line of credit", PICK, "-5%", "actually 8%", "what is this covenant doing?"],
};

async function run(name, lines) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await page.addInitScript(STUB); await page.addInitScript(SAMPLE);
  await page.addInitScript((p) => { var i = setInterval(function () { if (window.__LANES) { clearInterval(i); window.__LANES.relayMs = 200; window.__LANES.livePatch = Object.assign({}, window.__LANES.livePatch || {}, p); } }, 0); }, patch);
  await page.goto(server.url + "b/", { waitUntil: "commit" });
  await page.waitForSelector(`[data-open="${ACCOUNT}"]`, { timeout: 30000 });
  await page.click(`[data-open="${ACCOUNT}"]`); await page.waitForSelector("#view-account .hero", { timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.click("#fab"); await page.waitForSelector("#actFacility", { state: "visible", timeout: 6000 }); await page.waitForTimeout(400);
  await page.click("#actFacility"); await page.waitForSelector(".wk-root", { state: "attached", timeout: 8000 });
  // a multi-package book asks "Which package does this run in?" first: pick the package carrying the $15M line
  await page.waitForTimeout(4000);
  const pkgAsk = await page.$(".wk-pkgask .wk-pkg");
  const picked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".wk-pkgask .wk-pkg")];
    if (!rows.length) return null;
    const hit = rows.find((r) => /Line of Credit|15,000,000|\$15M/i.test(r.textContent || "")) || rows[0];
    hit.click(); return (hit.textContent || "").trim().slice(0, 80);
  });
  if (picked) await page.waitForTimeout(2500);
  // the route chips come next; the composer exists only after a route is chosen
  const ROUTE = '.wk-opts button, .wk-opt, .wk-routes button';
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].some((b) => (b.textContent || "").trim() === "Modify"), ROUTE, { timeout: 25000 });
  await page.evaluate((sel) => { const b = [...document.querySelectorAll(sel)].find((x) => (x.textContent || "").trim() === "Modify"); if (b) b.click(); }, ROUTE);
  await page.waitForFunction(() => { const t = document.querySelector(".wk-txt"); return t && !t.disabled; }, null, { timeout: 15000 });
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
const out = {};
for (const [name, lines] of Object.entries(SCENARIOS)) { if (ONLY && ONLY !== name) continue; out[name] = await run(name, lines); }
fs.writeFileSync(process.argv[4] || "wk-e2e-out.json", JSON.stringify(out, null, 1)); console.log("written"); await browser.close(); process.exit(0);
