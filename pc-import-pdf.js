/* MediStock Cloud — PDF layout logic for guideline import (Developer 4, Stage 2).
   Pure functions: no pdf.js, no page, no database. Input is what pdf.js reports for each page (text pieces with positions);
   output is blocks { kind: heading | paragraph | table, text / rows, page } for pc-import.js toSections().

   Everything here is a layout HEURISTIC to make the text readable for a reviewer. It never decides what is clinically correct.
   The preview and the warnings say what was guessed, and every section keeps its page numbers so the reviewer can check the original.

   Page in:  { page, width, height, items: [ { str, x, y, w, h } ] }   (y grows upward, as in PDF; h = text height) */
(function (root) {
  "use strict";

  var BULLET = /^([•▪◦‣·●○■\u2022\u25AA\u25CF]\s?|\d{1,3}[.)]\s|[a-zA-Z][.)]\s|[-–—]\s)/;
  var CHAPTER_HEADER = /^(CHAPTER|PART|SECTION|APPENDIX|ANNEX)\b/i;
  var EDGE_FRACTION = 0.075;           // top / bottom 7.5% of the page height is the header / footer zone

  function median(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function norm(t) { return String(t).toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim(); }

  // ---------------------------------------------------------------- items -> lines
  /* buildLines(page) -> [ { y, h, x0, cells:[{x,x1,text}], text, soft, pageEdge } ], top of page first */
  function buildLines(pg) {
    var items = (pg.items || []).filter(function (it) { return it && typeof it.str === "string" && (it.str.length > 0) && isFinite(it.x) && isFinite(it.y); });
    var real = items.filter(function (it) { return it.str.trim() !== ""; });
    if (!real.length) return [];
    items.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var rows = [];
    items.forEach(function (it) {
      var r = rows[rows.length - 1], ih = it.h > 0 ? it.h : (r ? r.h : 8);
      // the tolerance follows the size of the text itself, so lines of small text under a big title are not merged into it
      if (r && Math.abs(r.y - it.y) <= Math.max(1.5, Math.min(ih, r.h) * 0.45)) { r.items.push(it); if (it.h > 0) r.h = Math.max(r.h, it.h); } else rows.push({ y: it.y, h: it.h > 0 ? it.h : 8, items: [it] });
    });
    var lines = [];
    rows.forEach(function (r) {
      var its = r.items.slice().sort(function (a, b) { return a.x - b.x; });
      var hh = Math.max.apply(null, its.map(function (i) { return i.str.trim() ? (i.h > 0 ? i.h : 0) : 0; }).concat([0]));
      if (!its.some(function (i) { return i.str.trim() !== ""; })) return;
      var gapCell = Math.max(14, (hh || 9) * 2.2), cells = [], cur = null, prevEnd = null, prevH = 0, soft = false, last = its.length - 1;
      while (last > 0 && its[last].str.trim() === "") last--;
      // a separate "-" item at the very end of the line is a line-break hyphen added by the page layout (not part of the word)
      if (its.length > 1 && its[last].str === "-" && its[last - 1] && its[last - 1].str.trim() !== "") { soft = true; its = its.slice(0, last).concat(its.slice(last + 1)); }
      its.forEach(function (it) {
        if (it.str.trim() === "") return;   /* a blank item can span a wide gap (a tab or a column space); the gap is measured between real text instead */
        var w = it.w > 0 ? it.w : it.str.length * (it.h || 8) * 0.5, gap = prevEnd === null ? 0 : it.x - prevEnd;
        if (cur && it.str.trim() !== "" && gap > gapCell) { cells.push(cur); cur = null; }
        if (!cur) { if (it.str.trim() === "") return; cur = { x: it.x, x1: it.x + w, text: it.str }; }
        else { var ref = Math.min(prevH > 0 ? prevH : (hh || 8), it.h > 0 ? it.h : (hh || 8)), big = prevH > 0 && it.h > 0 && Math.max(prevH, it.h) / Math.min(prevH, it.h) >= 1.8, needSpace = (gap > ref * 0.18 || big) && !/\s$/.test(cur.text) && !/^\s/.test(it.str); cur.text += (needSpace ? " " : "") + it.str; cur.x1 = it.x + w; }
        prevEnd = it.x + w; if (it.str.trim() && it.h > 0) prevH = it.h;
      });
      if (cur) cells.push(cur);
      cells = cells.map(function (c) { c.text = c.text.replace(/\s+/g, " ").trim(); return c; }).filter(function (c) { return c.text !== ""; });
      if (!cells.length) return;
      lines.push({ y: r.y, h: hh, x0: cells[0].x, cells: cells, text: cells.map(function (c) { return c.text; }).join("\t"), soft: soft });
    });
    return lines;
  }

  // ---------------------------------------------------------------- headers, footers and page numbers
  function edgeZone(pg, y) { var H = pg.height || 0; if (!H) return ""; if (y >= H * (1 - EDGE_FRACTION)) return "top"; if (y <= H * EDGE_FRACTION) return "bottom"; return ""; }
  function isPageNumber(t) { return /^(\d{1,4}|[ivxlcdm]{1,8}|page\s+\d+(\s+of\s+\d+)?|-\s?\d+\s?-)$/i.test(t.trim()); }

  /* findRepeated(pagesLines, pages) -> Set of normalised edge-line keys that repeat on many pages */
  function findRepeated(pagesLines, pages) {
    var count = {}, withText = 0;
    pagesLines.forEach(function (lines, i) { if (lines.length) withText++; var seen = {}; lines.forEach(function (ln) { if (!edgeZone(pages[i], ln.y)) return; var k = norm(ln.text); if (!k || seen[k]) return; seen[k] = 1; count[k] = (count[k] || 0) + 1; }); });
    var need = Math.max(3, Math.ceil(withText * 0.25)), rep = {};
    if (withText < 4) return rep;
    Object.keys(count).forEach(function (k) { if (count[k] >= need) rep[k] = count[k]; });
    return rep;
  }

  // ---------------------------------------------------------------- tables (from text positions; flagged for review)
  function near(a, b, t) { return Math.abs(a - b) <= t; }
  /* tryTable(lines, startIdx, pitch) -> { rows, end } | null.   A table needs at least 2 lines with 2+ cells whose cell starts line up in 2+ columns. */
  function tryTable(lines, s, pitch) {
    if (lines[s].cells.length < 2) return null;
    var cols = lines[s].cells.map(function (c) { return c.x; }), rows = [], i = s, multi = 0;
    function colOf(x) { for (var k = 0; k < cols.length; k++) if (near(cols[k], x, 4)) return k; return -1; }
    function colAtOrBefore(x) { var k = -1; for (var j = 0; j < cols.length; j++) if (cols[j] <= x + 4) k = j; return k; }
    while (i < lines.length) {
      var ln = lines[i];
      if (i > s && lines[i - 1].y - ln.y > pitch * 2.4) break;
      if (ln.cells.length >= 2) {
        var idx = ln.cells.map(function (c) { return colOf(c.x); });
        if (idx.some(function (k) { return k < 0; })) break;
        var wrapped = rows.length && idx[0] === 0 && /^[a-z]/.test(ln.cells[0].text);   // starts in lower case: the previous row's text carries on
        if (wrapped) { var lr = rows[rows.length - 1]; ln.cells.forEach(function (c, j) { lr[idx[j]] = (lr[idx[j]] ? lr[idx[j]] + " " : "") + c.text; }); }
        else { var row = new Array(cols.length).fill(""); ln.cells.forEach(function (c, j) { row[idx[j]] = c.text; }); rows.push(row); multi++; }
      } else {
        var k = colAtOrBefore(ln.cells[0].x); if (k < 0 || !rows.length) break;
        var lastRow = rows[rows.length - 1]; lastRow[k] = (lastRow[k] ? lastRow[k] + " " : "") + ln.cells[0].text;   // an indented or bulleted line under a column belongs to that column
      }
      i++;
    }
    return multi >= 2 && cols.length >= 2 ? { rows: rows, end: i, cols: cols.length } : null;
  }

  // ---------------------------------------------------------------- main
  /* buildPdfBlocks(pages, opts) -> { blocks, warnings, stats } */
  function buildPdfBlocks(pages, opts) {
    opts = opts || {};
    var warnings = [], stats = { pages: pages.length, textPages: 0, emptyPages: [], headerFooterLines: 0, headerExamples: [], pageNumbersRemoved: 0, softHyphens: 0, tables: 0, tablePages: [], headings: 0 };
    var pagesLines = pages.map(buildLines), repeated = findRepeated(pagesLines, pages);

    // 1. remove headers, footers and page numbers; remember running chapter headers
    var kept = [], ctxHead = [], exs = {};
    pagesLines.forEach(function (lines, i) {
      var pg = pages[i], body = [], ctx = "";
      lines.forEach(function (ln) {
        var z = edgeZone(pg, ln.y);
        if (z && isPageNumber(ln.text)) { stats.pageNumbersRemoved++; return; }
        if (z && repeated[norm(ln.text)]) {
          stats.headerFooterLines++; if (CHAPTER_HEADER.test(ln.text) && z === "top") ctx = ln.text; exs[norm(ln.text)] = ln.text; return;
        }
        if (z && CHAPTER_HEADER.test(ln.text) && opts.keepChapterHeaders !== false) { ctx = ln.text; return; }
        body.push(ln);
      });
      kept.push(body); ctxHead.push(ctx);
      var chars = body.reduce(function (m, l) { return m + l.text.length; }, 0);
      if (chars >= 20) stats.textPages++; else stats.emptyPages.push(pg.page);
    });
    stats.headerExamples = Object.keys(exs).slice(0, 4).map(function (k) { return exs[k]; });

    // 2. body text size and line pitch
    var hist = {}, pitches = [];
    kept.forEach(function (lines) {
      lines.forEach(function (l, j) { if (l.h > 0) { var k = Math.round(l.h * 2) / 2; hist[k] = (hist[k] || 0) + l.text.length; } if (j > 0) { var d = lines[j - 1].y - l.y; if (d > 0 && lines[j - 1].h > 0 && Math.abs(lines[j - 1].h - l.h) < 0.6) pitches.push(d); } });
    });
    var bodyH = 0, best = -1; Object.keys(hist).forEach(function (k) { if (hist[k] > best) { best = hist[k]; bodyH = Number(k); } });
    var pitch = median(pitches) || (bodyH ? bodyH * 1.25 : 12);
    var hsizes = {};
    kept.forEach(function (lines) { lines.forEach(function (l) { if (bodyH && l.h >= bodyH * 1.2 && l.cells.length === 1 && l.text.length <= 160) hsizes[Math.round(l.h * 2) / 2] = 1; }); });
    var order = Object.keys(hsizes).map(Number).sort(function (a, b) { return b - a; });
    function levelOf(h) { var r = order.indexOf(Math.round(h * 2) / 2); return Math.min(6, (r < 0 ? order.length : r) + 1); }

    // 3. blocks, page by page
    var blocks = [], para = null;
    function endPara() { if (para) { para.text = para.parts.reduce(function (acc, p, idx) { if (!idx) return p.text; return acc + (p.joinNoSpace ? "" : " ") + p.text; }, "").replace(/\s+/g, " ").trim(); var b = { kind: "paragraph", text: para.text, page: para.page }; if (para.pageTo > para.page) b.pageTo = para.pageTo; if (b.text) blocks.push(b); para = null; } }
    var prevEnded = true;
    pages.forEach(function (pg, i) {
      var lines = kept[i], ctx = ctxHead[i];
      if (ctx) { endPara(); blocks.push({ kind: "heading", level: 1, text: ctx.replace(/\s+/g, " ").trim(), page: pg.page }); }
      var j = 0, firstOnPage = true;
      while (j < lines.length) {
        var ln = lines[j];
        // table?
        if (opts.detectTables !== false && ln.cells.length >= 2) {
          var t = tryTable(lines, j, pitch);
          if (t) { endPara(); blocks.push({ kind: "table", rows: t.rows, header: false, page: pg.page, layout: true }); stats.tables++; if (stats.tablePages.indexOf(pg.page) < 0) stats.tablePages.push(pg.page); j = t.end; firstOnPage = false; continue; }
        }
        // heading? (merge following lines of the same size)
        if (bodyH && ln.h >= bodyH * 1.2 && ln.cells.length === 1 && ln.text.length <= 160) {
          var txt = ln.text, k = j + 1; while (k < lines.length && lines[k].cells.length === 1 && Math.abs(lines[k].h - ln.h) < 0.6 && lines[k - 1].y - lines[k].y <= ln.h * 2.2 && (txt + " " + lines[k].text).length <= 200) { txt += " " + lines[k].text; k++; }
          endPara(); blocks.push({ kind: "heading", level: levelOf(ln.h), text: txt, page: pg.page }); stats.headings++; j = k; firstOnPage = false; continue;
        }
        var text = ln.cells.map(function (c) { return c.text; }).join(" ");
        var gapUp = j > 0 ? lines[j - 1].y - ln.y : 0, startsItem = BULLET.test(text);
        var newPara = !para || startsItem || (j > 0 && gapUp > pitch * 1.25 && !(lines[j - 1].soft));
        if (para && firstOnPage) { // continuing across a page break?
          var prevText = para.parts[para.parts.length - 1].text; newPara = startsItem || /[.:;?!)\]"”]$/.test(prevText) || !/^[a-z(]/.test(text);
        }
        if (newPara) { endPara(); para = { parts: [], page: pg.page, pageTo: pg.page }; }
        var prev = para.parts[para.parts.length - 1], joinNoSpace = false;
        if (prev && prev.soft) { joinNoSpace = true; stats.softHyphens++; } else if (prev && /\S-$/.test(prev.text) && /^[a-z]/.test(text)) { joinNoSpace = true; }
        para.parts.push({ text: text, soft: ln.soft, joinNoSpace: joinNoSpace }); para.pageTo = pg.page;
        firstOnPage = false; j++;
      }
    });
    endPara();
    blocks = mergeNumberHeadings(blocks);
    stats.headings = blocks.filter(function (b) { return b.kind === "heading"; }).length;

    if (!stats.textPages) warnings.push("This PDF has no readable text layer on any page. It is probably scanned: use \"Read scanned pages with OCR\".");
    else if (stats.emptyPages.length) warnings.push(stats.emptyPages.length + " page" + (stats.emptyPages.length === 1 ? " has" : "s have") + " no readable text (pages " + listPages(stats.emptyPages) + "). They may be blank, or scanned images that need OCR.");
    if (stats.headerFooterLines || stats.pageNumbersRemoved) warnings.push("Removed " + stats.headerFooterLines + " repeated header/footer line" + (stats.headerFooterLines === 1 ? "" : "s") + " and " + stats.pageNumbersRemoved + " page number" + (stats.pageNumbersRemoved === 1 ? "" : "s") + (stats.headerExamples.length ? " (for example: " + stats.headerExamples.map(function (e) { return "\"" + e.slice(0, 50) + "\""; }).join(", ") + ")" : "") + ".");
    if (stats.softHyphens) warnings.push(stats.softHyphens + " word" + (stats.softHyphens === 1 ? "" : "s") + " split across lines by a separate hyphen " + (stats.softHyphens === 1 ? "was" : "were") + " joined. Hyphens that are part of the word text were kept.");
    if (stats.tables) warnings.push(stats.tables + " table-like layout" + (stats.tables === 1 ? "" : "s") + " were rebuilt from text positions (pages " + listPages(stats.tablePages.slice(0, 12)) + (stats.tablePages.length > 12 ? ", …" : "") + "). Rows follow the text lines and wrapped cells are re-joined by position, so a cell can be split or merged wrongly. Merged or spanning cells are not handled. Compare each one with the original page before using any value.");
    if (stats.headings) warnings.push("Headings were guessed from text size. Check the structure in the preview.");
    return { blocks: blocks, warnings: warnings, stats: stats };
  }

  /* a heading that is only a short number (a chapter number set in large type) sits next to its title on the same page: join them ("1" + "Emergencies" -> "1 Emergencies") at the higher level */
  function mergeNumberHeadings(blocks) {
    var out = [], i = 0;
    while (i < blocks.length) {
      var a = blocks[i], b = blocks[i + 1], c3 = blocks[i + 2];
      if (a.kind === "heading" && b && b.kind === "heading" && c3 && c3.kind === "heading" && a.page === b.page && b.page === c3.page && /^\d{1,3}$/.test(b.text) && !/^\d{1,3}$/.test(a.text) && !/^\d{1,3}$/.test(c3.text) && a.level === c3.level) {
        out.push({ kind: "heading", level: Math.min(a.level, b.level), text: b.text + " " + a.text + " " + c3.text, page: a.page }); i += 3; continue;   // a two-line title around the big number
      }
      if (a.kind === "heading" && b && b.kind === "heading" && a.page === b.page) {
        var an = /^\d{1,3}$/.test(a.text), bn = /^\d{1,3}$/.test(b.text);
        if (an !== bn) { var num = an ? a : b, title = an ? b : a; out.push({ kind: "heading", level: Math.min(a.level, b.level), text: num.text + " " + title.text, page: a.page }); i += 2; continue; }
      }
      out.push(a); i++;
    }
    return out;
  }

  function listPages(a) { var s = a.slice().sort(function (x, y) { return x - y; }), out = [], i = 0; while (i < s.length) { var j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(j > i + 1 ? s[i] + "–" + s[j] : s.slice(i, j + 1).join(", ")); i = j + 1; } var r = out.join(", "); return r.length > 120 ? r.slice(0, 117) + "…" : r; }

  var api = { buildLines: buildLines, buildPdfBlocks: buildPdfBlocks, listPages: listPages };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PCIPDF = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : this));
