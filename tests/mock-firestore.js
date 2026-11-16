/* Tiny in-memory stand-in for Firestore, just enough to run the dispensing transaction in Node.
   Behaves like the real thing where it matters for Phase 5: reads in a transaction are checked at commit time
   (if another commit changed a document that was read, the transaction is retried), writes are all-or-nothing. */
function makeDb() {
  var store = new Map(), ver = new Map(), writes = [], clock = 1000;
  var db = { __mock: true, store: store, writes: writes, failNextCommitAfterApply: false, offline: false };
  function ref(coll, id) { return { path: coll + "/" + id, coll: coll, id: id }; }
  var tools = {
    db: db,
    doc: function (d, coll, id) { return ref(coll, id); },
    collection: function (d, coll) { return { coll: coll }; },
    serverTimestamp: function () { return { __serverTs: true }; },
    query: function (c) { return { coll: c.coll, ws: Array.prototype.slice.call(arguments, 1).filter(function (x) { return x && x.f; }) }; },
    where: function (f, op, v) { return { f: f, op: op, v: v }; }, limit: function (n) { return { limit: n }; },
    getDocs: async function (q) { var docs = []; store.forEach(function (v, k) { if (k.indexOf(q.coll + "/") === 0 && q.ws.every(function (w) { return v[w.f] === w.v; })) docs.push({ id: k.slice(q.coll.length + 1) }); }); return { docs: docs, size: docs.length }; },
    getDoc: async function (r) { var has = store.has(r.path); if (!has && db.denyMissingReads && db.denyMissingReads.indexOf(r.coll) >= 0) { var pe = new Error("Missing or insufficient permissions."); pe.code = "permission-denied"; throw pe; } return { id: r.id, exists: function () { return has; }, data: function () { return has ? JSON.parse(JSON.stringify(store.get(r.path))) : null; } }; },
    runTransaction: async function (d, fn) {
      for (var attempt = 0; attempt < 6; attempt++) {
        if (db.offline) { var e = new Error("Failed to get document because the client is offline."); e.code = "unavailable"; throw e; }
        var reads = {}, buf = [];
        var tx = {
          get: async function (r) {
            await Promise.resolve();
            reads[r.path] = ver.get(r.path) || 0;
            var has = store.has(r.path), data = has ? JSON.parse(JSON.stringify(store.get(r.path))) : null;
            if (!has && db.denyMissingReads && db.denyMissingReads.indexOf(r.coll) >= 0) { var pe = new Error("Missing or insufficient permissions."); pe.code = "permission-denied"; throw pe; }   // what rules did before v16
            return { id: r.id, exists: function () { return has; }, data: function () { return data; } };
          },
          set: function (r, data) { buf.push(["set", r, data]); return tx; },
          update: function (r, data) { buf.push(["update", r, data]); return tx; }
        };
        var out = await fn(tx);               // a throw here applies nothing
        await Promise.resolve();
        var stale = Object.keys(reads).some(function (p) { return (ver.get(p) || 0) !== reads[p]; });
        if (stale) continue;
        buf.forEach(function (w) {
          var r = w[1], data = JSON.parse(JSON.stringify(w[2], function (k, v) { return v && v.__serverTs ? ++clock : v; }));
          if (w[0] === "update") { if (!store.has(r.path)) throw new Error("update of missing doc " + r.path); store.set(r.path, Object.assign(store.get(r.path), data)); }
          else store.set(r.path, data);
          ver.set(r.path, (ver.get(r.path) || 0) + 1);
          writes.push(r.coll);
        });
        if (db.failNextCommitAfterApply) { db.failNextCommitAfterApply = false; var e2 = new Error("network dropped after commit"); e2.code = "unavailable"; throw e2; }
        return out;
      }
      var e3 = new Error("Transaction failed all retries"); e3.code = "aborted"; throw e3;
    }
  };
  db.put = function (coll, id, data) { store.set(coll + "/" + id, JSON.parse(JSON.stringify(data))); ver.set(coll + "/" + id, 1); };
  db.get = function (coll, id) { var v = store.get(coll + "/" + id); return v ? JSON.parse(JSON.stringify(v)) : null; };
  db.all = function (coll) { var out = []; store.forEach(function (v, k) { if (k.indexOf(coll + "/") === 0) out.push(Object.assign({ _id: k.slice(coll.length + 1) }, v)); }); return out; };
  db.snapshot = function () { return JSON.stringify(Array.from(store.entries())); };
  return { db: db, tools: tools };
}
module.exports = { makeDb: makeDb };
