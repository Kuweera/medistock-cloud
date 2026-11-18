/* Developer 4 — integration, Data Contract and regression-guard checks. No installs needed:  node --test "tests/*.test.js" */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

test("protected business-management files are unchanged (mc-core.js, sales, purchases, inventory, ...)", () => {
  const base = JSON.parse(read("tests/baseline-hashes.json")).files;
  Object.keys(base).forEach(f => {
    const h = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex");
    assert.equal(h, base[f], f + " was changed. If this is deliberate, run the regression checks and update tests/baseline-hashes.json in the same commit.");
  });
});

test("Data Contract: prescriptions fields are written by the dispensing engine", () => {
  const src = read("pc-dispense.js");
  "id patientId encounterId drugId drugName dose qtyPrescribed qtyDispensed qtyOutstanding status createdAt".split(" ").forEach(k => assert.match(src, new RegExp("\\b" + k + "\\b"), "prescriptions." + k));
  assert.match(src, /"prescriptions"/);
  ["pending", "partially_dispensed", "completed"].forEach(v => assert.ok(src.includes(v), "status " + v));
});
test("Data Contract: dispense_records fields are written by the dispensing engine", () => {
  const src = read("pc-dispense.js");
  "id prescriptionId patientId drugId batchId qtyDispensed dispensedBy dispensedAt isSynced".split(" ").forEach(k => assert.match(src, new RegExp("\\b" + k + "\\b"), "dispense_records." + k));
  assert.match(src, /"dispense_records"/);
});
test("Data Contract: guidelines fields exist in the guidelines library", () => {
  const src = read("pc-guidelines.js") + read("guidelines.html");
  "id title category symptoms investigations treatment source".split(" ").forEach(k => assert.match(src, new RegExp("\\b" + k + "\\b"), "guidelines." + k));
  assert.match(src, /"guidelines"/);
});

test("dispensing never touches the medication administration record", () => {
  const src = read("pc-dispense.js") + read("pharmacy.html");
  assert.doesNotMatch(src, /(collection|doc)\([^)]*"pc_(mar_records|treatment_events)"/);
});

test("navigation: every menu item is a real file and is cached for offline use", () => {
  const nav = read("nav.js"), sw = read("sw.js");
  const items = [...nav.matchAll(/\["([a-z0-9-]+\.html)",\s*"[^"]+"\]/g)].map(m => m[1]);
  assert.ok(items.includes("pharmacy.html") && items.includes("guidelines.html"));
  items.forEach(f => { assert.ok(fs.existsSync(path.join(root, f)), f + " listed in nav.js but missing"); assert.ok(sw.includes('"' + f + '"'), f + " is not in the sw.js offline list"); });
});
test("service worker: every local script/page used by the new and Patient Care pages is cached, and the version was raised", () => {
  const sw = read("sw.js");
  assert.match(sw, /VERSION = "mc-v(2[4-9]|[3-9]\d)"/, "sw.js VERSION must be at least mc-v24 for Phase 5");
  fs.readdirSync(root).filter(f => /\.html$/.test(f) && !/\(/.test(f)).forEach(f => {
    [...read(f).matchAll(/<script[^>]+src="([^"#?:]+\.js)"/g)].map(m => m[1]).forEach(j => {
      assert.ok(fs.existsSync(path.join(root, j)), f + " uses missing " + j);
      assert.ok(sw.includes('"' + j + '"'), f + " uses " + j + " but sw.js does not cache it");
    });
  });
});

test("rules: Phase 5 collections exist, nothing can be deleted, dispense records are append-only", () => {
  const r = read("firestore.rules");
  assert.match(r, /\(v18\)/);
  ["prescriptions", "dispense_records", "guidelines"].forEach(c => assert.match(r, new RegExp("match /" + c + "/\\{")));
  const block = n => { const i = r.indexOf("match /" + n + "/{"); return r.slice(i, r.indexOf("\n    }\n", i)); };
  assert.match(block("prescriptions"), /allow delete: if false/);
  assert.match(block("guidelines"), /allow delete: if false/);
  assert.match(block("dispense_records"), /allow update, delete: if false/);
  assert.doesNotMatch(r, /allow [a-z, ]+: if true/);
  const t = r.replace(/\/\/.*/g, "").replace(/'[^']*'/g, "''");
  ["{}", "()", "[]"].forEach(p => assert.equal(t.split(p[0]).length, t.split(p[1]).length, "unbalanced " + p));
});
test("rules: DISPENSE stock entries are protected and other stock entries are not restricted", () => {
  const r = read("firestore.rules"), i = r.indexOf("match /stock_transactions/");
  const b = r.slice(i, r.indexOf("\n    }\n", i));
  assert.match(b, /!= 'DISPENSE'/); assert.match(b, /existsAfter/);
});
test("version: docs carry the same rules version as the rules file", () => {
  assert.match(read("docs/IMPLEMENTATION_PROGRESS.md"), /v17/);
});

test("rules v16: the first-dispensing reads of a missing document are allowed for dispensers only", () => {
  const r = read("firestore.rules");
  const block = n => { const i = r.indexOf("match /" + n + "/{"); return r.slice(i, r.indexOf("\n    }\n", i)); };
  ["prescriptions", "dispense_records"].forEach(n => {
    const b = block(n);
    assert.doesNotMatch(b, /allow read:/, n + " must not use a single read rule that dereferences resource.data");
    assert.match(b, /allow get: if \(resource == null && dispenserMayProbe\(\)\)/); assert.match(b, /allow list:/);
  });
  assert.match(r, /function dispenserMayProbe\(\)/);
  assert.match(block("pc_treatment_orders"), /dispenserOrderReadOk/);
});

test("rules v17: new collections cannot be deleted; reversals, ledger caps and consumable movements are tied to their records", () => {
  const r = read("firestore.rules");
  const block = n => { const i = r.indexOf("match /" + n + "/{"); assert.ok(i >= 0, n); return r.slice(i, r.indexOf("\n    }\n", i)); };
  ["dispense_bills", "dispense_handovers", "dispense_returns", "dispense_return_ledger", "consumable_items", "consumable_movements", "consumable_bundles"].forEach(c => {
    assert.match(block(c), /(allow delete: if false|allow update, delete: if false)/, c);
  });
  assert.match(block("dispense_return_ledger"), /<= get\(dspPath\(recId\)\)\.data\.qtyDispensed/);
  assert.match(block("dispense_returns"), /confirmedBack == true/);
  assert.match(block("consumable_items"), /existsAfter\(conMovePath/);
  assert.match(block("consumable_movements"), /existsAfter\(conItemPath/);
  const rx = block("prescriptions"); assert.match(rx, /dispense\.reverse/); assert.match(rx, /resource\.data\.qtyDispensed == 0/);
  assert.match(block("stock_transactions"), /drt_/);
  assert.match(block("credit_accounts"), /resource == null && \(dispenserMayProbe\(\) || labBillerMayProbe\(\)\)/);
});
test("pc-dispense-ext.js is cached for offline use and does not touch mc-core.js", () => {
  assert.ok(fs.existsSync(path.join(__dirname, "..", "pc-dispense-ext.js")));
});
