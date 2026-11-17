/* Developer 3: registration form in Chromium against the in-memory stand-in (NOT real Firebase): progressive sections, required fields, the live age line.
   Run: python3 -m http.server 8765, then node tests/registration-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", URL = "http://localhost:8765/tests/patients-harness.html";
(async () => {
  const browser = await chromium.launch(), errors = [];
  async function open(w, h) { const ctx = await browser.newContext({ viewport: { width: w || 390, height: h || 844 } }); const page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept());
    await page.goto(URL); const f = page.frameLocator("#f"); await f.locator("#showFormBtn:not(.hidden)").waitFor(); await f.locator("#showFormBtn").click(); await f.locator("#fName").waitFor(); return { page, f }; }
  const pats = page => page.evaluate(() => window.__db.all("pc_patients"));
  const { page, f } = await open();
  // the five main fields are visible; address and family contacts start collapsed
  for (const id of ["fName", "fSex", "fAgeMode", "fDob", "fPhone"]) assert.equal(await f.locator("#" + id).isVisible(), true, id + " visible");
  for (const id of ["fAddress", "fVillage", "fDistrict", "fNokName", "fNokPhone"]) assert.equal(await f.locator("#" + id).isVisible(), false, id + " collapsed");
  assert.match(await f.locator("#regMore > summary").innerText(), /Address and family contacts \(optional\)/);
  await page.screenshot({ path: OUT + "/registration-collapsed-mobile.png" });
  // empty and incomplete forms are refused
  await f.locator("#saveBtn").click(); assert.match(await f.locator("#formMsg").innerText(), /full name/i);
  await f.locator("#fName").fill("TEST Patient One"); await f.locator("#saveBtn").click(); assert.match(await f.locator("#formMsg").innerText(), /sex/i);
  await f.locator("#fSex").selectOption("female"); await f.locator("#saveBtn").click(); assert.match(await f.locator("#formMsg").innerText(), /date of birth/i);
  assert.equal((await pats(page)).length, 0, "nothing saved while incomplete");
  // live age line under the date of birth
  const yr = new Date().getFullYear() - 6; await f.locator("#fDob").fill("15/03/" + yr); await f.locator("#fDob").blur();
  assert.match(await f.locator("#fAgeShow").innerText(), /Age: 6 years|Age: 5 years/, "age shown from the date of birth");
  // name + sex + age are enough
  await f.locator("#saveBtn").click(); await page.waitForTimeout(600);
  let rows = await pats(page); assert.equal(rows.length, 1, "saved with only name, sex and age"); assert.equal(rows[0].fullName, "TEST Patient One");
  const links = await page.evaluate(() => window.__db.all("pc_patient_facility_links")); assert.equal(links.length, 1); assert.match(links[0].localRegNo || "", /\d+/, "a registration number is created automatically");
  // a second patient: values typed inside the collapsed section are saved
  const b = await open(); await b.f.locator("#fName").fill("TEST Patient Two"); await b.f.locator("#fSex").selectOption("male"); await b.f.locator("#fAgeMode").selectOption("unknown");
  await b.f.locator("#regMore > summary").click(); assert.equal(await b.f.locator("#fAddress").isVisible(), true);
  await b.f.locator("#fPhone").fill("0772123456"); await b.f.locator("#fAddress").fill("TEST road"); await b.f.locator("#fNokName").fill("TEST Mother"); await b.f.locator("#fNokPhone").fill("0701234567");
  await b.page.screenshot({ path: OUT + "/registration-expanded-mobile.png" });
  await b.f.locator("#saveBtn").click(); await b.page.waitForTimeout(600);
  rows = await pats(b.page); assert.equal(rows.length, 1); const p = rows[0];
  assert.equal(p.fullName, "TEST Patient Two"); assert.equal(p.address, "TEST road"); assert.equal(p.nextOfKin.name, "TEST Mother");
  // desktop and a small phone
  const d = await open(1280, 900); await d.page.screenshot({ path: OUT + "/registration-desktop.png" });
  const s = await open(320, 640); await s.f.locator("#regMore > summary").click();
  assert.equal(await s.f.locator("body").evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "no sideways scrolling at 320px");
  assert.deepEqual(errors, [], "no page errors: " + errors.join(" | "));
  await browser.close(); console.log("registration-check: all checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
