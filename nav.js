/* MediStock Cloud — shared menu.
   To add a page to the menu, add one line to ITEMS below and upload this file only. */
(function () {
  var ITEMS = [
    ["dashboard.html", "Dashboard"],
    ["charts.html", "Charts"],
    ["reports.html", "Profit & Reports"],
    ["sales.html", "Sell"],
    ["inventory.html", "Inventory"],
    ["purchases.html", "Purchases"],
    ["batches.html", "Batches"],
    ["expiring.html", "Expiring Drugs"],
    ["stocktake.html", "Stock Taking"],
    ["whattobuy.html", "What to Buy"],
    ["expenses.html", "Expenses"],
    ["credit.html", "Credit / Loans"],
    ["cash-position.html", "Cash Position"],
    ["suppliers.html", "Suppliers"],
    ["users.html", "Users"],
    ["shops.html", "Shops"],
    ["settings.html", "Settings"]
  ];
  var panel = document.getElementById("navPanel");
  if (!panel) return;
  var current = (location.pathname.split("/").pop() || "dashboard.html").toLowerCase();
  panel.querySelectorAll("a").forEach(function (a) { a.parentNode.removeChild(a); });
  var before = panel.querySelector(".theme-toggle");
  ITEMS.forEach(function (it) {
    var a = document.createElement("a");
    a.href = it[0];
    a.textContent = it[1];
    if (it[0] === current) a.className = "active";
    panel.insertBefore(a, before);
  });

  // Log out (works on every page)
  var out = document.createElement("button");
  out.type = "button";
  out.className = "theme-toggle";
  out.id = "logoutBtn";
  out.textContent = "\ud83d\udeaa Log out";
  out.addEventListener("click", async function () {
    if (!confirm("Log out of MediStock?")) return;
    try {
      var m = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js");
      await m.getAuth().signOut();
      location.href = "login.html";
    } catch (e) {
      alert("Couldn't log out: " + (e && e.message ? e.message : e));
    }
  });
  panel.appendChild(out);
})();
