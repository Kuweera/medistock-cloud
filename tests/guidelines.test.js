/* Guidelines library tests — run with:  node --test tests/     (Node 18+, no installs). TEST TEXT ONLY: no real clinical content is used. */
const test = require("node:test");
const assert = require("node:assert/strict");
const PCG = require("../pc-guidelines.js");

const full = (o) => Object.assign({ title: "T topic", category: "respiratory", scope: "national", symptoms: ["test cough"], sourceTitle: "Test Guideline", sourceOrg: "Test Org", sourceEdition: "2023", sourceRef: "p. 5", jurisdiction: "Uganda", effectiveDate: "2026-01-01", reviewDate: "2027-01-01", publicationDate: "2023", treatment: "text" }, o || {});
const mk = (key, v, st, o) => Object.assign({ id: PCG.idFor(key, v), guidelineKey: key, version: v, approvalStatus: st, source: "S" }, PCG.buildDoc(PCG.toForm(full()), {}), o || {});

test("contract field names are present and typed as agreed (id, title, category, symptoms, investigations, treatment, source)", () => {
  const d = PCG.buildDoc({ title: "A", category: "wound", symptoms: "cut, bleeding", investigations: "x\ny", treatment: "t", sourceTitle: "G", sourceOrg: "O", sourceEdition: "2020", sourceRef: "p1", jurisdiction: "Uganda" }, { key: "k1", version: 1 });
  assert.equal(d.id, "gl_k1_v1"); assert.equal(d.title, "A"); assert.equal(d.category, "wound");
  assert.deepEqual(d.symptoms, ["cut", "bleeding"]); assert.deepEqual(d.investigations, ["x", "y"]);
  assert.equal(typeof d.treatment, "string"); assert.equal(typeof d.source, "string");
  assert.match(d.source, /G \(2020\) — O — p1 — Uganda/);
});
test("13 categories from the master plan", () => { assert.equal(PCG.CATEGORIES.length, 13); assert.equal(PCG.categoryLabel("paediatric"), "Paediatric care"); });
test("a draft needs only title and category", () => {
  assert.equal(PCG.draftProblems(PCG.buildDoc({ title: "A", category: "wound" })).length, 0);
  assert.ok(PCG.draftProblems(PCG.buildDoc({ title: "", category: "wound" })).length);
  assert.ok(PCG.draftProblems(PCG.buildDoc({ title: "A", category: "nonsense" })).length);
});
test("approval requires every source field, valid dates, review after effective, and some content", () => {
  assert.equal(PCG.approvalProblems(PCG.buildDoc(PCG.toForm(full()), {})).length, 0);
  ["sourceTitle", "sourceOrg", "sourceEdition", "sourceRef", "jurisdiction"].forEach(k => assert.ok(PCG.approvalProblems(PCG.buildDoc(Object.assign(PCG.toForm(full()), { [k]: "" }), {})).length, k + " is required"));
  assert.ok(PCG.approvalProblems(PCG.buildDoc(PCG.toForm(full({ effectiveDate: "" })), {})).length);
  assert.ok(PCG.approvalProblems(PCG.buildDoc(PCG.toForm(full({ effectiveDate: "2026-02-30" })), {})).length, "impossible date rejected");
  assert.ok(PCG.approvalProblems(PCG.buildDoc(PCG.toForm(full({ reviewDate: "2025-01-01" })), {})).some(p => /before the effective/.test(p)));
  assert.ok(PCG.approvalProblems(PCG.buildDoc(PCG.toForm(full({ symptoms: "", treatment: "" })), {})).some(p => /clinical information/.test(p)), "empty shell cannot be approved");
});
test("versions: next number, current, open draft; old versions are kept", () => {
  const list = [mk("a", 1, "superseded"), mk("a", 2, "approved"), mk("a", 3, "draft"), mk("b", 1, "draft")];
  const vs = PCG.byKey(list).a;
  assert.deepEqual(vs.map(v => v.version), [3, 2, 1]); assert.equal(PCG.currentVersion(vs).version, 2); assert.equal(PCG.openDraft(vs).version, 3); assert.equal(PCG.nextVersion(vs), 4);
  assert.deepEqual(PCG.currentOnly(list).map(g => g.id), ["gl_a_v2"], "staff see only the approved version; drafts and old versions are not offered");
});
test("approving v3 supersedes v2 only; refuses when a newer version is approved; refuses unready or non-drafts", () => {
  const list = [mk("a", 1, "superseded"), mk("a", 2, "approved"), mk("a", 3, "draft")];
  assert.deepEqual(PCG.planApprove(list[2], list), { approve: "gl_a_v3", supersede: ["gl_a_v2"] });
  const stale = [mk("a", 2, "draft"), mk("a", 3, "approved")];
  assert.throws(() => PCG.planApprove(stale[0], stale), e => e.code === "newer_exists");
  assert.throws(() => PCG.planApprove(list[1], list), e => e.code === "not_draft");
  const bare = mk("z", 1, "draft", { sourceRef: "" });
  assert.throws(() => PCG.planApprove(bare, [bare]), e => e.code === "not_ready" && e.problems.length > 0);
});
test("review flags", () => {
  const g = mk("a", 1, "approved", { reviewDate: "2026-03-01", effectiveDate: "2026-01-01" });
  assert.equal(PCG.reviewOverdue(g, "2026-11-15"), true); assert.equal(PCG.reviewOverdue(g, "2026-02-01"), false);
  assert.equal(PCG.reviewSoon(g, "2026-02-10", 30), true); assert.equal(PCG.reviewSoon(g, "2025-12-01", 30), false);
  assert.equal(PCG.reviewOverdue(mk("a", 1, "draft", { reviewDate: "2020-01-01" }), "2026-11-15"), false, "drafts are not flagged");
  assert.equal(PCG.notYetEffective(mk("a", 1, "approved", { effectiveDate: "2030-01-01" }), "2026-11-15"), true);
});
test("search: all words must match, title and symptoms rank first, partial words work, diacritics ignored", () => {
  const list = [mk("a", 1, "approved", { title: "Alpha illness", symptoms: ["cough", "fever"], treatment: "mentions wound care" }), mk("b", 1, "approved", { title: "Wound care", symptoms: ["bleeding"], treatment: "" }), mk("c", 1, "approved", { title: "Other", symptoms: [], treatment: "", category: "emergency" })];
  assert.deepEqual(PCG.search(list, "cough").map(r => r.g.guidelineKey), ["a"]);
  assert.equal(PCG.search(list, "wound")[0].g.guidelineKey, "b", "title match outranks a treatment mention");
  assert.deepEqual(PCG.search(list, "coug fev").map(r => r.g.guidelineKey), ["a"], "partial words");
  assert.deepEqual(PCG.search(list, "cough zzz"), [], "every word must match");
  assert.equal(PCG.search(list, "").length, 3);
  assert.deepEqual(PCG.search(list, "", { category: "emergency" }).map(r => r.g.guidelineKey), ["c"]);
  assert.equal(PCG.search([mk("d", 1, "approved", { title: "Déjà" })], "deja").length, 1);
});
test("suggest: links recorded complaints to entries WITHOUT diagnosing; matches reason is reported; nothing matches by accident", () => {
  const list = [mk("a", 1, "approved", { title: "Alpha illness", symptoms: ["cough", "chest pain"] }), mk("b", 1, "approved", { title: "Bravo", symptoms: ["rash"] })];
  const r = PCG.suggest(list, { complaints: ["Persistent cough for 3 days"] });
  assert.equal(r.length, 1); assert.equal(r[0].g.guidelineKey, "a"); assert.ok(r[0].matchedOn.length);
  assert.equal(PCG.suggest(list, { complaints: ["headache"] }).length, 0);
  assert.equal(PCG.suggest(list, { complaints: ["co"] }).length, 0, "too short to match");
  assert.equal(PCG.suggest(list, {}).length, 0);
  assert.ok(!("diagnosis" in r[0]) && !("recommendation" in r[0]), "result carries no diagnosis or recommendation");
});
test("refOf keeps the exact version used by a clinical record", () => {
  const g = mk("a", 2, "approved", { source: "Src" }); const r = PCG.refOf(g);
  assert.deepEqual(Object.keys(r).sort(), ["guidelineId", "guidelineKey", "guidelineScope", "guidelineSource", "guidelineTitle", "guidelineVersion"]);
  assert.equal(r.guidelineId, "gl_a_v2"); assert.equal(r.guidelineVersion, 2);
  assert.match(PCG.refText(Object.assign(g, { scope: "facility" })), /Local facility protocol/);
});
test("deep link", () => { assert.equal(PCG.linkFor({ q: "chest pain", cat: "respiratory" }), "guidelines.html?q=chest%20pain&cat=respiratory"); assert.equal(PCG.linkFor(), "guidelines.html"); });
test("facility protocol keeps its own scope and optional link to a national entry", () => {
  const d = PCG.buildDoc({ title: "x", category: "wound", scope: "facility", basedOnKey: "kn" }); assert.equal(d.scope, "facility"); assert.equal(d.basedOnKey, "kn");
  assert.equal(PCG.buildDoc({ title: "x", category: "wound", scope: "national", basedOnKey: "kn" }).basedOnKey, null, "national entries never point at another");
});
test("edit round trip loses nothing", () => {
  const f = { title: "T", category: "wound", scope: "national", symptoms: "a, b", aliases: "z", investigations: "t1\nt2", treatment: "tt", aQuestions: "q1\nq2", wDanger: "d1", precautions: "p1", followUp: "f1", referralAdvice: "r1", investigationNotes: "n1", refWarnings: "p9", sourceTitle: "G", sourceOrg: "O", sourceEdition: "1", sourceRef: "r", jurisdiction: "U", effectiveDate: "2026-01-01", reviewDate: "2027-01-01" };
  const d1 = PCG.buildDoc(f, { key: "k", version: 1 }), d2 = PCG.buildDoc(PCG.toForm(d1), { key: "k", version: 1 }); assert.deepEqual(d2, d1);
});
test("bullets and numbering are stripped from pasted lines", () => { assert.deepEqual(PCG.lines("- one\n• two\n3. three\n\n  four  "), ["one", "two", "three", "four"]); });
test("import: valid entries become drafts; bad file, bad category and oversize are reported in plain words", () => {
  const ok = PCG.parseImport(JSON.stringify({ entries: [Object.assign({}, JSON.parse(PCG.templateJSON()).entries[0], { title: "Imp", category: "wound" })] }));
  assert.equal(ok.errors.length, 0); assert.equal(ok.items.length, 1); assert.equal(ok.items[0]._notReady > 0, true, "template dates/source are blank so it still needs completing");
  assert.match(PCG.parseImport("nope").errors[0], /not a valid JSON/);
  assert.match(PCG.parseImport("{}").errors[0], /entries/);
  assert.match(PCG.parseImport(JSON.stringify([{ title: "x", category: "bad" }])).errors[0], /category/i);
  assert.match(PCG.parseImport(JSON.stringify(new Array(5).fill({ title: "x", category: "wound" })), 3).errors[0], /at most 3/);
  assert.ok(JSON.parse(PCG.templateJSON()).entries[0].title === "" , "template ships with no clinical content");
});
test("friendly errors never show raw Firebase codes", () => {
  assert.match(PCG.friendlyError({ code: "permission-denied" }), /do not have permission/);
  assert.match(PCG.friendlyError({ code: "unavailable" }), /no internet/);
  assert.match(PCG.friendlyError({ code: "invalid-argument" }), /not valid/);
  assert.doesNotMatch(PCG.friendlyError({ code: "weird-thing", message: "boom" }), /weird-thing|boom/);
  assert.match(PCG.friendlyError(PCG.PCGError("offline_approve")), /internet/);
});
test("no clinical content is shipped inside the library code", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "pc-guidelines.js"), "utf8");
  assert.doesNotMatch(src, /\b\d+\s?(mg|mcg|ml|mmHg)\b/i, "no doses or thresholds");
});
