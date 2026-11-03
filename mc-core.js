/* MediStock Cloud — shared data core (local-first layer).
   Loaded ONCE by app.html. Every screen lives inside app.html and gets its Firebase tools from here, so:
   - Firebase starts once, not on every screen.
   - Each table (sales, drugs, receipts...) is read ONCE into memory and kept up to date live.
   - A copy of that memory is also saved on the phone (own fast database), so the next launch shows data at once.
   - Screens ask the same questions as before (query / onSnapshot / getDocs) and are answered from memory.
   Writes still go through Firebase's own offline queue, unchanged.
   Safety switch: open the app once with  app.html?nostore=1  to bypass the memory layer (screens then talk to Firebase directly). */

var FB = "https://www.gstatic.com/firebasejs/12.19.0/";
var CONFIG = {
  apiKey: "AIzaSyBXwKfb9yg3HAQFIPG6q3SYHU9C7FQvkNY",
  authDomain: "medistock-cloud-93b83.firebaseapp.com",
  projectId: "medistock-cloud-93b83",
  storageBucket: "medistock-cloud-93b83.firebasestorage.app",
  messagingSenderId: "615610747921",
  appId: "1:615610747921:web:94b6627b64a250362335b0"
};
// Tables every screen needs: loaded at start-up. (Others are loaded the first time a screen asks for them.)
var CORE = ["drugs", "batches", "receipts", "sales", "credit_transactions", "credit_accounts", "supplier_transactions", "suppliers", "expenses", "cash_adjustments"];
var BACKGROUND = ["stock_transactions", "stock_adjustments"];
var NEVER = { users: 1, businesses: 1 };     // answered by Firebase directly
var BLOB_DB = "mc-store-v1", BLOB_FORMAT = 1;

export async function startCore(opts) {
  opts = opts || {};
  var T0 = performance.now();
  var timing = {};
  function mark(k) { timing[k] = Math.round(performance.now() - T0); }
  var NOSTORE = false;
  try { NOSTORE = /[?&]nostore=1/.test(location.search) || localStorage.getItem("mcNoStore") === "1"; } catch (e) {}
  if (/[?&]nostore=1/.test(location.search)) { try { localStorage.setItem("mcNoStore", "1"); } catch (e) {} }
  if (/[?&]nostore=0/.test(location.search)) { NOSTORE = false; try { localStorage.removeItem("mcNoStore"); } catch (e) {} }

  var A = await import(FB + "firebase-app.js");
  var AU = await import(FB + "firebase-auth.js");
  var FS = await import(FB + "firebase-firestore.js");
  mark("sdk");

  var app = A.initializeApp(CONFIG);
  var auth = AU.getAuth(app);
  var db;
  try {
    // one shared offline copy, never trimmed (the full history is kept), safe with several tabs/windows open
    db = FS.initializeFirestore(app, {
      localCache: FS.persistentLocalCache({ tabManager: FS.persistentMultipleTabManager(), cacheSizeBytes: FS.CACHE_SIZE_UNLIMITED })
    });
  } catch (e) {
    db = FS.getFirestore(app);
    try { await FS.enableIndexedDbPersistence(db); } catch (e2) {}
  }

  var MC = { app: app, auth: auth, db: db, FS: FS, AU: AU, A: A, timing: timing, noStore: NOSTORE, user: null, profile: null, frames: opts.frames || null };
  MC.goLogin = function (u) { location.href = u; };

  // ------------------------------------------------------------------ helpers
  // Screens live in frames, which have their OWN copy of JavaScript's basic Object/Date. Firebase refuses data that is
  // not made by its own copy ("custom Object object"), so everything written is rebuilt here first.
  function loc(v) {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) { var arr = []; for (var i = 0; i < v.length; i++) arr.push(loc(v[i])); return arr; }   // NOT v.map: map would build the array with the frame's own Array
    var tag = Object.prototype.toString.call(v);
    if (tag === "[object Date]") return new Date(v.getTime());
    var proto = Object.getPrototypeOf(v);
    if (tag === "[object Object]" && (proto === null || Object.getPrototypeOf(proto) === null)) {
      var o = {}; Object.keys(v).forEach(function (k) { o[k] = loc(v[k]); }); return o;
    }
    return v;   // Firebase's own things (Timestamp, increment(), references...) pass through untouched
  }
  function locArgs(a) { return Array.prototype.map.call(a, loc); }

  var getPath = function (o, p) { var c = o; var parts = String(p).split("."); for (var i = 0; i < parts.length; i++) { if (c == null) return undefined; c = c[parts[i]]; } return c; };
  function isTs(v) { return v && typeof v === "object" && typeof v.toMillis === "function" && typeof v.seconds === "number" && typeof v.nanoseconds === "number"; }
  function ser(v) {
    if (v == null || typeof v !== "object") return v;
    if (isTs(v)) return { __t: [v.seconds, v.nanoseconds] };
    if (Array.isArray(v)) return v.map(ser);
    var o = {}; for (var k in v) o[k] = ser(v[k]); return o;
  }
  function rev(v) {
    if (v == null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(rev);
    if (v.__t && v.__t.length === 2 && Object.keys(v).length === 1) return new FS.Timestamp(v.__t[0], v.__t[1]);
    var o = {}; for (var k in v) o[k] = rev(v[k]); return o;
  }

  // ------------------------------------------------------------------ the phone's own saved copy (one fast read per table)
  var idb = null;
  function openBlobDb() {
    if (idb) return idb;
    idb = new Promise(function (res) {
      try {
        var r = indexedDB.open(BLOB_DB, 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("t"); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { res(null); };
        r.onblocked = function () { res(null); };
      } catch (e) { res(null); }
    });
    return idb;
  }
  function blobGet(key) {
    return openBlobDb().then(function (d) {
      if (!d) return null;
      return new Promise(function (res) {
        try { var q = d.transaction("t").objectStore("t").get(key); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; } catch (e) { res(null); }
      });
    });
  }
  function blobPut(key, val) {
    return openBlobDb().then(function (d) {
      if (!d) return;
      return new Promise(function (res) {
        try { var tx = d.transaction("t", "readwrite"); tx.objectStore("t").put(val, key); tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); }; tx.onabort = function () { res(); }; } catch (e) { res(); }
      });
    });
  }
  function blobClear() {
    return openBlobDb().then(function (d) {
      if (!d) return;
      return new Promise(function (res) {
        try { var tx = d.transaction("t", "readwrite"); tx.objectStore("t").clear(); tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); }; tx.onabort = function () { res(); }; } catch (e) { res(); }
      });
    });
  }

  // ------------------------------------------------------------------ the memory store
  var entries = [];                    // one per (table + business [+ shop])
  var docIndex = new Map();            // "drugs/abc" -> row, for instant single-document reads
  var syncListeners = new Set();
  var saveTimer = null;
  var stats = { pending: 0 };

  function sigOf(coll, wheres) { return coll + "|" + wheres.map(function (w) { return w[0] + "=" + w[2]; }).join("&"); }
  function entryKey(e) { return (MC.user ? MC.user.uid : "x") + "|" + e.sig; }

  function makeEntry(coll, wheres) {
    var e = { coll: coll, wheres: wheres, sig: sigOf(coll, wheres), rows: new Map(), ready: false, synced: false, failed: false, fromCache: true,
      ver: 0, list: null, listVer: -1, views: new Map(), viewVer: -1, subs: new Set(), waiters: [], unsub: null, dirty: false, pend: 0, notifyTimer: null, pendingNotify: null };
    entries.push(e);
    hydrate(e).then(function () { attach(e); });
    return e;
  }
  function makeRow(id, data, pending) { return { id: id, d: data, p: !!pending, s: null }; }

  function hydrate(e) {
    if (NOSTORE) return Promise.resolve();
    return blobGet(entryKey(e)).then(function (b) {
      if (!b || b.f !== BLOB_FORMAT || e.synced) return;
      var rows = new Map();
      for (var i = 0; i < b.r.length; i++) { var r = b.r[i]; var row = makeRow(r[0], rev(r[1]), r[2]); rows.set(r[0], row); }
      e.rows = rows; e.hydrated = true;
      reindex(e); recount(e);
      e.ver++; markReady(e); notify(e, true, false);
    }).catch(function () {});
  }
  function reindex(e) { e.rows.forEach(function (row, id) { docIndex.set(e.coll + "/" + id, row); }); }
  function recount(e) { var n = 0; e.rows.forEach(function (r) { if (r.p) n++; }); stats.pending += n - e.pend; e.pend = n; fireSync(); }
  function markReady(e) {
    if (e.ready) return;
    e.ready = true;
    var w = e.waiters; e.waiters = []; w.forEach(function (f) { f(); });
    progress(); flushBatches();
  }
  function whenReady(e, ms) {
    if (e.ready || e.failed) return Promise.resolve(e.ready);
    return new Promise(function (res) {
      var done = false;
      var f = function () { if (!done) { done = true; res(e.ready); } };
      e.waiters.push(f);
      if (ms) setTimeout(f, ms);
    });
  }

  function attach(e) {
    if (e.attached) return; e.attached = true;
    try {
      var cs = e.wheres.map(function (w) { return FS.where(w[0], w[1], w[2]); });
      var q = FS.query.apply(null, [FS.collection(db, e.coll)].concat(cs));
      e.unsub = FS.onSnapshot(q, { includeMetadataChanges: true }, function (snap) { onReal(e, snap); }, function (err) {
        e.failed = true; e.error = err; markReadyFail(e);
      });
    } catch (err) { e.failed = true; e.error = err; markReadyFail(e); }
  }
  function markReadyFail(e) { var w = e.waiters; e.waiters = []; w.forEach(function (f) { f(); }); progress(); flushBatches(); }

  function onReal(e, snap) {
    var fromCache = !!snap.metadata.fromCache;
    var dataChanged = false, metaChanged = fromCache !== e.fromCache;
    e.fromCache = fromCache;
    if (!e.synced) {
      // first answer from Firebase's own copy: becomes the truth (replaces the saved-on-phone start-up copy)
      var rows = new Map();
      snap.docs.forEach(function (d) { rows.set(d.id, makeRow(d.id, d.data({ serverTimestamps: "estimate" }), d.metadata.hasPendingWrites)); });
      // drop index entries of docs that no longer exist
      if (e.rows.size) e.rows.forEach(function (_, id) { if (!rows.has(id)) docIndex.delete(e.coll + "/" + id); });
      e.rows = rows; e.synced = true;
      reindex(e); recount(e);
      dataChanged = true;
    } else {
      var ch = snap.docChanges({ includeMetadataChanges: true });
      for (var i = 0; i < ch.length; i++) {
        var c = ch[i], id = c.doc.id, key = e.coll + "/" + id;
        if (c.type === "removed") {
          var old = e.rows.get(id);
          if (old) { if (old.p) { e.pend--; stats.pending--; } e.rows.delete(id); docIndex.delete(key); dataChanged = true; }
        } else {
          var data = c.doc.data({ serverTimestamps: "estimate" }), p = !!c.doc.metadata.hasPendingWrites;
          var prev = e.rows.get(id);
          var row = makeRow(id, data, p);
          if (prev) {
            if (prev.p && !p) { e.pend--; stats.pending--; }
            else if (!prev.p && p) { e.pend++; stats.pending++; }
            // a doc whose only change is "now uploaded" is a metadata change, not a data change
            if (prev.p && !p && sameData(prev.d, data)) metaChanged = true; else dataChanged = true;
          } else { if (p) { e.pend++; stats.pending++; } dataChanged = true; }
          e.rows.set(id, row); docIndex.set(key, row);
        }
      }
      if (ch.length) metaChanged = true;
      fireSync();
    }
    if (dataChanged) { e.ver++; e.dirty = true; scheduleSave(); if (e.coll === "shops" && e.ready && MC.onShopsChanged) MC.onShopsChanged(); }
    markReady(e);
    if (dataChanged || metaChanged) notify(e, dataChanged, metaChanged);
  }
  function sameData(a, b) { try { return JSON.stringify(ser(a)) === JSON.stringify(ser(b)); } catch (e) { return false; } }

  function scheduleSave() {
    if (NOSTORE || saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      var run = function () {
        entries.forEach(function (e) {
          if (!e.dirty || !e.synced) return;
          e.dirty = false;
          var out = []; e.rows.forEach(function (r) { out.push([r.id, ser(r.d), r.p ? 1 : 0]); });
          blobPut(entryKey(e), { f: BLOB_FORMAT, t: Date.now(), r: out });
        });
      };
      if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 4000 }); else run();
    }, 3000);
  }

  function sortedList(e) {
    if (e.listVer === e.ver && e.list) return e.list;
    var arr = []; e.rows.forEach(function (r) { arr.push(r); });
    arr.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    e.list = arr; e.listVer = e.ver; e.views = new Map();
    return arr;
  }
  function viewOf(e, extra) {
    var base = sortedList(e);
    if (!extra.length) return base;
    var k = extra.map(function (w) { return w[0] + "=" + w[2]; }).join("&");
    var v = e.views.get(k);
    if (v) return v;
    v = base.filter(function (r) { for (var i = 0; i < extra.length; i++) { if (getPath(r.d, extra[i][0]) !== extra[i][2]) return false; } return true; });
    e.views.set(k, v);
    return v;
  }

  // ---- snapshot objects that look like Firebase's
  function DocSnap(row, e) { this._r = row; this._e = e; this.id = row.id; }
  DocSnap.prototype.exists = function () { return true; };
  DocSnap.prototype.data = function () { return Object.assign({}, this._r.d); };
  DocSnap.prototype.get = function (f) { return getPath(this._r.d, f); };
  Object.defineProperty(DocSnap.prototype, "metadata", { get: function () { return { hasPendingWrites: this._r.p, fromCache: this._e.fromCache }; } });
  Object.defineProperty(DocSnap.prototype, "ref", { get: function () { return FS.doc(db, this._e.coll, this.id); } });
  function snapOf(e, rows) {
    var docs = rows.map(function (r) { return r.s || (r.s = new DocSnap(r, e)); });
    var anyPending = false; for (var i = 0; i < rows.length; i++) if (rows[i].p) { anyPending = true; break; }
    return {
      docs: docs, size: docs.length, empty: docs.length === 0, metadata: { fromCache: e.fromCache, hasPendingWrites: anyPending },
      forEach: function (f) { docs.forEach(f); },
      docChanges: function () { return docs.map(function (d, i) { return { type: "added", doc: d, oldIndex: -1, newIndex: i }; }); }
    };
  }

  function notify(e, dataChanged, metaChanged) {
    if (!e.subs.size) return;
    e.pendingNotify = e.pendingNotify || { d: false, m: false };
    if (dataChanged) e.pendingNotify.d = true;
    if (metaChanged) e.pendingNotify.m = true;
    if (e.notifyTimer) return;
    e.notifyTimer = setTimeout(function () {
      e.notifyTimer = null;
      var pn = e.pendingNotify; e.pendingNotify = null;
      Array.from(e.subs).forEach(function (s) {
        if (!s.live || s.batch) return;
        if (!(pn.d || (pn.m && s.meta))) return;
        fire(e, s);
      });
    }, 0);
  }
  function fire(e, s) {
    var snap;
    try { snap = snapOf(e, viewOf(e, s.extra)); } catch (err) { if (s.err) s.err(err); return; }
    try { s.next(snap); } catch (err) { try { console.error(err); } catch (x) {} }
  }

  // ---- first answers are delivered together: a screen that listens to several tables gets them all in ONE go,
  //      so it never draws a total from half of its tables (the "wrong number, then the right one" flash).
  var curBatch = null, openBatches = new Set();
  function joinBatch(sub) {
    if (!curBatch) {
      var b = curBatch = { subs: [], closed: false, flushed: false };
      openBatches.add(b);
      setTimeout(function () { b.closed = true; if (curBatch === b) curBatch = null; tryFlush(b); }, 0);
      setTimeout(function () { b.closed = true; tryFlush(b, true); }, 10000);
    }
    sub.batch = curBatch; curBatch.subs.push(sub);
  }
  function tryFlush(b, force) {
    if (b.flushed || !b.closed) return;
    if (!force && !b.subs.every(function (s) { return !s.live || s.e.ready || s.e.failed; })) return;
    b.flushed = true; openBatches.delete(b);
    b.subs.forEach(function (s) {
      if (!s.live) return;
      s.batch = null;
      if (s.e.ready) fire(s.e, s); else if (s.e.failed && s.err) { try { s.err(s.e.error); } catch (x) {} }
    });
  }
  function flushBatches() { Array.from(openBatches).forEach(function (b) { tryFlush(b); }); }

  // ---- finding the right table for a question
  var profileScope = null;   // { businessId, shopId|null }
  function findEntry(meta) {
    if (NOSTORE || !meta || !meta.ok || NEVER[meta.coll] || !profileScope) return null;
    var best = null;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.coll !== meta.coll || e.failed) continue;
      var extra = [], ok = true;
      for (var j = 0; j < e.wheres.length && ok; j++) {
        var w = e.wheres[j], found = false;
        for (var k = 0; k < meta.wheres.length; k++) if (meta.wheres[k][0] === w[0] && meta.wheres[k][2] === w[2]) { found = true; break; }
        if (!found) ok = false;
      }
      if (!ok) continue;
      extra = meta.wheres.filter(function (w) { return !e.wheres.some(function (x) { return x[0] === w[0] && x[2] === w[2]; }); });
      if (!best || e.wheres.length > best.e.wheres.length) best = { e: e, extra: extra };
    }
    if (best) return best;
    // not loaded yet: if it's one of our own business's tables, start loading it now
    var bw = meta.wheres.filter(function (w) { return w[0] === "businessId"; })[0];
    if (!bw || bw[2] !== profileScope.businessId) return null;
    var sw = meta.wheres.filter(function (w) { return w[0] === "shopId"; })[0];
    var sig = [["businessId", "==", bw[2]]]; if (sw) sig.push(["shopId", "==", sw[2]]);
    var ne = makeEntry(meta.coll, sig);
    return { e: ne, extra: meta.wheres.filter(function (w) { return !sig.some(function (x) { return x[0] === w[0]; }); }) };
  }

  // ---- registry of what each Firebase query/constraint means (the real objects stay real)
  var WM = new WeakMap(), QM = new WeakMap();
  function metaOf(q) { return QM.get(q) || null; }

  // ------------------------------------------------------------------ progress for the splash screen
  var progListeners = new Set();
  function progress() { var t = 0, r = 0; entries.forEach(function (e) { if (e.core) { t++; if (e.ready || e.failed) r++; } }); progListeners.forEach(function (f) { try { f(r, t); } catch (x) {} }); }
  MC.onProgress = function (f) { progListeners.add(f); return function () { progListeners.delete(f); }; };
  function fireSync() { syncListeners.forEach(function (f) { try { f(); } catch (x) {} }); }
  MC.onSync = function (f) { syncListeners.add(f); return function () { syncListeners.delete(f); }; };
  MC.pendingDocs = function () { return stats.pending; };

  // ------------------------------------------------------------------ the tools given to each screen
  MC.api = function (win) {
    var rec = MC.frames && MC.frames.of ? MC.frames.of(win) : null;
    var unsubs = [];
    var track = function (u) { unsubs.push(u); return function () { try { u(); } catch (x) {} }; };
    var cleanup = function () { unsubs.splice(0).forEach(function (u) { try { u(); } catch (x) {} }); };
    try { win.addEventListener("pagehide", cleanup); } catch (x) {}
    if (rec) rec.cleanup = cleanup;

    var api = {};
    Object.keys(A).forEach(function (k) { api[k] = A[k]; });
    Object.keys(AU).forEach(function (k) { api[k] = AU[k]; });
    Object.keys(FS).forEach(function (k) { api[k] = FS[k]; });

    api.initializeApp = function (cfg, name) { return name ? A.initializeApp(cfg, name) : app; };
    api.getAuth = function (a) { return (!a || a === app) ? auth : AU.getAuth(a); };
    api.getFirestore = function (a) { return (!a || a === app) ? db : FS.getFirestore(a); };
    api.enableIndexedDbPersistence = function () { return Promise.resolve(); };
    api.onAuthStateChanged = function (a, cb, er) { return track(AU.onAuthStateChanged(a, cb, er)); };

    // ---- writes: same Firebase calls, data rebuilt in this window's own Object/Date first
    api.setDoc = function (ref, data, o) { return o === undefined ? FS.setDoc(ref, loc(data)) : FS.setDoc(ref, loc(data), loc(o)); };
    api.addDoc = function (ref, data) { return FS.addDoc(ref, loc(data)); };
    api.updateDoc = function (ref) { return FS.updateDoc.apply(null, [ref].concat(locArgs(Array.prototype.slice.call(arguments, 1)))); };
    api.writeBatch = function (d) {
      var b = FS.writeBatch(d), w = {};
      w.set = function (r, data, o) { if (o === undefined) b.set(r, loc(data)); else b.set(r, loc(data), loc(o)); return w; };
      w.update = function (r) { b.update.apply(b, [r].concat(locArgs(Array.prototype.slice.call(arguments, 1)))); return w; };
      w.delete = function (r) { b.delete(r); return w; };
      w.commit = function () { return b.commit(); };
      return w;
    };
    api.runTransaction = function (d, fn, o) {
      return FS.runTransaction(d, function (tx) {
        var w = {};
        w.get = function (r) { return tx.get(r); };
        w.set = function (r, data, op) { if (op === undefined) tx.set(r, loc(data)); else tx.set(r, loc(data), loc(op)); return w; };
        w.update = function (r) { tx.update.apply(tx, [r].concat(locArgs(Array.prototype.slice.call(arguments, 1)))); return w; };
        w.delete = function (r) { tx.delete(r); return w; };
        return fn(w);
      }, o);
    };

    api.where = function (f, op, v) { v = loc(v); var c = FS.where(f, op, v); WM.set(c, [f, op, v]); return c; };
    api.collection = function (d) {
      var r = FS.collection.apply(null, arguments);
      return r;
    };
    api.query = function (base) {
      var cs = Array.prototype.slice.call(arguments, 1);
      var q = FS.query.apply(null, arguments);
      var bm = QM.get(base);
      var meta = bm ? { coll: bm.coll, wheres: bm.wheres.slice(), ok: bm.ok } : (base && base.type === "collection" && base.path && base.path.indexOf("/") < 0 ? { coll: base.path, wheres: [], ok: true } : { ok: false });
      cs.forEach(function (c) { var w = WM.get(c); if (w && w[1] === "==") meta.wheres.push(w); else meta.ok = false; });
      QM.set(q, meta);
      return q;
    };
    // a plain collection reference is also a (filter-less) query
    var origColl = api.collection;
    api.collection = function () { var r = origColl.apply(null, arguments); try { if (r && r.path && r.path.indexOf("/") < 0) QM.set(r, { coll: r.path, wheres: [], ok: true }); } catch (x) {} return r; };

    function serve(q) {
      var meta = metaOf(q);
      if (!meta) return null;
      return findEntry(meta);
    }

    api.getDocFromCache = function (ref) {
      var row = docIndex.get(ref.path);
      if (row && !NOSTORE) { var coll = ref.path.split("/")[0]; var e = entries.filter(function (x) { return x.coll === coll; })[0]; if (e) return Promise.resolve(new DocSnap(row, e)); }
      var vd = MC.virtualDocs && MC.virtualDocs[ref.path];
      if (vd && !NOSTORE) return Promise.resolve(vd);
      return FS.getDocFromCache(ref);
    };
    api.getDocsFromCache = function (q) {
      var s = serve(q);
      if (s && s.e.ready) return Promise.resolve(snapOf(s.e, viewOf(s.e, s.extra)));
      return FS.getDocsFromCache(q);
    };
    api.getDocs = function (q) {
      var s = serve(q);
      if (!s) return FS.getDocs(q);
      return whenReady(s.e, 8000).then(function (ok) {
        if (ok) return snapOf(s.e, viewOf(s.e, s.extra));
        return FS.getDocs(q);
      });
    };
    api.onSnapshot = function (target) {
      var rest = Array.prototype.slice.call(arguments, 1);
      var s = (target && target.type !== "document") ? serve(target) : null;
      if (!s) { var u = FS.onSnapshot.apply(null, arguments); return track(u); }
      var o = {}, next = null, err = null;
      if (rest.length && typeof rest[0] === "object" && rest[0] && typeof rest[0] !== "function" && !("next" in rest[0])) { o = rest.shift(); }
      if (rest.length && typeof rest[0] === "object" && rest[0] && "next" in rest[0]) { next = rest[0].next && rest[0].next.bind(rest[0]); err = rest[0].error && rest[0].error.bind(rest[0]); }
      else { next = rest[0]; err = rest[1]; }
      var sub = { live: true, extra: s.extra, meta: !!o.includeMetadataChanges, next: next, err: err, e: s.e, batch: null };
      var e = s.e;
      e.subs.add(sub);
      joinBatch(sub);
      return track(function () { sub.live = false; e.subs.delete(sub); });
    };
    return api;
  };

  // ------------------------------------------------------------------ sign-in, profile, start loading
  function readCachedProfile(uid) { try { return JSON.parse(localStorage.getItem("mcProfile:" + uid) || "null"); } catch (e) { return null; } }
  function saveCachedProfile(uid, p) { try { localStorage.setItem("mcProfile:" + uid, JSON.stringify(p)); } catch (e) {} }

  await auth.authStateReady();
  mark("auth");
  var user = auth.currentUser;
  MC.user = user;
  if (!user) { MC.needLogin = true; return MC; }

  var vdocs = {};
  MC.virtualDocs = vdocs;
  function virtual(path, data) {
    vdocs[path] = { id: path.split("/").pop(), exists: function () { return true; }, data: function () { return Object.assign({}, data); }, get: function (f) { return getPath(data, f); }, metadata: { fromCache: true, hasPendingWrites: false }, ref: FS.doc(db, path) };
  }

  var profile = readCachedProfile(user.uid);
  if (profile) {
    // start at once from the saved profile, and confirm it with Firebase in the background
    FS.getDoc(FS.doc(db, "users", user.uid)).then(function (s) {
      if (s.exists()) {
        var p = s.data();
        if (p.active === false) { AU.signOut(auth).then(function () { MC.goLogin("login.html?disabled=1"); }); return; }
        saveCachedProfile(user.uid, p);
        if (p.role !== profile.role || p.businessId !== profile.businessId || (p.shopId || "") !== (profile.shopId || "")) MC.goLogin("app.html");
      }
    }).catch(function () {});
  } else {
    var s;
    try { s = await FS.getDocFromCache(FS.doc(db, "users", user.uid)); } catch (e) { s = null; }
    if (!s || !s.exists()) { try { s = await FS.getDoc(FS.doc(db, "users", user.uid)); } catch (e) { s = null; } }
    if (!s || !s.exists()) { MC.needLogin = true; return MC; }
    profile = s.data();
    if (profile.active === false) { await AU.signOut(auth); MC.disabled = true; MC.needLogin = true; return MC; }
    saveCachedProfile(user.uid, profile);
  }
  MC.profile = profile;
  virtual("users/" + user.uid, profile);
  mark("profile");

  // the business document (name, phone) — saved copy first
  (async function () {
    try {
      var bs = null;
      try { bs = await FS.getDocFromCache(FS.doc(db, "businesses", profile.businessId)); } catch (e) {}
      if (bs && bs.exists()) virtual("businesses/" + profile.businessId, bs.data());
      FS.getDoc(FS.doc(db, "businesses", profile.businessId)).then(function (f) { if (f.exists()) virtual("businesses/" + profile.businessId, f.data()); }).catch(function () {});
    } catch (e) {}
  })();

  profileScope = { businessId: profile.businessId, shopId: profile.role === "owner" ? null : profile.shopId };
  var scopeWheres = [["businessId", "==", profile.businessId]];
  if (profile.role !== "owner" && profile.shopId) scopeWheres.push(["shopId", "==", profile.shopId]);

  if (!NOSTORE) {
    var shopsE = null;
    if (profile.role === "owner") { shopsE = makeEntry("shops", [["businessId", "==", profile.businessId]]); shopsE.core = true; }
    else { shopsE = null; }
    CORE.forEach(function (c) { var e = makeEntry(c, scopeWheres.slice()); e.core = true; });
    // less-used tables load quietly a few seconds later
    setTimeout(function () { BACKGROUND.forEach(function (c) { findEntry({ coll: c, wheres: scopeWheres.slice(), ok: true }); }); }, 4000);
  }
  MC.coreReady = function (maxMs) {
    var core = entries.filter(function (e) { return e.core; });
    if (!core.length) return Promise.resolve();
    return Promise.race([
      Promise.all(core.map(function (e) { return whenReady(e); })),
      new Promise(function (r) { setTimeout(r, maxMs || 8000); })
    ]);
  };
  MC.coreCounts = function () { var t = 0, r = 0; entries.forEach(function (e) { if (e.core) { t++; if (e.ready || e.failed) r++; } }); return [r, t]; };
  MC.entries = entries;

  // ---- log out: wait (briefly) for unsent changes, wipe this phone's saved copy, leave
  MC.logout = async function () {
    try { await AU.signOut(auth); } catch (e) {}
    try { await blobClear(); } catch (e) {}
    try { localStorage.removeItem("mcProfile:" + user.uid); } catch (e) {}
  };
  MC.waitForPendingWrites = function (ms) {
    return Promise.race([FS.waitForPendingWrites(db).then(function () { return true; }), new Promise(function (r) { setTimeout(function () { r(false); }, ms || 1500); })]);
  };

  // a deactivated account is signed out as soon as Firebase says so
  try {
    FS.onSnapshot(FS.doc(db, "users", user.uid), function (s) {
      if (s.exists() && s.data().active === false) { AU.signOut(auth).then(function () { MC.goLogin("login.html?disabled=1"); }); }
    }, function () {});
  } catch (e) {}
  AU.onAuthStateChanged(auth, function (u) { if (!u) MC.goLogin("login.html"); });

  mark("started");
  return MC;
}
