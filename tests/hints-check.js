/* Developer 3: proves the on-screen field explanations really appear in the real pages (Chromium, in-memory stand-in; NOT real Firebase), including fields built in JavaScript.
   Run:  python3 -m http.server 8765  (repo root), then  node tests/hints-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", ENC = "http://localhost:8765/tests/encounter-harness.html";
(async () => {
  const browser = await chromium.launch(), errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept());
  await page.goto(ENC); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); await page.waitForTimeout(500);
  const tab = t => f.locator('[data-t="' + t + '"]').click();
  const shows = async (id, re) => { const el = f.locator("#fhelp-" + id); await el.scrollIntoViewIfNeeded(); assert.equal(await el.isVisible(), true, id + " visible"); assert.match(await el.innerText(), re, id); };
  // triage
  await tab("triage");
  await shows("tCat", /Emergency: needs help immediately/); await shows("tCons", /Alert: awake/); await shows("tMuac", /Mid-upper arm/); await shows("tPain", /0 means no pain/);
  await page.screenshot({ path: OUT + "/hints-triage-mobile.png" });
  // earlier medicines (frequency, route, duration)
  await tab("consult");
  await shows("mFreq", /How often the patient took/); await shows("mRoute", /How the medicine entered the body/); await shows("mDur", /How long the patient took/);
  // diagnosis
  await tab("dx");
  await shows("dCert", /Provisional: a first working idea/); await shows("dRole", /Primary is the main problem/); await shows("dIcd", /international disease code/);
  // treatment order form: scheduled and as-needed fields are built in JavaScript
  await tab("treat"); await f.locator("[data-addmed]").first().click(); await f.locator("#obCard:not(.hidden)").waitFor();
  await f.locator("#obType").selectOption("interval");
  await shows("obEvery", /For example, 8 means three doses/); await shows("obCount", /How many doses in total/);
  await f.locator("#obType").selectOption("prn");
  await shows("obInd", /What the medicine is for/); await shows("obMinInt", /shortest time that must pass/); await shows("obMaxDay", /most doses the patient may have in one day/);
  await shows("obMaxDaily", /all doses added together/); await shows("obPrnDays", /stays valid/);
  await page.screenshot({ path: OUT + "/hints-order-asneeded-mobile.png" });
  // each hint is a single element (no duplicates after the form is re-rendered)
  await f.locator("#obType").selectOption("interval"); await f.locator("#obType").selectOption("prn");
  assert.equal(await f.locator("#fhelp-obMinInt").count(), 1, "no duplicated hints after re-render");
  // investigations catalogue (static markup, checked in the source file because the page needs the app shell to render): specimen, result type, units, reference range
  const html = require("fs").readFileSync(__dirname + "/../investigations.html", "utf8");
  for (const id of ["fSpec", "fType", "fUnits", "fRefText", "fRefSource"]) assert.ok(html.includes('id="fhelp-' + id + '"'), "investigations.html has an explanation for " + id);
  assert.match(html, /expected range for this test and method/);
  assert.deepEqual(errors, [], "no page errors: " + errors.join(" | "));
  await browser.close(); console.log("hints-check: all checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
