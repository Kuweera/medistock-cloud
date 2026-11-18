/* Developer 4: laboratory integration checks that need no Firebase: the pieces agree with each other (files, permissions, rules, money). */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, ".."), read = f => fs.readFileSync(path.join(root, f), "utf8");
const PCL = require("../pc-lab.js");

test("every permission the laboratory pages check exists on the Users page and in the rules", () => {
  const users = read("users.html"), rules = read("firestore.rules");
  for (const pg of ["laboratory.html", "lab-reports.html", "investigations.html", "encounter.html"]) {
    const keys = new Set([...read(pg).matchAll(/can\("([a-z]+\.[a-z]+)"\)/g)].map(m => m[1]));
    for (const k of keys) { assert.ok(users.includes('"' + k + '"'), pg + " checks " + k + " but Users cannot grant it"); assert.ok(rules.includes("'" + k + "'"), pg + " checks " + k + " but no rule uses it"); }
  }
});
test("new files are cached, linked in the menu, and every script a lab page loads exists", () => {
  const sw = read("sw.js"), nav = read("nav.js");
  for (const f of ["pc-lab.js", "lab-reports.html"]) assert.ok(sw.includes('"' + f + '"'), f + " not in sw.js");
  assert.ok(nav.includes("lab-reports.html"));
  for (const pg of ["laboratory.html", "lab-reports.html", "investigations.html", "encounter.html"]) for (const m of read(pg).matchAll(/<script src="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(root, m[1])), pg + " loads missing " + m[1]);
});
test("journey: catalogue -> order -> result -> bill -> report; a request is not revenue, a reversed bill is not revenue", () => {
  const cat = { name: "J test", category: "other", resultType: "qualitative", choices: ["Positive", "Negative"], price: 3000, specimen: "Blood", critical: { values: ["Positive"], source: "Test limits" } };
  assert.equal(PCL.validateTest(cat), "");
  const order = Object.assign({ id: "o1", name: cat.name, status: "requested", requestedDay: "2026-11-01", requestedAt: 1 }, PCL.orderFields(cat));
  assert.equal(order.price, 3000);
  const r = PCL.buildResult(order, { value: "Positive" }); assert.ok(r.ok && r.critical);
  assert.equal(PCL.report([order], [], [], { from: "2026-11-01", to: "2026-11-01" }).revenue.billed, 0, "a request is not revenue");
  const b = PCL.bill({ price: 3000, amountPaid: 1000 });
  const bill = { id: "o1", orderId: "o1", price: b.price, amountPaid: b.paid, amountOutstanding: b.outstanding, amountWaived: b.waived, status: b.status };
  const rep = PCL.report([order], [], [bill], { from: "2026-11-01", to: "2026-11-01" }).revenue; assert.deepEqual([rep.billed, rep.collected, rep.outstanding], [3000, 1000, 2000]);
  const rev = PCL.report([order], [], [Object.assign({}, bill, { status: "reversed" })], { from: "2026-11-01", to: "2026-11-01" }).revenue; assert.equal(rev.billed, 0);
});
test("laboratory.html writes the bill under the order id and the credit entry under a fixed id (so a retry or a second phone cannot double it)", () => {
  const h = read("laboratory.html");
  assert.match(h, /doc\(db, "pc_lab_bills", o\.id\)/); assert.match(h, /"labct_" \+ o\.id/); assert.match(h, /"labrv_" \+ o\.id/);
  assert.doesNotMatch(h, /collection\(db, "receipts"\)|collection\(db, "sales"\)/, "lab money must not create receipts or sales (that would double-count revenue)");
});
test("the order carries what result entry needs, so an old order without a profile still works", () => {
  const legacy = { id: "x", name: "Old", resultType: "number", units: "g", refMin: 1, refMax: 2 };
  const r = PCL.buildResult(legacy, { value: "1.5" }); assert.ok(r.ok); assert.equal(r.flag, "normal");
  assert.equal(PCL.buildResult({ id: "y", resultType: "choice", choices: ["A", "B"] }, { value: "C" }).ok, false);
});
