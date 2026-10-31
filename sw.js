/* MediStock Cloud — keeps the app's pages and the Firebase code on the phone so it opens with no internet.
   Pages refresh themselves in the background whenever the phone is online. */
var VERSION = "mc-v1";
var PAGES = ["dashboard.html", "charts.html", "reports.html", "history.html", "sales.html", "inventory.html", "purchases.html", "batches.html",
  "expiring.html", "stocktake.html", "whattobuy.html", "expenses.html", "credit.html", "cash-position.html", "suppliers.html", "users.html",
  "shops.html", "settings.html", "login.html", "nav.js"];
var SDK = ["https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js", "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    var jobs = PAGES.map(function (p) { return c.add(new Request(p, { cache: "reload" })).catch(function () {}); })
      .concat(SDK.map(function (u) { return c.add(new Request(u, { mode: "cors" })).catch(function () {}); }));
    return Promise.all(jobs);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  // Firebase JavaScript files never change for a given version: saved copy first.
  if (url.hostname === "www.gstatic.com" && url.pathname.indexOf("/firebasejs/") === 0) {
    e.respondWith(caches.open(VERSION).then(function (c) {
      return c.match(req.url).then(function (hit) {
        return hit || fetch(req).then(function (r) { if (r && r.ok) c.put(req.url, r.clone()); return r; });
      });
    }));
    return;
  }

  // The app's own pages: show the saved copy straight away, refresh it quietly in the background.
  if (url.origin === self.location.origin) {
    var key = url.origin + url.pathname;
    e.respondWith(caches.open(VERSION).then(function (c) {
      return c.match(key).then(function (hit) {
        var net = fetch(req).then(function (r) { if (r && r.ok) c.put(key, r.clone()); return r; }).catch(function () { return null; });
        if (hit) { e.waitUntil(net); return hit; }
        return net.then(function (r) {
          return r || new Response("You're offline and this page hasn't been saved on this phone yet. Connect to the internet once, open it, and it will work offline from then on.", { status: 503, headers: { "Content-Type": "text/plain" } });
        });
      });
    }));
  }
  // Everything else (Firestore / sign-in traffic) is left to the Firebase code, which has its own offline queue.
});
