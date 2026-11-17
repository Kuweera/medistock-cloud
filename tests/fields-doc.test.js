/* Developer 3: keeps docs/FIELD_EXPLANATIONS.md honest. Every plainly labelled form field in the nine patient-care pages
   must be named in the document. Labels built in code (containing quotes or +) are skipped here and are covered by the generator. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, ".."), doc = fs.readFileSync(path.join(root, "docs/FIELD_EXPLANATIONS.md"), "utf8");
const pages = ["patients", "patient", "encounters", "encounter", "investigations", "laboratory", "treatment", "dosing-rules", "users"];
const norm = s => s.replace(/\*/g, "").replace(/\s+/g, " ").trim();
for (const pg of pages) {
  test(pg + ": every labelled field is explained in FIELD_EXPLANATIONS.md", () => {
    const html = fs.readFileSync(path.join(root, pg + ".html"), "utf8").replace(/\\"/g, '"');
    const missing = [];
    for (const m of html.matchAll(/<label[^>]*>([^<]*)<\/label>\s*(?:<div class="dateField">)?\s*<(?:input|select|textarea)\b/g)) {
      const lab = norm(m[1]); if (!lab || /['"+]/.test(lab)) continue;
      if (!doc.includes("| " + lab + " |")) missing.push(lab);
    }
    assert.deepEqual(missing, [], "Add these to the explanation document: " + missing.join("; "));
  });
}
test("no explanation is missing", () => assert.ok(!/\(explanation missing\)/.test(doc)));
