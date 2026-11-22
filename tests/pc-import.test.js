/* Guideline import tests — run with:  node --test tests/     (Node 18+, no installs). TEST TEXT ONLY: no real clinical content is used. */
const test = require("node:test");
const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const PCI = require("../pc-import.js");

const bytes = (s) => new TextEncoder().encode(s);

test("detect: supported, pending (needs library), .doc, json and unknown types", () => {
  ["a.txt", "A.CSV", "x.html", "x.htm", "x.rtf"].forEach((n) => assert.equal(PCI.detect(n).ok, true, n));
  ["a.pdf", "a.docx", "a.xlsx", "a.xls"].forEach((n) => { const d = PCI.detect(n); assert.equal(d.ok, false); assert.equal(d.stage, "pending"); });
  const doc = PCI.detect("old.doc"); assert.equal(doc.ok, false); assert.match(doc.message, /save it as \.docx or PDF/);
  assert.equal(PCI.detect("a.json").stage, "json");
  assert.match(PCI.detect("a.exe").message, /not supported/);
  assert.match(PCI.detect("noext").message, /not supported/);
});

test("validate: empty, too big, and ok", () => {
  assert.equal(PCI.validate({ name: "a.txt", size: 0 }).ok, false);
  const big = PCI.validate({ name: "a.txt", size: 31 * 1024 * 1024 }); assert.equal(big.ok, false); assert.match(big.message, /limit is 30 MB/);
  assert.equal(PCI.validate({ name: "a.txt", size: 30 * 1024 * 1024 }).ok, true);
  assert.equal(PCI.validate(null).ok, false);
});

test("sha256: plain implementation matches Node crypto at the padding boundaries, and sha256Hex agrees", async () => {
  for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000]) {
    const u = new Uint8Array(n).map((_, i) => (i * 7 + 3) & 255);
    assert.equal(PCI.sha256Plain(u), nodeCrypto.createHash("sha256").update(u).digest("hex"), "length " + n);
  }
  const u = bytes("abc"); assert.equal(await PCI.sha256Hex(u), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(await PCI.sha256Hex(u.buffer), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("decodeText: UTF-8, BOM, UTF-16, and a Windows-1252 fallback that says so", () => {
  assert.equal(PCI.decodeText(bytes("café")).text, "café");
  assert.equal(PCI.decodeText(new Uint8Array([0xEF, 0xBB, 0xBF, 0x61])).text, "a");
  const u16 = new Uint8Array([0xFF, 0xFE, 0x61, 0x00, 0xE9, 0x00]); assert.equal(PCI.decodeText(u16).text, "aé");
  const w = PCI.decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xE9])); assert.equal(w.text, "café"); assert.equal(w.encoding, "windows-1252"); assert.match(w.warning, /Windows-1252/);
});

test("txt: paragraphs, only # and CHAPTER-style headings are recognised, and no-heading files get a warning", () => {
  const r = PCI.parseTxt("CHAPTER 1: Alpha\nintro line\n\n# Beta part\n\nFirst para\nsecond line\n\n\n\nLast");
  assert.deepEqual(r.blocks.map((b) => b.kind + ":" + (b.level || "") + ":" + b.text), ["heading:1:CHAPTER 1: Alpha", "paragraph::intro line", "heading:1:Beta part", "paragraph::First para\nsecond line", "paragraph::Last"]);
  assert.equal(r.warnings.length, 0);
  const n = PCI.parseTxt("just text\n\nmore"); assert.equal(n.blocks.length, 2); assert.match(n.warnings[0], /No headings/);
  assert.equal(PCI.parseTxt("This is a long title line that is NOT a heading").blocks[0].kind, "paragraph");
});

test("csv: quotes, doubled quotes, line breaks inside quotes, CRLF, delimiters, ragged rows, unclosed quote", () => {
  const r = PCI.parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"two\nlines",3\r\n');
  assert.deepEqual(r.blocks[0].rows, [["a", "b", "c"], ["1", "x, y", 'say "hi"'], ["2", "two\nlines".replace("\n", "\n"), "3"]].map((row) => row.map((c) => c.replace(/ *\n */g, "\n"))));
  assert.equal(PCI.parseCsv("a;b\n1;2").delimiter, ";");
  assert.equal(PCI.parseCsv("a\tb\n1\t2").delimiter, "tab");
  const rag = PCI.parseCsv("a,b,c\n1,2\n"); assert.deepEqual(rag.blocks[0].rows[1], ["1", "2", ""]); assert.match(rag.warnings[0], /different number of columns/);
  assert.match(PCI.parseCsv('a,b\n"open,1').warnings[0], /never closed/);
  const e = PCI.parseCsv("\n\n"); assert.equal(e.blocks.length, 0);
  assert.equal(PCI.parseCsv("a,b\n,\n1,2").blocks[0].rows.length, 2, "fully empty rows are dropped");
});

test("html: headings, paragraphs, lists, entities, scripts/styles/comments dropped, tables with header", () => {
  const h = "<html><head><title>T</title><style>p{}</style></head><body><!-- c --><h1>Main &amp; more</h1><p>Hello&nbsp;world &lt;3 &#233; &#x41;</p><script>var a='<p>no</p>';</script><h2>Sub</h2><ul><li>one</li><li>two</li></ul><table><tr><th>Name</th><th>Dose</th></tr><tr><td>A</td><td>5 mg</td></tr><tr><td>B<br>x</td><td>&deg;C</td></tr></table><p>After</p></body></html>";
  const r = PCI.parseHtml(h);
  const k = r.blocks.map((b) => b.kind + ":" + (b.text || JSON.stringify(b.rows)));
  assert.deepEqual(k, ["heading:Main & more", "paragraph:Hello world <3 é A", "heading:Sub", "paragraph:• one", "paragraph:• two", 'table:[["Name","Dose"],["A","5 mg"],["B x","°C"]]', "paragraph:After"]);
  assert.equal(r.blocks[5].header, true);
  assert.equal(PCI.parseHtml("<p>x</p>").blocks.length, 1);
  assert.match(PCI.parseHtml("<script>a</script>").warnings[0], /No readable text/);
  assert.equal(PCI.decodeEntities("&unknown; &amp;amp;"), "&unknown; &amp;");
});

test("html: unclosed tags and stray < do not lose text", () => {
  const r = PCI.parseHtml("<p>a < b and <b>bold</b> text<p>second");
  assert.equal(r.blocks.map((b) => b.text).join("|"), "a < b and bold text|second");
});

test("rtf: text, paragraphs, \\'hh, \\u with skip, escapes, skipped destinations, simple table", () => {
  const rtf = "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red0\\green0\\blue0;}{\\*\\generator Test;}\\pard Hello caf\\'e9\\par Next \\u8364?\\u233? \\{ok\\}\\par \\trowd\\intbl A\\cell B\\cell\\row \\intbl C\\cell D\\cell\\row \\pard After\\par}";
  const r = PCI.parseRtf(rtf);
  const k = r.blocks.map((b) => b.kind + ":" + (b.text || JSON.stringify(b.rows)));
  assert.deepEqual(k, ["paragraph:Hello café", "paragraph:Next €é {ok}", 'table:[["A","B"],["C","D"]]', "paragraph:After"]);
  assert.match(PCI.parseRtf("not rtf").warnings[0], /does not look like an RTF/);
  assert.match(PCI.parseRtf("{\\rtf1 {\\pict\\wmetafile8 abcdef}}").warnings.join(" "), /Pictures/);
});

test("extract: routes by extension, refuses pending types, reports empty files", () => {
  assert.equal(PCI.extract("a.pdf", bytes("%PDF")).ok, false);
  assert.match(PCI.extract("a.pdf", bytes("%PDF")).error, /import tools/);
  assert.equal(PCI.extract("a.txt", bytes("# H\n\nbody")).ok, true);
  const e = PCI.extract("a.txt", bytes("   \n\n  ")); assert.equal(e.ok, false);
  const c = PCI.extract("a.csv", bytes("a,b\n1,2")); assert.equal(c.method, "table_sheet"); assert.equal(c.stats.tableRows, 2);
  assert.equal(PCI.extract("a.html", bytes("<h1>x</h1><p>y</p>")).stats.headings, 1);
  assert.equal(PCI.extract("a.rtf", bytes("{\\rtf1 hi}")).ok, true);
});

test("toSections: headings make paths, runs are joined, long text is split under the cap, nothing is lost", () => {
  const blocks = [{ kind: "heading", level: 1, text: "A" }, { kind: "paragraph", text: "p1" }, { kind: "paragraph", text: "p2" }, { kind: "heading", level: 2, text: "A1" }, { kind: "paragraph", text: "p3" }, { kind: "heading", level: 1, text: "B" }, { kind: "paragraph", text: "p4" }];
  const s = PCI.toSections(blocks);
  assert.deepEqual(s.map((x) => x.headingPath.join(">") + "|" + x.text.replace(/\n/g, "/")), ["A|p1//p2", "A>A1|p3", "B|p4"]);
  assert.deepEqual(s.map((x) => x.seq), [1, 2, 3]);
  assert.ok(s.every((x) => x.reviewStatus === "unreviewed" && x.ocr === false && x.pageFrom === null));
  const long = []; for (let i = 0; i < 50; i++) long.push({ kind: "paragraph", text: ("word" + i + " ").repeat(60).trim() });
  const parts = PCI.toSections(long, { maxChars: 5000 });
  assert.ok(parts.length > 1 && parts.every((x) => x.text.length <= 5000));
  const norm = (t) => t.replace(/\s+/g, " ").trim();
  assert.equal(norm(parts.map((x) => x.text).join(" ")), norm(long.map((x) => x.text).join(" ")), "no text lost when splitting");
  const huge = PCI.toSections([{ kind: "paragraph", text: "x".repeat(250000) }]); assert.ok(huge.every((x) => x.text.length <= 100000)); assert.equal(huge.reduce((m, x) => m + x.text.length, 0), 250000);
});

test("toSections: tables become their own sections, header repeated, rows as maps (no nested arrays)", () => {
  const rows = [["H1", "H2"]]; for (let i = 0; i < 450; i++) rows.push(["r" + i, "v" + i]);
  const s = PCI.toSections([{ kind: "heading", level: 1, text: "T" }, { kind: "table", header: true, rows }]);
  assert.equal(s.length, 3); assert.ok(s.every((x) => x.kind === "table" && x.headingPath[0] === "T"));
  assert.ok(s.every((x) => x.tableRows[0].cells.join() === "H1,H2" && x.tableRows.length <= PCI.MAX_TABLE_ROWS_PER_SECTION));
  assert.ok(s.every((x) => x.tableRows.every((r) => !Array.isArray(r) && Array.isArray(r.cells))));
  assert.equal(s.reduce((m, x) => m + x.tableRows.length - 1, 0), 450);
  const noHead = PCI.toSections([{ kind: "table", header: false, rows: [["a", "b"]] }]); assert.equal(noHead[0].tableRows.length, 1);
});

test("summary: warns above 1000 section documents", () => {
  assert.equal(PCI.summary(new Array(1000).fill({ text: "x" })).overWarn, false);
  const s = PCI.summary(new Array(1001).fill({ text: "xy" })); assert.equal(s.overWarn, true); assert.equal(s.chars, 2002); assert.match(s.message, /1001/);
});

test("toSections: a heading repeated on every page (running header) does not split the text", () => {
  const b = []; for (let i = 0; i < 5; i++) { b.push({ kind: "heading", level: 1, text: "CHAPTER 1: Test" }); b.push({ kind: "paragraph", text: "page " + i }); }
  const s = PCI.toSections(b); assert.equal(s.length, 1); assert.equal(s[0].text, "page 0\n\npage 1\n\npage 2\n\npage 3\n\npage 4");
  const s2 = PCI.toSections([{ kind: "heading", level: 1, text: "A" }, { kind: "paragraph", text: "x" }, { kind: "heading", level: 1, text: "B" }, { kind: "paragraph", text: "y" }, { kind: "heading", level: 1, text: "A" }, { kind: "paragraph", text: "z" }]);
  assert.equal(s2.length, 3, "a different heading in between still starts a new section");
});
