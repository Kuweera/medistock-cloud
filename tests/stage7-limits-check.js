/* Developer 3, stage 7: owner-approved data-entry limits (DATA_CONTRACT_V19 section 18) and the glucose device status in encounter.html (triage form).
   Drives the REAL encounter.html in headless Chromium against the in-memory harness (NOT real Firebase, NOT the rules engine).
   Every document the page writes is also run through a JavaScript PORT of the v29 triageOk rule (written from firestore.rules lines ~627-646) - a stand-in, not the emulator.
   Run: python3 -m http.server 8765 (repo root), then node tests/stage7-limits-check.js [screenshot-folder] */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const OUT = process.argv[2] || ".", ENC = "http://localhost:8765/tests/encounter-harness.html";

/* ---- port of the v29 rule (stand-in) ---- */
const nz = x => x === undefined || x === null;
function numOk(d, k, lo, hi) { return nz(d[k]) || (typeof d[k] === "number" && d[k] >= lo && d[k] <= hi); }
function glucoseOk(d) {
  if (nz(d.glucose)) return nz(d.glucoseStatus) || (["below_device_range", "above_device_range"].includes(d.glucoseStatus) && ["mmol/L", "mg/dL"].includes(d.glucoseUnit));
  return typeof d.glucose === "number" && d.glucose > 0 && nz(d.glucoseStatus) && ((d.glucoseUnit === "mg/dL" && d.glucose <= 1000) || (d.glucoseUnit === "mmol/L" && d.glucose <= 55.5));
}
function triageOk(d) {
  return numOk(d, "temperatureC", 25, 45) && numOk(d, "bpSys", 20, 300) && numOk(d, "bpDia", 10, 200) && numOk(d, "pulse", 10, 300) && numOk(d, "respRate", 2, 100) && numOk(d, "spo2", 30, 100)
    && numOk(d, "weightKg", 0.3, 500) && numOk(d, "heightCm", 20, 260) && numOk(d, "painScore", 0, 10) && numOk(d, "muacCm", 3, 60) && glucoseOk(d)
    && (nz(d.bpSys) || nz(d.bpDia) || d.bpDia < d.bpSys)
    && (nz(d.glucoseDevice) || (typeof d.glucoseDevice === "string" && d.glucoseDevice.length <= 100))
    && (!("glucoseUnit" in d) || d.glucoseUnit == null || ["mmol/L", "mg/dL"].includes(d.glucoseUnit));
}

(async () => {
  const browser = await chromium.launch(), errors = [];
  async function open(w, h) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }), page = await ctx.newPage();
    page.on("pageerror", e => errors.push(String(e))); page.on("dialog", d => d.accept());
    await page.goto(ENC); const f = page.frameLocator("#f"); await f.locator("#mainArea:not(.hidden)").waitFor(); await page.waitForTimeout(500);
    await f.locator('[data-t="triage"]').click(); await f.locator("#tMore > summary").click();
    return { page, f };
  }
  const { page, f } = await open(390, 844);
  const rows = () => page.evaluate(() => window.__db.all("pc_triage"));
  const fr = await (await page.locator("#f").elementHandle()).contentFrame();
  const clearAll = () => fr.evaluate(() => {
    ["tTemp", "tSys", "tDia", "tPulse", "tResp", "tSpo2", "tWeight", "tHeight", "tMuac", "tGlu", "tNotes", "tGluDevice"].forEach(id => { const e = document.getElementById(id); e.disabled = false; e.value = ""; });
    ["tPain", "tCons", "tCat", "tGluStatus"].forEach(id => { document.getElementById(id).value = ""; });
    document.getElementById("tGluUnit").value = "mmol/L"; document.getElementById("tGluUnit").dispatchEvent(new Event("change"));
    document.getElementById("tGluStatus").dispatchEvent(new Event("change")); document.getElementById("tMsg").textContent = ""; document.getElementById("tGluNote").textContent = "";
  });
  /* fill {id: value}, save; returns { saved: newRow|null, msg } and always checks that anything saved passes the v29 rule port */
  async function trySave(vals, opts) {
    opts = opts || {}; await clearAll();
    if (opts.unit) await f.locator("#tGluUnit").selectOption(opts.unit);          // unit first: switching the unit afterwards clears an invalid number (tested separately)
    if (opts.status) await f.locator("#tGluStatus").selectOption(opts.status);
    for (const id in vals) await f.locator("#" + id).fill(String(vals[id]));
    if (opts.device != null) await f.locator("#tGluDevice").fill(opts.device);
    const before = (await rows()).length; await f.locator("#tSaveBtn").click(); await page.waitForTimeout(120);
    const after = await rows(), msg = (await f.locator("#tMsg").innerText()).trim();
    const saved = after.length > before ? after[after.length - 1] : null;
    if (saved) assert.equal(triageOk(saved), true, "the v29 rule port must accept what the page saved: " + JSON.stringify(saved));
    return { saved, msg };
  }
  const refused = async (vals, re, opts) => { const r = await trySave(vals, opts); assert.equal(r.saved, null, "must NOT save " + JSON.stringify(vals) + " " + JSON.stringify(opts || {})); assert.match(r.msg, re, JSON.stringify(vals) + " -> " + r.msg); return r; };
  const accepted = async (vals, opts) => { const r = await trySave(vals, opts); assert.ok(r.saved, "must save " + JSON.stringify(vals) + " " + JSON.stringify(opts || {}) + " (message: " + r.msg + ")"); return r.saved; };

  /* ---- 0. the port is not vacuous: it refuses what v29 refuses ---- */
  assert.equal(triageOk({ glucose: 0, glucoseUnit: "mmol/L" }), false); assert.equal(triageOk({ glucose: 5 }), false, "glucose needs a unit");
  assert.equal(triageOk({ glucose: 5, glucoseUnit: "mmol/L", glucoseStatus: "below_device_range" }), false, "number and status together");
  assert.equal(triageOk({ bpSys: 100, bpDia: 100 }), false); assert.equal(triageOk({ glucoseStatus: "below_device_range" }), false, "status needs a unit");
  assert.equal(triageOk({ glucoseStatus: "below_device_range", glucoseUnit: "mg/dL" }), true);

  /* ---- 1. every approved limit: exact min and max accepted, just below / above refused, zero and negative refused, exactly as typed ---- */
  const T = [["tTemp", "temperatureC", 25, 45, "Temperature"], ["tSys", "bpSys", 20, 300, "Systolic"], ["tDia", "bpDia", 10, 200, "Diastolic"], ["tPulse", "pulse", 10, 300, "Pulse"], ["tResp", "respRate", 2, 100, "Breathing"],
    ["tSpo2", "spo2", 30, 100, "Oxygen"], ["tWeight", "weightKg", 0.3, 500, "Weight"], ["tHeight", "heightCm", 20, 260, "Height"], ["tMuac", "muacCm", 3, 60, "MUAC"]];
  for (const [id, key, lo, hi, name] of T) {
    assert.equal((await accepted({ [id]: lo }))[key], lo, key + " minimum saved as typed");
    assert.equal((await accepted({ [id]: hi }))[key], hi, key + " maximum saved as typed");
    await refused({ [id]: (lo - 0.1).toFixed(1) }, new RegExp(name + "[\\s\\S]*(between " + lo + " and " + hi + "|above zero)"));
    await refused({ [id]: (hi + 0.1).toFixed(1) }, new RegExp(name + "[\\s\\S]*between " + lo + " and " + hi));
    await refused({ [id]: "0" }, new RegExp(name + "[\\s\\S]*(above zero|between)"));
    await refused({ [id]: "-1" }, new RegExp(name + "[\\s\\S]*(above zero|between)"));
    await refused({ [id]: "-0.5" }, new RegExp(name));
  }
  /* decimals are kept exactly (no rounding) */
  assert.equal((await accepted({ tTemp: "37.55" })).temperatureC, 37.55); assert.equal((await accepted({ tWeight: "12.345" })).weightKg, 12.345); assert.equal((await accepted({ tSpo2: "97.5" })).spo2, 97.5);
  /* pain score is a 0 to 10 list: 0 is a valid score and is saved */
  await clearAll(); await f.locator("#tPain").selectOption("0"); await f.locator("#tSaveBtn").click(); await page.waitForTimeout(120);
  let last = (await rows()).pop(); assert.equal(last.painScore, 0, "pain 0 is saved"); assert.equal(triageOk(last), true);
  await clearAll(); await f.locator("#tPain").selectOption("10"); await f.locator("#tSaveBtn").click(); await page.waitForTimeout(120); assert.equal((await rows()).pop().painScore, 10);
  const painOpts = await f.locator("#tPain option").evaluateAll(o => o.map(x => x.value).filter(Boolean)); assert.deepEqual(painOpts, ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].filter(x => painOpts.includes(x)), "list has only 0 to 10"); assert.ok(!painOpts.some(x => Number(x) < 0 || Number(x) > 10));

  /* ---- 2. glucose: limits depend on the unit; zero and negative refused ---- */
  assert.equal((await accepted({ tGlu: "1000" }, { unit: "mg/dL" })).glucose, 1000);
  assert.equal((await accepted({ tGlu: "55.5" }, { unit: "mmol/L" })).glucose, 55.5);
  assert.equal((await accepted({ tGlu: "0.1" }, { unit: "mmol/L" })).glucose, 0.1); assert.equal((await accepted({ tGlu: "0.1" }, { unit: "mg/dL" })).glucose, 0.1);
  assert.equal((await accepted({ tGlu: "5.55" }, { unit: "mmol/L" })).glucose, 5.55, "decimals exactly as typed");
  const g = await accepted({ tGlu: "99" }, { unit: "mg/dL" }); assert.equal(g.glucoseUnit, "mg/dL"); assert.equal(g.glucose, 99); assert.ok(!("glucoseStatus" in g) || g.glucoseStatus == null);
  await refused({ tGlu: "1000.1" }, /at most 1000 mg\/dL/, { unit: "mg/dL" });
  await refused({ tGlu: "55.6" }, /at most 55\.5 mmol\/L/, { unit: "mmol/L" });
  await refused({ tGlu: "1000" }, /at most 55\.5 mmol\/L/, { unit: "mmol/L" });          // an mg/dL-sized number is not allowed in mmol/L
  for (const u of ["mg/dL", "mmol/L"]) { await refused({ tGlu: "0" }, /above zero/, { unit: u }); await refused({ tGlu: "-1" }, /above zero/, { unit: u }); await refused({ tGlu: "-0.1" }, /above zero/, { unit: u }); }
  assert.match(await f.locator("#tGluLimit").innerText(), /above 0 and at most 55\.5 mmol\/L/); await f.locator("#tGluUnit").selectOption("mg/dL"); assert.match(await f.locator("#tGluLimit").innerText(), /at most 1000 mg\/dL/);

  /* ---- 3. switching units never keeps an invalid value and never converts ---- */
  await clearAll(); await f.locator("#tGluUnit").selectOption("mg/dL"); await f.locator("#tGlu").fill("500"); await f.locator("#tGluUnit").selectOption("mmol/L");
  assert.equal(await f.locator("#tGlu").inputValue(), "", "500 is not valid in mmol/L, so it is cleared"); assert.match(await f.locator("#tGluNote").innerText(), /500[\s\S]*not allowed in mmol\/L[\s\S]*cleared/);
  await f.locator("#tSaveBtn").click(); await page.waitForTimeout(100); assert.match(await f.locator("#tMsg").innerText(), /at least one/i, "nothing left to save");
  await clearAll(); await f.locator("#tGluUnit").selectOption("mmol/L"); await f.locator("#tGlu").fill("10"); await f.locator("#tGluUnit").selectOption("mg/dL");
  assert.equal(await f.locator("#tGlu").inputValue(), "10", "10 is valid in both: kept exactly as typed, not converted"); assert.match(await f.locator("#tGluNote").innerText(), /not converted/);
  await clearAll(); await f.locator("#tGlu").fill("1000"); await f.locator("#tGluUnit").selectOption("mg/dL"); await f.locator("#tGluUnit").selectOption("mmol/L");
  assert.equal(await f.locator("#tGlu").inputValue(), "", "1000 cleared when going back to mmol/L");

  /* ---- 4. blood pressure consistency ---- */
  await refused({ tSys: 120, tDia: 120 }, /bottom[\s\S]*\(120\)[\s\S]*lower than the top[\s\S]*\(120\)/); await refused({ tSys: 100, tDia: 130 }, /lower than the top/);
  const bp = await accepted({ tSys: 120, tDia: 119 }); assert.equal(bp.bpSys, 120); assert.equal(bp.bpDia, 119);
  assert.equal((await accepted({ tDia: 150 })).bpDia, 150, "one pressure alone is not compared"); assert.equal((await accepted({ tSys: 90 })).bpSys, 90);
  await refused({ tSys: 15, tDia: 10 }, /Systolic/);   // the limit message comes first

  /* ---- 5. device status ---- */
  const lowSt = await accepted({}, { status: "below_device_range", unit: "mmol/L", device: "TEST meter" });
  assert.equal(lowSt.glucoseStatus, "below_device_range"); assert.equal(lowSt.glucoseUnit, "mmol/L"); assert.equal(lowSt.glucoseDevice, "TEST meter");
  assert.ok(!("glucose" in lowSt), "no glucose key at all, never null, never a made-up number"); assert.ok(!lowSt.interp, "no interpretation for a status");
  const hiSt = await accepted({}, { status: "above_device_range", unit: "mg/dL" });
  assert.equal(hiSt.glucoseStatus, "above_device_range"); assert.equal(hiSt.glucoseUnit, "mg/dL"); assert.ok(!("glucoseDevice" in hiSt), "empty device name: key left out"); assert.ok(!("glucose" in hiSt));
  const mixed = await accepted({ tPulse: 90, tTemp: 37 }, { status: "above_device_range", unit: "mmol/L", device: "  Meter X  " });
  assert.equal(mixed.glucoseDevice, "Meter X", "device name trimmed"); assert.equal(mixed.pulse, 90);
  const normal = await accepted({ tGlu: "6.1" }, { unit: "mmol/L" }); assert.ok(!("glucoseStatus" in normal) && !("glucoseDevice" in normal), "no status keys for an ordinary number");
  const none = await accepted({ tPulse: 80 }); assert.equal(none.glucoseUnit, null); assert.ok(!("glucoseStatus" in none));
  // choosing a status clears and locks the number box, and says so
  await clearAll(); await f.locator("#tGlu").fill("7"); await f.locator("#tGluStatus").selectOption("below_device_range");
  assert.equal(await f.locator("#tGlu").inputValue(), ""); assert.equal(await f.locator("#tGlu").isDisabled(), true); assert.match(await f.locator("#tGluNote").innerText(), /7 was cleared/); assert.equal(await f.locator("#tGluDevWrap").isVisible(), true);
  assert.equal(await f.locator("#tGluUnit").isVisible(), true, "unit stays visible with a status"); assert.equal(await f.locator("#tGluUnit").isDisabled(), false);
  await f.locator("#tGluStatus").selectOption(""); assert.equal(await f.locator("#tGlu").isDisabled(), false); assert.equal(await f.locator("#tGluDevWrap").isVisible(), false);
  // a status refused by the engine is not saved (device name over 100 characters set directly, bypassing maxlength)
  await clearAll(); await f.locator("#tGluStatus").selectOption("below_device_range"); await fr.evaluate(() => { document.getElementById("tGluDevice").value = "x".repeat(101); });
  let n0 = (await rows()).length; await f.locator("#tSaveBtn").click(); await page.waitForTimeout(100); assert.equal((await rows()).length, n0); assert.match(await f.locator("#tMsg").innerText(), /100|device/i);
  assert.equal(await f.locator("#tGluDevice").getAttribute("maxlength"), "100");
  // after a save the status resets, the unit stays
  await accepted({}, { status: "below_device_range", unit: "mg/dL", device: "D" }); assert.equal(await f.locator("#tGluStatus").inputValue(), ""); assert.equal(await f.locator("#tGluUnit").inputValue(), "mg/dL"); assert.equal(await f.locator("#tGlu").isDisabled(), false);

  /* ---- 6. the stored status is shown (list), in words, with unit and device, never a number or interpretation ---- */
  await page.waitForTimeout(300);
  const list = await f.locator("#tList").innerText();
  assert.match(list, /Glucose below the device's measuring range, mmol\/L, device TEST meter/); assert.match(list, /Glucose above the device's measuring range, mg\/dL/);
  const statusLines = list.split("\n").filter(l => /measuring range/.test(l)); assert.ok(statusLines.length >= 2);
  for (const line of statusLines) {
    assert.doesNotMatch(line.replace(/mmol\/L|mg\/dL/g, ""), /Glucose[^·]*\d/, "a status line carries no number: " + line);
    assert.doesNotMatch(line, /\b(abnormal|critical|diabet\w*|hypo\w*|hyper\w*|normal)\b/i, "no interpretation: " + line);
  }
  assert.match(list, /Glucose 6\.1 mmol\/L/, "ordinary numbers display as before"); assert.match(list, /Glucose 99 mg\/dL/);
  await f.locator("#tList").scrollIntoViewIfNeeded(); await page.screenshot({ path: OUT + "/stage7-status-list-mobile.png", fullPage: true });
  // a record with a number and the old seed record still render
  assert.match(list, /SpO2 91%/);
  // no horizontal scroll on the phone
  assert.equal(await fr.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, "no sideways scroll at 390px");
  await clearAll(); await f.locator("#tGluStatus").selectOption("below_device_range"); await f.locator("#tGluStatus").scrollIntoViewIfNeeded(); await page.screenshot({ path: OUT + "/stage7-status-form-mobile.png" });

  /* ---- 7. every document written passes the rule port; nothing invalid was ever saved ---- */
  const all = await rows(); assert.ok(all.length > 30, "many records written: " + all.length);
  const seed = all.filter(r => r._id === "t1"); for (const r of all) if (r._id !== "t1") assert.equal(triageOk(r), true, "rule port: " + JSON.stringify(r));
  assert.equal(seed.length, 1);

  /* ---- 8. desktop layout ---- */
  const d = await open(1280, 800); const df = d.f;
  await df.locator("#tGluStatus").selectOption("above_device_range"); await df.locator("#tGluDevice").fill("Desk meter"); await df.locator("#tGluStatus").scrollIntoViewIfNeeded(); await d.page.screenshot({ path: OUT + "/stage7-status-form-desktop.png" });
  await df.locator("#tSaveBtn").click(); await d.page.waitForTimeout(400);
  assert.match(await df.locator("#tList").innerText(), /Glucose above the device's measuring range, mmol\/L, device Desk meter/);
  assert.equal(errors.length, 0, "no page errors: " + errors.join(" | "));
  await browser.close(); console.log("stage7 limits + glucose device status: OK (" + all.length + " records written and checked against the v29 rule port)");
})().catch(e => { console.error(e); process.exit(1); });
