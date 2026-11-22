/* MediStock Cloud — guideline import worker (Developer 4). Reads a file off the main thread so the page never freezes.
   Message in:  { id, name, buffer }      Message out: { id, hash, ext, ok, error, encoding, method, warnings, stats, sections, preview } or { id, error } */
importScripts("pc-import.js");
self.onmessage = function (e) {
  var m = e.data || {};
  try {
    var u8 = new Uint8Array(m.buffer);
    PCI.sha256Hex(u8).then(function (hash) {
      var r = PCI.extract(m.name, u8), secs = r.ok ? PCI.toSections(r.blocks) : [];
      var preview = r.ok ? r.blocks.slice(0, 40).map(function (b) { return b.kind === "table" ? { kind: "table", rows: b.rows.slice(0, 6) } : { kind: b.kind, level: b.level || 0, text: b.text.slice(0, 600) }; }) : [];
      self.postMessage({ id: m.id, hash: hash, ext: r.ext, ok: r.ok, error: r.error, encoding: r.encoding || "", method: r.method || "", warnings: r.warnings || [], stats: r.stats || null, sections: secs, preview: preview });
    }, function (err) { self.postMessage({ id: m.id, error: String(err && err.message || err) }); });
  } catch (err) { self.postMessage({ id: m.id, error: String(err && err.message || err) }); }
};
