/* PDF layout logic tests (no pdf.js needed: pages are built by hand) — run with:  node --test tests/     TEST TEXT ONLY: no real clinical content. */
const test = require("node:test");
const assert = require("node:assert/strict");
const PDF = require("../pc-import-pdf.js");

const W = 354, H = 500, BODY = 10;
// line spec: [y, text] or [y, text, height] or [y, [[x,text],[x,text]], height]; a text beginning "~HY~" marks a standalone hyphen item appended at the end of the line
function page(n, specs) {
  const items = [];
  specs.forEach(([y, t, h]) => {
    h = h || BODY;
    if (Array.isArray(t)) t.forEach(([x, s]) => items.push({ str: s, x, y, w: s.length * h * 0.5, h }));
    else { let text = t, soft = false; if (text.endsWith("~HY~")) { soft = true; text = text.slice(0, -4); } items.push({ str: text, x: 34, y, w: text.length * h * 0.5, h }); if (soft) items.push({ str: "-", x: 34 + text.length * h * 0.5, y, w: 3, h }); }
  });
  return { page: n, width: W, height: H, items };
}
const body = (n, extra) => page(n, [[480, "Test Running Header 2023", 7], [20, String(n), 9]].concat(extra));
const texts = (r) => r.blocks.map((b) => b.kind + ":" + (b.text || JSON.stringify(b.rows)));

test("paragraphs: line pitch groups lines, a bigger gap starts a new paragraph, bullets start their own", () => {
  const pages = [1, 2, 3, 4].map((n) => body(n, [[440, "First line of paragraph one"], [428, "second line of paragraph one."], [411, "A new paragraph after a gap."], [399, "• Bullet one text"], [387, "• Bullet two text"]]));
  const r = PDF.buildPdfBlocks(pages);
  assert.deepEqual(texts(r).slice(0, 4), ["paragraph:First line of paragraph one second line of paragraph one.", "paragraph:A new paragraph after a gap.", "paragraph:• Bullet one text", "paragraph:• Bullet two text"]);
  assert.deepEqual([r.blocks[0].page, r.blocks[0].pageTo], [1, undefined]);
});

test("headers, footers and page numbers repeated on most pages are removed and counted; the text is kept", () => {
  const pages = [1, 2, 3, 4, 5].map((n) => body(n, [[440, "Real content line " + n]]));
  pages.push(page(6, [[20, "vi", 9], [440, "Real content line 6"]]));
  const r = PDF.buildPdfBlocks(pages);
  assert.equal(r.blocks.length, 6); assert.ok(r.blocks.every((b) => /^Real content line \d$/.test(b.text)));
  assert.equal(r.stats.headerFooterLines, 5); assert.equal(r.stats.pageNumbersRemoved, 6); assert.deepEqual(r.stats.headerExamples, ["Test Running Header 2023"]);
  assert.ok(r.warnings.some((w) => /Removed 5 repeated header\/footer lines and 6 page numbers/.test(w)));
});

test("edge text that is NOT repeated is kept as content (not every top or bottom line is a header)", () => {
  const pages = [1, 2, 3, 4].map((n) => page(n, [[440, "Content " + n]]));
  pages[1].items.push({ str: "Unique note near the bottom", x: 34, y: 25, w: 100, h: 10 });
  const r = PDF.buildPdfBlocks(pages); assert.ok(r.blocks.some((b) => /Unique note near the bottom/.test(b.text)));
  const short = PDF.buildPdfBlocks([body(1, [[440, "a"]]), body(2, [[440, "b"]])]); assert.ok(short.blocks.some((b) => /Test Running Header/.test(b.text)), "under 4 pages nothing is guessed as a header");
});

test("a running CHAPTER header becomes a heading on its page; repeats are merged by toSections", () => {
  const PCI = require("../pc-import.js");
  const mk = (n, ch) => page(n, [[480, "CHAPTER " + ch + ": Test chapter " + ch, 7], [20, String(n), 9], [440, "Text of page " + n]]);
  const r = PDF.buildPdfBlocks([mk(1, 1), mk(2, 1), mk(3, 1), mk(4, 2), mk(5, 2)]);
  assert.equal(r.blocks.filter((b) => b.kind === "heading").length, 5);
  const secs = PCI.toSections(r.blocks); assert.deepEqual(secs.map((s) => s.headingPath[0] + "|" + s.pageFrom + "-" + s.pageTo), ["CHAPTER 1: Test chapter 1|1-3", "CHAPTER 2: Test chapter 2|4-5"]);
});

test("headings come from larger text; consecutive heading lines of the same size are merged; levels follow size", () => {
  const pages = [1, 2, 3, 4].map((n) => page(n, [[440, "Big heading", 18], [425, "second half", 18], [400, "Sub heading", 14], [380, "Body text line one"], [368, "Body text line two"]]));
  const r = PDF.buildPdfBlocks(pages);
  assert.deepEqual(r.blocks.slice(0, 3).map((b) => b.kind + ":" + (b.level || "") + ":" + b.text), ["heading:1:Big heading second half", "heading:2:Sub heading", "paragraph::Body text line one Body text line two"]);
  assert.ok(r.warnings.some((w) => /guessed from text size/.test(w)));
});

test("a separate hyphen item at the end of a line is a layout hyphen and the word is rejoined; a hyphen inside the text is kept", () => {
  const pages = [1, 2, 3, 4].map((n) => page(n, [[440, "The burden of morb~HY~"], [428, "idity is high and non-"], [416, "communicable disease also."]]));
  const r = PDF.buildPdfBlocks(pages);
  assert.equal(r.blocks[0].text, "The burden of morbidity is high and non-communicable disease also.");
  assert.equal(r.stats.softHyphens, 4);
  const real = PDF.buildPdfBlocks([1, 2, 3, 4].map((n) => page(n, [[440, "Give co-"], [428, "trimoxazole as prescribed."]])));
  assert.equal(real.blocks[0].text, "Give co-trimoxazole as prescribed.", "a real hyphen is never removed");
});

test("a paragraph that continues on the next page is joined and keeps both page numbers; a finished sentence is not", () => {
  const a = PDF.buildPdfBlocks([page(1, [[440, "A sentence that does not finish"]]), page(2, [[440, "and carries on here."], [411, "Next one."]]), page(3, [[440, "x line"], [428, "y line"]]), page(4, [[440, "z line"], [428, "w line"]])]);
  assert.equal(a.blocks[0].text, "A sentence that does not finish and carries on here."); assert.deepEqual([a.blocks[0].page, a.blocks[0].pageTo], [1, 2]);
  const b = PDF.buildPdfBlocks([page(1, [[440, "A finished sentence."]]), page(2, [[440, "and starts lowercase."]]), page(3, [[440, "x line"], [428, "y line"]]), page(4, [[440, "z line"], [428, "w line"]])]);
  assert.equal(b.blocks[0].text, "A finished sentence.");
});

test("tables: aligned columns become a table block with the page; wrapped cell text joins the right cell; a warning says to check the original", () => {
  const p = (n) => page(n, [[440, "Intro text line"], [415, [[36, "Drug"], [140, "Note"]]], [403, [[36, "Alpha"], [140, "first note"]]], [391, [[140, "wrapped part"]]], [379, [[36, "Beta"], [140, "second note"]]], [350, "Text after the table"]]);
  const r = PDF.buildPdfBlocks([p(1), p(2), p(3), p(4)]);
  const t = r.blocks.find((b) => b.kind === "table");
  assert.deepEqual(t.rows, [["Drug", "Note"], ["Alpha", "first note wrapped part"], ["Beta", "second note"]]); assert.equal(t.page, 1); assert.equal(t.layout, true);
  assert.equal(r.stats.tables, 4); assert.ok(r.warnings.some((w) => /Compare each one with the original page/.test(w)));
  const after = r.blocks[r.blocks.indexOf(t) + 1]; assert.equal(after.text, "Text after the table");
});

test("tables: misaligned or single multi-cell lines are NOT turned into a table (kept as text)", () => {
  const one = PDF.buildPdfBlocks([1, 2, 3, 4].map((n) => page(n, [[440, [[36, "Left"], [200, "Right"]]], [428, "Just text"]])));
  assert.equal(one.stats.tables, 0);
  const off = PDF.buildPdfBlocks([1, 2, 3, 4].map((n) => page(n, [[440, [[36, "A"], [140, "B"]]], [428, [[36, "C"], [190, "D"]]]])));
  assert.equal(off.stats.tables, 0); assert.ok(off.blocks.every((b) => b.kind === "paragraph"));
  const no = PDF.buildPdfBlocks([1, 2, 3, 4].map((n) => page(n, [[440, [[36, "A"], [140, "B"]]], [428, [[36, "C"], [140, "D"]]]])), { detectTables: false }); assert.equal(no.stats.tables, 0);
});

test("pages with no readable text are listed (possible scans); a PDF with none at all says it is probably scanned", () => {
  const r = PDF.buildPdfBlocks([page(1, [[440, "Some text on the first page"]]), page(2, []), page(3, []), page(4, [[440, "More text here today"]]), page(5, [])]);
  assert.deepEqual(r.stats.emptyPages, [2, 3, 5]); assert.ok(r.warnings.some((w) => /pages 2–3, 5/.test(w) || /pages 2, 3, 5|pages 2–3, 5/.test(w)));
  const none = PDF.buildPdfBlocks([page(1, []), page(2, [])]); assert.equal(none.blocks.length, 0); assert.ok(none.warnings.some((w) => /probably scanned/.test(w)));
});

test("listPages formats ranges", () => { assert.equal(PDF.listPages([5, 1, 2, 3, 9]), "1–3, 5, 9"); assert.equal(PDF.listPages([1, 2]), "1, 2"); });

test("heading levels follow text size (up to 6); a lone chapter number is joined with the title next to it", () => {
  const mk = (n) => page(n, [[440, "Emergencies and Trauma", 15], [418, "1", 50], [380, "1.1 Common problems", 12], [350, "Body text line one"], [338, "Body text line two"]]);
  const r = PDF.buildPdfBlocks([mk(1), mk(2), mk(3), mk(4)]);
  assert.deepEqual(r.blocks.slice(0, 2).map((b) => b.kind + ":" + b.level + ":" + b.text), ["heading:1:1 Emergencies and Trauma", "heading:3:1.1 Common problems"]);
  assert.equal(r.blocks[2].kind, "paragraph");
});

test("lines of small text directly under a big title are not merged into the title line", () => {
  const r = PDF.buildPdfBlocks([page(1, [[347, "THE REPUBLIC OF UGANDA", 8], [336, "MINISTRY OF HEALTH", 8], [262, "Title big", 45], [220, "More big", 45], [100, "Subtitle text", 15]]), page(2, [[440, "a line"], [428, "b line"]]), page(3, [[440, "c line"], [428, "d line"]]), page(4, [[440, "e line"], [428, "f line"]])]);
  const txt = r.blocks.slice(0, 4).map((b) => b.text);
  assert.ok(txt.some((t) => /THE REPUBLIC OF UGANDA/.test(t)) && !txt.some((t) => /UGANDAMINISTRY/.test(t)), txt.join(" | "));
});

test("tables: a lower-case first cell carries on the previous row; an indented line under a column joins that column", () => {
  const p = (n) => page(n, [[440, "Intro"], [415, [[36, "Drug"], [140, "Note"]]], [403, [[36, "Visual"], [140, "Ethambutol stop"]]], [391, [[36, "impairment"], [140, "alternative"]]], [379, [[150, "indented wrap"]]], [367, [[36, "Next"], [140, "row two"]]]]);
  const t = PDF.buildPdfBlocks([p(1), p(2), p(3), p(4)]).blocks.find((b) => b.kind === "table");
  assert.deepEqual(t.rows, [["Drug", "Note"], ["Visual impairment", "Ethambutol stop alternative indented wrap"], ["Next", "row two"]]);
});

test("a two-line chapter title around a big chapter number becomes one heading", () => {
  const mk = (n) => ({ page: n, width: 354, height: 500, items: [{ str: "Gastrointestinal and", x: 34, y: 440, w: 150, h: 15 }, { str: "6", x: 48, y: 418, w: 30, h: 50 }, { str: "Hepatic Diseases", x: 71, y: 404, w: 100, h: 15 }, { str: "Body text line one", x: 34, y: 300, w: 90, h: 10 }, { str: "Body text line two", x: 34, y: 288, w: 90, h: 10 }] });
  const r = PDF.buildPdfBlocks([1, 2, 3, 4].map(mk));
  assert.equal(r.blocks[0].text, "6 Gastrointestinal and Hepatic Diseases"); assert.equal(r.blocks[0].level, 1);
});

test("a big number and the text beside it on the same line keep a space between them", () => {
  const mk = (n) => ({ page: n, width: 354, height: 500, items: [{ str: "10", x: 48, y: 418, w: 40, h: 50 }, { str: "Joint Diseases", x: 90, y: 418, w: 100, h: 15 }, { str: "Body text line one", x: 34, y: 300, w: 90, h: 10 }, { str: "Body text line two", x: 34, y: 288, w: 90, h: 10 }] });
  assert.equal(PDF.buildPdfBlocks([1, 2, 3, 4].map(mk)).blocks[0].text, "10 Joint Diseases");
});
