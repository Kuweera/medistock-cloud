/* Developer 3: OFFLINE SAFETY. Dispensing saved offline ("Pending sync") has not reduced the server stock, so the stock and the prescription quantity it uses must already
   be taken off what can be dispensed on this device: same prescription, ANOTHER prescription for the same medicine, and ANOTHER USER of the same device.
   Real pharmacy.html in Chromium, in-memory stand-in (NOT real Firebase). Run: python3 -m http.server 8765 (repo root); node tests/offline-safety-check.js [folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", URL = "http://localhost:8765/tests/harness-stage6.html";
const other = JSON.stringify([{ requestId: "req_other_user", status: "pending", attempts: 0, message: "", params: { orderId: "offA", drugId: "d8", qty: 20, businessId: "biz1", facilityId: "shop1" } }]);
(async () => {
  const browser = await chromium.launch(), errors = [];
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    // ---------- A. same user: queue 20 of prescription A offline, then try prescription B (same medicine, only 30 in stock)
    let ctx = await browser.newContext({ viewport: vp }), page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept("x"));
    await page.goto(URL); let f = page.frameLocator("#f"); await f.locator("#list .rxgroup").first().waitFor(); await page.waitForTimeout(400);
    const db = (fn, ...a) => page.evaluate(([fn, a]) => window.__db[fn](...a), [fn, a]); const open = async k => { await f.locator('#list .pt[data-id="' + k + '"]').click(); await f.locator("#cPat").waitFor(); };
    await open("offA"); await f.locator("#cPat").check(); await f.locator("#cMed").check(); await f.locator("#qDo").fill("20"); await f.locator('#actCard [data-act="pay"][data-m="credit"]').click();
    await ctx.setOffline(true); await page.waitForTimeout(300); await f.locator('#actCard [data-act="confirm"]').click(); await f.locator("#actCard .recordtext").waitFor();
    assert.equal((await db("get", "drugs", "d8")).currentStockBase, 30, "the server stock is not reduced yet (it is saved, not confirmed)"); assert.match(await f.locator("#syncText").innerText(), /1 dispensing waiting/);
    await f.locator('#actCard [data-act="close"]').click();
    let rowA = await f.locator('#list .pt[data-id="offA"]').innerText(); assert.match(rowA, /Pending sync/); assert.match(rowA, /0\s+OUTSTANDING/i, "the list no longer offers the quantity that is already saved"); assert.match(rowA, /20 Tablet saved on this device, waiting to sync/);
    await open("offB"); let panel = await f.locator("#actCard").innerText(); assert.match(panel, /Available to dispense: 10 Tablet/); assert.match(panel, /20 Tablet\(s\) already reserved by dispensing waiting to sync on this phone/);
    await f.locator("#cPat").check(); await f.locator("#cMed").check(); await f.locator("#qDo").fill("20"); await f.locator('#actCard [data-act="pay"][data-m="credit"]').click().catch(() => {});
    assert.equal(await f.locator('#actCard [data-act="confirm"]').isDisabled(), true, "cannot dispense 20 when only 10 is really left"); assert.match(await f.locator("#actCard").innerText(), /Only 10 Tablet\(s\) can be dispensed now/);
    await f.locator("#qDo").fill("10"); await f.locator('#actCard [data-act="pay"][data-m="credit"]').click().catch(() => {}); assert.equal(await f.locator('#actCard [data-act="confirm"]').isDisabled(), false, "the 10 that really is left can be dispensed");
    // same prescription again: only what is not already saved
    await f.locator('#actCard [data-act="close"]').click(); await open("offA"); assert.match(await f.locator("#actCard").innerText(), /already reserved|nothing left|already complete|0 Tablet/i);
    await ctx.setOffline(false); await page.waitForFunction(() => window.__db.get("prescriptions", "offA").qtyDispensed === 20, null, { timeout: 15000 }); assert.equal((await db("get", "drugs", "d8")).currentStockBase, 10, "after reconnecting the server stock drops once");
    await ctx.close();
    // ---------- B. ANOTHER USER of the same device saved 20 of prescription A offline: this user must see it too
    ctx = await browser.newContext({ viewport: vp }); page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept("x"));
    await page.addInitScript(v => { try { if (!localStorage.getItem("mcDispQ:otherUser:shop1")) localStorage.setItem("mcDispQ:otherUser:shop1", v); } catch (e) {} }, other);
    await page.goto(URL); f = page.frameLocator("#f"); await f.locator("#list .rxgroup").first().waitFor(); await page.waitForTimeout(400);
    rowA = await f.locator('#list .pt[data-id="offA"]').innerText(); assert.match(rowA, /20 Tablet saved on this device, waiting to sync/, "another user's saved dispensing is visible");
    await f.locator('#list .pt[data-id="offB"]').click(); await f.locator("#cPat").waitFor(); panel = await f.locator("#actCard").innerText(); assert.match(panel, /Available to dispense: 10 Tablet/, "stock already spoken for by the other user is not offered again");
    await f.locator("#cPat").check(); await f.locator("#cMed").check(); await f.locator("#qDo").fill("20"); await f.locator('#actCard [data-act="pay"][data-m="credit"]').click().catch(() => {}); assert.equal(await f.locator('#actCard [data-act="confirm"]').isDisabled(), true);
    assert.equal(await f.locator("#list").evaluate(e => e.scrollWidth > e.clientWidth + 1), false, vp.width + ": no sideways scroll");
    await page.screenshot({ path: OUT + "/offline-safety-" + (vp.width < 600 ? "mobile" : "desktop") + ".png" }); await ctx.close();
  }
  assert.deepEqual(errors, [], "no page errors"); await browser.close(); console.log("OFFLINE SAFETY CHECK PASSED (stand-in, not real Firebase; one device only: two devices offline cannot see each other)");
})().catch(e => { console.error(e); process.exit(1); });
