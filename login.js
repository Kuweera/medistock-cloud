/* MediStock Cloud — sign-in page logic.
   Sections: 1 Firebase · 2 State machine and UI helpers · 3 Validation · 4 Owner sign in / registration / password reset ·
   5 Operator sign in · 6 Session handling · 7 Debug tools · 8 Wiring.
   The Firebase project, collection names, document fields and the operator e-mail rule are unchanged. */
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, collection, addDoc, onSnapshot,
  enableIndexedDbPersistence, serverTimestamp, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

/* ============ 1. FIREBASE ============ */
const firebaseConfig = {
  apiKey: "AIzaSyBXwKfb9yg3HAQFIPG6q3SYHU9C7FQvkNY",
  authDomain: "medistock-cloud-93b83.firebaseapp.com",
  projectId: "medistock-cloud-93b83",
  storageBucket: "medistock-cloud-93b83.firebasestorage.app",
  messagingSenderId: "615610747921",
  appId: "1:615610747921:web:94b6627b64a250362335b0"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
enableIndexedDbPersistence(db).catch((err) => { console.warn("Offline persistence not enabled:", err.code); });

/* ============ 2. STATE MACHINE AND UI HELPERS ============ */
const STATE = Object.freeze({
  OWNER_LOGIN: "OWNER_LOGIN",
  OWNER_SIGNUP_STEP_1: "OWNER_SIGNUP_STEP_1",
  OWNER_SIGNUP_STEP_2: "OWNER_SIGNUP_STEP_2",
  OPERATOR_LOGIN: "OPERATOR_LOGIN",
  AUTHENTICATING: "AUTHENTICATING",
  AUTHENTICATED: "AUTHENTICATED"
});
const VIEW = {
  OWNER_LOGIN: "viewOwnerLogin", OWNER_SIGNUP_STEP_1: "viewSignup1", OWNER_SIGNUP_STEP_2: "viewSignup2", OPERATOR_LOGIN: "viewOperatorLogin"
};
const FORM_STATES = [STATE.OWNER_LOGIN, STATE.OWNER_SIGNUP_STEP_1, STATE.OWNER_SIGNUP_STEP_2, STATE.OPERATOR_LOGIN];
const DEBUG = new URLSearchParams(location.search).get("debug") === "1";

let state = STATE.AUTHENTICATING;   // what the page is doing right now
let formState = STATE.OWNER_LOGIN;  // which form the person was on (we return here after a failure)
let submitting = false;             // a form submit is in flight (blocks double taps)
let signupInProgress = false;       // the 4 registration writes are running: the session listener must not interfere
let sessionChecked = false;
let authenticated = false;
let pendingSignup = null;           // remembers what a half-finished registration already created, so a retry never duplicates it

let currentRole = null, currentBusinessId = null, currentShopId = null, currentShopCode = null;
let unsubDrugs = null, unsubShops = null;

const $ = (id) => document.getElementById(id);
const val = (id) => $(id).value.trim();

function currentViewId() {
  if (state === STATE.AUTHENTICATED) return "viewBusy";
  if (state === STATE.AUTHENTICATING && !submitting) return "viewBusy";
  return VIEW[state === STATE.AUTHENTICATING ? formState : state];
}
let lastViewId = null;
function render(focus) {
  const showId = currentViewId();
  ["viewBusy", "viewOwnerLogin", "viewSignup1", "viewSignup2", "viewOperatorLogin"].forEach((id) => $(id).classList.toggle("hidden", id !== showId));
  const tabsOn = showId === "viewOwnerLogin" || showId === "viewOperatorLogin";
  $("roleTabs").classList.toggle("hidden", !tabsOn);
  const op = showId === "viewOperatorLogin";
  $("tabOwner").setAttribute("aria-selected", String(!op)); $("tabOwner").tabIndex = op ? -1 : 0;
  $("tabOperator").setAttribute("aria-selected", String(op)); $("tabOperator").tabIndex = op ? 0 : -1;
  if (focus && showId !== "viewBusy") {
    const first = $(showId).querySelector("input:not([type=hidden])");
    if (first) first.focus({ preventScroll: false });
  }
  if (showId !== lastViewId) { lastViewId = showId; window.scrollTo({ top: 0 }); }
}
function enterFormState(next, opts) {
  formState = next; state = next;
  if (!(opts && opts.keepStatus)) clearStatuses();
  render(!(opts && opts.noFocus));
}

function setBusyText(text) { $("busyText").textContent = text; }
function statusEl() {
  const v = $(currentViewId());
  return v ? v.querySelector(".status") : null;
}
function setStatus(msg, kind, viewId) {
  const el = viewId ? $(viewId).querySelector(".status") : statusEl();
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status" + (msg ? " " + (kind || "info") : "");
  if (msg && kind === "err") { try { el.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) {} }
}
function clearStatuses() { document.querySelectorAll(".status").forEach((e) => { if (e.id !== "opStatus") { e.textContent = ""; e.className = "status"; } }); }
function setFieldError(id, msg) {
  const input = $(id), err = $("err-" + id);
  if (input) input.setAttribute("aria-invalid", msg ? "true" : "false");
  if (err) { err.textContent = msg || ""; err.classList.toggle("show", !!msg); }
}
function clearFieldErrors(root) { root.querySelectorAll(".field-error").forEach((e) => { e.textContent = ""; e.classList.remove("show"); }); root.querySelectorAll("[aria-invalid]").forEach((i) => i.setAttribute("aria-invalid", "false")); }

// A submit button shows a spinner and the whole form is locked until the request finishes.
function beginSubmit(btn, label) {
  if (submitting) return false;
  submitting = true; state = STATE.AUTHENTICATING;
  const fs = btn.closest("form").querySelector("fieldset");
  fs.disabled = true;
  btn.disabled = false;   // keep it focusable for screen readers, but it ignores clicks while `submitting`
  btn.setAttribute("aria-busy", "true");
  btn.querySelector(".lbl").dataset.was = btn.querySelector(".lbl").textContent;
  btn.querySelector(".lbl").textContent = label;
  return true;
}
function endSubmit(btn) {
  submitting = false;
  if (btn) {
    const fs = btn.closest("form").querySelector("fieldset");
    fs.disabled = false;
    btn.removeAttribute("aria-busy");
    const lbl = btn.querySelector(".lbl"); if (lbl.dataset.was) lbl.textContent = lbl.dataset.was;
  }
  if (!authenticated && state === STATE.AUTHENTICATING) state = formState;
  render(false);
}

function updateConnectivity() { $("netBanner").classList.toggle("hidden", navigator.onLine !== false); }
function needInternet(what) {
  if (navigator.onLine === false) { setStatus("You are offline. " + what + " needs an internet connection. Connect and try again.", "err"); return true; }
  return false;
}

function friendlyError(err, who) {
  const code = (err && err.code) || "";
  if (code === "timeout") return "This is taking too long. Check your connection and try again.";
  if (/auth\/(invalid-credential|invalid-login-credentials|wrong-password|user-not-found)/.test(code))
    return who === "operator" ? "Login failed. Check the Shop Code, Operator ID and PIN." : "Incorrect email or password. Check them and try again, or use Forgot password.";
  switch (code) {
    case "auth/invalid-email": return "That email address does not look right.";
    case "auth/too-many-requests": return "Too many attempts. Wait a few minutes, then try again.";
    case "auth/network-request-failed": return "No internet connection. Connect and try again.";
    case "auth/email-already-in-use": return "An account with this email already exists. Go back to login and sign in.";
    case "auth/weak-password": return "That password is too weak. Use at least 6 characters.";
    case "auth/user-disabled": return "This account has been disabled. Contact your business owner.";
    case "auth/operation-not-allowed": return "Sign-in is not enabled for this project.";
    case "permission-denied": return "The server refused this step (permission denied). Please try again; if it keeps happening, contact support.";
    case "unavailable": return "The server could not be reached. Check your connection and try again.";
  }
  return "Something went wrong. Please try again.";
}

function sanitizeCode(code) { return String(code).toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function buildInternalEmail(shopCode, operatorId) { return `op${operatorId}@${sanitizeCode(shopCode).toLowerCase()}.medistock.internal`; }

function withTimeout(promise, label, ms = 15000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { const e = new Error(`"${label}" timed out after ${ms / 1000}s`); e.code = "timeout"; reject(e); }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
async function retryOnPermission(fn, label, attempts = 4, delayMs = 900) {
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (err) {
      if (err.code !== "permission-denied" || i === attempts) throw err;
      log(`"${label}" hit a timing delay (attempt ${i}/${attempts}), retrying`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

function toggleReveal(btn) {
  const input = $(btn.dataset.target);
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  btn.textContent = show ? "Hide" : "Show";
  btn.setAttribute("aria-pressed", String(show));
  btn.setAttribute("aria-label", (show ? "Hide " : "Show ") + (btn.dataset.target === "opLoginPin" || btn.dataset.target === "opPin" ? "PIN" : "password"));
}

/* ----- navigation between the screens ----- */
function setAuthTab(tab) { if (submitting) return; tab === "operator" ? showOperatorLogin() : showOwnerLogin(); }
function showOwnerLogin(opts) { enterFormState(STATE.OWNER_LOGIN, opts); }
function showOperatorLogin(opts) { enterFormState(STATE.OPERATOR_LOGIN, opts); }
function showOwnerSignupStep(step, opts) {
  enterFormState(step === 2 ? STATE.OWNER_SIGNUP_STEP_2 : STATE.OWNER_SIGNUP_STEP_1, opts);
  if (step === 2) updatePasswordRules();
}

/* ============ 3. VALIDATION ============ */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function validateOwnerSignup(step) {
  let ok = true, firstBad = null;
  const bad = (id, msg) => { setFieldError(id, msg); if (ok) firstBad = id; ok = false; };
  if (step === 1) {
    clearFieldErrors($("viewSignup1"));
    if (!val("businessName")) bad("businessName", "Enter the business name.");
    if (val("ownerName").length < 2) bad("ownerName", "Enter your full name. It is printed on receipts as the cashier.");
    if (val("businessPhone").replace(/[^0-9]/g, "").length < 7) bad("businessPhone", "Enter a valid business phone number.");
    if (!val("shopName")) bad("shopName", "Enter the first shop's name.");
    if (!sanitizeCode(val("shopCode"))) bad("shopCode", "Enter a shop code (letters and numbers).");
  } else {
    clearFieldErrors($("viewSignup2"));
    if (!EMAIL_RE.test(val("email"))) bad("email", "Enter a valid email address.");
    const pw = $("password").value, cp = $("confirmPassword").value;
    if (pw.length < 6) bad("password", "Use at least 6 characters.");
    if (!cp) bad("confirmPassword", "Re-enter the password.");
    else if (pw !== cp) bad("confirmPassword", "The passwords do not match.");
  }
  if (firstBad) $(firstBad).focus();
  return ok;
}
function updatePasswordRules() {
  const pw = $("password").value, cp = $("confirmPassword").value;
  const set = (rule, met) => $("pwRules").querySelector(`[data-rule="${rule}"]`).classList.toggle("met", met);
  set("len", pw.length >= 6); set("match", !!cp && pw === cp);
}

/* ============ 4. OWNER SIGN IN, REGISTRATION, PASSWORD RESET ============ */
async function doLogin() {
  if (submitting) return;
  clearFieldErrors($("viewOwnerLogin")); setStatus("");
  const email = val("loginEmail"), password = $("loginPassword").value;
  if (!EMAIL_RE.test(email)) { setFieldError("loginEmail", "Enter your email address."); $("loginEmail").focus(); return; }
  if (!password) { setFieldError("loginPassword", "Enter your password."); $("loginPassword").focus(); return; }
  if (needInternet("Signing in")) return;
  const btn = $("btnOwnerLogin");
  if (!beginSubmit(btn, "Signing in…")) return;
  try {
    const cred = await withTimeout(signInWithEmailAndPassword(auth, email, password), "owner sign in");
    await enterAppOnce(cred.user);
  } catch (err) {
    log("Owner sign-in failed" + (err.code ? ` (${err.code})` : ""), true);
    setStatus(friendlyError(err, "owner"), "err");
  } finally { endSubmit(btn); }
}

async function doForgotPassword() {
  if (submitting) return;
  clearFieldErrors($("viewOwnerLogin")); setStatus("");
  const email = val("loginEmail");
  if (!EMAIL_RE.test(email)) { setFieldError("loginEmail", "Type your email address here first, then tap Forgot password."); $("loginEmail").focus(); return; }
  if (needInternet("Resetting a password")) return;
  const link = $("btnForgot"); link.disabled = true; submitting = true;
  try {
    setStatus("Sending…", "info");
    await withTimeout(sendPasswordResetEmail(auth, email), "send reset email");
    setStatus("If an account exists for " + email + ", a reset link has been sent. Open that email (also look in Spam), choose a new password, then come back and sign in.", "ok");
  } catch (err) {
    log("Password reset failed" + (err.code ? ` (${err.code})` : ""), true);
    setStatus(friendlyError(err, "owner"), "err");
  } finally { submitting = false; link.disabled = false; }
}

// Registration keeps the original four writes in the original order:
// 1 Firebase sign-in account → 2 business → 3 owner profile → 4 first shop → enter the app.
async function doSignup() {
  if (submitting) return;
  if (!validateOwnerSignup(1)) { showOwnerSignupStep(1, { keepStatus: true, noFocus: true }); validateOwnerSignup(1); return; }
  if (!validateOwnerSignup(2)) return;
  if (needInternet("Creating an account")) return;

  const businessName = val("businessName"), ownerName = val("ownerName"), businessPhone = val("businessPhone");
  const shopName = val("shopName"), shopLocation = val("shopLocation"), shopCode = sanitizeCode(val("shopCode"));
  const email = val("email"), password = $("password").value;

  const btn = $("btnCreate");
  if (!beginSubmit(btn, "Creating account…")) return;
  signupInProgress = true;
  try {
    // A retry after a half-finished attempt continues where it stopped instead of creating a second business or shop.
    if (!pendingSignup || pendingSignup.email !== email || !auth.currentUser || auth.currentUser.uid !== pendingSignup.uid) {
      pendingSignup = null;
      setStatus("Step 1 of 4: creating your login…", "info");
      const cred = await withTimeout(createUserWithEmailAndPassword(auth, email, password), "create login");
      pendingSignup = { uid: cred.user.uid, email, user: cred.user, businessId: doc(collection(db, "businesses")).id, shopId: doc(collection(db, "shops")).id, done: {} };
      log("Auth account created: " + pendingSignup.uid);
    }
    const p = pendingSignup;

    if (!p.done.business) {
      setStatus("Step 2 of 4: creating your business record…", "info");
      await withTimeout(setDoc(doc(db, "businesses", p.businessId), {
        name: businessName, phone: businessPhone, ownerUid: p.uid, createdAt: serverTimestamp()
      }), "write business doc");
      p.done.business = true; log("Business doc written: " + p.businessId);
    }
    if (!p.done.user) {
      setStatus("Step 3 of 4: linking your account to the business…", "info");
      await retryOnPermission(() => withTimeout(setDoc(doc(db, "users", p.uid), {
        businessId: p.businessId, role: "owner", name: ownerName, email, active: true, createdAt: serverTimestamp()
      }), "write user doc"), "write user doc");
      p.done.user = true; log("User doc written");
    }
    if (!p.done.shop) {
      setStatus("Step 4 of 4: creating your first shop…", "info");
      await withTimeout(setDoc(doc(db, "shops", p.shopId), {
        businessId: p.businessId, ownerUid: p.uid, name: shopName, location: shopLocation || "", shopCode, createdAt: serverTimestamp()
      }), "write shop doc");
      p.done.shop = true; log("Shop doc written: " + p.shopId);
    }
    log("Signup complete");
    const user = p.user; pendingSignup = null;
    signupInProgress = false;
    await enterAppOnce(user);
  } catch (err) {
    log("Signup failed" + (err.code ? ` (${err.code})` : ""), true);
    const retryable = pendingSignup && pendingSignup.uid;
    setStatus(friendlyError(err, "owner") + (retryable ? " Your login was created, so tap Create Business Account again to finish setting up." : ""), "err");
  } finally { signupInProgress = false; endSubmit(btn); }
}

/* ============ 5. OPERATOR SIGN IN ============ */
async function doOperatorLogin() {
  if (submitting) return;
  clearFieldErrors($("viewOperatorLogin")); setStatus("");
  const shopCode = val("opShopCode"), operatorId = val("opLoginId"), pin = $("opLoginPin").value;
  let bad = null;
  if (!sanitizeCode(shopCode)) { setFieldError("opShopCode", "Enter your shop code."); bad = bad || "opShopCode"; }
  if (!operatorId) { setFieldError("opLoginId", "Enter your operator ID."); bad = bad || "opLoginId"; }
  if (!/^[0-9]{6}$/.test(pin)) { setFieldError("opLoginPin", "Enter your 6-digit PIN."); bad = bad || "opLoginPin"; }
  if (bad) { $(bad).focus(); return; }
  if (needInternet("Signing in")) return;
  const btn = $("btnOperatorLogin");
  if (!beginSubmit(btn, "Signing in…")) return;
  try {
    const internalEmail = buildInternalEmail(shopCode, operatorId);
    const cred = await withTimeout(signInWithEmailAndPassword(auth, internalEmail, pin), "operator sign in");
    await enterAppOnce(cred.user);
  } catch (err) {
    log("Operator sign-in failed" + (err.code ? ` (${err.code})` : ""), true);   // never log the PIN
    setStatus(friendlyError(err, "operator"), "err");
  } finally { endSubmit(btn); }
}

/* ============ 6. SESSION HANDLING (G) ============ */
let entering = null, enteringUid = null;
function enterAppOnce(user) {   // the sign-in handler and the session listener may both ask: only one run per person
  if (entering && enteringUid === user.uid) return entering;
  enteringUid = user.uid;
  entering = enterApp(user).finally(() => { entering = null; enteringUid = null; });
  return entering;
}

function backToForm(msg, kind, role) {
  authenticated = false;
  if (role === "operator") formState = STATE.OPERATOR_LOGIN;
  state = submitting ? STATE.AUTHENTICATING : formState;
  render(false);
  setStatus(msg, kind || "err", VIEW[formState]);
}

// Authorization always comes from the signed-in person's Firestore profile (and the security rules), never from the tab they picked.
async function enterApp(user) {
  if (!submitting) { state = STATE.AUTHENTICATING; setBusyText("Signing you in…"); render(false); }
  let snap;
  try { snap = await getDoc(doc(db, "users", user.uid)); }
  catch (err) {
    log(`enterApp: reading your profile failed (${err.code || "no code"})`, true);
    backToForm("You are signed in, but your profile could not be loaded. Check your connection and try again.");
    return false;
  }
  if (!snap.exists()) {
    log("enterApp: no user profile found for this account");
    backToForm("No business profile was found for this account. If you just registered, tap Create a business account and finish the setup; otherwise contact support.");
    return false;
  }
  const u = snap.data();
  if (u.active === false) {
    backToForm("This account has been deactivated. Ask your business owner.", "err", u.role === "operator" ? "operator" : null);
    try { await signOut(auth); } catch (e) {}
    return false;
  }
  if (u.role === "operator" && (!u.shopId || !u.businessId)) {
    backToForm("This operator account is not assigned to a shop. Ask your business owner.", "err", "operator");
    try { await signOut(auth); } catch (e) {}
    return false;
  }
  currentRole = u.role; currentBusinessId = u.businessId;
  log(`enterApp: profile loaded: role=${u.role}, businessId=${u.businessId}, shopId=${u.shopId || "(business-wide)"}, active=${u.active}`);
  try { localStorage.setItem("mcHasAccount", "1"); } catch (e) {}

  authenticated = true; state = STATE.AUTHENTICATED;
  setBusyText("Opening MediStock…"); render(false);
  if (!DEBUG) { location.replace("app.html"); return true; }
  await showDebugConnected(user, u);
  return true;
}

function handleAuthStateChange(user) {
  if (!sessionChecked) { sessionChecked = true; clearTimeout(sessionTimer); }
  if (!user) {
    applyInitialNotice();
    currentRole = null; currentBusinessId = null; currentShopId = null; currentShopCode = null; authenticated = false;
    if (!submitting && (state === STATE.AUTHENTICATING || state === STATE.AUTHENTICATED)) { state = formState; render(false); }
    if (DEBUG) hideDebugConnected();
    return;
  }
  if (signupInProgress) return;      // registration is still writing the business, profile and shop
  enterAppOnce(user).catch((err) => { log("enterApp: unexpected failure (" + (err.code || "no code") + ")", true); backToForm("Something went wrong. Please try again."); });
}

async function doLogout() {
  if (unsubDrugs) unsubDrugs();
  if (unsubShops) unsubShops();
  await signOut(auth);
  authenticated = false; state = formState; render(false);
}

/* ============ 7. DEBUG AND DEVELOPER TOOLS (H) — only with ?debug=1 ============ */
function redact(msg) { return String(msg).replace(/\b\d{6}\b/g, "••••••"); }   // PINs never reach the log
function log(msg, isError) {
  const el = $("debugLog"); if (!el) return;
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${redact(msg)}`;
  if (isError) line.style.color = "var(--danger)";
  el.appendChild(line); el.scrollTop = el.scrollHeight;
}
function setOpStatus(msg, isError) { const el = $("opStatus"); el.textContent = msg; el.className = "status " + (isError ? "err" : "ok"); }

function hideDebugConnected() { ["appCard", "addOperatorCard", "testCard"].forEach((id) => $(id).classList.add("hidden")); }
async function showDebugConnected(user, u) {
  $("viewBusy").classList.add("hidden"); $("roleTabs").classList.add("hidden");
  $("appCard").classList.remove("hidden"); $("testCard").classList.remove("hidden");
  $("roleBadge").textContent = currentRole;
  let bizName = "(unknown)";
  try { const b = await getDoc(doc(db, "businesses", currentBusinessId)); bizName = b.exists() ? b.data().name : "(unknown)"; } catch (e) {}
  $("bizName").textContent = bizName;
  if (currentRole === "owner") {
    $("whoAmI").textContent = user.email;
    $("addOperatorCard").classList.remove("hidden");
    // developer test tools only: they work against the business's first shop; the real app lets the owner pick any shop
    unsubShops = onSnapshot(query(collection(db, "shops"), where("businessId", "==", currentBusinessId)), (s) => {
      if (!s.empty) {
        currentShopId = s.docs[0].id; currentShopCode = s.docs[0].data().shopCode;
        $("shopNameLabel").textContent = `${s.docs[0].data().name} (${currentShopCode})`;
        startDrugListener();
      }
    }, (err) => log(`shops listener failed (${err.code})`, true));
  } else {
    currentShopId = u.shopId;
    $("whoAmI").textContent = `${u.name} (Operator ${u.operatorId})`;
    try {
      const s = await getDoc(doc(db, "shops", currentShopId));
      currentShopCode = s.exists() ? s.data().shopCode : "";
      $("shopNameLabel").textContent = s.exists() ? `${s.data().name} (${currentShopCode})` : "(unknown)";
    } catch (err) { $("shopNameLabel").textContent = "(permission error)"; log(`reading shop failed (${err.code})`, true); }
    startDrugListener();
  }
}

async function doAddOperator() {
  if (currentRole !== "owner" || !currentBusinessId || !currentShopId || !currentShopCode) { setOpStatus("Sign in as an owner first.", true); return; }
  const name = val("opName"), pin = $("opPin").value;
  if (!name || !/^[0-9]{6}$/.test(pin)) { setOpStatus("Enter a name and a 6-digit PIN.", true); return; }
  setOpStatus("Generating a unique Operator ID…");
  let operatorId = null;
  for (let i = 0; i < 5 && !operatorId; i++) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000));
    const existing = await getDocs(query(collection(db, "users"), where("businessId", "==", currentBusinessId), where("shopId", "==", currentShopId), where("operatorId", "==", candidate)));
    if (existing.empty) operatorId = candidate;
  }
  if (!operatorId) { setOpStatus("Could not generate a unique Operator ID. Try again.", true); return; }
  const internalEmail = buildInternalEmail(currentShopCode, operatorId);
  let secondaryApp;
  try {
    setOpStatus("Creating operator account…");
    secondaryApp = initializeApp(firebaseConfig, "operator-creator-" + Date.now());   // second app so the owner's own session is untouched
    const secondaryAuth = getAuth(secondaryApp), secondaryDb = getFirestore(secondaryApp);
    const cred = await withTimeout(createUserWithEmailAndPassword(secondaryAuth, internalEmail, pin), "create operator login");
    await withTimeout(setDoc(doc(secondaryDb, "users", cred.user.uid), {
      businessId: currentBusinessId, shopId: currentShopId, role: "operator", operatorId, name, active: true, createdAt: serverTimestamp()
    }), "write operator profile");
    await signOut(secondaryAuth); await deleteApp(secondaryApp);
    setOpStatus(`Created. Give the operator: Shop Code ${currentShopCode} · Operator ID ${operatorId} · PIN ${pin}`, false);
    log(`Operator created: ${name} (${operatorId})`);
    $("opName").value = ""; $("opPin").value = "";
  } catch (err) {
    setOpStatus(friendlyError(err, "owner"), true);
    log("Add operator failed" + (err.code ? ` (${err.code})` : ""), true);
    if (secondaryApp) { try { await deleteApp(secondaryApp); } catch (e) {} }
  }
}

function startDrugListener() {
  if (unsubDrugs) unsubDrugs();
  const q = query(collection(db, "drugs"), where("businessId", "==", currentBusinessId), where("shopId", "==", currentShopId));
  unsubDrugs = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    const badge = $("netBadge"), fromCache = snap.metadata.fromCache;
    badge.textContent = fromCache ? "offline (cached)" : "online (synced)";
    badge.className = "badge " + (fromCache ? "offline" : "online");
    const list = $("drugList");
    if (snap.empty) { list.innerHTML = '<div style="color:var(--muted); font-size:13px;">No test items yet.</div>'; return; }
    list.innerHTML = "";
    snap.docs.sort((a, b) => (b.data().createdAt?.seconds || 0) - (a.data().createdAt?.seconds || 0)).forEach((d) => {
      const v = d.data(), row = document.createElement("div"), n = document.createElement("span"), q2 = document.createElement("span");
      row.className = "item"; q2.className = "qty";
      n.textContent = v.name; q2.textContent = v.currentStockBase + (d.metadata.hasPendingWrites ? " · syncing…" : "");
      row.append(n, q2); list.appendChild(row);
    });
  }, (err) => { console.error("drugs listener error:", err); log("drugs listener error: " + err.message, true); });
}
async function addTestDrug() {
  const name = val("drugName"), qty = Number($("drugQty").value);
  if (!name || !qty || !currentShopId) return;
  await addDoc(collection(db, "drugs"), { businessId: currentBusinessId, shopId: currentShopId, name, currentStockBase: qty, baseUnit: "unit", active: true, createdAt: serverTimestamp() });
  $("drugName").value = ""; $("drugQty").value = "";
}

/* ============ 8. WIRING ============ */
let sessionTimer = null;
function bindUi() {
  // role selector (touch, mouse and arrow keys)
  $("tabOwner").addEventListener("click", () => setAuthTab("owner"));
  $("tabOperator").addEventListener("click", () => setAuthTab("operator"));
  $("roleTabs").addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const toOp = $("tabOwner").getAttribute("aria-selected") === "true"; setAuthTab(toOp ? "operator" : "owner"); (toOp ? $("tabOperator") : $("tabOwner")).focus(); }
  });
  // forms: Enter submits the relevant one
  const onSubmit = (id, fn) => $(id).addEventListener("submit", (e) => { e.preventDefault(); fn(); });
  onSubmit("formOwnerLogin", doLogin);
  onSubmit("formSignup1", () => { if (validateOwnerSignup(1)) showOwnerSignupStep(2); });
  onSubmit("formSignup2", doSignup);
  onSubmit("formOperatorLogin", doOperatorLogin);
  $("btnForgot").addEventListener("click", doForgotPassword);
  $("btnCreateAccount").addEventListener("click", () => showOwnerSignupStep(1));
  $("btnSignupBack").addEventListener("click", () => { if (!submitting) showOwnerSignupStep(1); });
  document.querySelectorAll('[data-act="back-to-login"]').forEach((b) => b.addEventListener("click", () => showOwnerLogin()));
  document.querySelectorAll(".reveal").forEach((b) => b.addEventListener("click", () => toggleReveal(b)));
  // typing clears that field's error; codes and PIN are cleaned as you type
  document.querySelectorAll(".input").forEach((i) => i.addEventListener("input", () => { if (i.getAttribute("aria-invalid") === "true") setFieldError(i.id, ""); }));
  $("password").addEventListener("input", updatePasswordRules); $("confirmPassword").addEventListener("input", updatePasswordRules);
  $("shopCode").addEventListener("input", (e) => { e.target.value = sanitizeCode(e.target.value); });
  $("opShopCode").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
  $("opLoginPin").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });
  $("opLoginId").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\s/g, ""); });
  // keep the focused field visible above the on-screen keyboard
  document.addEventListener("focusin", (e) => {
    if (e.target.matches && e.target.matches(".input") && window.matchMedia("(max-width: 767px)").matches) setTimeout(() => { try { e.target.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (x) {} }, 280);
  });
  window.addEventListener("online", updateConnectivity); window.addEventListener("offline", updateConnectivity);
  updateConnectivity();
  // debug
  if (DEBUG) {
    $("devTools").classList.remove("hidden");
    $("btnDevContinue").addEventListener("click", () => { location.href = "app.html"; });
    $("btnDevLogout").addEventListener("click", doLogout);
    $("btnDevAddOperator").addEventListener("click", doAddOperator);
    $("btnDevAddDrug").addEventListener("click", addTestDrug);
    window.addEventListener("unhandledrejection", (e) => log("Unhandled error: " + (e.reason && (e.reason.code || e.reason.message) || e.reason), true));
  } else {
    $("devTools").remove();   // not just hidden: the debug log and test tools do not exist in normal use
  }
}

bindUi();
// The page always opens on the same screen on every device: Business Owner sign-in
// (Operator sign-in only when the app sent a deactivated operator back here with ?disabled=1).
const params = new URLSearchParams(location.search);
let initialNotice = params.get("disabled") === "1" ? "This account has been deactivated. Ask your business owner." : null;
function applyInitialNotice() {
  if (!initialNotice || authenticated) return;
  const msg = initialNotice; initialNotice = null;
  showOperatorLogin({ noFocus: true }); setStatus(msg, "err", VIEW[STATE.OPERATOR_LOGIN]);
}
state = STATE.AUTHENTICATING; formState = STATE.OWNER_LOGIN; setBusyText("Checking your session…"); render(false);
onAuthStateChanged(auth, handleAuthStateChange);
// if the saved-session check is slow, do not leave the person looking at a spinner
sessionTimer = setTimeout(() => { if (!sessionChecked && state === STATE.AUTHENTICATING && !submitting) { applyInitialNotice(); state = formState; render(false); } }, 4000);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// handy names for developers working in the console
Object.assign(window, { setAuthTab, showOwnerLogin, showOwnerSignupStep, showOperatorLogin, validateOwnerSignup, doSignup, doLogin, doForgotPassword, doOperatorLogin, enterApp, handleAuthStateChange, doLogout });
window.__mcLoginReady = true;
