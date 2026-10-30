/* MediStock Cloud — shared menu.
   To add a page to the menu, add one line to ITEMS below and upload this file only. */
(function () {
  var ITEMS = [
    ["dashboard.html", "Dashboard"],
    ["charts.html", "Charts"],
    ["sales.html", "Sell"],
    ["inventory.html", "Inventory"],
    ["purchases.html", "Purchases"],
    ["batches.html", "Batches"],
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
})();
