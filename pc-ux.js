/* MediStock Cloud — Phase 5 shared UX helpers (Developer 3).
   Pure functions. No database access, no data-structure changes.
     PCUX.friendlyError(err, what)  -> plain-language message for any Firebase/app error
     PCUX.ageFromDob(dob, today)    -> { years, months, text } or null
     PCUX.bmi(kg, cm)               -> { value, text } or null (a number to read, not a diagnosis)
     PCUX.savedText(state)          -> honest wording for save states */
(function (root) {
  var CODES = {
    "permission-denied": "You do not have permission to perform this action.",
    "unauthenticated": "Your session has ended. Please sign in again.",
    "unavailable": "The server could not be reached. Check your internet connection and try again.",
    "deadline-exceeded": "This took too long. Check your internet connection and try again.",
    "resource-exhausted": "The service is busy right now. Please wait a moment and try again.",
    "invalid-argument": "Some of the information entered is not valid. Check the highlighted fields and try again.",
    "failed-precondition": "This could not be done in its current state. Refresh the page and try again.",
    "already-exists": "This record already exists.",
    "not-found": "This record could not be found. It may have been removed.",
    "aborted": "Someone else changed this at the same time. Refresh the page and try again.",
    "cancelled": "The action was cancelled. Please try again."
  };
  function code(err) { var c = err && (err.code || (err.message && /\b(permission-denied|unavailable|unauthenticated)\b/.exec(err.message) || [])[0]); return c ? String(c).replace(/^firestore\//, "") : ""; }
  function friendlyError(err, what) {
    var c = code(err), base;
    if (what && (c === "unavailable" || c === "deadline-exceeded" || c === "")) base = "This " + what + " could not be saved. Check your internet connection and try again.";
    else base = CODES[c] || "Something went wrong. Please try again. If it keeps happening, tell the person in charge.";
    return base;
  }
  function ageFromDob(dob, today) {
    var d = dob instanceof Date ? dob : new Date(dob); if (!dob || isNaN(d)) return null;
    var t = today || new Date(); if (d > t) return null;
    var m = (t.getFullYear() - d.getFullYear()) * 12 + (t.getMonth() - d.getMonth()); if (t.getDate() < d.getDate()) m--;
    if (m < 0) return null;
    var y = Math.floor(m / 12), r = m % 12;
    var text = m < 1 ? "under 1 month" : m < 24 ? m + " month" + (m === 1 ? "" : "s") : y + " year" + (y === 1 ? "" : "s") + (y < 5 && r ? " " + r + " month" + (r === 1 ? "" : "s") : "");
    return { years: y, months: m, text: text };
  }
  function bmi(kg, cm) {
    kg = Number(kg); cm = Number(cm); if (!(kg > 0) || !(cm > 0)) return null;
    var v = Math.round(kg / Math.pow(cm / 100, 2) * 10) / 10;
    return { value: v, text: "BMI " + v + " (calculated from weight and height)" };
  }
  function savedText(state) {
    return { saved: "Saved.", pending: "Not confirmed yet. Waiting for the internet. Do not assume this is saved.", failed: "NOT SAVED. Check your connection and try again." }[state] || "";
  }
  var api = { friendlyError: friendlyError, ageFromDob: ageFromDob, bmi: bmi, savedText: savedText, CODES: CODES };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PCUX = api;
})(typeof window !== "undefined" ? window : globalThis);
