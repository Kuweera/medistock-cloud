/* Developer 3, Stage B: date fields in encounter.html (and treatment.html, pharmacy.html) on a 390px phone and a 1280px desktop.
   Causes fixed: (1) the help text sat INSIDE the .dateField flex row (typing box 22px wide at 390px); (2) the shared PCF.initDates() caps every calendar at today, so a plan's expected end, review date, first dose and
   planned dose dates could not be picked. Real pages, headless Chromium, in-memory stand-in (NOT real Firebase). The native calendar popup cannot be driven in headless Chromium: the check records what the
   button hands to showPicker() (min, max) and uses the browser's own validity (rangeOverflow / rangeUnderflow, which is what disables days in the popup).
   Run: python3 -m http.server 8765 (repo root), then node tests/stageB-dates-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict"), fs = require("node:fs");
const OUT = process.argv[2] || ".", URL = "http://localhost:8765/tests/encounter-harness.html";
const pad = n => String(n).padStart(2, "0"), iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()), typed = s => s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4);
const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const TODAY = plus(0), TOMORROW = plus(1), YESTERDAY = plus(-1), NEXTMONTH = plus(30), NEXTYEAR = plus(400);

/* ---- 1. source scan: in EVERY page I own, a .dateField holds only the typing box, the calendar button and the native input (no help text, no label, no div) ---- */
for (const file of ["encounter.html", "treatment.html", "pharmacy.html"]) {
  const src = fs.readFileSync(__dirname + "/../" + file, "utf8"); let n = 0, m; const re = /<div class=\\?"dateField\\?"[^>]*>((?:(?!<\/div>)[\s\S])*)<\/div>/g;
  while ((m = re.exec(src))) { n++; assert.doesNotMatch(m[1], /<div|hint2|<label|<span|<p\b/, file + ": foreign content inside a .dateField: " + m[0].slice(0, 120)); assert.match(m[1], /type=\\?"text\\?"/); assert.match(m[1], /cal-btn/); assert.match(m[1], /type=\\?"date\\?"/); }
  console.log("source scan " + file + ": " + n + " date field(s), none holds help text");
}
const tsrc = fs.readFileSync(__dirname + "/../treatment.html", "utf8"); assert.equal((tsrc.match(/data-future/g) || []).length, 0, "treatment.html has only a past date (when it happened): unchanged");

(async () => {
  const browser = await chromium.launch(), errors = [];
  async function open(w, h) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept());
    await page.goto(URL); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); await page.waitForTimeout(500);
    const fr = await (await page.locator("#f").elementHandle()).contentFrame();
    await fr.evaluate(() => { HTMLInputElement.prototype.showPicker = function () { const t = this.closest(".dateField").querySelector('input[type="text"]'); window.__picker = { id: t.id || t.className, max: this.max, min: this.min, value: this.value }; }; });   // what the calendar button asks the browser to show
    return { page, f, fr };
  }
  const geom = (fr, sel) => fr.evaluate(sel => { const t = document.querySelector(sel), w = t.closest(".dateField"), b = w.querySelector(".cal-btn"), tr = t.getBoundingClientRect(), br = b.getBoundingClientRect(), wr = w.getBoundingClientRect(), h = w.nextElementSibling && w.nextElementSibling.classList.contains("hint2") ? w.nextElementSibling.getBoundingClientRect() : null;
    const old = t.value; t.value = "27/11/2026"; const clipped = t.scrollWidth > t.clientWidth; t.value = old;   // a full date must fit in the box
    return { clipped, boxW: Math.round(tr.width), btnRight: Math.round(br.right), sameRow: Math.abs((tr.top + tr.height / 2) - (br.top + br.height / 2)) < 6, wrapW: Math.round(wr.width), vw: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth, hintBelow: h ? h.top >= wr.bottom - 1 : null, kids: [...w.children].map(c => c.tagName + (c.type ? ":" + c.type : "")).join(",") }; }, sel);
  const native = (fr, id) => fr.evaluate(id => { const n = document.getElementById(id).closest(".dateField").querySelector('input[type="date"]'); return { max: n.max, min: n.min }; }, id);
  /* a calendar tap, then "choose" a day: the browser decides whether the day is selectable; then the page copies it into the typing box */
  async function pick(fr, id, day) {
    await fr.evaluate(id => { window.__picker = null; document.getElementById(id).closest(".dateField").querySelector(".cal-btn").click(); }, id);
    return fr.evaluate(([id, day]) => { const t = document.getElementById(id), n = t.closest(".dateField").querySelector('input[type="date"]'), asked = window.__picker; n.value = day; const sel = !n.validity.rangeOverflow && !n.validity.rangeUnderflow; if (sel) n.dispatchEvent(new Event("change", { bubbles: true })); return { asked, selectable: sel, text: t.value }; }, [id, day]);
  }

  /* ================= PHONE 390px ================= */
  { const { page, f, fr } = await open(390, 844);
    await f.locator('[data-t="treat"]').click(); await page.waitForTimeout(300);
    // layout: the typing box is wide, the button is on the same row inside the screen, the help text is BELOW the row, the page does not scroll sideways
    for (const id of ["#pEnd", "#pReview"]) { const g = await geom(fr, id); assert.ok(g.boxW >= 200 && !g.clipped, id + " typing box is " + g.boxW + "px wide (was 22)"); assert.equal(g.sameRow, true); assert.ok(g.btnRight <= g.vw, id + " button inside the screen"); assert.equal(g.hintBelow, true, id + " help text below the row"); assert.equal(g.kids, "INPUT:text,BUTTON:button,INPUT:date"); assert.ok(g.scrollW <= g.vw + 1, "no sideways scroll"); }
    // calendar limits: future days selectable, days before today not
    for (const id of ["pEnd", "pReview"]) {
      const nv = await native(fr, id); assert.equal(nv.max, "", id + " no cap at today (was " + TODAY + ")"); assert.equal(nv.min, TODAY, id + " minimum is today");
      for (const [day, ok] of [[TOMORROW, true], [NEXTMONTH, true], [NEXTYEAR, true], [TODAY, true], [YESTERDAY, false]]) { const r = await pick(fr, id, day); assert.equal(r.selectable, ok, id + " " + day + " selectable=" + ok); if (ok) assert.equal(r.text, typed(day), "the chosen day is shown as DD/MM/YYYY"); }
      assert.equal((await pick(fr, id, TOMORROW)).asked.max, "", "the button hands the browser no cap"); assert.equal((await pick(fr, id, TOMORROW)).asked.min, TODAY);
    }
    await f.locator("#pEnd").scrollIntoViewIfNeeded(); await fr.evaluate(() => document.getElementById("pEnd").closest(".dateField").previousElementSibling.scrollIntoView({ block: "start" })); await page.screenshot({ path: OUT + "/stageB-plan-dates-mobile.png" });
    // typing on a phone: digits only, formatted as they go; a future date is accepted and stored
    await f.locator("#pTitle").fill("Date test plan"); await f.locator("#pEnd").fill(""); await f.locator("#pEnd").pressSequentially(typed(NEXTMONTH).replace(/\//g, "")); await f.locator("#pEnd").blur();
    assert.equal(await f.locator("#pEnd").inputValue(), typed(NEXTMONTH), "typed digits become DD/MM/YYYY"); await pick(fr, "pReview", NEXTYEAR);
    const plans = () => page.evaluate(() => window.__db.all("pc_treatment_plans")), n0 = (await plans()).length;
    // refused: a typed date in the past, and text that is not a date. Nothing is saved
    await f.locator("#pEnd").fill("01/01/2020"); await f.locator("#pSaveBtn").click(); await page.waitForTimeout(250); assert.match(await f.locator("#pMsg").innerText(), /expected end date cannot be in the past/); assert.equal((await plans()).length, n0);
    await f.locator("#pEnd").fill(typed(NEXTMONTH)); await f.locator("#pReview").fill("2/2/2020"); await f.locator("#pSaveBtn").click(); await page.waitForTimeout(250); assert.match(await f.locator("#pMsg").innerText(), /review date cannot be in the past/); assert.equal((await plans()).length, n0);
    await f.locator("#pReview").fill("99/99/9999"); await f.locator("#pSaveBtn").click(); await page.waitForTimeout(250); assert.match(await f.locator("#pMsg").innerText(), /Type the dates as DD\/MM\/YYYY/); assert.equal((await plans()).length, n0);
    await f.locator("#pReview").fill(typed(NEXTYEAR)); await f.locator("#pSaveBtn").click(); await page.waitForTimeout(500);
    const pl = await plans(); assert.equal(pl.length, n0 + 1, "plan saved"); const p = pl[pl.length - 1]; assert.equal(p.expectedEnd, NEXTMONTH, "expected end stored as yyyy-mm-dd"); assert.equal(p.reviewDate, NEXTYEAR, "review date stored as yyyy-mm-dd");
    // blank dates are still optional
    await f.locator("#pTitle").fill("No dates plan"); await f.locator("#pSaveBtn").click(); await page.waitForTimeout(500); const p2 = (await plans()).pop(); assert.equal(p2.expectedEnd, null); assert.equal(p2.reviewDate, null);

    // first dose and planned dose dates: future days selectable (no lower limit added), layout fine
    await f.locator("[data-addmed]").first().click(); await f.locator("#obCard:not(.hidden)").waitFor();
    let g = await geom(fr, "#obStartDate"); assert.ok(!g.clipped && g.sameRow && g.btnRight <= g.vw, "first dose row fits, full date not clipped: " + JSON.stringify(g)); assert.equal((await native(fr, "obStartDate")).max, "");
    for (const day of [TOMORROW, NEXTMONTH]) assert.equal((await pick(fr, "obStartDate", day)).selectable, true, "first dose " + day);
    await f.locator("#obType").selectOption("custom"); await page.waitForTimeout(300);
    const itm = await fr.evaluate(() => { const n = document.querySelector(".itm-date").closest(".dateField").querySelector('input[type="date"]'); n.value = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10); return { max: n.max, over: n.validity.rangeOverflow }; }); assert.equal(itm.max, ""); assert.equal(itm.over, false, "a planned dose date in the future can be picked");
    await f.locator("#obAddItem").click(); await page.waitForTimeout(200); assert.equal(await fr.evaluate(() => [...document.querySelectorAll(".itm-date")].every(t => t.closest(".dateField").querySelector('input[type="date"]').max === "")), true, "a dose date row added later is also uncapped");
    g = await geom(fr, ".itm-date"); assert.ok(!g.clipped && g.btnRight <= g.vw, "planned dose date row fits, full date not clipped: " + JSON.stringify(g)); await fr.evaluate(() => document.querySelector(".itm-date").scrollIntoView({ block: "center" })); await page.screenshot({ path: OUT + "/stageB-dose-dates-mobile.png" });
    // a first dose tomorrow, typed, is saved as tomorrow
    await f.locator("#obType").selectOption("once"); await f.locator("#obMed").fill("TESTmed"); await f.locator("#obDose").fill("1"); await f.locator("#obUnit").fill("tablet"); await f.locator("#obRoute").fill("by mouth"); await f.locator("#obStartDate").fill(typed(TOMORROW)); await f.locator("#obStartTime").fill("09:00");
    const o0 = (await page.evaluate(() => window.__db.all("pc_treatment_orders"))).length; await f.locator("#obSaveBtn").click(); await page.waitForTimeout(600);
    const os = await page.evaluate(() => window.__db.all("pc_treatment_orders")); assert.equal(os.length, o0 + 1, "order with a first dose tomorrow saved (message: " + (await f.locator("#obMsg").innerText()) + ")"); assert.ok(os[os.length - 1].startAt > Date.now() + 8 * 36e5, "first dose is in the future");

    // dates that must stay PAST-only are untouched: the follow-up review date keeps its own rule, past dates keep the cap (checked where they are on screen)
    await f.locator('[data-t="consult"]').click(); await fr.evaluate(() => document.querySelectorAll("details").forEach(d => d.open = true)); await page.waitForTimeout(200);
    if (await f.locator("#mLast").count()) { const nv = await native(fr, "mLast"); assert.equal(nv.max, TODAY, "last dose taken stays capped at today"); const gl = await geom(fr, "#mLast"); if (gl.boxW) assert.ok(!gl.clipped && gl.btnRight <= gl.vw, "last dose row fits, full date not clipped: " + JSON.stringify(gl)); }
    await f.locator('[data-t="notes"]').click(); await fr.evaluate(() => document.querySelectorAll("details").forEach(d => d.open = true)); await page.waitForTimeout(200);
    if (await f.locator("#nFuDate").count()) { const nv = await native(fr, "nFuDate"); assert.equal(nv.max, "", "review date in a note: as before"); assert.equal(nv.min, TODAY); }
    await page.close();
  }
  /* ================= DESKTOP 1280px ================= */
  { const { page, f, fr } = await open(1280, 800); await f.locator('[data-t="treat"]').click(); await page.waitForTimeout(300);
    for (const id of ["#pEnd", "#pReview"]) { const g = await geom(fr, id); assert.ok(g.boxW >= 200 && g.sameRow && g.hintBelow && g.btnRight <= g.vw, "desktop " + id + " " + JSON.stringify(g)); }
    assert.equal((await pick(fr, "pEnd", NEXTMONTH)).selectable, true); assert.equal((await pick(fr, "pEnd", YESTERDAY)).selectable, false); await fr.evaluate(() => document.getElementById("pEnd").closest(".dateField").previousElementSibling.scrollIntoView({ block: "start" })); await page.screenshot({ path: OUT + "/stageB-plan-dates-desktop.png" }); await page.close();
  }
  assert.equal(errors.length, 0, "no page errors: " + errors.join(" | "));
  await browser.close(); console.log("stage B dates: OK");
})().catch(e => { console.error(e); process.exit(1); });
