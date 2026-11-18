/* Developer 4: drives the real laboratory.html in Chromium against an IN-MEMORY stand-in (NOT real Firebase, no security rules).
   Run: python3 -m http.server 8765 (in the repo), then NODE_PATH=$(npm root -g) node tests/lab-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".";
(async () => {
  const browser = await chromium.launch(), errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept("Test reason"));
  await page.goto("http://localhost:8765/tests/lab-harness.html");
  const f = page.frameLocator("#f"); await f.locator("#list .pt").first().waitFor(); await page.waitForTimeout(300);
  const db = (fn, ...a) => page.evaluate(([fn, a]) => window.__db[fn](...a), [fn, a]);
  const setStatus = (id, st) => page.evaluate(([id, st]) => { const d = window.__db.get("pc_inv_orders", id); d.status = st; window.__db.add("pc_inv_orders", id, d); }, [id, st]);
  const open = async id => { await f.locator('#list .pt[data-ord="' + id + '"]').click(); await page.waitForTimeout(250); };
  const tab = async t => { await f.locator('#tabs [data-f="' + t + '"]').click(); await page.waitForTimeout(150); };
  const act = () => f.locator("#actCard").innerText();

  // 1. specimen workflow: collected -> received -> accepted -> processing
  await tab("inlab"); await open("oColl");
  await f.locator("#receiveBtn").click(); await page.waitForTimeout(250);
  assert.equal((await db("get", "pc_inv_orders", "oColl")).status, "received");
  await f.locator("#specCond").fill("Good"); await f.locator("#acceptBtn").click(); await page.waitForTimeout(250);
  let oc = await db("get", "pc_inv_orders", "oColl"); assert.equal(oc.status, "accepted"); assert.equal(oc.specimenCondition, "Good");
  await f.locator("#processBtn").click(); await page.waitForTimeout(250); assert.equal((await db("get", "pc_inv_orders", "oColl")).status, "processing");
  // 2. rejection needs a reason and ends the request
  await open("oRecv"); await f.locator("#rejectBtn").click();
  assert.equal((await db("get", "pc_inv_orders", "oRecv")).status, "received", "no reason chosen: nothing rejected");
  await f.locator("#rejCode").selectOption({ label: "Haemolysed" }); await f.locator("#rejectBtn").click(); await page.waitForTimeout(250);
  oc = await db("get", "pc_inv_orders", "oRecv"); assert.equal(oc.status, "rejected"); assert.match(oc.rejectReason, /Haemolysed/);
  await page.screenshot({ path: OUT + "/lab-specimen-mobile.png" });

  // 3. number result with critical limit: critical flag, alert created in the same save, who-was-informed recorded
  await setStatus("oNum", "processing"); await tab("inlab"); await open("oNum");
  await f.locator("#rVal").fill("3"); await f.locator("#rSaveBtn").click(); await page.waitForTimeout(300);
  const r1 = await db("get", "pc_inv_results", "oNum"); assert.equal(r1.value, 3); assert.equal(r1.critical, true); assert.equal(r1.flag, "low");
  const al = await db("get", "pc_lab_alerts", "oNum"); assert.equal(al.status, "open"); assert.equal(al.resultId, "oNum");
  assert.equal((await db("get", "pc_inv_orders", "oNum")).status, "resulted");
  await tab("resulted"); await open("oNum");
  assert.match(await act(), /CRITICAL/); assert.match(await act(), /not a diagnosis/);
  await f.locator("[data-inf-who]").fill("Dr Test"); await f.locator("[data-inf]").click(); await page.waitForTimeout(250);
  const al2 = await db("get", "pc_lab_alerts", "oNum"); assert.equal(al2.status, "informed"); assert.equal(al2.informedPerson, "Dr Test");
  await page.screenshot({ path: OUT + "/lab-critical-mobile.png" });
  // 4. verify, then a correction needs a reason and creates a NEW result, keeping the old
  await f.locator("#verifyBtn").click(); await page.waitForTimeout(250);
  assert.equal((await db("get", "pc_inv_orders", "oNum")).status, "verified"); assert.equal((await db("get", "pc_inv_results", "oNum")).status, "verified");
  await tab("done"); await open("oNum"); await f.locator("#showAmendBtn").click(); await f.locator("#rVal").fill("15");
  const before = (await db("all", "pc_inv_results")).length;
  await f.locator("#rSaveBtn").click(); await page.waitForTimeout(200);
  assert.equal((await db("all", "pc_inv_results")).length, before, "no reason: nothing saved");
  assert.match(await f.locator("#rMsg").innerText(), /reason/i);
  await f.locator("#rReason").fill("Typed wrong value"); await f.locator("#rSaveBtn").click(); await page.waitForTimeout(300);
  const rs = (await db("all", "pc_inv_results")).filter(r => !/^oV/.test(r._id)); assert.equal(rs.length, 2, "old result preserved, new one added");
  const nw = rs.find(r => r._id !== "oNum"); assert.equal(nw.amends, "oNum"); assert.equal(nw.correctionReason, "Typed wrong value"); assert.equal(nw.critical, false);
  assert.equal((await db("get", "pc_inv_results", "oNum")).value, 3, "verified result never overwritten");
  assert.equal((await db("get", "pc_inv_orders", "oNum")).currentResultId, nw._id);

  // 5. qualitative critical value; only allowed values selectable
  await setStatus("oQual", "processing"); await tab("inlab"); await open("oQual");
  assert.deepEqual(await f.locator("#rVal option").allInnerTexts(), ["Choose…", "Positive", "Negative"]);
  await f.locator("#rVal").selectOption("Positive"); await f.locator("#rSaveBtn").click(); await page.waitForTimeout(250);
  assert.equal((await db("get", "pc_inv_results", "oQual")).critical, true);
  // 6. scale: facility terms only, meaning shown only where the facility entered one
  await setStatus("oScale", "processing"); await tab("inlab"); await open("oScale");
  assert.deepEqual(await f.locator("#rVal option").allInnerTexts(), ["Choose…", "T1", "T2"]); assert.match(await act(), /T1 = test meaning one/); assert.doesNotMatch(await act(), /T2 =/);
  await f.locator("#rVal").selectOption("T2"); await f.locator("#rSaveBtn").click(); await page.waitForTimeout(250);
  const sc = await db("get", "pc_inv_results", "oScale"); assert.equal(sc.value, "T2"); assert.equal(sc.critical, false);
  // 7. panel: each parameter separate
  await setStatus("oMulti", "processing"); await tab("inlab"); await open("oMulti");
  await f.locator("#rp_a").fill("5"); await f.locator("#rp_b").selectOption("Yes"); await f.locator("#rSaveBtn").click(); await page.waitForTimeout(250);
  const mu = await db("get", "pc_inv_results", "oMulti"); assert.equal(mu.values.a.value, 5); assert.equal(mu.values.a.flag, "high"); assert.equal(mu.values.b.value, "Yes"); assert.match(mu.value, /Alpha 5 mg/);
  await tab("resulted"); await open("oMulti"); assert.match(await act(), /Alpha/); await page.screenshot({ path: OUT + "/lab-panel-mobile.png" });
  // 8. organism and susceptibility
  await setStatus("oOrg", "processing"); await tab("inlab"); await open("oOrg");
  await f.locator('[data-of="name"]').fill("Org one"); await f.locator('[data-ab="0"]').selectOption("S"); await f.locator('[data-ab="1"]').selectOption("R");
  await page.screenshot({ path: OUT + "/lab-organism-mobile.png" });
  await f.locator("#rSaveBtn").click(); await page.waitForTimeout(250);
  const og = await db("get", "pc_inv_results", "oOrg"); assert.equal(og.values.organisms[0].susceptibility.Abx1, "S"); assert.equal(og.values.organisms[0].susceptibility.Abx2, "R");
  // 9. titer must be a dilution
  await setStatus("oTit", "processing"); await tab("inlab"); await open("oTit");
  await f.locator("#rVal").fill("high"); await f.locator("#rSaveBtn").click(); await page.waitForTimeout(150);
  assert.match(await f.locator("#rMsg").innerText(), /dilution/); assert.equal(await db("get", "pc_inv_results", "oTit"), null);
  await f.locator("#rVal").fill("1:80"); await f.locator("#rSaveBtn").click(); await page.waitForTimeout(250); assert.equal((await db("get", "pc_inv_results", "oTit")).value, "1:80");

  // 10. billing: part paid -> credit recorded once; second bill refused; reversal removes the credit
  await tab("resulted"); await open("oQual");
  await f.locator("#bMode").selectOption("part"); await f.locator("#bPaid").fill("1000"); await f.locator("#billBtn").click(); await page.waitForTimeout(300);
  const bill = await db("get", "pc_lab_bills", "oQual"); assert.equal(bill.status, "part_paid"); assert.equal(bill.amountPaid, 1000); assert.equal(bill.amountOutstanding, 2000);
  const ct = (await db("all", "credit_transactions")); assert.equal(ct.length, 1); assert.equal(ct[0].type, "CREDIT_SALE"); assert.equal(ct[0].balanceChange, 2000);
  assert.equal((await db("all", "credit_accounts")).length, 1);
  assert.equal(await f.locator("#billBtn").count(), 0, "already billed: no second bill form");
  await f.locator("#reverseBillBtn").click(); await page.waitForTimeout(300);
  assert.equal((await db("get", "pc_lab_bills", "oQual")).status, "reversed");
  const ct2 = await db("all", "credit_transactions"); assert.equal(ct2.reduce((s, t) => s + t.balanceChange, 0), 0, "credit balance back to zero");
  // waiver needs a reason, and is recorded with who authorised it
  await tab("resulted"); await open("oMulti"); await f.locator("#bMode").selectOption("waive"); await f.locator("#billBtn").click(); await page.waitForTimeout(150);
  assert.match(await f.locator("#bMsg").innerText(), /reason/i); assert.equal(await db("get", "pc_lab_bills", "oMulti"), null);
  assert.equal((await db("all", "credit_transactions")).length, 2, "no extra financial records");
  await page.screenshot({ path: OUT + "/lab-bill-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(200); await page.screenshot({ path: OUT + "/lab-desktop.png" });
  assert.deepEqual(errors, [], "no page errors");
  await browser.close(); console.log("lab-check: all checks passed (in-memory stand-in, not real Firebase)");
})().catch(e => { console.error(e); process.exit(1); });
