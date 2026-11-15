const test = require("node:test"), assert = require("node:assert"), U = require("../pc-ux.js");
test("friendly errors", () => {
  assert.match(U.friendlyError({ code: "permission-denied" }), /do not have permission/);
  assert.match(U.friendlyError({ code: "unavailable" }, "patient"), /patient could not be saved/);
  assert.doesNotMatch(U.friendlyError({ code: "invalid-argument" }), /invalid-argument/);
  assert.ok(U.friendlyError(null));
});
test("age and bmi", () => {
  assert.equal(U.ageFromDob("2020-01-15", new Date("2026-03-10")).text, "6 years");
  assert.equal(U.ageFromDob("2026-01-01", new Date("2026-03-10")).text, "2 months");
  assert.equal(U.ageFromDob("2030-01-01", new Date("2026-03-10")), null);
  assert.equal(U.bmi(70, 175).value, 22.9);
  assert.equal(U.bmi(0, 175), null);
});
